#!/bin/zsh

set -euo pipefail

PROJECT_ROOT="${0:A:h:h}"
APP_PATH="$PROJECT_ROOT/dist/TapPilot.app"
INSTALLED_APP_PATH="${TAPPILOT_INSTALL_PATH:-/Applications/TapPilot.app}"
BUILD_MODE="${1:---run}"
CONFIGURATION="${TAPPILOT_CONFIGURATION:-debug}"

function stop_existing() {
  local runtime_status="$HOME/Library/Application Support/TapPilot/runtime.json"
  local bridge_pid=""
  local bridge_command=""
  if [[ -f "$runtime_status" ]]; then
    bridge_pid="$(/opt/homebrew/bin/node -e 'try { const value = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); if (Number.isInteger(value.pid)) process.stdout.write(String(value.pid)); } catch {}' "$runtime_status")"
  fi
  if [[ "$bridge_pid" == <-> ]]; then
    bridge_command="$(ps -p "$bridge_pid" -o command= 2>/dev/null || true)"
  fi

  pkill -x TapPilot 2>/dev/null || true
  if [[ "$bridge_command" == *"$APP_PATH/Contents/Resources/TapPilotRuntime/bridge/index.mjs"* ||
        "$bridge_command" == *"$INSTALLED_APP_PATH/Contents/Resources/TapPilotRuntime/bridge/index.mjs"* ]]; then
    kill "$bridge_pid" 2>/dev/null || true
  else
    bridge_pid=""
  fi

  for attempt in {1..30}; do
    if ! pgrep -x TapPilot >/dev/null 2>&1 &&
       { [[ -z "$bridge_pid" ]] || ! kill -0 "$bridge_pid" 2>/dev/null; }; then
      break
    fi
    sleep 0.1
  done
}

function build_app() {
  stop_existing
  cd "$PROJECT_ROOT"
  npm run build
  arch -arm64 swift build -c "$CONFIGURATION"

  rm -rf "$APP_PATH"
  mkdir -p "$APP_PATH/Contents/MacOS" "$APP_PATH/Contents/Resources/TapPilotRuntime"
  cp "$PROJECT_ROOT/.build/$CONFIGURATION/TapPilot" "$APP_PATH/Contents/MacOS/TapPilot"
  cp "$PROJECT_ROOT/MacApp/Info.plist" "$APP_PATH/Contents/Info.plist"
  cp "$PROJECT_ROOT/MacApp/Resources/ShaneStudio-wordmark.png" "$APP_PATH/Contents/Resources/ShaneStudio-wordmark.png"
  cp "$PROJECT_ROOT/MacApp/Resources/TapPilotMenuIcon.png" "$APP_PATH/Contents/Resources/TapPilotMenuIcon.png"
  cp -R "$PROJECT_ROOT/dist/bridge" "$APP_PATH/Contents/Resources/TapPilotRuntime/bridge"
  cp -R "$PROJECT_ROOT/dist/web" "$APP_PATH/Contents/Resources/TapPilotRuntime/web"

  local iconset
  iconset="$(mktemp -d)/AppIcon.iconset"
  mkdir -p "$iconset"
  sips -z 16 16 "$PROJECT_ROOT/MacApp/Resources/AppIcon-1024.png" --out "$iconset/icon_16x16.png" >/dev/null
  sips -z 32 32 "$PROJECT_ROOT/MacApp/Resources/AppIcon-1024.png" --out "$iconset/icon_16x16@2x.png" >/dev/null
  sips -z 32 32 "$PROJECT_ROOT/MacApp/Resources/AppIcon-1024.png" --out "$iconset/icon_32x32.png" >/dev/null
  sips -z 64 64 "$PROJECT_ROOT/MacApp/Resources/AppIcon-1024.png" --out "$iconset/icon_32x32@2x.png" >/dev/null
  sips -z 128 128 "$PROJECT_ROOT/MacApp/Resources/AppIcon-1024.png" --out "$iconset/icon_128x128.png" >/dev/null
  sips -z 256 256 "$PROJECT_ROOT/MacApp/Resources/AppIcon-1024.png" --out "$iconset/icon_128x128@2x.png" >/dev/null
  sips -z 256 256 "$PROJECT_ROOT/MacApp/Resources/AppIcon-1024.png" --out "$iconset/icon_256x256.png" >/dev/null
  sips -z 512 512 "$PROJECT_ROOT/MacApp/Resources/AppIcon-1024.png" --out "$iconset/icon_256x256@2x.png" >/dev/null
  sips -z 512 512 "$PROJECT_ROOT/MacApp/Resources/AppIcon-1024.png" --out "$iconset/icon_512x512.png" >/dev/null
  cp "$PROJECT_ROOT/MacApp/Resources/AppIcon-1024.png" "$iconset/icon_512x512@2x.png"
  iconutil -c icns "$iconset" -o "$APP_PATH/Contents/Resources/AppIcon.icns"
  local sign_identity="${TAPPILOT_SIGN_IDENTITY:-Apple Development: Peishen Li (MYH8W66K47)}"
  if ! security find-identity -v -p codesigning | grep -Fq "$sign_identity"; then
    sign_identity="-"
  fi
  codesign --force --deep --sign "$sign_identity" "$APP_PATH"
}

function launch_app() {
  if [[ "${INSTALLED_APP_PATH:t}" != "TapPilot.app" ]]; then
    echo "拒绝安装到非 TapPilot.app 目标：$INSTALLED_APP_PATH"
    exit 64
  fi
  mkdir -p "$INSTALLED_APP_PATH"
  /usr/bin/rsync -a --delete "$APP_PATH/" "$INSTALLED_APP_PATH/"
  codesign --verify --deep --strict "$INSTALLED_APP_PATH"
  open "$INSTALLED_APP_PATH"
}

case "$BUILD_MODE" in
  --build)
    build_app
    ;;
  --run)
    build_app
    launch_app
    ;;
  --verify)
    build_app
    launch_app
    local verified=0
    for attempt in {1..180}; do
      if pgrep -x TapPilot >/dev/null && curl --silent --fail "http://127.0.0.1:8788/api/health" >/dev/null 2>&1; then
        verified=1
        break
      fi
      sleep 0.25
    done
    if [[ "$verified" != "1" ]]; then
      echo "TapPilot App 或 Bridge 未能在 45 秒内就绪。"
      exit 1
    fi
    echo "TapPilot.app 已启动，Bridge 健康检查通过。"
    ;;
  --logs)
    tail -n 120 -f "$HOME/Library/Logs/TapPilot/bridge.log"
    ;;
  --telemetry)
    log stream --style compact --predicate 'process == "TapPilot"'
    ;;
  *)
    echo "用法: $0 [--build|--run|--verify|--logs|--telemetry]"
    exit 64
    ;;
esac
