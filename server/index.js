require('dotenv').config();

process.on('unhandledRejection', (reason) => {
  console.error('[UnhandledRejection]', reason);
});

const http = require('http');
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const bcrypt = require('bcryptjs');
const { Server } = require('socket.io');
const userService = require('./userService');
const supabase    = require('./supabase');
const https = require('https');

const APP_URL = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');

async function sendVerificationEmail(to, token) {
  const link = `${APP_URL}/verify-email?token=${token}`;
  const body = JSON.stringify({
    sender:      { name: 'Verbum9', email: process.env.BREVO_SENDER_EMAIL || to },
    to:          [{ email: to }],
    subject:     'Verbum9 — E-posta Adresini Doğrula',
    htmlContent: `
      <div style="font-family:system-ui;max-width:480px;margin:0 auto;padding:32px;background:#0f0e17;color:#fff;border-radius:16px">
        <h1 style="margin:0 0 24px;letter-spacing:-1px">
          <span style="color:#e94560">VERBUM</span><span style="color:#4cc9f0">9</span>
        </h1>
        <p style="font-size:1rem;margin:0 0 8px">Merhaba!</p>
        <p style="color:#8892b0;line-height:1.6;margin:0 0 24px">
          Hesabını aktifleştirmek için aşağıdaki butona bas. Link 24 saat geçerlidir.
        </p>
        <a href="${link}"
           style="display:inline-block;padding:14px 28px;background:#e94560;color:#fff;
                  border-radius:10px;text-decoration:none;font-weight:700;font-size:1rem">
          E-postamı Doğrula →
        </a>
        <p style="color:#8892b0;font-size:0.8rem;margin-top:24px;word-break:break-all">
          Buton çalışmıyorsa bu linki tarayıcına kopyala:<br>${link}
        </p>
      </div>
    `,
  });

  await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.brevo.com',
      path:     '/v3/smtp/email',
      method:   'POST',
      headers:  {
        'accept':       'application/json',
        'api-key':      (process.env.BREVO_API_KEY || '').trim(),
        'content-type': 'application/json',
        'content-length': String(Buffer.byteLength(body)),
      },
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve();
        else reject(new Error(`Brevo ${res.statusCode}: ${data}`));
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function sendPasswordResetEmail(to, token, username) {
  const link = `${APP_URL}/reset-password?token=${token}`;
  const body = JSON.stringify({
    sender:      { name: 'Verbum9', email: process.env.BREVO_SENDER_EMAIL || to },
    to:          [{ email: to }],
    subject:     'Verbum9 — Şifre Sıfırlama',
    htmlContent: `
      <div style="font-family:system-ui;max-width:480px;margin:0 auto;padding:32px;background:#0f0e17;color:#fff;border-radius:16px">
        <h1 style="margin:0 0 24px;letter-spacing:-1px">
          <span style="color:#e94560">VERBUM</span><span style="color:#4cc9f0">9</span>
        </h1>
        <p style="font-size:1rem;margin:0 0 8px">Merhaba <strong>${username}</strong>!</p>
        <p style="color:#8892b0;line-height:1.6;margin:0 0 24px">
          <strong style="color:#fff">Verbum9</strong>'daki <strong style="color:#4cc9f0">${username}</strong>
          hesabın için şifre sıfırlama isteği aldık.<br><br>
          Aşağıdaki butona basarak yeni şifreni belirleyebilirsin. Link <strong style="color:#fff">1 saat</strong> geçerlidir.<br><br>
          <span style="font-size:0.9rem">Bu isteği sen yapmadıysan bu e-postayı görmezden gelebilirsin, şifren değişmeyecek.</span>
        </p>
        <a href="${link}"
           style="display:inline-block;padding:14px 28px;background:#e94560;color:#fff;
                  border-radius:10px;text-decoration:none;font-weight:700;font-size:1rem">
          Şifremi Sıfırla →
        </a>
        <p style="color:#8892b0;font-size:0.8rem;margin-top:24px;word-break:break-all">
          Buton çalışmıyorsa bu linki tarayıcına kopyala:<br>${link}
        </p>
      </div>
    `,
  });

  await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.brevo.com',
      path:     '/v3/smtp/email',
      method:   'POST',
      headers:  {
        'accept':         'application/json',
        'api-key':        (process.env.BREVO_API_KEY || '').trim(),
        'content-type':   'application/json',
        'content-length': String(Buffer.byteLength(body)),
      },
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve();
        else reject(new Error(`Brevo ${res.statusCode}: ${data}`));
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function sendInviteEmail(to, fromName, message) {
  const link = APP_URL;
  const msgBlock = message
    ? `<p style="color:#ccd6f6;line-height:1.7;margin:0 0 24px;padding:14px 18px;background:#16213e;border-radius:10px;border-left:3px solid #e94560">
        <em>"${message}"</em>
       </p>`
    : '';
  const body = JSON.stringify({
    sender:      { name: 'Verbum9', email: process.env.BREVO_SENDER_EMAIL },
    to:          [{ email: to }],
    subject:     `${fromName} seni Verbum oynamaya davet ediyor!`,
    htmlContent: `
      <div style="font-family:system-ui;max-width:480px;margin:0 auto;padding:32px;background:#0f0e17;color:#fff;border-radius:16px">
        <h1 style="margin:0 0 24px;letter-spacing:-1px">
          <span style="color:#e94560">VERBUM</span><span style="color:#4cc9f0">9</span>
        </h1>
        <p style="font-size:1rem;margin:0 0 16px">Merhaba!</p>
        <p style="color:#ccd6f6;line-height:1.7;margin:0 0 20px">
          Arkadaşın <strong style="color:#fff">${fromName}</strong> seni Verbum oynamaya davet ediyor.
        </p>
        ${msgBlock}
        <p style="color:#ccd6f6;line-height:1.7;margin:0 0 28px">
          Aşağıdaki linke tıklayarak kaydolabilirsin.
        </p>
        <a href="${link}"
           style="display:inline-block;padding:14px 28px;background:#e94560;color:#fff;
                  border-radius:10px;text-decoration:none;font-weight:700;font-size:1rem">
          Verbum9'a Katıl →
        </a>
        <p style="color:#8892b0;font-size:0.8rem;margin-top:24px;word-break:break-all">
          Buton çalışmıyorsa: ${link}
        </p>
      </div>
    `,
  });

  await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.brevo.com',
      path:     '/v3/smtp/email',
      method:   'POST',
      headers:  {
        'accept':         'application/json',
        'api-key':        (process.env.BREVO_API_KEY || '').trim(),
        'content-type':   'application/json',
        'content-length': String(Buffer.byteLength(body)),
      },
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve();
        else reject(new Error(`Brevo ${res.statusCode}: ${data}`));
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function resetPasswordPage(token) {
  return `<!DOCTYPE html><html lang="tr"><head><meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Verbum9 — Şifre Sıfırla</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:system-ui;min-height:100vh;display:flex;align-items:center;
         justify-content:center;background:#0f0e17;color:#fff;padding:24px}
    .card{background:#1a1a2e;border-radius:20px;padding:40px 32px;text-align:center;
          max-width:420px;width:100%}
    h1{font-size:2rem;letter-spacing:-1px;margin-bottom:8px}
    p{color:#8892b0;line-height:1.6;margin-bottom:24px;font-size:.9rem}
    .fg{text-align:left;margin-bottom:16px}
    label{display:block;font-size:.75rem;color:#8892b0;text-transform:uppercase;
          letter-spacing:1px;margin-bottom:6px}
    input{width:100%;padding:12px 14px;border-radius:10px;border:1px solid rgba(255,255,255,.08);
          background:#16213e;color:#fff;font-size:1rem;outline:none}
    input:focus{border-color:#4cc9f0}
    button{width:100%;padding:14px;border-radius:10px;border:none;
           background:#e94560;color:#fff;font-size:1rem;font-weight:700;cursor:pointer;margin-top:4px}
    button:disabled{opacity:.6;cursor:not-allowed}
    .msg{padding:10px;border-radius:8px;margin-top:12px;font-size:.9rem}
    .msg.ok{background:rgba(6,214,160,.15);color:#06d6a0}
    .msg.err{background:rgba(239,35,60,.15);color:#ef233c}
    a{display:inline-block;margin-top:20px;color:#4cc9f0;font-size:.9rem;text-decoration:none}
  </style>
  </head><body>
  <div class="card">
    <h1><span style="color:#e94560">VERBUM</span><span style="color:#4cc9f0">9</span></h1>
    <p>Yeni şifreni gir.</p>
    <form id="frm" onsubmit="doReset(event)">
      <div class="fg"><label>Yeni Şifre</label>
        <input type="password" id="pw" placeholder="en az 6 karakter" required></div>
      <div class="fg"><label>Şifre Tekrar</label>
        <input type="password" id="pw2" placeholder="şifreyi tekrar gir" required></div>
      <button type="submit" id="btn">Şifremi Güncelle</button>
      <div id="msg" class="msg" style="display:none"></div>
    </form>
    <a href="/">← Giriş Ekranına Dön</a>
  </div>
  <script>
    async function doReset(e){
      e.preventDefault();
      const pw=document.getElementById('pw').value;
      const pw2=document.getElementById('pw2').value;
      const msg=document.getElementById('msg');
      msg.style.display='none';
      if(pw.length<6){msg.className='msg err';msg.textContent='Şifre en az 6 karakter olmalı.';msg.style.display='block';return;}
      if(pw!==pw2){msg.className='msg err';msg.textContent='Şifreler eşleşmiyor.';msg.style.display='block';return;}
      const btn=document.getElementById('btn');
      btn.disabled=true;btn.textContent='Güncelleniyor...';
      const res=await fetch('/api/auth/reset-password',{method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({token:'${token}',newPassword:pw})});
      const data=await res.json();
      btn.disabled=false;btn.textContent='Şifremi Güncelle';
      msg.style.display='block';
      if(data.ok){msg.className='msg ok';msg.textContent='Şifren güncellendi! Şimdi giriş yapabilirsin.';
        document.getElementById('frm').hidden=true;}
      else{msg.className='msg err';msg.textContent=data.error||'Hata oluştu.';}
    }
  </script>
  </body></html>`;
}

function verifyPage(msg, success) {
  const color = success ? '#06d6a0' : '#ef233c';
  return `<!DOCTYPE html><html lang="tr"><head><meta charset="UTF-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Verbum9</title>
    <style>*{box-sizing:border-box;margin:0;padding:0}
    body{font-family:system-ui;min-height:100vh;display:flex;align-items:center;
         justify-content:center;background:#0f0e17;color:#fff;padding:24px}
    .card{background:#1a1a2e;border-radius:20px;padding:40px 32px;text-align:center;
          max-width:420px;width:100%}
    h1{font-size:2.5rem;letter-spacing:-1px;margin-bottom:24px}
    .icon{font-size:3rem;margin-bottom:16px}
    p{color:#8892b0;line-height:1.6;margin-bottom:24px}
    a{display:inline-block;padding:12px 24px;background:#e94560;color:#fff;
      border-radius:10px;text-decoration:none;font-weight:700}</style>
  </head><body><div class="card">
    <h1><span style="color:#e94560">VERBUM</span><span style="color:#4cc9f0">9</span></h1>
    <div class="icon">${success ? '✅' : '❌'}</div>
    <p style="color:${color};font-weight:600;font-size:1.1rem">${msg}</p>
    <a href="/">Oyuna Git →</a>
  </div></body></html>`;
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingTimeout: 60000,   // 60s yanıt gelmezse kopar
  pingInterval: 25000,  // 25s'de bir ping
});

const PORT = process.env.PORT || 3000;
const WORDS_PATH = path.join(__dirname, '../data/words.json');

// ─── Günlük Mod Yardımcıları ──────────────────────────────────

function getDailyDate() {
  const tz = process.env.DAILY_RESET_TIMEZONE || 'UTC';
  return new Date().toLocaleDateString('en-CA', { timeZone: tz }); // 'YYYY-MM-DD'
}

let _nineLetterWords = null;
function getNineLetterWords() {
  if (_nineLetterWords) return _nineLetterWords;
  const data = JSON.parse(require('fs').readFileSync(WORDS_PATH, 'utf8'));
  _nineLetterWords = (data.words || []).filter(w => w.length === 9);
  return _nineLetterWords;
}

async function getTodayPuzzle() {
  const date = getDailyDate();
  const { data: existing } = await supabase.from('daily_puzzles').select('*').eq('date', date).maybeSingle();
  if (existing) return existing;
  const words = getNineLetterWords();
  const word = words[Math.floor(Math.random() * words.length)].toLocaleUpperCase('tr-TR');
  const matrix = [...word].sort(() => Math.random() - 0.5);
  const { data } = await supabase.from('daily_puzzles').insert({ date, word, matrix }).select().single();
  return data;
}

async function checkTDK(word, withMeanings = false) {
  return new Promise(resolve => {
    const req = https.request({
      hostname: 'sozluk.gov.tr',
      path:     `/gts?ara=${encodeURIComponent(word)}`,
      method:   'GET',
      headers:  { 'User-Agent': 'Verbum9/1.0' },
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const found = Array.isArray(json) && json.length > 0;
          if (!withMeanings) return resolve(found);
          if (!found) return resolve(null);
          const meanings = json.flatMap(entry =>
            (entry.anlamlarListe || []).map(a => {
              const ozellik = (a.ozelliklerListe || []).map(o => o.tam_adi).filter(Boolean).join(', ');
              return ozellik ? `(${ozellik}) ${a.anlam}` : a.anlam;
            })
          ).filter(Boolean).slice(0, 5);
          resolve({ word, meanings });
        } catch { resolve(withMeanings ? null : false); }
      });
    });
    req.on('error', () => resolve(withMeanings ? null : false));
    req.setTimeout(5000, () => { req.destroy(); resolve(withMeanings ? null : false); });
    req.end();
  });
}

function requireAdmin(req, res, next) {
  const adminPass = process.env.ADMIN_PASSWORD;
  if (!adminPass) return next(); // şifre tanımlanmamışsa geç
  const auth = req.headers['authorization'] || '';
  const b64 = auth.replace('Basic ', '');
  const decoded = Buffer.from(b64, 'base64').toString('utf8');
  const password = decoded.split(':').slice(1).join(':');
  if (password === adminPass) return next();
  res.set('WWW-Authenticate', 'Basic realm="Verbum9 Admin"');
  res.status(401).send('Yetkisiz erişim.');
}

async function requireAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ ok: false, error: 'Giriş gerekli.' });
  const user = await userService.getUserByToken(token);
  if (!user) return res.status(401).json({ ok: false, error: 'Geçersiz token.' });
  req.user = user;
  next();
}

app.use(express.json());
app.use(express.static(path.join(__dirname, '../client')));
// /data → kelime sözlükleri erişilebilir, başka dosya değil
app.get('/data/words.json', (req, res) => res.sendFile(WORDS_PATH));
app.get('/data/words_:lang.json', (req, res) => {
  const lang = req.params.lang.replace(/[^a-z]/g, '');
  if (!lang) return res.status(400).end();
  const p = path.join(__dirname, '../data', `words_${lang}.json`);
  if (!fs.existsSync(p)) return res.status(404).end();
  res.sendFile(p);
});

// ─── Yardımcılar ──────────────────────────────────────────────

function readWords() {
  return JSON.parse(fs.readFileSync(WORDS_PATH, 'utf8'));
}
function writeWords(data) {
  fs.writeFileSync(WORDS_PATH, JSON.stringify(data), 'utf8');
}
function extractToken(req) {
  return (req.headers['authorization'] || '').replace('Bearer ', '').trim() || null;
}
function getLocalIP() {
  for (const nets of Object.values(os.networkInterfaces())) {
    for (const net of nets) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

// ─── Sözlük arama sayfası ─────────────────────────────────────

app.get('/sozluk', requireAdmin, (req, res) => {
  const data = readWords();
  const sorted = [...data.words].sort((a, b) => a.localeCompare(b, 'tr'));
  res.send(`<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verbum9 Sözlüğü</title>
  <style>
    body{font-family:'Segoe UI',sans-serif;background:#0f0e17;color:#fff;padding:20px}
    h1{color:#e94560;margin-bottom:4px} nav{margin-bottom:16px;font-size:.9rem}
    nav a{color:#4cc9f0;text-decoration:none;margin-right:16px}
    input{padding:10px 14px;border-radius:8px;border:1px solid #333;background:#1a1a2e;color:#fff;width:min(360px,100%);font-size:1rem;outline:none}
    input:focus{border-color:#4cc9f0} .count{color:#8892b0;margin:12px 0 8px;font-size:.9rem}
    .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:4px}
    .word{padding:5px 10px;background:#1a1a2e;border-radius:6px;font-size:.95rem;border-left:3px solid #16213e}
    .word.hl{border-left-color:#e94560;background:#1e0a0f}
  </style>
</head>
<body>
  <h1>Verbum9 Sözlüğü</h1>
  <nav><a href="/">← Oyuna dön</a><a href="/admin">Admin →</a></nav>
  <input id="q" placeholder="Kelime ara..." oninput="filter()" autofocus>
  <div class="count" id="cnt">${sorted.length} kelime</div>
  <div class="grid" id="list">${sorted.map(w => `<div class="word">${w}</div>`).join('')}</div>
  <script>
    const all=${JSON.stringify(sorted)};
    function filter(){
      const q=document.getElementById('q').value.toLocaleLowerCase('tr-TR');
      const hits=q?all.filter(w=>w.includes(q)):all;
      document.getElementById('cnt').textContent=hits.length+' kelime';
      document.getElementById('list').innerHTML=hits.map(w=>'<div class="word'+(q?' hl':'')+'">' +w+'</div>').join('');
    }
  </script>
</body></html>`);
});

// ─── Admin paneli ─────────────────────────────────────────────

app.get('/admin', requireAdmin, (req, res) => {
  const data = readWords();
  const homophones = (data.homophones || []).sort((a, b) => a.localeCompare(b, 'tr'));
  res.send(`<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verbum9 Admin</title>
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Segoe UI',sans-serif;background:#0f0e17;color:#fff;padding:24px;max-width:680px;margin:0 auto}
    h1{color:#e94560;font-size:1.6rem;margin-bottom:4px}
    h2{font-size:.9rem;color:#8892b0;text-transform:uppercase;letter-spacing:2px;margin:28px 0 12px}
    nav{margin-bottom:24px;font-size:.9rem}
    nav a{color:#4cc9f0;text-decoration:none;margin-right:16px}
    .card{background:#1a1a2e;border-radius:12px;padding:16px;margin-bottom:8px}
    .hint{color:#8892b0;font-size:.82rem;margin-bottom:12px;line-height:1.5}
    .add-form{display:flex;gap:8px;margin-bottom:16px}
    .add-form input{flex:1;padding:10px 14px;border-radius:8px;border:1px solid #333;background:#0f0e17;color:#fff;font-size:1rem;outline:none}
    .add-form input:focus{border-color:#e94560}
    .btn-add{padding:10px 20px;border-radius:8px;border:none;background:#e94560;color:#fff;font-size:.95rem;cursor:pointer;font-weight:600}
    .btn-approve{padding:5px 12px;border-radius:6px;border:none;background:#06d6a0;color:#000;font-size:.82rem;cursor:pointer;font-weight:700}
    .modal-backdrop{display:none;position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:100;align-items:center;justify-content:center}
    .modal-backdrop.open{display:flex}
    .modal-box{background:#1a1a2e;border-radius:16px;padding:24px;width:min(520px,92vw);max-height:85vh;overflow-y:auto;border:1px solid #333}
    .modal-word{color:#e94560;font-size:1.5rem;font-weight:700;margin-bottom:4px}
    .modal-hint{color:#8892b0;font-size:.82rem;margin-bottom:18px}
    .meaning-row{display:flex;gap:8px;margin-bottom:8px;align-items:center}
    .meaning-row select{padding:8px 10px;border-radius:8px;border:1px solid #333;background:#0f0e17;color:#8892b0;font-size:.85rem;outline:none;flex-shrink:0}
    .meaning-row input{flex:1;padding:8px 12px;border-radius:8px;border:1px solid #333;background:#0f0e17;color:#fff;font-size:.9rem;outline:none}
    .meaning-row input:focus,.meaning-row select:focus{border-color:#e94560}
    .btn-rm{background:transparent;border:1px solid #444;color:#8892b0;padding:5px 9px;border-radius:6px;cursor:pointer;font-size:.8rem;flex-shrink:0}
    .btn-rm:hover{border-color:#e94560;color:#e94560}
    .btn-add-meaning{padding:8px 16px;border-radius:8px;border:1px dashed #444;background:transparent;color:#8892b0;font-size:.85rem;cursor:pointer;width:100%;margin-bottom:16px}
    .btn-add-meaning:hover{border-color:#4cc9f0;color:#4cc9f0}
    .modal-actions{display:flex;gap:8px;margin-top:4px}
    .btn-confirm{flex:1;padding:10px;border-radius:8px;border:none;background:#06d6a0;color:#000;font-size:.95rem;cursor:pointer;font-weight:700}
    .btn-cancel{padding:10px 18px;border-radius:8px;border:1px solid #444;background:transparent;color:#8892b0;font-size:.95rem;cursor:pointer}
    .btn-cancel:hover{border-color:#e94560;color:#e94560}
    .btn-del{background:transparent;border:1px solid #444;color:#8892b0;padding:5px 10px;border-radius:6px;font-size:.82rem;cursor:pointer}
    .btn-del:hover{border-color:#e94560;color:#e94560}
    .word-row{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-radius:8px;margin-bottom:4px;background:#0f0e17}
    .word-text{font-size:1rem;font-weight:600}
    .badge{font-size:.73rem;padding:2px 7px;border-radius:10px;margin-left:6px;border:1px solid}
    .badge-homo{color:#4cc9f0;background:rgba(76,201,240,.1);border-color:rgba(76,201,240,.2)}
    .badge-dispute{color:#f8c020;background:rgba(248,192,32,.1);border-color:rgba(248,192,32,.2)}
    .dispute-date{color:#8892b0;font-size:.75rem;margin-left:8px}
    .row-actions{display:flex;gap:8px;align-items:center}
    .msg{padding:10px 14px;border-radius:8px;margin-bottom:16px;font-size:.9rem}
    .msg.ok{background:rgba(6,214,160,.15);border:1px solid #06d6a0;color:#06d6a0}
    .msg.err{background:rgba(239,35,60,.15);border:1px solid #ef233c;color:#ef233c}
    .empty{color:#8892b0;font-size:.9rem;padding:8px}
    .tab-bar{display:flex;gap:4px;margin-bottom:16px}
    .tab{padding:8px 18px;border-radius:8px;border:1px solid #333;background:transparent;color:#8892b0;cursor:pointer;font-size:.9rem}
    .tab.active{background:#1a1a2e;border-color:#e94560;color:#fff}
    .section{display:none}.section.active{display:block}
    #pending-badge{display:inline-block;background:#e94560;color:#fff;border-radius:10px;font-size:.72rem;padding:1px 7px;margin-left:6px;vertical-align:middle}
  </style>
</head>
<body>
  <h1>Verbum9 Admin</h1>
  <nav><a href="/">← Oyuna dön</a><a href="/sozluk">Sözlük →</a></nav>
  <div id="msg"></div>

  <div class="tab-bar">
    <button class="tab active" onclick="switchTab('homophones')">Sesteş Kelimeler</button>
    <button class="tab" onclick="switchTab('disputes')">İtirazlar <span id="pending-badge" hidden>0</span></button>
    <button class="tab" onclick="switchTab('blacklist')">Kara Liste</button>
  </div>

  <!-- Sesteş Kelimeler -->
  <div id="tab-homophones" class="section active">
    <p class="hint">Sesteş kelimeler iki farklı anlamı olan kelimelerdir (örn. "el" = organ / yabancı). Oyunda bu kelimeler iki kez yazılabilir.</p>
    <div class="card">
      <form class="add-form" id="add-homo-form">
        <input id="new-homo" placeholder="Sesteş kelime ekle (örn: ama)" autocomplete="off">
        <button type="submit" class="btn-add">Ekle</button>
      </form>
      <div id="homo-list">
        ${homophones.length === 0
          ? '<div class="empty">Henüz sesteş kelime yok.</div>'
          : homophones.map(w => `
          <div class="word-row" id="homo-row-${w}">
            <span class="word-text">${w}<span class="badge badge-homo">2 anlam</span></span>
            <button class="btn-del" onclick="delHomo('${w}')">✕ Kaldır</button>
          </div>`).join('')}
      </div>
    </div>
  </div>

  <!-- İtirazlar -->
  <div id="tab-disputes" class="section">
    <p class="hint">Oyuncuların geçersiz gördüğü kelimelere itirazları burada görünür. Onaylarsanız kelime sözlüğe eklenir.</p>
    <div class="card" id="disputes-card">
      <div class="empty" id="disputes-loading">Yükleniyor...</div>
      <div id="disputes-list" hidden></div>
    </div>
  </div>

  <!-- Kara Liste -->
  <div id="tab-blacklist" class="section">
    <p class="hint">Buradaki kelimeler oyunda geçersiz sayılır — oyuncular yazsa bile puan alamaz.</p>
    <div class="card">
      <form class="add-form" id="add-bl-form">
        <input id="new-bl" placeholder="Yasaklı kelime ekle" autocomplete="off">
        <button type="submit" class="btn-add">Ekle</button>
      </form>
      <div id="bl-list">
        ${(readWords().blacklist || []).sort((a,b)=>a.localeCompare(b,'tr')).map(w => `
        <div class="word-row" id="bl-row-${w}">
          <span class="word-text">${w}</span>
          <button class="btn-del" onclick="delBL('${w}')">✕ Kaldır</button>
        </div>`).join('') || '<div class="empty">Kara liste boş.</div>'}
      </div>
    </div>
  </div>

  <!-- Anlam Giriş Popup -->
  <div id="approve-modal" class="modal-backdrop">
    <div class="modal-box">
      <div id="modal-word" class="modal-word"></div>
      <div class="modal-hint">Sözlüğe eklenecek. İsterseniz anlam bilgisi girin.</div>
      <div id="meanings-container"></div>
      <button class="btn-add-meaning" onclick="addMeaningRow()">+ Anlam Ekle</button>
      <div class="modal-actions">
        <button class="btn-confirm" onclick="submitApprove()">✓ Onayla ve Kaydet</button>
        <button class="btn-cancel" onclick="closeApproveModal()">İptal</button>
      </div>
    </div>
  </div>

  <script>
    function showMsg(text, ok) {
      const el = document.getElementById('msg');
      el.className = 'msg ' + (ok ? 'ok' : 'err');
      el.textContent = text;
      clearTimeout(el._t);
      el._t = setTimeout(() => { el.textContent=''; el.className=''; }, 3500);
    }

    function switchTab(name) {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
      document.querySelector('[onclick="switchTab(\\'' + name + '\\')"]').classList.add('active');
      document.getElementById('tab-' + name).classList.add('active');
      if (name === 'disputes') loadDisputes();
    }

    /* ── Sesteş ── */
    document.getElementById('add-homo-form').onsubmit = async (e) => {
      e.preventDefault();
      const word = document.getElementById('new-homo').value.trim().toLocaleLowerCase('tr-TR');
      if (!word) return;
      const res = await fetch('/api/admin/homophones', {
        method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({word})
      });
      const d = await res.json();
      if (d.ok) {
        showMsg('"' + word + '" eklendi.', true);
        document.getElementById('new-homo').value = '';
        const list = document.getElementById('homo-list');
        const row = document.createElement('div');
        row.className = 'word-row'; row.id = 'homo-row-' + word;
        row.innerHTML = '<span class="word-text">'+word+'<span class="badge badge-homo">2 anlam</span></span>'+
          '<button class="btn-del" onclick="delHomo(\\''+word+'\\')">✕ Kaldır</button>';
        list.querySelector('.empty')?.remove();
        list.appendChild(row);
      } else { showMsg(d.error||'Hata.', false); }
    };

    async function delHomo(word) {
      const res = await fetch('/api/admin/homophones/'+encodeURIComponent(word), {method:'DELETE'});
      const d = await res.json();
      if (d.ok) { document.getElementById('homo-row-'+word)?.remove(); showMsg('"'+word+'" kaldırıldı.', true); }
      else showMsg(d.error||'Hata.', false);
    }

    /* ── İtirazlar ── */
    async function loadDisputes() {
      const res = await fetch('/api/disputes');
      const all = await res.json();
      const pending = all.filter(d => d.status === 'pending');
      const badge = document.getElementById('pending-badge');
      badge.hidden = pending.length === 0;
      badge.textContent = pending.length;

      document.getElementById('disputes-loading').hidden = true;
      const list = document.getElementById('disputes-list');
      list.hidden = false;

      if (pending.length === 0) {
        list.innerHTML = '<div class="empty">Bekleyen itiraz yok.</div>';
        return;
      }

      list.innerHTML = pending.map(d => {
        const date = new Date(d.createdAt).toLocaleDateString('tr-TR');
        return '<div class="word-row" id="dispute-row-'+d.id+'">'+
          '<span class="word-text">'+d.word+'<span class="badge badge-dispute">İtiraz</span>'+
          '<span class="dispute-date">'+date+'</span></span>'+
          '<div class="row-actions">'+
          '<button class="btn-approve" onclick="openApproveModal('+d.id+',\\''+d.word+'\\')">✓ Onayla</button>'+
          '<button class="btn-del" onclick="resolveDispute('+d.id+',\\'reject\\')">✕ Reddet</button>'+
          '</div></div>';
      }).join('');
    }

    let _approveId = null;

    const WORD_TYPES = ['','isim','fiil','sıfat','zarf','zamir','edat','bağlaç','ünlem'];

    function openApproveModal(id, word) {
      _approveId = id;
      document.getElementById('modal-word').textContent = word;
      document.getElementById('meanings-container').innerHTML = '';
      addMeaningRow();
      document.getElementById('approve-modal').classList.add('open');
    }

    function closeApproveModal() {
      document.getElementById('approve-modal').classList.remove('open');
      _approveId = null;
    }

    function addMeaningRow() {
      const c = document.getElementById('meanings-container');
      const row = document.createElement('div');
      row.className = 'meaning-row';
      const sel = document.createElement('select');
      WORD_TYPES.forEach(t => {
        const o = document.createElement('option');
        o.value = t; o.textContent = t || '— tür —';
        sel.appendChild(o);
      });
      const inp = document.createElement('input');
      inp.placeholder = 'Anlam metni';
      const rm = document.createElement('button');
      rm.className = 'btn-rm'; rm.textContent = '✕';
      rm.onclick = () => row.remove();
      row.appendChild(sel); row.appendChild(inp); row.appendChild(rm);
      c.appendChild(row);
      inp.focus();
    }

    async function submitApprove() {
      if (!_approveId) return;
      const rows = document.querySelectorAll('#meanings-container .meaning-row');
      const meanings = [];
      rows.forEach(row => {
        const type = row.querySelector('select').value.trim();
        const text = row.querySelector('input').value.trim();
        if (text) meanings.push(type ? '('+type+') '+text : text);
      });
      await resolveDispute(_approveId, 'approve', meanings);
      closeApproveModal();
    }

    async function resolveDispute(id, action, meanings) {
      const res = await fetch('/api/disputes/'+id, {
        method:'PATCH', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ action, meanings: meanings || [] })
      });
      const d = await res.json();
      if (d.ok) {
        document.getElementById('dispute-row-'+id)?.remove();
        showMsg(action==='approve' ? '"'+d.word+'" sözlüğe eklendi.' : 'İtiraz reddedildi.', action==='approve');
        const remaining = document.querySelectorAll('[id^="dispute-row-"]').length;
        if (remaining===0) document.getElementById('disputes-list').innerHTML='<div class="empty">Bekleyen itiraz yok.</div>';
        document.getElementById('pending-badge').hidden = remaining===0;
        document.getElementById('pending-badge').textContent = remaining;
      } else { showMsg(d.error||'Hata.', false); }
    }

    // Sayfa ilk açıldığında itiraz sayısını güncelle
    fetch('/api/disputes').then(r=>r.json()).then(all=>{
      const n = all.filter(d=>d.status==='pending').length;
      const b = document.getElementById('pending-badge');
      b.hidden = n===0; b.textContent = n;
    });

    /* ── Kara Liste ── */
    document.getElementById('add-bl-form').onsubmit = async (e) => {
      e.preventDefault();
      const word = document.getElementById('new-bl').value.trim().toLocaleLowerCase('tr-TR');
      if (!word) return;
      const res = await fetch('/api/admin/blacklist', {
        method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({word})
      });
      const d = await res.json();
      if (d.ok) {
        showMsg('"' + word + '" kara listeye eklendi.', true);
        document.getElementById('new-bl').value = '';
        const list = document.getElementById('bl-list');
        list.querySelector('.empty')?.remove();
        const row = document.createElement('div');
        row.className = 'word-row'; row.id = 'bl-row-' + word;
        row.innerHTML = '<span class="word-text">'+word+'</span>'+
          '<button class="btn-del" onclick="delBL(\\''+word+'\\')">✕ Kaldır</button>';
        list.appendChild(row);
      } else { showMsg(d.error||'Hata.', false); }
    };

    async function delBL(word) {
      const res = await fetch('/api/admin/blacklist/'+encodeURIComponent(word), {method:'DELETE'});
      const d = await res.json();
      if (d.ok) { document.getElementById('bl-row-'+word)?.remove(); showMsg('"'+word+'" kaldırıldı.', true); }
      else showMsg(d.error||'Hata.', false);
    }
  </script>
</body></html>`);
});

// ─── Admin API: sesteş ekle / sil ────────────────────────────

app.post('/api/admin/homophones', requireAdmin, (req, res) => {
  const { word } = req.body;
  if (!word || typeof word !== 'string') return res.json({ ok: false, error: 'Geçersiz kelime.' });
  const normalized = word.trim().toLocaleLowerCase('tr-TR');
  if (!normalized) return res.json({ ok: false, error: 'Boş kelime.' });
  const data = readWords();
  data.homophones = data.homophones || [];
  if (data.homophones.includes(normalized)) return res.json({ ok: false, error: 'Zaten listede.' });
  data.homophones.push(normalized);
  writeWords(data);
  res.json({ ok: true });
});

app.delete('/api/admin/homophones/:word', requireAdmin, (req, res) => {
  const word = decodeURIComponent(req.params.word).toLocaleLowerCase('tr-TR');
  const data = readWords();
  data.homophones = (data.homophones || []).filter(w => w !== word);
  writeWords(data);
  res.json({ ok: true });
});

// ─── Admin API: kara liste ───────────────────────────────────

app.post('/api/admin/blacklist', requireAdmin, (req, res) => {
  const { word } = req.body;
  if (!word || typeof word !== 'string') return res.json({ ok: false, error: 'Geçersiz kelime.' });
  const normalized = word.trim().toLocaleLowerCase('tr-TR');
  if (!normalized) return res.json({ ok: false, error: 'Boş kelime.' });
  const data = readWords();
  data.blacklist = data.blacklist || [];
  if (data.blacklist.includes(normalized)) return res.json({ ok: false, error: 'Zaten listede.' });
  data.blacklist.push(normalized);
  writeWords(data);
  _blacklistSet.add(normalized);
  res.json({ ok: true });
});

app.delete('/api/admin/blacklist/:word', requireAdmin, (req, res) => {
  const word = decodeURIComponent(req.params.word).toLocaleLowerCase('tr-TR');
  const data = readWords();
  data.blacklist = (data.blacklist || []).filter(w => w !== word);
  writeWords(data);
  _blacklistSet.delete(word);
  res.json({ ok: true });
});

// ─── Anlam API ────────────────────────────────────────────────

app.get('/api/meaning/:word', async (req, res) => {
  const lang = req.query.lang || 'tr';
  const cfg = _langConfig[lang] || _langConfig['tr'];
  const locale = cfg.locale;
  const rawWord = req.params.word.toLocaleLowerCase(locale);
  // TR kelimeler Supabase'de düz key ile, diğer diller "lang:word" prefix ile saklanır
  const dbKey = lang === 'tr' ? rawWord : `${lang}:${rawWord}`;
  const cacheKey = dbKey;

  if (_meaningCache.has(cacheKey)) return res.json(_meaningCache.get(cacheKey));

  // Önce oyunun kendi sözlük DB'sini kontrol et
  const { data: stored } = await supabase
    .from('word_meanings')
    .select('meanings')
    .eq('word', dbKey)
    .maybeSingle();
  if (stored) {
    const result = { word: rawWord, meanings: stored.meanings };
    _meaningCache.set(cacheKey, result);
    return res.json(result);
  }

  // Türkçe için dış API çağrısı yapılmıyor — sadece oyun DB'si
  if (lang === 'tr') {
    _meaningCache.set(cacheKey, null);
    return res.json(null);
  }

  // Diğer diller: dictionaryapi.dev'den çek ve Supabase'e kaydet
  try {
    const raw = await fetchURL(`https://api.dictionaryapi.dev/api/v2/entries/${lang}/${encodeURIComponent(rawWord)}`);
    const entries = JSON.parse(raw);
    const meanings = [];
    if (Array.isArray(entries)) {
      for (const entry of entries) {
        for (const m of (entry.meanings || [])) {
          const pos = m.partOfSpeech;
          for (const def of (m.definitions || []).slice(0, 2)) {
            meanings.push(`(${pos}) ${def.definition}`);
            if (meanings.length >= 5) break;
          }
          if (meanings.length >= 5) break;
        }
        if (meanings.length >= 5) break;
      }
    }
    if (meanings.length > 0) {
      const result = { word: rawWord, meanings };
      _meaningCache.set(cacheKey, result);
      // Arka planda Supabase'e kaydet (bir sonraki sorguda DB'den gelsin)
      supabase.from('word_meanings').upsert({ word: dbKey, meanings }).catch(() => {});
      return res.json(result);
    }
    _meaningCache.set(cacheKey, null);
    return res.json(null);
  } catch {
    return res.json(null);
  }
});

// ─── İtiraz API: listele ──────────────────────────────────────

app.get('/api/disputes', async (req, res) => {
  const { data } = await supabase.from('disputes').select('*').order('created_at', { ascending: false });
  res.json((data || []).map(d => ({
    id: d.id, word: d.word, status: d.status,
    createdAt: d.created_at, resolvedAt: d.resolved_at,
  })));
});

// ─── İtiraz API: yeni itiraz ──────────────────────────────────

app.post('/api/disputes', async (req, res) => {
  const { word } = req.body;
  if (!word || typeof word !== 'string') return res.json({ ok: false, error: 'Geçersiz kelime.' });
  const normalized = word.trim().toLocaleLowerCase('tr-TR');
  if (!normalized) return res.json({ ok: false, error: 'Boş kelime.' });

  const { data: existing } = await supabase
    .from('disputes').select('id,status').eq('word', normalized).in('status', ['pending', 'rejected']).maybeSingle();
  if (existing?.status === 'pending')  return res.json({ ok: false, error: 'Bu kelime zaten itirazda.' });
  if (existing?.status === 'rejected') return res.json({ ok: false, error: 'Bu kelime daha önce incelendi ve reddedildi.' });

  // Yanıtı hemen gönder, oyuncu beklemez
  const id = Date.now();
  const { error } = await supabase.from('disputes').insert({ id, word: normalized, status: 'pending' });
  if (error) return res.json({ ok: false, error: 'Kayıt hatası.' });
  res.json({ ok: true, id });

  // Otomatik onay kaldırıldı — admin panelinden manuel onay gerekir
});

// ─── İtiraz API: onayla / reddet ─────────────────────────────

app.patch('/api/disputes/:id', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id);
  const { action, meanings } = req.body;
  if (!['approve', 'reject'].includes(action)) return res.json({ ok: false, error: 'Geçersiz işlem.' });

  const { data: dispute } = await supabase.from('disputes').select('*').eq('id', id).maybeSingle();
  if (!dispute) return res.json({ ok: false, error: 'İtiraz bulunamadı.' });

  const status = action === 'approve' ? 'approved' : 'rejected';
  await supabase.from('disputes').update({ status, resolved_at: new Date().toISOString() }).eq('id', id);

  if (action === 'approve') {
    const data = readWords();
    if (!data.words.includes(dispute.word)) {
      data.words.push(dispute.word);
      writeWords(data);
    }
    _wordSet.add(dispute.word);
    if (Array.isArray(meanings) && meanings.length > 0) {
      await supabase.from('word_meanings').upsert({ word: dispute.word, meanings });
    }
  }

  res.json({ ok: true, word: dispute.word });
});

// ─── Auth API ────────────────────────────────────────────────

app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password } = req.body || {};
    if (!username || !password) return res.json({ ok: false, error: 'Kullanıcı adı ve şifre gerekli.' });
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.json({ ok: false, error: 'Geçerli bir e-posta adresi gir.' });
    if (username.trim().length < 3) return res.json({ ok: false, error: 'Kullanıcı adı en az 3 karakter olmalı.' });
    if (password.length < 6) return res.json({ ok: false, error: 'Şifre en az 6 karakter olmalı.' });

    const existing = await userService.getUserByUsername(username);
    if (existing) return res.json({ ok: false, error: 'Bu kullanıcı adı alınmış.' });

    const existingEmail = await userService.getUserByEmail(email.trim().toLowerCase());
    if (existingEmail) return res.json({ ok: false, error: 'Bu e-posta adresi zaten kayıtlı.' });

    const verificationToken = crypto.randomBytes(32).toString('hex');
    const user = {
      id: Date.now(),
      username: username.trim(),
      email: email.trim().toLowerCase(),
      emailVerified: false,
      verificationToken,
      passwordHash: await bcrypt.hash(password, 10),
      token: null,
      totalScore: 0, level: 1, klBalance: 0, gamesPlayed: 0, gamesWon: 0,
      createdAt: new Date().toISOString(),
    };
    await userService.createUser(user);

    try {
      await sendVerificationEmail(user.email, verificationToken);
    } catch (mailErr) {
      console.error('[register] mail gönderilemedi:', mailErr);
    }

    res.json({ ok: true, pending: true });
  } catch (err) {
    console.error('[register]', err);
    res.json({ ok: false, error: 'Sunucu hatası.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.json({ ok: false, error: 'Kullanıcı adı ve şifre gerekli.' });

    const user = await userService.getUserByUsername(username);
    if (!user) return res.json({ ok: false, error: 'Kullanıcı bulunamadı.' });
    if (!await bcrypt.compare(password, user.passwordHash)) return res.json({ ok: false, error: 'Şifre yanlış.' });
    if (!user.emailVerified) return res.json({ ok: false, error: 'E-postanı doğrulamalısın.', code: 'email_not_verified', username: user.username });

    const token = crypto.randomBytes(32).toString('hex');
    await userService.updateUserToken(user.id, token);
    res.json({ ok: true, token, user: userService.safeUser({ ...user, token }) });
  } catch (err) {
    console.error('[login]', err);
    res.json({ ok: false, error: 'Sunucu hatası.' });
  }
});

app.get('/api/auth/me', async (req, res) => {
  const token = extractToken(req);
  const user = await userService.getUserByToken(token);
  if (!user) return res.status(401).json({ ok: false, error: 'Giriş gerekli.' });
  res.json({ ok: true, user: userService.safeUser(user) });
});

app.get('/verify-email', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.send(verifyPage('Geçersiz doğrulama linki.', false));
  const user = await userService.getUserByVerificationToken(token);
  if (!user) return res.send(verifyPage('Bu link geçersiz veya daha önce kullanılmış.', false));
  await userService.verifyEmail(token);
  res.send(verifyPage('E-posta doğrulandı! Artık giriş yapabilirsin.', true));
});

app.post('/api/auth/resend-verification', async (req, res) => {
  try {
    const { username } = req.body || {};
    const user = await userService.getUserByUsername(username);
    if (!user || user.emailVerified) return res.json({ ok: false });
    const newToken = crypto.randomBytes(32).toString('hex');
    await userService.setVerificationToken(user.id, newToken);
    await sendVerificationEmail(user.email, newToken);
    res.json({ ok: true });
  } catch (err) {
    console.error('[resend-verification]', err);
    res.json({ ok: false, error: 'Mail gönderilemedi.' });
  }
});

app.post('/api/auth/forgot-password', (req, res) => {
  const { email } = req.body || {};
  // Güvenlik: her durumda aynı yanıtı ver, e-posta varlığını açıklama
  res.json({ ok: true });

  if (!email) return;
  const emailNorm = email.trim().toLowerCase();
  // E-posta arama ve gönderimi arka planda yap (yanıt zaten gönderildi)
  userService.getUserByEmail(emailNorm).then(async user => {
    if (!user || !user.emailVerified) return;
    const token = crypto.randomBytes(32).toString('hex');
    await userService.setVerificationToken(user.id, token);
    await sendPasswordResetEmail(emailNorm, token, user.username);
  }).catch(err => console.error('[forgot-password]', err));
});

app.get('/reset-password', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.redirect('/');
  const user = await userService.getUserByVerificationToken(token);
  if (!user) return res.send(verifyPage('Bu link geçersiz veya zaten kullanılmış.', false));
  res.send(resetPasswordPage(token));
});

app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body || {};
    if (!token || !newPassword) return res.json({ ok: false, error: 'Gerekli alanlar eksik.' });
    if (newPassword.length < 6) return res.json({ ok: false, error: 'Şifre en az 6 karakter olmalı.' });
    const user = await userService.getUserByVerificationToken(token);
    if (!user) return res.json({ ok: false, error: 'Geçersiz veya süresi dolmuş link.' });
    const newHash = await bcrypt.hash(newPassword, 10);
    await userService.resetPassword(token, newHash);
    res.json({ ok: true });
  } catch (err) {
    console.error('[reset-password]', err);
    res.json({ ok: false, error: 'Sunucu hatası.' });
  }
});

// ─── Arkadaşlar API ──────────────────────────────────────────

app.get('/api/friends/search', requireAuth, async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  const { data: users } = await supabase
    .from('users').select('id, username').ilike('username', `%${q}%`).neq('id', req.user.id).limit(8);
  if (!users || users.length === 0) return res.json([]);
  const results = await Promise.all(users.map(async u => {
    const { data: fs } = await supabase.from('friendships').select('id, status, requester_id')
      .or(`and(requester_id.eq.${req.user.id},addressee_id.eq.${u.id}),and(requester_id.eq.${u.id},addressee_id.eq.${req.user.id})`)
      .maybeSingle();
    let friendStatus = 'none';
    if (fs) {
      if (fs.status === 'accepted') friendStatus = 'friends';
      else if (fs.status === 'pending') friendStatus = fs.requester_id === req.user.id ? 'sent' : 'received';
    }
    return { id: u.id, username: u.username, friendStatus, friendshipId: fs?.id || null };
  }));
  res.json(results);
});

function isOnline(lastSeen) {
  if (!lastSeen) return false;
  return (Date.now() - new Date(lastSeen).getTime()) < 5 * 60 * 1000;
}

app.get('/api/friends', requireAuth, async (req, res) => {
  const uid = req.user.id;
  const { data } = await supabase.from('friendships').select('id, requester_id, addressee_id')
    .eq('status', 'accepted').or(`requester_id.eq.${uid},addressee_id.eq.${uid}`);
  if (!data || data.length === 0) return res.json([]);
  const friendIds = data.map(f => f.requester_id === uid ? f.addressee_id : f.requester_id);
  const { data: users } = await supabase.from('users').select('id, username, last_seen').in('id', friendIds);
  const userMap = {}; (users || []).forEach(u => { userMap[String(u.id)] = { username: u.username, lastSeen: u.last_seen }; });
  res.json(data.map(f => {
    const fid = String(f.requester_id) === String(uid) ? f.addressee_id : f.requester_id;
    const u = userMap[String(fid)] || {};
    return { friendshipId: f.id, userId: fid, username: u.username || '?', online: isOnline(u.lastSeen), lastSeen: u.lastSeen || null };
  }));
});

app.get('/api/friends/requests', requireAuth, async (req, res) => {
  const { data } = await supabase.from('friendships').select('id, requester_id, created_at')
    .eq('addressee_id', req.user.id).eq('status', 'pending');
  if (!data || data.length === 0) return res.json([]);
  const ids = data.map(f => f.requester_id);
  const { data: users } = await supabase.from('users').select('id, username').in('id', ids);
  const userMap = {}; (users || []).forEach(u => userMap[String(u.id)] = u.username);
  res.json(data.map(f => ({ id: f.id, userId: f.requester_id, username: userMap[f.requester_id] || '?', createdAt: f.created_at })));
});

app.post('/api/friends/request', requireAuth, async (req, res) => {
  const { username } = req.body;
  if (!username) return res.json({ ok: false, error: 'Kullanıcı adı gerekli.' });
  const { data: found } = await supabase.from('users').select('id, username').ilike('username', username).limit(1);
  const target = found?.[0];
  if (!target) return res.json({ ok: false, error: 'Kullanıcı bulunamadı.' });
  if (target.id === req.user.id) return res.json({ ok: false, error: 'Kendinize istek gönderemezsiniz.' });
  const { data: existing } = await supabase.from('friendships').select('id, status')
    .or(`and(requester_id.eq.${req.user.id},addressee_id.eq.${target.id}),and(requester_id.eq.${target.id},addressee_id.eq.${req.user.id})`)
    .maybeSingle();
  if (existing?.status === 'accepted') return res.json({ ok: false, error: 'Zaten arkadaşsınız.' });
  if (existing?.status === 'pending') return res.json({ ok: false, error: 'İstek zaten bekliyor.' });
  const { error } = await supabase.from('friendships').insert({ requester_id: req.user.id, addressee_id: target.id });
  if (error) return res.json({ ok: false, error: 'Hata oluştu.' });
  const t = onlineUsers.get(String(target.id));
  if (t) t.socket.emit('friend_request_received', { fromUsername: req.user.username });
  res.json({ ok: true, username: target.username });
});

app.patch('/api/friends/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  const { accept } = req.body;
  const { data: fs } = await supabase.from('friendships').select('*')
    .eq('id', id).eq('addressee_id', req.user.id).maybeSingle();
  if (!fs) return res.json({ ok: false, error: 'İstek bulunamadı.' });
  await supabase.from('friendships').update({ status: accept ? 'accepted' : 'rejected' }).eq('id', id);
  if (accept) {
    const t = onlineUsers.get(String(fs.requester_id));
    if (t) t.socket.emit('friend_request_accepted', { byUsername: req.user.username });
  }
  res.json({ ok: true });
});

app.delete('/api/friends/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  await supabase.from('friendships').delete().eq('id', id)
    .or(`requester_id.eq.${req.user.id},addressee_id.eq.${req.user.id}`);
  res.json({ ok: true });
});

app.post('/api/friends/invite-email', requireAuth, async (req, res) => {
  const { email, fromName, message } = req.body;
  if (!email || !fromName) return res.json({ ok: false, error: 'E-posta ve isim gerekli.' });
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) return res.json({ ok: false, error: 'Geçersiz e-posta adresi.' });
  try {
    await sendInviteEmail(email.trim(), fromName.trim(), (message || '').trim());
    res.json({ ok: true });
  } catch (e) {
    console.error('Davet maili gönderilemedi:', e.message);
    res.json({ ok: false, error: 'Mail gönderilemedi, lütfen tekrar dene.' });
  }
});

// ─── Grup Odası REST ─────────────────────────────────────────

app.get('/api/group/open', requireAuth, (req, res) => {
  const open = [];
  for (const [code, room] of groupRooms) {
    if (room.joinMode === 'open' && room.status === 'lobby') {
      open.push({ code, hostName: room.host.displayName, playerCount: room.players.length, lang: room.lang || 'tr' });
    }
  }
  res.json(open);
});

// ─── Günlük Mod API ──────────────────────────────────────────

app.get('/api/daily', requireAuth, async (req, res) => {
  const today = getDailyDate();
  const puzzle = await getTodayPuzzle();

  const { data: todayScore } = await supabase.from('daily_scores')
    .select('*').eq('user_id', req.user.id).eq('date', today).maybeSingle();

  // Dünkü sonuç
  const tz = process.env.DAILY_RESET_TIMEZONE || 'UTC';
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const yesterday = d.toLocaleDateString('en-CA', { timeZone: tz });
  const { data: ystScore } = await supabase.from('daily_scores')
    .select('score, final_rank, kl_earned').eq('user_id', req.user.id).eq('date', yesterday).maybeSingle();

  if (todayScore) {
    const { count } = await supabase.from('daily_scores')
      .select('*', { count: 'exact', head: true })
      .eq('date', today).gt('score', todayScore.score);
    const currentRank = (count || 0) + 1;
    return res.json({ played: true, score: todayScore.score, currentRank, yesterday: ystScore || null });
  }

  res.json({ played: false, matrix: puzzle.matrix, yesterday: ystScore || null });
});

app.post('/api/daily/submit', requireAuth, async (req, res) => {
  const today = getDailyDate();
  const { score, wordsFound } = req.body;

  const { data: existing } = await supabase.from('daily_scores')
    .select('id').eq('user_id', req.user.id).eq('date', today).maybeSingle();
  if (existing) return res.json({ ok: false, error: 'Zaten oynadın.' });

  await supabase.from('daily_scores').insert({
    user_id: req.user.id, date: today,
    score: score || 0, words_found: wordsFound || 0,
  });

  const { count } = await supabase.from('daily_scores')
    .select('*', { count: 'exact', head: true })
    .eq('date', today).gt('score', score || 0);
  const currentRank = (count || 0) + 1;

  res.json({ ok: true, currentRank });
});

// Cron tarafından çağrılır — gün sonu KL dağıtımı
app.post('/api/daily/finalize', async (req, res) => {
  if (req.headers['x-cron-key'] !== process.env.CRON_SECRET) return res.status(401).json({ error: 'Unauthorized' });

  const tz = process.env.DAILY_RESET_TIMEZONE || 'UTC';
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const date = d.toLocaleDateString('en-CA', { timeZone: tz });

  const { data: scores } = await supabase.from('daily_scores')
    .select('id, user_id, score').eq('date', date).is('final_rank', null).order('score', { ascending: false });
  if (!scores || scores.length === 0) return res.json({ ok: true, processed: 0 });

  let rank = 1;
  let i = 0;
  let awarded = 0;

  while (i < scores.length) {
    const groupScore = scores[i].score;
    const group = [];
    while (i < scores.length && scores[i].score === groupScore) { group.push(scores[i]); i++; }

    let kl = 0;
    if (rank === 1)      kl = 300;
    else if (rank === 2) kl = 200;
    else if (rank === 3) kl = 100;
    else if (awarded < 100) kl = 20;

    for (const s of group) {
      await supabase.from('daily_scores').update({ final_rank: rank, kl_earned: kl }).eq('id', s.id);
      if (kl > 0) {
        const { data: u } = await supabase.from('users').select('kl_balance').eq('id', s.user_id).single();
        await supabase.from('users').update({ kl_balance: (u?.kl_balance || 0) + kl }).eq('id', s.user_id);
      }
    }

    awarded += group.length;
    rank += group.length;
    if (awarded >= 100 && rank > 3) break;
  }

  res.json({ ok: true, processed: scores.length });
});

// ─── Socket.IO — Çok Oyunculu Motor ─────────────────────────

// Sözlük sunucu tarafı doğrulama için belleğe alınır
const _dictData = readWords();
const _wordSet      = new Set(_dictData.words.map(w => w.toLocaleLowerCase('tr-TR')));
const _homophoneSet = new Set((_dictData.homophones || []).map(w => w.toLocaleLowerCase('tr-TR')));
const _blacklistSet = new Set((_dictData.blacklist  || []).map(w => w.toLocaleLowerCase('tr-TR')));

// Çok dilli sözlük yükleme
const _langConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/lang_config.json'), 'utf8'));
const _wordSets = {};
for (const [lang, cfg] of Object.entries(_langConfig)) {
  if (!cfg.ready) continue;
  try {
    const dictPath = path.join(__dirname, '../data', cfg.wordsFile);
    const dictData = JSON.parse(fs.readFileSync(dictPath, 'utf8'));
    const locale = cfg.locale;
    _wordSets[lang] = {
      wordSet:      new Set(dictData.words.map(w => w.toLocaleLowerCase(locale))),
      homophoneSet: new Set((dictData.homophones || []).map(w => w.toLocaleLowerCase(locale))),
      blacklistSet: new Set((dictData.blacklist  || []).map(w => w.toLocaleLowerCase(locale))),
      vowels:    new Set(cfg.vowels),
      vowelsArr: cfg.vowels,
      locale,
      minLength: cfg.minLength,
    };
  } catch (e) {
    console.warn(`[lang] ${lang} sözlük yüklenemedi:`, e.message);
  }
}
console.log('[lang] Yüklenen diller:', Object.keys(_wordSets).join(', '));

// TDK anlam önbelleği (bellek içi)
const _meaningCache = new Map();

const queues = {};                  // lang → { socket, name, token, lang }[]
function getQueue(lang) {
  if (!queues[lang]) queues[lang] = [];
  return queues[lang];
}
const rooms = new Map();            // roomId → room
const socketRoom = new Map();       // socketId → roomId
const pendingReconnects = new Map(); // token → { roomId, playerIndex }
const finishedGames = new Map();    // token → { result, expiresAt } — ekran kapalıyken biten oyunlar için
const onlineUsers = new Map();      // userId → { socket, name }
const pendingInvites = new Map();   // inviteId → { fromSocket, fromName, fromToken, toUserId }
const groupRooms = new Map();       // code → room
const socketGroupRoom = new Map();  // socketId → code
const userGroupRoom = new Map();    // userId → code (reconnect için kalıcı)

// 1 dakikada bir süresi dolmuş sonuçları temizle
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of finishedGames) {
    if (now > v.expiresAt) finishedGames.delete(k);
  }
}, 60000);

function createRoom(p1, p2, lang = 'tr') {
  const roomId = crypto.randomBytes(4).toString('hex');
  const room = {
    id: roomId,
    lang,
    players: [p1.socket, p2.socket],
    names: [p1.name, p2.name],
    tokens: [p1.token, p2.token],
    phase: 'fill',
    matrix: Array(9).fill(''),
    turnIndex: 0,
    cellsFilled: 0,
    words: [[], []],
    hintsUsed: [0, 0],
    timerInterval: null,
    countdownInterval: null,
    vowelFixDelay: null,
    duration: 120,
    timeLeft: 120,
    extensionRequests: [0, 0],
    pendingExtension: null,
  };
  rooms.set(roomId, room);
  socketRoom.set(p1.socket.id, roomId);
  socketRoom.set(p2.socket.id, roomId);
  p1.socket.join(roomId);
  p2.socket.join(roomId);
  p1.socket.emit('matched', { opponentName: p2.name, playerIndex: 0, turnIndex: 0, lang });
  p2.socket.emit('matched', { opponentName: p1.name, playerIndex: 1, turnIndex: 0, lang });
}

const VOWELS_SET = new Set(['A', 'E', 'I', 'İ', 'O', 'Ö', 'U', 'Ü']);
const VOWELS_ARR = ['A', 'E', 'İ', 'I', 'O', 'U', 'Ö', 'Ü'];

function roomCountdown(room) {
  const langSet = _wordSets[room.lang] || _wordSets['tr'];
  // Hiç sesli harf yoksa 2 rastgele sessiz harfi sesli harfle değiştir
  const hasVowel = room.matrix.some(l => langSet.vowels.has(l));
  console.log(`[roomCountdown] matris: [${room.matrix.join(',')}] | sesliHarf: ${hasVowel}`);
  let delay = 0;
  if (!hasVowel) {
    const positions = [...Array(9).keys()]
      .sort(() => Math.random() - 0.5)
      .slice(0, 2);
    const changed = positions.map(pos => {
      const vowel = langSet.vowelsArr[Math.floor(Math.random() * langSet.vowelsArr.length)];
      room.matrix[pos] = vowel;
      return { pos, vowel };
    });
    io.to(room.id).emit('matrix_fixed', { matrix: [...room.matrix], changed });
    delay = 3000;
  }

  room.vowelFixDelay = setTimeout(() => {
    room.vowelFixDelay = null;
    if (!rooms.has(room.id)) return; // oda çıkış sırasında silindi
    let n = 5;
    io.to(room.id).emit('countdown_tick', { n });
    room.countdownInterval = setInterval(() => {
      n--;
      if (n <= 0) {
        clearInterval(room.countdownInterval);
        room.countdownInterval = null;
        if (rooms.has(room.id)) roomStart(room);
      } else {
        io.to(room.id).emit('countdown_tick', { n });
      }
    }, 1000);
  }, delay);
}

function roomStart(room) {
  room.phase = 'playing';
  room.timeLeft = room.duration;
  io.to(room.id).emit('game_start', { matrix: [...room.matrix] });
  room.timerInterval = setInterval(() => {
    room.timeLeft--;
    io.to(room.id).emit('timer_tick', { timeLeft: room.timeLeft });
    if (room.timeLeft <= 0) roomEnd(room);
  }, 1000);
}

async function roomEnd(room) {
  clearInterval(room.timerInterval);
  room.phase = 'done';
  const [w0, w1] = room.words;
  const s1 = new Set(w1.map(w => w.word.toLocaleLowerCase('tr-TR')));
  const s0 = new Set(w0.map(w => w.word.toLocaleLowerCase('tr-TR')));
  let score0 = 0, score1 = 0;
  w0.forEach(w => { if (!s1.has(w.word.toLocaleLowerCase('tr-TR'))) score0 += w.word.length; });
  w1.forEach(w => { if (!s0.has(w.word.toLocaleLowerCase('tr-TR'))) score1 += w.word.length; });

  const winner = score0 > score1 ? 0 : score1 > score0 ? 1 : -1;
  try {
    await Promise.all([
      userService.recordGameResult(room.tokens[0], { scoreDelta: score0, won: winner === 0 }),
      userService.recordGameResult(room.tokens[1], { scoreDelta: score1, won: winner === 1 }),
    ]);
  } catch (err) {
    console.error('[roomEnd] istatistik kaydedilemedi:', err);
  }

  const gameResult = {
    players: [
      { name: room.names[0], score: score0, words: w0 },
      { name: room.names[1], score: score1, words: w1 },
    ],
  };
  io.to(room.id).emit('game_over', gameResult);

  // Sadece bağlantısı kopmuş (pendingReconnects'te olan) oyuncular için sakla
  const expiresAt = Date.now() + 3 * 60 * 1000;
  if (room.tokens[0] && pendingReconnects.has(room.tokens[0]))
    finishedGames.set(room.tokens[0], { result: gameResult, expiresAt });
  if (room.tokens[1] && pendingReconnects.has(room.tokens[1]))
    finishedGames.set(room.tokens[1], { result: gameResult, expiresAt });

  if (room.tokens[0]) pendingReconnects.delete(room.tokens[0]);
  if (room.tokens[1]) pendingReconnects.delete(room.tokens[1]);
  socketRoom.delete(room.players[0].id);
  socketRoom.delete(room.players[1].id);
  rooms.delete(room.id);
}

function validateWord(room, pIdx, rawWord) {
  const langSet = _wordSets[room.lang] || _wordSets['tr'];
  const locale = langSet.locale;
  const wordU = (rawWord || '').toLocaleUpperCase(locale);
  const wordL = wordU.toLocaleLowerCase(locale);
  if (wordU.length < langSet.minLength) return { status: 'short', word: wordU, points: 0 };
  const mc = {};
  room.matrix.forEach(l => { mc[l] = (mc[l] || 0) + 1; });
  const need = {};
  for (const ch of wordU) need[ch] = (need[ch] || 0) + 1;
  for (const ch in need) {
    if ((mc[ch] || 0) < need[ch]) return { status: 'invalid', word: wordU, points: 0 };
  }
  if (!langSet.wordSet.has(wordL) || langSet.blacklistSet.has(wordL)) return { status: 'invalid', word: wordU, points: 0 };
  const pw = room.words[pIdx];
  const cnt = pw.filter(w => w.word === wordU).length;
  const max = langSet.homophoneSet.has(wordL) ? 2 : 1;
  if (cnt >= max) return { status: 'duplicate', word: wordU, points: 0 };
  return { status: 'valid', word: wordU, points: wordU.length };
}

function genGroupCode() {
  let code;
  do { code = String(Math.floor(100000 + Math.random() * 900000)); }
  while (groupRooms.has(code));
  return code;
}

async function grpRoomEnd(room) {
  clearInterval(room.timerInterval);
  room.status = 'ended';
  const rankings = [...room.players]
    .sort((a, b) => b.score - a.score)
    .map((p, i) => ({ rank: i + 1, displayName: p.displayName, score: p.score }));
  const seen = new Set();
  const allWords = [];
  for (const p of room.players) {
    for (const w of p.words) {
      if (!seen.has(w)) { seen.add(w); allWords.push({ word: w, length: w.length }); }
    }
  }
  allWords.sort((a, b) => b.length - a.length || a.word.localeCompare(b.word, 'tr'));
  io.to(`grp_${room.code}`).emit('grp_ended', { rankings, words: allWords.slice(0, 100) });
  setTimeout(() => {
    for (const p of room.players) {
      if (p.socket) socketGroupRoom.delete(p.socket.id);
      userGroupRoom.delete(String(p.userId));
    }
    for (const p of room.pendingPlayers) {
      if (p.socket) socketGroupRoom.delete(p.socket.id);
      userGroupRoom.delete(String(p.userId));
    }
    groupRooms.delete(room.code);
  }, 5 * 60 * 1000);
}

function leaveGroupRoom(socket, room) {
  const isHost = room.host.socket?.id === socket.id;
  const playerInRoom = room.players.find(p => p.socket?.id === socket.id);

  socketGroupRoom.delete(socket.id);
  socket.leave(`grp_${room.code}`);

  if (room.status === 'playing') {
    // Oyun devam ederken: socket'i null yap, oyuncuyu koru (rejoin için)
    if (playerInRoom) {
      playerInRoom.socket = null;
      if (isHost) room.host.socket = null;
    }
    return;
  }

  if (room.status !== 'lobby') {
    // Bitmiş oda (ended vb.): hemen temizle, grace period yok
    if (playerInRoom) {
      if (playerInRoom._disconnectTimer) clearTimeout(playerInRoom._disconnectTimer);
      userGroupRoom.delete(String(playerInRoom.userId));
      room.players = room.players.filter(p => p.userId !== playerInRoom.userId);
    }
    return;
  }

  // Lobi: host ayrılırsa odayı kapat; oyuncu ayrılırsa 30s grace period ver (rejoin şansı)
  if (isHost) {
    io.to(`grp_${room.code}`).emit('grp_cancelled');
    clearInterval(room.timerInterval);
    for (const p of [...room.players, ...room.pendingPlayers]) {
      if (p._disconnectTimer) clearTimeout(p._disconnectTimer);
      if (p.socket) socketGroupRoom.delete(p.socket.id);
      userGroupRoom.delete(String(p.userId));
    }
    groupRooms.delete(room.code);
    return;
  }

  if (playerInRoom) {
    // Socket'i null yap, 30s içinde geri dönmezse odadan çıkar
    playerInRoom.socket = null;
    if (playerInRoom._disconnectTimer) clearTimeout(playerInRoom._disconnectTimer);
    playerInRoom._disconnectTimer = setTimeout(() => {
      // userGroupRoom hâlâ bu odaya mı işaret ediyor? Kontrol et
      if (!playerInRoom.socket && userGroupRoom.get(String(playerInRoom.userId)) === room.code) {
        userGroupRoom.delete(String(playerInRoom.userId));
        room.players = room.players.filter(p => p.userId !== playerInRoom.userId);
        room.pendingPlayers = room.pendingPlayers.filter(p => p.userId !== playerInRoom.userId);
        io.to(`grp_${room.code}`).emit('grp_players_update', {
          players: room.players.filter(p => p.socket).map(p => ({ displayName: p.displayName, userId: p.userId }))
        });
      }
    }, 30000);
  } else {
    // pendingPlayers içindeyse hemen çıkar
    room.pendingPlayers = room.pendingPlayers.filter(p => p.socket?.id !== socket.id);
  }
}

function closeRoom(socket) {
  const roomId = socketRoom.get(socket.id);
  if (!roomId) return;
  const room = rooms.get(roomId);
  if (!room) return;
  clearInterval(room.timerInterval);
  room.players.forEach(s => {
    if (s.id !== socket.id) s.emit('opponent_left');
    socketRoom.delete(s.id);
  });
  rooms.delete(roomId);
}

io.on('connection', socket => {
  const authToken = socket.handshake.auth?.token;

  // Online kullanıcı kaydı + last_seen
  if (authToken) {
    userService.getUserByToken(authToken).then(user => {
      if (user) {
        onlineUsers.set(String(user.id), { socket, name: user.username });
        socket._userId = String(user.id);
        userService.updateLastSeen(user.id);
        socket._heartbeat = setInterval(() => userService.updateLastSeen(user.id), 60 * 1000);
      }
    });
  }

  // ─── Arkadaş Oyun Daveti ────────────────────────────────────
  socket.on('friend_invite', async ({ toUserId }) => {
    if (socketRoom.has(socket.id)) return socket.emit('friend_invite_result', { ok: false, error: 'Zaten bir oyundasınız.' });
    const fromUser = await userService.getUserByToken(authToken);
    if (!fromUser) return;
    const target = onlineUsers.get(String(toUserId));
    if (!target) return socket.emit('friend_invite_result', { ok: false, error: 'Arkadaş şu an çevrimiçi değil.' });
    if (socketRoom.has(target.socket.id)) return socket.emit('friend_invite_result', { ok: false, error: 'Arkadaş şu an başka bir oyunda.' });
    const inviteId = Date.now();
    pendingInvites.set(inviteId, { fromSocket: socket, fromName: fromUser.username, fromToken: authToken, toUserId });
    target.socket.emit('friend_invite_received', { inviteId, fromUsername: fromUser.username });
    socket.emit('friend_invite_result', { ok: true, inviteId, toUsername: target.name });
    setTimeout(() => {
      if (!pendingInvites.has(inviteId)) return;
      pendingInvites.delete(inviteId);
      try { socket.emit('friend_invite_expired', { toUsername: target.name }); } catch {}
    }, 30000);
  });

  socket.on('friend_invite_response', async ({ inviteId, accept }) => {
    const invite = pendingInvites.get(inviteId);
    if (!invite) return;
    pendingInvites.delete(inviteId);
    if (!accept) {
      try { invite.fromSocket.emit('friend_invite_declined', { username: authToken ? (await userService.getUserByToken(authToken))?.username : '?' }); } catch {}
      return;
    }
    const fromUser = await userService.getUserByToken(invite.fromToken);
    const toUser   = await userService.getUserByToken(authToken);
    if (!fromUser || !toUser) return;
    createRoom(
      { socket: invite.fromSocket, name: fromUser.username, token: invite.fromToken },
      { socket, name: toUser.username, token: authToken }
    );
  });

  // Ekran kapalıyken biten oyun var mı? — önce bunu kontrol et
  if (authToken && finishedGames.has(authToken)) {
    const fg = finishedGames.get(authToken);
    finishedGames.delete(authToken);
    if (Date.now() < fg.expiresAt) {
      socket.emit('game_over', fg.result);
      // return yok — event handler'lar her koşulda kayıt edilmeli
    }
  }

  // Yeniden bağlanma kontrolü
  if (authToken && pendingReconnects.has(authToken)) {
    const { roomId, playerIndex } = pendingReconnects.get(authToken);
    pendingReconnects.delete(authToken);

    const room = rooms.get(roomId);
    if (room && room.phase !== 'done') {
      const oldSocket = room.players[playerIndex];
      socketRoom.delete(oldSocket.id);
      room.players[playerIndex] = socket;
      socketRoom.set(socket.id, roomId);
      socket.join(roomId);

      const myWords = room.words[playerIndex];
      const myScore = myWords.reduce((s, w) => s + w.word.length, 0);

      socket.emit('reconnected_to_game', {
        phase: room.phase,
        matrix: [...room.matrix],
        turnIndex: room.turnIndex,
        timeLeft: room.timeLeft,
        playerIndex,
        opponentName: room.names[1 - playerIndex],
        myWords,
        myScore,
      });

      // Bekleyen uzatma isteği varsa yeniden bağlanan oyuncuya bildir
      if (room.pendingExtension && room.pendingExtension.requesterIndex !== playerIndex) {
        socket.emit('extension_requested', { fromName: room.names[room.pendingExtension.requesterIndex] });
      }

      // Sessiz yeniden bağlanma — rakibe bildirim yok
      console.log(`Yeniden bağlandı: ${room.names[playerIndex]} oda ${roomId}`);
    }
  }

  // ─── Grup Odası Socket Olayları ──────────────────────────────

  socket.on('grp_create', async ({ displayName, lang }) => {
    if (!authToken) return;
    const user = await userService.getUserByToken(authToken);
    if (!user) return;
    // Eski oda varsa temizle
    const oldCode = socketGroupRoom.get(socket.id);
    if (oldCode) {
      const oldRoom = groupRooms.get(oldCode);
      if (oldRoom) leaveGroupRoom(socket, oldRoom);
      else socketGroupRoom.delete(socket.id);
    }
    const name = ((displayName || '').trim() || user.username).slice(0, 20);
    const gameLang = (_wordSets[lang] ? lang : null) || 'tr';
    const code = genGroupCode();
    const room = {
      code, lang: gameLang, host: { socket, userId: user.id, username: user.username, displayName: name },
      matrix: [], duration: 180, status: 'lobby', joinMode: null,
      players: [{ socket, userId: user.id, username: user.username, displayName: name, words: [], score: 0 }],
      pendingPlayers: [], timerInterval: null, timeLeft: 180,
    };
    groupRooms.set(code, room);
    socketGroupRoom.set(socket.id, code);
    userGroupRoom.set(String(user.id), code);
    socket.join(`grp_${code}`);
    socket.emit('grp_created', { code, lang: gameLang });
  });

  socket.on('grp_set_invite_mode', ({ code, mode }) => {
    const room = groupRooms.get(code);
    if (!room || room.host.socket?.id !== socket.id || room.status !== 'lobby') return;
    if (!['open', 'code'].includes(mode)) return;
    room.joinMode = mode;
    socket.emit('grp_mode_set', { mode });
  });

  socket.on('grp_invite_friends', async ({ code, friendIds }) => {
    const room = groupRooms.get(code);
    if (!room || room.status !== 'lobby') return;
    const fromUser = await userService.getUserByToken(authToken);
    if (!fromUser || String(fromUser.id) !== String(room.host.userId)) return;
    // Socket yeniden bağlanmışsa güncelle
    if (room.host.socket?.id !== socket.id) {
      room.host.socket = socket;
      socketGroupRoom.set(socket.id, code);
    }
    let sent = 0;
    for (const fid of (friendIds || [])) {
      const target = onlineUsers.get(String(fid));
      if (target) { target.socket.emit('grp_friend_invite', { code, fromName: fromUser.username }); sent++; }
    }
    socket.emit('grp_invites_sent', { count: sent });
  });

  socket.on('grp_join', async ({ code }) => {
    const room = groupRooms.get(code);
    if (!room || room.status !== 'lobby') return socket.emit('grp_join_error', { error: 'Oda bulunamadı veya oyun başladı.' });
    if (!authToken) return socket.emit('grp_join_error', { error: 'Giriş gerekli.' });
    const user = await userService.getUserByToken(authToken);
    if (!user) return socket.emit('grp_join_error', { error: 'Giriş gerekli.' });
    if (room.players.some(p => p.userId === user.id)) return socket.emit('grp_join_error', { error: 'Zaten odadasın.' });
    const playerData = { socket, userId: user.id, username: user.username, displayName: user.username, words: [], score: 0 };
    room.players.push(playerData);
    socketGroupRoom.set(socket.id, code);
    userGroupRoom.set(String(user.id), code);
    socket.join(`grp_${code}`);
    socket.emit('grp_approved', { code, hostName: room.host.displayName, lang: room.lang });
    io.to(`grp_${code}`).emit('grp_players_update', {
      players: room.players.map(p => ({ displayName: p.displayName, userId: p.userId }))
    });
  });

  socket.on('grp_request_join', async ({ code }) => {
    const room = groupRooms.get(code);
    if (!room || room.status !== 'lobby' || room.joinMode !== 'open')
      return socket.emit('grp_join_error', { error: 'Bu odaya bu şekilde girilemiyor.' });
    if (!authToken) return socket.emit('grp_join_error', { error: 'Giriş gerekli.' });
    const user = await userService.getUserByToken(authToken);
    if (!user) return socket.emit('grp_join_error', { error: 'Giriş gerekli.' });
    if (room.players.some(p => p.userId === user.id)) return socket.emit('grp_join_error', { error: 'Zaten odadasın.' });
    if (room.pendingPlayers.some(p => p.userId === user.id)) return socket.emit('grp_join_error', { error: 'Onay bekleniyor.' });
    room.pendingPlayers.push({ socket, userId: user.id, username: user.username, displayName: user.username });
    socket.emit('grp_waiting_approval');
    room.host.socket.emit('grp_join_request', { socketId: socket.id, displayName: user.username, userId: user.id });
  });

  socket.on('grp_approve', ({ code, targetSocketId, approve }) => {
    const room = groupRooms.get(code);
    if (!room || room.host.socket?.id !== socket.id || room.status !== 'lobby') return;
    const idx = room.pendingPlayers.findIndex(p => p.socket.id === targetSocketId);
    if (idx === -1) return;
    const [player] = room.pendingPlayers.splice(idx, 1);
    if (approve) {
      room.players.push({ ...player, words: [], score: 0 });
      socketGroupRoom.set(player.socket.id, code);
      userGroupRoom.set(String(player.userId), code);
      player.socket.join(`grp_${code}`);
      player.socket.emit('grp_approved', { code, hostName: room.host.displayName, lang: room.lang });
      io.to(`grp_${code}`).emit('grp_players_update', {
        players: room.players.map(p => ({ displayName: p.displayName, userId: p.userId }))
      });
    } else {
      player.socket.emit('grp_rejected');
    }
  });

  socket.on('grp_start', ({ code, matrix, duration }) => {
    const room = groupRooms.get(code);
    if (!room || room.host.socket?.id !== socket.id || room.status !== 'lobby') return;
    if (!matrix || matrix.length !== 9 || matrix.some(l => !l))
      return socket.emit('grp_start_error', { error: 'Matris eksik veya hatalı.' });
    room.matrix = matrix;
    room.duration = [120, 180, 240, 300].includes(duration) ? duration : 180;
    room.timeLeft = room.duration;
    room.status = 'playing';
    io.to(`grp_${code}`).emit('grp_started', { matrix: room.matrix, duration: room.duration });
    let n = 5;
    io.to(`grp_${code}`).emit('grp_countdown', { n });
    const cdInterval = setInterval(() => {
      n--;
      if (n <= 0) {
        clearInterval(cdInterval);
        io.to(`grp_${code}`).emit('grp_game_start');
        room.timerInterval = setInterval(() => {
          room.timeLeft--;
          io.to(`grp_${code}`).emit('grp_timer_tick', { timeLeft: room.timeLeft });
          if (room.timeLeft <= 0) grpRoomEnd(room);
        }, 1000);
      } else {
        io.to(`grp_${code}`).emit('grp_countdown', { n });
      }
    }, 1000);
  });

  socket.on('grp_submit_word', ({ word }) => {
    const code = socketGroupRoom.get(socket.id);
    if (!code) return;
    const room = groupRooms.get(code);
    if (!room || room.status !== 'playing') return;
    const player = room.players.find(p => p.socket.id === socket.id);
    if (!player) return;
    const langSet = _wordSets[room.lang] || _wordSets['tr'];
    const locale = langSet.locale;
    const wordU = (word || '').toLocaleUpperCase(locale);
    const wordL = wordU.toLocaleLowerCase(locale);
    if (wordU.length < langSet.minLength) return socket.emit('grp_word_result', { status: 'short', word: wordU, points: 0 });
    const mc = {};
    room.matrix.forEach(l => { mc[l] = (mc[l] || 0) + 1; });
    const need = {};
    for (const ch of wordU) need[ch] = (need[ch] || 0) + 1;
    for (const ch in need) {
      if ((mc[ch] || 0) < need[ch]) return socket.emit('grp_word_result', { status: 'invalid', word: wordU, points: 0 });
    }
    if (!langSet.wordSet.has(wordL) || langSet.blacklistSet.has(wordL))
      return socket.emit('grp_word_result', { status: 'invalid', word: wordU, points: 0 });
    const cnt = player.words.filter(w => w === wordU).length;
    const max = langSet.homophoneSet.has(wordL) ? 2 : 1;
    if (cnt >= max) return socket.emit('grp_word_result', { status: 'duplicate', word: wordU, points: 0 });
    player.words.push(wordU);
    player.score += wordU.length;
    socket.emit('grp_word_result', { status: 'valid', word: wordU, points: wordU.length });
  });

  socket.on('grp_check_active', async () => {
    if (!authToken) return socket.emit('grp_active_room', { active: false });
    const user = await userService.getUserByToken(authToken);
    if (!user) return socket.emit('grp_active_room', { active: false });
    const code = userGroupRoom.get(String(user.id));
    if (!code) return socket.emit('grp_active_room', { active: false });
    const room = groupRooms.get(code);
    if (!room || !['playing', 'lobby'].includes(room.status)) {
      userGroupRoom.delete(String(user.id));
      return socket.emit('grp_active_room', { active: false });
    }
    socket.emit('grp_active_room', { active: true, code, status: room.status, hostName: room.host.displayName, timeLeft: room.timeLeft });
  });

  socket.on('grp_rejoin', async ({ code }) => {
    if (!authToken) return;
    const user = await userService.getUserByToken(authToken);
    if (!user) return;
    const room = groupRooms.get(code);
    if (!room) return socket.emit('grp_join_error', { error: 'Oda artık mevcut değil.' });

    if (room.status === 'lobby') {
      // Lobi: grace period içindeki oyuncuyu geri al
      const player = room.players.find(p => String(p.userId) === String(user.id) && !p.socket);
      if (!player) return socket.emit('grp_join_error', { error: 'Bu odada kayıtlı değilsiniz.' });
      if (player._disconnectTimer) clearTimeout(player._disconnectTimer);
      player._disconnectTimer = null;
      player.socket = socket;
      socketGroupRoom.set(socket.id, code);
      userGroupRoom.set(String(user.id), code);
      socket.join(`grp_${code}`);
      socket.emit('grp_approved', { code, hostName: room.host.displayName, lang: room.lang });
      return;
    }

    if (room.status !== 'playing')
      return socket.emit('grp_join_error', { error: 'Oyun artık aktif değil.' });
    const player = room.players.find(p => String(p.userId) === String(user.id));
    if (!player)
      return socket.emit('grp_join_error', { error: 'Bu oyunda kayıtlı değilsiniz.' });
    if (player.socket?.id) socketGroupRoom.delete(player.socket.id);
    player.socket = socket;
    socketGroupRoom.set(socket.id, code);
    userGroupRoom.set(String(user.id), code);
    socket.join(`grp_${code}`);
    if (String(room.host.userId) === String(user.id)) room.host.socket = socket;
    socket.emit('grp_rejoin_ok', {
      matrix: room.matrix,
      duration: room.duration,
      timeLeft: room.timeLeft,
      score: player.score,
    });
  });

  socket.on('grp_leave', () => {
    const code = socketGroupRoom.get(socket.id);
    if (!code) return;
    const room = groupRooms.get(code);
    if (room) leaveGroupRoom(socket, room);
  });

  socket.on('join_queue', ({ name, lang }) => {
    if (socketRoom.has(socket.id)) return; // zaten bir odada
    const pName = (name || 'Oyuncu').slice(0, 20);
    const gameLang = (_wordSets[lang] ? lang : null) || 'tr';
    const q = getQueue(gameLang);
    if (q.find(p => p.socket.id === socket.id)) return;
    q.push({ socket, name: pName, token: authToken, lang: gameLang });
    console.log(`Kuyruğa eklendi [${gameLang}]: ${pName} (kuyruk: ${q.length})`);
    socket.emit('queued', { position: q.length });
    if (q.length >= 2) {
      const [p1, p2] = q.splice(0, 2);
      console.log(`Eşleşti [${gameLang}]: ${p1.name} vs ${p2.name}`);
      createRoom(p1, p2, gameLang);
    }
  });

  socket.on('leave_queue', () => {
    for (const q of Object.values(queues)) {
      const i = q.findIndex(p => p.socket.id === socket.id);
      if (i !== -1) { q.splice(i, 1); break; }
    }
  });

  socket.on('fill_cell', ({ pos, letter }) => {
    const roomId = socketRoom.get(socket.id);
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room || room.phase !== 'fill') return;
    const pIdx = room.players.findIndex(s => s.id === socket.id);
    if (pIdx !== room.turnIndex) return;
    if (pos < 0 || pos >= 9 || room.matrix[pos] !== '') return;
    if (!/^[A-ZÇĞIİÖŞÜ]$/.test(letter)) return;
    room.matrix[pos] = letter;
    room.turnIndex = 1 - room.turnIndex;
    room.cellsFilled++;
    io.to(roomId).emit('cell_filled', {
      pos, letter, matrix: [...room.matrix], turnIndex: room.turnIndex,
    });
    if (room.cellsFilled === 9) { room.phase = 'countdown'; roomCountdown(room); }
  });

  socket.on('submit_word', ({ word }) => {
    const roomId = socketRoom.get(socket.id);
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room || room.phase !== 'playing') return;
    const pIdx = room.players.findIndex(s => s.id === socket.id);
    const result = validateWord(room, pIdx, word);
    socket.emit('word_result', result);
    if (result.status === 'valid') room.words[pIdx].push({ word: result.word, points: result.points });
  });

  socket.on('use_hint', async () => {
    const roomId = socketRoom.get(socket.id);
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room || room.phase !== 'playing') return;
    const pIdx = room.players.findIndex(s => s.id === socket.id);
    if (pIdx === -1) return;

    // Rakipten en fazla 2 fazla ipucu kullanılabilir
    if ((room.hintsUsed[pIdx] - room.hintsUsed[1 - pIdx]) >= 2) {
      socket.emit('hint_result', { ok: false, error: 'Rakibinden en fazla 2 fazla ipucu kullanabilirsin.' });
      return;
    }

    // KL kontrolü
    const user = await userService.getUserByToken(authToken);
    if (!user || (user.klBalance || 0) < 150) {
      socket.emit('hint_result', { ok: false, error: `Yeterli KL yok. (150 KL gerekli, bakiye: ${user?.klBalance || 0})` });
      return;
    }

    // Matristeki harflerden kelime bul
    const hintLangSet = _wordSets[room.lang] || _wordSets['tr'];
    const hintLocale = hintLangSet.locale;
    const mc = {};
    room.matrix.forEach(l => { mc[l] = (mc[l] || 0) + 1; });
    const found = new Set(room.words[pIdx].map(w => w.word.toLocaleLowerCase(hintLocale)));
    const candidates = [];
    for (const word of hintLangSet.wordSet) {
      if (found.has(word) || word.length < hintLangSet.minLength) continue;
      const wordU = word.toLocaleUpperCase(hintLocale);
      const need = {};
      for (const ch of wordU) need[ch] = (need[ch] || 0) + 1;
      let ok = true;
      for (const ch in need) { if ((mc[ch] || 0) < need[ch]) { ok = false; break; } }
      if (ok) candidates.push(wordU);
    }

    if (candidates.length === 0) {
      socket.emit('hint_result', { ok: false, error: 'Şu an verilecek ipucu yok.' });
      return;
    }

    const word = candidates[Math.floor(Math.random() * Math.min(candidates.length, 30))];
    // 2 rastgele pozisyon seç ve o harfleri aç
    const positions = [...Array(word.length).keys()].sort(() => Math.random() - 0.5);
    const revealSet = new Set(positions.slice(0, 2));
    const pattern = [...word].map((ch, i) => revealSet.has(i) ? ch : null);

    await userService.deductKL(authToken, 150);
    room.hintsUsed[pIdx]++;
    socket.emit('hint_result', { ok: true, pattern });
  });

  socket.on('set_duration', ({ duration }) => {
    const roomId = socketRoom.get(socket.id);
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room || room.phase !== 'fill') return;
    const pIdx = room.players.findIndex(s => s.id === socket.id);
    if (pIdx !== 0) return; // sadece admin
    if (![120, 180, 300].includes(duration)) return;
    room.duration = duration;
    io.to(room.id).emit('duration_changed', { duration });
  });

  socket.on('leave_game', () => {
    const roomId = socketRoom.get(socket.id);
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;
    clearInterval(room.timerInterval);
    clearInterval(room.countdownInterval);
    clearTimeout(room.vowelFixDelay);
    // Her iki oyuncunun token'ını pendingReconnects'ten temizle
    [0, 1].forEach(i => {
      const t = room.tokens[i];
      if (t && pendingReconnects.has(t)) {
        pendingReconnects.delete(t);
      }
    });
    // Diğer oyuncuya bildir, her ikisini socketRoom'dan çıkar
    room.players.forEach(s => {
      if (s.id !== socket.id) {
        try { s.emit('opponent_left'); } catch {}
      }
      socketRoom.delete(s.id);
    });
    socketRoom.delete(socket.id);
    rooms.delete(roomId);
    console.log(`Kasıtlı çıkış: oda ${roomId} kapatıldı`);
  });

  socket.on('request_extension', () => {
    const roomId = socketRoom.get(socket.id);
    const room = rooms.get(roomId);
    if (!room || room.phase !== 'playing') return;
    const pIdx = room.players.findIndex(s => s.id === socket.id);
    if (pIdx === -1) return;
    if (room.extensionRequests[pIdx] >= 1) return; // zaten kullandı
    if (room.pendingExtension) return;              // başka istek bekliyor
    room.pendingExtension = { requesterIndex: pIdx };
    const opponentToken = room.tokens[1 - pIdx];
    if (pendingReconnects.has(opponentToken)) {
      // Rakip çevrimdışı — bağlanınca iletilecek
      socket.emit('extension_pending_offline');
    } else {
      try { room.players[1 - pIdx].emit('extension_requested', { fromName: room.names[pIdx] }); } catch {}
    }
  });

  socket.on('extension_response', ({ accept }) => {
    const roomId = socketRoom.get(socket.id);
    const room = rooms.get(roomId);
    if (!room || room.phase !== 'playing' || !room.pendingExtension) return;
    const { requesterIndex } = room.pendingExtension;
    room.pendingExtension = null;
    if (accept) {
      room.extensionRequests[requesterIndex]++;
      room.timeLeft += 30;
      io.to(room.id).emit('extension_accepted', { newTimeLeft: room.timeLeft });
    } else {
      try { room.players[requesterIndex].emit('extension_rejected'); } catch {}
    }
  });

  socket.on('disconnect', () => {
    if (socket._heartbeat) clearInterval(socket._heartbeat);
    if (socket._userId) {
      onlineUsers.delete(String(socket._userId));
      userService.updateLastSeen(socket._userId);
    }
    // Kuyruktan çıkar
    for (const q of Object.values(queues)) {
      const qi = q.findIndex(p => p.socket.id === socket.id);
      if (qi !== -1) { q.splice(qi, 1); break; }
    }

    const roomId = socketRoom.get(socket.id);
    if (roomId) {
      const room = rooms.get(roomId);
      const inGame = room && (room.phase === 'playing' || room.phase === 'countdown') && authToken;
      if (inGame) {
        const playerIndex = room.players.findIndex(s => s.id === socket.id);
        if (playerIndex !== -1) {
          const otherToken = room.tokens[1 - playerIndex];

          // Diğer oyuncu da zaten çıkmışsa → odayı kapat
          if (otherToken && pendingReconnects.has(otherToken)) {
            clearInterval(room.timerInterval);
            clearInterval(room.countdownInterval);
            clearTimeout(room.vowelFixDelay);
            pendingReconnects.delete(otherToken);
            socketRoom.delete(socket.id);
            rooms.delete(roomId);
            console.log(`Oda kapatıldı (iki oyuncu da koptu): ${roomId}`);
            return;
          }

          // Sadece bu oyuncu koptu → sessizce bekle, rakibe bildirme, oyun devam eder
          pendingReconnects.set(authToken, { roomId, playerIndex });
          socketRoom.delete(socket.id);
          console.log(`Bağlantı koptu: ${room.names[playerIndex]} oda ${roomId} — oyun devam ediyor`);
          return;
        }
      }
    }

    // Grup odası temizliği (oyun devam ediyorsa sadece socket'i kopar, oda canlı kalır)
    const grpCode = socketGroupRoom.get(socket.id);
    if (grpCode) {
      const grpRoom = groupRooms.get(grpCode);
      if (grpRoom) leaveGroupRoom(socket, grpRoom);
      else socketGroupRoom.delete(socket.id);
    }

    closeRoom(socket);
    socketRoom.delete(socket.id);
  });
});

// ─── Başlat ──────────────────────────────────────────────────

server.listen(PORT, () => {
  const ip = getLocalIP();
  console.log(`\nVerbum9 çalışıyor → http://localhost:${PORT}`);
  console.log(`Telefon / ağ      → http://${ip}:${PORT}`);
  console.log(`Sözlük            → http://localhost:${PORT}/sozluk`);
  console.log(`Admin             → http://localhost:${PORT}/admin\n`);
});
