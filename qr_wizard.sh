#!/bin/bash
# Мастер для подключения нового аккаунта Telegram к запущенному API-серверу

set -e

# --- Функции для красивого вывода ---
log() { echo -e "\033[1;36m[WIZARD]\033[0m $1"; }
info() { echo -e "\033[1;32m[INFO]\033[0m $1"; }
warn() { echo -e "\033[1;33m[ПРЕДУПРЕЖДЕНИЕ]\033[0m $1"; }
error() { echo -e "\033[1;31m[ОШИБКА]\033[0m $1" >&2; exit 1; }

# --- Проверки ---
for cmd in curl jq qrencode; do
  command -v $cmd >/dev/null || error "Необходима утилита '$cmd'. Установите ее (apt install $cmd)."
done

APP_DIR="/opt/tgapi"
ENV_FILE="$APP_DIR/.env"

if [ ! -f "$ENV_FILE" ]; then
  error "Файл конфигурации $ENV_FILE не найден. Убедитесь, что сервер установлен."
fi

# --- Чтение конфигурации ---
API_PORT=$(grep -E '^API_PORT=' "$ENV_FILE" | cut -d= -f2)
API_TOKEN=$(grep -E '^API_TOKEN=' "$ENV_FILE" | cut -d= -f2)
API_URL="http://127.0.0.1:$API_PORT"

if [ -z "$API_TOKEN" ]; then
  error "API_TOKEN не найден в $ENV_FILE."
fi

# --- Мастер подключения ---
info "Запуск мастера подключения аккаунта Telegram."
echo "----------------------------------------------------"

local API_ID API_HASH NAME

read -r -p "Введите ваш api_id: " API_ID
while ! [[ "$API_ID" =~ ^[0-9]+$ ]]; do
  warn "api_id должен состоять только из цифр."
  read -r -p "Введите ваш api_id: " API_ID
done

read -r -p "Введите ваш api_hash: " API_HASH
read -r -p "Введите имя для этой сессии (например, second_account): " NAME
NAME=$(echo "$NAME" | tr -d '[:space:]') # Удаляем пробелы

log "Запрос на создание QR-кода для сессии '$NAME'..."

local resp
resp=$(curl -s -X POST "$API_URL/auth/qr/start" \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"$NAME\",\"apiId\":$API_ID,\"apiHash\":\"$API_HASH\"}")

local ok
ok=$(echo "$resp" | jq -r '.ok // false')
if [ "$ok" != "true" ]; then
  error "Не удалось запустить процесс авторизации. Ответ сервера: $resp"
fi

clear
printf '\033[?25l' # Скрыть курсор
trap 'printf "\\033[?25h\\n"; exit 0' INT TERM # Показать курсор при выходе

local prev_url=""

for _ in $(seq 1 120); do # Таймаут ~10 минут (120 * 5s)
  local json status url
  json=$(curl -s -G "$API_URL/auth/qr/status" \
    -H "Authorization: Bearer $API_TOKEN" \
    --data-urlencode "name=$NAME")
  
  status=$(echo "$json" | jq -r '.status // "unknown"')
  url=$(echo "$json" | jq -r '.qr // .login_url // empty')

  printf '\033[H' # Переместить курсор в начало
  echo "----------------------------------------------------"
  echo "  Мастер подключения Telegram Userbot"
  echo "----------------------------------------------------"
  echo "  Сессия: $NAME"
  echo "  Статус: $status"
  echo "  Время:  $(date '+%Y-%m-%d %H:%M:%S')"
  echo "----------------------------------------------------"
  echo

  if [ "$status" = "authorized" ]; then
    local user_info
    user_info=$(echo "$json" | jq -r '.user.firstName // "N/A"')
    info "✅ Успешно авторизовано для пользователя: $user_info"
    printf '\033[?25h\n' # Показать курсор
    exit 0
  fi

  if [ "$status" = "error" ]; then
    local err_msg
    err_msg=$(echo "$json" | jq -r '.error // "Неизвестная ошибка"')
    error "Произошла ошибка: $err_msg"
  fi

  if [ -n "$url" ] && [ "$url" != "null" ]; then
    if [ "$url" != "$prev_url" ]; then
      echo "🔄 Отсканируйте QR-код в приложении Telegram:"
      echo "   (Настройки → Устройства → Привязать устройство)"
      echo
      qrencode -t ANSIUTF8 "$url"
      prev_url="$url"
    else
      echo "⏳ Ожидание сканирования QR-кода..."
    fi
  else
    echo "⏳ Генерация QR-кода, пожалуйста, подождите..."
  fi

  sleep 5
done

error "Таймаут ожидания авторизации. Попробуйте запустить скрипт снова."
