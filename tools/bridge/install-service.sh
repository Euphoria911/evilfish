#!/bin/sh
# Installs the bridge as a systemd user service that starts at login and restarts if it dies.
#   tools/bridge/install-service.sh            install and start
#   tools/bridge/install-service.sh remove     stop and remove
# Settings: EF_THREADS (default 12), EF_HASH in MB (default 256; the WASM engine cannot use more than 1024).
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
UNIT="$HOME/.config/systemd/user/evilfish-bridge.service"
if [ "$1" = "remove" ]; then
  systemctl --user disable --now evilfish-bridge 2>/dev/null || true
  rm -f "$UNIT"; systemctl --user daemon-reload
  echo "removed"; exit 0
fi
[ -d "$ROOT/node_modules/stockfish" ] || { echo "run 'npm install' in $ROOT first (it fetches the engine)"; exit 1; }
mkdir -p "$(dirname "$UNIT")"
cat > "$UNIT" <<UNITEOF
[Unit]
Description=Evilfish local engine bridge

[Service]
WorkingDirectory=$ROOT
ExecStart=$(command -v node) tools/bridge/evilfish-bridge.js
Environment=EF_THREADS=${EF_THREADS:-12}
Environment=EF_HASH=${EF_HASH:-256}
Restart=on-failure
Nice=5

[Install]
WantedBy=default.target
UNITEOF
systemctl --user daemon-reload
systemctl --user enable evilfish-bridge
systemctl --user restart evilfish-bridge
sleep 1
systemctl --user --no-pager status evilfish-bridge | head -4
echo "listening on 127.0.0.1:8765; it now starts at every login"
