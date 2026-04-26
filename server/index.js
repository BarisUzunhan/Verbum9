const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

app.use(express.static(path.join(__dirname, '../client')));
app.use('/data', express.static(path.join(__dirname, '../data')));

app.get('/sozluk', (req, res) => {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/words.json'), 'utf8'));
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
    .sub { color: #8892b0; margin-bottom: 16px; font-size: 0.9rem; }
    input { padding: 10px 14px; border-radius: 8px; border: 1px solid #333; background: #1a1a2e; color: #fff; width: min(360px, 100%); font-size: 1rem; outline: none; }
    input:focus { border-color: #4cc9f0; }
    .count { color: #8892b0; margin: 12px 0 8px; font-size: 0.9rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 4px; }
    .word { padding: 5px 10px; background: #1a1a2e; border-radius: 6px; font-size: 0.95rem; border-left: 3px solid #16213e; }
    .word.hl { border-left-color: #e94560; background: #1e0a0f; }
    a { color: #4cc9f0; text-decoration: none; }
  </style>
</head>
<body>
  <h1>Verbum9 Sözlüğü</h1>
  <p class="sub">Faz 1 demo listesi — <a href="/">← Oyuna dön</a></p>
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
</body>
</html>`);
});

app.listen(PORT, () => {
  console.log(`\nVerbum9 çalışıyor → http://localhost:${PORT}`);
  console.log(`Sözlük      → http://localhost:${PORT}/sozluk\n`);
});
