cat > /opt/tgapi/src/server.js <<'JS'
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const PORT      = process.env.API_PORT || 3000;
const API_TOKEN = process.env.API_TOKEN || '';
const SESS_DIR  = path.resolve(process.env.SESSION_DIR || './sessions');
fs.mkdirSync(SESS_DIR, { recursive: true });

/* health */
app.get('/health', (_req,res)=>res.json({ ok:true, service:'tgapi', ts:Date.now() }));

/* auth middleware (кроме /health и /auth/qr/wizard) */
app.use((req,res,next)=>{
  if (req.path === '/health' || req.path === '/auth/qr/wizard') return next();
  const auth = req.headers.authorization || '';
  if (!API_TOKEN || !auth.startsWith('Bearer ') || auth.slice(7) !== API_TOKEN) {
    return res.status(401).json({ ok:false, error:'Unauthorized' });
  }
  next();
});

/* file helpers */
function accPaths(name){
  const json = path.join(SESS_DIR, `${name}.json`);
  const sess = path.join(SESS_DIR, `${name}.session`);
  const qrf  = path.join(SESS_DIR, `${name}.qr.json`);
  return { json, sess, qrf };
}
function loadAcc(name){
  const { json, sess, qrf } = accPaths(name);
  const cfg           = fs.existsSync(json) ? JSON.parse(fs.readFileSync(json,'utf-8')) : null;
  const sessionString = fs.existsSync(sess) ? fs.readFileSync(sess,'utf-8') : '';
  const qrState       = fs.existsSync(qrf)  ? JSON.parse(fs.readFileSync(qrf,'utf-8')) : null;
  return { cfg, sessionString, qrState };
}
function saveAcc(name, cfg, sessionString){
  const { json, sess } = accPaths(name);
  if (cfg) fs.writeFileSync(json, JSON.stringify(cfg,null,2), { mode:0o600 });
  if (sessionString !== null && sessionString !== undefined) {
    fs.writeFileSync(sess, sessionString, { mode:0o600 });
  }
}
function saveQrState(name, state){
  const { qrf } = accPaths(name);
  fs.writeFileSync(qrf, JSON.stringify(state,null,2), { mode:0o600 });
}

/* GramJS */
async function getGram(){
  const { TelegramClient } = await import('telegram');
  const { StringSession }  = await import('telegram/sessions/index.js');
  const { Api }            = await import('telegram/tl/index.js');
  return { TelegramClient, StringSession, Api };
}
function buildClient(TelegramClient, StringSession, apiId, apiHash, sessionString=''){
  const stringSession = new StringSession(sessionString || '');
  return new TelegramClient(stringSession, Number(apiId), String(apiHash), { connectionRetries: 5 });
}

/* start QR */
app.post('/auth/qr/start', async (req,res)=>{
  try{
    const { name, api_id, api_hash } = req.body || {};
    if (!name || !api_id || !api_hash) return res.status(400).json({ ok:false, error:'name, api_id, api_hash required' });

    const { cfg, sessionString } = loadAcc(name);
    const { TelegramClient, StringSession } = await getGram();
    const client = buildClient(TelegramClient, StringSession, api_id, api_hash, sessionString);
    await client.connect();

    let latestUrl = null;

    (async ()=>{
      try{
        await client.signInUserWithQrCode(
          { apiId:Number(api_id), apiHash:String(api_hash) },
          {
            qrCode: async ({ token })=>{
              // base64url для tg://login
              const b64url = token.toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
              latestUrl = `tg://login?token=${b64url}`;
              saveQrState(name, { name, api_id, api_hash, status:'waiting', login_url: latestUrl, updated_at: new Date().toISOString() });
            },
            onError: (err)=>{
              saveQrState(name, { name, api_id, api_hash, status:'error', error:String(err), login_url: latestUrl, updated_at: new Date().toISOString() });
              return true;
            },
          }
        );
        const saved = client.session.save();
        saveAcc(name, { ...(cfg||{}), name, api_id, api_hash, updated_at: new Date().toISOString() }, saved);
        saveQrState(name, { name, api_id, api_hash, status:'authorized', login_url: latestUrl, updated_at: new Date().toISOString() });
      }catch(e){
        saveQrState(name, { name, api_id, api_hash, status:'error', error:String(e), login_url: latestUrl, updated_at: new Date().toISOString() });
      }finally{
        await client.disconnect();
      }
    })();

    const started = Date.now();
    while(!latestUrl && Date.now()-started<5000) await new Promise(r=>setTimeout(r,100));
    if (latestUrl) return res.json({ ok:true, name, status:'waiting', login_url: latestUrl });
    saveQrState(name, { name, api_id, api_hash, status:'waiting', login_url: null, updated_at: new Date().toISOString() });
    return res.json({ ok:true, name, status:'waiting', login_url: null });
  }catch(e){
    return res.status(500).json({ ok:false, error:String(e) });
  }
});

/* status */
app.get('/auth/qr/status', async (req,res)=>{
  try{
    const name = req.query.name;
    if (!name) return res.status(400).json({ ok:false, error:'name required' });
    const { cfg, sessionString, qrState } = loadAcc(name);
    if (sessionString && cfg?.api_id && cfg?.api_hash) return res.json({ ok:true, name, status:'authorized' });
    if (qrState) return res.json({ ok:true, ...qrState });
    return res.json({ ok:false, error:'no qr session' });
  }catch(e){
    return res.status(500).json({ ok:false, error:String(e) });
  }
});

/* me */
app.get('/me', async (req,res)=>{
  try{
    const name = req.query.name;
    if (!name) return res.status(400).json({ ok:false, error:'name required' });
    const { cfg, sessionString } = loadAcc(name);
    if (!cfg?.api_id || !cfg?.api_hash || !sessionString) return res.status(400).json({ ok:false, error:'account not authorized' });
    const { TelegramClient, StringSession } = await getGram();
    const client = buildClient(TelegramClient, StringSession, cfg.api_id, cfg.api_hash, sessionString);
    await client.connect();
    const me = await client.getMe();
    await client.disconnect();
    return res.json({ ok:true, me });
  }catch(e){
    return res.status(500).json({ ok:false, error:String(e) });
  }
});

/* HTML wizard (тестовый) */
app.get('/auth/qr/wizard', (_req,res)=>{
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.end(`<!doctype html><meta charset="utf-8"><title>QR Wizard</title>
<style>body{font-family:system-ui;margin:20px;max-width:720px}label{display:block;margin:8px 0 4px}input{width:100%;padding:8px;border:1px solid #ddd;border-radius:8px}button{margin-top:12px;padding:10px 14px;border:0;border-radius:10px;cursor:pointer}.row{display:grid;grid-template-columns:1fr 1fr;gap:12px}pre{white-space:pre-wrap}</style>
<h1>Telegram QR Wizard</h1>
<div class="row"><div><label>api_id</label><input id="api_id" type="number" placeholder="25262264"></div><div><label>api_hash</label><input id="api_hash" type="text" placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"></div></div>
<label>name</label><input id="name" placeholder="account1"><label>API_TOKEN</label><input id="token" placeholder="из .env"><button id="start">Старт QR</button>
<div id="stat"></div><pre id="qr"></pre>
<script>
const api=location.origin; let prev="",timer=null; const $=id=>document.getElementById(id);
$('start').onclick=async()=>{ const api_id=Number($('api_id').value.trim()); const api_hash=$('api_hash').value.trim(); const name=$('name').value.trim(); const token=$('token').value.trim();
  if(!api_id||!api_hash||!name||!token){$('stat').innerHTML='<b>Заполни все поля.</b>';return;}
  $('stat').textContent='Запускаю...'; let r=await fetch(api+'/auth/qr/start',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify({name,api_id,api_hash})});
  let j=await r.json(); if(!j.ok){$('stat').textContent='Ошибка: '+(j.error||'');return;} $('stat').textContent='Статус: '+j.status;
  if(timer) clearInterval(timer); timer=setInterval(async ()=>{ let sr=await fetch(api+'/auth/qr/status?name='+encodeURIComponent(name),{headers:{'Authorization':'Bearer '+token}}); let sj=await sr.json();
    if(!sj.ok && sj.error){$('stat').textContent=sj.error; return;} if(sj.status==='authorized'){ $('stat').textContent='✅ Авторизовано'; $('qr').textContent=''; clearInterval(timer); return; }
    if(sj.login_url && sj.login_url!==prev){ $('qr').textContent='Открой на телефоне:\\n'+sj.login_url; prev=sj.login_url; } },3000);
};
</script>`);
});

app.listen(PORT, ()=>console.log(`[tgapi] listening on port ${PORT}`));
JS

