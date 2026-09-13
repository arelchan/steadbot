#!/usr/bin/env bash
# From your own computer: put crew-server on a fresh Linux machine and install it there, in one go.
#
#   bash crew-server/deploy/remote-install.sh root@1.2.3.4            # HTTP on port 5200
#   bash crew-server/deploy/remote-install.sh root@1.2.3.4 bots.example.com   # HTTPS via a domain that points at the machine
#
# Needs ssh + rsync locally. Installs Docker on the machine if missing, then runs deploy/install.sh there,
# which prints the pairing code for the App.
set -euo pipefail
target="${1:-}"; domain="${2:-}"
[ -n "$target" ] || { echo "usage: bash crew-server/deploy/remote-install.sh root@SERVER-IP [domain]" >&2; exit 1; }
here="$(cd "$(dirname "$0")/.." && pwd)"
echo "▸ copying the code to ${target}:/opt/crew/crew-server …"
# Works whether you log in as root or as a sudo user (Tencent Lighthouse Ubuntu uses `ubuntu`).
ssh -o StrictHostKeyChecking=accept-new "$target" 'sudo mkdir -p /opt/crew/crew-server && sudo chown -R "$(id -u):$(id -g)" /opt/crew'
# The skill library is not synced: the machine pulls it from GitHub during the Docker build (fast from a datacenter).
rsync -az --delete --exclude node_modules --exclude .git --exclude '*.log' --exclude '/library/*/' "$here/" "$target:/opt/crew/crew-server/"
echo "▸ installing on the server (a few minutes the first time) …"
ssh -t "$target" "command -v docker >/dev/null 2>&1 || { echo '▸ installing Docker first …'; curl -fsSL https://get.docker.com | sudo sh; }; sudo DOMAIN='${domain}' CREW_PORT='${CREW_PORT:-5200}' CREW_MTU='${CREW_MTU:-}' bash /opt/crew/crew-server/deploy/install.sh"
