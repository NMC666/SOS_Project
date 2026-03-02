import paho.mqtt.client as mqtt 
import time
import threading
import math
import firebase_admin
from firebase_admin import credentials, firestore
from geopy.geocoders import Nominatim
from http.cookies import SimpleCookie
from pathlib import Path

from zlapi import ZaloAPI
from zlapi.models import Message, ThreadType


# ==========================================================
# 1. LOAD ENV
# ==========================================================

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


def parse_cookie(cookie_str: str) -> dict:
    jar = SimpleCookie()
    jar.load(cookie_str)
    return {key: morsel.value for key, morsel in jar.items()}


env = load_env_file()


# ==========================================================
# 2. CONFIG
# ==========================================================

PHONE = env.get("phone")
PASSWORD = env.get("password")
IMEI = env.get("imei")
COOKIE_STR = env.get("cookie") or ""
COOKIES = parse_cookie(COOKIE_STR) if COOKIE_STR else {}

TARGET_PHONE = env.get("target_phone")
TARGET_ID = env.get("target_id") or ""

MQTT_HOST = env.get("MQTT_HOST")
MQTT_PORT = int(env.get("MQTT_PORT") or 1883)

OFFLINE_LIMIT = 600


# ==========================================================
# 3. INIT FIREBASE + ZALO
# ==========================================================

try:
    cred = credentials.Certificate("sos-system-928ae-firebase-adminsdk-fbsvc-cc01d315d4.json")
    firebase_admin.initialize_app(cred)
    db = firestore.client()
    print("[FIREBASE] Connected")
except Exception as e:
    print("[FIREBASE] Connection Error:", e)
    db = None

geolocator = Nominatim(user_agent="sos_pro_engine")

last_status = "SAFE"
last_offline_sent = False


try:
    bot = ZaloAPI(phone=PHONE, password=PASSWORD, imei=IMEI, cookies=COOKIES)
except TypeError:
    bot = ZaloAPI(PHONE, PASSWORD, IMEI, COOKIES)

final_target_id = TARGET_ID

if not final_target_id and TARGET_PHONE:
    user = bot.fetchPhoneNumber(TARGET_PHONE)
    final_target_id = (
        getattr(user, "userId", None)
        or getattr(user, "uid", None)
        or (user.get("userId") if isinstance(user, dict) else None)
        or (user.get("uid") if isinstance(user, dict) else None)
    )

print("[ZALO] Target:", final_target_id)


# ==========================================================
# 4. HELPER
# ==========================================================

def distance_m(lat1, lon1, lat2, lon2):
    R = 6371000
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)

    a = math.sin(dphi/2)**2 + \
        math.cos(phi1) * math.cos(phi2) * math.sin(dlambda/2)**2

    return 2 * R * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def reverse_address(lat, lon):
    try:
        location = geolocator.reverse(f"{lat}, {lon}", timeout=5)
        if location:
            return location.address.replace("\n", ", ")
    except:
        pass
    return "Khong xac dinh"


def send_zalo(text):
    try:
        message = Message(text=text)
        bot.send(message, thread_id=final_target_id, thread_type=ThreadType.USER)
        print("[ZALO] Sent")
    except Exception as e:
        print("[ZALO] Error:", e)


def insert_firebase_history(lat, lon, bat, status):
    if not db:
        return
    try:
        db.collection("gps_history").add({
            "latitude": lat,
            "longitude": lon,
            "battery": int(bat),
            "status": status,
            "time_ts": time.time(),
            "created_at": firestore.SERVER_TIMESTAMP
        })
    except Exception as e:
        print("Firebase Insert Error:", e)


# ==========================================================
# 5. OFFLINE CHECK THREAD
# ==========================================================

def check_offline_loop():
    global last_offline_sent

    while True:
        try:
            if db:
                doc_ref = db.collection("devices").document("001")
                doc = doc_ref.get()
                if doc.exists:
                    data = doc.to_dict()
                    last_seen = data.get("sos_last_seen")

                    if last_seen:
                        silent = time.time() - float(last_seen)

                        if silent > OFFLINE_LIMIT:
                            if not last_offline_sent:
                                send_zalo("🚨 CANH BAO: Thiet bi da mat ket noi qua 10 phut!")
                                doc_ref.update({"sos_status": "OFFLINE"})
                                last_offline_sent = True
                        else:
                            last_offline_sent = False

        except Exception as e:
            print("Heartbeat Error:", e)

        time.sleep(30)


threading.Thread(target=check_offline_loop, daemon=True).start()


# ==========================================================
# 6. MQTT CALLBACKS
# ==========================================================

def on_connect(client, userdata, flags, rc, properties=None):
    if rc == 0:
        print("[MQTT] Connected")
        client.subscribe("sos/device/001")
    else:
        print("[MQTT] Failed:", rc)


def on_disconnect(client, userdata, rc, properties=None):
    print("[MQTT] Disconnected:", rc)


def on_message(client, userdata, msg):
    global last_status

    try:
        payload = msg.payload.decode().strip()
        parts = [x.strip() for x in payload.split("|")]

        if len(parts) < 4:
            print("Invalid payload:", payload)
            return

        msg_type = parts[0]
        lat = float(parts[1])
        lon = float(parts[2])
        bat = parts[3].replace("BATTERY_", "").replace("%", "").strip()

        if not db:
            return

        doc_ref = db.collection("devices").document("001")
                
        doc_ref.set({
            "sos_last_seen": time.time(),
            "sos_conn_status": "ONLINE",
            "sos_lat": lat,
            "sos_lon": lon,
            "sos_battery": bat
        }, merge=True)

        # SAVE HISTORY TO FIREBASE
        insert_firebase_history(lat, lon, bat, last_status)

        if msg_type == "SOS":

            def handle_sos():
                addr = reverse_address(lat, lon)
                text = (
                    f"🚨 NUT SOS DUOC BAM!\n"
                    f"🔋 Pin: {bat}%\n"
                    f"📍 {addr}\n"
                    f"https://maps.google.com/?q={lat},{lon}"
                )
                send_zalo(text)

            threading.Thread(target=handle_sos, daemon=True).start()
            print("[SOS BUTTON TRIGGERED]")
            
            # Cập nhật trạng thái lên Firebase để Web nhận được
            doc_ref.update({"sos_status": "SOS"})
            last_status = "SOS"
            
            return

        doc = doc_ref.get()
        doc_data = doc.to_dict() if doc.exists else {}

        conf_lat = float(doc_data.get("config_lat", 18.67625))
        conf_lon = float(doc_data.get("config_lon", 105.66854))
        radius = float(doc_data.get("config_radius", 1000))

        dist = distance_m(lat, lon, conf_lat, conf_lon)

        if dist > radius + 50:
            status = "DANGER"
        elif dist < radius - 50:
            status = "SAFE"
        else:
            status = last_status

        doc_ref.update({"sos_status": status})

        if status == "DANGER":

            def handle_danger():
                addr = reverse_address(lat, lon)
                text = (
                    f"🚨 SOS DANGER!\n"
                    f"🔋 Pin: {bat}%\n"
                    f"📍 {addr}\n"
                    f"https://maps.google.com/?q={lat},{lon}"
                )
                send_zalo(text)

            threading.Thread(target=handle_danger, daemon=True).start()

        last_status = status

        print(f"[{status}] {dist:.1f}m | Pin {bat}%")

    except Exception as e:
        print("Logic Error:", e)


# ==========================================================
# 7. RUN ENGINE
# ==========================================================

mqtt_client = mqtt.Client(
    mqtt.CallbackAPIVersion.VERSION2,
    transport="websockets"
)

mqtt_client.on_connect = on_connect
mqtt_client.on_disconnect = on_disconnect
mqtt_client.on_message = on_message

mqtt_client.reconnect_delay_set(min_delay=1, max_delay=15)

print(f"[MQTT] Connecting {MQTT_HOST}:{MQTT_PORT}")
mqtt_client.connect_async(MQTT_HOST, MQTT_PORT, 60)

mqtt_client.loop_start()

print("[ENGINE] Running...")

try:
    while True:
        time.sleep(1)

except KeyboardInterrupt:
    print("\n[ENGINE] Stopping...")

finally:
    try:
        mqtt_client.loop_stop()
        mqtt_client.disconnect()
    except:
        pass

    print("[ENGINE] Shutdown complete.")