import { isValidWord, isHomophone } from './dictionary.js';
import { playWordFound, playWarningBeep, playUrgentBeep, playInvalidWord } from './sounds.js';

export const PHASES = {
  LOBBY: 'lobby',
  FILL: 'fill',
  COUNTDOWN: 'countdown',
  PLAYING: 'playing',
  RESULT: 'result',
};

// Türkçe harf frekanslarına göre ağırlıklı havuz
const LETTER_POOL =
  'AAAAAAAAAAAEEEEEEEEEIIIIIIIINNNNNNNTTTTTTTKKKKKKLLLLLLRRRRRRMMMMMSSSSYYYYOOOODDDBBBUUUÜÜÇÇÇÖÖSŞZZHĞĞPPFVCGVAC';

const GAME_DURATION = 180;
const COUNTDOWN_START = 5;

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
  return LETTER_POOL[Math.floor(Math.random() * LETTER_POOL.length)];
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
  if (word.length < 2) return { status: 'short' };

  const wordLower = word.toLocaleLowerCase('tr-TR');
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
  state.countdownValue = COUNTDOWN_START;
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
  state.timeLeft = GAME_DURATION;
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

export function resetToFill() {
  stopGame();
  state.phase = PHASES.FILL;
  state.matrix = Array(9).fill('');
  state.activeFillCell = 0;
  state.currentWordCells = [];
  state.submittedWords = [];
  state.score = 0;
  state.timeLeft = GAME_DURATION;
}

export function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
