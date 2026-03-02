from flask import Flask, render_template, jsonify, request
import time
from pathlib import Path
import firebase_admin
from firebase_admin import credentials, firestore

def load_env_file() -> dict:
    env_path = Path(".env")
    if not env_path.exists():
        return {}
    data = {}
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        data[key.strip()] = value.strip()
    return data

env = load_env_file()

try:
    if not firebase_admin._apps:
        cred = credentials.Certificate("sos-system-928ae-firebase-adminsdk-fbsvc-cc01d315d4.json")
        firebase_admin.initialize_app(cred)
    db = firestore.client()
    print("[FLASK] Firebase Connected")
except Exception as e:
    print("[FLASK] Firebase Connection Error:", e)
    db = None

app = Flask(__name__)

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/data")
def get_data():
    try:
        lat = 0.0
        lon = 0.0
        battery = 0
        status = "UNKNOWN"
        conf_lat = 18.67625
        conf_lon = 105.66854
        radius = 1000.0
        last_seen = 0

        if db:
            doc_ref = db.collection("devices").document("001")
            doc = doc_ref.get()
            if doc.exists:
                data = doc.to_dict()
                lat = data.get("sos_lat", 0.0)
                lon = data.get("sos_lon", 0.0)
                battery = data.get("sos_battery", 0)
                status = data.get("sos_status", "UNKNOWN")
                conf_lat = data.get("config_lat", 18.67625)
                conf_lon = data.get("config_lon", 105.66854)
                radius = data.get("config_radius", 1000.0)
                last_seen = data.get("sos_last_seen", 0)
        
        # Check if offline
        offline_limit = 600
        is_offline = False
        silent = 0
        if last_seen:
            silent = time.time() - float(last_seen)
            if silent > offline_limit:
                is_offline = True
                status = "OFFLINE"
        else:
            is_offline = True
            status = "UNKNOWN"
            silent = 0
            
        # Optional helper to format time
        if last_seen:
            last_seen_str = time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(float(last_seen)))
        else:
            last_seen_str = "Never"
            
        return jsonify({
            "lat": float(lat),
            "lon": float(lon),
            "battery": int(battery) if battery else 0,
            "status": status,
            "config_lat": float(conf_lat),
            "config_lon": float(conf_lon),
            "radius": float(radius),
            "last_seen": float(last_seen),
            "last_seen_str": last_seen_str,
            "silent_seconds": int(silent) if last_seen else 0
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/settings", methods=["POST"])
def update_settings():
    try:
        data = request.json
        if not data:
            return jsonify({"error": "No data provided"}), 400
            
        conf_lat = data.get("config_lat")
        conf_lon = data.get("config_lon")
        radius = data.get("radius")
        
        updates = {}
        if conf_lat is not None:
            updates["config_lat"] = float(conf_lat)
        if conf_lon is not None:
            updates["config_lon"] = float(conf_lon)
        if radius is not None:
            updates["config_radius"] = float(radius)
            
        if updates and db:
            db.collection("devices").document("001").set(updates, merge=True)
            
        return jsonify({"status": "success"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/history", methods=["GET"])
def get_history():
    try:
        history_data = []
        if db:
            docs = db.collection("gps_history").order_by("created_at", direction=firestore.Query.DESCENDING).limit(100).stream()
            for doc in docs:
                data = doc.to_dict()
                history_data.append({
                    "lat": float(data.get("latitude", 0)),
                    "lon": float(data.get("longitude", 0)),
                    "battery": int(data.get("battery", 0)),
                    "status": data.get("status", "UNKNOWN"),
                    "time": float(data.get("time_ts", time.time()))
                })
            # Reverse to show old to new for playback
            history_data.reverse()
            
        return jsonify(history_data)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
   
