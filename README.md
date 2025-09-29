# Userbot-TG-Websansay

[![GitHub stars](https://img.shields.io/github/stars/kalininlive/Userbot-TG-Websansay?style=social)](https://github.com/kalininlive/Userbot-TG-Websansay/stargazers)
[![License](https://img.shields.io/github/license/kalininlive/Userbot-TG-Websansay)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D%2022.x-green.svg)](https://nodejs.org/)
[![n8n Integration](https://img.shields.io/badge/ready%20for-n8n-blue.svg)](https://n8n.io/)

Готовый к работе API-сервер для **Telegram Userbot** на базе [GramJS](https://gram.js.org/).  
Поддерживает простую установку «одной командой» и подключение аккаунтов через QR-код.  

---

## 🚀 Быстрый старт

Установите и запустите сервер на чистом **Ubuntu/Debian** всего одной командой:

```bash
bash <(curl -sSL https://raw.githubusercontent.com/kalininlive/Userbot-TG-Websansay/main/install.sh)
````

Скрипт автоматически:

* установит системные пакеты (**Node.js, pm2, jq** и др.);
* развернёт API-сервер в фоновом режиме;
* запустит мастер для подключения вашего первого Telegram-аккаунта через QR-код.

---

## ➕ Подключение дополнительных аккаунтов

Чтобы подключить ещё один аккаунт, используйте `qr_wizard.sh`:

```bash
curl -sSL -o qr_wizard.sh https://raw.githubusercontent.com/kalininlive/Userbot-TG-Websansay/main/qr_wizard.sh
chmod +x qr_wizard.sh
./qr_wizard.sh
```

---

## ⚙️ Полезные команды (pm2)

```bash
# Логи сервера
pm2 logs tgapi

# Перезапуск
pm2 restart tgapi

# Остановка
pm2 stop tgapi

# Список сессий
ls -l /opt/tgapi/sessions
```

---

## 🔒 Безопасность

* Уникальный `API_TOKEN` генерируется при установке и сохраняется в `/opt/tgapi/.env`.
* Не публикуйте содержимое папки `/opt/tgapi/sessions` и файл `.env`.
* Для доступа к API используйте заголовок:

```http
Authorization: Bearer <ваш_токен>
```

---

## 📡 Примеры запросов к API

Получить список чатов:

```bash
curl -sS -H "Authorization: Bearer $API_TOKEN" http://<SERVER_IP>:3000/chats
```

Отправить сообщение:

```bash
curl -sS -H "Authorization: Bearer $API_TOKEN" \
  -X POST http://<SERVER_IP>:3000/sendMessage \
  -d '{"chat_id":123456789, "text":"Привет из API!"}'
```

---

## 🛠️ Интеграция с n8n

Подключение максимально простое:

1. В ноде **HTTP Request** укажите URL вашего API (`http://<SERVER_IP>:3000`).
2. Добавьте заголовок:

```json
{
  "Authorization": "Bearer <ваш_токен>"
}
```

3. Работайте с Telegram напрямую: отправка сообщений, получение апдейтов, управление чатами.

---

## 📜 Лицензия

Проект распространяется под лицензией [MIT](LICENSE).
