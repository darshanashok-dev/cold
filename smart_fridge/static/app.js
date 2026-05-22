// Handle custom upload zone interactions
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const previewContainer = document.getElementById('preview-container');
const previewImg = document.getElementById('preview-img');
const uploadPrompt = document.getElementById('upload-prompt');
const submitBtn = document.getElementById('submit-btn');
const form = document.getElementById('upload-form');
const loaderOverlay = document.getElementById('loader-overlay');
const loaderText = document.getElementById('loader-text');

// Chart instance
let historyChart = null;
let lastSyncSeconds = null;
let lastSyncTimestamp = null;

// Loader phrases
const loaderPhrases = [
    "Peering into the storage box...",
    "Invoking Gemini AI Vision...",
    "Identifying fruit parameters...",
    "Estimating freshness indexes...",
    "Updating thermostatic target boundaries..."
];

// Dark/Light Mode toggle handler
const themeToggleBtn = document.getElementById('theme-toggle');
if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', () => {
        document.body.classList.toggle('light-mode');
        const isLight = document.body.classList.contains('light-mode');
        localStorage.setItem('theme', isLight ? 'light' : 'dark');
        updateChartTheme();
        
        // Update theme toggle icon
        const icon = themeToggleBtn.querySelector('i');
        if (icon) {
            icon.className = isLight ? 'ti ti-moon' : 'ti ti-sun';
        }
    });
}

// Apply stored theme on load
const savedTheme = localStorage.getItem('theme');
if (savedTheme === 'light') {
    document.body.classList.add('light-mode');
    const icon = themeToggleBtn ? themeToggleBtn.querySelector('i') : null;
    if (icon) icon.className = 'ti ti-moon';
} else {
    document.body.classList.remove('light-mode');
    const icon = themeToggleBtn ? themeToggleBtn.querySelector('i') : null;
    if (icon) icon.className = 'ti ti-sun';
}

// Drag and drop events
if (dropZone) {
    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            dropZone.style.borderColor = 'var(--accent-primary)';
            dropZone.style.background = 'rgba(99, 102, 241, 0.08)';
        }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            dropZone.style.borderColor = 'var(--border-color)';
            dropZone.style.background = 'rgba(255, 255, 255, 0.01)';
        }, false);
    });

    dropZone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        if (files.length > 0) {
            fileInput.files = files;
            handleFileSelect(fileInput);
        }
    }, false);
}

// Preview rendering on image selection
window.handleFileSelect = function(input) {
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = function(e) {
            previewImg.src = e.target.result;
            uploadPrompt.style.display = 'none';
            previewContainer.style.display = 'block';
            submitBtn.disabled = false;
        };
        reader.readAsDataURL(input.files[0]);
    }
}

// Reset file selection
window.resetFileSelection = function(event) {
    if (event && event.stopPropagation) {
        event.stopPropagation(); // Avoid triggering file input click
    }
    fileInput.value = '';
    previewImg.src = '';
    previewContainer.style.display = 'none';
    uploadPrompt.style.display = 'flex';
    submitBtn.disabled = true;
}

// Form Submit interception for seamless AJAX upload
if (form) {
    form.addEventListener('submit', function(e) {
        e.preventDefault();
        
        // Show Loader and start text cycle
        loaderOverlay.style.display = 'flex';
        let phraseIndex = 0;
        loaderText.innerText = loaderPhrases[0];
        const textInterval = setInterval(() => {
            phraseIndex = (phraseIndex + 1) % loaderPhrases.length;
            loaderText.innerText = loaderPhrases[phraseIndex];
        }, 1800);

        // Construct FormData
        const formData = new FormData(form);

        // Send via fetch
        fetch('/detect', {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'X-Requested-With': 'XMLHttpRequest'
            },
            body: formData
        })
        .then(response => {
            if (!response.ok) {
                return response.json().then(err => { throw new Error(err.error || 'Server error') });
            }
            return response.json();
        })
        .then(data => {
            // Update UI state
            updateUIState(data);
            showToast("System State Updated Successfully!");
            resetFileSelection();
            fetchHistory(); // Redraw chart
            if (document.getElementById('panel-history').style.display === 'block') {
                fetchHistoryList();
            }
        })
        .catch(error => {
            console.error("Upload failed: ", error);
            showToast(error.message || "Failed to analyze image.", true);
        })
        .finally(() => {
            clearInterval(textInterval);
            loaderOverlay.style.display = 'none';
        });
    });
}

// Update dashboard elements dynamically
function updateUIState(state) {
    // Fruit name
    const produceNameEl = document.getElementById('produce-name');
    if (produceNameEl) {
        produceNameEl.innerText = state.fruit;
    }
    
    // Freshness badge
    const freshnessEl = document.getElementById('freshness-badge');
    if (freshnessEl) {
        freshnessEl.innerText = state.freshness;
        freshnessEl.className = 'sf-badge ' + (state.freshness.toLowerCase() === 'fresh' ? 'fresh-badge' : 'warn-badge');
    }

    // Confidence
    const confidenceVal = document.getElementById('confidence-val');
    if (confidenceVal) {
        confidenceVal.innerText = state.confidence ? `${state.confidence.toFixed(1)}%` : '0.0%';
    }

    // Decay Index
    const decayVal = document.getElementById('decay-val');
    if (decayVal) {
        decayVal.innerText = state.decay_index !== undefined ? `${state.decay_index.toFixed(1)}%` : '0.0%';
    }

    // Shelf Life
    const shelfVal = document.getElementById('shelf-val');
    if (shelfVal) {
        shelfVal.innerText = state.days_remaining ? `${state.days_remaining} days` : '0 days';
    }

    // Reasoning
    const reasoningText = document.getElementById('reasoning-text');
    if (reasoningText) {
        reasoningText.innerText = state.ai_reasoning;
    }

    // Temp range label
    const tempRangeEl = document.getElementById('temp-range');
    if (tempRangeEl) {
        tempRangeEl.innerText = `${state.target_low.toFixed(1)} \u2013 ${state.target_high.toFixed(1)}°C`;
    }

    // Temp Fill Slider Gauge (0 - 30 scale)
    const tempFill = document.getElementById('temp-fill');
    if (tempFill) {
        const low = state.target_low;
        const high = state.target_high;
        const leftPct = Math.max(0, Math.min(100, (low / 30.0) * 100.0));
        const widthPct = Math.max(1, Math.min(100, ((high - low) / 30.0) * 100.0));
        tempFill.style.left = `${leftPct}%`;
        tempFill.style.width = `${widthPct}%`;
    }

    // Operation mode badge
    const modeBadge = document.getElementById('mode-badge');
    if (modeBadge) {
        modeBadge.innerText = state.use_mock_mode ? "Mock mode" : "Cloud mode";
    }

    // Dynamic Telemetry Values Grid (Current Temp, Humidity, Cooling State)
    if (state.telemetry) {
        const curTempEl = document.getElementById('cur-temp');
        const curHumEl = document.getElementById('cur-hum');
        const coolingDot = document.getElementById('cooling-dot');
        const coolingStatus = document.getElementById('cooling-status');
        const pulseDot = document.getElementById('sync-pulse');
        const syncDesc = document.getElementById('sync-desc');
        const espIp = document.getElementById('esp-ip');
        const espConnectionBadge = document.getElementById('esp-connection-badge');
        const espRelayState = document.getElementById('esp-relay-state');

        // Render current temperature and humidity
        if (curTempEl) curTempEl.innerText = state.telemetry.temperature ? `${state.telemetry.temperature.toFixed(1)}°C` : '--°C';
        if (curHumEl) curHumEl.innerText = state.telemetry.humidity ? `${state.telemetry.humidity.toFixed(0)}%` : '--%';
        
        // ESP32 dynamic IP display
        if (espIp) {
            espIp.innerText = state.telemetry.ip ? `${state.telemetry.ip} &middot; port 5000` : "Awaiting sync...";
            espIp.style.display = 'block';
        }

        // Connection badge and sync timer setup
        if (state.telemetry.timestamp) {
            if (pulseDot) pulseDot.classList.remove('offline');
            if (syncDesc) syncDesc.innerText = `ESP32 synced &middot; ${state.telemetry.timestamp.split(' ')[1] || state.telemetry.timestamp}`;
            if (espConnectionBadge) {
                espConnectionBadge.innerText = "Connected";
                espConnectionBadge.className = "sf-badge fresh-badge";
            }

            // Sync elapsed seconds timer tracking
            if (lastSyncTimestamp !== state.telemetry.timestamp) {
                lastSyncTimestamp = state.telemetry.timestamp;
                lastSyncSeconds = 0;
                document.getElementById('last-sync').innerText = "0s ago";
            }
        } else {
            if (pulseDot) pulseDot.classList.add('offline');
            if (syncDesc) syncDesc.innerText = "ESP32 offline or awaiting sync...";
            if (espConnectionBadge) {
                espConnectionBadge.innerText = "Offline";
                espConnectionBadge.className = "sf-badge warn-badge";
            }
            document.getElementById('last-sync').innerText = "--";
        }

        // Relay cooling state explanation
        if (espRelayState) {
            if (state.telemetry.timestamp) {
                espRelayState.innerText = state.telemetry.is_cooling ? "COOLING" : "IDLE";
                espRelayState.style.color = state.telemetry.is_cooling ? "var(--cold-blue)" : "var(--fresh-green)";
            } else {
                espRelayState.innerText = "OFFLINE";
                espRelayState.style.color = "var(--text-muted)";
            }
        }

        if (coolingDot && coolingStatus) {
            if (state.telemetry.timestamp) {
                if (state.telemetry.is_cooling) {
                    coolingDot.style.background = 'var(--cold-blue)';
                    coolingDot.style.boxShadow = '0 0 8px var(--cold-blue)';
                    coolingStatus.innerHTML = 'Cooling active &middot; relay ON';
                } else {
                    coolingDot.style.background = 'var(--fresh-green)';
                    coolingDot.style.boxShadow = '0 0 8px var(--fresh-green)';
                    coolingStatus.innerHTML = 'Within target range &middot; relay idle';
                }
            } else {
                coolingDot.style.background = 'var(--text-muted)';
                coolingDot.style.boxShadow = 'none';
                coolingStatus.innerHTML = 'No active connection to controller.';
            }
        }
    }
}

// Show Toast Notifications
function showToast(message, isError = false) {
    const toast = document.getElementById('toast');
    if (toast) {
        toast.innerText = message;
        
        if (isError) {
            toast.classList.add('error');
        } else {
            toast.classList.remove('error');
        }
        
        toast.classList.add('show');
        setTimeout(() => {
            toast.classList.remove('show');
        }, 4000);
    }
}

// Fetch live state
function fetchState() {
    fetch('/api/state')
        .then(response => response.json())
        .then(data => {
            updateUIState(data);
        })
        .catch(err => console.error("Error polling state:", err));
}

// Fetch database telemetry history to draw chart
function fetchHistory() {
    fetch('/api/history?limit=15')
        .then(response => response.json())
        .then(data => {
            if (data.telemetry && data.telemetry.length > 0) {
                drawHistoryChart(data.telemetry);
            }
        })
        .catch(err => console.error("Error fetching history:", err));
}

// Switch tabs handler
window.switchTab = function(tab) {
    const panelDiag = document.getElementById('panel-diagnostics');
    const panelHist = document.getElementById('panel-history');
    const tabDiag = document.getElementById('tab-diagnostics');
    const tabHist = document.getElementById('tab-history');
    
    if (tab === 'diagnostics') {
        panelDiag.style.display = 'block';
        panelHist.style.display = 'none';
        tabDiag.classList.add('active');
        tabHist.classList.remove('active');
    } else {
        panelDiag.style.display = 'none';
        panelHist.style.display = 'block';
        tabDiag.classList.remove('active');
        tabHist.classList.add('active');
        fetchHistoryList();
    }
}

// Populate History Panel scan results list
function fetchHistoryList() {
    const listContainer = document.getElementById('history-list');
    if (!listContainer) return;
    
    fetch('/api/history?limit=10')
        .then(response => response.json())
        .then(data => {
            if (!data.scans || data.scans.length === 0) {
                listContainer.innerHTML = `<div style="text-align: center; color: var(--text-muted); font-size: 13px; padding: 20px 0;">No scan history recorded yet.</div>`;
                return;
            }
            
            listContainer.innerHTML = data.scans.map(scan => {
                const dateObj = new Date(scan.timestamp);
                const formattedTime = dateObj.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
                const formattedDate = dateObj.toLocaleDateString([], {month: 'short', day: 'numeric'});
                const badgeClass = scan.freshness.toLowerCase() === 'fresh' ? 'fresh-badge' : 'warn-badge';
                const lowVal = (scan.target_low !== undefined && scan.target_low !== null) ? Number(scan.target_low).toFixed(1) : '0.0';
                const highVal = (scan.target_high !== undefined && scan.target_high !== null) ? Number(scan.target_high).toFixed(1) : '0.0';
                
                return `
                    <div class="sf-history-item">
                        <div>
                            <div class="sf-history-name">${escapeHTML(scan.fruit)} <span class="sf-badge ${badgeClass}" style="margin-left: 6px;">${escapeHTML(scan.freshness)}</span></div>
                            <div class="sf-history-time">${formattedDate} &middot; ${formattedTime}</div>
                        </div>
                        <div style="font-size: 12px; font-family: var(--font-mono); color: var(--color-text-secondary);">${lowVal}&ndash;${highVal}&deg;C</div>
                    </div>
                `;
            }).join('');
        })
        .catch(err => {
            listContainer.innerHTML = `<div style="text-align: center; color: var(--danger-red); font-size: 13px; padding: 20px 0;">Failed to load history list.</div>`;
            console.error("Error loading scan history list:", err);
        });
}

function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, 
        tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
}

// Show help dialog modal helper
window.showHelpDialog = function() {
    showToast("To use humidity-aware setpoints, update loop() in smart_fridge.ino to adjust targets when humidity exceeds 70%.");
}

// Draw line graph using Chart.js
function drawHistoryChart(telemetryData) {
    const ctx = document.getElementById('historyChart').getContext('2d');
    
    const labels = telemetryData.map(item => {
        const timePart = item.timestamp.split(' ');
        return timePart.length > 1 ? timePart[1] : item.timestamp;
    });
    
    const temps = telemetryData.map(item => item.temperature);
    const hums = telemetryData.map(item => item.humidity);
    
    const isLightMode = document.body.classList.contains('light-mode');
    const textMainColor = getComputedStyle(document.body).getPropertyValue('--text-main').trim();
    const borderValColor = getComputedStyle(document.body).getPropertyValue('--border-color').trim();

    if (historyChart) {
        historyChart.destroy();
    }
    
    historyChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Temp (°C)',
                    data: temps,
                    borderColor: '#fb923c', // warning orange
                    backgroundColor: 'rgba(251, 146, 60, 0.05)',
                    borderWidth: 2,
                    tension: 0.3,
                    yAxisID: 'yTemp',
                    pointRadius: 1
                },
                {
                    label: 'Humidity (%)',
                    data: hums,
                    borderColor: '#38bdf8', // cold blue
                    backgroundColor: 'rgba(56, 189, 248, 0.03)',
                    borderWidth: 2,
                    tension: 0.3,
                    yAxisID: 'yHum',
                    pointRadius: 1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    labels: {
                        color: textMainColor,
                        font: {
                            family: 'Plus Jakarta Sans',
                            size: 9,
                            weight: '600'
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: {
                        color: borderValColor
                    },
                    ticks: {
                        color: textMainColor,
                        font: {
                            size: 8
                        }
                    }
                },
                yTemp: {
                    type: 'linear',
                    position: 'left',
                    grid: {
                        drawOnChartArea: false
                    },
                    ticks: {
                        color: '#fb923c',
                        font: {
                            weight: 'bold',
                            size: 8
                        }
                    }
                },
                yHum: {
                    type: 'linear',
                    position: 'right',
                    grid: {
                        drawOnChartArea: false
                    },
                    ticks: {
                        color: '#38bdf8',
                        font: {
                            weight: 'bold',
                            size: 8
                        }
                    }
                }
            }
        }
    });
}

function updateChartTheme() {
    if (historyChart) {
        const textMainColor = getComputedStyle(document.body).getPropertyValue('--text-main').trim();
        const borderValColor = getComputedStyle(document.body).getPropertyValue('--border-color').trim();
        
        historyChart.options.plugins.legend.labels.color = textMainColor;
        historyChart.options.scales.x.grid.color = borderValColor;
        historyChart.options.scales.x.ticks.color = textMainColor;
        historyChart.update();
    }
}

// Periodic polling
function startStatePolling() {
    // Initial fetch
    fetchState();
    fetchHistory();
    
    // Poll state every 3 seconds
    setInterval(() => {
        if (loaderOverlay && loaderOverlay.style.display === 'flex') return;
        fetchState();
    }, 3000);
    
    // Poll history every 15 seconds (matching the ESP32 update rate)
    setInterval(() => {
        if (loaderOverlay && loaderOverlay.style.display === 'flex') return;
        fetchHistory();
    }, 15000);

    // Increment sync elapsed timer every second
    setInterval(() => {
        if (lastSyncSeconds !== null) {
            lastSyncSeconds++;
            document.getElementById('last-sync').innerText = lastSyncSeconds + 's ago';
        }
    }, 1000);
}

// Start polling on boot
startStatePolling();

// Webcam Feed Controls
let webcamStream = null;

window.startWebcam = async function() {
    const video = document.getElementById('webcam');
    const idle = document.getElementById('vf-idle');
    const captureBtn = document.getElementById('capture-webcam-btn');
    const startBtn = document.getElementById('start-webcam-btn');
    
    try {
        webcamStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment' }
        });
    } catch (err) {
        console.warn("No environmental camera found, fallback to defaults:", err);
        try {
            webcamStream = await navigator.mediaDevices.getUserMedia({ video: true });
        } catch (e) {
            console.error("Webcam access denied:", e);
            showToast("Webcam access denied or unavailable", true);
            return;
        }
    }
    
    if (webcamStream) {
        video.srcObject = webcamStream;
        video.style.display = 'block';
        idle.style.display = 'none';
        captureBtn.disabled = false;
        startBtn.innerHTML = `<i class="ti ti-video-off"></i> Stop Feed`;
        startBtn.onclick = stopWebcam;
    }
}

window.stopWebcam = function() {
    const video = document.getElementById('webcam');
    const idle = document.getElementById('vf-idle');
    const captureBtn = document.getElementById('capture-webcam-btn');
    const startBtn = document.getElementById('start-webcam-btn');
    const detectBox = document.getElementById('detect-box');
    
    if (webcamStream) {
        webcamStream.getTracks().forEach(track => track.stop());
        webcamStream = null;
    }
    
    video.srcObject = null;
    video.style.display = 'none';
    idle.style.display = 'flex';
    captureBtn.disabled = true;
    detectBox.style.display = 'none';
    startBtn.innerHTML = `<i class="ti ti-video"></i> Start Feed`;
    startBtn.onclick = startWebcam;
}

window.switchCameraMode = function(mode) {
    const panelCam = document.getElementById('panel-camera');
    const panelUpload = document.getElementById('panel-upload');
    const btnCam = document.getElementById('mode-camera');
    const btnUpload = document.getElementById('mode-upload');
    
    if (mode === 'camera') {
        panelCam.style.display = 'block';
        panelUpload.style.display = 'none';
        btnCam.style.borderBottomColor = 'var(--accent-primary)';
        btnCam.style.color = 'var(--text-main)';
        btnCam.style.fontWeight = '700';
        btnUpload.style.borderBottomColor = 'transparent';
        btnUpload.style.color = 'var(--text-muted)';
        btnUpload.style.fontWeight = '600';
    } else {
        panelCam.style.display = 'none';
        panelUpload.style.display = 'block';
        btnCam.style.borderBottomColor = 'transparent';
        btnCam.style.color = 'var(--text-muted)';
        btnCam.style.fontWeight = '600';
        btnUpload.style.borderBottomColor = 'var(--accent-primary)';
        btnUpload.style.color = 'var(--text-main)';
        btnUpload.style.fontWeight = '700';
        stopWebcam();
    }
}

window.captureWebcamFrame = function() {
    const video = document.getElementById('webcam');
    const canvas = document.getElementById('photo-canvas');
    const scanLine = document.getElementById('scan-line');
    const detectBox = document.getElementById('detect-box');
    const vfLabel = document.getElementById('vf-label');
    const captureBtn = document.getElementById('capture-webcam-btn');
    
    if (!video || !canvas) return;
    
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    scanLine.style.display = 'block';
    detectBox.style.display = 'none';
    vfLabel.textContent = 'ANALYZING...';
    captureBtn.disabled = true;
    
    canvas.toBlob(blob => {
        fetch('/detect', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/octet-stream',
                'Accept': 'application/json',
                'X-Requested-With': 'XMLHttpRequest'
            },
            body: blob
        })
        .then(response => {
            if (!response.ok) {
                return response.json().then(err => { throw new Error(err.error || 'Server error') });
            }
            return response.json();
        })
        .then(data => {
            updateUIState(data);
            showToast("Analysis Complete!");
            
            const detectLabel = document.getElementById('detect-label');
            if (detectLabel) {
                detectLabel.innerHTML = `${escapeHTML(data.fruit)} &middot; ${data.confidence.toFixed(0)}%`;
            }
            detectBox.style.display = 'block';
            
            fetchHistory();
            if (document.getElementById('panel-history').style.display === 'block') {
                fetchHistoryList();
            }
        })
        .catch(err => {
            console.error("Camera scan failed:", err);
            showToast(err.message || "Failed to analyze camera frame.", true);
        })
        .finally(() => {
            scanLine.style.display = 'none';
            vfLabel.textContent = 'LIVE \u00B7 GEMINI VISION';
            captureBtn.disabled = false;
        });
    }, 'image/jpeg', 0.85);
}
