import { isValidWord, isHomophone, getWordArray } from './dictionary.js';
import { playWordFound, playWarningBeep, playUrgentBeep, playInvalidWord } from './sounds.js';

export const PHASES = {
  LOBBY: 'lobby',
  FILL: 'fill',
  COUNTDOWN: 'countdown',
  PLAYING: 'playing',
  RESULT: 'result',
};

const LANG_CONFIGS = {
  tr: {
    letterPool: 'AAAAAAAAAAAEEEEEEEEEIIIIIIIINNNNNNNTTTTTTTKKKKKKLLLLLLRRRRRRMMMMMSSSSYYYYOOOODDDBBBUUUÜÜÇÇÇÖÖSŞZZHĞĞPPFVCGVAC',
    locale: 'tr-TR',
    minLength: 1,
    vowels: ['A', 'E', 'I', 'İ', 'O', 'Ö', 'U', 'Ü'],
  },
  en: {
    letterPool: 'EEEEEEEEEEEEEAAAAAAAAOOOOOOOOTTTTTTTTTIIIIIIIINNNNNNNSSSSSSHHHHHHRRRRRRDDDDDLLLLLLCCCUUUMMMWWWFFGGYYPBBVK',
    locale: 'en-US',
    minLength: 1,
    vowels: ['A', 'E', 'I', 'O', 'U'],
  },
};

let _activeLang = localStorage.getItem('verbum_lang') || 'tr';

export function setActiveLang(lang) {
  _activeLang = LANG_CONFIGS[lang] ? lang : 'tr';
  localStorage.setItem('verbum_lang', _activeLang);
}
// Grup oyunu sırasında geçici dil değişimi — localStorage'a kaydetmez
export function setActiveLangTemp(lang) {
  _activeLang = LANG_CONFIGS[lang] ? lang : 'tr';
}
export function getActiveLang() { return _activeLang; }
export function getActiveLangConfig() { return LANG_CONFIGS[_activeLang] || LANG_CONFIGS['tr']; }

// Backwards compat — single-player fill still uses Turkish pool
const LETTER_POOL =
  'AAAAAAAAAAAEEEEEEEEEIIIIIIIINNNNNNNTTTTTTTKKKKKKLLLLLLRRRRRRMMMMMSSSSYYYYOOOODDDBBBUUUÜÜÇÇÇÖÖSŞZZHĞĞPPFVCGVAC';

const GAME_DURATION = 180;
const COUNTDOWN_START = 5;

let currentDuration = GAME_DURATION;
export function setGameDuration(d) { currentDuration = d; }

export const state = {
  phase: PHASES.LOBBY,
  matrix: Array(9).fill(''),
  activeFillCell: 0,
  currentWordCells: [],
  submittedWords: [],
  score: 0,
  timeLeft: GAME_DURATION,
  _timerInterval: null,
};

export function getRandomLetter() {
  const pool = getActiveLangConfig().letterPool;
  return pool[Math.floor(Math.random() * pool.length)];
}

export function setFillLetter(pos, letter) {
  state.matrix[pos] = letter;
}

export function matrixComplete() {
  return state.matrix.every(l => l !== '');
}

export function addLetterToWord(cellIndex) {
  if (state.currentWordCells.includes(cellIndex)) return false;
  if (!state.matrix[cellIndex]) return false;
  state.currentWordCells.push(cellIndex);
  return true;
}

export function addLetterByChar(upperChar) {
  for (let i = 0; i < 9; i++) {
    if (state.matrix[i] === upperChar && !state.currentWordCells.includes(i)) {
      return addLetterToWord(i);
    }
  }
  return false;
}

export function removeLastLetter() {
  state.currentWordCells.pop();
}

export function clearCurrentWord() {
  state.currentWordCells = [];
}

export function getCurrentWord() {
  return state.currentWordCells.map(i => state.matrix[i]).join('');
}

export function submitCurrentWord() {
  const word = getCurrentWord();
  const { locale, minLength } = getActiveLangConfig();
  if (word.length < minLength) return { status: 'short' };

  const wordLower = word.toLocaleLowerCase(locale);
  const alreadyCount = state.submittedWords.filter(w => w.word === word).length;
  const maxAllowed = isHomophone(wordLower) ? 2 : 1;
  if (alreadyCount >= maxAllowed) {
    clearCurrentWord();
    return { status: 'duplicate' };
  }

  const valid = isValidWord(wordLower);
  const points = valid ? word.length : 0;
  state.submittedWords.push({ word, points, valid });

  if (valid) {
    state.score += points;
    playWordFound();
  } else {
    playInvalidWord();
  }

  clearCurrentWord();
  return { status: valid ? 'valid' : 'invalid', points, word };
}

export function startCountdown(onTick, onDone) {
  state.phase = PHASES.COUNTDOWN;
  onTick(COUNTDOWN_START);

  let count = COUNTDOWN_START;
  const iv = setInterval(() => {
    count--;
    if (count <= 0) {
      clearInterval(iv);
      onDone();
    } else {
      onTick(count);
    }
  }, 1000);
}

export function startGame(onTimerTick, onGameEnd) {
  state.phase = PHASES.PLAYING;
  state.timeLeft = currentDuration;
  state.score = 0;
  state.submittedWords = [];
  clearCurrentWord();

  state._timerInterval = setInterval(() => {
    state.timeLeft--;
    onTimerTick(state.timeLeft);

    if (state.timeLeft === 20 || state.timeLeft === 15) {
      playWarningBeep();
    } else if (state.timeLeft > 0 && state.timeLeft <= 10) {
      playUrgentBeep();
    }

    if (state.timeLeft <= 0) {
      clearInterval(state._timerInterval);
      state.phase = PHASES.RESULT;
      onGameEnd();
    }
  }, 1000);
}

export function stopGame() {
  if (state._timerInterval) clearInterval(state._timerInterval);
}

// Ekran açıldığında kalan süreyle interval'ı yeniden başlat
export function restartTimer(seconds, onTimerTick, onGameEnd) {
  if (state._timerInterval) clearInterval(state._timerInterval);
  state.timeLeft = seconds;
  state._timerInterval = setInterval(() => {
    state.timeLeft--;
    onTimerTick(state.timeLeft);
    if (state.timeLeft === 20 || state.timeLeft === 15) playWarningBeep();
    else if (state.timeLeft > 0 && state.timeLeft <= 10) playUrgentBeep();
    if (state.timeLeft <= 0) {
      clearInterval(state._timerInterval);
      state.phase = PHASES.RESULT;
      onGameEnd();
    }
  }, 1000);
}

export function resetToFill() {
  stopGame();
  state.phase = PHASES.FILL;
  state.matrix = Array(9).fill('');
  state.activeFillCell = 0;
  state.currentWordCells = [];
  state.submittedWords = [];
  state.score = 0;
  state.timeLeft = currentDuration;
}

export function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ─── Matristeki harflerle kurulabilecek kelimeleri bul ────────

export function findMissedWords() {
  const { locale } = getActiveLangConfig();
  const matrixCounts = {};
  for (const letter of state.matrix) {
    if (letter) matrixCounts[letter] = (matrixCounts[letter] || 0) + 1;
  }

  const foundLower = new Set(
    state.submittedWords.filter(w => w.valid).map(w => w.word.toLocaleLowerCase(locale))
  );

  const possible = [];
  for (const word of getWordArray()) {
    if (foundLower.has(word)) continue;

    const wordUpper = word.toLocaleUpperCase(locale);
    const needed = {};
    for (const ch of wordUpper) {
      needed[ch] = (needed[ch] || 0) + 1;
    }

    let ok = true;
    for (const ch in needed) {
      if ((matrixCounts[ch] || 0) < needed[ch]) { ok = false; break; }
    }

    if (ok) possible.push(word);
  }

  return possible.sort((a, b) => b.length - a.length || a.localeCompare(b, locale));
}
