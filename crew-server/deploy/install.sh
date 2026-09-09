#!/usr/bin/env bash
# Set up crew-server on a Linux machine that stays on, then print the pairing code the App asks for.
#
#   bash deploy/install.sh                 # plain HTTP on port 5200 (fine inside a trusted network / behind your own TLS)
#   DOMAIN=bots.example.com bash deploy/install.sh   # public HTTPS via Caddy (DNS must already point here)
#
# Requires: docker with the compose plugin. Run from a checkout of the repo (this script lives in crew-server/deploy).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
cd "$here"

if ! command -v docker >/dev/null 2>&1; then
  echo "▸ 没有 Docker，先装…"
  curl -fsSL https://get.docker.com | sh
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "需要 docker compose 插件（docker-compose-plugin）。" >&2; exit 1
fi

# A path that drops full-size packets (probed by the App during one-click install): lower the MTU here, persistently,
# and give containers the same MTU so the App's packets to them are not dropped either. Remembered in .env for re-runs.
if [ -z "${CREW_MTU:-}" ] && [ -f .mtu ]; then CREW_MTU="$(cat .mtu 2>/dev/null | tr -dc 0-9)"; fi
if [ -z "${CREW_MTU:-}" ] && [ -f .env ]; then CREW_MTU="$(sed -n 's/^CREW_MTU=//p' .env)"; fi
if [ -n "${CREW_MTU:-}" ]; then
  iface="$(ip route show default | awk '/default/ {print $5; exit}')"
  echo "▸ 这条网络对大包不友好：把 ${iface} 的 MTU 设为 ${CREW_MTU}（开机自动生效）"
  ip link set dev "$iface" mtu "$CREW_MTU" 2>/dev/null || true
  cat > /etc/systemd/system/crew-mtu.service <<UNIT
[Unit]
Description=crew: lower MTU (the path to the user's network drops large packets)
After=network-online.target
Wants=network-online.target
[Service]
Type=oneshot
ExecStart=/bin/sh -c 'ip link set dev ${iface} mtu ${CREW_MTU}'
[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload 2>/dev/null && systemctl enable crew-mtu.service >/dev/null 2>&1 || true
  mkdir -p /etc/docker
  if [ -f /etc/docker/daemon.json ] && command -v python3 >/dev/null 2>&1; then
    python3 - "$CREW_MTU" <<'PY'
import json, sys
p = '/etc/docker/daemon.json'
try:
    d = json.load(open(p))
except Exception:
    d = {}
d['mtu'] = int(sys.argv[1])
json.dump(d, open(p, 'w'), indent=2)
PY
  else
    printf '{\n  "mtu": %s\n}\n' "$CREW_MTU" > /etc/docker/daemon.json
  fi
  systemctl restart docker 2>/dev/null || true
fi

# Keep an existing token so re-running the script never locks out a paired App.
if [ -f .env ] && grep -q '^CREW_AUTH_TOKEN=' .env; then
  token="$(sed -n 's/^CREW_AUTH_TOKEN=//p' .env)"
else
  token="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
fi
port="${CREW_PORT:-5200}"
if [ -n "${DOMAIN:-}" ]; then
  public_url="https://${DOMAIN}"
else
  ip="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || echo 127.0.0.1)"
  public_url="${CREW_PUBLIC_URL:-http://${ip}:${port}}"
fi
# Stamp the image with the commit it is built from, so the App can compare versions (version.ts).
if [ -z "${CREW_COMMIT:-}" ]; then CREW_COMMIT="$(git -C "$here/../.." rev-parse HEAD 2>/dev/null || echo '')"; fi
export CREW_COMMIT

umask 077
cat > .env <<ENV
CREW_AUTH_TOKEN=${token}
CREW_PUBLIC_URL=${public_url}
CREW_PORT=${port}
DOMAIN=${DOMAIN:-}
CREW_MTU=${CREW_MTU:-}
CREW_COMMIT=${CREW_COMMIT:-}
ENV

echo "▸ 构建并启动（第一次要几分钟）…"
if [ -n "${DOMAIN:-}" ]; then
  docker compose -f docker-compose.yml -f docker-compose.https.yml up -d --build
else
  docker compose -f docker-compose.yml up -d --build
fi

echo "▸ 等服务起来…"
for _ in $(seq 1 60); do
  if curl -fsS --max-time 2 "http://127.0.0.1:${port}/health" >/dev/null 2>&1 || curl -fsS --max-time 2 "${public_url}/health" >/dev/null 2>&1; then break; fi
  sleep 1
done

name="$(hostname)"
code="$(printf '{"url":"%s","token":"%s","name":"%s"}' "$public_url" "$token" "$name" | base64 | tr -d '\n' | tr '+/' '-_' | tr -d '=')"
cat <<OUT

✔ 装好了。bot 的家在这台机器的 Docker 卷 crew-data 里。

把下面这一整行「连接码」贴到 App 的「bot 们在哪台机器上干活」页面：

${code}

地址：${public_url}
$( [ -z "${DOMAIN:-}" ] && echo "提示：现在是明文 HTTP。公网上用请配一个域名后重新运行：DOMAIN=你的域名 bash deploy/install.sh" )
再次运行本脚本会保留连接码，只做升级。查看日志：docker compose logs -f crew
OUT
