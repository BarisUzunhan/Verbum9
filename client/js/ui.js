import { state, formatTime, matrixComplete } from './game.js';

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

export function updateFillCell() {
  const tiles = document.querySelectorAll('#fill-matrix .tile');
  tiles.forEach((t, i) => {
    t.classList.toggle('active', i === state.activeFillCell);
    t.classList.toggle('filled', !!state.matrix[i]);
    t.textContent = state.matrix[i];
  });
  document.getElementById('btn-start-game').disabled = !matrixComplete();
}

// ─── Geri Sayım — timer kutusunda gösterilir, overlay yok ────

export function showCountdownOverlay(visible) {
  document.getElementById('countdown-overlay').hidden = true;
  const timerEl = document.getElementById('game-timer');
  timerEl.classList.toggle('countdown-mode', visible);
  if (!visible) {
    timerEl.classList.remove('countdown-mode');
    timerEl.getAnimations().forEach(a => a.cancel()); // animasyon birikimini temizle
  }
}

export function updateCountdown(n) {
  const timerEl = document.getElementById('game-timer');
  timerEl.textContent = n;
  timerEl.classList.add('countdown-mode');
  // Büyük çıkıp timer boyutuna yerleş
  timerEl.animate([
    { fontSize: 'clamp(4rem, 22vw, 7rem)', transform: 'scale(1.6)', opacity: 0.9,
      textShadow: '0 0 40px rgba(233,69,96,0.9)' },
    { fontSize: '2.4rem',                  transform: 'scale(1)',   opacity: 1,
      textShadow: '0 0 12px rgba(233,69,96,0.5)' },
  ], { duration: 900, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' });
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

  if (wordObj.valid) {
    const wordBtn = document.createElement('button');
    wordBtn.className = 'word-meaning-btn';
    wordBtn.textContent = wordObj.word;
    wordBtn.addEventListener('click', () =>
      document.dispatchEvent(new CustomEvent('verbum:show-meaning', { detail: { word: wordObj.word } }))
    );
    li.appendChild(wordBtn);
    const pts = document.createElement('span');
    pts.className = 'word-points';
    pts.textContent = `+${wordObj.points}`;
    li.appendChild(pts);
  } else {
    li.appendChild(document.createTextNode(wordObj.word));
    const btn = document.createElement('button');
    btn.className = 'btn-dispute';
    btn.dataset.word = wordObj.word.toLocaleLowerCase('tr-TR');
    btn.textContent = 'İtiraz Et';
    li.appendChild(btn);
  }

  list.insertBefore(li, list.firstChild);
}

// ─── Sonuç Ekranı ────────────────────────────────────────────

export function renderResult(missedWords = []) {
  document.getElementById('result-score-number').textContent = state.score;

  const list = document.getElementById('result-words-list');
  list.innerHTML = '';
  const sorted = [...state.submittedWords].sort((a, b) => b.points - a.points);
  sorted.forEach(w => {
    const li = document.createElement('li');
    li.className = w.valid ? 'valid' : 'invalid';
    if (w.valid) {
      const wordBtn = document.createElement('button');
      wordBtn.className = 'word-meaning-btn';
      wordBtn.textContent = w.word;
      wordBtn.addEventListener('click', () =>
        document.dispatchEvent(new CustomEvent('verbum:show-meaning', { detail: { word: w.word } }))
      );
      li.appendChild(wordBtn);
      const pts = document.createElement('span');
      pts.className = 'word-points';
      pts.textContent = `+${w.points}`;
      li.appendChild(pts);
    } else {
      li.appendChild(document.createTextNode(w.word));
      const btn = document.createElement('button');
      btn.className = 'btn-dispute';
      btn.dataset.word = w.word.toLocaleLowerCase('tr-TR');
      btn.textContent = 'İtiraz Et';
      li.appendChild(btn);
    }
    list.appendChild(li);
  });

  // Kaçırılan kelimeler — her zaman göster
  const missedSection = document.getElementById('result-missed-section');
  const missedList = document.getElementById('result-missed-list');
  missedList.innerHTML = '';
  missedSection.hidden = false;

  if (missedWords.length > 0) {
    const display = missedWords.slice(0, 100);
    const countLabel = missedWords.length > 100
      ? `${missedWords.length} kelime (ilk 100 gösteriliyor)`
      : `${missedWords.length} kelime`;
    document.getElementById('result-missed-count').textContent = countLabel;
    display.forEach(word => {
      const li = document.createElement('li');
      li.className = 'valid';
      const wordBtn = document.createElement('button');
      wordBtn.className = 'word-meaning-btn';
      wordBtn.textContent = word;
      wordBtn.addEventListener('click', () =>
        document.dispatchEvent(new CustomEvent('verbum:show-meaning', { detail: { word } }))
      );
      li.appendChild(wordBtn);
      const pts = document.createElement('span');
      pts.className = 'word-points';
      pts.textContent = word.length + ' harf';
      li.appendChild(pts);
      missedList.appendChild(li);
    });
  } else {
    document.getElementById('result-missed-count').textContent = '';
    const li = document.createElement('li');
    li.className = 'valid';
    li.style.opacity = '0.5';
    li.textContent = 'Tüm kelimeler bulundu!';
    missedList.appendChild(li);
  }
}

// ─── Kelimeler Paneli Toggle ─────────────────────────────────

export function toggleWordsPanel(forceOpen) {
  const panel = document.getElementById('words-panel');
  const isOpen = panel.classList.contains('open');
  const shouldOpen = forceOpen !== undefined ? forceOpen : !isOpen;
  panel.classList.toggle('open', shouldOpen);
}
