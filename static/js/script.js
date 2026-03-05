// Global Variables
let map;
let deviceMarker;
let safeZoneCircle;
let liveMarkers = {};
let liveCircles = {};
let currentLat = 0;
let currentLon = 0;
let savedConfigLat = 18.67625;
let savedConfigLon = 105.66854;
let savedRadius = 1000;
let firstLoad = true;
let isOffline = false;
let pollingInterval = null;
let activeLiveDeviceId = null;
let lastKnownDevicesStr = "";
let allFetchedDevices = [];

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

    // Initial Marker Setup (Used mostly for History Mode)
    const customIcon = L.divIcon({
        className: 'custom-div-icon',
        html: `<div class='marker-pin'></div><i class='fa-solid fa-satellite-dish marker-icon'></i>`,
        iconSize: [30, 42],
        iconAnchor: [15, 42]
    });

    deviceMarker = L.marker([18.67625, 105.66854], { icon: customIcon });
    deviceMarker.bindPopup("<b>Device</b><br>Fetching data...");

    // Initial Safe Zone Setup (Used mostly for History Mode)
    safeZoneCircle = L.circle([18.67625, 105.66854], {
        color: '#10b981',        // Success green
        fillColor: '#10b981',
        fillOpacity: 0.1,
        weight: 2,
        dashArray: '5, 5'
    });
}

// Map Center Button Action
function centerMap() {
    if (map && currentLat !== 0 && currentLon !== 0) {
        map.flyTo([currentLat, currentLon], 16, { animate: true, duration: 1 });
    }
}

// Polling and Data Update
async function fetchDeviceData() {
    const token = localStorage.getItem('token');
    if (!token) {
        document.getElementById('authOverlay').classList.add('active');
        return;
    }

    try {
        const response = await fetch('/api/data', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (response.status === 401 || response.status === 422) {
            // Unauthorized or token expired
            localStorage.removeItem('token');
            document.getElementById('authOverlay').classList.add('active');
            throw new Error("Unauthorized");
        }

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

        if (error.message !== "Unauthorized") {
            // Set Disconnected State
            document.querySelector('.status-indicator').className = 'status-indicator disconnected';
            document.getElementById('connText').innerText = 'Offline';
            document.getElementById('connText').style.color = 'var(--offline)';
        }
    }
}

// Update the DOM based on fetched data
function updateDashboard(devices) {
    if (!devices || devices.length === 0) return;

    allFetchedDevices = devices;

    // Handle Dropdown population if devices list changed
    const currentDevicesStr = devices.map(d => d.device_id).join(',');
    const liveSelect = document.getElementById('liveDeviceSelect');

    if (liveSelect && currentDevicesStr !== lastKnownDevicesStr) {
        const prevValue = liveSelect.value;
        liveSelect.innerHTML = '';
        devices.forEach(d => {
            const opt = document.createElement('option');
            opt.value = d.device_id;
            opt.innerText = d.device_id;
            liveSelect.appendChild(opt);
        });
        lastKnownDevicesStr = currentDevicesStr;

        if (!activeLiveDeviceId && devices.length > 0) activeLiveDeviceId = devices[0].device_id;

        if (devices.find(d => d.device_id === prevValue)) {
            liveSelect.value = prevValue;
        } else if (devices.find(d => d.device_id === activeLiveDeviceId)) {
            liveSelect.value = activeLiveDeviceId;
        } else {
            activeLiveDeviceId = devices[0].device_id;
            liveSelect.value = activeLiveDeviceId;
        }
    }

    // Use the selected device for Dashboard cards
    const data = devices.find(d => d.device_id === activeLiveDeviceId) || devices[0];
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

    if (status === 'DANGER' || status === 'SOS') {
        statusCard.classList.add('status-danger');
    } else if (status === 'SAFE') {
        statusCard.classList.add('status-safe');
    } else if (status === 'OFFLINE' || status === 'UNKNOWN') {
        statusCard.classList.add('status-offline');
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

    // 5. Update Map Data (For all devices)
    devices.forEach(d => {
        const d_lat = d.lat || d.config_lat || 0;
        const d_lon = d.lon || d.config_lon || 0;
        const d_id = d.device_id || 'Device Location';

        const customIcon = L.divIcon({
            className: 'custom-div-icon',
            html: `<div class='marker-pin${(d.status === 'DANGER' || d.status === 'SOS') ? ' danger-mode' : ''}'></div><i class='fa-solid fa-satellite-dish marker-icon${(d.status === 'DANGER' || d.status === 'SOS') ? ' danger-mode' : ''}'></i>`,
            iconSize: [30, 42],
            iconAnchor: [15, 42]
        });

        if (!liveMarkers[d_id]) {
            liveMarkers[d_id] = L.marker([d_lat, d_lon], { icon: customIcon }).addTo(map);
        } else {
            liveMarkers[d_id].setLatLng([d_lat, d_lon]);
            liveMarkers[d_id].setIcon(customIcon);
        }

        liveMarkers[d_id].bindPopup(`<b>${d_id}</b><br>Status: ${d.status}<br>Battery: ${d.battery}%`);

        if ((d.status === 'OFFLINE' || d.status === 'UNKNOWN') && d.lat === 0 && d.lon === 0) {
            liveMarkers[d_id].setOpacity(0);
        } else {
            liveMarkers[d_id].setOpacity(1);
        }

        if (d.config_lat && d.config_lon) {
            let color = '#10b981';
            if (d.status === 'DANGER' || d.status === 'SOS') color = '#ef4444';
            else if (d.status === 'OFFLINE' || d.status === 'UNKNOWN') color = '#64748b';

            if (!liveCircles[d_id]) {
                liveCircles[d_id] = L.circle([d.config_lat, d.config_lon], {
                    color: color, fillColor: color, fillOpacity: 0.1, weight: 2, dashArray: '5, 5'
                }).addTo(map);
                liveCircles[d_id].setRadius(d.radius || 1000);
            } else {
                liveCircles[d_id].setLatLng([d.config_lat, d.config_lon]);
                liveCircles[d_id].setRadius(d.radius || 1000);
                liveCircles[d_id].setStyle({ color: color, fillColor: color });
            }
        }
    });

    if (firstLoad) {
        let bounds = L.latLngBounds();
        let valid = false;
        devices.forEach(d => {
            if (d.lat && d.lon) { bounds.extend([d.lat, d.lon]); valid = true; }
            else if (d.config_lat && d.config_lon) { bounds.extend([d.config_lat, d.config_lon]); valid = true; }
        });
        if (valid) {
            map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
        }
        firstLoad = false;
    }
}

// Document Ready
document.addEventListener("DOMContentLoaded", () => {
    initMap();
    initModal();
    initHistory();
    initAuth();
    initDevicesModal();
    initAddDeviceModal();
    initProfile();

    const liveSelect = document.getElementById('liveDeviceSelect');
    if (liveSelect) {
        liveSelect.addEventListener('change', (e) => {
            activeLiveDeviceId = e.target.value;
            fetchDeviceData();
        });
    }

    // Determine initial auth state
    const token = localStorage.getItem('token');

    // Initial fetch then remove loader
    if (token) {
        fetchDeviceData().then(() => {
            removeLoader();
        });
        pollingInterval = setInterval(fetchDeviceData, 2000); // Poll every 2 seconds
    } else {
        removeLoader();
        document.getElementById('authOverlay').classList.add('active');
    }

    function removeLoader() {
        setTimeout(() => {
            const loader = document.getElementById('startupLoader');
            if (loader) {
                loader.classList.add('fade-out');
                setTimeout(() => loader.remove(), 800);
            }
        }, 1200);
    }
});

function initAddDeviceModal() {
    const btnOpenAddDevice = document.getElementById('openAddDeviceFromList');
    const addDeviceModal = document.getElementById('addDeviceModal');
    const devicesModal = document.getElementById('devicesModal');
    const closeBtn = document.getElementById('closeAddDeviceModal');
    const form = document.getElementById('addDeviceForm');

    btnOpenAddDevice.addEventListener('click', (e) => {
        e.preventDefault();
        devicesModal.classList.remove('active');
        addDeviceModal.classList.add('active');
    });

    closeBtn.addEventListener('click', () => {
        addDeviceModal.classList.remove('active');
        devicesModal.classList.add('active'); // Go back to devices list
    });

    addDeviceModal.addEventListener('click', (e) => {
        if (e.target === addDeviceModal) {
            addDeviceModal.classList.remove('active');
            devicesModal.classList.add('active');
        }
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const device_id = document.getElementById('inputDeviceID').value;
        const pin = document.getElementById('inputDevicePIN').value;
        const submitBtn = form.querySelector('button[type="submit"]');

        submitBtn.disabled = true;
        submitBtn.innerText = 'Linking...';

        try {
            const token = localStorage.getItem('token');
            const res = await fetch('/api/devices/link', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ device_id, pin })
            });

            const data = await res.json();
            if (!res.ok) {
                alert(data.error || 'Failed to link device');
            } else {
                alert(data.message);
                addDeviceModal.classList.remove('active');
                devicesModal.classList.add('active');
                form.reset();
                // trigger a new fetch
                fetchDeviceData();
                fetchDevicesList(); // refresh the list
            }
        } catch (err) {
            alert('Network error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerText = 'Link Device';
        }
    });
}

function initDevicesModal() {
    const navDevices = document.getElementById('navDevices');
    const devicesModal = document.getElementById('devicesModal');
    const closeBtn = document.getElementById('closeDevicesModal');

    navDevices.addEventListener('click', async (e) => {
        e.preventDefault();
        devicesModal.classList.add('active');
        document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active'));
        navDevices.classList.add('active');

        await fetchDevicesList();
    });

    closeBtn.addEventListener('click', () => {
        devicesModal.classList.remove('active');
        document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active'));
        document.getElementById('navLive').classList.add('active');
    });

    devicesModal.addEventListener('click', (e) => {
        if (e.target === devicesModal) {
            devicesModal.classList.remove('active');
            document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active'));
            document.getElementById('navLive').classList.add('active');
        }
    });
}

async function fetchDevicesList() {
    const devicesListContainer = document.getElementById('devicesList');
    devicesListContainer.innerHTML = '<div style="color: var(--text-muted); text-align: center;">Loading devices...</div>';

    try {
        const token = localStorage.getItem('token');
        const res = await fetch('/api/devices', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!res.ok) throw new Error("Failed to fetch devices");

        const devices = await res.json();
        devicesListContainer.innerHTML = '';

        if (devices.length === 0) {
            devicesListContainer.innerHTML = '<div style="color: var(--text-muted); text-align: center;">No devices found.</div>';
            return;
        }

        devices.forEach(d => {
            const devEl = document.createElement('div');
            devEl.style.padding = '10px';
            devEl.style.background = 'var(--bg-darker)';
            devEl.style.borderRadius = '6px';
            devEl.style.display = 'flex';
            devEl.style.justifyContent = 'space-between';
            devEl.style.alignItems = 'center';

            let statusColor = 'var(--success)';
            if (d.status === 'SOS' || d.status === 'DANGER') statusColor = 'var(--danger)';
            else if (d.status === 'OFFLINE' || d.status === 'UNKNOWN') statusColor = 'var(--offline)';

            devEl.innerHTML = `
                <div>
                    <strong style="color: var(--primary); font-size: 1.1rem;">${d.id}</strong>
                    <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 4px;">
                        Battery: ${d.battery}% | Last Seen: ${d.last_seen > 0 ? new Date(d.last_seen * 1000).toLocaleString() : 'Never'}
                    </div>
                </div>
                <div style="display: flex; gap: 10px; align-items: center;">
                    <span style="background: ${statusColor}20; color: ${statusColor}; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 0.8rem; border: 1px solid ${statusColor}50;">
                        ${d.status}
                    </span>
                    <button class="unlink-btn" data-id="${d.id}" style="background: transparent; border: none; color: var(--danger); cursor: pointer; padding: 5px; border-radius: 4px;" title="Unlink Device">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            `;
            devicesListContainer.appendChild(devEl);
        });

        // Add event listeners for unlink buttons
        document.querySelectorAll('.unlink-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const device_id = btn.getAttribute('data-id');
                if (confirm(`Are you sure you want to unlink device: ${device_id}?`)) {
                    await unlinkDevice(device_id);
                }
            });
        });

    } catch (error) {
        console.error("Error loading devices list", error);
        devicesListContainer.innerHTML = '<div style="color: var(--danger); text-align: center;">Error loading devices</div>';
    }
}

async function unlinkDevice(device_id) {
    try {
        const token = localStorage.getItem('token');
        const res = await fetch('/api/devices/unlink', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ device_id })
        });

        const data = await res.json();
        if (!res.ok) {
            alert(data.error || 'Failed to unlink device');
        } else {
            alert(data.message);
            // reset the active device selection if we unlinked the current one
            if (activeLiveDeviceId === device_id) {
                lastKnownDevicesStr = "";
                activeLiveDeviceId = null;
            }
            await fetchDevicesList(); // refresh the modal list
            fetchDeviceData();  // refresh the main dashboard
        }
    } catch (err) {
        alert('Network error');
    }
}

// Modal Logic
function initModal() {
    const settingsModal = document.getElementById('settingsModal');
    const btnSettings = document.getElementById('navSettings');
    const closeBtn = document.getElementById('closeSettingsModal');
    const settingsForm = document.getElementById('settingsForm');

    // Open modal
    btnSettings.addEventListener('click', (e) => {
        e.preventDefault();

        const deviceSelect = document.getElementById('settingsDeviceSelect');
        if (deviceSelect) {
            deviceSelect.innerHTML = '';
            if (allFetchedDevices.length === 0) {
                deviceSelect.innerHTML = '<option value="">No devices available</option>';
            } else {
                allFetchedDevices.forEach(d => {
                    const opt = document.createElement('option');
                    opt.value = d.device_id;
                    opt.innerText = d.device_id;
                    deviceSelect.appendChild(opt);
                });
                // Select active device by default
                deviceSelect.value = activeLiveDeviceId || allFetchedDevices[0].device_id;
            }

            // Function to update fields based on selected device
            const updateFormFields = () => {
                const selectedDeviceId = deviceSelect.value;
                const d = allFetchedDevices.find(dev => dev.device_id === selectedDeviceId);
                if (d) {
                    document.getElementById('inputLat').value = d.config_lat;
                    document.getElementById('inputLon').value = d.config_lon;
                    document.getElementById('inputRadius').value = d.radius;
                }
            };

            deviceSelect.removeEventListener('change', deviceSelect._changeHandler);
            deviceSelect._changeHandler = updateFormFields;
            deviceSelect.addEventListener('change', deviceSelect._changeHandler);

            updateFormFields();
        } else {
            // Update form with current data fallback
            document.getElementById('inputLat').value = savedConfigLat;
            document.getElementById('inputLon').value = savedConfigLon;
            document.getElementById('inputRadius').value = savedRadius;
        }

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

        const deviceSelect = document.getElementById('settingsDeviceSelect');
        const device_id = deviceSelect ? deviceSelect.value : activeLiveDeviceId;

        if (!device_id) {
            alert("No device available!");
            return;
        }

        const lat = parseFloat(document.getElementById('inputLat').value);
        const lon = parseFloat(document.getElementById('inputLon').value);
        const radius = parseInt(document.getElementById('inputRadius').value);

        try {
            const token = localStorage.getItem('token');
            const response = await fetch('/api/settings', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    device_id: device_id,
                    config_lat: lat,
                    config_lon: lon,
                    radius: radius
                })
            });

            if (response.ok) {
                // Instantly update UI based on input if matching activeLiveDeviceId
                if (device_id === activeLiveDeviceId) {
                    savedConfigLat = lat;
                    savedConfigLon = lon;
                    savedRadius = radius;
                    if (safeZoneCircle) {
                        safeZoneCircle.setLatLng([lat, lon]);
                        safeZoneCircle.setRadius(radius);
                    }
                    document.getElementById('radiusVal').innerText = radius;
                }

                // Also update the memory cache
                const d = allFetchedDevices.find(dev => dev.device_id === device_id);
                if (d) {
                    d.config_lat = lat;
                    d.config_lon = lon;
                    d.radius = radius;
                }

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

    // Helper to format date for datetime-local input
    const formatDateTimeLocal = (date) => {
        const d = new Date(date);
        d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
        return d.toISOString().slice(0, 16);
    };

    // Enter History Mode
    navHistory.addEventListener('click', async (e) => {
        e.preventDefault();

        document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active'));
        navHistory.classList.add('active');

        isHistoryMode = true;
        historyPanel.classList.add('active');

        // Initial dates setup (Last 24 hours)
        const startInput = document.getElementById('historyStartTime');
        const endInput = document.getElementById('historyEndTime');
        if (startInput && endInput && !startInput.value) {
            const now = new Date();
            const past = new Date(now.getTime() - 24 * 60 * 60 * 1000);
            startInput.value = formatDateTimeLocal(past);
            endInput.value = formatDateTimeLocal(now);
        }

        // Fetch devices for dropdown
        await populateHistoryDevices();

        // Hide live markers
        Object.values(liveMarkers).forEach(m => m.remove());
        Object.values(liveCircles).forEach(c => c.remove());
        if (deviceMarker) deviceMarker.addTo(map);
        if (safeZoneCircle) safeZoneCircle.addTo(map);

        // Load data initially
        await loadHistoryData();
    });

    async function populateHistoryDevices() {
        const deviceSelect = document.getElementById('historyDeviceSelect');
        try {
            const token = localStorage.getItem('token');
            const res = await fetch('/api/devices', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const devices = await res.json();
            deviceSelect.innerHTML = '';

            if (devices && devices.length > 0) {
                devices.forEach(d => {
                    const opt = document.createElement('option');
                    opt.value = d.id;
                    opt.innerText = d.id;
                    deviceSelect.appendChild(opt);
                });
            } else {
                deviceSelect.innerHTML = '<option value="">No Devices</option>';
            }
        } catch (error) {
            console.error("Error fetching devices for history", error);
            deviceSelect.innerHTML = '<option value="">Error</option>';
        }
    }

    // Apply Filter Button
    const applyFilterBtn = document.getElementById('applyHistoryFilterBtn');
    if (applyFilterBtn) {
        applyFilterBtn.addEventListener('click', async () => {
            await loadHistoryData();
        });
    }

    // Auto-reload on device select change
    const historyDeviceSelect = document.getElementById('historyDeviceSelect');
    if (historyDeviceSelect) {
        historyDeviceSelect.addEventListener('change', async () => {
            await loadHistoryData();
        });
    }

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

        // Restore live map markers
        if (deviceMarker) deviceMarker.remove();
        if (safeZoneCircle) safeZoneCircle.remove();
        Object.values(liveMarkers).forEach(m => m.addTo(map));
        Object.values(liveCircles).forEach(c => c.addTo(map));

        // Resume Live view
        fetchDeviceData(); // force immediate live update
    }

    async function loadHistoryData() {
        try {
            const startInput = document.getElementById('historyStartTime');
            const endInput = document.getElementById('historyEndTime');
            const deviceSelect = document.getElementById('historyDeviceSelect');

            let queryUrl = '/api/history?limit=5000';

            if (deviceSelect && deviceSelect.value) {
                queryUrl += `&device_id=${deviceSelect.value}`;
            }

            if (startInput && endInput && startInput.value && endInput.value) {
                // Convert picker time (Local) to UNIX Timestamp
                const startTs = Math.floor(new Date(startInput.value).getTime() / 1000);
                const endTs = Math.floor(new Date(endInput.value).getTime() / 1000);

                queryUrl += `&start_time=${startTs}&end_time=${endTs}`;
            }

            const token = localStorage.getItem('token');
            const resp = await fetch(queryUrl, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            const data = await resp.json();

            if (data && data.length > 0) {
                historyData = data;
                slider.max = data.length - 1;
                slider.value = 0;
                countDisplay.innerText = data.length;

                historyLayer.addTo(map);

                // Cập nhật cấu hình vùng an toàn theo thiết bị đang xem lịch sử
                if (deviceSelect && deviceSelect.value && allFetchedDevices && allFetchedDevices.length > 0) {
                    const selectedDevInfo = allFetchedDevices.find(d => d.device_id === deviceSelect.value);
                    if (selectedDevInfo) {
                        savedConfigLat = selectedDevInfo.config_lat || 18.67625;
                        savedConfigLon = selectedDevInfo.config_lon || 105.66854;
                        savedRadius = selectedDevInfo.radius || 1000;
                        if (safeZoneCircle) {
                            safeZoneCircle.setLatLng([savedConfigLat, savedConfigLon]);
                            safeZoneCircle.setRadius(savedRadius);
                        }
                    }
                }

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
        const pLatLng = L.latLng(point.lat, point.lon);
        deviceMarker.setLatLng(pLatLng);

        // Update Time text
        const ptTime = new Date(point.time * 1000);
        timeDisplay.innerText = ptTime.toLocaleString();

        // Update DOM status based on history point
        let { status, battery } = point;

        // Tự động tính toán lại khoảng cách từ vị trí lịch sử đến Tâm an toàn hiện tại
        if (savedConfigLat && savedConfigLon && savedRadius) {
            const centerLatLng = L.latLng(savedConfigLat, savedConfigLon);
            const dist = centerLatLng.distanceTo(pLatLng);

            // Nếu khoảng cách lớn hơn bán kính cho phép và trạng thái không phải do người dùng ấn nút SOS cứng
            if (dist > savedRadius && status !== 'SOS') {
                status = 'DANGER'; // Vượt khỏi vùng an toàn
            } else if (dist <= savedRadius && status !== 'SOS' && status !== 'OFFLINE') {
                status = 'SAFE'; // Trong vùng an toàn
            }
        }

        document.getElementById('deviceStatus').innerText = status;
        document.getElementById('batteryVal').innerText = battery;

        const statusCard = document.getElementById('statusCard');
        statusCard.className = 'stat-card'; // reset

        deviceMarker.setPopupContent(`<b>History Playback</b><br>Status: ${status}<br>Battery: ${battery}%`);

        if (status === 'DANGER' || status === 'SOS') {
            statusCard.classList.add('status-danger');
            if (safeZoneCircle) safeZoneCircle.setStyle({ color: '#ef4444', fillColor: '#ef4444' });
        } else if (status === 'SAFE') {
            statusCard.classList.add('status-safe');
            if (safeZoneCircle) safeZoneCircle.setStyle({ color: '#10b981', fillColor: '#10b981' });
        } else {
            statusCard.classList.add('status-offline');
            if (safeZoneCircle) safeZoneCircle.setStyle({ color: '#64748b', fillColor: '#64748b' });
        }

        const markerEl = deviceMarker.getElement();
        if (markerEl) {
            const pin = markerEl.querySelector('.marker-pin');
            const icon = markerEl.querySelector('.marker-icon');
            if (pin && icon) {
                if (status === 'DANGER' || status === 'SOS') {
                    pin.classList.add('danger-mode');
                    icon.classList.add('danger-mode');
                } else {
                    pin.classList.remove('danger-mode');
                    icon.classList.remove('danger-mode');
                }
            }
        }
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
    .marker-pin.danger-mode {
        background: var(--danger);
        box-shadow: 0 0 15px var(--danger-glow);
    }
    .marker-icon.danger-mode {
        color: var(--danger);
    }
`;
document.head.appendChild(style);

// Profile Logic Setup
function initProfile() {
    const profileModal = document.getElementById('profileModal');
    const userProfileBtn = document.getElementById('userProfileBtn');
    const closeBtn = document.getElementById('closeProfileModal');
    const profileForm = document.getElementById('profileForm');

    // Open modal
    userProfileBtn.addEventListener('click', async (e) => {
        e.preventDefault();

        document.getElementById('profileSuccess').innerText = '';
        document.getElementById('profileError').innerText = '';

        try {
            const token = localStorage.getItem('token');
            const res = await fetch('/api/profile', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();

            if (res.ok) {
                document.getElementById('profileName').value = data.name || '';
                document.getElementById('profileEmail').value = data.email || '';
                document.getElementById('profilePhone').value = data.zalo_phone || '';
            }
        } catch (error) {
            console.error("Error fetching profile", error);
        }

        profileModal.classList.add('active');
    });

    closeBtn.addEventListener('click', () => {
        profileModal.classList.remove('active');
    });

    profileModal.addEventListener('click', (e) => {
        if (e.target === profileModal) {
            profileModal.classList.remove('active');
        }
    });

    profileForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const zalo_phone = document.getElementById('profilePhone').value;
        const submitBtn = profileForm.querySelector('button[type="submit"]');
        const successDiv = document.getElementById('profileSuccess');
        const errorDiv = document.getElementById('profileError');

        submitBtn.disabled = true;
        submitBtn.innerText = 'Saving...';
        successDiv.innerText = '';
        errorDiv.innerText = '';

        try {
            const token = localStorage.getItem('token');
            const res = await fetch('/api/profile', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ zalo_phone })
            });

            if (res.ok) {
                successDiv.innerText = 'Profile updated successfully!';
                setTimeout(() => {
                    profileModal.classList.remove('active');
                }, 1500);
            } else {
                const data = await res.json();
                errorDiv.innerText = data.error || 'Failed to update profile';
            }
        } catch (err) {
            errorDiv.innerText = 'Network error';
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerText = 'Save Profile';
        }
    });
}

// Auth Logic Setup
function initAuth() {
    const tabLogin = document.getElementById('tabLogin');
    const tabRegister = document.getElementById('tabRegister');
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');

    // UI Toggles
    tabLogin.addEventListener('click', () => {
        tabLogin.classList.add('active');
        tabRegister.classList.remove('active');
        loginForm.classList.add('active');
        registerForm.classList.remove('active');
        document.getElementById('loginError').innerText = '';
    });

    tabRegister.addEventListener('click', () => {
        tabRegister.classList.add('active');
        tabLogin.classList.remove('active');
        registerForm.classList.add('active');
        loginForm.classList.remove('active');
        document.getElementById('registerError').innerText = '';
        document.getElementById('registerSuccess').innerText = '';
    });

    // Login Submission
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('loginEmail').value;
        const password = document.getElementById('loginPassword').value;
        const errorDiv = document.getElementById('loginError');
        const submitBtn = loginForm.querySelector('button[type="submit"]');

        errorDiv.innerText = '';
        submitBtn.disabled = true;
        submitBtn.innerText = 'Verifying...';

        try {
            const res = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            const data = await res.json();

            if (!res.ok) {
                errorDiv.innerText = data.error || 'Login failed.';
            } else {
                // Success
                localStorage.setItem('token', data.access_token);
                document.getElementById('authOverlay').classList.remove('active');

                // Restart polling
                if (pollingInterval) clearInterval(pollingInterval);
                fetchDeviceData();
                pollingInterval = setInterval(fetchDeviceData, 2000);
            }
        } catch (err) {
            errorDiv.innerText = 'Network connection error.';
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerText = 'Secure Login';
        }
    });

    // Register Submission
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('regName').value;
        const email = document.getElementById('regEmail').value;
        const zalo_phone = document.getElementById('regPhone').value;
        const password = document.getElementById('regPassword').value;

        const errorDiv = document.getElementById('registerError');
        const successDiv = document.getElementById('registerSuccess');
        const submitBtn = registerForm.querySelector('button[type="submit"]');

        errorDiv.innerText = '';
        successDiv.innerText = '';
        submitBtn.disabled = true;
        submitBtn.innerText = 'Creating...';

        try {
            const res = await fetch('/api/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, email, zalo_phone, password })
            });
            const data = await res.json();

            if (!res.ok) {
                errorDiv.innerText = data.error || 'Registration failed.';
            } else {
                successDiv.innerText = 'Account created successfully! Please login.';
                registerForm.reset();
                setTimeout(() => {
                    tabLogin.click(); // Switch to login tab automatically
                }, 2000);
            }
        } catch (err) {
            errorDiv.innerText = 'Network connection error.';
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerText = 'Create Account';
        }
    });
}
