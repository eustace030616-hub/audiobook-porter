#!/usr/bin/env bash
# Install the Clam API as a system service on berry.
# The React PWA is a separate user service on 127.0.0.1:13379.
set -euo pipefail

cd "$(dirname "$0")"

unit=/etc/systemd/system/shelf.service

sudo install -m 0644 shelf.service "$unit"
systemctl --user disable --now shelf.service 2>/dev/null || true
sudo systemctl daemon-reload
sudo systemctl enable --now shelf.service

sleep 1
curl -fsS http://127.0.0.1:13378/health
echo
echo "Clam API is loopback-only on 127.0.0.1:13378."
echo "The PWA is served at https://berry.taild3bc35.ts.net/ via 127.0.0.1:13379."
