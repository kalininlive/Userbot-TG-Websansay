# Userbot-TG-Websansay — инструкция по использованию

Ниже — только практические команды и минимальные инструкции по запуску и привязке аккаунта через QR. Выполните команды в указанном порядке.

## Быстрый старт — 5 команд
```bash
# 1) Скачать и запустить установочный скрипт
bash <(curl -fsSL https://raw.githubusercontent.com/kalininlive/Userbot-TG-Websansay/main/install_tgapi.sh)

# 2) Перейти в каталог приложения
cd /opt/tgapi

# 3) Установить npm-зависимости (если установщик не сделал это автоматически)
npm ci --production

# 4) Запустить приложение через pm2
pm2 start ecosystem.config.cjs --env production && pm2 save

# 5) Запустить локальный терминальный QR-визард для привязки аккаунта
sudo bash ./qr_wizard_local.sh
````

## Что вводить в визарде

* `api_id` — ваш API ID с [https://my.telegram.org](https://my.telegram.org) (число).
* `api_hash` — ваш API Hash с [https://my.telegram.org](https://my.telegram.org) (строка).
* `name` — имя сессии (короткая строка, например `test1`).

После ввода в терминале появится QR-код — отсканируйте его в мобильном Telegram (Меню → Устройства → Привязать устройство). После успешной авторизации увидите сообщение о сохранении сессии.

## Проверка успешной привязки

```bash
TOKEN="$(grep -E '^API_TOKEN=' /opt/tgapi/.env | cut -d'=' -f2-)"
curl -sS -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:3000/me?name=test1" | jq .
```

(вместо `test1` используйте имя сессии, которое вводили)

## Где параметры (пример .env)

Создайте `/opt/tgapi/.env` с минимумом полей:

```
API_PORT=3000
API_TOKEN=replace_with_secure_token
SESSION_DIR=./sessions
UPLOAD_DIR=./uploads
DOWNLOAD_DIR=./downloads
```

## Полезные команды обслуживания

* Перезапуск сервиса:

```bash
pm2 restart tgapi
```

* Просмотр логов:

```bash
pm2 logs tgapi --lines 200
```

* Скачать PNG QR (если нужно):

```bash
TOKEN="$(grep -E '^API_TOKEN=' /opt/tgapi/.env | cut -d'=' -f2-)"
curl -sS -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:3000/auth/qr/png?name=test1" -o /tmp/qr_test1.png
```

* Список сессий:

```bash
ls -la /opt/tgapi/sessions
```

## Безопасность — кратко, но важно

* Никогда не коммитьте `.env`, `sessions/`, `uploads/` или `downloads/` в публичные репозитории. Добавьте их в `.gitignore`.
* Храните `API_TOKEN` и `api_hash` в секрете. В логах показывайте только маскированные значения.
* Доступ к серверу делайте через SSH по ключам; не открывайте ненужные порты без защиты.

## Чек-лист после установки

1. Убедитесь, что в `/opt/tgapi` есть `src/`, `ecosystem.config.cjs`, `qr_wizard_local.sh`.
2. `.env` заполнен и не попал в git.
3. `pm2 status tgapi` — показывает приложение в состоянии `online` или `stopped` (в случае остановки — `pm2 restart tgapi`).
4. `sudo bash ./qr_wizard_local.sh` показывает QR в том же терминале и сессия сохраняется.

---

Если этот скрипт и инструкции помогли — поставьте, пожалуйста, ⭐ звезду репозиторию и подпишитесь на канал с автоматизациями: [https://t.me/+VxXC2TaMEv0zMzcy](https://t.me/+VxXC2TaMEv0zMzcy) — это мотивирует дальше делать полезные скрипты и упрощения. Спасибо!

