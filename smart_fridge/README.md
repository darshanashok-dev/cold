# Smart Storage AI: Cloud-Edge Thermo-regulation Portal

A complete modern IoT system that combines cloud-based AI visual diagnostics with physical edge thermo-regulation. The system uses a mobile-first dashboard to analyze food freshness via the Gemini API, automatically calculates ideal thermostatic setpoints, and synchronizes them to an ESP32 micro-controller to drive a cooling relay based on environmental sensor readings.

---

## Key Features

* **Premium Glassmorphic Dashboard**: Mobile-optimized dark mode web portal featuring translucent backdrops, glowing status animations, and dynamic AI metric updates.
* **Gemini Vision Pipeline**: Automated produce identification (Apple, Banana, Tomato, etc.), freshness rating, decay index calculation, and shelf-life estimation.
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
cd /home/da/cold/smart_fridge
pip install flask google-generativeai pillow python-dotenv
```

### 2. Configure Your API Keys (Optional)
Copy or create a `.env` file in the project root:
```env
GEMINI_API_KEY=your_actual_api_key_here
```
*Note: If no API key is specified, the server will automatically fallback to **Mock Mode** using simulated diagnostic data so you can test all features.*

### 3. Run the Flask Server
Launch the local web server:
```bash
python app.py
```
* Access local dashboard at: `http://localhost:5000/`
* Access API state at: `http://localhost:5000/api/state`

---

## ESP32 Setup & Deployment

1. Install **Arduino IDE** and configure the board support package for **ESP32**.
2. Go to **Tools > Manage Libraries** and install the following:
   * **`DHT sensor library`** by Adafruit (click *Install All* to automatically include dependency *Adafruit Unified Sensor*).
   * **`Adafruit SSD1306`** by Adafruit (click *Install All* to automatically include dependency *Adafruit GFX*).
   * **`ArduinoJson`** (v6 or v7) by Benoit Blanchon.
3. Open `smart_fridge.ino` in Arduino IDE.
4. Update configuration details:
   * **WiFi SSID & Password** (Lines 10-11)
   * **Flask Server Target IP** (Line 15) using your computer's local IP address.
5. Upload the code to your ESP32 board.
