# Smart Fridge AI: Next Steps & Setup Instructions

This guide outlines the steps to deploy the Flask backend and connect the ESP32 micro-controller to complete your Edge-to-Cloud AI Vision Diagnostics pipeline.

---

## Step 1: Environment Setup

Ensure you have Python installed, then set up the required dependencies.

```bash
# Navigate to project folder
cd smart_fridge

# Install Python requirements (including cryptography & pyopenssl for secure ad-hoc SSL contexts)
pip install -r requirements.txt
```

---

## Step 2: Configure Environment & Toggles

Configure your environment settings inside `smart_fridge/.env`:

1. **Gemini API Key**: Replace the placeholder with your actual key to bypass mock simulated data:
   ```env
   GEMINI_API_KEY=AIzaSy...
   ```
2. **Secure HTTPS Toggle**: Enable ad-hoc SSL contexts. This is **mandatory** for browsers to allow remote camera (`getUserMedia`) access over a shared Wi-Fi network:
   ```env
   USE_HTTPS=true
   ```
3. **Debug Toggle**: Set Flask debug outputs:
   ```env
   FLASK_DEBUG=true
   ```

---

## Step 3: Run the Flask Backend

Start the local server so it is accessible from your network:

```bash
python app.py
```
- **Local Access**: Open [https://localhost:5000/](https://localhost:5000/) on your computer.
- **Local Network Access**: Open `https://<your-laptop-ip>:5000/` from your mobile phone.
- **PWA Installation**: Tap the browser share/menu button on your mobile device and select **Add to Home Screen** to install the dashboard as a native standalone application.
- *Security Note*: Requests to `/detect` are rate-limited to **10 requests per minute per IP** to protect Gemini API quotas.

> [!WARNING]
> **SSL Certificate Warning**: Because the Flask server generates self-signed certificates on the fly, your browser will display a safety warning when loading the page over HTTPS on your local network. You must click **Advanced** -> **Proceed to website** to continue. Once proceeded, the browser grants the site full access to the webcam secure context.

---

## Step 4: Configure & Flash ESP32 Firmware

Open [smart_fridge.ino](file:///home/da/cold/smart_fridge/smart_fridge.ino) in the Arduino IDE and make the following configuration changes:

1. **Set Wi-Fi Credentials** (Lines 12-13):
   Update the SSID and password to match your router or mobile hotspot:
   ```cpp
   const char* ssid = "YOUR_HOTSPOT_NAME";
   const char* password = "YOUR_HOTSPOT_PASSWORD";
   ```
2. **Configure Flask Server Base URL** (Line 17):
   Replace `192.168.1.XXX` with your laptop's actual IPv4 address and select the protocol. The microcontroller will dynamically append `/get_setpoints` and `/api/telemetry` endpoints:
   ```cpp
   const char* serverBaseUrl = "https://192.168.x.x:5000";
   ```
3. **Install Arduino Libraries**:
   Go to **Tools > Manage Libraries** in Arduino IDE and install the following libraries (including all their suggested dependencies):
   - `DHT sensor library` by Adafruit (Click "Install All" to automatically install `Adafruit Unified Sensor`)
   - `Adafruit SSD1306` by Adafruit (Click "Install All" to automatically install `Adafruit GFX Library`)
   - `ArduinoJson` (v6 or v7) by Benoit Blanchon
4. **Flash to board**: Connect your ESP32 via USB, select your board and port, and click **Upload**.
   - *Reliability Options*: The code configures SSL client security if HTTPS is defined, applies a 8-second HTTP timeout to prevent task blocking, and sets a 30-second watchdog timer (WDT) to recover from crashes automatically. Warning: local SSL cert validation is skipped via `setInsecure()`; do not use on public networks.

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
2. Open the web interface at `https://<your-laptop-ip>:5000/` from your phone.
3. Switch to the **Live Camera** tab under **Analyze Produce**.
4. Tap **Start Feed** to open the viewfinder, align a fruit or vegetable inside the camera frame, and click **Capture & Scan**.
5. Once the diagnosis is processed:
   - The webpage will show the classification box overlaid on the viewfinder and update the target temperatures.
   - The ESP32 will fetch these setpoints on its next poll (every 15s) and display them on the OLED screen.
   - The cooling status on the ESP32 will switch to `COOLING (ON)` if the ambient sensor temperature is higher than the target limit.
   - The sensor telemetry trend history can be viewed in the **History** tab or plotted on the dashboard line graph in real-time.
