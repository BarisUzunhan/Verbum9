import { loadDictionary, getWordArray } from './dictionary.js';
import { init as initTutorial, startLobby, startFill, startGame as startGameTutorial, startResult, showLobbyTutorial, onEnd as onTutorialEnd } from './tutorial.js';
import {
  state, PHASES,
  getRandomLetter, setFillLetter,
  addLetterToWord, addLetterByChar, removeLastLetter, clearCurrentWord,
  submitCurrentWord, findMissedWords,
  startCountdown, startGame, stopGame, restartTimer, resetToFill,
  setGameDuration,
} from './game.js';
import { playWordFound, playWarningBeep, playUrgentBeep, playInvalidWord, setSoundEnabled } from './sounds.js';
import {
  showScreen,
  renderFillMatrix, updateFillCell,
  showCountdownOverlay, updateCountdown,
  renderGameMatrix, updateGameMatrix,
  updateWordDisplay, showWordFeedback,
  updateTimer, updateScore, addWordToPanel,
  renderResult, toggleWordsPanel,
} from './ui.js';

// ─── Kullanıcı oturumu ────────────────────────────────────────

const TOKEN_KEY = 'verbum9_token';
let currentUser = null;

// ─── Çok oyunculu durum ───────────────────────────────────────

let mode = 'solo'; // 'solo' | 'multi'
const mp = { playerIndex: -1, turnIndex: -1, opponentName: '', myScore: 0, invalidWords: [] };

// io global olarak /socket.io/socket.io.js tarafından yüklenir
const socket = io({ autoConnect: false });

// ─── Wake Lock (ekran uyumasın) ───────────────────────────────

let _wakeLock = null;

async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try { _wakeLock = await navigator.wakeLock.request('screen'); } catch {}
}

function releaseWakeLock() {
  if (_wakeLock) { _wakeLock.release().catch(() => {}); _wakeLock = null; }
}

// ─── Toast bildirimi ─────────────────────────────────────────

let _toastTimer = null;

function showToast(msg, duration = 5000) {
  let el = document.getElementById('_toast');
  if (!el) {
    el = document.createElement('div');
    el.id = '_toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.display = '';
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { el.style.display = 'none'; }, duration);
}

async function apiFetch(method, url, body) {
  const token = localStorage.getItem(TOKEN_KEY);
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

async function fetchMe() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return null;
  const data = await apiFetch('GET', '/api/auth/me');
  return data.ok ? data.user : null;
}

// ─── Ayarlar durumu ──────────────────────────────────────────

let _soundEnabled = true;
let _gameDuration = 120;

function loadSettings() {
  const theme = localStorage.getItem('verbum9_theme') || 'dark';
  document.body.classList.toggle('light', theme === 'light');
  document.getElementById('btn-theme-dark').classList.toggle('active', theme !== 'light');
  document.getElementById('btn-theme-light').classList.toggle('active', theme === 'light');

  const sound = localStorage.getItem('verbum9_sound');
  _soundEnabled = sound !== '0';
  setSoundEnabled(_soundEnabled);
  document.getElementById('setting-sound').checked = _soundEnabled;

  const dur = 120;
  _gameDuration = 120;
  setGameDuration(_gameDuration);
  document.querySelectorAll('.duration-btn').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.dur) === _gameDuration);
  });
}

// ─── İpucu — satır içi görünüm ───────────────────────────────

function _displayHintInline(pattern) {
  const container = document.getElementById('word-letters');
  container.innerHTML = '';
  pattern.forEach(ch => {
    const box = document.createElement('div');
    box.className = 'letter-box hint-slot' + (ch ? ' hint-revealed' : '');
    box.textContent = ch || ' ';
    container.appendChild(box);
  });
  // Feedback alanında ipucu mesajı göster
  const fb = document.getElementById('word-feedback');
  fb.className = 'word-feedback hint-info';
  fb.textContent = `💡 ${pattern.length} harfli bir kelime`;
  document.getElementById('btn-submit').disabled = true;
}

function bindHintEvents() {
  document.getElementById('btn-hint').addEventListener('click', () => {
    if (state.phase !== PHASES.PLAYING) return;

    if (mode === 'solo') {
      const missed = findMissedWords();
      if (missed.length === 0) { showToast('Başka kelime bulunamadı!', 3000); return; }
      const word = missed[Math.floor(Math.random() * Math.min(missed.length, 30))];
      const wordU = word.toLocaleUpperCase('tr-TR');
      const positions = [...Array(wordU.length).keys()].sort(() => Math.random() - 0.5);
      const revealSet = new Set(positions.slice(0, 2));
      const pattern = [...wordU].map((ch, i) => revealSet.has(i) ? ch : null);
      clearCurrentWord();
      updateGameMatrix();
      _displayHintInline(pattern);
    } else {
      socket.emit('use_hint');
    }
  });
}

// ─── Kelime Paneli Gestürleri ─────────────────────────────────

function bindWordsPanelGestures() {
  const panel = document.getElementById('words-panel');

  // Sağa kaydırınca kapat
  let _swipeX = 0;
  panel.addEventListener('touchstart', e => { _swipeX = e.touches[0].clientX; }, { passive: true });
  panel.addEventListener('touchend', e => {
    if (e.changedTouches[0].clientX - _swipeX > 60) toggleWordsPanel(false);
  }, { passive: true });

  // Oyun alanına (panel ve toggle butonu dışı) tıklayınca kapat
  const toggleBtn = document.getElementById('btn-toggle-words');
  document.getElementById('screen-game').addEventListener('click', e => {
    if (!panel.classList.contains('open')) return;
    if (panel.contains(e.target)) return;
    if (toggleBtn.contains(e.target)) return; // toggle butonu kendi handler'ını çağırır
    toggleWordsPanel(false);
  });
}

// ─── Çıkış onayı ─────────────────────────────────────────────

let _exitOrigin = '';

function showExitConfirm(origin) {
  _exitOrigin = origin;
  document.getElementById('exit-confirm').hidden = false;
}

function hideExitConfirm() {
  document.getElementById('exit-confirm').hidden = true;
}

function doExit() {
  hideExitConfirm();
  clearInterval(_localTimerInterval);
  removeGameEvents();
  releaseWakeLock();
  if (mode === 'multi') {
    socket.emit('leave_game'); // kasıtlı çıkış — pendingReconnects'e düşmesin
    socket.disconnect();
    mode = 'solo';
  } else if (_exitOrigin === 'game') {
    stopGame();
  }
  state.phase = PHASES.LOBBY;
  renderLobby();
  showScreen('screen-lobby');
}

function bindExitEvents() {
  document.getElementById('btn-exit-fill').addEventListener('click', () => showExitConfirm('fill'));
  document.getElementById('btn-exit-game').addEventListener('click', () => showExitConfirm('game'));
  document.getElementById('btn-exit-yes').addEventListener('click', doExit);
  document.getElementById('btn-exit-no').addEventListener('click', hideExitConfirm);
  document.getElementById('exit-confirm-backdrop').addEventListener('click', hideExitConfirm);
}

// ─── Ayarlar paneli ───────────────────────────────────────────

function openSettings() {
  // Süre satırı: solo'da ve multi admin'de görünür, oyun sırasında gizli
  const canChangeDuration = mode !== 'multi' || (mp.playerIndex === 0 && state.phase === PHASES.FILL);
  document.getElementById('settings-duration-row').hidden = !canChangeDuration;

  // Mevcut değerleri yansıt
  const isLight = document.body.classList.contains('light');
  document.getElementById('btn-theme-dark').classList.toggle('active', !isLight);
  document.getElementById('btn-theme-light').classList.toggle('active', isLight);
  document.getElementById('setting-sound').checked = _soundEnabled;
  document.querySelectorAll('.duration-btn').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.dur) === _gameDuration);
  });

  document.getElementById('settings-popup').hidden = false;
}

function closeSettings() {
  document.getElementById('settings-popup').hidden = true;
}

function bindSettingsEvents() {
  document.getElementById('btn-close-settings').addEventListener('click', closeSettings);
  document.getElementById('settings-backdrop').addEventListener('click', closeSettings);
  document.getElementById('btn-settings-lobby').addEventListener('click', openSettings);
  document.getElementById('btn-settings-fill').addEventListener('click', openSettings);
  document.getElementById('btn-settings-game').addEventListener('click', openSettings);

  // Tema
  document.querySelectorAll('[data-theme]').forEach(btn => {
    btn.addEventListener('click', () => {
      const isLight = btn.dataset.theme === 'light';
      document.body.classList.toggle('light', isLight);
      localStorage.setItem('verbum9_theme', isLight ? 'light' : 'dark');
      document.getElementById('btn-theme-dark').classList.toggle('active', !isLight);
      document.getElementById('btn-theme-light').classList.toggle('active', isLight);
    });
  });

  // Ses
  document.getElementById('setting-sound').addEventListener('change', e => {
    _soundEnabled = e.target.checked;
    setSoundEnabled(_soundEnabled);
    localStorage.setItem('verbum9_sound', _soundEnabled ? '1' : '0');
  });

  // Süre — sabit 2 dakika, butonlar pasif
  document.querySelectorAll('.duration-btn').forEach(btn => {
    btn.disabled = true;
  });

  // Tutorial
  document.getElementById('btn-show-tutorial').addEventListener('click', () => {
    closeSettings();
    showLobbyTutorial();
  });
}

// ─── Demo Oyunu ───────────────────────────────────────────────

const DEMO_MATRIX = ['K', 'İ', 'T', 'A', 'P', 'L', 'İ', 'K', 'A'];
let _isDemoMode = false;

function startDemoGame() {
  _isDemoMode = true;
  mode = 'solo';

  clearInterval(_localTimerInterval);
  _soloGameEndTime = null;
  _soloOnEnd = null;
  _soloTickCb = null;

  resetToFill();
  state.matrix = [...DEMO_MATRIX];
  state.phase = PHASES.PLAYING;
  clearCurrentWord();

  document.getElementById('multi-result').hidden = true;
  document.getElementById('result-words-section').hidden = false;

  renderGameMatrix(onTileClick);
  updateWordDisplay();
  updateTimer(120);
  updateScore();
  document.getElementById('words-list').innerHTML = '';
  document.getElementById('score-value').textContent = '0';
  document.getElementById('words-count-value').textContent = '0';
  document.getElementById('btn-extend-time').hidden = true;
  showCountdownOverlay(false);

  showScreen('screen-game');
  bindGameEvents();
  requestWakeLock();
  setTimeout(() => startGameTutorial(), 100);
}

function endDemoGame() {
  if (!_isDemoMode) return;
  _isDemoMode = false;

  clearInterval(_localTimerInterval);
  state.phase = PHASES.RESULT;
  removeGameEvents();
  releaseWakeLock();

  const missed = findMissedWords();
  renderResult(missed);
  showScreen('screen-result');
  setTimeout(() => startResult(), 100);
}

// ─── Başlatma ────────────────────────────────────────────────

async function init() {
  await loadDictionary();
  loadSettings();
  bindAuth();
  bindLobbyEvents();
  bindWaitingEvents();
  bindProfile();
  bindResultEvents();
  bindWordsPanelGestures();
  bindHintEvents();
  bindExitEvents();
  bindSettingsEvents();
  initTutorial();
  onTutorialEnd('lobby', startDemoGame);
  onTutorialEnd('game', endDemoGame);

  const user = await fetchMe();
  if (user) {
    currentUser = user;
    renderLobby();
    showScreen('screen-lobby');
    startLobby();
  } else {
    showScreen('screen-auth');
  }
}

// ─── Giriş / Kayıt ───────────────────────────────────────────

let _pendingUsername = '';

function showAuthPending(email) {
  document.getElementById('form-login').hidden = true;
  document.getElementById('form-register').hidden = true;
  document.getElementById('auth-forgot').hidden = true;
  document.getElementById('auth-pending').hidden = false;
  const emailEl = document.getElementById('auth-pending-email');
  if (email) {
    const [local, domain] = email.split('@');
    emailEl.textContent = local[0] + '***@' + domain;
  } else {
    emailEl.textContent = '';
  }
  setAuthError('');
}

function showAuthForgot() {
  document.getElementById('form-login').hidden = true;
  document.getElementById('form-register').hidden = true;
  document.getElementById('auth-pending').hidden = true;
  document.getElementById('auth-forgot').hidden = false;
  // Formu sıfırla (daha önce gönderilmiş olabilir)
  document.getElementById('form-forgot').hidden = false;
  document.getElementById('forgot-email').value = '';
  document.getElementById('auth-forgot-desc').textContent =
    'Kayıtlı e-posta adresini gir, sana sıfırlama bağlantısı gönderelim.';
  setAuthError('');
}

function showAuthLogin() {
  document.getElementById('auth-pending').hidden = true;
  document.getElementById('auth-forgot').hidden = true;
  document.getElementById('form-register').hidden = true;
  document.getElementById('form-login').hidden = false;
  setAuthError('');
}

function bindAuth() {
  document.getElementById('btn-to-register').addEventListener('click', () => {
    document.getElementById('form-login').hidden = true;
    document.getElementById('form-register').hidden = false;
    setAuthError('');
  });
  document.getElementById('btn-to-login').addEventListener('click', showAuthLogin);
  document.getElementById('btn-pending-to-login').addEventListener('click', showAuthLogin);
  document.getElementById('btn-to-forgot').addEventListener('click', showAuthForgot);
  document.getElementById('btn-forgot-to-login').addEventListener('click', showAuthLogin);

  document.getElementById('form-forgot').addEventListener('submit', async e => {
    e.preventDefault();
    const email = document.getElementById('forgot-email').value.trim();
    if (!email) return;
    setAuthError('');
    const btn = document.getElementById('btn-forgot-submit');
    btn.disabled = true;
    btn.textContent = 'Gönderiliyor...';
    try {
      const data = await apiFetch('POST', '/api/auth/forgot-password', { email });
      if (data.ok) {
        document.getElementById('form-forgot').style.display = 'none';
        document.getElementById('auth-forgot-desc').textContent =
          'Kayıtlı bir hesap varsa sıfırlama bağlantısı gönderildi. Spam klasörünü de kontrol et.';
      } else {
        setAuthError(data.error || 'Bir hata oluştu.');
      }
    } catch {
      setAuthError('Bağlantı hatası. Lütfen tekrar dene.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Gönder';
    }
  });

  document.getElementById('btn-resend').addEventListener('click', async () => {
    const btn = document.getElementById('btn-resend');
    btn.disabled = true;
    btn.textContent = 'Gönderiliyor...';
    const data = await apiFetch('POST', '/api/auth/resend-verification', { username: _pendingUsername });
    btn.disabled = false;
    btn.textContent = data.ok ? '✓ Gönderildi' : 'Tekrar Gönder';
    if (!data.ok) setTimeout(() => { btn.textContent = 'Tekrar Gönder'; }, 3000);
  });

  document.getElementById('form-login').addEventListener('submit', async e => {
    e.preventDefault();
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    setAuthError('');
    const btn = document.getElementById('btn-login');
    btn.disabled = true;
    const data = await apiFetch('POST', '/api/auth/login', { username, password });
    btn.disabled = false;
    if (data.ok) {
      localStorage.setItem(TOKEN_KEY, data.token);
      currentUser = data.user;
      renderLobby();
      showScreen('screen-lobby');
      const isNewUser = localStorage.getItem('verbum9_new_user');
      if (isNewUser) {
        localStorage.removeItem('verbum9_new_user');
        showLobbyTutorial();
      } else {
        startLobby();
      }
    } else if (data.code === 'email_not_verified') {
      _pendingUsername = data.username || username;
      showAuthPending(null);
    } else {
      setAuthError(data.error);
    }
  });

  document.getElementById('form-register').addEventListener('submit', async e => {
    e.preventDefault();
    const username = document.getElementById('reg-username').value.trim();
    const email    = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-password').value;
    setAuthError('');
    const btn = document.getElementById('btn-register');
    btn.disabled = true;
    const data = await apiFetch('POST', '/api/auth/register', { username, email, password });
    btn.disabled = false;
    if (data.ok && data.pending) {
      _pendingUsername = username;
      localStorage.setItem('verbum9_new_user', '1');
      showAuthPending(email);
    } else if (!data.ok) {
      setAuthError(data.error);
    }
  });
}

function setAuthError(msg) {
  document.getElementById('auth-error').textContent = msg;
}

// ─── Lobi ────────────────────────────────────────────────────

function bindLobbyEvents() {
  document.getElementById('btn-profile').addEventListener('click', openProfile);
  document.getElementById('mode-solo').addEventListener('click', goToFill);
  document.getElementById('mode-1v1').addEventListener('click', goToOnline);
}

function renderLobby() {
  if (!currentUser) return;
  const initial = currentUser.username[0].toLocaleUpperCase('tr-TR');
  document.getElementById('lobby-avatar').textContent = initial;
  document.getElementById('lobby-username').textContent = currentUser.username;
  document.getElementById('lobby-level').textContent = `Sv. ${currentUser.level}`;
  document.getElementById('lobby-stat-level').textContent = currentUser.level;
  document.getElementById('lobby-stat-score').textContent = currentUser.totalScore;
  document.getElementById('lobby-stat-kl').textContent = currentUser.klBalance;
  // Fill ve oyun ekranı mini avatar'larını güncelle
  document.getElementById('fill-nav-avatar').textContent = initial;
  document.getElementById('game-nav-avatar').textContent = initial;
}

function goToFill() {
  mode = 'solo';
  resetToFill();
  // fill ekranı elemanlarını solo moda döndür
  document.getElementById('fill-turn-banner').hidden = true;
  document.getElementById('btn-random-all').style.display = '';
  document.getElementById('btn-start-game').style.display = '';
  document.getElementById('btn-settings-fill').hidden = false;
  const hint = document.getElementById('fill-hint');
  if (hint) hint.style.display = '';
  // çok oyunculu sonuç bölümünü gizle
  document.getElementById('multi-result').hidden = true;
  document.getElementById('result-words-section').hidden = false;
  renderFillMatrix(onFillCellClick);
  bindFillEvents();
  showScreen('screen-fill');
  setTimeout(() => startFill(), 100);
}

// ─── 1v1 Online ──────────────────────────────────────────────

function goToOnline() {
  mode = 'multi';
  mp.myScore = 0;
  socket.auth = { token: localStorage.getItem(TOKEN_KEY) };
  document.getElementById('waiting-status').textContent = 'Rakip aranıyor...';
  showScreen('screen-waiting');
  if (socket.connected) {
    socket.emit('join_queue', { name: currentUser.username });
  }
  socket.connect();
}

function bindWaitingEvents() {
  document.getElementById('btn-cancel-queue').addEventListener('click', () => {
    socket.emit('leave_queue');
    socket.disconnect();
    mode = 'solo';
    showScreen('screen-lobby');
  });
}

// ─── Socket olayları ─────────────────────────────────────────

socket.on('connect', () => {
  if (mode === 'multi' && currentUser) {
    const waiting = document.getElementById('screen-waiting');
    if (waiting && waiting.classList.contains('active')) {
      socket.emit('join_queue', { name: currentUser.username });
    }
  }
});

socket.on('queued', () => {
  document.getElementById('waiting-status').textContent = 'Sırada bekleniyor...';
});

socket.on('matched', ({ opponentName, playerIndex, turnIndex }) => {
  mp.playerIndex = playerIndex;
  mp.turnIndex = turnIndex;
  mp.opponentName = opponentName;
  mp.myScore = 0;
  mp.invalidWords = [];

  state.matrix = Array(9).fill('');
  state.activeFillCell = -1;
  state.phase = PHASES.FILL;

  renderFillMatrix(onFillCellClickMulti);
  updateFillTurnBanner();
  document.getElementById('fill-turn-banner').hidden = false;
  document.getElementById('btn-random-all').style.display = 'none';
  document.getElementById('btn-start-game').style.display = 'none';
  document.getElementById('fill-hint').style.display = 'none';
  document.getElementById('btn-settings-fill').hidden = mp.playerIndex !== 0;
  bindFillEventsMulti();
  showScreen('screen-fill');
  setTimeout(() => startFill(), 100);
});

socket.on('cell_filled', ({ matrix, turnIndex }) => {
  state.matrix = matrix;
  mp.turnIndex = turnIndex;
  updateFillCell();
  updateFillTurnBanner();
});

socket.on('countdown_tick', ({ n }) => {
  // Sesli harf popup'ı açıksa kapat (3s gecikmeden sonra geri sayım başladı)
  const vp = document.getElementById('vowel-popup');
  if (vp && !vp.hidden) vp.hidden = true;

  if (state.phase !== PHASES.COUNTDOWN) {
    state.phase = PHASES.COUNTDOWN;
    unbindFillKeyboard();
    document.getElementById('fill-turn-banner').hidden = true;
    renderGameMatrix(onTileClick);
    updateWordDisplay();
    updateTimer(_gameDuration);
    updateScore();
    document.getElementById('words-list').innerHTML = '';
    showScreen('screen-game');
    showCountdownOverlay(true);
  }
  updateCountdown(n);
  playWarningBeep();
});

socket.on('game_start', () => {
  state.phase = PHASES.PLAYING;
  showCountdownOverlay(false);
  updateTimer(_gameDuration);
  document.getElementById('btn-extend-time').hidden = false;
  bindGameEvents();
  requestWakeLock();
  setTimeout(() => startGameTutorial(), 100);
});

// Sunucudan tick gelmezse (mobil arka plan) yerel sayaç devam ettirir
let _localTimerInterval = null;
let _lastTick = null; // { serverTime, wallTime } — çok oyunculu tick senkronizasyonu için

// Solo: duvar saatiyle süre takibi — ekran kapalıyken timer donmasın
let _soloGameEndTime = null; // Date.now() + süre (ms)
let _soloOnEnd = null;       // oyun sonu callback
let _soloTickCb = null;      // timer tick callback (restartTimer için)

function _playTimerSound(t) {
  if (t === 20 || t === 15) playWarningBeep();
  else if (t > 0 && t <= 10) playUrgentBeep();
}

socket.on('timer_tick', ({ timeLeft }) => {
  clearInterval(_localTimerInterval);
  updateTimer(timeLeft);
  _playTimerSound(timeLeft);
  _lastTick = { serverTime: timeLeft, wallTime: Date.now() };
  let t = timeLeft - 1;
  _localTimerInterval = setInterval(() => {
    if (t >= 0) { updateTimer(t); _playTimerSound(t); t--; }
    else clearInterval(_localTimerInterval);
  }, 1000);
});

// Ekran yeniden açıldığında: süreyi duvar saatiyle senkronize et / gerekirse oyunu bitir
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || state.phase !== PHASES.PLAYING) return;

  // ─ Solo: duvar saatiyle kalan süreyi hesapla ─────────────────
  if (mode !== 'multi' && _soloGameEndTime) {
    const remaining = Math.max(0, Math.floor((_soloGameEndTime - Date.now()) / 1000));
    if (remaining === 0) {
      // Ekran kapalıyken süre doldu → interval'ı durdur, oyunu bitir
      stopGame();
      state.phase = PHASES.RESULT;
      const cb = _soloOnEnd;
      _soloOnEnd = null;
      _soloGameEndTime = null;
      _soloTickCb = null;
      if (cb) cb();
      return;
    }
    // Süre dolmamış → eski interval'ı iptal et, kalan süreden yeniden başlat
    restartTimer(remaining, _soloTickCb || (s => updateTimer(s)), _soloOnEnd || (() => {}));
    updateTimer(remaining);
    return;
  }

  // ─ Çok oyunculu: socket kopmuşsa yeniden bağlan ──────────────
  if (mode === 'multi' && !socket.connected) {
    socket.connect();
    return; // sunucudan gelecek game_over veya reconnected_to_game'i bekle
  }

  // ─ Çok oyunculu: socket bağlı, yerel sayacı senkronize et ────
  if (!_lastTick) return;
  clearInterval(_localTimerInterval);
  const elapsed = Math.floor((Date.now() - _lastTick.wallTime) / 1000);
  const estimated = Math.max(0, _lastTick.serverTime - elapsed);
  updateTimer(estimated);
  _lastTick = { serverTime: estimated, wallTime: Date.now() };
  let t = estimated - 1;
  _localTimerInterval = setInterval(() => {
    if (t >= 0) { updateTimer(t); _playTimerSound(t); t--; }
    else clearInterval(_localTimerInterval);
  }, 1000);
});

socket.on('word_result', result => {
  if (result.status === 'valid') playWordFound();
  else if (result.status === 'invalid') playInvalidWord();
  showWordFeedback(result.status, result.word, result.points);
  clearCurrentWord();
  updateGameMatrix();
  updateWordDisplay();
  if (result.status === 'valid') {
    mp.myScore += result.points;
    document.getElementById('score-value').textContent = mp.myScore;
    document.getElementById('words-count-value').textContent =
      parseInt(document.getElementById('words-count-value').textContent || '0') + 1;
    addWordToPanel({ word: result.word, points: result.points, valid: true });
  } else if (result.status === 'invalid' || result.status === 'duplicate') {
    addWordToPanel({ word: result.word, points: 0, valid: false });
    mp.invalidWords.push(result.word);
  }
});

socket.on('game_over', async ({ players }) => {
  // Oyun aktif değilse (eski önbellek sonucu vs.) yok say
  if (state.phase !== PHASES.PLAYING && state.phase !== PHASES.COUNTDOWN) return;
  clearInterval(_localTimerInterval);
  state.phase = PHASES.RESULT;
  removeGameEvents();
  releaseWakeLock();

  // Her iki oyuncunun bulduğu geçerli kelimeler
  const allFound = new Set([
    ...players[0].words.map(w => w.word.toLocaleLowerCase('tr-TR')),
    ...players[1].words.map(w => w.word.toLocaleLowerCase('tr-TR')),
  ]);
  const missed = _findMissedForMatrix(state.matrix, allFound);

  renderResultMulti(players, missed);
  showScreen('screen-result');
  setTimeout(() => startResult(), 100);
  // Sunucu istatistikleri yazdıktan sonra profili güncelle
  const fresh = await fetchMe();
  if (fresh) { currentUser = fresh; renderLobby(); }
});

socket.on('opponent_left', () => {
  clearInterval(_localTimerInterval);
  removeGameEvents();
  releaseWakeLock();
  state.phase = PHASES.RESULT;
  document.getElementById('multi-result-header').textContent = `${mp.opponentName} bağlantıyı kesti — sen kazandın!`;
  document.getElementById('multi-result-header').className = 'multi-result-header win';
  document.getElementById('multi-result').hidden = false;
  document.getElementById('result-words-section').hidden = true;
  document.getElementById('result-missed-section').hidden = true;
  showScreen('screen-result');
  socket.disconnect();
  mode = 'solo';
});

socket.on('opponent_disconnected', ({ timeLeft }) => {
  showToast(`${mp.opponentName} bağlantısı kesildi. Oynamaya devam et — süre bitince sonuç açıklanır.`, Math.min(timeLeft * 1000, 8000));
});

socket.on('opponent_reconnected', () => {
  showToast(`${mp.opponentName} geri döndü!`, 3000);
});

socket.on('hint_result', async ({ ok, pattern, error }) => {
  if (!ok) { showToast(error, 4000); return; }
  clearCurrentWord();
  updateWordDisplay();
  _displayHintInline(pattern);
  // Sunucudan güncel KL bakiyesini çek
  const fresh = await fetchMe();
  if (fresh) { currentUser = fresh; renderLobby(); }
});

socket.on('duration_changed', ({ duration }) => {
  _gameDuration = duration;
  setGameDuration(duration);
  localStorage.setItem('verbum9_duration', duration);
  document.querySelectorAll('.duration-btn').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.dur) === duration);
  });
  const label = duration === 120 ? '2' : duration === 300 ? '5' : '3';
  showToast(`Oyun süresi ${label} dakika olarak ayarlandı.`, 3000);
});

socket.on('reconnected_to_game', ({ phase, matrix, turnIndex, timeLeft, playerIndex, opponentName, myWords, myScore }) => {
  mp.playerIndex = playerIndex;
  mp.turnIndex = turnIndex;
  mp.opponentName = opponentName;
  mp.myScore = myScore;
  state.matrix = matrix;

  if (phase === 'fill') {
    state.phase = PHASES.FILL;
    renderFillMatrix(onFillCellClickMulti);
    updateFillTurnBanner();
    document.getElementById('fill-turn-banner').hidden = false;
    document.getElementById('btn-random-all').style.display = 'none';
    document.getElementById('btn-start-game').style.display = 'none';
    document.getElementById('fill-hint').style.display = 'none';
    document.getElementById('btn-settings-fill').hidden = mp.playerIndex !== 0;
    bindFillEventsMulti();
    showScreen('screen-fill');
  } else if (phase === 'playing') {
    state.phase = PHASES.PLAYING;
    renderGameMatrix(onTileClick);
    clearInterval(_localTimerInterval);
    updateTimer(timeLeft);
    let t = timeLeft - 1;
    _localTimerInterval = setInterval(() => {
      if (t >= 0) { updateTimer(t); t--; }
      else clearInterval(_localTimerInterval);
    }, 1000);
    document.getElementById('score-value').textContent = myScore;
    const ul = document.getElementById('words-list');
    ul.innerHTML = '';
    myWords.forEach(({ word, points }) => addWordToPanel({ word, points, valid: true }));
    document.getElementById('words-count-value').textContent = myWords.length;
    showCountdownOverlay(false);
    showScreen('screen-game');
    bindGameEvents();
    requestWakeLock();
  }
  showToast('Bağlantı yeniden kuruldu!', 3000);
});

// ─── Matristeki harflerle kurulabilecek ama yazılmayan kelimeler ─────────────

function _findMissedForMatrix(matrix, foundSet) {
  const mc = {};
  for (const l of matrix) if (l) mc[l] = (mc[l] || 0) + 1;
  const possible = [];
  for (const word of getWordArray()) {
    if (foundSet.has(word)) continue;
    const wordU = word.toLocaleUpperCase('tr-TR');
    const needed = {};
    for (const ch of wordU) needed[ch] = (needed[ch] || 0) + 1;
    let ok = true;
    for (const ch in needed) {
      if ((mc[ch] || 0) < needed[ch]) { ok = false; break; }
    }
    if (ok) possible.push(word);
  }
  return possible.sort((a, b) => b.length - a.length || a.localeCompare(b, 'tr'));
}

// ─── Çok oyunculu doldurma ───────────────────────────────────

function updateFillTurnBanner() {
  const banner = document.getElementById('fill-turn-banner');
  const myTurn = mp.turnIndex === mp.playerIndex;
  banner.textContent = myTurn ? '⬤ Senin sıran — bir hücre seç ve harf gir' : `⬤ ${mp.opponentName} seçiyor...`;
  banner.className = 'fill-turn-banner ' + (myTurn ? 'my-turn' : 'opponent-turn');
}

function onFillCellClickMulti(pos) {
  if (mp.turnIndex !== mp.playerIndex) return;
  if (state.matrix[pos]) return;
  state.activeFillCell = pos;
  updateFillCell();
  // Mobil klavyeyi aç
  const inp = document.getElementById('fill-keyboard-input');
  inp.style.pointerEvents = 'auto';
  inp.focus();
}

function bindFillEventsMulti() {
  document.removeEventListener('keydown', onFillKeydown);
  document.removeEventListener('keydown', onFillKeydownMulti);
  document.addEventListener('keydown', onFillKeydownMulti);

  document.getElementById('btn-random-one').onclick = () => {
    if (mp.turnIndex !== mp.playerIndex) return;
    const pos = (state.activeFillCell >= 0 && state.activeFillCell < 9 && state.matrix[state.activeFillCell] === '')
      ? state.activeFillCell
      : state.matrix.findIndex(l => l === '');
    if (pos >= 0) socket.emit('fill_cell', { pos, letter: getRandomLetter() });
  };

  // ⌨ butonu: klavyeyi aç (mobil)
  const fillKbBtn = document.getElementById('btn-fill-keyboard');
  fillKbBtn.style.display = '';
  fillKbBtn.onclick = () => {
    const inp = document.getElementById('fill-keyboard-input');
    inp.style.pointerEvents = 'auto';
    inp.focus();
  };

  // Gizli input — mobil klavyeden harf al
  const fillInp = document.getElementById('fill-keyboard-input');
  if (!fillInp._bound) {
    fillInp._bound = true;
    fillInp.addEventListener('blur', () => { fillInp.style.pointerEvents = 'none'; });
    fillInp.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); fillInp.blur(); }
    });
    fillInp.addEventListener('input', () => {
      if (state.phase !== PHASES.FILL || mp.turnIndex !== mp.playerIndex) { fillInp.value = ''; return; }
      const ch = fillInp.value.slice(-1);
      fillInp.value = '';
      if (!ch || !VALID_LETTERS.test(ch)) return;
      const pos = (state.activeFillCell >= 0 && state.activeFillCell < 9 && state.matrix[state.activeFillCell] === '')
        ? state.activeFillCell : state.matrix.findIndex(l => l === '');
      if (pos < 0) return;
      state.activeFillCell = pos;
      socket.emit('fill_cell', { pos, letter: normalizeLetter(ch) });
    });
  }
}

function unbindFillKeyboard() {
  document.getElementById('btn-fill-keyboard').style.display = 'none';
  document.getElementById('fill-keyboard-input').blur();
}

function onFillKeydownMulti(e) {
  if (state.phase !== PHASES.FILL) return;
  if (mp.turnIndex !== mp.playerIndex) return;
  if (!VALID_LETTERS.test(e.key) || e.ctrlKey || e.metaKey) return;
  e.preventDefault();
  // Seçili hücre yoksa veya doluysa ilk boş hücreyi otomatik seç
  let pos = state.activeFillCell;
  if (pos < 0 || pos >= 9 || state.matrix[pos] !== '') {
    pos = state.matrix.findIndex(l => l === '');
  }
  if (pos < 0) return;
  state.activeFillCell = pos;
  socket.emit('fill_cell', { pos, letter: normalizeLetter(e.key) });
}

// ─── Çok oyunculu sonuç ───────────────────────────────────────

function renderResultMulti(players, missedWords = []) {
  const my = players[mp.playerIndex];
  const op = players[1 - mp.playerIndex];
  const opWordSet = new Set(op.words.map(w => w.word.toLocaleLowerCase('tr-TR')));

  // Kazanan başlık
  const header = document.getElementById('multi-result-header');
  if (my.score > op.score) {
    header.textContent = `Kazandın! ${my.score} — ${op.score}`;
    header.className = 'multi-result-header win';
  } else if (op.score > my.score) {
    header.textContent = `Kaybettin. ${my.score} — ${op.score}`;
    header.className = 'multi-result-header lose';
  } else {
    header.textContent = `Berabere! ${my.score} — ${op.score}`;
    header.className = 'multi-result-header draw';
  }

  document.getElementById('result-score-number').textContent = my.score;
  document.getElementById('multi-my-name').textContent = my.name;
  document.getElementById('multi-op-name').textContent = op.name;

  function fillWordList(ulId, words, commonSet) {
    const ul = document.getElementById(ulId);
    ul.innerHTML = '';
    words.forEach(({ word, points }) => {
      const li = document.createElement('li');
      const isCommon = commonSet.has(word.toLocaleLowerCase('tr-TR'));
      li.className = isCommon ? 'valid common' : 'valid';
      li.appendChild(document.createTextNode(word));
      const pts = document.createElement('span');
      pts.className = 'word-points';
      pts.textContent = isCommon ? '=' : `+${points}`;
      li.appendChild(pts);
      ul.appendChild(li);
    });
  }

  const myWordSet = new Set(my.words.map(w => w.word.toLocaleLowerCase('tr-TR')));
  fillWordList('multi-my-words', my.words, opWordSet);
  fillWordList('multi-op-words', op.words, myWordSet);

  // Geçersiz kelimeler — itiraz butonu ile göster
  if (mp.invalidWords.length > 0) {
    const myList = document.getElementById('multi-my-words');
    mp.invalidWords.forEach(word => {
      const li = document.createElement('li');
      li.className = 'invalid';
      li.appendChild(document.createTextNode(word));
      const btn = document.createElement('button');
      btn.className = 'btn-dispute';
      btn.dataset.word = word.toLocaleLowerCase('tr-TR');
      btn.textContent = 'İtiraz Et';
      li.appendChild(btn);
      myList.appendChild(li);
    });
  }

  document.getElementById('multi-result').hidden = false;
  document.getElementById('result-words-section').hidden = true;

  // Kaçırılan kelimeler
  const missedSection = document.getElementById('result-missed-section');
  const missedList = document.getElementById('result-missed-list');
  missedList.innerHTML = '';
  missedSection.hidden = false;
  if (missedWords.length > 0) {
    const display = missedWords.slice(0, 100);
    document.getElementById('result-missed-count').textContent =
      missedWords.length > 100
        ? `${missedWords.length} kelime (ilk 100 gösteriliyor)`
        : `${missedWords.length} kelime`;
    display.forEach(word => {
      const li = document.createElement('li');
      li.className = 'valid';
      li.appendChild(document.createTextNode(word));
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

  socket.disconnect();
  mode = 'solo';
}

// ─── Matris Doldurma ─────────────────────────────────────────

const VALID_LETTERS = /^[a-zA-ZçÇğĞıIiİöÖşŞüÜ]$/;

function bindFillEvents() {
  document.removeEventListener('keydown', onFillKeydown);
  document.addEventListener('keydown', onFillKeydown);

  document.getElementById('btn-random-one').onclick = () => {
    const pos = state.activeFillCell < 9 ? state.activeFillCell : state.matrix.findIndex(l => !l);
    if (pos >= 0 && pos < 9) {
      setFillLetter(pos, getRandomLetter());
      state.activeFillCell = Math.min(pos + 1, 9);
      updateFillCell();
    }
  };

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
  return map[key] || key.toLocaleUpperCase('tr-TR');
}

// ─── Geri Sayım → Oyun ───────────────────────────────────────

const _VOWELS_SET = new Set(['A', 'E', 'I', 'İ', 'O', 'Ö', 'U', 'Ü']);
const _VOWELS_ARR = ['A', 'E', 'İ', 'I', 'O', 'U', 'Ö', 'Ü'];

function beginCountdown() {
  document.removeEventListener('keydown', onFillKeydown);

  // Hiç sesli harf yoksa 2 rastgele sessiz harfi sesli harfle değiştir
  const hasVowel = state.matrix.some(l => _VOWELS_SET.has(l));
  if (!hasVowel) {
    const positions = [...Array(9).keys()]
      .sort(() => Math.random() - 0.5)
      .slice(0, 2);
    const added = positions.map(pos => {
      const v = _VOWELS_ARR[Math.floor(Math.random() * _VOWELS_ARR.length)];
      setFillLetter(pos, v);
      return v;
    });
    updateFillCell();
    showVowelPopup(
      `Tabloda hiç sesli harf yoktu. ${added[0]} ve ${added[1]} harfleri rastgele eklendi.`,
      _startCountdown
    );
    return;
  }

  _startCountdown();
}

function _startCountdown() {
  renderGameMatrix(onTileClick);
  updateWordDisplay();
  updateTimer(_gameDuration);
  updateScore();
  document.getElementById('words-list').innerHTML = '';

  showScreen('screen-game');
  showCountdownOverlay(true);

  startCountdown(
    n => { updateCountdown(n); playWarningBeep(); },
    () => {
      showCountdownOverlay(false);
      updateTimer(_gameDuration);
      bindGameEvents();
      requestWakeLock();
      setTimeout(() => startGameTutorial(), 100);

      const _onSoloEnd = () => {
        _soloGameEndTime = null;
        _soloOnEnd = null;
        _soloTickCb = null;
        removeGameEvents();
        releaseWakeLock();
        const missed = findMissedWords();
        renderResult(missed);
        showScreen('screen-result');
        setTimeout(() => startResult(), 100);
      };
      const _tick = seconds => updateTimer(seconds);
      _soloOnEnd = _onSoloEnd;
      _soloTickCb = _tick;
      _soloGameEndTime = Date.now() + _gameDuration * 1000;

      startGame(_tick, _onSoloEnd);
    }
  );
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
  if (mode === 'multi') {
    const word = state.currentWordCells.map(i => state.matrix[i]).join('');
    socket.emit('submit_word', { word });
    // sonucu socket.on('word_result') alır
    return;
  }
  const result = submitCurrentWord();
  showWordFeedback(result.status, result.word, result.points);
  updateGameMatrix();
  updateWordDisplay();
  updateScore();
  if (result.status === 'valid' || result.status === 'invalid') {
    addWordToPanel({ word: result.word, points: result.points, valid: result.status === 'valid' });
  }
}

let _gameEventsBound = false;

function bindGameEvents() {
  if (_gameEventsBound) return;
  _gameEventsBound = true;

  document.getElementById('btn-submit').onclick = onSubmit;
  document.getElementById('btn-backspace').onclick = () => { removeLastLetter(); updateGameMatrix(); updateWordDisplay(); };
  document.getElementById('btn-clear').onclick = () => { clearCurrentWord(); updateGameMatrix(); updateWordDisplay(); };
  document.getElementById('btn-toggle-words').onclick = () => toggleWordsPanel();
  document.getElementById('btn-close-words').onclick = () => toggleWordsPanel(false);
  document.getElementById('btn-extend-time').onclick = () => {
    if (mode !== 'multi') return;
    socket.emit('request_extension');
    document.getElementById('btn-extend-time').disabled = true; // tek kullanım
  };
  document.addEventListener('keydown', onGameKeydown);

  const kbInput = document.getElementById('game-keyboard-input');
  document.getElementById('btn-keyboard').onclick = () => {
    kbInput.style.pointerEvents = 'auto';
    kbInput.focus();
  };
  if (!kbInput._bound) {
    kbInput._bound = true;
    kbInput.addEventListener('blur', () => { kbInput.style.pointerEvents = 'none'; });
    kbInput.addEventListener('keydown', e => {
      if (state.phase !== PHASES.PLAYING) return;
      if (e.key === 'Enter') { e.preventDefault(); onSubmit(); }
      if (e.key === 'Backspace') {
        e.preventDefault();
        removeLastLetter(); updateGameMatrix(); updateWordDisplay();
        kbInput.value = '';
      }
      if (e.key === 'Escape') { e.preventDefault(); clearCurrentWord(); updateGameMatrix(); updateWordDisplay(); }
    });
    kbInput.addEventListener('input', () => {
      if (state.phase !== PHASES.PLAYING) return;
      const v = kbInput.value;
      kbInput.value = '';
      for (const ch of v) {
        if (VALID_LETTERS.test(ch)) {
          const added = addLetterByChar(normalizeLetter(ch));
          if (added) { updateGameMatrix(); updateWordDisplay(); }
        }
      }
    });
  }
}

function removeGameEvents() {
  if (!_gameEventsBound) return;
  _gameEventsBound = false;
  document.removeEventListener('keydown', onGameKeydown);
  document.getElementById('btn-extend-time').hidden = true;
  const kbInput = document.getElementById('game-keyboard-input');
  if (kbInput) kbInput.blur();
}

function onGameKeydown(e) {
  if (state.phase !== PHASES.PLAYING) return;
  if (e.key === 'Enter') { e.preventDefault(); onSubmit(); }
  if (e.key === 'Backspace') { e.preventDefault(); removeLastLetter(); updateGameMatrix(); updateWordDisplay(); }
  if (e.key === 'Escape') { e.preventDefault(); clearCurrentWord(); updateGameMatrix(); updateWordDisplay(); }
  if (VALID_LETTERS.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    const added = addLetterByChar(normalizeLetter(e.key));
    if (added) { updateGameMatrix(); updateWordDisplay(); }
  }
}

// ─── İtiraz ──────────────────────────────────────────────────

async function disputeWord(word, btn) {
  btn.disabled = true;
  btn.textContent = '...';
  try {
    const res = await fetch('/api/disputes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ word }),
    });
    if (res.ok) {
      btn.textContent = '✓ İtiraz edildi';
    } else {
      const data = await res.json().catch(() => ({}));
      btn.textContent = data.error === 'Bu kelime zaten itirazda.' ? '✓ Zaten itiraz var' : 'Hata';
      btn.disabled = false;
    }
  } catch {
    btn.textContent = 'Hata';
    btn.disabled = false;
  }
}

document.addEventListener('click', e => {
  if (e.target.matches('.btn-dispute')) {
    disputeWord(e.target.dataset.word, e.target);
  }
});

// ─── Sesli harf popup ────────────────────────────────────────

function showVowelPopup(msg, onOk = null) {
  const popup = document.getElementById('vowel-popup');
  document.getElementById('vowel-popup-text').textContent = msg;
  popup.hidden = false;
  document.getElementById('btn-vowel-ok').onclick = () => {
    popup.hidden = true;
    if (onOk) onOk();
  };
}

// ─── Süre uzatma popup ───────────────────────────────────────

function showExtensionPopup(fromName) {
  const popup = document.getElementById('extension-popup');
  document.getElementById('extension-popup-text').textContent =
    `${fromName} oyunu 30 saniye uzatmak istiyor. Kabul ediyor musunuz?`;
  popup.hidden = false;
  document.getElementById('btn-extension-yes').onclick = () => {
    popup.hidden = true;
    socket.emit('extension_response', { accept: true });
  };
  document.getElementById('btn-extension-no').onclick = () => {
    popup.hidden = true;
    socket.emit('extension_response', { accept: false });
  };
}

// ─── Çok oyunculu: uzatma socket olayları ────────────────────

socket.on('matrix_fixed', ({ matrix, changed }) => {
  state.matrix = matrix;
  if (state.phase === PHASES.FILL) {
    updateFillCell();
    if (changed && changed.length > 0) {
      const [a, b] = changed.map(c => c.vowel);
      showVowelPopup(
        `Tabloda hiç sesli harf yoktu. ${a} ve ${b} harfleri rastgele eklendi.`
      );
      // countdown_tick 3 saniye sonra gelir; o zaman popup otomatik kapanır
    }
  }
});

socket.on('extension_requested', ({ fromName }) => {
  showExtensionPopup(fromName);
});

socket.on('extension_accepted', ({ newTimeLeft }) => {
  clearInterval(_localTimerInterval);
  updateTimer(newTimeLeft);
  _lastTick = { serverTime: newTimeLeft, wallTime: Date.now() };
  let t = newTimeLeft - 1;
  _localTimerInterval = setInterval(() => {
    if (t >= 0) { updateTimer(t); _playTimerSound(t); t--; }
    else clearInterval(_localTimerInterval);
  }, 1000);
  showToast(`${mp.opponentName} kabul etti — +30 saniye eklendi!`, 3000);
});

socket.on('extension_rejected', () => {
  showToast('Rakibiniz süre uzatmayı reddetti.', 3000);
});

socket.on('extension_pending_offline', () => {
  showToast('Anlık bağlantı hatası var, rakibin bağlanınca isteğini ileteceğiz.', 6000);
});

// ─── Sonuç Ekranı Olayları ───────────────────────────────────

function bindResultEvents() {
  document.getElementById('btn-again').addEventListener('click', goToFill);
  document.getElementById('btn-to-lobby').addEventListener('click', () => {
    renderLobby();
    showScreen('screen-lobby');
  });
}

// ─── Profil Popup ─────────────────────────────────────────────

function openProfile() {
  if (!currentUser) return;
  const initial = currentUser.username[0].toLocaleUpperCase('tr-TR');
  document.getElementById('profile-avatar-big').textContent = initial;
  document.getElementById('profile-username-display').textContent = currentUser.username;
  document.getElementById('profile-email-display').textContent = currentUser.email || '';
  const _pd = currentUser.createdAt ? new Date(currentUser.createdAt) : null;
  document.getElementById('profile-date-display').textContent = _pd
    ? `Kayıt: ${_pd.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })}`
    : '';
  document.getElementById('profile-level-value').textContent = currentUser.level;
  document.getElementById('profile-score').textContent = currentUser.totalScore;
  document.getElementById('profile-kl').textContent = currentUser.klBalance;
  document.getElementById('profile-games').textContent = currentUser.gamesPlayed;
  document.getElementById('profile-wins').textContent = currentUser.gamesWon;
  document.getElementById('profile-losses').textContent =
    Math.max(0, (currentUser.gamesPlayed || 0) - (currentUser.gamesWon || 0));
  document.getElementById('profile-popup').hidden = false;
}

function closeProfile() {
  document.getElementById('profile-popup').hidden = true;
}

function bindProfile() {
  document.getElementById('profile-backdrop').addEventListener('click', closeProfile);
  document.getElementById('btn-close-profile').addEventListener('click', closeProfile);
  document.getElementById('btn-logout').addEventListener('click', () => {
    localStorage.removeItem(TOKEN_KEY);
    currentUser = null;
    closeProfile();
    showScreen('screen-auth');
  });
}

// ─── Sekme kapanınca / sayfa yenilenince kasıtlı çıkış bildir ─

window.addEventListener('beforeunload', () => {
  if (mode === 'multi' && socket.connected) {
    socket.volatile.emit('leave_game');
  }
});

// ─── Başlat ──────────────────────────────────────────────────

init();
