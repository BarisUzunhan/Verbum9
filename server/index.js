const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;
const WORDS_PATH = path.join(__dirname, '../data/words.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, '../client')));
app.use('/data', express.static(path.join(__dirname, '../data')));

// ─── Yardımcı: words.json oku/yaz ────────────────────────────

function readWords() {
  return JSON.parse(fs.readFileSync(WORDS_PATH, 'utf8'));
}

function writeWords(data) {
  fs.writeFileSync(WORDS_PATH, JSON.stringify(data), 'utf8');
}

// ─── Sözlük arama sayfası ─────────────────────────────────────

app.get('/sozluk', (req, res) => {
  const data = readWords();
  const sorted = [...data.words].sort((a, b) => a.localeCompare(b, 'tr'));
  res.send(`<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verbum9 Sözlüğü</title>
  <style>
    body { font-family: 'Segoe UI', sans-serif; background: #0f0e17; color: #fff; padding: 20px; }
    h1 { color: #e94560; margin-bottom: 4px; }
    nav { margin-bottom: 16px; font-size: 0.9rem; }
    nav a { color: #4cc9f0; text-decoration: none; margin-right: 16px; }
    input { padding: 10px 14px; border-radius: 8px; border: 1px solid #333; background: #1a1a2e; color: #fff; width: min(360px, 100%); font-size: 1rem; outline: none; }
    input:focus { border-color: #4cc9f0; }
    .count { color: #8892b0; margin: 12px 0 8px; font-size: 0.9rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 4px; }
    .word { padding: 5px 10px; background: #1a1a2e; border-radius: 6px; font-size: 0.95rem; border-left: 3px solid #16213e; }
    .word.hl { border-left-color: #e94560; background: #1e0a0f; }
  </style>
</head>
<body>
  <h1>Verbum9 Sözlüğü</h1>
  <nav><a href="/">← Oyuna dön</a><a href="/admin">Admin →</a></nav>
  <input id="q" placeholder="Kelime ara..." oninput="filter()" autofocus>
  <div class="count" id="cnt">${sorted.length} kelime</div>
  <div class="grid" id="list">${sorted.map(w => `<div class="word">${w}</div>`).join('')}</div>
  <script>
    const all = ${JSON.stringify(sorted)};
    function filter() {
      const q = document.getElementById('q').value.toLocaleLowerCase('tr-TR');
      const hits = q ? all.filter(w => w.includes(q)) : all;
      document.getElementById('cnt').textContent = hits.length + ' kelime';
      document.getElementById('list').innerHTML = hits
        .map(w => '<div class="word' + (q ? ' hl' : '') + '">' + w + '</div>').join('');
    }
  </script>
</body></html>`);
});

// ─── Admin paneli ─────────────────────────────────────────────

app.get('/admin', (req, res) => {
  const data = readWords();
  const homophones = data.homophones || [];
  res.send(`<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verbum9 Admin</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', sans-serif; background: #0f0e17; color: #fff; padding: 24px; max-width: 640px; margin: 0 auto; }
    h1 { color: #e94560; font-size: 1.6rem; margin-bottom: 4px; }
    h2 { font-size: 1rem; color: #8892b0; text-transform: uppercase; letter-spacing: 2px; margin: 28px 0 12px; }
    nav { margin-bottom: 24px; font-size: 0.9rem; }
    nav a { color: #4cc9f0; text-decoration: none; margin-right: 16px; }
    .card { background: #1a1a2e; border-radius: 12px; padding: 16px; }
    .add-form { display: flex; gap: 8px; margin-bottom: 16px; }
    .add-form input { flex: 1; padding: 10px 14px; border-radius: 8px; border: 1px solid #333; background: #0f0e17; color: #fff; font-size: 1rem; outline: none; }
    .add-form input:focus { border-color: #e94560; }
    .btn { padding: 10px 20px; border-radius: 8px; border: none; font-size: 0.95rem; cursor: pointer; font-weight: 600; }
    .btn-add { background: #e94560; color: white; }
    .btn-del { background: transparent; border: 1px solid #444; color: #8892b0; padding: 4px 10px; border-radius: 6px; font-size: 0.85rem; cursor: pointer; }
    .btn-del:hover { border-color: #e94560; color: #e94560; }
    .word-row { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-radius: 8px; margin-bottom: 4px; background: #0f0e17; }
    .word-text { font-size: 1rem; font-weight: 600; }
    .badge { font-size: 0.75rem; color: #4cc9f0; background: rgba(76,201,240,0.1); padding: 2px 8px; border-radius: 10px; border: 1px solid rgba(76,201,240,0.2); margin-left: 8px; }
    .msg { padding: 10px 14px; border-radius: 8px; margin-bottom: 16px; font-size: 0.9rem; }
    .msg.ok { background: rgba(6,214,160,0.15); border: 1px solid #06d6a0; color: #06d6a0; }
    .msg.err { background: rgba(239,35,60,0.15); border: 1px solid #ef233c; color: #ef233c; }
    .empty { color: #8892b0; font-size: 0.9rem; padding: 8px; }
  </style>
</head>
<body>
  <h1>Verbum9 Admin</h1>
  <nav><a href="/">← Oyuna dön</a><a href="/sozluk">Sözlük →</a></nav>

  <div id="msg"></div>

  <h2>Sesteş Kelimeler</h2>
  <p style="color:#8892b0;font-size:0.85rem;margin-bottom:12px;">
    Sesteş kelimeler iki farklı anlamı olan kelimelerdir (örn. "el" = organ ve yabancı). Oyunda bu kelimeler iki kez yazılabilir.
  </p>
  <div class="card">
    <form class="add-form" id="add-form">
      <input id="new-word" placeholder="Sesteş kelime ekle (örn: ama)" autocomplete="off">
      <button type="submit" class="btn btn-add">Ekle</button>
    </form>
    <div id="homo-list">
      ${homophones.length === 0
        ? '<div class="empty">Henüz sesteş kelime yok.</div>'
        : homophones.sort((a,b) => a.localeCompare(b,'tr')).map(w => `
        <div class="word-row" id="row-${w}">
          <span class="word-text">${w}<span class="badge">2 anlam</span></span>
          <button class="btn-del" onclick="delWord('${w}')">✕ Kaldır</button>
        </div>`).join('')
      }
    </div>
  </div>

  <script>
    function showMsg(text, ok) {
      const el = document.getElementById('msg');
      el.className = 'msg ' + (ok ? 'ok' : 'err');
      el.textContent = text;
      setTimeout(() => { el.textContent = ''; el.className = ''; }, 3000);
    }

    document.getElementById('add-form').onsubmit = async (e) => {
      e.preventDefault();
      const word = document.getElementById('new-word').value.trim().toLocaleLowerCase('tr-TR');
      if (!word) return;
      const res = await fetch('/api/admin/homophones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ word })
      });
      const data = await res.json();
      if (data.ok) {
        showMsg('"' + word + '" eklendi.', true);
        document.getElementById('new-word').value = '';
        const list = document.getElementById('homo-list');
        const row = document.createElement('div');
        row.className = 'word-row';
        row.id = 'row-' + word;
        row.innerHTML = '<span class="word-text">' + word + '<span class="badge">2 anlam</span></span>' +
          '<button class="btn-del" onclick="delWord(\\'' + word + '\\')">✕ Kaldır</button>';
        list.appendChild(row);
      } else {
        showMsg(data.error || 'Hata.', false);
      }
    };

    async function delWord(word) {
      const res = await fetch('/api/admin/homophones/' + encodeURIComponent(word), { method: 'DELETE' });
      const data = await res.json();
      if (data.ok) {
        document.getElementById('row-' + word)?.remove();
        showMsg('"' + word + '" kaldırıldı.', true);
      } else {
        showMsg(data.error || 'Hata.', false);
      }
    }
  </script>
</body></html>`);
});

// ─── Admin API: sesteş ekle ───────────────────────────────────

app.post('/api/admin/homophones', (req, res) => {
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

// ─── Admin API: sesteş sil ────────────────────────────────────

app.delete('/api/admin/homophones/:word', (req, res) => {
  const word = decodeURIComponent(req.params.word).toLocaleLowerCase('tr-TR');
  const data = readWords();
  data.homophones = (data.homophones || []).filter(w => w !== word);
  writeWords(data);
  res.json({ ok: true });
});

// ─── Başlat ──────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\nVerbum9 çalışıyor → http://localhost:${PORT}`);
  console.log(`Sözlük           → http://localhost:${PORT}/sozluk`);
  console.log(`Admin            → http://localhost:${PORT}/admin\n`);
});
