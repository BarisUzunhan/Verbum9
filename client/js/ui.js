import { state, formatTime, getRandomLetter, setFillLetter, matrixComplete } from './game.js';

// ─── Ekran geçişi ────────────────────────────────────────────

export function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ─── Matris Doldurma Ekranı ──────────────────────────────────

export function renderFillMatrix(onCellClick) {
  const grid = document.getElementById('fill-matrix');
  grid.innerHTML = '';
  for (let i = 0; i < 9; i++) {
    const tile = document.createElement('div');
    tile.className = 'tile';
    tile.dataset.pos = i;
    tile.textContent = state.matrix[i];
    if (i === state.activeFillCell) tile.classList.add('active');
    if (state.matrix[i]) tile.classList.add('filled');
    tile.addEventListener('click', () => onCellClick(i));
    grid.appendChild(tile);
  }
  document.getElementById('btn-start-game').disabled = !matrixComplete();
}

export function updateFillCell(pos) {
  const tiles = document.querySelectorAll('#fill-matrix .tile');
  tiles.forEach((t, i) => {
    t.classList.toggle('active', i === state.activeFillCell);
    t.classList.toggle('filled', !!state.matrix[i]);
    t.textContent = state.matrix[i];
  });
  document.getElementById('btn-start-game').disabled = !matrixComplete();
}

// ─── Geri Sayım ─────────────────────────────────────────────

export function updateCountdown(n) {
  document.getElementById('countdown-number').textContent = n === 0 ? 'BAŞLA!' : n;
}

// ─── Oyun Matrisi ────────────────────────────────────────────

export function renderGameMatrix(onTileClick) {
  const grid = document.getElementById('game-matrix');
  grid.innerHTML = '';
  for (let i = 0; i < 9; i++) {
    const tile = document.createElement('div');
    tile.className = 'tile';
    tile.dataset.index = i;
    tile.textContent = state.matrix[i];
    tile.addEventListener('click', () => onTileClick(i));
    grid.appendChild(tile);
  }
}

export function updateGameMatrix() {
  const tiles = document.querySelectorAll('#game-matrix .tile');
  tiles.forEach((t, i) => {
    t.classList.toggle('used', state.currentWordCells.includes(i));
  });
}

// ─── Kelime Ekranı ───────────────────────────────────────────

export function updateWordDisplay() {
  const container = document.getElementById('word-letters');
  container.innerHTML = '';
  state.currentWordCells.forEach(pos => {
    const box = document.createElement('div');
    box.className = 'letter-box';
    box.textContent = state.matrix[pos];
    container.appendChild(box);
  });

  document.getElementById('btn-submit').disabled = state.currentWordCells.length < 2;
  clearWordFeedback();
}

export function showWordFeedback(status, word = '', points = 0) {
  const el = document.getElementById('word-feedback');
  el.className = 'word-feedback ' + status;

  const messages = {
    valid: `✓ ${word} (+${points})`,
    invalid: `✗ ${word} — sözlükte yok`,
    duplicate: `${word} zaten yazıldı`,
    short: 'En az 2 harf gerekli',
  };
  el.textContent = messages[status] || '';

  clearTimeout(el._timeout);
  el._timeout = setTimeout(clearWordFeedback, 2000);
}

function clearWordFeedback() {
  const el = document.getElementById('word-feedback');
  el.textContent = '';
  el.className = 'word-feedback';
}

// ─── Zamanlayıcı & Skor ──────────────────────────────────────

export function updateTimer(seconds) {
  const el = document.getElementById('game-timer');
  el.textContent = formatTime(seconds);
  el.classList.toggle('warning', seconds <= 20 && seconds > 10);
  el.classList.toggle('urgent', seconds <= 10);
}

export function updateScore() {
  document.getElementById('score-value').textContent = state.score;
  document.getElementById('words-count-value').textContent =
    state.submittedWords.filter(w => w.valid).length;
}

// ─── Kelimeler Listesi ───────────────────────────────────────

export function addWordToPanel(wordObj) {
  const list = document.getElementById('words-list');
  const li = document.createElement('li');
  li.className = wordObj.valid ? 'valid' : 'invalid';

  const wordText = document.createTextNode(wordObj.word);
  li.appendChild(wordText);

  if (wordObj.valid) {
    const pts = document.createElement('span');
    pts.className = 'word-points';
    pts.textContent = `+${wordObj.points}`;
    li.appendChild(pts);
  }

  list.insertBefore(li, list.firstChild);
}

// ─── Sonuç Ekranı ────────────────────────────────────────────

export function renderResult() {
  document.getElementById('result-score-number').textContent = state.score;

  const list = document.getElementById('result-words-list');
  list.innerHTML = '';

  const sorted = [...state.submittedWords].sort((a, b) => b.points - a.points);
  sorted.forEach(w => {
    const li = document.createElement('li');
    li.className = w.valid ? 'valid' : 'invalid';

    li.appendChild(document.createTextNode(w.word));

    if (w.valid) {
      const pts = document.createElement('span');
      pts.className = 'word-points';
      pts.textContent = `+${w.points}`;
      li.appendChild(pts);
    }

    list.appendChild(li);
  });
}

// ─── Kelimeler Paneli Toggle ─────────────────────────────────

export function toggleWordsPanel(forceOpen) {
  const panel = document.getElementById('words-panel');
  const isOpen = panel.classList.contains('open');
  const shouldOpen = forceOpen !== undefined ? forceOpen : !isOpen;
  panel.classList.toggle('open', shouldOpen);
}
