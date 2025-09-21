# Userbot TG Websansay

API-сервер для авторизации Telegram-аккаунтов через QR (GramJS) и интеграции с n8n.

---

## Установка (Ubuntu 22.04)

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/kalininlive/Userbot-TG-Websansay/main/install_tgapi.sh)
````

После установки:

* сервер поднимается на `http://127.0.0.1:3000`
* токен (`API_TOKEN`) сохраняется в `/opt/tgapi/.env` и выводится в консоль

---

## Авторизация через QR (терминал, Termius/SSH)

Запустите визард:

```bash
bash /opt/tgapi/qr_wizard.sh
```

Введите:

* `api_id`, `api_hash` — из [my.telegram.org](https://my.telegram.org)
* `name` — произвольное имя аккаунта (например `acc1`)

После сканирования QR в Telegram появится `✅ Авторизовано`.
Сессия сохраняется в `/opt/tgapi/sessions/`.

> Ошиблись при вводе (например, нажали Enter на пустом поле)? Просто запустите визард ещё раз:
>
> ```bash
> bash /opt/tgapi/qr_wizard.sh
> ```

---

## Добавление ещё одного аккаунта

Повторите визард и укажите **новое имя**:

```bash
bash /opt/tgapi/qr_wizard.sh
```

Файлы сессий:

```
/opt/tgapi/sessions/
  acc1.session  acc1.json
  acc2.session  acc2.json
  ...
```

---

## Быстрые проверки (после установки и авторизации)

Экспорт переменных:

```bash
API="http://127.0.0.1:3000"
TOKEN="$(grep -E '^API_TOKEN=' /opt/tgapi/.env | cut -d'=' -f2)"
NAME="acc1"   # замените на своё имя аккаунта
```

### 0) Здоровье сервиса

```bash
curl -s "$API/health" | jq .
```

Ожидаемо:

```json
{ "ok": true, "service": "tgapi", "ts": 1234567890 }
```

### 1) Проверить авторизацию аккаунта

```bash
curl -s -G "$API/auth/qr/status" \
  -H "Authorization: Bearer $TOKEN" \
  --data-urlencode "name=$NAME" | jq .
```

Если всё ок, вернётся `{"status":"authorized"}`.

### 2) Данные профиля (эндпоинт `/me`)

```bash
curl -s -G "$API/me" \
  -H "Authorization: Bearer $TOKEN" \
  --data-urlencode "name=$NAME" | jq .
```

### 3) Список каналов/чатов

```bash
curl -s -G "$API/channels" \
  -H "Authorization: Bearer $TOKEN" \
  --data-urlencode "name=$NAME" \
  --data-urlencode "limit=200" \
| jq '. | {ok, count: (.channels|length), sample: (.channels[0:10])}'
```

### 4) Сообщения из конкретного канала/диалога

Подставьте `username` канала (или числовой id) из пункта 3:

```bash
CHAN="hamster_kombat"   # пример
curl -s -G "$API/messages" \
  -H "Authorization: Bearer $TOKEN" \
  --data-urlencode "name=$NAME" \
  --data-urlencode "channel=$CHAN" \
  --data-urlencode "limit=5" \
| jq '. | {ok, nextOffsetId, sample: (.messages[0:3])}'
```

### 5) Отправка сообщения (например, в «Избранное»)

```bash
curl -s -X POST "$API/send" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"$NAME\",
    \"peer\": \"me\",
    \"message\": \"Тест из tgapi ✅\"
  }" | jq .
```

---

## Эндпоинты API

* `GET  /health` — проверка сервиса (без токена)
* `POST /auth/qr/start` — запуск QR-сессии
* `GET  /auth/qr/status?name=<name>` — статус QR/аккаунта
* `GET  /me?name=<name>` — профиль авторизованного пользователя
* `GET  /channels?name=<name>&limit=200` — список диалогов/каналов
* `GET  /messages?name=<name>&channel=<username|id>&limit=50&offsetId=0` — сообщения
* `POST /send` — отправка сообщения

  ```json
  {
    "name": "acc1",
    "peer": "me",             // "me", username, или numeric id
    "message": "Привет!"
  }
  ```

Все запросы (кроме `/health` и `/auth/qr/wizard`) требуют заголовок:

```
Authorization: Bearer <API_TOKEN>
```

---

## Обновление/перезапуск

```bash
pm2 restart tgapi --update-env && pm2 save
```

---

## Безопасность

* Храните `/opt/tgapi/.env` в секрете.
* Не открывайте порт 3000 наружу без необходимости.
* Для веб-визарда используйте SSH-туннель:

  ```bash
  ssh -L 3000:127.0.0.1:3000 root@SERVER_IP
  # затем открывайте http://localhost:3000/auth/qr/wizard
  ```
