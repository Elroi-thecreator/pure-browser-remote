#!/usr/bin/env bash
set -e

echo "======================================================================"
echo "    Chrome OS Remote Desktop - Unix/macOS Native Host Installer       "
echo "======================================================================"

# 1. Verify Python 3
if ! command -v python3 &> /dev/null; then
    echo "[ERROR] python3 could not be found. Please install Python 3.8+."
    exit 1
fi

echo "[1/4] Python 3 detected. Installing dependencies..."
pip3 install -r "$(dirname "$0")/requirements.txt"

# 2. Acquire Chrome Extension ID
EXT_ID="$1"
if [ -z "$EXT_ID" ]; then
    echo ""
    echo "Please open chrome://extensions in Chrome, find 'Chrome OS Remote Desktop Host',"
    echo "and copy the 32-character Extension ID."
    echo ""
    read -rp "Paste your Chrome Extension ID here: " EXT_ID
fi

if [ -z "$EXT_ID" ]; then
    echo "[ERROR] No Extension ID provided. Aborting."
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PYTHON_SCRIPT="$SCRIPT_DIR/os_controller.py"
chmod +x "$PYTHON_SCRIPT"

MANIFEST_FILE="$SCRIPT_DIR/com.remote.oscontroller.json"

echo "[2/4] Generating Native Messaging Host manifest..."
cat > "$MANIFEST_FILE" <<EOF
{
  "name": "com.remote.oscontroller",
  "description": "Chrome OS Remote Desktop Native Input Injection Host",
  "path": "$PYTHON_SCRIPT",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$EXT_ID/"
  ]
}
EOF

# 3. Detect OS & copy manifest to target Chrome directories
echo "[3/4] Registering host manifest in browser configuration paths..."

OS_TYPE="$(uname -s)"
TARGET_DIRS=()

if [ "$OS_TYPE" = "Darwin" ]; then
    # macOS paths
    TARGET_DIRS+=(
        "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
        "$HOME/Library/Application Support/Chromium/NativeMessagingHosts"
        "$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts"
    )
elif [ "$OS_TYPE" = "Linux" ]; then
    # Linux paths
    TARGET_DIRS+=(
        "$HOME/.config/google-chrome/NativeMessagingHosts"
        "$HOME/.config/chromium/NativeMessagingHosts"
        "$HOME/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts"
    )
else
    echo "[WARNING] Unknown Unix flavor: $OS_TYPE. Register manually if necessary."
fi

for DIR in "${TARGET_DIRS[@]}"; do
    mkdir -p "$DIR"
    cp "$MANIFEST_FILE" "$DIR/com.remote.oscontroller.json"
    echo "  -> Registered in: $DIR/com.remote.oscontroller.json"
done

echo ""
echo "======================================================================"
echo "  [SUCCESS] Native Messaging Host installed and registered!           "
echo "======================================================================"
echo "  Host Manifest: $MANIFEST_FILE"
echo "  Target Script: $PYTHON_SCRIPT"
echo "  Authorized Extension: chrome-extension://$EXT_ID/"
echo "======================================================================"
