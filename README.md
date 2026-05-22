# Smart Storage AI: Cloud-Edge Thermo-regulation Portal

A complete modern IoT system that combines cloud-based AI visual diagnostics with physical edge thermo-regulation. The system uses a mobile-first dashboard to analyze food freshness via the Gemini API, automatically calculates ideal thermostatic setpoints, and synchronizes them to an ESP32 micro-controller to drive a cooling relay based on environmental sensor readings.

---

## Key Features

* **Premium Glassmorphic Dashboard**: Mobile-optimized dark mode web portal featuring translucent backdrops, glowing status animations, and dynamic AI metric updates.
* **Live Webcam Viewfinder & Scanner**: Switch between file uploads and a live camera viewfinder. Capture and upload frames instantly over the network.
* **On-Screen Bounding Box**: Displays classification overlays directly on the camera viewport upon detection.
* **PWA Capability**: Fully configured with `manifest.json` and mobile meta tags. Install the dashboard directly on Android, iOS, or Desktop home screens as a native application.
* **Raw Stream & Form Support**: The `/detect` route supports standard multi-part form submissions and raw octet-stream POSTs for low-latency hardware snapshots.
* **Gemini Vision Pipeline**: Automated produce identification (Apple, Banana, Tomato, Orange), freshness rating, decay index calculation, and shelf-life estimation.
* **SQLite Telemetry Database**: Log all telemetry records and AI scan logs for trend analysis, rendered locally using custom Chart.js graphs.
* **Mock Diagnostics Mode**: Fallback system that runs automatically if a Gemini API Key is missing, enabling complete testing and local developer workflows without active cloud bills.
* **Hysteresis Cooling Loop**: Safe edge logic running on the ESP32 that initiates cooling when temperature exceeds boundaries, shutting down when optimal temperatures are restored.

---

## Hardware Requirements & Pin Out

To build the physical edge-device controller, connect your sensors to the ESP32 according to this layout:

| Component | ESP32 Pin | Notes |
| :--- | :--- | :--- |
| **DHT22 (Temp/Hum)** | `GPIO 4` | Connect a 10kΩ pull-up resistor between VCC and Data if not using a breakout board. |
| **Relay Actuator** | `GPIO 16` | Triggers the cooling fan/refrigeration compressor. |
| **SSD1306 OLED (SDA)** | `GPIO 21` | Standard I2C Data line. |
| **SSD1306 OLED (SCL)** | `GPIO 22` | Standard I2C Clock line. |

---

## Quick Start Guide

### 1. Python Environment Setup
Install dependencies in your terminal:
```bash
cd smart_fridge
pip install -r requirements.txt
```
*Dependencies include `flask`, `google-generativeai`, `pillow`, `python-dotenv`, `cryptography`, and `pyopenssl` (required for ad-hoc SSL support).*

### 2. Configure Your Environment Toggles
Copy or create a `.env` file in the `smart_fridge` directory:
```env
GEMINI_API_KEY=your_actual_api_key_here
USE_HTTPS=true
FLASK_DEBUG=true
```
*   `GEMINI_API_KEY`: If blank or missing, the server operates in **Mock Mode** using randomized produce metadata.
*   `USE_HTTPS`: Enables self-signed ad-hoc SSL certificates (required for live camera access on mobile devices).
*   `FLASK_DEBUG`: Toggles debug outputs and hot-reloads.

### 3. Run the Flask Server
Launch the local web server:
```bash
python app.py
```
* Access local dashboard at: `http://localhost:5000/` (or `https://localhost:5000/` if HTTPS is enabled)
* Access API state at: `http://localhost:5000/api/state`
* *Security Note*: Requests to `/detect` are rate-limited to **10 requests per minute per IP** to prevent API quota spamming.

> [!IMPORTANT]
> **Webcam Secure Contexts**: Modern browsers block webcam streaming via `getUserMedia` on plain HTTP unless the host is `127.0.0.1` or `localhost`. To stream camera frames from a physical phone on the same network, you **must** configure `USE_HTTPS=true` in your `.env` file, connect to `https://<your-laptop-ip>:5000/`, and bypass the self-signed certificate warning in your phone's browser.

---

## ESP32 Setup & Deployment

1. Install **Arduino IDE** and configure the board support package for **ESP32**.
2. Go to **Tools > Manage Libraries** and install the following:
   * **`DHT sensor library`** by Adafruit (click *Install All* to automatically include dependency *Adafruit Unified Sensor*).
   * **`Adafruit SSD1306`** by Adafruit (click *Install All* to automatically include dependency *Adafruit GFX*).
   * **`ArduinoJson`** (v6 or v7) by Benoit Blanchon.
3. Open `smart_fridge.ino` in Arduino IDE.
4. Update configuration details:
   * **WiFi SSID & Password** (Lines 12-13).
   * **Flask Server Base URL** (Line 17): Define `serverBaseUrl` using your computer's local IP address and protocol (e.g. `const char* serverBaseUrl = "https://192.168.1.100:5000";` or `http://...`).
5. Upload the code to your ESP32 board.
   * *Reliability Notes*: The firmware automatically configures SSL connection contexts if HTTPS is detected, sets an 8-second query timeout to prevent loop stalls, and initializes a 30-second hardware watchdog timer to handle connection dropouts gracefully. Warning: SSL uses `setInsecure()` to skip cert validation on local networks; do not run this bypass on public networks.
