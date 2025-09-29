# Userbot-TG-Websansay — инструкция по использованию

Ниже — только практические команды и минимальные инструкции по быстрому запуску и привязке аккаунта через QR.

## Быстрый старт — одна команда
Выполните одну команду в терминале (она установит нужные пакеты и запустит установщик):
```bash
sudo apt update && sudo apt install -y qrencode jq && bash <(curl -fsSL https://raw.githubusercontent.com/kalininlive/Userbot-TG-Websansay/main/install_tgapi.sh)
````

После выполнения установщика следуйте подсказкам: при запросе введите `api_id`, `api_hash` и `name`, затем отсканируйте появившийся QR в мобильном Telegram.

---

## Что вводить в визарде

* `api_id` — ваш API ID с [https://my.telegram.org](https://my.telegram.org) (число)
* `api_hash` — ваш API Hash с [https://my.telegram.org](https://my.telegram.org) (строка)
* `name` — имя сессии (короткая строка, например `test1`)

---

## Если что-то пошло не так — запасной набор команд

(выполняйте по очереди, только если установка/запуск не получились)

```bash
# Перейти в каталог приложения
cd /opt/tgapi

# Установить npm-зависимости (если не сделали автоматически)
npm ci --production

# Убедитесь, что рядом лежит ecosystem.config.cjs (устанавливается скриптом) и запустите через pm2
# Если файла нет, создайте его вручную:
cat <<'CONFIG' > ecosystem.config.cjs
/**
 * PM2 ecosystem configuration for the tgapi service.
 */
module.exports = {
  apps: [
    {
      name: 'tgapi',
      cwd: '/opt/tgapi',
      script: 'src/server.js',
      env: {
        NODE_ENV: 'development',
        PORT: '3000',
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: '3000',
      },
    },
  ],
};
CONFIG
pm2 start ecosystem.config.cjs --env production && pm2 save

# Запустить локальный терминальный QR-визард (если QR не отображается в текущем терминале)
sudo bash ./qr_wizard_local.sh
```

---

## Быстрые проверки и отладка

* Проверить профиль подключённой сессии (замените `test1` на имя вашей сессии):

```bash
TOKEN="$(grep -E '^API_TOKEN=' /opt/tgapi/.env | cut -d'=' -f2-)"
curl -sS -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:3000/me?name=test1" | jq .
```

* Просмотр логов:

```bash
pm2 logs tgapi --lines 200
```

* Список сессий:

```bash
ls -la /opt/tgapi/sessions
```

* Скачать PNG QR (если сервер отдаёт PNG):

```bash
TOKEN="$(grep -E '^API_TOKEN=' /opt/tgapi/.env | cut -d'=' -f2-)"
curl -sS -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:3000/auth/qr/png?name=test1" -o /tmp/qr_test1.png
```

---

## Минимальный пример `/opt/tgapi/.env`

Создайте файл `/opt/tgapi/.env` с минимумом полей:

```
API_PORT=3000
API_TOKEN=replace_with_secure_token
SESSION_DIR=./sessions
UPLOAD_DIR=./uploads
DOWNLOAD_DIR=./downloads
```

**Важно:** не коммитьте этот файл в публичный репозиторий.

---

## Кратко о безопасности

* Не публикуйте `.env`, `sessions/`, `uploads/` или `downloads/`. Добавьте их в `.gitignore`.
* Храните `API_TOKEN` и `api_hash` в секрете. Логи не должны содержать полных секретных значений.
* Подключайтесь к серверу по SSH ключам; не открывайте лишние порты без защиты.

---

## Поддержка

Если инструкция и скрипты были полезны — пожалуйста, поддержите проект ⭐ на GitHub и подпишитесь на канал с автоматизациями: [https://t.me/+VxXC2TaMEv0zMzcy](https://t.me/+VxXC2TaMEv0zMzcy)
