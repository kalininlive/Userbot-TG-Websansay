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

app.get('/health', (_req,res)=>res.json({ ok:true, service:'tgapi', ts:Date.now() }));

app.use((req,res,next)=>{
  if (req.path === '/health' || req.path === '/auth/qr/wizard') return next();
  const auth = req.headers.authorization || '';
  if (!API_TOKEN || !auth.startsWith('Bearer ') || auth.slice(7) !== API_TOKEN) {
    return res.status(401).json({ ok:false, error:'Unauthorized' });
  }
  next();
});

app.listen(PORT, ()=>console.log(`[tgapi] listening on port ${PORT}`));
JS
