#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include <DHT.h>
#include <Wire.h>
#include <Adafruit_SSD1306.h>
#include <esp_task_wdt.h>

// --- Wi-Fi & SERVER CONFIGURATION ---
// IMPORTANT: Update these credentials to match your mobile hotspot/router
const char* ssid = "YOUR_HOTSPOT_NAME";
const char* password = "YOUR_HOTSPOT_PASSWORD";

// REPLACE with your laptop's actual IP and protocol (supports http and https)
// Example: "https://192.168.1.100:5000/get_setpoints"
const char* serverUrl = "http://192.168.1.XXX:5000/get_setpoints";

// --- PIN DEFINITIONS ---
#define DHT_PIN 4        // DHT22 Data Pin
#define RELAY_PIN 16     // Relays/Cooling Control Pin
#define OLED_SDA 21      // OLED SDA Pin
#define OLED_SCL 22      // OLED SCL Pin

// --- HARDWARE INITIALIZATION ---
DHT dht(DHT_PIN, DHT22);
Adafruit_SSD1306 display(128, 64, &Wire, -1);

// --- WATCHDOG CONFIGURATION ---
#define WDT_TIMEOUT_SECONDS 30 // Reset board if loop hangs for 30s

// --- THERMODYNAMICS VARIABLES ---
float currentTemp = 0.0;
float currentHum = 0.0;
float target_low = 12.0;    // Safe baseline defaults
float target_high = 14.0;
String currentFruit = "Booting...";
bool isCooling = false;
bool displayEnabled = true; // Set to false dynamically if OLED is not detected

// --- NETWORK TIMER ---
unsigned long lastNetworkCheck = 0;
const unsigned long networkDelay = 15000; // Poll server and post telemetry every 15 seconds

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("Smart Fridge Controller Initializing...");

  // Initialize hardware watchdog timer
  Serial.println("Configuring hardware Watchdog Timer...");
  esp_task_wdt_init(WDT_TIMEOUT_SECONDS, true); // true = panic and reset ESP32 on timeout
  esp_task_wdt_add(NULL); // add main loop task to WDT monitoring

  // Relay initialization
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, LOW); // Start with cooling OFF

  // Sensor and I2C setup
  dht.begin();
  Wire.begin(OLED_SDA, OLED_SCL);

  // OLED Display Setup
  if(!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) { 
    Serial.println(F("SSD1306 allocation failed. Proceeding WITHOUT display."));
    displayEnabled = false;
  }
  
  if (displayEnabled) {
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
  }

  // Connect to Wi-Fi with timeout limit to avoid blocking startup
  WiFi.begin(ssid, password);
  int attemptCount = 0;
  const int maxAttempts = 20; // 10 seconds timeout limit
  
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED && attemptCount < maxAttempts) {
    delay(500);
    Serial.print(".");
    esp_task_wdt_reset(); // Feed watchdog during startup wait
    attemptCount++;
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi Connected successfully!");
    Serial.print("ESP32 IP: ");
    Serial.println(WiFi.localIP());

    if (displayEnabled) {
      display.clearDisplay();
      display.setCursor(0,0);
      display.println("WiFi Connected!");
      display.print("IP: ");
      display.println(WiFi.localIP().toString());
      display.display();
    }
    currentFruit = "Awaiting Sync...";
  } else {
    Serial.println("\nWiFi Connection Failed! Booting in Standalone Mode.");
    if (displayEnabled) {
      display.clearDisplay();
      display.setCursor(0,0);
      display.println("WiFi Failed!");
      display.println("Running in");
      display.println("Standalone Mode");
      display.display();
    }
    currentFruit = "Standalone Mode";
  }
  
  delay(2000);
  esp_task_wdt_reset(); // Final setup feed
}

void loop() {
  // Feed the hardware watchdog timer
  esp_task_wdt_reset();

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

  // 1. NETWORK POLL & TELEMETRY: Sync setpoints and upload local readings
  if ((millis() - lastNetworkCheck) > networkDelay || lastNetworkCheck == 0) {
    if (WiFi.status() == WL_CONNECTED) {
      WiFiClientSecure *secureClient = nullptr;
      
      // Determine connection method (HTTPS vs HTTP)
      bool isHttps = String(serverUrl).startsWith("https://");
      if (isHttps) {
        secureClient = new WiFiClientSecure;
        if (secureClient) {
          secureClient->setInsecure(); // Skip certificate verification for adhoc/self-signed cert
        }
      }
      
      // --- GET: Fetch setpoints ---
      HTTPClient http;
      bool getSuccess = false;
      
      if (isHttps && secureClient) {
        getSuccess = http.begin(*secureClient, serverUrl);
      } else {
        getSuccess = http.begin(serverUrl);
      }
      
      if (getSuccess) {
        int httpCode = http.GET();
        if (httpCode == 200) {
          String payload = http.getString();
          
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
            Serial.println("Sync Setpoints: " + currentFruit + " | Targets: " + String(target_low) + " to " + String(target_high));
          } else {
            Serial.print("JSON Deserialization failed: ");
            Serial.println(error.c_str());
          }
        } else {
          Serial.println("HTTP GET Error code: " + String(httpCode));
        }
        http.end();
      } else {
        Serial.println("HTTP GET Connection failed.");
      }
      
      // --- POST: Send telemetry back to server ---
      String telemetryUrl = String(serverUrl);
      telemetryUrl.replace("/get_setpoints", "/api/telemetry");
      
      HTTPClient httpPost;
      bool postSuccess = false;
      
      if (isHttps && secureClient) {
        postSuccess = httpPost.begin(*secureClient, telemetryUrl);
      } else {
        postSuccess = httpPost.begin(telemetryUrl);
      }
      
      if (postSuccess) {
        httpPost.addHeader("Content-Type", "application/json");
        
        #if ARDUINOJSON_VERSION_MAJOR >= 7
          JsonDocument postDoc;
        #else
          StaticJsonDocument<128> postDoc;
        #endif
        postDoc["temperature"] = currentTemp;
        postDoc["humidity"] = currentHum;
        postDoc["is_cooling"] = isCooling ? 1 : 0;
        
        String requestBody;
        serializeJson(postDoc, requestBody);
        
        int postCode = httpPost.POST(requestBody);
        if (postCode > 0) {
          Serial.println("Telemetry uploaded. Response status: " + String(postCode));
        } else {
          Serial.println("Telemetry upload failed error: " + httpPost.errorToString(postCode));
        }
        httpPost.end();
      } else {
        Serial.println("HTTP POST Connection failed.");
      }
      
      // Cleanup secure client if allocated
      if (secureClient) {
        delete secureClient;
      }
    } else {
      // WiFi disconnected: attempt non-blocking reconnect
      Serial.println("WiFi connection lost! Attempting to reconnect...");
      WiFi.disconnect();
      WiFi.begin(ssid, password);
      
      int reconnectAttempts = 0;
      const int maxReconnectAttempts = 10; // Wait 5 seconds max
      while (WiFi.status() != WL_CONNECTED && reconnectAttempts < maxReconnectAttempts) {
        delay(500);
        Serial.print(".");
        esp_task_wdt_reset(); // Feed WDT during reconnection wait
        reconnectAttempts++;
      }
      
      if (WiFi.status() == WL_CONNECTED) {
        Serial.println("\nWiFi Reconnected successfully!");
      } else {
        Serial.println("\nWiFi Reconnection failed. Running in Standalone Mode for this cycle.");
      }
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
  if (displayEnabled) {
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
  }

  // Loop processing interval
  delay(2000); 
}
