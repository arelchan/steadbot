#!/usr/bin/env bash
# Hosted cloud control plane on one Linux host with Docker: builds the tenant image, runs the control plane, Caddy for HTTPS.
#   DOMAIN=cloud.example.com bash deploy/cloud-install.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; cd "$here/.."
[ -n "${DOMAIN:-}" ] || { echo "需要 DOMAIN=你的域名（DNS 已指向这台机器）" >&2; exit 1; }
command -v docker >/dev/null || { echo "需要 Docker" >&2; exit 1; }
echo "▸ 构建租户镜像 crew-server:local…"; docker build -t crew-server:local .
mkdir -p /opt/crew-cloud/data
admin="${CLOUD_ADMIN_TOKEN:-$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')}"
cat > /opt/crew-cloud/.env <<ENV
CLOUD_PORT=5300
CLOUD_BIND=127.0.0.1
CLOUD_PUBLIC_URL=https://${DOMAIN}
CLOUD_DATA=/opt/crew-cloud/data
CLOUD_DRIVER=docker
CLOUD_IMAGE=crew-server:local
CLOUD_ADMIN_TOKEN=${admin}
ENV
chmod 600 /opt/crew-cloud/.env
# The control plane runs on the host (it drives Docker); systemd keeps it up.
cat > /etc/systemd/system/crew-cloud.service <<UNIT
[Unit]
Description=crew cloud control plane
After=docker.service
[Service]
WorkingDirectory=$(pwd)
EnvironmentFile=/opt/crew-cloud/.env
ExecStart=$(command -v npx) tsx src/cloud/index.ts
Restart=always
[Install]
WantedBy=multi-user.target
UNIT
npm install --omit=dev >/dev/null
systemctl daemon-reload && systemctl enable --now crew-cloud
# Caddy: HTTPS for DOMAIN → control plane
command -v caddy >/dev/null || { echo "▸ 装 Caddy…"; apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl >/dev/null; curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg; curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list; apt-get update >/dev/null && apt-get install -y caddy >/dev/null; }
cat > /etc/caddy/Caddyfile <<CADDY
${DOMAIN} {
  reverse_proxy 127.0.0.1:5300
}
CADDY
systemctl reload caddy || systemctl restart caddy
echo; echo "✔ 控制面在 https://${DOMAIN}。App 打包时设置 VITE_CREW_CLOUD=https://${DOMAIN}。管理令牌：${admin}"
