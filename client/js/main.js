import { loadDictionary } from './dictionary.js';
import {
  state, PHASES,
  getRandomLetter, setFillLetter,
  addLetterToWord, removeLastLetter, clearCurrentWord,
  submitCurrentWord,
  startCountdown, startGame, resetToFill,
} from './game.js';
import {
  showScreen,
  renderFillMatrix, updateFillCell, updateCountdown,
  renderGameMatrix, updateGameMatrix,
  updateWordDisplay, showWordFeedback,
  updateTimer, updateScore, addWordToPanel,
  renderResult, toggleWordsPanel,
} from './ui.js';

// ─── Başlatma ────────────────────────────────────────────────

async function init() {
  await loadDictionary();
  bindLobby();
  showScreen('screen-lobby');
}

// ─── Lobi ────────────────────────────────────────────────────

function bindLobby() {
  document.getElementById('btn-play').addEventListener('click', goToFill);
}

function goToFill() {
  resetToFill();
  renderFillMatrix(onFillCellClick);
  bindFillEvents();
  showScreen('screen-fill');
}

// ─── Matris Doldurma ─────────────────────────────────────────

const VALID_LETTERS = /^[a-zA-ZçÇğĞıIiİöÖşŞüÜ]$/;

function bindFillEvents() {
  document.removeEventListener('keydown', onFillKeydown);
  document.addEventListener('keydown', onFillKeydown);

  document.getElementById('btn-random-all').onclick = () => {
    for (let i = 0; i < 9; i++) {
      if (!state.matrix[i]) setFillLetter(i, getRandomLetter());
    }
    state.activeFillCell = 9;
    updateFillCell();
  };

  document.getElementById('btn-start-game').onclick = beginCountdown;
}

function onFillCellClick(pos) {
  state.activeFillCell = pos;
  updateFillCell();
}

function onFillKeydown(e) {
  if (state.phase !== PHASES.FILL) return;

  if (e.key === 'Backspace') {
    e.preventDefault();
    const pos = state.activeFillCell > 0 ? state.activeFillCell - 1 : 0;
    state.activeFillCell = pos;
    setFillLetter(pos, '');
    updateFillCell();
    return;
  }

  if (!VALID_LETTERS.test(e.key)) return;
  if (state.activeFillCell >= 9) return;

  e.preventDefault();
  const letter = normalizeLetter(e.key);
  setFillLetter(state.activeFillCell, letter);
  state.activeFillCell = Math.min(state.activeFillCell + 1, 9);
  updateFillCell();
}

function normalizeLetter(key) {
  const map = { i: 'İ', ı: 'I' };
  const k = map[key] || key.toLocaleUpperCase('tr-TR');
  return k;
}

// ─── Geri Sayım → Oyun ───────────────────────────────────────

function beginCountdown() {
  document.removeEventListener('keydown', onFillKeydown);
  showScreen('screen-countdown');
  startCountdown(n => updateCountdown(n), startPlayPhase);
}

function startPlayPhase() {
  updateCountdown(0);
  renderGameMatrix(onTileClick);
  updateWordDisplay();
  updateTimer(180);
  updateScore();
  document.getElementById('words-list').innerHTML = '';
  bindGameEvents();

  setTimeout(() => {
    showScreen('screen-game');
    startGame(
      seconds => updateTimer(seconds),
      () => {
        removeGameEvents();
        renderResult();
        showScreen('screen-result');
      }
    );
  }, 600);
}

// ─── Oyun Etkileşimi ─────────────────────────────────────────

function onTileClick(index) {
  if (state.phase !== PHASES.PLAYING) return;
  const added = addLetterToWord(index);
  if (added) {
    updateGameMatrix();
    updateWordDisplay();
  }
}

function onSubmit() {
  if (state.currentWordCells.length < 2) return;
  const result = submitCurrentWord();
  showWordFeedback(result.status, result.word, result.points);
  updateGameMatrix();
  updateWordDisplay();
  updateScore();
  if (result.status === 'valid' || result.status === 'invalid') {
    addWordToPanel({ word: result.word, points: result.points, valid: result.status === 'valid' });
  }
}

function bindGameEvents() {
  document.getElementById('btn-submit').addEventListener('click', onSubmit);
  document.getElementById('btn-backspace').addEventListener('click', () => {
    removeLastLetter();
    updateGameMatrix();
    updateWordDisplay();
  });
  document.getElementById('btn-clear').addEventListener('click', () => {
    clearCurrentWord();
    updateGameMatrix();
    updateWordDisplay();
  });
  document.getElementById('btn-toggle-words').addEventListener('click', () => toggleWordsPanel());
  document.getElementById('btn-close-words').addEventListener('click', () => toggleWordsPanel(false));
  document.addEventListener('keydown', onGameKeydown);
}

function removeGameEvents() {
  document.removeEventListener('keydown', onGameKeydown);
}

function onGameKeydown(e) {
  if (state.phase !== PHASES.PLAYING) return;
  if (e.key === 'Enter') { e.preventDefault(); onSubmit(); }
  if (e.key === 'Backspace') { e.preventDefault(); removeLastLetter(); updateGameMatrix(); updateWordDisplay(); }
  if (e.key === 'Escape') { e.preventDefault(); clearCurrentWord(); updateGameMatrix(); updateWordDisplay(); }
}

// ─── Tekrar Oyna ─────────────────────────────────────────────

document.getElementById('btn-again').addEventListener('click', goToFill);

// ─── Başlat ──────────────────────────────────────────────────

init();
