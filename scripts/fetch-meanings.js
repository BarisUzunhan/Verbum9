/**
 * Tüm kelimelerin anlamlarını TDK'dan çekip Supabase'e kaydeder.
 * Bir kez lokal çalıştır: node scripts/fetch-meanings.js
 * Yarıda kalırsa tekrar çalıştırılabilir — tamamlananları atlar.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const https  = require('https');
const fs     = require('fs');
const path   = require('path');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const WORDS_PATH = path.join(__dirname, '../data/words.json');
const DELAY_MS   = 150;   // ~6 istek/saniye
const BATCH_SIZE = 50;    // Supabase'e toplu yazma boyutu

function fetchTDK(word) {
  return new Promise(resolve => {
    const req = https.request({
      hostname: 'sozluk.gov.tr',
      path:     `/gts?ara=${encodeURIComponent(word)}`,
      method:   'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept':     'application/json, text/plain, */*',
        'Referer':    'https://sozluk.gov.tr/',
      },
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (!Array.isArray(json) || json.length === 0) return resolve([]);
          const meanings = json.flatMap(entry =>
            (entry.anlam_icerik || []).map(a => {
              const ozellik = (a.ozellik_icerik || []).map(o => o.tam_adi).filter(Boolean).join(', ');
              return ozellik ? `(${ozellik}) ${a.anlam}` : a.anlam;
            })
          ).filter(Boolean).slice(0, 5);
          resolve(meanings);
        } catch { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.setTimeout(8000, () => { req.destroy(); resolve([]); });
    req.end();
  });
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  const allWords = JSON.parse(fs.readFileSync(WORDS_PATH, 'utf8')).words;
  console.log(`Sözlükte toplam ${allWords.length} kelime.`);

  // Zaten işlenenleri atla
  const { data: existing } = await supabase
    .from('word_meanings')
    .select('word');
  const done = new Set((existing || []).map(r => r.word));
  console.log(`Veritabanında mevcut: ${done.size}`);

  const toFetch = allWords.filter(w => !done.has(w));
  console.log(`Kalan: ${toFetch.length} kelime\n`);

  if (toFetch.length === 0) {
    console.log('Tümü tamamlanmış!');
    return;
  }

  let batch = [];
  let saved = 0;
  const start = Date.now();

  for (let i = 0; i < toFetch.length; i++) {
    const word = toFetch[i];
    const meanings = await fetchTDK(word);
    batch.push({ word, meanings });

    if (batch.length >= BATCH_SIZE || i === toFetch.length - 1) {
      const { error } = await supabase.from('word_meanings').upsert(batch);
      if (error) console.error('Supabase hatası:', error.message);
      saved += batch.length;
      batch = [];

      const elapsed = ((Date.now() - start) / 1000).toFixed(0);
      const rate    = (saved / ((Date.now() - start) / 1000)).toFixed(1);
      const remaining = Math.round((toFetch.length - i - 1) / rate);
      console.log(
        `[${elapsed}s] ${i + 1}/${toFetch.length} — ` +
        `${rate} kelime/s — kalan ~${remaining}s`
      );
    }

    await delay(DELAY_MS);
  }

  console.log(`\nTamamlandı! Toplam ${saved} kelime işlendi.`);
}

main().catch(console.error);
