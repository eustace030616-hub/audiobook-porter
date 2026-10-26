#!/usr/bin/env bash
# Run this on berry as eustace (not with sudo): it uses sudo for the
# privileged steps, while `systemctl --user` must stay in eustace's session.
set -euo pipefail

cd "$(dirname "$0")"

unit=/etc/systemd/system/shelf.service
restore_user() {
  sudo systemctl disable --now shelf.service 2>/dev/null || true
  systemctl --user enable --now shelf.service 2>/dev/null || true
}
trap 'if [ "$?" -ne 0 ]; then restore_user; fi' EXIT

sudo install -m 0644 shelf.service "$unit"
systemctl --user disable --now shelf.service 2>/dev/null || true
sudo systemctl daemon-reload

# Create the tailnet listener before starting the loopback service, so the
# first request after migration already has a proxy target.
sudo tailscale serve --bg --http=13378 http://127.0.0.1:13378
sudo systemctl enable --now shelf.service

sleep 1
curl -fsS http://127.0.0.1:13378/health
echo
sudo tailscale serve status

trap - EXIT
echo "shelf is now a system service on 127.0.0.1:13378, served at http://berry:13378"
