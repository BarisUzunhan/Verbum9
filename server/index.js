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
            (entry.anlam_icerik || []).map(a => {
              const ozellik = (a.ozellik_icerik || []).map(o => o.tam_adi).filter(Boolean).join(', ');
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

app.use(express.json());
app.use(express.static(path.join(__dirname, '../client')));
// /data → sadece words.json erişilebilir, users.json hariç
app.get('/data/words.json', (req, res) => res.sendFile(WORDS_PATH));

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
          '<button class="btn-approve" onclick="resolveDispute('+d.id+',\\'approve\\')">✓ Onayla</button>'+
          '<button class="btn-del" onclick="resolveDispute('+d.id+',\\'reject\\')">✕ Reddet</button>'+
          '</div></div>';
      }).join('');
    }

    async function resolveDispute(id, action) {
      const res = await fetch('/api/disputes/'+id, {
        method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({action})
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
  const word = req.params.word.toLocaleLowerCase('tr-TR');
  if (_meaningCache.has(word)) return res.json(_meaningCache.get(word));
  const { data } = await supabase
    .from('word_meanings')
    .select('meanings')
    .eq('word', word)
    .maybeSingle();
  const result = data ? { word, meanings: data.meanings } : null;
  _meaningCache.set(word, result);
  res.json(result);
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

  // TDK kontrolü arka planda — yanıt zaten gönderildi
  checkTDK(normalized).then(async inTDK => {
    if (!inTDK) return;
    await supabase.from('disputes')
      .update({ status: 'approved', resolved_at: new Date().toISOString() })
      .eq('id', id);
    const dictData = readWords();
    if (!dictData.words.includes(normalized)) {
      dictData.words.push(normalized);
      writeWords(dictData);
      _wordSet.add(normalized);
    }
    console.log(`[TDK] "${normalized}" otomatik onaylandı.`);
  }).catch(err => console.error('[TDK]', err));
});

// ─── İtiraz API: onayla / reddet ─────────────────────────────

app.patch('/api/disputes/:id', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id);
  const { action } = req.body;
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

// ─── Socket.IO — Çok Oyunculu Motor ─────────────────────────

// Sözlük sunucu tarafı doğrulama için belleğe alınır
const _dictData = readWords();
const _wordSet      = new Set(_dictData.words.map(w => w.toLocaleLowerCase('tr-TR')));
const _homophoneSet = new Set((_dictData.homophones || []).map(w => w.toLocaleLowerCase('tr-TR')));
const _blacklistSet = new Set((_dictData.blacklist  || []).map(w => w.toLocaleLowerCase('tr-TR')));

// TDK anlam önbelleği (bellek içi)
const _meaningCache = new Map();

const queue = [];                   // { socket, name }[]
const rooms = new Map();            // roomId → room
const socketRoom = new Map();       // socketId → roomId
const pendingReconnects = new Map(); // token → { roomId, playerIndex }
const finishedGames = new Map();    // token → { result, expiresAt } — ekran kapalıyken biten oyunlar için

// 1 dakikada bir süresi dolmuş sonuçları temizle
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of finishedGames) {
    if (now > v.expiresAt) finishedGames.delete(k);
  }
}, 60000);

function createRoom(p1, p2) {
  const roomId = crypto.randomBytes(4).toString('hex');
  const room = {
    id: roomId,
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
  p1.socket.emit('matched', { opponentName: p2.name, playerIndex: 0, turnIndex: 0 });
  p2.socket.emit('matched', { opponentName: p1.name, playerIndex: 1, turnIndex: 0 });
}

const VOWELS_SET = new Set(['A', 'E', 'I', 'İ', 'O', 'Ö', 'U', 'Ü']);
const VOWELS_ARR = ['A', 'E', 'İ', 'I', 'O', 'U', 'Ö', 'Ü'];

function roomCountdown(room) {
  // Hiç sesli harf yoksa 2 rastgele sessiz harfi sesli harfle değiştir
  const hasVowel = room.matrix.some(l => VOWELS_SET.has(l));
  console.log(`[roomCountdown] matris: [${room.matrix.join(',')}] | sesliHarf: ${hasVowel}`);
  let delay = 0;
  if (!hasVowel) {
    const positions = [...Array(9).keys()]
      .sort(() => Math.random() - 0.5)
      .slice(0, 2);
    const changed = positions.map(pos => {
      const vowel = VOWELS_ARR[Math.floor(Math.random() * VOWELS_ARR.length)];
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

  // Ekran kapalıyken bağlantısı kopmuş oyuncular için sonucu 3 dk sakla
  const expiresAt = Date.now() + 3 * 60 * 1000;
  if (room.tokens[0]) finishedGames.set(room.tokens[0], { result: gameResult, expiresAt });
  if (room.tokens[1]) finishedGames.set(room.tokens[1], { result: gameResult, expiresAt });

  // Yeniden bağlanma kayıtlarını temizle
  if (room.tokens[0]) pendingReconnects.delete(room.tokens[0]);
  if (room.tokens[1]) pendingReconnects.delete(room.tokens[1]);
  socketRoom.delete(room.players[0].id);
  socketRoom.delete(room.players[1].id);
  rooms.delete(room.id);
}

function validateWord(room, pIdx, rawWord) {
  const wordU = (rawWord || '').toLocaleUpperCase('tr-TR');
  const wordL = wordU.toLocaleLowerCase('tr-TR');
  if (wordU.length < 2) return { status: 'short', word: wordU, points: 0 };
  const mc = {};
  room.matrix.forEach(l => { mc[l] = (mc[l] || 0) + 1; });
  const need = {};
  for (const ch of wordU) need[ch] = (need[ch] || 0) + 1;
  for (const ch in need) {
    if ((mc[ch] || 0) < need[ch]) return { status: 'invalid', word: wordU, points: 0 };
  }
  if (!_wordSet.has(wordL) || _blacklistSet.has(wordL)) return { status: 'invalid', word: wordU, points: 0 };
  const pw = room.words[pIdx];
  const cnt = pw.filter(w => w.word === wordU).length;
  const max = _homophoneSet.has(wordL) ? 2 : 1;
  if (cnt >= max) return { status: 'duplicate', word: wordU, points: 0 };
  return { status: 'valid', word: wordU, points: wordU.length };
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

  // Ekran kapalıyken biten oyun var mı? — önce bunu kontrol et
  if (authToken && finishedGames.has(authToken)) {
    const fg = finishedGames.get(authToken);
    finishedGames.delete(authToken); // tek seferlik gönder
    if (Date.now() < fg.expiresAt) {
      socket.emit('game_over', fg.result);
      return; // pendingReconnects'e bakma, oyun bitti
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

  socket.on('join_queue', ({ name }) => {
    if (socketRoom.has(socket.id)) return; // zaten bir odada
    const pName = (name || 'Oyuncu').slice(0, 20);
    if (queue.find(p => p.socket.id === socket.id)) return;
    queue.push({ socket, name: pName, token: authToken });
    console.log(`Kuyruğa eklendi: ${pName} (kuyruk: ${queue.length})`);
    socket.emit('queued', { position: queue.length });
    if (queue.length >= 2) {
      const [p1, p2] = queue.splice(0, 2);
      console.log(`Eşleşti: ${p1.name} vs ${p2.name}`);
      createRoom(p1, p2);
    }
  });

  socket.on('leave_queue', () => {
    const i = queue.findIndex(p => p.socket.id === socket.id);
    if (i !== -1) queue.splice(i, 1);
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
    const mc = {};
    room.matrix.forEach(l => { mc[l] = (mc[l] || 0) + 1; });
    const found = new Set(room.words[pIdx].map(w => w.word.toLocaleLowerCase('tr-TR')));
    const candidates = [];
    for (const word of _wordSet) {
      if (found.has(word) || word.length < 3) continue;
      const wordU = word.toLocaleUpperCase('tr-TR');
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
    // Kuyruktan çıkar
    const qi = queue.findIndex(p => p.socket.id === socket.id);
    if (qi !== -1) queue.splice(qi, 1);

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
