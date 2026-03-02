# SOS Dashboard Pro 🚨

A comprehensive tracking and alerting system designed to monitor device locations in real-time. It features a modern web dashboard and a backend engine that integrates with **MQTT**, **Zalo**, and **Firebase Firestore** to ensure you receive immediate alerts when a device leaves a designated safe zone or triggers an SOS signal.

## 🌟 Key Features

- **Live Tracking:** View your device's exact location in real-time on an interactive map.
- **Geofencing (Safe Zone):** Configure a safe zone with a custom radius. If the device moves out of this zone, an alert is automatically sent via Zalo.
- **Instant SOS Alerts:** Receives SOS signals from the IoT device and immediately notifies the target via text and map links.
- **History Playback:** Log GPS history in Firebase and visualize the movement path of the device over time.
- **Battery & Status Monitoring:** Keep an eye on the device's battery life and connectivity status (Online/Offline/Danger).
- **Zalo Integration:** Leverages Zalo API to send instantaneous notifications.
- **Dockerized Architecture:** Easily deploy the Web Dashboard (`app.py`) and the Logic Engine (`logic.py`) using `docker-compose` without polluting your local environment.

---

## 🏗️ Architecture

- **Frontend:** HTML5, CSS3, JavaScript (Vanilla), Leaflet.js (for map rendering).
- **Backend (Web):** Python (Flask) for serving the dashboard and API endpoints.
- **Backend (Engine):** Python script listening to an MQTT broker, processing logic, and sending notifications.
- **Database:** Firebase Firestore (NoSQL) for storing real-time device states and GPS history.

---

## 🚀 Getting Started

Follow these instructions to get a copy of the project up and running on your local machine.

### Prerequisites

1. **Python 3.10+** (if running locally without Docker).
2. **Docker Desktop** (recommended).
3. A **Firebase Service Account** JSON file.
4. An **MQTT Broker**.

### 1. Configure the Environment

Create a `.env` file in the root directory (do **NOT** commit this file):

```env
phone=YOUR_ZALO_PHONE_NUMBER
password=YOUR_ZALO_PASSWORD
imei=YOUR_ZALO_IMEI
cookie=YOUR_ZALO_COOKIE
target_phone=TARGET_PHONE_FOR_ALERTS
target_id=

MQTT_HOST=YOUR_MQTT_BROKER_HOST
MQTT_PORT=YOUR_MQTT_BROKER_PORT
```

### 2. Configure Firebase

Place your Firebase Admin SDK service account key file in the root directory and name it:
`sos-system-928ae-firebase-adminsdk-fbsvc-cc01d315d4.json`
*(Note: If your file has a different name, make sure to update `app.py`, `logic.py`, and `docker-compose.yml` accordingly).*

### 3. Running with Docker (Recommended)

Start both the Web Dashboard and the Logic Engine with a single command:

```bash
docker-compose up -d --build
```

- The Web App will be available at: [http://localhost:5000](http://localhost:5000)
- The Logic Engine will run silently in the background.

To stop the services:
```bash
docker-compose down
```

### 4. Running locally (Without Docker)

Create a virtual environment and install dependencies:
```bash
python -m venv venv
venv\Scripts\activate   # On Windows
pip install -r requirements.txt
```

Run the Web App:
```bash
python app.py
```

Run the Logic Engine *(in a separate terminal)*:
```bash
python logic.py
```

---

## 🔒 Security

- **`.env`** and **`.json`** files contain sensitive credentials. They are listed in `.gitignore` and `.dockerignore` to prevent accidental uploads to version control.
- Ensure your Firebase Database rules are correctly configured if you expose any client-side connections, though this system securely uses the Admin SDK.

---

## 🤝 Contributing

Contributions, issues, and feature requests are welcome! Feel free to check the [issues page].

---

*Powered by Python & Built with ❤️*
