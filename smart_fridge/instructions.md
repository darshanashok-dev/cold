# Smart Fridge AI: Next Steps & Setup Instructions

This guide outlines the steps to deploy the Flask backend and connect the ESP32 micro-controller to complete your Edge-to-Cloud AI Vision Diagnostics pipeline.

---

## Step 1: Environment Setup

Ensure you have Python installed, then set up the required dependencies.

```bash
# Navigate to project folder
cd smart_fridge

# Install Python requirements
pip install flask google-generativeai pillow python-dotenv
```

---

## Step 2: Configure Gemini API Key

You can run the portal in **Mock Mode** automatically if you do not have an API key. To connect to the real Gemini AI:

1. Open the `.env` file at `smart_fridge/.env`.
2. Replace `YOUR_GEMINI_API_KEY_HERE` with your actual Gemini API Key:
   ```env
   GEMINI_API_KEY=AIzaSy...
   ```
3. Save the file. The Flask server will reload automatically.

---

## Step 3: Run the Flask Backend

Start the local server so it is accessible from your network:

```bash
python app.py
```
- **Local Access**: Open [http://localhost:5000/](http://localhost:5000/) on your machine.
- **Network Access**: Open `http://<your-laptop-ip>:5000/` from any mobile device or device on the same local network/Wi-Fi hotspot.

---

## Step 4: Configure & Flash ESP32 Firmware

Open [smart_fridge.ino](file:///home/da/cold/smart_fridge/smart_fridge.ino) in the Arduino IDE and make the following configuration changes:

1. **Set Wi-Fi Credentials** (Lines 10-11):
   Update the SSID and password to match your router or mobile hotspot:
   ```cpp
   const char* ssid = "YOUR_HOTSPOT_NAME";
   const char* password = "YOUR_HOTSPOT_PASSWORD";
   ```
2. **Configure Flask Server URL** (Line 15):
   Replace `192.168.1.XXX` with your laptop's actual IPv4 address (e.g. found using `ipconfig` on Windows or `ifconfig` / `ip a` on Linux):
   ```cpp
   const char* serverUrl = "http://192.168.x.x:5000/get_setpoints";
   ```
3. **Install Arduino Libraries**:
   Go to **Tools > Manage Libraries** in Arduino IDE and install the following libraries (including all their suggested dependencies):
   - `DHT sensor library` by Adafruit (Click "Install All" when prompted to automatically install `Adafruit Unified Sensor`)
   - `Adafruit SSD1306` by Adafruit (Click "Install All" when prompted to automatically install `Adafruit GFX Library`)
   - `ArduinoJson` (v6 or v7) by Benoit Blanchon
4. **Flash to board**: Connect your ESP32 via USB, select your board and port, and click **Upload**.

---

## Step 5: Hardware Connection Diagram

Set up your physical sensors and outputs on the ESP32 according to these pin definitions:

| Component | Pin (ESP32) | Notes |
| :--- | :--- | :--- |
| **DHT22 (Temp & Hum)** | `Pin 4` | Connect a 10k pull-up resistor between VCC and Data if not using a breakout module |
| **Relay Module** | `Pin 16` | Triggers the cooling actuator |
| **SSD1306 OLED (SDA)** | `Pin 21` | I2C Serial Data line |
| **SSD1306 OLED (SCL)** | `Pin 22` | I2C Serial Clock line |

---

## Step 6: Complete End-to-End Test

1. Power on the ESP32 with sensors connected. Verify on the OLED display or Arduino Serial Monitor that it connects to Wi-Fi.
2. Open the web interface at `http://<your-laptop-ip>:5000/`.
3. Upload an image of produce (e.g., Apple or Banana) and click **Analyze with Gemini AI**.
4. Once the diagnosis is processed:
   - The web UI will show updated Target Temperatures.
   - The ESP32 will fetch these setpoints on its next poll (every 15s).
   - The OLED display will update to show the currently active fruit and temperature range.
   - The cooling status on the ESP32 will switch to `COOLING (ON)` if the ambient sensor temperature is higher than the target limit.
