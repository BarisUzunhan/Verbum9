/**
 * İngilizce sözlük oluşturucu
 * Kaynak: ENABLE word list (open source, Scrabble standart)
 * Filtreler: 3-9 harf, a-z, düzensiz fiil çekimleri, -ing/-ed çekimleri
 * Çıktı: data/words_en.json  (Turkish words.json ile aynı format)
 */

const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');

const SOURCE_URL  = 'https://raw.githubusercontent.com/dolph/dictionary/master/enable1.txt';
const OUTPUT_PATH = path.join(__dirname, '../data/words_en.json');
const MIN_LEN = 3;
const MAX_LEN = 9;

// ─── Düzensiz fiil çekimleri — SADECE suffix kuralının yakalayamadığı formlar ──
// Kural: base formu 2 harf olan fiiller (go→going), veya tamamen farklı gövde (go→went).
// -ing ve -ed formları burada OLMAMALI — suffix kuralı onları yakalar.
// -ing noun'lar (building, morning) KEEP_ALWAYS'da korunur.
const IRREGULAR_FORMS = new Set([
  // be — base 2 harf, suffix kuralı yakalayamaz
  'am','is','are','was','were','been',
  // have/do — base 2 harf
  'has','had','does','did','done',
  // go — base 2 harf, suffix kuralı yakalayamaz
  'goes','went','gone','going',
  // be/do — base 2 harf
  'being','doing',
  // get/give — düzensiz geçmiş
  'gets','got','gotten','gives','gave','given',
  // come/make — düzensiz
  'comes','came','makes','made',
  // take/see
  'takes','took','taken','sees','saw','seen',
  // know/think/say
  'knows','knew','known','thinks','thought',
  'says','said',
  // find/tell/become
  'finds','found','tells','told','becomes','became',
  // show/leave/feel
  'shows','showed','shown','leaves','left','feels','felt',
  // put/bring/begin
  'puts','brings','brought','begins','began','begun',
  // keep/hold/write
  'keeps','kept','holds','held','writes','wrote','written',
  // stand/hear/let/mean/set/meet
  'stands','stood','hears','heard','lets',
  'means','meant','sets','meets','met',
  // run/pay/sit/speak
  'runs','ran','pays','paid','sits','sat',
  'speaks','spoke','spoken',
  // lie/lead/read/grow
  'lies','lay','lain','leads','led','grows','grew','grown',
  // lose/fall/send
  'loses','lost','falls','fell','fallen','sends','sent',
  // build/draw/break/spend — -ing formları KEEP_ALWAYS'da
  'builds','built','draws','drew','drawn',
  'breaks','broke','broken','spends','spent',
  // cut/rise/drive/buy
  'cuts','rises','rose','risen','drives','drove','driven',
  'buys','bought',
  // wear/choose/throw/eat/catch
  'wears','wore','worn','chooses','chose','chosen',
  'throws','threw','thrown','eats','ate','eaten',
  'catches','caught',
  // win/fight/teach/hit/sing
  'wins','won','fights','fought','teaches','taught',
  'hits','sings','sang','sung',
  // swim/sleep/drink/fly
  'swims','swam','swum','sleeps','slept',
  'drinks','drank','drunk','flies','flew','flown',
  // freeze/hide/bite/dig/shake
  'freezes','froze','frozen','hides','hid','hidden',
  'bites','bit','bitten','digs','dug',
  'shakes','shook','shaken',
  // steal/stick/strike/swing/wake/weep/wind
  'steals','stole','stolen','sticks','stuck',
  'strikes','struck','stricken','swings','swung',
  'wakes','woke','woken','weeps','wept',
  'winds','wound',
  // forget/forgive/bear
  'forgets','forgot','forgotten','forgives','forgave','forgiven',
  'bears','bore','borne',
  // sell
  'sells','sold',
  // arise/awake
  'arises','arose','arisen','awakes','awoke','awoken',
  // bind/bleed
  'binds','bound','bleeds','bled',
  // blow/breed
  'blows','blew','blown','breeds','bred',
  // cling/creep/deal
  'clings','clung','creeps','crept','deals','dealt',
  // dream/dwell
  'dreams','dreamt','dwells','dwelt',
  // feed/fling
  'feeds','fed','flings','flung',
  // forbid
  'forbids','forbade','forbidden',
  // grind/hang
  'grinds','ground','hangs','hung',
  // kneel/knit/lay
  'kneels','knelt','knits','lays','lain',
  // leap/learn/lend/light
  'leaps','leapt','learns','learnt','lends','lent','lights','lit',
  // mistake
  'mistakes','mistook','mistaken',
  // overcome/overtake
  'overcomes','overcame','overcoming','overtakes','overtook','overtaking',
  // prove/quit
  'proves','proved','proven','proving','quits','quitting',
  // ride/ring/seek
  'rides','rode','ridden','riding','rings','rang','rung','ringing',
  'seeks','sought','seeking',
  // shoot/shrink/shut
  'shoots','shot','shooting','shrinks','shrank','shrunk','shrinking','shuts','shutting',
  // slide/smell/speak
  'slides','slid','sliding','smells','smelt','smelling',
  // speed/spell/spill
  'speeds','sped','speeding','spells','spelt','spelling','spills','spilt','spilling',
  // spin/spit/split
  'spins','spun','spinning','spits','spat','spitting','splits','splitting',
  // spread/spring/steal
  'spreads','spread','spreading','springs','sprang','sprung','springing',
  // stride/strive/swear
  'strides','strode','striding','strives','strove','striven','striving',
  'swears','swore','sworn','swearing',
  // sweep/tear/tell
  'sweeps','swept','sweeping','tears','tore','torn','tearing',
  // thrust/tread/understand
  'thrusts','thrust','thrusting','treads','trod','trodden','treading',
  'understands','understood','understanding',
  // undo/upset/wake
  'undoes','undid','undone','undoing','upsets','upsetting',
  // withdraw/withstand/wring
  'withdraws','withdrew','withdrawn','withdrawing',
  'withstands','withstood','withstanding',
  'wrings','wrung','wringing',
]);

// Suffix kuralı yanlış filtreleyeceği halde KORUNMASI gereken kelimeler.
// Kriter: base form (kelime - ing/ed) wordSet'te var AMA kelime fiil değil isim/sıfat.
const KEEP_ALWAYS = new Set([
  // -ing ile biten isimler: base form wordSet'te olduğu için suffix kuralı yanlış filtreler
  'ceiling',  // ceil
  'morning',  // morn
  'evening',  // even
  'wedding',  // wed
  'blessing', // bless
  'opening',  // open
  'warning',  // warn
  'housing',  // house
  'training', // train
  'funding',  // fund
  'boarding', // board
  'building', // build
  'clothing', // cloth
  'meaning',  // mean
  'reading',  // read
  'drawing',  // draw
  'parking',  // park
  'banking',  // bank
  'farming',  // farm
  'meeting',  // meet
  'heading',  // head
  'painting', // paint
  'casting',  // cast
  'nursing',  // nurs→nurse
  'serving',  // serve
  'landing',  // land
  'finding',  // find → hm, but 'find' is base verb... landing/finding are ambiguous
  'planning', // plan
  'standing', // stand
  'spending', // spend → spending is a verb form, skip? keep for noun usage
  'printing', // print
  'coding',   // cod? no: code → codi? code+ing → coding. base = cod (in set?) or code
  'loading',  // load
  'hosting',  // host
  'testing',  // test
  'shopping', // shop
  'wedding',  // wed (already above)
  'bedding',  // bed
  'roofing',  // roof
  'flooring', // floor
  'piping',   // pipe
  'wiring',   // wire
  // -ed ile biten ama fiil çekimi olmayan kelimeler
  'red','bed','led','fed','wed','shed','fled','sled','shred',
  'speed','need','seed','weed','freed','greed','creed','tweed',
  'indeed','exceed','agreed','steed',
]);

function fetchURL(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        resolve(fetchURL(res.headers.location));
        return;
      }
      if (res.statusCode !== 200) { reject(new Error('HTTP ' + res.statusCode)); return; }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function isVerbConjugation(word, wordSet) {
  if (IRREGULAR_FORMS.has(word)) return true;  // önce düzensiz formlar — KEEP_ALWAYS'ı ezer
  if (KEEP_ALWAYS.has(word)) return false;

  const len = word.length;

  // -ing: walking→walk, making→make, running→run
  if (word.endsWith('ing') && len >= 5) {
    const b1 = word.slice(0, -3);
    const b2 = word.slice(0, -3) + 'e';
    const b3 = len >= 6 ? word.slice(0, -4) : null; // doubled consonant: running→run
    if (wordSet.has(b1) || wordSet.has(b2) || (b3 && wordSet.has(b3))) return true;
  }

  // -ed: walked→walk, liked→like, stopped→stop
  if (word.endsWith('ed') && len >= 5) {
    const b1 = word.slice(0, -2);
    const b2 = word.slice(0, -1);
    const b3 = len >= 6 && word[len - 3] === word[len - 4] ? word.slice(0, -3) : null;
    if (wordSet.has(b1) || wordSet.has(b2) || (b3 && wordSet.has(b3))) return true;
  }

  return false;
}

async function main() {
  console.log('İngilizce ENABLE kelime listesi indiriliyor...');
  const raw = await fetchURL(SOURCE_URL);

  const allWords = raw
    .split('\n')
    .map(w => w.trim().toLowerCase())
    .filter(w => w.length >= MIN_LEN && w.length <= MAX_LEN && /^[a-z]+$/.test(w));

  console.log(`3-9 harf aralığında toplam: ${allWords.length}`);

  const wordSet = new Set(allWords);

  console.log('Fiil çekimleri filtreleniyor...');
  const filtered = allWords.filter(w => !isVerbConjugation(w, wordSet));

  console.log(`Filtrelemeden sonra: ${filtered.length}`);

  const output = { words: filtered.sort(), homophones: [], blacklist: [] };
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output));
  console.log(`✓ Yazıldı: ${OUTPUT_PATH}`);

  // İstatistik
  const byLen = {};
  filtered.forEach(w => { byLen[w.length] = (byLen[w.length] || 0) + 1; });
  console.log('Uzunluğa göre dağılım:', byLen);
}

main().catch(e => { console.error('HATA:', e.message); process.exit(1); });
