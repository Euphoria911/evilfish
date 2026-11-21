#!/bin/sh
# Installs the official Stockfish 19 Linux build (no root, nothing system-wide) where the bridge looks for it:
#   ~/.local/share/evilfish/stockfish  (and a symlink ~/.local/bin/stockfish)
# The download is checked against the SHA-256 that GitHub publishes for the release asset before it is unpacked.
# Why: about 2.3x the nodes per second of the WASM build, start-up in 25 ms instead of seconds, half the memory,
# hash sizes above 1 GB, and Syzygy tablebases.
set -e
ASSET="stockfish-linux-x86-64-universal.tar.gz"
DIR="$(mktemp -d)"
trap 'rm -rf "$DIR"' EXIT
curl -sSf -m 30 https://api.github.com/repos/official-stockfish/Stockfish/releases/latest > "$DIR/release.json"
URL="$(python3 -c "import json,sys; d=json.load(open('$DIR/release.json')); print([a['browser_download_url'] for a in d['assets'] if a['name']=='$ASSET'][0])")"
WANT="$(python3 -c "import json,sys; d=json.load(open('$DIR/release.json')); print([a.get('digest','') for a in d['assets'] if a['name']=='$ASSET'][0].replace('sha256:',''))")"
echo "downloading $URL"
curl -sSfL -m 600 -o "$DIR/sf.tar.gz" "$URL"
GOT="$(sha256sum "$DIR/sf.tar.gz" | cut -d' ' -f1)"
[ -n "$WANT" ] && [ "$GOT" = "$WANT" ] || { echo "checksum mismatch (got $GOT, wanted '$WANT'); not installing"; exit 1; }
tar -xzf "$DIR/sf.tar.gz" -C "$DIR"
mkdir -p "$HOME/.local/share/evilfish" "$HOME/.local/bin"
cp "$DIR/stockfish/stockfish-linux-x86-64-universal" "$HOME/.local/share/evilfish/stockfish"
chmod +x "$HOME/.local/share/evilfish/stockfish"
ln -sf "$HOME/.local/share/evilfish/stockfish" "$HOME/.local/bin/stockfish"
printf 'uci\nquit\n' | "$HOME/.local/share/evilfish/stockfish" | grep '^id name'
echo "installed; restart the bridge: systemctl --user restart evilfish-bridge"
