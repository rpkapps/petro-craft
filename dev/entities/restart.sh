#!/bin/sh
# Restart the no-HMR entity dev server on port 5231 (it does not watch files; restart after edits).
cd "$(dirname "$0")/../.." || exit 1
for p in $(pgrep -f "vite.nohmr.config.mjs --port 5231"); do kill "$p"; done
sleep 1
nohup npx vite --config dev/entities/vite.nohmr.config.mjs --port 5231 --strictPort > /tmp/vite5231.log 2>&1 &
sleep 5
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5231/dev/entities/
