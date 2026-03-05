from flask import Flask, render_template, jsonify, request
import time
from pathlib import Path
import firebase_admin
from firebase_admin import credentials, firestore, auth as firebase_auth
from flask_jwt_extended import JWTManager, create_access_token, jwt_required, get_jwt_identity
import requests

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
        cred = credentials.Certificate("serviceAccountKey.json")
        firebase_admin.initialize_app(cred)
    db = firestore.client()
    print("[FLASK] Firebase Connected")
except Exception as e:
    print("[FLASK] Firebase Connection Error:", e)
    db = None

app = Flask(__name__)

app.config["JWT_SECRET_KEY"] = env.get("FLASK_SECRET_KEY", "sos-secret-key-default-123")
app.config["JWT_ACCESS_TOKEN_EXPIRES"] = 604800  # 7 days
jwt = JWTManager(app)

FIREBASE_API_KEY = env.get("FIREBASE_API_KEY")

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/data")
@jwt_required()
def get_data():
    try:
        current_uid = get_jwt_identity()
        devices_data = []

        if db:
            docs = db.collection("devices").where("owner_id", "==", current_uid).stream()
            for doc in docs:
                device_id = doc.id
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
                    
                devices_data.append({
                    "lat": float(lat),
                    "lon": float(lon),
                    "battery": int(battery) if battery else 0,
                    "status": status,
                    "config_lat": float(conf_lat),
                    "config_lon": float(conf_lon),
                    "radius": float(radius),
                    "last_seen": float(last_seen),
                    "last_seen_str": last_seen_str,
                    "silent_seconds": int(silent) if last_seen else 0,
                    "device_id": device_id
                })

        if not devices_data:
            devices_data.append({
                "lat": 0.0,
                "lon": 0.0,
                "battery": 0,
                "status": "UNKNOWN",
                "config_lat": 18.67625,
                "config_lon": 105.66854,
                "radius": 1000.0,
                "last_seen": 0.0,
                "last_seen_str": "Never",
                "silent_seconds": 0,
                "device_id": "Unknown Device"
            })
            
        return jsonify(devices_data)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/settings", methods=["POST"])
@jwt_required()
def update_settings():
    try:
        current_uid = get_jwt_identity()
        data = request.json
        if not data:
            return jsonify({"error": "No data provided"}), 400
            
        conf_lat = data.get("config_lat")
        conf_lon = data.get("config_lon")
        radius = data.get("radius")
        device_id = data.get("device_id") # Optionally specified device
        
        
        updates = {}
        if conf_lat is not None:
            updates["config_lat"] = float(conf_lat)
        if conf_lon is not None:
            updates["config_lon"] = float(conf_lon)
        if radius is not None:
            updates["config_radius"] = float(radius)
            
        
        if updates and db:
            if device_id:
                doc_ref = db.collection("devices").document(device_id)
                doc = doc_ref.get()
                if doc.exists and doc.to_dict().get("owner_id") == current_uid:
                    doc_ref.set(updates, merge=True)
                else:
                    return jsonify({"error": "Unauthorized or device not found"}), 403
            else:
                docs = db.collection("devices").where("owner_id", "==", current_uid).limit(1).stream()
                for doc in docs:
                    db.collection("devices").document(doc.id).set(updates, merge=True)
            
        return jsonify({"status": "success"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/history", methods=["GET"])
@jwt_required()
def get_history():
    try:
        current_uid = get_jwt_identity()
        history_data = []
        if db:
            # Fetch devices owned by user to prevent unauthorized access
            owned_devices = []
            device_docs = db.collection("devices").where("owner_id", "==", current_uid).stream()
            for ddoc in device_docs:
                owned_devices.append(ddoc.id)
                
            if not owned_devices:
                return jsonify([])
                
            query = db.collection("gps_history").order_by("time_ts", direction=firestore.Query.DESCENDING)
            
            # Filter limits and times
            limit_val = request.args.get("limit", default=100, type=int)
            start_time = request.args.get("start_time", type=float)
            end_time = request.args.get("end_time", type=float)
            device_id = request.args.get("device_id")
            
            if device_id and device_id not in owned_devices:
                return jsonify({"error": "Unauthorized device"}), 403
                
            if start_time is not None:
                query = query.where("time_ts", ">=", start_time)
            if end_time is not None:
                query = query.where("time_ts", "<=", end_time)
                
            docs = query.stream()
            
            for doc in docs:
                data = doc.to_dict()
                doc_device = data.get("device_id", "")
                
                # Filter in Python to avoid Firestore Missing Index issue
                if device_id:
                    if doc_device != device_id:
                        continue
                else:
                    if doc_device not in owned_devices:
                        continue
                        
                history_data.append({
                    "lat": float(data.get("latitude", 0)),
                    "lon": float(data.get("longitude", 0)),
                    "battery": int(data.get("battery", 0)),
                    "status": data.get("status", "UNKNOWN"),
                    "time": float(data.get("time_ts", time.time()))
                })
                
                if len(history_data) >= limit_val:
                    break
                    
            # Reverse to show old to new for playback
            history_data.reverse()
            
        return jsonify(history_data)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/register", methods=["POST"])
def register():
    try:
        data = request.json
        if not data:
            return jsonify({"error": "No data provided"}), 400
            
        email = data.get("email")
        password = data.get("password")
        name = data.get("name", "User")
        zalo_phone = data.get("zalo_phone", "")

        if not email or not password:
            return jsonify({"error": "Missing email or password"}), 400

        # Create user in Firebase Auth
        user_record = firebase_auth.create_user(
            email=email,
            password=password,
            display_name=name
        )
        uid = user_record.uid

        # Create document in Firestore
        if db:
            db.collection("users").document(uid).set({
                "email": email,
                "name": name,
                "zalo_phone": zalo_phone,
                "created_at": firestore.SERVER_TIMESTAMP
            })

        return jsonify({"message": "User created successfully", "uid": uid}), 201
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@app.route("/api/login", methods=["POST"])
def login():
    try:
        data = request.json
        if not data:
            return jsonify({"error": "No data provided"}), 400
            
        email = data.get("email")
        password = data.get("password")

        if not email or not password:
            return jsonify({"error": "Missing email or password"}), 400

        if not FIREBASE_API_KEY:
            return jsonify({"error": "Server missing FIREBASE_API_KEY configuration"}), 500

        # Call Firebase Identity Toolkit REST API
        url = f"https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={FIREBASE_API_KEY}"
        payload = {
            "email": email,
            "password": password,
            "returnSecureToken": True
        }
        res = requests.post(url, json=payload)
        res_data = res.json()

        if "error" in res_data:
            return jsonify({"error": res_data["error"].get("message", "Authentication failed")}), 401

        uid = res_data["localId"]
        
        # Generate our own custom JWT 
        access_token = create_access_token(identity=uid)
        
        return jsonify({
            "access_token": access_token,
            "uid": uid,
            "email": email
        }), 200
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/profile", methods=["GET", "POST"])
@jwt_required()
def profile_settings():
    try:
        current_uid = get_jwt_identity()
        if not db:
            return jsonify({"error": "Database error"}), 500
            
        doc_ref = db.collection("users").document(current_uid)
        
        if request.method == "GET":
            doc = doc_ref.get()
            if doc.exists:
                data = doc.to_dict()
                return jsonify({
                    "name": data.get("name", ""),
                    "email": data.get("email", ""),
                    "zalo_phone": data.get("zalo_phone", "")
                }), 200
            else:
                return jsonify({"error": "User not found"}), 404
                
        else: # POST
            data = request.json
            zalo_phone = data.get("zalo_phone")
            
            updates = {}
            if zalo_phone is not None:
                updates["zalo_phone"] = zalo_phone
                
            if updates:
                doc_ref.set(updates, merge=True)
                
            return jsonify({"status": "success", "message": "Profile updated"}), 200
            
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/devices", methods=["GET"])
@jwt_required()
def get_devices():
    try:
        current_uid = get_jwt_identity()
        if not db:
            return jsonify({"error": "Database error"}), 500
            
        devices = []
        docs = db.collection("devices").where("owner_id", "==", current_uid).stream()
        for doc in docs:
            data = doc.to_dict()
            devices.append({
                "id": doc.id,
                "status": data.get("sos_status", "UNKNOWN"),
                "battery": data.get("sos_battery", 0),
                "last_seen": data.get("sos_last_seen", 0)
            })
            
        return jsonify(devices), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/devices/link", methods=["POST"])
@jwt_required()
def link_device():
    try:
        current_uid = get_jwt_identity()
        data = request.json
        device_id = data.get("device_id")
        pin = data.get("pin")
        
        if not device_id or not pin:
            return jsonify({"error": "Missing Device ID or PIN"}), 400
            
        if not db:
            return jsonify({"error": "Database error"}), 500
            
        doc_ref = db.collection("devices").document(device_id)
        doc = doc_ref.get()
        
        if doc.exists:
            doc_data = doc.to_dict()
            if doc_data.get("owner_id") and doc_data.get("owner_id") != current_uid:
                return jsonify({"error": "Device already linked to another account."}), 400
            
            if doc_data.get("pin") and doc_data.get("pin") != pin:
                return jsonify({"error": "Invalid PIN."}), 400
                
            doc_ref.update({"owner_id": current_uid, "pin": pin})
        else:
            doc_ref.set({
                "owner_id": current_uid,
                "pin": pin,
                "sos_status": "UNKNOWN",
                "config_lat": 18.67625,
                "config_lon": 105.66854,
                "config_radius": 1000.0,
                "setup_ts": firestore.SERVER_TIMESTAMP
            }, merge=True)
            
        return jsonify({"status": "success", "message": f"Successfully linked {device_id}!"}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/devices/unlink", methods=["POST"])
@jwt_required()
def unlink_device():
    try:
        current_uid = get_jwt_identity()
        data = request.json
        device_id = data.get("device_id")
        
        if not device_id:
            return jsonify({"error": "Missing Device ID"}), 400
            
        if not db:
            return jsonify({"error": "Database error"}), 500
            
        doc_ref = db.collection("devices").document(device_id)
        doc = doc_ref.get()
        
        if doc.exists:
            doc_data = doc.to_dict()
            if doc_data.get("owner_id") != current_uid:
                return jsonify({"error": "Unauthorized"}), 403
            
            # Remove link by clearing the owner_id
            doc_ref.update({"owner_id": ""})
            return jsonify({"status": "success", "message": f"Successfully unlinked {device_id}!"}), 200
        else:
            return jsonify({"error": "Device not found"}), 404
            
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
