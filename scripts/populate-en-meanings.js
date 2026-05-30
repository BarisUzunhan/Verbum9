/**
 * İngilizce kelimelerin anlamlarını dictionaryapi.dev'den çekip Supabase'e kaydeder.
 * node scripts/populate-en-meanings.js
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

const WORDS_PATH   = path.join(__dirname, '../data/words_en.json');
const CONCURRENCY  = 15;   // aynı anda kaç istek
const BATCH_MS     = 250;  // her CONCURRENCY grubundan sonra bekleme (ms)
const BATCH_SIZE   = 75;   // Supabase'e toplu yazma boyutu
const MIN_LEN      = 1;
const MAX_LEN      = 99;

function fetchDictAPI(word) {
  return new Promise(resolve => {
    const req = https.request({
      hostname: 'api.dictionaryapi.dev',
      path: `/api/v2/entries/en/${encodeURIComponent(word)}`,
      method: 'GET',
      headers: { 'User-Agent': 'Verbum9/1.0' },
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        if (res.statusCode !== 200) return resolve([]);
        try {
          const json = JSON.parse(data);
          if (!Array.isArray(json)) return resolve([]);
          const meanings = json.flatMap(entry =>
            (entry.meanings || []).flatMap(m =>
              (m.definitions || []).slice(0, 2).map(d => {
                const def = d.definition || '';
                return m.partOfSpeech ? `(${m.partOfSpeech}) ${def}` : def;
              })
            )
          ).filter(Boolean).slice(0, 5);
          resolve(meanings);
        } catch { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.setTimeout(10000, () => { req.destroy(); resolve([]); });
    req.end();
  });
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function runConcurrent(words, fn, concurrency) {
  const results = new Array(words.length);
  let i = 0;
  async function worker() {
    while (i < words.length) {
      const idx = i++;
      results[idx] = await fn(words[idx]);
    }
  }
  const workers = Array.from({ length: concurrency }, worker);
  await Promise.all(workers);
  return results;
}

async function main() {
  const raw = JSON.parse(fs.readFileSync(WORDS_PATH, 'utf8').replace(/^﻿/, ''));
  const allWords = (raw.words || raw).filter(w => w.length >= MIN_LEN && w.length <= MAX_LEN);
  console.log(`Kelime havuzu (${MIN_LEN}-${MAX_LEN} harf): ${allWords.length}`);

  // Zaten işlenenler — anlamı boş olanlar da atlanır (bulunamamış kelimeler)
  const { data: existing } = await supabase
    .from('word_meanings')
    .select('word')
    .like('word', 'en:%');
  const done = new Set((existing || []).map(r => r.word));
  console.log(`Zaten kayıtlı: ${done.size}`);

  const toFetch = allWords.filter(w => !done.has(`en:${w}`));
  console.log(`Kalan: ${toFetch.length} kelime\n`);

  if (toFetch.length === 0) {
    console.log('Tüm kelimeler zaten kayıtlı!');
    return;
  }

  let supabaseBatch = [];
  let saved = 0;
  const start = Date.now();
  let processed = 0;

  for (let i = 0; i < toFetch.length; i += CONCURRENCY) {
    const chunk = toFetch.slice(i, i + CONCURRENCY);

    const meanings = await runConcurrent(chunk, fetchDictAPI, CONCURRENCY);

    for (let j = 0; j < chunk.length; j++) {
      supabaseBatch.push({ word: `en:${chunk[j]}`, meanings: meanings[j] });
    }
    processed += chunk.length;

    if (supabaseBatch.length >= BATCH_SIZE || i + CONCURRENCY >= toFetch.length) {
      const { error } = await supabase.from('word_meanings').upsert(supabaseBatch, { onConflict: 'word' });
      if (error) console.error('Supabase hatası:', error.message);
      saved += supabaseBatch.length;
      supabaseBatch = [];

      const elapsed = ((Date.now() - start) / 1000).toFixed(0);
      const rate    = (processed / ((Date.now() - start) / 1000)).toFixed(1);
      const remaining = rate > 0 ? Math.round((toFetch.length - processed) / rate) : '?';
      const pct = ((processed / toFetch.length) * 100).toFixed(1);
      process.stdout.write(
        `\r[${elapsed}s] ${processed}/${toFetch.length} (${pct}%) — ${rate} k/s — kalan ~${remaining}s   `
      );
    }

    await delay(BATCH_MS);
  }

  const total = ((Date.now() - start) / 1000).toFixed(0);
  console.log(`\n\nTamamlandı! ${saved} kelime ${total}s içinde işlendi.`);
}

main().catch(console.error);
