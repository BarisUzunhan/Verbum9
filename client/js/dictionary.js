let wordSet = new Set();
let homophoneSet = new Set();
let blacklistSet = new Set();
let wordArray = [];
let _locale = 'tr-TR';

const LANG_LOCALE = { tr: 'tr-TR', en: 'en-US', de: 'de-DE', es: 'es-ES', fr: 'fr-FR', pt: 'pt-BR' };

export async function loadDictionary(lang = 'tr') {
  await _loadForLang(lang);
}

export async function switchDictionary(lang) {
  await _loadForLang(lang);
}

async function _loadForLang(lang) {
  const file = lang === 'tr' ? '/data/words.json' : `/data/words_${lang}.json`;
  const locale = LANG_LOCALE[lang] || 'en-US';
  _locale = locale;
  const res = await fetch(file);
  const data = await res.json();
  wordArray = data.words;
  wordSet      = new Set(wordArray.map(w => w.toLocaleLowerCase(locale)));
  homophoneSet = new Set((data.homophones || []).map(w => w.toLocaleLowerCase(locale)));
  blacklistSet = new Set((data.blacklist  || []).map(w => w.toLocaleLowerCase(locale)));
}

export function isValidWord(word) {
  const w = word.toLocaleLowerCase(_locale);
  return wordSet.has(w) && !blacklistSet.has(w);
}

export function isHomophone(word) {
  return homophoneSet.has(word.toLocaleLowerCase(_locale));
}

export function getWordArray() {
  return wordArray;
}

export function dictionarySize() {
  return wordSet.size;
}
