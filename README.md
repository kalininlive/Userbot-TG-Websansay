# Userbot TG Websansay

API-сервер для авторизации Telegram-аккаунтов через QR (GramJS) и интеграции с n8n.

---

## Установка (Ubuntu 22.04)

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/kalininlive/Userbot-TG-Websansay/main/install_tgapi.sh)
````

После установки:

* сервер поднимается на `http://127.0.0.1:3000`
* токен (`API_TOKEN`) сохраняется в `/opt/tgapi/.env` и показывается в консоли

---

## Быстрый запуск QR в терминале (Termius/SSH)

```bash
bash /opt/tgapi/qr_wizard.sh
```

Введите:

* `api_id`, `api_hash` (из [my.telegram.org](https://my.telegram.org))
* `name` — произвольное имя аккаунта (например `account1`)

После сканирования QR в Telegram (Настройки → Устройства → Привязать устройство) появится сообщение ✅ Авторизовано.
Сессия сохранится в `/opt/tgapi/sessions/`.

---

## Добавление дополнительных аккаунтов

Чтобы авторизовать ещё один Telegram-аккаунт:

1. Запустите QR-визард повторно:

   ```bash
   bash /opt/tgapi/qr_wizard.sh
   ```
2. Введите `api_id`, `api_hash` и **новое имя аккаунта** (например `account2`).
3. Сканируйте QR в Telegram → ✅ Сессия сохранена.

Теперь в папке `/opt/tgapi/sessions/` будут отдельные файлы для каждого аккаунта:

```
account1.session
account1.json
account2.session
account2.json
...
```

При работе с API используйте параметр `name` для выбора аккаунта:

```bash
curl -s -H "Authorization: Bearer $API_TOKEN" \
  "http://127.0.0.1:3000/me?name=account2"
```

---

## Эндпоинты API

* `POST /auth/qr/start` — запуск QR-сессии
* `GET  /auth/qr/status?name=<name>` — статус QR
* `GET  /me?name=<name>` — профиль авторизованного пользователя
* `GET  /auth/qr/wizard` — веб-визард (для тестов)
* `GET  /health` — проверка сервиса

Все запросы (кроме `/health` и `/auth/qr/wizard`) требуют заголовок:

```
Authorization: Bearer <API_TOKEN>
```

---

## Обновление

```bash
pm2 restart tgapi --update-env && pm2 save
```

---

## Безопасность

* Храните `/opt/tgapi/.env` в секрете.
* Не открывайте порт 3000 наружу без необходимости.
* Для браузерного визарда используйте SSH-туннель:

  ```bash
  ssh -L 3000:127.0.0.1:3000 root@SERVER_IP
  # затем откройте http://localhost:3000/auth/qr/wizard
  ```
