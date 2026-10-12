#!/usr/bin/env bash
# The board as the suite draws it, with this plugin's source, in headless
# Chromium. Needs the nexus-suite checkout next to this one.
set -euo pipefail
cd "$(dirname "$0")/.."
PORT=8746
npx esbuild test/board-entry.js --bundle --format=iife --platform=browser --target=es2018 \
  --alias:obsidian=../nexus-suite/test/obsidian-stub.js --outfile=test/board-bundle.js --log-level=error
python3 -m http.server "$PORT" --directory test >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
sleep 1
result=$(chromium --headless --disable-gpu --no-sandbox --virtual-time-budget=5000 \
  --dump-dom "http://localhost:$PORT/board.html" 2>/dev/null | python3 -c "
import sys, re, html
d = sys.stdin.read()
m = re.search(r'<pre id=\"out\">(.*?)</pre>', d, re.S)
print(html.unescape(m.group(1)).strip() if m else 'NO OUTPUT - the page did not run')
")
echo "$result"
echo "$result" | grep -q "ALL GREEN"
