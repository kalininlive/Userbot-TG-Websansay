// /opt/tgapi/src/server.js
// ===================================================================
// Telegram API-сервер на GramJS с удобной QR-авторизацией.
// Фичи:
//  - /auth/qr/start (ОТКРЫТ) — даёшь name + apiId + apiHash → запускается вход с QR
//  - /auth/qr/status (ОТКРЫТ) — статус авторизации + ссылка tg://login...
//  - /auth/qr/png (ОТКРЫТ) — PNG-картинка QR (одна, автообновляется во вьюхе)
//  - /auth/qr/wizard (ОТКРЫТ) — простой HTML-мастер с автообновлением QR
//  - Автогенерация API_TOKEN при первом старте (кладётся в .env)
//  - Защищённые методы под Bearer: /me, /channels, /messages, /send, /send/media,
//    /download, /stories, /stories/of, /stories/read
//  - Сессии лежат в ./sessions/<name>.session + <name>.json
//
// Требуемые пакеты:
//   npm i telegram qrcode-terminal qrcode pino cors dotenv
// Node: ESM (type: "module") или запуск через node >= 22 с import
// ===================================================================

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import pino from 'pino';
import qrcodeTerminal from 'qrcode-terminal';
import QRCode from 'qrcode';
import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';

// ───────────────────────────────────────────────────────────
// Базовая инициализация

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const log = pino({ level: process.env.LOG_LEVEL || 'info' });

/** Конфиг */
const PORT      = Number(process.env.API_PORT || process.env.PORT || 3000);
const SESS_DIR  = path.resolve(process.env.SESSION_DIR || path.join(__dirname, '..', 'sessions'));
fs.mkdirSync(SESS_DIR, { recursive: true });

// Глобальные дефолты GramJS (могут быть переопределены в /auth/qr/start body)
const DEFAULT_API_ID   = Number(process.env.API_ID || 0);
const DEFAULT_API_HASH = String(process.env.API_HASH || '');

// Клиенты и состояние QR
/** @type {Map<string, TelegramClient>} */
const clients = new Map();
/** @type {Map<string, {status:'preparing'|'qr_ready'|'authorized'|'error'|'unknown', url?:string, err?:string, user?:any} >} */
const qrState = new Map();

// ───────────────────────────────────────────────────────────
// Утилиты

const envPath = path.resolve(__dirname, '..', '.env');

function accPaths(name){
  const json = path.join(SESS_DIR, `${name}.json`);
  const sess = path.join(SESS_DIR, `${name}.session`);
  return { json, sess };
}

function editEnvLine(file, key, value) {
  let text = '';
  try { text = fs.readFileSync(file,'utf8'); } catch {}
  const line = `${key}=${value}\n`;
  if (!text) { fs.writeFileSync(file, line, 'utf8'); return; }
  if (new RegExp(`^${key}=`, 'm').test(text)) {
    text = text.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${value}`);
  } else {
    text += line;
  }
  fs.writeFileSync(file, text, 'utf8');
}

async function ensureApiToken() {
  if (process.env.API_TOKEN && process.env.API_TOKEN.trim()) return;
  const token = crypto.randomBytes(24).toString('hex');
  editEnvLine(envPath, 'API_TOKEN', token);
  process.env.API_TOKEN = token;
}

function safeJson(obj) {
  try { return JSON.parse(JSON.stringify(obj)); } catch { return obj; }
}

async function loadClientByName(name) {
  const { json, sess } = accPaths(name);
  let str = '';
  try { str = await fsp.readFile(sess, 'utf8'); } catch {}
  if (!str) throw new Error(`No session for "${name}". Login first via /auth/qr/start`);

  let meta = {};
  try { meta = JSON.parse(await fsp.readFile(json,'utf8')); } catch {}

  const apiId   = Number(meta.apiId || DEFAULT_API_ID);
  const apiHash = String(meta.apiHash || DEFAULT_API_HASH);
  if (!apiId || !apiHash) throw new Error(`Missing apiId/apiHash for "${name}"`);

  let client = clients.get(name);
  if (!client) {
    client = new TelegramClient(new StringSession(str), apiId, apiHash, { connectionRetries: 5 });
    clients.set(name, client);
  }
  return { client, apiId, apiHash };
}

async function getInputPeer(client, spec) {
  const s = String(spec || '').trim();
  if (!s) throw new Error('peer/channel required');
  if (s === 'me') return await client.getInputEntity('me');
  if (s.startsWith('@')) return await client.getInputEntity(s);
  if (/^-?\d+$/.test(s)) return await client.getInputEntity(Number(s));
  return await client.getInputEntity(s);
}

// ───────────────────────────────────────────────────────────
// App + middleware

const app = express();
app.disable('x-powered-by');
app.use(cors({ origin: (_o,cb)=>cb(null,true) }));
app.use(express.json({ limit: '4mb' }));

await ensureApiToken();

/** Открытые маршруты: /health и всё под /auth/qr/ */
app.use((req,res,next)=>{
  const open = req.path === '/health' || req.path.startsWith('/auth/qr/');
  if (open) return next();

  const h = req.get('authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  const token = m?.[1] || '';
  if (!token || token !== (process.env.API_TOKEN || '')) {
    return res.status(401).json({ ok:false, error:'Unauthorized' });
  }
  next();
});

// ───────────────────────────────────────────────────────────
// HEALTH

app.get('/health', (_req,res)=> res.json({ ok:true, service:'tgapi', ts:Date.now() }));

// ───────────────────────────────────────────────────────────
// QR login: START / STATUS / PNG / WIZARD

app.post('/auth/qr/start', async (req,res)=>{
  try{
    // Accept both camelCase (apiId/apiHash) and snake_case (api_id/api_hash) from the request body.
    const body    = req.body || {};
    const name    = String(body.name || '').trim();
    // Prefer explicit camelCase, then snake_case, then defaults from the environment.
    const apiId   = Number((body.apiId ?? body.api_id) ?? DEFAULT_API_ID || 0);
    const apiHash = String((body.apiHash ?? body.api_hash) ?? DEFAULT_API_HASH || '');

    if (!name)                    return res.status(400).json({ ok:false, error:'name required' });
    if (!apiId || !apiHash)       return res.status(400).json({ ok:false, error:'apiId and apiHash required' });

    const { json, sess } = accPaths(name);

    // если уже авторизованы — вернём статус
    let existed = false;
    try { await fsp.access(sess); existed = true; } catch {}
    if (existed) {
      try {
        const { client } = await loadClientByName(name);
        await client.connect();
        const me = await client.getMe();
        const user = { id:String(me.id), username:me.username, firstName:me.firstName };
        qrState.set(name, { status:'authorized', user });
        return res.json({ ok:true, status:'authorized', name, user });
      } catch {
        try { await fsp.unlink(sess); } catch {}
      }
    }

    qrState.set(name, { status:'preparing' });

    // фоновая авторизация с QR (один QR, перерисовываем)
    (async ()=>{
      const client = new TelegramClient(new StringSession(''), apiId, apiHash, { connectionRetries:5 });
      await client.connect();
      try{
        let last = '';
        await client.signInUserWithQrCode({ apiId, apiHash }, {
          qrCode: async ({ token })=>{
            const url = `tg://login?token=${token.toString('base64url')}`;
            if (url !== last) {
              last = url;
              qrState.set(name, { status:'qr_ready', url });
              // ASCII-QR в консоли (перерисовываем один блок)
              console.clear();
              console.log(`\n[${name}] QR готов. Сканируй ↑\n`);
              qrcodeTerminal.generate(url, { small:true });
            }
          },
          onError: (err)=>{
            qrState.set(name, { status:'error', err:String(err?.message || err) });
            return true;
          },
        });

        await fsp.writeFile(sess, client.session.save(), 'utf8');
        await fsp.writeFile(json, JSON.stringify({ apiId, apiHash, updatedAt: Date.now() }, null, 2));

        const me = await client.getMe();
        const user = { id:String(me.id), username:me.username, firstName:me.firstName };
        qrState.set(name, { status:'authorized', user });
        clients.set(name, client);
      }catch(e){
        qrState.set(name, { status:'error', err:String(e?.message || e) });
        try { await client.disconnect(); } catch {}
      }
    })();

    res.json({ ok:true, status:'preparing', name, qr:null });
  }catch(e){
    res.status(500).json({ ok:false, error:String(e) });
  }
});

app.get('/auth/qr/status', async (req,res)=>{
  const name = String(req.query?.name || '').trim();
  if (!name) return res.status(400).json({ ok:false, error:'name required' });
  const s = qrState.get(name) || { status:'unknown' };
  res.json({ ok:true, name, status:s.status || 'unknown', qr:s.url || null, error:s.err || null, user:s.user || null });
});

// PNG-вариант QR для браузера (автообновление в визарде)
app.get('/auth/qr/png', async (req,res)=>{
  const name = String(req.query?.name || '').trim();
  const s = qrState.get(name);
  if (!name || !s || s.status !== 'qr_ready' || !s.url) {
    res.status(404).end('QR not ready');
    return;
  }
  res.setHeader('Content-Type', 'image/png');
  // добавим no-cache чтобы не лип кэшем
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  QRCode.toFileStream(res, s.url, { width: 256, margin: 2 });
});

// Лёгкий HTML-мастер
app.get('/auth/qr/wizard', (_req,res)=>{
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.end(`<!doctype html><meta charset="utf-8"><title>QR Wizard</title>
<style>
  :root{--c:#0f172a}
  body{font-family:system-ui,Segoe UI,Roboto,Arial;margin:24px;color:var(--c);max-width:740px}
  label{display:block;margin:10px 0 6px}
  input{width:100%;padding:10px;border:1px solid #e5e7eb;border-radius:10px}
  button{margin-top:14px;padding:10px 14px;border:0;border-radius:12px;background:#111827;color:#fff;cursor:pointer}
  .row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start}
  .card{border:1px solid #e5e7eb;border-radius:14px;padding:14px}
  img{border:1px solid #e5e7eb;border-radius:12px;padding:8px;background:#fff}
  code{background:#f3f4f6;padding:2px 6px;border-radius:8px}
</style>
<h1>Telegram QR Wizard</h1>
<p>1) Введи <code>api_id</code>, <code>api_hash</code> и <code>name</code>. 2) Нажми «Старт QR». 3) Отсканируй QR камерой в Telegram.</p>

<div class="grid">
  <div class="card">
    <div class="row">
      <div><label>api_id</label><input id="api_id" type="number" placeholder="25262264"></div>
      <div><label>api_hash</label><input id="api_hash" type="text" placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"></div>
    </div>
    <label>name</label><input id="name" placeholder="account1">
    <button id="start">Старт QR</button>
    <div id="stat" style="margin-top:8px;font-weight:600"></div>
  </div>

  <div class="card">
    <div style="display:flex;gap:12px;align-items:center">
      <img id="qrimg" width="256" height="256" alt="QR будет здесь">
      <div>
        <div id="qrtext" style="white-space:pre-wrap;font-family:monospace"></div>
      </div>
    </div>
  </div>
</div>

<script>
const api=location.origin; let prev="",timer=null; const $=id=>document.getElementById(id);
$('start').onclick=async()=>{
  const api_id=Number($('api_id').value.trim()); const api_hash=$('api_hash').value.trim();
  const name=$('name').value.trim();
  if(!api_id||!api_hash||!name){$('stat').innerHTML='<b>Заполни все поля.</b>';return;}
  $('stat').textContent='Запускаю...';
  let r=await fetch(api+'/auth/qr/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,apiId:api_id,apiHash:api_hash})});
  let j=await r.json();
  if(!j.ok){$('stat').textContent='Ошибка: '+(j.error||'');return;}
  $('stat').textContent='Статус: '+j.status;

  if(timer) clearInterval(timer);
  timer=setInterval(async ()=>{
    let sr=await fetch(api+'/auth/qr/status?name='+encodeURIComponent(name));
    let sj=await sr.json();
    if(!sj.ok && sj.error){$('stat').textContent=sj.error; return;}
    $('stat').textContent='Статус: '+sj.status;
    if(sj.status==='authorized'){ $('qrtext').textContent='✅ Авторизовано'; clearInterval(timer); return; }
    if(sj.qr && sj.qr!==prev){
      // текстовая ссылка на tg://login...
      $('qrtext').textContent = sj.qr;
      // PNG QR
      document.getElementById('qrimg').src = api + '/auth/qr/png?name=' + encodeURIComponent(name) + '&_=' + Date.now();
      prev=sj.qr;
    }
  }, 2000);
};
</script>`);
});

// ───────────────────────────────────────────────────────────
// Профиль / Диалоги / Каналы

app.get('/me', async (req,res)=>{
  try{
    const name = String(req.query?.name || '').trim();
    if (!name) return res.status(400).json({ ok:false, error:'name required' });
    const { client } = await loadClientByName(name);
    await client.connect();
    const me = await client.getMe();
    res.json({ ok:true, me:safeJson(me) });
  }catch(e){ res.status(500).json({ ok:false, error:String(e) }); }
});

app.get('/dialogs', async (req,res)=>{
  try{
    const name  = String(req.query?.name || '').trim();
    const limit = Math.max(1, Math.min(Number(req.query?.limit || 50), 200));
    if (!name) return res.status(400).json({ ok:false, error:'name required' });

    const { client } = await loadClientByName(name);
    await client.connect();
    const out = [];
    for await (const d of client.iterDialogs({ limit })) {
      out.push({
        id: d.entity?.id, name: d.name,
        isChannel: !!d.isChannel, isGroup: !!d.isGroup, isUser: !!d.isUser,
        username: d.entity?.username,
      });
    }
    res.json({ ok:true, dialogs: out, count: out.length });
  }catch(e){ res.status(500).json({ ok:false, error:String(e) }); }
});

app.get('/channels', async (req,res)=>{
  try{
    const name  = String(req.query?.name || '').trim();
    const limit = Math.max(1, Math.min(Number(req.query?.limit || 50), 200));
    if (!name) return res.status(400).json({ ok:false, error:'name required' });

    const { client } = await loadClientByName(name);
    await client.connect();
    const out = [];
    for await (const d of client.iterDialogs({ limit })) {
      if (d.isChannel) out.push({
        id: d.entity?.id, name: d.name,
        username: d.entity?.username, isGroup: !!d.isGroup,
      });
    }
    res.json({ ok:true, channels: out, count: out.length });
  }catch(e){ res.status(500).json({ ok:false, error:String(e) }); }
});

// ───────────────────────────────────────────────────────────
// Сообщения

async function fetchMessages({ client, peerOrChannel, limit, offsetId }) {
  const inputPeer = await getInputPeer(client, peerOrChannel);
  const resp = await client.invoke(new Api.messages.GetHistory({ peer: inputPeer, limit, offsetId }));
  const msgs = Array.isArray(resp.messages) ? resp.messages : [];
  const nextOffsetId = msgs.length ? msgs[msgs.length - 1].id : 0;
  return { messages: msgs, nextOffsetId };
}

app.get('/messages', async (req,res)=>{
  try{
    const name = String(req.query?.name || '').trim();
    const peer = String(req.query?.channel || req.query?.peer || '').trim();
    const limit = Math.max(1, Math.min(Number(req.query?.limit || 50), 200));
    const offsetId = Number(req.query?.offsetId || 0);
    if (!name || !peer) return res.status(400).json({ ok:false, error:'name and channel/peer required' });

    const { client } = await loadClientByName(name);
    await client.connect();
    const { messages, nextOffsetId } = await fetchMessages({ client, peerOrChannel: peer, limit, offsetId });
    res.json({ ok:true, messages, nextOffsetId });
  }catch(e){ res.status(500).json({ ok:false, error:String(e) }); }
});

app.get('/get-messages', async (req,res)=>{
  try{
    const name = String(req.query?.name || '').trim();
    const peer = String(req.query?.peer || req.query?.channel || '').trim();
    const limit = Math.max(1, Math.min(Number(req.query?.limit || 50), 200));
    const offsetId = Number(req.query?.offsetId || 0);
    if (!name || !peer) return res.status(400).json({ ok:false, error:'name and peer/channel required' });

    const { client } = await loadClientByName(name);
    await client.connect();
    const { messages, nextOffsetId } = await fetchMessages({ client, peerOrChannel: peer, limit, offsetId });
    res.json({ ok:true, messages, nextOffsetId });
  }catch(e){ res.status(500).json({ ok:false, error:String(e) }); }
});

app.post('/forward', async (req, res) => {
  try {
    const { name, from_peer, to_peer, message_id, as_copy } = req.body || {};
    if (!name || !from_peer || !to_peer || !message_id) {
      return res.status(400).json({ ok:false, error:'name, from_peer, to_peer, message_id required' });
    }

    const { client } = await loadClientByName(name);
    await client.connect();

    const from = await getInputPeer(client, from_peer);
    const to   = await getInputPeer(client, to_peer);

    // в Telegram это делается через ForwardMessages
    const r = await client.invoke(new Api.messages.ForwardMessages({
      fromPeer: from,
      toPeer: to,
      id: [ Number(message_id) ],
      withMyScore: false,
      dropAuthor: Boolean(as_copy),    // as_copy=true => без автора (похоже на «копию»)
      // sendAs: ... // если надо, можно добавить
    }));

    res.json({ ok:true, result: r });
  } catch (e) {
    res.status(500).json({ ok:false, error:String(e) });
  }
});
// ───────────────────────────────────────────────────────────
// Отправка

app.post('/send', async (req,res)=>{
  try{
    const { name, peer, message, replyToId } = req.body || {};
    if (!name || !peer || !message) return res.status(400).json({ ok:false, error:'name, peer, message required' });

    const { client } = await loadClientByName(name);
    await client.connect();
    const entity = await client.getEntity(peer);
    const r = await client.sendMessage(entity, { message: String(message), replyTo: replyToId ? Number(replyToId) : undefined });
    res.json({ ok:true, message: r });
  }catch(e){ res.status(500).json({ ok:false, error:String(e) }); }
});

app.post('/send/media', async (req,res)=>{
  try{
    const { name, peer, url, caption } = req.body || {};
    if (!name || !peer || !url) return res.status(400).json({ ok:false, error:'name, peer, url required' });

    const { client } = await loadClientByName(name);
    await client.connect();
    const entity = await client.getEntity(peer);
    const r = await client.sendFile(entity, { file: String(url), caption: caption ? String(caption) : undefined });
    res.json({ ok:true, message: r });
  }catch(e){ res.status(500).json({ ok:false, error:String(e) }); }
});

// ───────────────────────────────────────────────────────────
// Скачать медиа из сообщения

app.get('/download', async (req,res)=>{
  try{
    const name = String(req.query?.name || '').trim();
    const peer = String(req.query?.peer || '').trim();
    const messageId = Number(req.query?.messageId || 0);
    if (!name || !peer || !messageId) return res.status(400).json({ ok:false, error:'name, peer, messageId required' });

    const { client } = await loadClientByName(name);
    await client.connect();
    const entity = await client.getEntity(peer);
    const msgs = await client.getMessages(entity, { ids: [messageId] });
    const msg = Array.isArray(msgs) ? msgs[0] : msgs;
    if (!msg)   return res.status(404).json({ ok:false, error:'message not found' });
    const buf = await client.downloadMedia(msg, {});
    if (!buf)   return res.status(404).json({ ok:false, error:'no media' });

    res.setHeader('Content-Type','application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="media_${messageId}.bin"`);
    res.send(Buffer.from(buf));
  }catch(e){ res.status(500).json({ ok:false, error:String(e) }); }
});

// ───────────────────────────────────────────────────────────
// Stories
app.get('/stories', async (req, res) => {
  try {
    const name = String(req.query?.name || '').trim();
    const expand = String(req.query?.expand || '0') === '1';
    if (!name) return res.status(400).json({ ok:false, error:'name required' });

    const { client } = await loadClientByName(name);
    await client.connect();

    // 1) Сводка от Телеграма
    const r = await client.invoke(new Api.stories.GetAllStories({}));

    const peers = Array.isArray(r?.peerStories) ? r.peerStories : [];
    const chats = Array.isArray(r?.chats) ? r.chats : [];
    const users = Array.isArray(r?.users) ? r.users : [];

    const chatById = new Map(chats.map(c => [String(c.id), c]));
    const userById = new Map(users.map(u => [String(u.id), u]));

    // 2) Если expand=1 — дотягиваем Skipped
    if (expand) {
      for (const ps of peers) {
        const rawPeer = ps?.peer;
        const ownerId = String(rawPeer?.channelId || rawPeer?.userId || '');
        const skippedIds = (ps?.stories || [])
          .filter(s => s?.className === 'StoryItemSkipped')
          .map(s => s.id);

        if (!ownerId || skippedIds.length === 0) continue;

        try {
          // вытащим полные объекты по ID
          const full = await client.invoke(new Api.stories.GetStoriesByID({
            peer: rawPeer, // тот же peer, что и в peerStories
            id: skippedIds,
          }));
          // заменим внутри ps.stories «скипнутые» на «полные», по id
          const byId = new Map((full?.stories || []).map(s => [s.id, s]));
          ps.stories = (ps?.stories || []).map(s => {
            if (s?.className === 'StoryItemSkipped' && byId.has(s.id)) {
              return byId.get(s.id);
            }
            return s;
          });
        } catch (_) {
          // молча пропускаем, если API не вернул (приватность, лимиты и т.п.)
        }
      }
    }

    // 3) Счётчик total
    const total = peers.reduce((acc, ps) => acc + ((ps?.stories || []).length), 0);

    // 4) Нормализация в плоские items[]
    const items = [];
    for (const ps of peers) {
      const rawPeer = ps?.peer;
      const ownerId = String(rawPeer?.channelId || rawPeer?.userId || '');

      let owner = { id: ownerId, username: null, title: null, className: null, kind: 'unknown' };
      if (chatById.has(ownerId)) {
        const c = chatById.get(ownerId);
        owner = {
          id: ownerId,
          username: c.username || null,
          title: c.title || null,
          className: c.className || 'Channel',
          kind: 'channel',
        };
      } else if (userById.has(ownerId)) {
        const u = userById.get(ownerId);
        owner = {
          id: ownerId,
          username: u.username || null,
          title: [u.firstName, u.lastName].filter(Boolean).join(' ') || null,
          className: u.className || 'User',
          kind: 'user',
        };
      }

      for (const s of (ps?.stories || [])) {
        const mediaClass = s?.media?.className || null;
        items.push({
          peer: owner,
          id: s.id,
          date: s.date,
          expireDate: s.expireDate,
          caption: s.caption || null,
          mediaClass,
          isPhoto: mediaClass === 'MessageMediaPhoto',
          isVideo: mediaClass === 'MessageMediaDocument',
        });
      }
    }

    res.json({ ok:true, total, items, raw: r, expanded: expand });
  } catch (e) {
    res.status(500).json({ ok:false, error:String(e) });
  }
});

app.get('/stories/of', async (req, res) => {
  try {
    const name = String(req.query?.name || '').trim();
    const peer = String(req.query?.peer || '').trim();
    const limit = Math.max(1, Math.min(Number(req.query?.limit || 0) || 0, 100));
    const minId = Number(req.query?.minId || 0) || 0;
    const maxId = Number(req.query?.maxId || 0) || 0;

    if (!name || !peer) return res.status(400).json({ ok:false, error:'name and peer required' });

    const { client } = await loadClientByName(name);
    await client.connect();
    const input = await getInputPeer(client, peer);

    try {
      const r = await client.invoke(new Api.stories.GetUserStories({ userId: input }));
      const arr = (r?.stories?.stories || r?.stories || []).filter(Boolean);
      const filtered = arr.filter(s => {
        if (minId && s.id < minId) return false;
        if (maxId && s.id > maxId) return false;
        return true;
      });
      const sliced = limit ? filtered.slice(0, limit) : filtered;
      return res.json({ ok:true, count: sliced.length, stories: sliced, raw: r });
    } catch {
      // важное изменение: НЕ дергаем GetStoriesByID([]) → просто пусто
      return res.json({ ok:true, count: 0, stories: [] });
    }
  } catch (e) {
    return res.status(500).json({ ok:false, error:String(e) });
  }
});

app.post('/stories/read', async (req,res)=>{
  try{
    const { name, peer, maxId } = req.body || {};
    if (!name || !peer || !maxId) return res.status(400).json({ ok:false, error:'name, peer, maxId required' });

    const { client } = await loadClientByName(name);
    await client.connect();
    const input = await getInputPeer(client, peer);
    const r = await client.invoke(new Api.stories.ReadStories({ peer: input, maxId: Number(maxId) }));
    res.json({ ok:true, raw: r });
  }catch(e){ res.status(500).json({ ok:false, error:String(e) }); }
});

// ───────────────────────────────────────────────────────────
// Глобальный обработчик ошибок

app.use((err,req,res,_next)=>{
  log.error({ err: String(err?.message || err) }, 'Unhandled');
  res.status(500).json({ ok:false, error:'Internal Server Error' });
});

// ───────────────────────────────────────────────────────────
// Старт

app.listen(PORT, ()=>{
  console.log(`API on :${PORT}
Open routes:
  GET  /health
  POST /auth/qr/start        {name, apiId, apiHash}
  GET  /auth/qr/status?name=...
  GET  /auth/qr/png?name=...
  GET  /auth/qr/wizard

Protected (Bearer API_TOKEN from .env):
  GET  /me?name=
  GET  /dialogs?name=&limit=
  GET  /channels?name=&limit=
  GET  /messages?name=&(peer|channel)=&limit=&offsetId=
  GET  /get-messages?name=&(peer|channel)=&limit=&offsetId=
  POST /send                {name, peer, message, replyToId?}
  POST /send/media          {name, peer, url, caption?}
  GET  /download?name=&peer=&messageId=
  GET  /stories?name=
  GET  /stories/of?name=&peer=
  POST /stories/read        {name, peer, maxId}
`);
});
