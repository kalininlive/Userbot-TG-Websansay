
2.56.241.134
8g*953jXu1lX

# Userbot TG Websansay

API-сервер для авторизации Telegram-аккаунтов через QR (GramJS) и интеграции с n8n.

## Установка

```bash
bash <(curl -fsSL https://github.com/kalininlive/Userbot-TG-Websansay/main/install_tgapi.sh)
```

## Файлы
- `install_tgapi.sh` — автоустановщик (Ubuntu 22.04)
- `src/server.js` — сервер с API и HTML QR Wizard

## Основные эндпоинты
- `/auth/qr/start` — запуск QR-сессии (POST)
- `/auth/qr/status` — статус QR (GET)
- `/me` — получить данные авторизованного пользователя
- `/auth/qr/wizard` — веб-страница для авторизации
- `/health` — проверка статуса
