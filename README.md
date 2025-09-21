# Userbot TG Websansay

API-сервер для авторизации Telegram-аккаунтов через QR (GramJS) и интеграции с n8n.

## Установка (Ubuntu 22.04)

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/kalininlive/Userbot-TG-Websansay/main/install_tgapi.sh)
```

## Быстрый запуск QR в терминале (Termius/SSH)

После установки выполните:
```bash
bash /opt/tgapi/qr_wizard.sh
```
Введите `api_id`, `api_hash` (из my.telegram.org) и `name` — QR отрисуется прямо в терминале.  
Сканируйте его в Telegram: Настройки → Устройства → Привязать устройство.

## Эндпоинты API
- `POST /auth/qr/start` — запуск QR-сессии
- `GET  /auth/qr/status?name=<name>` — статус QR
- `GET  /me?name=<name>` — профиль авторизованного пользователя
- `GET  /auth/qr/wizard` — веб-визард (для тестов)
- `GET  /health` — проверка сервиса

## Обновление
```bash
pm2 restart tgapi --update-env && pm2 save
```

## Безопасность
- Храните `/opt/tgapi/.env` в секрете. `API_TOKEN` нужен для API-запросов (`Authorization: Bearer <API_TOKEN>`).
- Порт 3000 не открывайте наружу без необходимости. Для браузерного визарда используйте SSH-туннель:
  ```bash
  ssh -L 3000:127.0.0.1:3000 root@SERVER_IP
  # затем откройте http://localhost:3000/auth/qr/wizard
  ```
