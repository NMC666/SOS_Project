from flask import Flask, render_template, jsonify, request
import redis
import time
import psycopg2
from pathlib import Path

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
REDIS_HOST = env.get("REDIS_HOST") or "127.0.0.1"
REDIS_PORT = int(env.get("REDIS_PORT") or 6379)
REDIS_PASS = env.get("REDIS_PASS")

ssl_conn = True if "aivencloud.com" in REDIS_HOST or "upstash.io" in REDIS_HOST else False
if env.get("REDIS_SSL") == "false" or env.get("REDIS_SSL") == "False":
    ssl_conn = False
else:
    ssl_conn = True # Default from logic.py

r = redis.Redis(
    host=REDIS_HOST,
    port=REDIS_PORT,
    password=REDIS_PASS,
    ssl=ssl_conn,
    decode_responses=True
)

POSTGRES_HOST = env.get("POSTGRES_HOST") or "localhost"
POSTGRES_PORT = env.get("POSTGRES_PORT") or "5432"
POSTGRES_DB = env.get("POSTGRES_DB") or "sosdb"
POSTGRES_USER = env.get("POSTGRES_USER") or "postgres"
POSTGRES_PASS = env.get("POSTGRES_PASS") or ""

pg_conn = None
pg_cursor = None

try:
    pg_conn = psycopg2.connect(
        host=POSTGRES_HOST,
        port=POSTGRES_PORT,
        database=POSTGRES_DB,
        user=POSTGRES_USER,
        password=POSTGRES_PASS
    )
    pg_conn.autocommit = True
    pg_cursor = pg_conn.cursor()
    print("[FLASK] Postgres Connected")
except Exception as e:
    print("[FLASK] Postgres Connection Error:", e)

app = Flask(__name__)

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/data")
def get_data():
    try:
        lat = r.get("sos_lat") or 0.0
        lon = r.get("sos_lon") or 0.0
        battery = r.get("sos_battery") or 0
        status = r.get("sos_status") or "UNKNOWN"
        conf_lat = r.get("config_lat") or 18.67625
        conf_lon = r.get("config_lon") or 105.66854
        radius = r.get("config_radius") or 1000
        last_seen = r.get("sos_last_seen") or 0
        
        # Check if offline
        offline_limit = 600
        is_offline = False
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
        
        if conf_lat is not None:
            r.set("config_lat", str(conf_lat))
        if conf_lon is not None:
            r.set("config_lon", str(conf_lon))
        if radius is not None:
            r.set("config_radius", str(radius))
            
        return jsonify({"status": "success"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/history", methods=["GET"])
def get_history():
    try:
        if pg_cursor:
            pg_cursor.execute("""
                SELECT latitude, longitude, battery, status, extract(epoch from created_at) as time_ts
                FROM gps_history
                ORDER BY created_at DESC
            """)
            rows = pg_cursor.fetchall()
            history_data = []
            for row in rows:
                history_data.append({
                    "lat": float(row[0]),
                    "lon": float(row[1]),
                    "battery": int(row[2]),
                    "status": row[3],
                    "time": float(row[4]) if row[4] else time.time()
                })
            # Reverse to show old to new for playback
            history_data.reverse()
        else:
            import json
            history_raw = r.lrange("sos_history", 0, -1)
            history_data = []
            for item in history_raw:
                try:
                    history_data.append(json.loads(item))
                except json.JSONDecodeError:
                    continue
            history_data.reverse()
            
        return jsonify(history_data)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
   
