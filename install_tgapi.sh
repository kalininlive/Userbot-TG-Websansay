#!/bin/bash
set -euo pipefail
log(){ echo -e "\033[1;36m[install]\033[0m $*"; }

apt-get update -y
apt-get install -y ca-certificates curl gnupg lsb-release git jq qrencode build-essential openssl chrony
systemctl enable --now chrony || true

mkdir -p /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
apt-get update -y && apt-get install -y nodejs
npm i -g pm2

mkdir -p /opt/tgapi/{src,sessions,uploads,downloads}
cd /opt/tgapi

# .env
[ -f .env ] || cat > .env <<'E'
API_PORT=3000
API_TOKEN=
SESSION_DIR=./sessions
UPLOAD_DIR=./uploads
DOWNLOAD_DIR=./downloads
E
if ! grep -q '^API_TOKEN=' .env || [ -z "$(grep '^API_TOKEN=' .env | cut -d= -f2)" ]; then
  sed -i "s/^API_TOKEN=.*/API_TOKEN=$(openssl rand -hex 32)/" .env
fi

# deps
if [ ! -f package.json ]; then
  curl -fsSL https://raw.githubusercontent.com/kalininlive/Userbot-TG-Websansay/main/package.json -o package.json
fi
if [ ! -f package-lock.json ]; then
  curl -fsSL https://raw.githubusercontent.com/kalininlive/Userbot-TG-Websansay/main/package-lock.json -o package-lock.json
fi
if ! npm ci --omit=dev; then
  npm install --production
fi

# fetch server.js & wizard scripts from this repo (refresh on rerun)
curl -fsSL https://raw.githubusercontent.com/kalininlive/Userbot-TG-Websansay/main/src/server.js -o /opt/tgapi/src/server.js
curl -fsSL https://raw.githubusercontent.com/kalininlive/Userbot-TG-Websansay/main/ecosystem.config.cjs -o /opt/tgapi/ecosystem.config.cjs
curl -fsSL https://raw.githubusercontent.com/kalininlive/Userbot-TG-Websansay/main/qr_wizard.sh -o /opt/tgapi/qr_wizard.sh
curl -fsSL https://raw.githubusercontent.com/kalininlive/Userbot-TG-Websansay/main/qr_wizard_local.sh -o /opt/tgapi/qr_wizard_local.sh
chmod +x /opt/tgapi/qr_wizard.sh /opt/tgapi/qr_wizard_local.sh

pm2 start /opt/tgapi/ecosystem.config.cjs --env production || pm2 restart tgapi --update-env
pm2 save

API_TOKEN=$(grep '^API_TOKEN=' /opt/tgapi/.env | cut -d= -f2)
log "Готово. Health: curl -s http://127.0.0.1:3000/health"
log "API_TOKEN: $API_TOKEN"
log "QR Wizard (терминал): bash /opt/tgapi/qr_wizard.sh"
log "QR Wizard (браузер через SSH-туннель): http://localhost:3000/auth/qr/wizard"
