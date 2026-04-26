let wordSet = new Set();
let homophoneSet = new Set();
let wordArray = [];

export async function loadDictionary() {
  const res = await fetch('/data/words.json');
  const data = await res.json();
  wordArray = data.words;
  wordSet = new Set(wordArray.map(w => w.toLocaleLowerCase('tr-TR')));
  homophoneSet = new Set((data.homophones || []).map(w => w.toLocaleLowerCase('tr-TR')));
}

export function isValidWord(word) {
  return wordSet.has(word.toLocaleLowerCase('tr-TR'));
}

export function isHomophone(word) {
  return homophoneSet.has(word.toLocaleLowerCase('tr-TR'));
}

export function getWordArray() {
  return wordArray;
}

export function dictionarySize() {
  return wordSet.size;
}
