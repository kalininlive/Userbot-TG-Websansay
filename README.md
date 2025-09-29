Userbot-TG-Websansay
Готовый к работе API-сервер для Telegram Userbot на базе GramJS с простой установкой и удобным подключением аккаунтов через QR-код.

Быстрый старт: одна команда
Для установки и запуска сервера на чистом сервере (Ubuntu/Debian) выполните в терминале всего одну команду:

bash <(curl -sSL [https://raw.githubusercontent.com/kalininlive/Userbot-TG-Websansay/main/install.sh](https://raw.githubusercontent.com/kalininlive/Userbot-TG-Websansay/main/install.sh))

Скрипт автоматически:

Установит все необходимые системные пакеты (Node.js, pm2, jq и др.).

Настроит, установит зависимости и запустит API-сервер в фоновом режиме.

Запустит интерактивный мастер для подключения вашего первого Telegram-аккаунта через QR-код в терминале.

Просто следуйте инструкциям на экране.

Подключение дополнительных аккаунтов
Если вам нужно подключить еще один аккаунт после установки, скачайте и запустите qr_wizard.sh:

# Скачиваем мастер подключения
curl -sSL -o qr_wizard.sh [https://raw.githubusercontent.com/kalininlive/Userbot-TG-Websansay/main/qr_wizard.sh](https://raw.githubusercontent.com/kalininlive/Userbot-TG-Websansay/main/qr_wizard.sh)
chmod +x qr_wizard.sh

# Запускаем
./qr_wizard.sh

Полезные команды
Ваш API-сервер работает под управлением pm2.

Посмотреть логи сервера:

pm2 logs tgapi

Перезапустить сервер:

pm2 restart tgapi

Остановить сервер:

pm2 stop tgapi

Посмотреть список сессий:

ls -l /opt/tgapi/sessions

Безопасность
Скрипт установки автоматически генерирует уникальный API_TOKEN и сохраняет его в файле /opt/tgapi/.env.

Никогда не публикуйте содержимое папки /opt/tgapi/sessions и файл .env.

Для доступа к API извне (например, из n8n) используйте ваш IP-адрес сервера и API_TOKEN в заголовке Authorization: Bearer <ваш_токен>.
