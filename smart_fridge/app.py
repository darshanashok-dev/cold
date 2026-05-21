import os
import json
import re
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

# --- CONFIGURATION ---
api_key = os.environ.get("GEMINI_API_KEY", "").strip()
use_mock_mode = False

if not api_key or "YOUR_GEMINI" in api_key or "INSERT_API_KEY" in api_key or api_key == "":
    print("\n" + "="*80)
    print("WARNING: Running in MOCK DIAGNOSTICS Mode. Gemini API key is missing or placeholder.")
    print("To use the real Gemini API, configure GEMINI_API_KEY in your /home/da/cold/smart_fridge/.env file.")
    print("="*80 + "\n")
    use_mock_mode = True
else:
    try:
        genai.configure(api_key=api_key)
        print("Gemini API configured successfully from environment/configuration.")
    except Exception as e:
        print(f"Error configuring Gemini API: {e}. Falling back to MOCK Mode.")
        use_mock_mode = True

model = genai.GenerativeModel('gemini-1.5-flash')

# Global state that the ESP32 will constantly poll
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
    # Serves the mobile testing interface
    return render_template('index.html', state=current_setpoints)

@app.route('/detect', methods=['POST'])
def detect_fruit():
    global current_setpoints
    if 'image' not in request.files:
        error_msg = "No image provided"
        if request.headers.get('X-Requested-With') == 'XMLHttpRequest' or request.is_json:
            return jsonify({"error": error_msg}), 400
        return render_template('index.html', state=current_setpoints, error=error_msg)

    file = request.files['image']
    if file.filename == '':
        error_msg = "No selected file"
        if request.headers.get('X-Requested-With') == 'XMLHttpRequest' or request.is_json:
            return jsonify({"error": error_msg}), 400
        return render_template('index.html', state=current_setpoints, error=error_msg)

    try:
        img = Image.open(file.stream)
        prompt = """
        Analyze this image of produce inside a cold storage box.
        Identify the main fruit (e.g., Apple, Banana, Tomato).
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
            filename_lower = getattr(file, 'filename', '').lower()
            
            mock_database = [
                {
                    "fruit": "Apple",
                    "freshness": "Fresh",
                    "confidence": random.uniform(94.0, 99.5),
                    "decay_index": random.uniform(1.0, 4.5),
                    "days_remaining": random.randint(10, 14),
                    "ai_reasoning": "Mock Diagnostic: Fruit displays smooth cuticle, vibrant red anthocyanin coverage, and no signs of mechanical puncture or rot."
                },
                {
                    "fruit": "Banana",
                    "freshness": "Overripe",
                    "confidence": random.uniform(88.0, 95.0),
                    "decay_index": random.uniform(12.0, 22.0),
                    "days_remaining": random.randint(2, 4),
                    "ai_reasoning": "Mock Diagnostic: Peel exhibits extensive necrotic spotting and softening, indicating rapid starch-to-sugar conversion."
                },
                {
                    "fruit": "Tomato",
                    "freshness": "Fresh",
                    "confidence": random.uniform(91.0, 97.5),
                    "decay_index": random.uniform(0.5, 2.5),
                    "days_remaining": random.randint(7, 10),
                    "ai_reasoning": "Mock Diagnostic: Uniform red color with firm pericarp structure. Small stem area is green and intact, indicating high freshness."
                },
                {
                    "fruit": "Orange",
                    "freshness": "Fresh",
                    "confidence": random.uniform(93.0, 98.0),
                    "decay_index": random.uniform(1.0, 3.0),
                    "days_remaining": random.randint(12, 16),
                    "ai_reasoning": "Mock Diagnostic: Rind maintains firm texture and bright orange carotenoid pigmentation. Zero evidence of green mold growth."
                }
            ]
            
            selected_mock = None
            for mock in mock_database:
                if mock["fruit"].lower() in filename_lower:
                    selected_mock = mock.copy()
                    break
            if not selected_mock:
                selected_mock = random.choice(mock_database).copy()
                
            selected_mock["confidence"] = round(selected_mock["confidence"], 1)
            selected_mock["decay_index"] = round(selected_mock["decay_index"], 1)
            data = selected_mock
        else:
            # Call Gemini model
            response = model.generate_content([prompt, img])
            # Robust parsing
            data = clean_and_parse_json(response.text)
        
        fruit = data.get('fruit', 'Unknown')
        fresh = data.get('freshness', 'Unknown')
        confidence = extract_float(data.get('confidence'), 95.0)
        decay_index = extract_float(data.get('decay_index'), 0.0)
        days_remaining = extract_int(data.get('days_remaining'), 7)
        ai_reasoning = data.get('ai_reasoning', 'No rationale provided.')
        fruit_lower = fruit.lower()
        
        # Thermodynamics Logic Matrix
        if "apple" in fruit_lower:
            current_setpoints = {
                "fruit": fruit,
                "target_low": 10.0,
                "target_high": 12.0,
                "freshness": fresh,
                "confidence": confidence,
                "decay_index": decay_index,
                "days_remaining": days_remaining,
                "ai_reasoning": ai_reasoning
            }
        elif "banana" in fruit_lower:
            current_setpoints = {
                "fruit": fruit,
                "target_low": 14.0,
                "target_high": 16.0,
                "freshness": fresh,
                "confidence": confidence,
                "decay_index": decay_index,
                "days_remaining": days_remaining,
                "ai_reasoning": ai_reasoning
            }
        else:
            # Default fallback for unrecognized items
            current_setpoints = {
                "fruit": fruit,
                "target_low": 12.0,
                "target_high": 14.0,
                "freshness": fresh,
                "confidence": confidence,
                "decay_index": decay_index,
                "days_remaining": days_remaining,
                "ai_reasoning": ai_reasoning
            }
            
        print(f"Update Success: {current_setpoints}")
        
        # If the request was made via AJAX (fetch), return JSON
        if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
            return jsonify(current_setpoints), 200
            
        # Redirect back to the web UI after traditional form upload
        return render_template('index.html', state=current_setpoints, success=True)
        
    except Exception as e:
        error_str = str(e)
        print(f"AI Error: {error_str}")
        if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
            return jsonify({"error": error_str}), 500
        return render_template('index.html', state=current_setpoints, error=f"AI Error: {error_str}")

@app.route('/get_setpoints', methods=['GET'])
def get_setpoints():
    # The ESP32 calls this endpoint every 15 seconds
    return jsonify(current_setpoints), 200

@app.route('/api/state', methods=['GET'])
def get_state():
    # Endpoint for dynamic AJAX updates in the web UI
    return jsonify(current_setpoints), 200

if __name__ == '__main__':
    # host='0.0.0.0' allows devices on the network to access the server
    app.run(host='0.0.0.0', port=5000, debug=True)
