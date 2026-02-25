// Global Variables
let map;
let deviceMarker;
let safeZoneCircle;
let currentLat = 0;
let currentLon = 0;
let savedConfigLat = 18.67625;
let savedConfigLon = 105.66854;
let savedRadius = 1000;
let firstLoad = true;
let isOffline = false;
let pollingInterval = null;

// History Variables
let isHistoryMode = false;
let historyData = [];
let historyLayer = L.layerGroup();
let historyPolyline = null;
let historyPlayInterval = null;
let currentHistoryIndex = 0;

// Initialize Map
function initMap() {
    // Basic map setup centered somewhere default
    map = L.map('map', {
        zoomControl: false,
        attributionControl: false
    }).setView([18.67625, 105.66854], 15);

    // Custom dark tile layer using standard OSM but inverted via CSS
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19
    }).addTo(map);

    // Zoom controls customized
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // Initial Marker Setup
    const customIcon = L.divIcon({
        className: 'custom-div-icon',
        html: `<div class='marker-pin'></div><i class='fa-solid fa-satellite-dish marker-icon'></i>`,
        iconSize: [30, 42],
        iconAnchor: [15, 42]
    });

    deviceMarker = L.marker([18.67625, 105.66854], { icon: customIcon }).addTo(map);
    deviceMarker.bindPopup("<b>Device Location</b><br>Fetching data...").openPopup();

    // Initial Safe Zone Setup
    safeZoneCircle = L.circle([18.67625, 105.66854], {
        color: '#10b981',        // Success green
        fillColor: '#10b981',
        fillOpacity: 0.1,
        weight: 2,
        dashArray: '5, 5'
    }).addTo(map);
}

// Map Center Button Action
function centerMap() {
    if (map && currentLat !== 0 && currentLon !== 0) {
        map.flyTo([currentLat, currentLon], 16, { animate: true, duration: 1 });
    }
}

// Polling and Data Update
async function fetchDeviceData() {
    try {
        const response = await fetch('/api/data');
        if (!response.ok) throw new Error("Network response was not ok");

        const data = await response.json();

        // Update DOM Elements if not in History Mode
        if (!isHistoryMode) {
            updateDashboard(data);
        }

        // Set Connected State
        document.querySelector('.status-indicator').className = 'status-indicator connected';
        document.getElementById('connText').innerText = 'Online';
        document.getElementById('connText').style.color = 'var(--success)';

    } catch (error) {
        console.error("Error fetching data:", error);

        // Set Disconnected State
        document.querySelector('.status-indicator').className = 'status-indicator disconnected';
        document.getElementById('connText').innerText = 'Offline';
        document.getElementById('connText').style.color = 'var(--offline)';
    }
}

// Update the DOM based on fetched data
function updateDashboard(data) {
    const { lat, lon, battery, status, config_lat, config_lon, radius, last_seen, last_seen_str, silent_seconds } = data;

    // Save current coords for centering
    currentLat = lat || config_lat;
    currentLon = lon || config_lon;

    // Save settings
    savedConfigLat = config_lat;
    savedConfigLon = config_lon;
    savedRadius = radius;

    // 1. Update Battery
    document.getElementById('batteryVal').innerText = battery;
    const batBar = document.getElementById('batteryBar');
    batBar.style.width = `${battery}%`;
    const batIcon = document.getElementById('batteryIcon');

    if (battery <= 20) {
        batBar.style.background = 'var(--danger)';
        batIcon.className = 'fa-solid fa-battery-empty';
    } else if (battery <= 50) {
        batBar.style.background = 'var(--warning)';
        batIcon.className = 'fa-solid fa-battery-half';
    } else {
        batBar.style.background = 'var(--success)';
        batIcon.className = 'fa-solid fa-battery-full';
    }

    // 2. Update Status Card
    const statusCard = document.getElementById('statusCard');
    const deviceStatus = document.getElementById('deviceStatus');
    deviceStatus.innerText = status;

    // Clear previous classes
    statusCard.className = 'stat-card';
    deviceMarker.setPopupContent(`<b>Device Location</b><br>Status: ${status}<br>Battery: ${battery}%`);

    if (status === 'DANGER' || status === 'SOS') {
        statusCard.classList.add('status-danger');
        safeZoneCircle.setStyle({ color: '#ef4444', fillColor: '#ef4444' }); // Red Map circle
    } else if (status === 'SAFE') {
        statusCard.classList.add('status-safe');
        safeZoneCircle.setStyle({ color: '#10b981', fillColor: '#10b981' }); // Green Map circle
    } else if (status === 'OFFLINE' || status === 'UNKNOWN') {
        statusCard.classList.add('status-offline');
        safeZoneCircle.setStyle({ color: '#64748b', fillColor: '#64748b' }); // Gray Map circle
    }

    // 3. Update Last Seen
    const lastSeenVal = document.getElementById('lastSeenVal');
    const lastSeenStrEl = document.getElementById('lastSeenStr');

    if (last_seen === 0) {
        lastSeenVal.innerText = "Never";
        lastSeenStrEl.innerText = "No data received";
    } else {
        if (silent_seconds < 60) {
            lastSeenVal.innerText = `${silent_seconds}s ago`;
        } else if (silent_seconds < 3600) {
            lastSeenVal.innerText = `${Math.floor(silent_seconds / 60)}m ago`;
        } else {
            lastSeenVal.innerText = `${Math.floor(silent_seconds / 3600)}h ago`;
        }
        lastSeenStrEl.innerText = last_seen_str;
    }

    // 4. Update Safe Zone
    document.getElementById('radiusVal').innerText = radius;

    // 5. Update Map Data
    if (lat && lon) {
        deviceMarker.setLatLng([lat, lon]);
    }

    if (config_lat && config_lon) {
        safeZoneCircle.setLatLng([config_lat, config_lon]);
        safeZoneCircle.setRadius(radius);
    }

    if (firstLoad && lat !== 0 && lon !== 0) {
        map.setView([lat, lon], 14);
        firstLoad = false;
    } else if (firstLoad && config_lat !== 0 && config_lon !== 0) {
        map.setView([config_lat, config_lon], 14);
        firstLoad = false;
    }
}

// Document Ready
document.addEventListener("DOMContentLoaded", () => {
    initMap();
    initModal();
    initHistory();

    // Initial fetch then remove loader
    fetchDeviceData().then(() => {
        setTimeout(() => {
            const loader = document.getElementById('startupLoader');
            if (loader) {
                loader.classList.add('fade-out');
                // Optional: remove from DOM to clean up
                setTimeout(() => loader.remove(), 800);
            }
        }, 1200); // Fake slightly longer load for premium feel
    });

    pollingInterval = setInterval(fetchDeviceData, 2000); // Poll every 2 seconds
});

// Modal Logic
function initModal() {
    const settingsModal = document.getElementById('settingsModal');
    const btnSettings = document.getElementById('navSettings');
    const closeBtn = document.getElementById('closeSettingsModal');
    const settingsForm = document.getElementById('settingsForm');

    // Open modal
    btnSettings.addEventListener('click', (e) => {
        e.preventDefault();
        // Update form with current data
        document.getElementById('inputLat').value = savedConfigLat;
        document.getElementById('inputLon').value = savedConfigLon;
        document.getElementById('inputRadius').value = savedRadius;

        settingsModal.classList.add('active');

        // Update active class
        document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active'));
        btnSettings.classList.add('active');
    });

    // Close modal
    closeBtn.addEventListener('click', () => {
        settingsModal.classList.remove('active');
        // Restore active class
        document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active'));
        document.getElementById('navLive').classList.add('active');
    });

    // Click outside to close
    settingsModal.addEventListener('click', (e) => {
        if (e.target === settingsModal) {
            settingsModal.classList.remove('active');
            document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active'));
            document.getElementById('navLive').classList.add('active');
        }
    });

    // Handle form submit
    settingsForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const lat = parseFloat(document.getElementById('inputLat').value);
        const lon = parseFloat(document.getElementById('inputLon').value);
        const radius = parseInt(document.getElementById('inputRadius').value);

        try {
            const response = await fetch('/api/settings', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    config_lat: lat,
                    config_lon: lon,
                    radius: radius
                })
            });

            if (response.ok) {
                // Instantly update UI based on input
                savedConfigLat = lat;
                savedConfigLon = lon;
                savedRadius = radius;
                if (safeZoneCircle) {
                    safeZoneCircle.setLatLng([lat, lon]);
                    safeZoneCircle.setRadius(radius);
                }
                document.getElementById('radiusVal').innerText = radius;

                settingsModal.classList.remove('active');
                document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active'));
                document.getElementById('navLive').classList.add('active');
            } else {
                alert("Failed to update settings!");
            }
        } catch (error) {
            console.error("Error updating settings:", error);
            alert("Error updating settings!");
        }
    });
}

// History Logic
function initHistory() {
    const navHistory = document.getElementById('navHistory');
    const navLive = document.getElementById('navLive');
    const historyPanel = document.getElementById('historyPanel');
    const closeHistoryBtn = document.getElementById('closeHistoryBtn');

    const playBtn = document.getElementById('playHistoryBtn');
    const playIcon = playBtn.querySelector('i');
    const slider = document.getElementById('historySlider');
    const timeDisplay = document.getElementById('historyTimeDisplay');
    const countDisplay = document.getElementById('historyCount');

    // Enter History Mode
    navHistory.addEventListener('click', async (e) => {
        e.preventDefault();

        document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active'));
        navHistory.classList.add('active');

        isHistoryMode = true;
        historyPanel.classList.add('active');

        // Load data
        await loadHistoryData();
    });

    // Exit History Mode
    closeHistoryBtn.addEventListener('click', exitHistoryMode);

    function exitHistoryMode() {
        isHistoryMode = false;
        historyPanel.classList.remove('active');

        document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active'));
        navLive.classList.add('active');

        // Clean up map
        historyLayer.removeFrom(map);
        if (historyPolyline) historyPolyline.remove();

        stopPlayback();

        // Resume Live view
        fetchDeviceData(); // force immediate live update
    }

    async function loadHistoryData() {
        try {
            const resp = await fetch('/api/history');
            const data = await resp.json();

            if (data && data.length > 0) {
                historyData = data;
                slider.max = data.length - 1;
                slider.value = 0;
                countDisplay.innerText = data.length;

                historyLayer.addTo(map);
                drawFullHistoryPath();
                updateHistoryPoint(0);

                // Fit bounds
                if (historyPolyline) {
                    map.fitBounds(historyPolyline.getBounds(), { padding: [50, 50] });
                }
            } else {
                alert("No history data found!");
                exitHistoryMode();
            }
        } catch (error) {
            console.error(error);
            alert("Error loading history.");
            exitHistoryMode();
        }
    }

    function drawFullHistoryPath() {
        if (historyPolyline) historyPolyline.remove();

        const latlngs = historyData.map(d => [d.lat, d.lon]);
        historyPolyline = L.polyline(latlngs, {
            color: 'var(--primary)',
            weight: 3,
            opacity: 0.6,
            dashArray: '5, 10' // dashed line
        }).addTo(map);
    }

    function updateHistoryPoint(index) {
        currentHistoryIndex = index;
        const point = historyData[index];
        if (!point) return;

        // Move marker
        deviceMarker.setLatLng([point.lat, point.lon]);

        // Update Time text
        const ptTime = new Date(point.time * 1000);
        timeDisplay.innerText = ptTime.toLocaleString();
    }

    // Slider interaction
    slider.addEventListener('input', (e) => {
        stopPlayback();
        updateHistoryPoint(parseInt(e.target.value));
    });

    // Playback logic
    let isPlaying = false;

    function startPlayback() {
        if (currentHistoryIndex >= historyData.length - 1) {
            currentHistoryIndex = 0;
            slider.value = 0;
        }

        isPlaying = true;
        playIcon.className = 'fa-solid fa-pause';

        historyPlayInterval = setInterval(() => {
            currentHistoryIndex++;
            if (currentHistoryIndex >= historyData.length) {
                stopPlayback();
                return;
            }
            slider.value = currentHistoryIndex;
            updateHistoryPoint(currentHistoryIndex);
        }, 500); // 500ms per point
    }

    function stopPlayback() {
        isPlaying = false;
        playIcon.className = 'fa-solid fa-play';
        clearInterval(historyPlayInterval);
    }

    playBtn.addEventListener('click', () => {
        if (isPlaying) stopPlayback();
        else startPlayback();
    });
}

/* Some Dynamic CSS injected for the custom leaflet marker */
const style = document.createElement('style');
style.innerHTML = `
    .custom-div-icon {
        background: none;
        border: none;
    }
    .marker-pin {
        width: 30px;
        height: 30px;
        border-radius: 50% 50% 50% 0;
        background: var(--primary);
        position: absolute;
        transform: rotate(-45deg);
        left: 50%;
        top: 50%;
        margin: -15px 0 0 -15px;
        box-shadow: 0 0 15px var(--primary-glow);
    }
    .marker-pin::after {
        content: '';
        width: 24px;
        height: 24px;
        margin: 3px 0 0 3px;
        background: var(--bg-darker);
        position: absolute;
        border-radius: 50%;
    }
    .marker-icon {
        position: absolute;
        width: 22px;
        color: var(--primary);
        font-size: 14px;
        left: 0;
        right: 0;
        margin: 10px auto;
        text-align: center;
        z-index: 100;
    }
`;
document.head.appendChild(style);
