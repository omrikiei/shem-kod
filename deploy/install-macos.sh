#!/bin/sh
# מתקין את שרת "שם קוד" כשירות שעולה אוטומטית עם הכניסה למחשב.
# להרצה במסוף רגיל (לא דרך Hermes):  sh deploy/install-macos.sh
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node)"
PLIST="$HOME/Library/LaunchAgents/com.omri.shem-kod.plist"
mkdir -p "$HOME/.shem-kod" "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.omri.shem-kod</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$DIR/server.js</string></array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>EnvironmentVariables</key><dict><key>PORT</key><string>8787</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HOME/.shem-kod/server.log</string>
  <key>StandardErrorPath</key><string>$HOME/.shem-kod/server.log</string>
</dict></plist>
PL
# אם כבר רץ שרת ידני על הפורט, עוצרים אותו כדי שהשירות יתפוס את הפורט
PID="$(lsof -ti tcp:8787 2>/dev/null || true)"
[ -n "$PID" ] && kill $PID 2>/dev/null && sleep 1
launchctl bootout "gui/$(id -u)/com.omri.shem-kod" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "הותקן. שרת על פורט 8787, לוג ב-~/.shem-kod/server.log"
echo "הסרה: launchctl bootout gui/$(id -u)/com.omri.shem-kod && rm \"$PLIST\""
