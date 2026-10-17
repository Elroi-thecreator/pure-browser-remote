import asyncio
import json
import uuid
import sys
import traceback
import requests
import websockets

RELAY_HTTP = "https://pure-browser-remote-relay-8bpt.onrender.com"
RELAY_WS = "wss://pure-browser-remote-relay-8bpt.onrender.com"

PASS_COUNT = 0
FAIL_COUNT = 0

def log_test(name, success, details=""):
    global PASS_COUNT, FAIL_COUNT
    if success:
        PASS_COUNT += 1
        print(f"  [PASS] {name} {details}")
    else:
        FAIL_COUNT += 1
        print(f"  [FAIL] {name} -> {details}")

def test_http_endpoints():
    print("\n--- 1. Testing Live HTTP Endpoints on Render ---")
    
    # 1.1 Status / Root Endpoint (Serves Viewer Web App on root)
    try:
        r = requests.get(f"{RELAY_HTTP}/", timeout=15)
        log_test("GET / (Root Web Client)", r.status_code == 200 and "Pure Browser Remote" in r.text, f"status={r.status_code}, length={len(r.text)}")
    except Exception as e:
        log_test("GET /", False, str(e))

    # 1.2 Health Endpoint
    try:
        r = requests.get(f"{RELAY_HTTP}/health", timeout=15)
        data = r.json()
        log_test("GET /health (Monitoring)", r.status_code == 200 and data.get("status") == "ok", f"status={r.status_code}, data={data}")
    except Exception as e:
        log_test("GET /health", False, str(e))

    # 1.3 Privacy Policy
    try:
        r = requests.get(f"{RELAY_HTTP}/privacy", timeout=15)
        log_test("GET /privacy (CWS Compliance)", r.status_code == 200 and "Privacy Policy" in r.text, f"status={r.status_code}, length={len(r.text)}")
    except Exception as e:
        log_test("GET /privacy", False, str(e))

    # 1.4 Viewer Web App
    try:
        r = requests.get(f"{RELAY_HTTP}/viewer/", timeout=15)
        log_test("GET /viewer/ (Static App)", r.status_code == 200 and "Pure Browser Remote" in r.text, f"status={r.status_code}, length={len(r.text)}")
    except Exception as e:
        log_test("GET /viewer/", False, str(e))

    # 1.5 Host Web Fallback
    try:
        r = requests.get(f"{RELAY_HTTP}/host", timeout=15)
        log_test("GET /host (Zero-Install Fallback)", r.status_code == 200 or r.status_code == 404, f"status={r.status_code}")
    except Exception as e:
        log_test("GET /host", False, str(e))

def test_auth_workflow():
    print("\n--- 2. Testing Account Authentication & Device API ---")
    test_user = f"e2e_{uuid.uuid4().hex[:8]}"
    test_pass = "TestPassword123!"

    # 2.1 Register New Account
    token = None
    try:
        r = requests.post(f"{RELAY_HTTP}/api/auth/register", json={"username": test_user, "password": test_pass}, timeout=15)
        data = r.json()
        token = data.get("token")
        log_test("POST /api/auth/register", r.status_code == 200 and token is not None, f"user={test_user}, token={token[:12]}...")
    except Exception as e:
        log_test("POST /api/auth/register", False, str(e))

    # 2.2 Reject Duplicate Registration
    try:
        r = requests.post(f"{RELAY_HTTP}/api/auth/register", json={"username": test_user, "password": test_pass}, timeout=15)
        log_test("POST duplicate register (409 Conflict)", r.status_code == 409, f"status={r.status_code}")
    except Exception as e:
        log_test("POST duplicate register", False, str(e))

    # 2.3 Reject Wrong Password Login
    try:
        r = requests.post(f"{RELAY_HTTP}/api/auth/login", json={"username": test_user, "password": "WrongPassword"}, timeout=15)
        log_test("POST login wrong password (401)", r.status_code == 401, f"status={r.status_code}")
    except Exception as e:
        log_test("POST login wrong password", False, str(e))

    # 2.4 Valid Login
    try:
        r = requests.post(f"{RELAY_HTTP}/api/auth/login", json={"username": test_user, "password": test_pass}, timeout=15)
        data = r.json()
        log_test("POST /api/auth/login", r.status_code == 200 and data.get("token") is not None, f"status={r.status_code}")
    except Exception as e:
        log_test("POST /api/auth/login", False, str(e))

    # 2.5 Devices API with valid token
    try:
        headers = {"Authorization": f"Bearer {token}"}
        r = requests.get(f"{RELAY_HTTP}/api/devices", headers=headers, timeout=15)
        data = r.json()
        log_test("GET /api/devices (Authorized)", r.status_code == 200 and "devices" in data, f"devices count={len(data.get('devices', []))}")
    except Exception as e:
        log_test("GET /api/devices", False, str(e))

    return test_user, test_pass, token

async def test_websocket_pin_signaling():
    print("\n--- 3. Testing WebSocket PIN-Based WebRTC Relay ---")
    test_pin = f"P{uuid.uuid4().hex[:5].upper()}"

    try:
        async with websockets.connect(RELAY_WS, ssl=True) as host_ws, websockets.connect(RELAY_WS, ssl=True) as viewer_ws:
            # 3.1 Host Registers PIN Room
            await host_ws.send(json.dumps({"type": "register-host", "pin": test_pin}))
            h_res = json.loads(await asyncio.wait_for(host_ws.recv(), timeout=10))
            log_test("WebSocket Host Register PIN", h_res.get("type") == "host-registered" and h_res.get("pin") == test_pin, f"pin={test_pin}")

            # 3.2 Viewer Joins PIN Room
            await viewer_ws.send(json.dumps({"type": "join-viewer", "pin": test_pin}))
            v_res = json.loads(await asyncio.wait_for(viewer_ws.recv(), timeout=10))
            log_test("WebSocket Viewer Accepted PIN", v_res.get("type") == "viewer-accepted" and v_res.get("pin") == test_pin)

            # 3.3 Host receives viewer-joined event
            h_notif = json.loads(await asyncio.wait_for(host_ws.recv(), timeout=10))
            log_test("Host receives viewer-joined event", h_notif.get("type") == "viewer-joined")

            # 3.4 WebRTC Offer Relay: Host -> Viewer
            sample_offer = {"type": "offer", "sdp": "v=0\r\no=mock 12345 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n"}
            await host_ws.send(json.dumps({"type": "signal", "data": sample_offer}))
            v_signal = json.loads(await asyncio.wait_for(viewer_ws.recv(), timeout=10))
            log_test("SDP Offer Relay Host -> Viewer", v_signal.get("type") == "signal" and v_signal.get("data", {}).get("type") == "offer")

            # 3.5 WebRTC Answer Relay: Viewer -> Host
            sample_answer = {"type": "answer", "sdp": "v=0\r\no=mock 67890 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n"}
            await viewer_ws.send(json.dumps({"type": "signal", "data": sample_answer}))
            h_signal = json.loads(await asyncio.wait_for(host_ws.recv(), timeout=10))
            log_test("SDP Answer Relay Viewer -> Host", h_signal.get("type") == "signal" and h_signal.get("data", {}).get("type") == "answer")

            # 3.6 ICE Candidate Relay: Viewer -> Host
            sample_ice = {"candidate": "candidate:1 1 UDP 2130706431 192.168.1.100 50000 typ host", "sdpMid": "0", "sdpMLineIndex": 0}
            await viewer_ws.send(json.dumps({"type": "signal", "data": sample_ice}))
            h_ice = json.loads(await asyncio.wait_for(host_ws.recv(), timeout=10))
            log_test("ICE Candidate Relay Viewer -> Host", h_ice.get("type") == "signal" and "candidate" in h_ice.get("data", {}))

    except Exception as e:
        traceback.print_exc()
        log_test("WebSocket PIN-based signaling flow", False, repr(e))

async def test_websocket_account_signaling(token):
    print("\n--- 4. Testing WebSocket Account Mode & Device Presence ---")
    device_id = f"dev_test_{uuid.uuid4().hex[:6]}"
    device_name = "Automated Test Rig"

    try:
        async with websockets.connect(RELAY_WS, ssl=True) as host_ws, websockets.connect(RELAY_WS, ssl=True) as viewer_ws:
            # 4.1 Host registers device with auth token
            await host_ws.send(json.dumps({
                "type": "auth-host",
                "token": token,
                "deviceId": device_id,
                "deviceName": device_name
            }))
            reg_resp = json.loads(await asyncio.wait_for(host_ws.recv(), timeout=10))
            log_test("Host auth-host over WS", reg_resp.get("type") == "host-authenticated" and reg_resp.get("deviceId") == device_id, f"deviceId={device_id}")

            # 4.2 Viewer initializes dashboard view
            await viewer_ws.send(json.dumps({
                "type": "auth-viewer",
                "token": token
            }))
            dash_resp = json.loads(await asyncio.wait_for(viewer_ws.recv(), timeout=10))
            devices = dash_resp.get("devices", [])
            has_device = any(d.get("deviceId") == device_id and d.get("isOnline") for d in devices)
            log_test("Viewer auth-viewer presence listing", dash_resp.get("type") == "viewer-authenticated" and has_device, f"online devices={len(devices)}")

            # 4.3 Viewer requests 1-click connection to host device
            await viewer_ws.send(json.dumps({
                "type": "connect-device",
                "deviceId": device_id
            }))

            # Both host and viewer receive connection confirmations
            h_evt = json.loads(await asyncio.wait_for(host_ws.recv(), timeout=10))
            v_evt = json.loads(await asyncio.wait_for(viewer_ws.recv(), timeout=10))
            log_test("Host receives viewer-joined", h_evt.get("type") == "viewer-joined" and h_evt.get("deviceId") == device_id)
            log_test("Viewer receives device-accepted", v_evt.get("type") == "device-accepted" and v_evt.get("deviceId") == device_id)

            # 4.4 WebRTC Signal relay over Account session
            test_signal = {"type": "offer", "sdp": "v=0\r\no=account_test 1111 2 IN IP4 127.0.0.1\r\ns=-\r\n"}
            await host_ws.send(json.dumps({"type": "signal", "data": test_signal}))
            v_sig = json.loads(await asyncio.wait_for(viewer_ws.recv(), timeout=10))
            log_test("Account WebRTC Signal Relay Host -> Viewer", v_sig.get("type") == "signal" and v_sig.get("data", {}).get("type") == "offer")

    except Exception as e:
        traceback.print_exc()
        log_test("WebSocket Account-based signaling flow", False, repr(e))

async def main():
    print("==================================================")
    print(" Pure Browser Remote - Live End-to-End Test Suite")
    print("==================================================")
    test_http_endpoints()
    user, pwd, token = test_auth_workflow()
    await test_websocket_pin_signaling()
    if token:
        await test_websocket_account_signaling(token)
    
    print("\n==================================================")
    print(f" Test Results Summary: {PASS_COUNT} Passed, {FAIL_COUNT} Failed")
    print("==================================================")
    if FAIL_COUNT > 0:
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(main())
