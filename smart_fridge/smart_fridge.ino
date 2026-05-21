#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <DHT.h>
#include <Wire.h>
#include <Adafruit_SSD1306.h>

// --- Wi-Fi & SERVER CONFIGURATION ---
// IMPORTANT: Update these credentials to match your mobile hotspot/router
const char* ssid = "YOUR_HOTSPOT_NAME";
const char* password = "YOUR_HOTSPOT_PASSWORD";

// REPLACE with your laptop's actual IPv4 address on the hotspot network
// Example: "http://192.168.43.100:5000/get_setpoints"
const char* serverUrl = "http://192.168.1.XXX:5000/get_setpoints";

// --- PIN DEFINITIONS ---
#define DHT_PIN 4        // DHT22 Data Pin
#define RELAY_PIN 16     // Relays/Cooling Control Pin
#define OLED_SDA 21      // OLED SDA Pin
#define OLED_SCL 22      // OLED SCL Pin

// --- HARDWARE INITIALIZATION ---
DHT dht(DHT_PIN, DHT22);
Adafruit_SSD1306 display(128, 64, &Wire, -1);

// --- THERMODYNAMICS VARIABLES ---
float currentTemp = 0.0;
float currentHum = 0.0;
float target_low = 12.0;    // Safe baseline defaults
float target_high = 14.0;
String currentFruit = "Booting...";
bool isCooling = false;

// --- NETWORK TIMER ---
unsigned long lastNetworkCheck = 0;
const unsigned long networkDelay = 15000; // Poll server every 15 seconds

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("Smart Fridge Controller Initializing...");

  // Relay initialization
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, LOW); // Start with cooling OFF

  // Sensor and I2C setup
  dht.begin();
  Wire.begin(OLED_SDA, OLED_SCL);

  // OLED Display Setup
  if(!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) { 
    Serial.println(F("SSD1306 allocation failed"));
    for(;;); // Don't proceed, loop forever
  }
  
  display.clearDisplay();
  display.setTextColor(WHITE);
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.println("Smart Fridge AI");
  display.println("Connecting WiFi...");
  display.println("");
  display.print("SSID: ");
  display.println(ssid);
  display.display();

  // Connect to Wi-Fi
  WiFi.begin(ssid, password);
  int attemptCount = 0;
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
    attemptCount++;
    if (attemptCount % 20 == 0) {
      Serial.println("\nStill trying to connect...");
    }
  }
  
  Serial.println("\nWiFi Connected!");
  Serial.print("ESP32 IP: ");
  Serial.println(WiFi.localIP());

  display.clearDisplay();
  display.setCursor(0,0);
  display.println("WiFi Connected!");
  display.print("IP: ");
  display.println(WiFi.localIP().toString());
  display.display();
  delay(2000);
}

void loop() {
  // Read local environmental sensors
  float rawTemp = dht.readTemperature();
  float rawHum = dht.readHumidity();

  // Validate readings to avoid system failures on sensor disconnects
  if (!isnan(rawTemp)) {
    currentTemp = rawTemp;
  } else {
    Serial.println("WARNING: Failed to read temperature from DHT sensor!");
  }

  if (!isnan(rawHum)) {
    currentHum = rawHum;
  } else {
    Serial.println("WARNING: Failed to read humidity from DHT sensor!");
  }

  // 1. NETWORK POLL: Fetch cloud setpoints every 15 seconds
  if ((millis() - lastNetworkCheck) > networkDelay || lastNetworkCheck == 0) {
    if (WiFi.status() == WL_CONNECTED) {
      HTTPClient http;
      http.begin(serverUrl);
      
      int httpCode = http.GET();
      if (httpCode == 200) {
        String payload = http.getString();
        
        // Dynamic / Static Json Document handling
        // ArduinoJson V6 & V7 Compatibility:
        #if ARDUINOJSON_VERSION_MAJOR >= 7
          JsonDocument doc;
        #else
          StaticJsonDocument<256> doc;
        #endif

        DeserializationError error = deserializeJson(doc, payload);
        if (!error) {
          target_low = doc["target_low"] | 12.0;
          target_high = doc["target_high"] | 14.0;
          const char* fruit = doc["fruit"] | "Unknown";
          currentFruit = String(fruit);
          Serial.println("Sync: " + currentFruit + " | Targets: " + String(target_low) + " to " + String(target_high));
        } else {
          Serial.print("JSON Deserialization failed: ");
          Serial.println(error.c_str());
        }
      } else {
        Serial.println("HTTP Error: " + String(httpCode));
      }
      http.end();
    } else {
      Serial.println("WiFi disconnected! Attempting reconnect...");
      WiFi.disconnect();
      WiFi.begin(ssid, password);
    }
    lastNetworkCheck = millis();
  }

  // 2. HYSTERESIS LOGIC (Thermodynamics control)
  // Cool down when current temperature exceeds the target upper limit + safety margin
  if (currentTemp > target_high + 1.0) {
    digitalWrite(RELAY_PIN, HIGH);
    isCooling = true;
  } 
  // Stop cooling when current temperature drops below the target lower limit - safety margin
  else if (currentTemp < target_low - 1.0) {
    digitalWrite(RELAY_PIN, LOW);
    isCooling = false;
  }

  // 3. OLED UPDATE
  display.clearDisplay();
  display.setCursor(0, 0);
  
  // Row 1: Active Fruit
  display.print("Fruit: ");
  display.println(currentFruit);
  
  // Row 2: Target Temperature Range
  display.print("Target: ");
  display.print(target_low, 1);
  display.print(" - ");
  display.print(target_high, 1);
  display.println(" C");
  
  display.println(); // Spacer

  // Row 3: Current Environment Data
  display.print("Temp: ");
  display.print(currentTemp, 1);
  display.println(" C");
  
  display.print("Hum: ");
  display.print(currentHum, 1);
  display.println(" %");
  
  display.println(); // Spacer

  // Row 4: Status Indicator
  display.print("Status: ");
  display.println(isCooling ? "COOLING (ON)" : "IDLE (OFF)");
  
  display.display();

  // Sensor read and processing delay
  delay(2000); 
}
