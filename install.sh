#!/bin/bash
# Идеальный скрипт для установки и первоначальной настройки Userbot TG Websansay
# Этот скрипт выполняет все шаги: от установки зависимостей до авторизации через QR-код.

set -e # Выход при любой ошибке

# --- Функции для красивого вывода ---
log() {
  echo -e "\033[1;36m[УСТАНОВКА]\033[0m $1"
}

info() {
  echo -e "\033[1;32m[ИНФО]\033[0m $1"
}

warn() {
  echo -e "\033[1;33m[ПРЕДУПРЕЖДЕНИЕ]\033[0m $1"
}

error() {
  echo -e "\033[1;31m[ОШИБКА]\033[0m $1" >&2
  exit 1
}

# --- 1. Установка системных зависимостей ---
log "Обновление списка пакетов..."
apt-get update -y

log "Установка необходимых пакетов: curl, gnupg, build-essential, jq, qrencode..."
apt-get install -y ca-certificates curl gnupg lsb-release git jq qrencode build-essential openssl chrony
systemctl enable --now chrony &>/dev/null || warn "Не удалось запустить службу chrony (синхронизация времени)."

# --- 2. Установка Node.js и PM2 ---
log "Настройка репозитория Node.js v22..."
mkdir -p /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list

log "Установка Node.js..."
apt-get update -y
apt-get install -y nodejs

log "Установка менеджера процессов PM2 глобально..."
npm i -g pm2

# --- 3. Настройка приложения ---
APP_DIR="/opt/tgapi"
log "Создание директории приложения: $APP_DIR"
mkdir -p "$APP_DIR"/{src,sessions,uploads,downloads}
cd "$APP_DIR"

log "Создание файла package.json..."
cat > package.json <<'EOF'
{
  "name": "userbot-tg-websansay",
  "version": "1.0.0",
  "description": "Telegram API server based on GramJS",
  "main": "src/server.js",
  "type": "module",
  "scripts": {
    "start": "node src/server.js",
    "prod": "pm2 start src/server.js --name tgapi"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "pino": "^9.2.0",
    "qrcode": "^1.5.3",
    "telegram": "^2.22.2"
  }
}
EOF

log "Создание файла .env и генерация API_TOKEN..."
# Генерируем токен, только если его нет
API_TOKEN=$(openssl rand -hex 32)
cat > .env <<EOF
API_PORT=3000
API_TOKEN=${API_TOKEN}
SESSION_DIR=./sessions
UPLOAD_DIR=./uploads
DOWNLOAD_DIR=./downloads
EOF

log "Загрузка последней версии серверного кода (server.js)..."
# Вместо загрузки, вставляем код напрямую для надежности
mkdir -p src
cat > "$APP_DIR/src/server.js" <<'EOM'
// /opt/tgapi/src/server.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import pino from 'pino';
import QRCode from 'qrcode';
import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const log = pino({ level: process.env.LOG_LEVEL || 'info' });

const PORT = Number(process.env.API_PORT || 3000);
const SESS_DIR = path.resolve(process.env.SESSION_DIR || path.join(__dirname, '..', 'sessions'));
fs.mkdirSync(SESS_DIR, { recursive: true });

const DEFAULT_API_ID = Number(process.env.API_ID || 0);
const DEFAULT_API_HASH = String(process.env.API_HASH || '');

const clients = new Map();
const qrState = new Map();

function accPaths(name) {
  const json = path.join(SESS_DIR, `${name}.json`);
  const sess = path.join(SESS_DIR, `${name}.session`);
  return { json, sess };
}

async function loadClientByName(name) {
  const { json, sess } = accPaths(name);
  let str = '';
  try { str = await fsp.readFile(sess, 'utf8'); } catch {}
  if (!str) throw new Error(`No session for "${name}". Login first via /auth/qr/start`);

  let meta = {};
  try { meta = JSON.parse(await fsp.readFile(json,'utf8')); } catch {}

  const apiId = Number(meta.apiId || DEFAULT_API_ID);
  const apiHash = String(meta.apiHash || DEFAULT_API_HASH);
  if (!apiId || !apiHash) throw new Error(`Missing apiId/apiHash for "${name}"`);

  let client = clients.get(name);
  if (!client || !client.connected) {
    client = new TelegramClient(new StringSession(str), apiId, apiHash, { connectionRetries: 5 });
    clients.set(name, client);
  }
  return { client, apiId, apiHash };
}

const app = express();
app.disable('x-powered-by');
app.use(cors({ origin: true }));
app.use(express.json({ limit: '4mb' }));

app.use((req, res, next) => {
  if (process.env.API_TOKEN) {
    const open = req.path === '/health' || req.path.startsWith('/auth/qr/');
    if (open) return next();
    const h = req.get('authorization') || '';
    const m = h.match(/^Bearer\s+(.+)$/i);
    const token = m?.[1] || '';
    if (!token || token !== process.env.API_TOKEN) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
  }
  next();
});

app.get('/health', (_req, res) => res.json({ ok: true, service: 'tgapi', ts: Date.now() }));

app.post('/auth/qr/start', async (req, res) => {
  try {
    const { name, apiId, apiHash } = req.body || {};
    if (!name || !apiId || !apiHash) return res.status(400).json({ ok: false, error: 'name, apiId, and apiHash are required' });
    
    const { json, sess } = accPaths(name);
    if (fs.existsSync(sess)) {
        try {
            const { client } = await loadClientByName(name);
            if (!client.connected) await client.connect();
            const me = await client.getMe();
            const user = { id: String(me.id), username: me.username, firstName: me.firstName };
            qrState.set(name, { status: 'authorized', user });
            return res.json({ ok: true, status: 'authorized', name, user });
        } catch (e) {
            log.warn(`Session for '${name}' is invalid. Deleting. Error: ${e.message}`);
            try { await fsp.unlink(sess); } catch {}
        }
    }

    qrState.set(name, { status: 'preparing' });

    (async () => {
      const client = new TelegramClient(new StringSession(''), apiId, apiHash, { connectionRetries: 5 });
      try {
        await client.connect();
        let lastUrl = '';
        await client.signInUserWithQrCode({ apiId, apiHash }, {
          qrCode: async ({ token }) => {
            const url = `tg://login?token=${token.toString('base64url')}`;
            if (url !== lastUrl) {
              lastUrl = url;
              qrState.set(name, { status: 'qr_ready', url });
              log.info(`[${name}] QR code generated/updated.`);
            }
          },
          onError: (err) => {
            qrState.set(name, { status: 'error', err: String(err?.message || err) });
            return true;
          },
        });
        await fsp.writeFile(sess, client.session.save(), 'utf8');
        await fsp.writeFile(json, JSON.stringify({ apiId, apiHash, updatedAt: Date.now() }, null, 2));
        const me = await client.getMe();
        const user = { id: String(me.id), username: me.username, firstName: me.firstName };
        qrState.set(name, { status: 'authorized', user });
        clients.set(name, client);
      } catch (e) {
        qrState.set(name, { status: 'error', err: String(e?.message || e) });
        try { if (client.connected) await client.disconnect(); } catch {}
      }
    })();
    res.json({ ok: true, status: 'preparing', name });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.get('/auth/qr/status', (req, res) => {
  const name = String(req.query?.name || '').trim();
  if (!name) return res.status(400).json({ ok: false, error: 'name required' });
  const s = qrState.get(name) || { status: 'unknown' };
  res.json({ ok: true, name, ...s });
});

app.get('/auth/qr/png', (req, res) => {
    const name = String(req.query?.name || '').trim();
    const s = qrState.get(name);
    if (!name || !s || s.status !== 'qr_ready' || !s.url) {
        return res.status(404).end('QR not ready');
    }
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    QRCode.toFileStream(res, s.url, { width: 256, margin: 2 });
});

// Other API endpoints like /me, /dialogs, etc.
app.get('/me', async (req,res)=>{
  try{
    const name = String(req.query?.name || '').trim();
    if (!name) return res.status(400).json({ ok:false, error:'name required' });
    const { client } = await loadClientByName(name);
    await client.connect();
    const me = await client.getMe();
    res.json({ ok:true, me: JSON.parse(JSON.stringify(me)) });
  }catch(e){ res.status(500).json({ ok:false, error:e.message }); }
});


app.use((err, req, res, _next) => {
  log.error({ err: String(err?.message || err), path: req.path }, 'Unhandled Error');
  if (res.headersSent) return;
  res.status(500).json({ ok: false, error: 'Internal Server Error' });
});

app.listen(PORT, () => {
  log.info(`API server started on http://127.0.0.1:${PORT}`);
});
EOM

log "Установка npm-зависимостей..."
npm install --omit=dev

# --- 4. Запуск сервера через PM2 ---
log "Запуск/перезапуск API-сервера через PM2..."
pm2 restart tgapi --update-env || pm2 start "$APP_DIR/src/server.js" --name tgapi
pm2 save

log "Ожидание запуска API-сервера..."
for i in {1..10}; do
  if curl -s "http://127.0.0.1:3000/health" | grep -q '"ok":true'; then
    info "Сервер успешно запущен!"
    break
  fi
  if [ $i -eq 10 ]; then
    error "Сервер не запустился за 10 секунд. Проверьте логи: pm2 logs tgapi"
  fi
  sleep 1
done

# --- 5. Мастер авторизации (QR-код) ---
info "Запуск мастера подключения аккаунта Telegram."
echo "----------------------------------------------------"
echo "Сейчас потребуется ввести данные вашего приложения Telegram."
echo "Их можно получить на сайте https://my.telegram.org в разделе 'API development tools'."
echo "----------------------------------------------------"

connect_account() {
  local API_ID API_HASH NAME
  read -r -p "Введите ваш api_id: " API_ID
  while ! [[ "$API_ID" =~ ^[0-9]+$ ]]; do
    warn "api_id должен состоять только из цифр."
    read -r -p "Введите ваш api_id: " API_ID
  done
  read -r -p "Введите ваш api_hash: " API_HASH
  read -r -p "Введите имя для этой сессии (например, my_account): " NAME
  NAME=$(echo "$NAME" | tr -d '[:space:]')

  log "Запрос на создание QR-кода для сессии '$NAME'..."
  
  local resp=$(curl -s -X POST "http://127.0.0.1:3000/auth/qr/start" \
    -H "Authorization: Bearer $API_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"$NAME\",\"apiId\":$API_ID,\"apiHash\":\"$API_HASH\"}")

  if [ "$(echo "$resp" | jq -r '.ok // false')" != "true" ]; then
    error "Не удалось запустить процесс авторизации. Ответ сервера: $resp"
  fi

  clear; printf '\033[?25l'; trap 'printf "\\033[?25h\\n"; exit 0' INT TERM

  for _ in $(seq 1 120); do
    local json=$(curl -s -G "http://127.0.0.1:3000/auth/qr/status" -H "Authorization: Bearer $API_TOKEN" --data-urlencode "name=$NAME")
    local status=$(echo "$json" | jq -r '.status // "unknown"')
    local url=$(echo "$json" | jq -r '.qr // empty')

    printf '\033[H'; echo -e "Мастер подключения Telegram\n--------------------------\nСессия: $NAME\nСтатус: $status\nВремя:  $(date '+%T')\n--------------------------\n"

    if [ "$status" = "authorized" ]; then
      info "✅ Успешно авторизовано: $(echo "$json" | jq -r '.user.firstName // "N/A"')"
      printf '\033[?25h\n'; return 0
    elif [ "$status" = "error" ]; then
      error "Ошибка: $(echo "$json" | jq -r '.err // "Неизвестная ошибка"')"
    fi

    if [ -n "$url" ] && [ "$url" != "$prev_url" ]; then
      echo "🔄 Отсканируйте QR-код в Telegram (Настройки → Устройства):"; echo; qrencode -t ANSIUTF8 "$url"; prev_url="$url"
    else
      echo "⏳ Ожидание сканирования QR-кода..."
    fi
    sleep 5
  done
  error "Таймаут ожидания авторизации."
}

while true; do
    connect_account
    echo
    read -r -p "Хотите подключить еще один аккаунт? (y/n): " choice
    [[ "$choice" =~ ^[YyДд] ]] && clear || break
done

printf '\033[?25h\n'

# --- 6. Финальные инструкции ---
info "Установка и настройка завершены!"
echo -e "\nВаш API-сервер работает в фоновом режиме."
echo "Полезные команды:"
echo "  - Посмотреть логи:      pm2 logs tgapi"
echo "  - Остановить сервер:    pm2 stop tgapi"
echo "  - Запустить сервер:      pm2 start tgapi"
echo -e "\n\033[1;32m[ИНФО]\033[0m Для подключения нового аккаунта в будущем, создайте и запустите скрипт 'qr_wizard.sh' из соседнего файла."
