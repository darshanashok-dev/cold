import os
import json
import re
import sqlite3
import threading
import io
from datetime import datetime
from flask import Flask, request, jsonify, render_template
import google.generativeai as genai
from PIL import Image

# Attempt to load environment variables from .env file for local development
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

app = Flask(__name__)

# --- CONFIGURATION & CONSTANTS ---
MAX_FILE_SIZE = 5 * 1024 * 1024  # 5MB size limit
ALLOWED_MIME_TYPES = {'image/jpeg', 'image/png', 'image/webp', 'image/gif'}

# Path to database file
DATABASE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data.db')

# Simple in-memory rate limiter to prevent spamming
rate_limit_lock = threading.Lock()
client_request_history = {} # IP -> list of timestamps

def is_rate_limited(ip_address, limit_per_minute=10):
    import time
    now = time.time()
    with rate_limit_lock:
        if ip_address not in client_request_history:
            client_request_history[ip_address] = []
        timestamps = client_request_history[ip_address]
        # Keep only timestamps in the last 60 seconds
        timestamps = [t for t in timestamps if now - t < 60]
        if len(timestamps) >= limit_per_minute:
            return True
        timestamps.append(now)
        client_request_history[ip_address] = timestamps
        return False

# --- MOCK DIAGNOSTICS DATA ---
MOCK_DATA_TEMPLATES = {
    "apple": {
        "fruit": "Apple",
        "freshness": "Fresh",
        "conf_range": (94.0, 99.5),
        "decay_range": (1.0, 4.5),
        "days_range": (10, 14),
        "ai_reasoning": "Mock Diagnostic: Fruit displays smooth cuticle, vibrant red anthocyanin coverage, and no signs of mechanical puncture or rot."
    },
    "banana": {
        "fruit": "Banana",
        "freshness": "Overripe",
        "conf_range": (88.0, 95.0),
        "decay_range": (12.0, 22.0),
        "days_range": (2, 4),
        "ai_reasoning": "Mock Diagnostic: Peel exhibits extensive necrotic spotting and softening, indicating rapid starch-to-sugar conversion."
    },
    "tomato": {
        "fruit": "Tomato",
        "freshness": "Fresh",
        "conf_range": (91.0, 97.5),
        "decay_range": (0.5, 2.5),
        "days_range": (7, 10),
        "ai_reasoning": "Mock Diagnostic: Uniform red color with firm pericarp structure. Small stem area is green and intact, indicating high freshness."
    },
    "orange": {
        "fruit": "Orange",
        "freshness": "Fresh",
        "conf_range": (93.0, 98.0),
        "decay_range": (1.0, 3.0),
        "days_range": (12, 16),
        "ai_reasoning": "Mock Diagnostic: Rind maintains firm texture and bright orange carotenoid pigmentation. Zero evidence of green mold growth."
    }
}

# Thread lock for thread-safe access to globals
state_lock = threading.Lock()

# Global state baseline defaults
current_setpoints = {
    "fruit": "None (Awaiting Image)",
    "target_low": 12.0,
    "target_high": 14.0,
    "freshness": "Unknown",
    "confidence": 0.0,
    "decay_index": 0.0,
    "days_remaining": 0,
    "ai_reasoning": "Awaiting visual diagnostics trigger."
}

last_telemetry = {
    "temperature": 0.0,
    "humidity": 0.0,
    "is_cooling": 0,
    "timestamp": None
}

# --- DATABASE OPERATIONS ---
def init_db():
    """Initializes SQLite database tables."""
    try:
        with sqlite3.connect(DATABASE_PATH) as conn:
            cursor = conn.cursor()
            # Telemetry logs from ESP32
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS telemetry (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                    temperature REAL,
                    humidity REAL,
                    is_cooling INTEGER
                )
            ''')
            # Scan history log
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS scan_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                    fruit TEXT,
                    freshness TEXT,
                    confidence REAL,
                    decay_index REAL,
                    days_remaining INTEGER,
                    ai_reasoning TEXT,
                    target_low REAL,
                    target_high REAL
                )
            ''')
            # System state (key-value pair for persistence)
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS system_state (
                    key TEXT PRIMARY KEY,
                    value TEXT
                )
            ''')
            conn.commit()
        print("Database initialized successfully.")
    except Exception as e:
        print(f"Error initializing database: {e}")

def load_persisted_state():
    """Loads the previously saved setpoints from the database."""
    global current_setpoints
    try:
        if not os.path.exists(DATABASE_PATH):
            return
        with sqlite3.connect(DATABASE_PATH) as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT value FROM system_state WHERE key='current_setpoints'")
            row = cursor.fetchone()
            if row:
                loaded = json.loads(row[0])
                # Backfill keys to maintain compatibility with new fields
                with state_lock:
                    for k, v in current_setpoints.items():
                        if k not in loaded:
                            loaded[k] = v
                    current_setpoints = loaded
                print(f"Persisted setpoints loaded successfully: {current_setpoints}")
    except Exception as e:
        print(f"Warning: Failed to load persisted state: {e}")

def save_persisted_state():
    """Saves the current setpoints to the database."""
    try:
        with state_lock:
            state_json = json.dumps(current_setpoints)
        with sqlite3.connect(DATABASE_PATH) as conn:
            cursor = conn.cursor()
            cursor.execute(
                "INSERT OR REPLACE INTO system_state (key, value) VALUES ('current_setpoints', ?)",
                (state_json,)
            )
            conn.commit()
    except Exception as e:
        print(f"Error saving persisted state: {e}")

# Initialize Database and load previous state
init_db()
load_persisted_state()

# --- MODEL & API INITIALIZATION ---
api_key = os.environ.get("GEMINI_API_KEY", "").strip()
use_mock_mode = False
model = None

if not api_key or "YOUR_GEMINI" in api_key or "INSERT_API_KEY" in api_key or api_key == "":
    print("\n" + "="*80)
    print("WARNING: Running in MOCK DIAGNOSTICS Mode. Gemini API key is missing or placeholder.")
    print("To use the real Gemini API, configure GEMINI_API_KEY in your smart_fridge/.env file.")
    print("="*80 + "\n")
    use_mock_mode = True
else:
    try:
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel('gemini-3.5-flash')
        print("Gemini API configured successfully from environment.")
    except Exception as e:
        print(f"Error configuring Gemini API: {e}. Falling back to MOCK Mode.")
        use_mock_mode = True

# --- HELPER FUNCTIONS ---
def is_ajax_request():
    """Robust helper to check if a request expects a JSON/AJAX response."""
    return (
        request.headers.get('X-Requested-With') == 'XMLHttpRequest' or
        request.is_json or
        'application/json' in request.headers.get('Accept', '')
    )

def validate_image_upload(file):
    """Checks file size and MIME type to secure the upload route."""
    if not file:
        return False, "No file provided"
    
    # Validate MIME type
    if file.mimetype not in ALLOWED_MIME_TYPES:
        return False, f"Unsupported file type: {file.mimetype}. Only JPEGs, PNGs, WEBP, and GIFs are supported."

    # Validate size
    try:
        file.seek(0, os.SEEK_END)
        size = file.tell()
        file.seek(0)  # Reset pointer to top
        if size > MAX_FILE_SIZE:
            return False, f"File size too large: {size / (1024*1024):.1f}MB. Maximum allowed is 5MB."
    except Exception as e:
        return False, f"Error validating file size: {str(e)}"

    return True, None

def clean_and_parse_json(text):
    """
    Cleans up response text from Gemini to ensure valid JSON parsing.
    Handles markdown code blocks (```json ... ```) and leading/trailing text.
    """
    cleaned = text.strip()
    
    # Strip markdown block wraps
    if cleaned.startswith("```json"):
        cleaned = cleaned[7:]
    elif cleaned.startswith("```"):
        cleaned = cleaned[3:]
        
    if cleaned.endswith("```"):
        cleaned = cleaned[:-3]
        
    cleaned = cleaned.strip()
    
    # If there is extra text around the JSON, extract the first outer {...}
    match = re.search(r'\{.*\}', cleaned, re.DOTALL)
    if match:
        cleaned = match.group(0)
        
    return json.loads(cleaned)

def extract_float(value, default=0.0):
    if value is None:
        return default
    try:
        cleaned = re.sub(r'[^\d\.]', '', str(value))
        return float(cleaned) if cleaned else default
    except Exception:
        return default

def extract_int(value, default=0):
    if value is None:
        return default
    try:
        cleaned = re.sub(r'[^\d]', '', str(value))
        return int(cleaned) if cleaned else default
    except Exception:
        return default

# --- ROUTES ---
@app.route('/')
def index():
    with state_lock:
        state_to_render = current_setpoints.copy()
    state_to_render["use_mock_mode"] = use_mock_mode
    return render_template('index.html', state=state_to_render)

@app.route('/detect', methods=['POST'])
def detect_fruit():
    global current_setpoints
    
    # Rate limiter check (10 requests per minute per IP)
    if is_rate_limited(request.remote_addr, limit_per_minute=10):
        error_msg = "Rate limit exceeded. Maximum 10 scans per minute."
        if is_ajax_request() or request.mimetype == 'application/octet-stream' or 'image' not in request.files:
            return jsonify({"error": error_msg}), 429
        with state_lock:
            state_to_render = current_setpoints.copy()
        state_to_render["use_mock_mode"] = use_mock_mode
        return render_template('index.html', state=state_to_render, error=error_msg)
        
    # Check if this is a raw binary POST (PWA/Mobile capture stream or application/octet-stream)
    is_raw_bytes = False
    filename_lower = ""
    
    if request.mimetype == 'application/octet-stream' or 'image' not in request.files:
        # Accept raw bytes
        raw_data = request.get_data()
        if not raw_data:
            error_msg = "No image data provided"
            if is_ajax_request():
                return jsonify({"error": error_msg}), 400
            with state_lock:
                state_to_render = current_setpoints.copy()
            state_to_render["use_mock_mode"] = use_mock_mode
            return render_template('index.html', state=state_to_render, error=error_msg)
        
        # Validate raw data size (max 5MB)
        if len(raw_data) > MAX_FILE_SIZE:
            error_msg = f"Data size too large: {len(raw_data) / (1024*1024):.1f}MB. Maximum allowed is 5MB."
            if is_ajax_request():
                return jsonify({"error": error_msg}), 400
            with state_lock:
                state_to_render = current_setpoints.copy()
            state_to_render["use_mock_mode"] = use_mock_mode
            return render_template('index.html', state=state_to_render, error=error_msg)
            
        try:
            img = Image.open(io.BytesIO(raw_data))
            is_raw_bytes = True
        except Exception as e:
            error_msg = f"Failed to parse raw image data: {str(e)}"
            if is_ajax_request():
                return jsonify({"error": error_msg}), 400
            with state_lock:
                state_to_render = current_setpoints.copy()
            state_to_render["use_mock_mode"] = use_mock_mode
            return render_template('index.html', state=state_to_render, error=error_msg)
    else:
        file = request.files['image']
        if file.filename == '':
            error_msg = "No selected image file"
            if is_ajax_request():
                return jsonify({"error": error_msg}), 400
            with state_lock:
                state_to_render = current_setpoints.copy()
            state_to_render["use_mock_mode"] = use_mock_mode
            return render_template('index.html', state=state_to_render, error=error_msg)

        # Perform file validation checks
        is_valid, validation_error = validate_image_upload(file)
        if not is_valid:
            if is_ajax_request():
                return jsonify({"error": validation_error}), 400
            with state_lock:
                state_to_render = current_setpoints.copy()
            state_to_render["use_mock_mode"] = use_mock_mode
            return render_template('index.html', state=state_to_render, error=validation_error)

    try:
        if not is_raw_bytes:
            img = Image.open(file.stream)
            filename_lower = getattr(file, 'filename', '').lower()
        prompt = """
        Analyze this image of produce inside a cold storage box.
        Identify the main fruit (e.g., Apple, Banana, Tomato, Orange).
        Determine its freshness.
        Estimate a classification confidence (percentage, e.g. 98.5).
        Estimate a decay index (percentage of surface damage/overripeness, e.g. 5.0).
        Estimate days of shelf-life remaining under refrigeration (e.g. 10).
        Provide a brief sentence of AI reasoning explaining the evaluation.
        
        Output your response STRICTLY as a JSON object with no markdown formatting.
        Example: {
            "fruit": "Apple",
            "freshness": "Fresh",
            "confidence": 98.5,
            "decay_index": 5.0,
            "days_remaining": 10,
            "ai_reasoning": "Produce displays bright red skin with no visible bruising or structural degradation."
        }
        """
        
        # Check if running in mock mode
        if use_mock_mode:
            import random
            selected_template = None
            for key, template in MOCK_DATA_TEMPLATES.items():
                if key in filename_lower:
                    selected_template = template
                    break
            if not selected_template:
                selected_template = random.choice(list(MOCK_DATA_TEMPLATES.values()))
                
            data = {
                "fruit": selected_template["fruit"],
                "freshness": selected_template["freshness"],
                "confidence": round(random.uniform(*selected_template["conf_range"]), 1),
                "decay_index": round(random.uniform(*selected_template["decay_range"]), 1),
                "days_remaining": random.randint(*selected_template["days_range"]),
                "ai_reasoning": selected_template["ai_reasoning"]
            }
        else:
            # Call Gemini model with 12s timeout and JSON output configuration
            response = model.generate_content(
                [prompt, img],
                generation_config={"response_mime_type": "application/json"},
                request_options={"timeout": 12}
            )
            try:
                data = json.loads(response.text)
            except Exception:
                data = clean_and_parse_json(response.text)
        
        fruit = data.get('fruit', 'Unknown')
        fresh = data.get('freshness', 'Unknown')
        confidence = extract_float(data.get('confidence'), 95.0)
        decay_index = extract_float(data.get('decay_index'), 0.0)
        days_remaining = extract_int(data.get('days_remaining'), 7)
        ai_reasoning = data.get('ai_reasoning', 'No rationale provided.')
        fruit_lower = fruit.lower()
        
        # Thermodynamics Logic Matrix using lookup dict (covers all 4 fruits)
        SETPOINTS = {
            "apple":  (10.0, 12.0),
            "banana": (14.0, 16.0),
            "tomato": (7.0, 10.0),
            "orange": (8.0, 11.0),
        }
        
        low, high = 12.0, 14.0  # default fallback
        for key, (l, h) in SETPOINTS.items():
            if key in fruit_lower:
                low, high = l, h
                break
        
        with state_lock:
            current_setpoints = {
                "fruit": fruit,
                "target_low": low,
                "target_high": high,
                "freshness": fresh,
                "confidence": confidence,
                "decay_index": decay_index,
                "days_remaining": days_remaining,
                "ai_reasoning": ai_reasoning
            }
            
        print(f"Update Success: {current_setpoints}")
        
        # Persist setpoints and log scan history
        save_persisted_state()
        try:
            with sqlite3.connect(DATABASE_PATH) as conn:
                cursor = conn.cursor()
                cursor.execute(
                    """
                    INSERT INTO scan_history 
                    (fruit, freshness, confidence, decay_index, days_remaining, ai_reasoning, target_low, target_high)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (fruit, fresh, confidence, decay_index, days_remaining, ai_reasoning, low, high)
                )
                conn.commit()
        except Exception as e:
            print(f"Error logging scan to history DB: {e}")
        
        # If the request was made via AJAX (fetch), return JSON
        if is_ajax_request():
            with state_lock:
                state_to_return = current_setpoints.copy()
            state_to_return["use_mock_mode"] = use_mock_mode
            return jsonify(state_to_return), 200
            
        # Redirect back to the web UI after traditional form upload
        with state_lock:
            state_to_render = current_setpoints.copy()
        state_to_render["use_mock_mode"] = use_mock_mode
        return render_template('index.html', state=state_to_render, success=True)
        
    except Exception as e:
        error_str = str(e)
        print(f"AI Error: {error_str}")
        if is_ajax_request():
            return jsonify({"error": error_str}), 500
        with state_lock:
            state_to_render = current_setpoints.copy()
        return render_template('index.html', state=state_to_render, error=f"AI Error: {error_str}")

@app.route('/get_setpoints', methods=['GET'])
def get_setpoints():
    # The ESP32 calls this endpoint every 15 seconds
    with state_lock:
        state_to_return = current_setpoints.copy()
    return jsonify(state_to_return), 200

@app.route('/api/state', methods=['GET'])
def get_state():
    # Endpoint for dynamic AJAX updates in the web UI, includes live telemetry
    with state_lock:
        state_to_return = current_setpoints.copy()
        state_to_return["telemetry"] = last_telemetry.copy()
    state_to_return["use_mock_mode"] = use_mock_mode
    return jsonify(state_to_return), 200

@app.route('/api/telemetry', methods=['POST'])
def post_telemetry():
    """Logs current temperature/humidity reading from the physical ESP32 controller."""
    try:
        # Check payload
        data = request.get_json()
        if not data:
            return jsonify({"error": "Missing JSON body"}), 400
            
        temp = extract_float(data.get("temperature"), None)
        hum = extract_float(data.get("humidity"), None)
        is_cooling = extract_int(data.get("is_cooling"), 0)
        
        if temp is None or hum is None:
            return jsonify({"error": "temperature and humidity values are required"}), 400
            
        # Store in database
        with sqlite3.connect(DATABASE_PATH) as conn:
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO telemetry (temperature, humidity, is_cooling) VALUES (?, ?, ?)",
                (temp, hum, is_cooling)
            )
            conn.commit()
            
        # Update dynamic active telemetry state
        with state_lock:
            last_telemetry["temperature"] = temp
            last_telemetry["humidity"] = hum
            last_telemetry["is_cooling"] = is_cooling
            last_telemetry["timestamp"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            last_telemetry["ip"] = request.remote_addr
            
        return jsonify({"status": "success"}), 201
    except Exception as e:
        print(f"Error handling telemetry data: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/history', methods=['GET'])
def get_history():
    """Fetches telemetry history logs for dashboard charting."""
    try:
        limit = min(extract_int(request.args.get('limit'), 30), 500)
        with sqlite3.connect(DATABASE_PATH) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            # Chronological order for plotting
            cursor.execute(
                "SELECT timestamp, temperature, humidity, is_cooling FROM telemetry ORDER BY id DESC LIMIT ?",
                (limit,)
            )
            telemetry_rows = cursor.fetchall()
            telemetry_data = [dict(row) for row in reversed(telemetry_rows)]
            
            # Historical scan results
            cursor.execute(
                "SELECT timestamp, fruit, freshness, confidence, decay_index, days_remaining, ai_reasoning, target_low, target_high FROM scan_history ORDER BY id DESC LIMIT ?",
                (limit,)
            )
            scan_rows = cursor.fetchall()
            scan_history_data = [dict(row) for row in scan_rows]
            
        return jsonify({
            "telemetry": telemetry_data,
            "scans": scan_history_data
        }), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    # Determine configuration via environment variables
    flask_debug = os.environ.get("FLASK_DEBUG", "false").lower() in ("true", "1")
    use_https = os.environ.get("USE_HTTPS", "false").lower() in ("true", "1")
    
    if use_https:
        try:
            print("Starting Flask server with self-signed (adhoc) SSL context...")
            app.run(host='0.0.0.0', port=5000, debug=flask_debug, ssl_context='adhoc')
        except Exception as e:
            print(f"Error: Could not run Flask with SSL context: {e}. Falling back to plain HTTP.")
            app.run(host='0.0.0.0', port=5000, debug=flask_debug)
    else:
        print("Starting Flask server over HTTP...")
        app.run(host='0.0.0.0', port=5000, debug=flask_debug)
