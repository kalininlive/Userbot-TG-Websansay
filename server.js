// server.js — финальная версия API с QR Wizard
// Полная версия подготовлена в гайде, сюда скопируй содержимое из документации.

import 'dotenv/config';
import express from 'express';

const app = express();
app.get('/health', (_req,res)=>res.json({ok:true, service:'tgapi'}));

const PORT = process.env.API_PORT || 3000;
app.listen(PORT, ()=>console.log(`[tgapi] listening on port ${PORT}`));
