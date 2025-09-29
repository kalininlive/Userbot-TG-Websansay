// /opt/tgapi/src/server.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import pino from 'pino';
import QRCode from 'qrcode';
import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const log = pino({ level: process.env.LOG_LEVEL || 'info' });

const PORT = Number(process.env.API_PORT || 3000);
const SESS_DIR = path.resolve(process.env.SESSION_DIR || path.join(__dirname, '..', 'sessions'));
fs.mkdirSync(SESS_DIR, { recursive: true });

const DEFAULT_API_ID = Number(process.env.API_ID || 0);
const DEFAULT_API_HASH = String(process.env.API_HASH || '');

const clients = new Map();
const qrState = new Map();

function accPaths(name) {
  const json = path.join(SESS_DIR, `${name}.json`);
  const sess = path.join(SESS_DIR, `${name}.session`);
  return { json, sess };
}

async function loadClientByName(name) {
  const { json, sess } = accPaths(name);
  let str = '';
  try { str = await fsp.readFile(sess, 'utf8'); } catch {}
  if (!str) throw new Error(`No session for "${name}". Login first via /auth/qr/start`);

  let meta = {};
  try { meta = JSON.parse(await fsp.readFile(json,'utf8')); } catch {}

  const apiId = Number(meta.apiId || DEFAULT_API_ID);
  const apiHash = String(meta.apiHash || DEFAULT_API_HASH);
  if (!apiId || !apiHash) throw new Error(`Missing apiId/apiHash for "${name}"`);

  let client = clients.get(name);
  if (!client || !client.connected) {
    client = new TelegramClient(new StringSession(str), apiId, apiHash, { connectionRetries: 5 });
    clients.set(name, client);
  }
  return { client, apiId, apiHash };
}

const app = express();
app.disable('x-powered-by');
app.use(cors({ origin: true }));
app.use(express.json({ limit: '4mb' }));

app.use((req, res, next) => {
  if (process.env.API_TOKEN) {
    const open = req.path === '/health' || req.path.startsWith('/auth/qr/');
    if (open) return next();
    const h = req.get('authorization') || '';
    const m = h.match(/^Bearer\s+(.+)$/i);
    const token = m?.[1] || '';
    if (!token || token !== process.env.API_TOKEN) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
  }
  next();
});

app.get('/health', (_req, res) => res.json({ ok: true, service: 'tgapi', ts: Date.now() }));

app.post('/auth/qr/start', async (req, res) => {
  try {
    const { name, apiId, apiHash } = req.body || {};
    if (!name || !apiId || !apiHash) return res.status(400).json({ ok: false, error: 'name, apiId, and apiHash are required' });
    
    const { json, sess } = accPaths(name);
    if (fs.existsSync(sess)) {
        try {
            const { client } = await loadClientByName(name);
            if (!client.connected) await client.connect();
            const me = await client.getMe();
            const user = { id: String(me.id), username: me.username, firstName: me.firstName };
            qrState.set(name, { status: 'authorized', user });
            return res.json({ ok: true, status: 'authorized', name, user });
        } catch (e) {
            log.warn(`Session for '${name}' is invalid. Deleting. Error: ${e.message}`);
            try { await fsp.unlink(sess); } catch {}
        }
    }

    qrState.set(name, { status: 'preparing' });

    (async () => {
      const client = new TelegramClient(new StringSession(''), apiId, apiHash, { connectionRetries: 5 });
      try {
        await client.connect();
        let lastUrl = '';
        await client.signInUserWithQrCode({ apiId, apiHash }, {
          qrCode: async ({ token }) => {
            const url = `tg://login?token=${token.toString('base64url')}`;
            if (url !== lastUrl) {
              lastUrl = url;
              qrState.set(name, { status: 'qr_ready', url });
              log.info(`[${name}] QR code generated/updated.`);
            }
          },
          onError: (err) => {
            qrState.set(name, { status: 'error', err: String(err?.message || err) });
            return true;
          },
        });
        await fsp.writeFile(sess, client.session.save(), 'utf8');
        await fsp.writeFile(json, JSON.stringify({ apiId, apiHash, updatedAt: Date.now() }, null, 2));
        const me = await client.getMe();
        const user = { id: String(me.id), username: me.username, firstName: me.firstName };
        qrState.set(name, { status: 'authorized', user });
        clients.set(name, client);
      } catch (e) {
        qrState.set(name, { status: 'error', err: String(e?.message || e) });
        try { if (client.connected) await client.disconnect(); } catch {}
      }
    })();
    res.json({ ok: true, status: 'preparing', name });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.get('/auth/qr/status', (req, res) => {
  const name = String(req.query?.name || '').trim();
  if (!name) return res.status(400).json({ ok: false, error: 'name required' });
  const s = qrState.get(name) || { status: 'unknown' };
  res.json({ ok: true, name, ...s });
});

app.get('/auth/qr/png', (req, res) => {
    const name = String(req.query?.name || '').trim();
    const s = qrState.get(name);
    if (!name || !s || s.status !== 'qr_ready' || !s.url) {
        return res.status(404).end('QR not ready');
    }
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    QRCode.toFileStream(res, s.url, { width: 256, margin: 2 });
});

// Other API endpoints like /me, /dialogs, etc.
app.get('/me', async (req,res)=>{
  try{
    const name = String(req.query?.name || '').trim();
    if (!name) return res.status(400).json({ ok:false, error:'name required' });
    const { client } = await loadClientByName(name);
    await client.connect();
    const me = await client.getMe();
    res.json({ ok:true, me: JSON.parse(JSON.stringify(me)) });
  }catch(e){ res.status(500).json({ ok:false, error:e.message }); }
});


app.use((err, req, res, _next) => {
  log.error({ err: String(err?.message || err), path: req.path }, 'Unhandled Error');
  if (res.headersSent) return;
  res.status(500).json({ ok: false, error: 'Internal Server Error' });
});

app.listen(PORT, () => {
  log.info(`API server started on http://127.0.0.1:${PORT}`);
});
