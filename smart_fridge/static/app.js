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
    });
}

// Apply stored theme on load
const savedTheme = localStorage.getItem('theme');
if (savedTheme === 'light') {
    document.body.classList.add('light-mode');
} else {
    document.body.classList.remove('light-mode');
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
            dropZone.style.borderColor = 'rgba(255, 255, 255, 0.15)';
            dropZone.style.background = 'rgba(255, 255, 255, 0.02)';
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
function handleFileSelect(input) {
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
function resetFileSelection(event) {
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
    // Fruit badge
    const fruitNameEl = document.getElementById('fruit-name');
    if (fruitNameEl) {
        fruitNameEl.innerHTML = `<span class="fruit-badge">${state.fruit}</span>`;
    }
    
    // Freshness rating
    const freshnessEl = document.getElementById('freshness-rating');
    if (freshnessEl) {
        if (state.freshness.toLowerCase() === 'fresh') {
            freshnessEl.innerHTML = `<span class="freshness-badge freshness-fresh">Fresh</span>`;
        } else {
            freshnessEl.innerHTML = `<span class="freshness-badge freshness-unknown">${state.freshness}</span>`;
        }
    }

    // Temp range
    const tempRangeEl = document.getElementById('temp-range');
    if (tempRangeEl) {
        tempRangeEl.innerText = `${state.target_low.toFixed(1)}°C - ${state.target_high.toFixed(1)}°C`;
    }

    // Confidence
    const confidenceRow = document.getElementById('confidence-row');
    const confidenceVal = document.getElementById('confidence-value');
    if (confidenceRow && confidenceVal) {
        if (state.confidence && state.confidence > 0) {
            confidenceVal.innerHTML = `<span class="metric-value">${state.confidence.toFixed(1)}%</span>`;
            confidenceRow.style.display = 'flex';
        } else {
            confidenceRow.style.display = 'none';
        }
    }

    // Decay Index
    const decayRow = document.getElementById('decay-row');
    const decayVal = document.getElementById('decay-value');
    if (decayRow && decayVal) {
        if (state.decay_index !== undefined && state.decay_index > 0) {
            decayVal.innerHTML = `<span class="metric-value text-rose-400">${state.decay_index.toFixed(1)}%</span>`;
            decayRow.style.display = 'flex';
        } else {
            decayRow.style.display = 'none';
        }
    }

    // Shelf Life
    const shelfLifeRow = document.getElementById('shelf-life-row');
    const shelfLifeVal = document.getElementById('shelf-life-value');
    if (shelfLifeRow && shelfLifeVal) {
        if (state.days_remaining && state.days_remaining > 0) {
            shelfLifeVal.innerHTML = `<span class="metric-value text-sky-400">${state.days_remaining} Days</span>`;
            shelfLifeRow.style.display = 'flex';
        } else {
            shelfLifeRow.style.display = 'none';
        }
    }

    // Reasoning
    const reasoningContainer = document.getElementById('reasoning-container');
    const reasoningText = document.getElementById('ai-reasoning');
    if (reasoningContainer && reasoningText) {
        if (state.ai_reasoning && state.ai_reasoning !== 'Awaiting visual diagnostics trigger.') {
            reasoningText.innerText = state.ai_reasoning;
            reasoningContainer.style.display = 'block';
        } else {
            reasoningContainer.style.display = 'none';
        }
    }

    // Dynamic Telemetry Values Grid (Current Temp, Humidity, Cooling State)
    if (state.telemetry) {
        const liveTempEl = document.getElementById('live-temp');
        const liveHumEl = document.getElementById('live-hum');
        const liveStatusEl = document.getElementById('live-status');
        const pulseDot = document.getElementById('sync-pulse');
        const syncDesc = document.getElementById('sync-desc');

        if (liveTempEl) liveTempEl.innerText = state.telemetry.temperature ? `${state.telemetry.temperature.toFixed(1)}°C` : '--°C';
        if (liveHumEl) liveHumEl.innerText = state.telemetry.humidity ? `${state.telemetry.humidity.toFixed(1)}%` : '--%';
        
        if (liveStatusEl) {
            liveStatusEl.innerText = state.telemetry.is_cooling ? "COOLING (ON)" : "IDLE (OFF)";
            if (state.telemetry.is_cooling) {
                liveStatusEl.style.color = 'var(--cold-blue)';
            } else {
                liveStatusEl.style.color = 'var(--text-muted)';
            }
        }

        // Pulse dot status
        if (pulseDot && syncDesc) {
            if (state.telemetry.timestamp) {
                pulseDot.classList.remove('offline');
                syncDesc.innerText = `Synced at ${state.telemetry.timestamp.split(' ')[1] || state.telemetry.timestamp}`;
            } else {
                pulseDot.classList.add('offline');
                syncDesc.innerText = "ESP32 offline or awaiting sync...";
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
        }, 3500);
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

// Draw line graph using Chart.js
function drawHistoryChart(telemetryData) {
    const ctx = document.getElementById('historyChart').getContext('2d');
    
    const labels = telemetryData.map(item => {
        // extract HH:MM:SS from timestamp
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
                    label: 'Temperature (°C)',
                    data: temps,
                    borderColor: '#fb923c', // warning orange
                    backgroundColor: 'rgba(251, 146, 60, 0.1)',
                    borderWidth: 2,
                    tension: 0.3,
                    yAxisID: 'yTemp',
                    pointRadius: 2
                },
                {
                    label: 'Humidity (%)',
                    data: hums,
                    borderColor: '#38bdf8', // cold blue
                    backgroundColor: 'rgba(56, 189, 248, 0.05)',
                    borderWidth: 2,
                    tension: 0.3,
                    yAxisID: 'yHum',
                    pointRadius: 2
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
                            size: 10,
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
                            weight: 'bold'
                        }
                    },
                    title: {
                        display: true,
                        text: 'Temp °C',
                        color: '#fb923c',
                        font: { size: 9 }
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
                            weight: 'bold'
                        }
                    },
                    title: {
                        display: true,
                        text: 'Humidity %',
                        color: '#38bdf8',
                        font: { size: 9 }
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
}

// Start polling on boot
startStatePolling();
