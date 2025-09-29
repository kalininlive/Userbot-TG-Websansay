#!/bin/bash
set -euo pipefail
API="${API:-http://127.0.0.1:3000}"
TOKEN="${TOKEN:-$(grep -E '^API_TOKEN=' /opt/tgapi/.env | cut -d= -f2 || true)}"

read -r -p "Введите api_id: " API_ID
read -r -p "Введите api_hash: " API_HASH
read -r -p "Введите name (имя аккаунта): " NAME

command -v jq >/dev/null || { echo "jq не установлен"; exit 1; }
command -v qrencode >/dev/null || { echo "qrencode не установлен"; exit 1; }

if ! resp="$(curl -fsS -X POST "$API/auth/qr/start" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "{\"name\":\"$NAME\",\"apiId\":$API_ID,\"apiHash\":\"$API_HASH\"}" 2>&1)"; then
  echo "Не удалось инициировать QR-авторизацию: $resp"
  exit 1
fi

if ! printf '%s' "$resp" | jq empty >/dev/null 2>&1; then
  echo "Сервер вернул некорректный ответ при старте авторизации: $resp"
  exit 1
fi

if ! ok="$(printf '%s' "$resp" | jq -r '.ok // false' 2>/dev/null)"; then
  echo "Не удалось обработать ответ сервера при старте авторизации: $resp"
  exit 1
fi

[ "$ok" = "true" ] || { echo "Ошибка старта: $resp"; exit 1; }

clear; printf '\033[?25l'
trap 'printf "\033[?25h\n"; exit 0' INT TERM

render_header() {
  local status="$1"
  printf '\033[H'
  echo "API: $API"
  echo "NAME: $NAME"
  echo "TIME: $(date '+%Y-%m-%d %H:%M:%S')"
  echo "STAT: $status"
  echo
}

prev=""; last=0; interval=15
for _ in $(seq 1 600); do
  if ! json="$(curl -fsS -G "$API/auth/qr/status" -H "Authorization: Bearer $TOKEN" --data-urlencode "name=$NAME" 2>&1)"; then
    render_header "network-error"
    echo "⚠️ Не удалось получить статус QR: $json"
    sleep 5
    continue
  fi

  if ! printf '%s' "$json" | jq empty >/dev/null 2>&1; then
    render_header "invalid-response"
    echo "⚠️ Сервер вернул некорректный JSON: $json"
    sleep 5
    continue
  fi

  status="$(printf '%s' "$json" | jq -r '.status // "unknown"')"
  url="$(printf '%s' "$json" | jq -r '.qr // .login_url // empty')"

  render_header "$status"

  if [ "$status" = "authorized" ]; then
    echo "✅ Авторизовано."
    printf '\033[?25h\n'
    echo
    echo "— /me:"
    curl -s -G "$API/me" -H "Authorization: Bearer $TOKEN" --data-urlencode "name=$NAME" | jq .
    exit 0
  fi

  if [ "$status" = "error" ]; then
    echo "⛔ $(printf '%s' "$json" | jq -r '.error // "error"')"
    break
  fi

  now="$(date +%s)"
  if [ -n "$url" ] && [ "$url" != "null" ]; then
    if [ "$url" != "$prev" ] && [ $((now - last)) -ge $interval ]; then
      echo "🔄 Сканируй QR в Telegram (Настройки → Устройства → Привязать устройство):"
      echo "$url" | qrencode -t ANSIUTF8
      prev="$url"; last="$now"
    else
      echo "⌛ Ждём сканирования…"
    fi
  else
    echo "… Ждём появления QR-токена"
  fi

  sleep 5
done
printf '\033[?25h\n'

