import { loadDictionary, getWordArray, switchDictionary } from './dictionary.js';
import { t, applyLang, setI18nLang } from './i18n.js';
import { init as initTutorial, startLobby, startFill, startGame as startGameTutorial, startResult, showLobbyTutorial, onEnd as onTutorialEnd, end as endTutorial } from './tutorial.js';
import {
  state, PHASES,
  getRandomLetter, setFillLetter,
  addLetterToWord, addLetterByChar, removeLastLetter, clearCurrentWord,
  submitCurrentWord, findMissedWords,
  startCountdown, startGame, stopGame, restartTimer, resetToFill,
  setGameDuration,
  setActiveLang, setActiveLangTemp, getActiveLang, getActiveLangConfig,
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

let mode = 'solo'; // 'solo' | 'multi' | 'daily'
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

function applyColorTheme(name) {
  ['nebula', 'ember', 'crt-green', 'crt-amber'].forEach(t => {
    document.body.classList.remove('theme-' + t);
  });
  if (name && name !== 'default') {
    document.body.classList.add('theme-' + name);
  }
}

function loadSettings() {
  const theme = localStorage.getItem('verbum9_theme') || 'dark';
  document.body.classList.toggle('light', theme === 'light');
  document.getElementById('btn-theme-dark').classList.toggle('active', theme !== 'light');
  document.getElementById('btn-theme-light').classList.toggle('active', theme === 'light');

  applyLang(localStorage.getItem('verbum_lang') || 'tr');

  const color = localStorage.getItem('verbum9_color') || 'default';
  applyColorTheme(color);
  document.querySelectorAll('[data-color]').forEach(b => {
    b.classList.toggle('active', b.dataset.color === color);
  });

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

// ─── Dil seçici (ilk ziyaret) ────────────────────────────────

function initLangPicker() {
  const modal = document.getElementById('lang-picker-modal');
  if (!localStorage.getItem('verbum_lang')) {
    modal.hidden = false;
  }
  modal.querySelectorAll('.lang-picker-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const lang = btn.dataset.lang;
      setActiveLang(lang);
      applyLang(lang);
      switchDictionary(lang);
      modal.hidden = true;
    });
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
  fb.textContent = t('word.hint_label', { len: pattern.length });
  document.getElementById('btn-submit').disabled = true;
}

function bindHintEvents() {
  document.getElementById('btn-hint').addEventListener('click', () => {
    if (state.phase !== PHASES.PLAYING) return;

    if (mode === 'solo' || mode === 'group' || mode === 'daily') {
      const missed = findMissedWords();
      if (missed.length === 0) { showToast(t('toast.no_hint'), 3000); return; }
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
  } else if (mode === 'group') {
    socket.emit('grp_leave');
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
  const color = localStorage.getItem('verbum9_color') || 'default';
  document.querySelectorAll('[data-color]').forEach(b => {
    b.classList.toggle('active', b.dataset.color === color);
  });
  document.getElementById('setting-sound').checked = _soundEnabled;
  document.querySelectorAll('.duration-btn').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.dur) === _gameDuration);
  });

  const activeLang = getActiveLang();
  document.querySelectorAll('.lang-btn').forEach(b => b.classList.toggle('active', b.dataset.lang === activeLang));

  // Dil satırı: sadece lobi/fill fazında değiştirilebilir
  const canChangeLang = mode !== 'multi' || state.phase === PHASES.LOBBY;
  document.getElementById('settings-lang-row').hidden = !canChangeLang;

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

  // Koyu/Açık modu
  document.querySelectorAll('[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      const isLight = btn.dataset.mode === 'light';
      document.body.classList.toggle('light', isLight);
      localStorage.setItem('verbum9_theme', isLight ? 'light' : 'dark');
      document.getElementById('btn-theme-dark').classList.toggle('active', !isLight);
      document.getElementById('btn-theme-light').classList.toggle('active', isLight);
    });
  });

  // Renk teması
  document.querySelectorAll('[data-color]').forEach(btn => {
    btn.addEventListener('click', () => {
      const color = btn.dataset.color;
      applyColorTheme(color);
      localStorage.setItem('verbum9_color', color);
      document.querySelectorAll('[data-color]').forEach(b => {
        b.classList.toggle('active', b.dataset.color === color);
      });
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

  // Dil
  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const lang = btn.dataset.lang;
      setActiveLang(lang);
      applyLang(lang);
      switchDictionary(lang);
      document.querySelectorAll('.lang-btn').forEach(b => b.classList.toggle('active', b.dataset.lang === lang));
    });
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
  try { await loadDictionary(localStorage.getItem('verbum_lang') || 'tr'); } catch (e) { console.warn('[dict] yüklenemedi, TR fallback deneniyor:', e); try { await loadDictionary('tr'); } catch {} }
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
  initLangPicker();
  initTutorial();
  onTutorialEnd('lobby', startDemoGame);
  onTutorialEnd('game', endDemoGame);

  const user = await fetchMe();
  if (user) {
    currentUser = user;
    socket.auth = { token: localStorage.getItem(TOKEN_KEY) };
    if (!socket.connected) socket.connect();
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
      socket.auth = { token: data.token };
      if (!socket.connected) socket.connect();
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
    const username  = document.getElementById('reg-username').value.trim();
    const email     = document.getElementById('reg-email').value.trim();
    const password  = document.getElementById('reg-password').value;
    const password2 = document.getElementById('reg-password2').value;
    setAuthError('');
    if (password !== password2) { setAuthError('Şifreler eşleşmiyor.'); return; }
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

  // Şifre göster/gizle
  document.querySelectorAll('.btn-show-password').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.target);
      if (!input) return;
      input.type = input.type === 'password' ? 'text' : 'password';
      btn.style.opacity = input.type === 'text' ? '1' : '0.5';
    });
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
  document.getElementById('mode-daily').addEventListener('click', goToDailyLobby);
  document.getElementById('mode-multi').addEventListener('click', goToMultiLobby);
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

// ─── Günlük Mod ───────────────────────────────────────────────

async function goToDailyLobby() {
  showScreen('screen-daily-lobby');
  document.getElementById('daily-start-section').hidden = false;
  document.getElementById('daily-played-section').hidden = true;
  document.getElementById('daily-yesterday').hidden = true;
  document.getElementById('btn-daily-start').disabled = false;
  document.getElementById('btn-daily-start').textContent = 'Oynamaya Başla';

  const data = await apiFetch('GET', '/api/daily');

  // Dünkü sonuç
  if (data.yesterday) {
    const yEl = document.getElementById('daily-yesterday');
    const yst = data.yesterday;
    yEl.hidden = false;
    document.getElementById('daily-yesterday-rank').textContent =
      yst.final_rank ? `${yst.final_rank}. sıra` : 'Sıralama bekleniyor';
    document.getElementById('daily-yesterday-kl').textContent =
      yst.kl_earned != null ? `+${yst.kl_earned} KL` : '';
  }

  if (data.played) {
    document.getElementById('daily-start-section').hidden = true;
    document.getElementById('daily-played-section').hidden = false;
    document.getElementById('daily-played-score-val').textContent = data.score;
    document.getElementById('daily-lobby-rank').textContent = `${data.currentRank}. sıra`;
  } else {
    // Butona matrisi bağla
    document.getElementById('btn-daily-start').onclick = () => startDailyGame(data.matrix);
  }
}

function startDailyGame(matrix) {
  mode = 'daily';
  setGameDuration(150);
  state.matrix = matrix;
  state.phase = PHASES.FILL;
  document.getElementById('multi-result').hidden = true;
  document.getElementById('result-words-section').hidden = false;

  renderGameMatrix(onTileClick);
  clearCurrentWord();
  updateWordDisplay();
  updateTimer(150);
  updateScore();
  document.getElementById('words-list').innerHTML = '';
  document.getElementById('btn-extend-time').hidden = true;
  showScreen('screen-game');
  showCountdownOverlay(true);

  startCountdown(
    n => { updateCountdown(n); playWarningBeep(); },
    () => {
      showCountdownOverlay(false);
      state.phase = PHASES.PLAYING;
      updateTimer(150);
      bindGameEvents();
      requestWakeLock();

      const _onDailyEnd = async () => {
        _soloGameEndTime = null;
        _soloOnEnd = null;
        _soloTickCb = null;
        removeGameEvents();
        releaseWakeLock();
        const missed = findMissedWords();
        renderResult(missed);
        document.getElementById('btn-again').hidden = true;
        document.getElementById('daily-result-banner').hidden = true;
        showScreen('screen-result');
        setTimeout(() => startResult(), 100);
        const wordsFound = state.submittedWords.filter(w => w.valid).length;
        const res = await apiFetch('POST', '/api/daily/submit', { score: state.score, wordsFound });
        if (res.ok) {
          document.getElementById('daily-rank-number').textContent = `${res.currentRank}. sıra`;
          document.getElementById('daily-result-banner').hidden = false;
        }
        setGameDuration(120);
        mode = 'solo';
      };

      _soloOnEnd = _onDailyEnd;
      _soloTickCb = seconds => updateTimer(seconds);
      _soloGameEndTime = Date.now() + 150 * 1000;
      startGame(_soloTickCb, _onDailyEnd);
    }
  );
}

// ─── 1v1 Online ──────────────────────────────────────────────

function goToOnline() {
  mode = 'multi';
  mp.myScore = 0;
  socket.auth = { token: localStorage.getItem(TOKEN_KEY) };
  document.getElementById('waiting-status').textContent = t('waiting.searching');
  showScreen('screen-waiting');
  if (socket.connected) {
    socket.emit('join_queue', { name: currentUser.username, lang: getActiveLang() });
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
      socket.emit('join_queue', { name: currentUser.username, lang: getActiveLang() });
    }
  }
  // Çoklu mod bekleme/host ekranındayken yeniden bağlanınca odayı kontrol et
  const activeScreen = document.querySelector('.screen.active')?.id;
  if (_grpCode && ['screen-multi-wait', 'screen-multi-host'].includes(activeScreen)) {
    socket.emit('grp_check_active');
  }
});

socket.on('queued', () => {
  document.getElementById('waiting-status').textContent = t('waiting.queued');
});

socket.on('matched', ({ opponentName, playerIndex, turnIndex, lang }) => {
  mode = 'multi';
  mp.playerIndex = playerIndex;
  mp.turnIndex = turnIndex;
  mp.opponentName = opponentName;
  mp.myScore = 0;
  if (lang) setActiveLang(lang);
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
    const isDup = result.status === 'duplicate';
    addWordToPanel({ word: result.word, points: 0, valid: false, duplicate: isDup });
    if (!isDup) mp.invalidWords.push(result.word);
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
  document.getElementById('multi-result-header').textContent = t('result.opp_disconnected', { name: mp.opponentName });
  document.getElementById('multi-result-header').className = 'multi-result-header win';
  document.getElementById('multi-result').hidden = false;
  document.getElementById('result-words-section').hidden = true;
  document.getElementById('result-missed-section').hidden = true;
  showScreen('screen-result');
  socket.disconnect();
  mode = 'solo';
});

socket.on('opponent_disconnected', ({ timeLeft }) => {
  showToast(t('toast.opp_disconnected', { name: mp.opponentName }), Math.min(timeLeft * 1000, 8000));
});

socket.on('opponent_reconnected', () => {
  showToast(t('toast.opp_reconnected', { name: mp.opponentName }), 3000);
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

function _findMissedForMatrix(matrix, foundSet, locale = getActiveLangConfig().locale) {
  const mc = {};
  for (const l of matrix) if (l) mc[l] = (mc[l] || 0) + 1;
  const possible = [];
  for (const word of getWordArray()) {
    if (foundSet.has(word)) continue;
    const wordU = word.toLocaleUpperCase(locale);
    const needed = {};
    for (const ch of wordU) needed[ch] = (needed[ch] || 0) + 1;
    let ok = true;
    for (const ch in needed) {
      if ((mc[ch] || 0) < needed[ch]) { ok = false; break; }
    }
    if (ok) possible.push(word);
  }
  return possible.sort((a, b) => b.length - a.length || a.localeCompare(b, locale));
}

// ─── Çok oyunculu doldurma ───────────────────────────────────

function updateFillTurnBanner() {
  const banner = document.getElementById('fill-turn-banner');
  const myTurn = mp.turnIndex === mp.playerIndex;
  banner.textContent = myTurn ? t('fill.my_turn') : t('fill.opponent_turn', { name: mp.opponentName });
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
    header.textContent = t('result.win', { my: my.score, op: op.score });
    header.className = 'multi-result-header win';
  } else if (op.score > my.score) {
    header.textContent = t('result.lose', { my: my.score, op: op.score });
    header.className = 'multi-result-header lose';
  } else {
    header.textContent = t('result.draw', { my: my.score, op: op.score });
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
      const wordBtn = document.createElement('button');
      wordBtn.className = 'word-meaning-btn';
      wordBtn.textContent = word;
      wordBtn.addEventListener('click', () => showMeaning(word));
      li.appendChild(wordBtn);
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
      const wordBtn = document.createElement('button');
      wordBtn.className = 'word-meaning-btn';
      wordBtn.textContent = word;
      wordBtn.addEventListener('click', () => showMeaning(word));
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
    li.textContent = t('result.all_found');
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
  const lang = getActiveLang();
  if (lang !== 'tr') return key.toLocaleUpperCase('en-US');
  const map = { i: 'İ', ı: 'I' };
  return map[key] || key.toLocaleUpperCase('tr-TR');
}

// ─── Geri Sayım → Oyun ───────────────────────────────────────

function beginCountdown() {
  document.removeEventListener('keydown', onFillKeydown);

  // Hiç sesli harf yoksa 2 rastgele sessiz harfi sesli harfle değiştir
  const langCfg = getActiveLangConfig();
  const vowelsSet = new Set(langCfg.vowels || ['A', 'E', 'I', 'İ', 'O', 'Ö', 'U', 'Ü']);
  const vowelsArr = langCfg.vowels || ['A', 'E', 'İ', 'I', 'O', 'U', 'Ö', 'Ü'];
  const hasVowel = state.matrix.some(l => vowelsSet.has(l));
  if (!hasVowel) {
    const positions = [...Array(9).keys()]
      .sort(() => Math.random() - 0.5)
      .slice(0, 2);
    const added = positions.map(pos => {
      const v = vowelsArr[Math.floor(Math.random() * vowelsArr.length)];
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

      const _onSoloEnd = async () => {
        _soloGameEndTime = null;
        _soloOnEnd = null;
        _soloTickCb = null;
        removeGameEvents();
        releaseWakeLock();
        const missed = findMissedWords();
        renderResult(missed);
        document.getElementById('daily-result-banner').hidden = true;
        document.getElementById('btn-again').hidden = mode === 'daily';
        showScreen('screen-result');
        setTimeout(() => startResult(), 100);
        if (mode === 'daily') {
          const wordsFound = state.submittedWords.filter(w => w.valid).length;
          const data = await apiFetch('POST', '/api/daily/submit', { score: state.score, wordsFound });
          if (data.ok) {
            document.getElementById('daily-rank-number').textContent = `${data.currentRank}. sıra`;
            document.getElementById('daily-result-banner').hidden = false;
          }
          mode = 'solo';
        }
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
    return;
  }
  if (mode === 'group') {
    const word = state.currentWordCells.map(i => state.matrix[i]).join('');
    socket.emit('grp_submit_word', { word });
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
    const data = await res.json().catch(() => ({}));
    if (data.ok) {
      btn.textContent = '✓ İtiraz edildi';
    } else {
      btn.textContent = data.error || 'Hata';
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
    document.getElementById('btn-again').hidden = false;
    document.getElementById('daily-result-banner').hidden = true;
    setGameDuration(120);
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

// ─── Anlam Popup ─────────────────────────────────────────────

async function showMeaning(word) {
  const popup = document.getElementById('meaning-popup');
  const wordEl = document.getElementById('meaning-word');
  const bodyEl = document.getElementById('meaning-body');
  wordEl.textContent = word;
  bodyEl.innerHTML = `<div class="no-meaning">${t('toast.loading')}</div>`;
  popup.hidden = false;

  const lang = getActiveLang();
  const locale = getActiveLangConfig().locale;
  try {
    const res = await fetch(`/api/meaning/${encodeURIComponent(word.toLocaleLowerCase(locale))}?lang=${lang}`);
    const data = await res.json();
    if (data && data.meanings && data.meanings.length > 0) {
      bodyEl.innerHTML = '<ol>' + data.meanings.map(m => `<li>${m}</li>`).join('') + '</ol>';
    } else {
      bodyEl.innerHTML = `<div class="no-meaning">${t('toast.no_meaning')}</div>`;
    }
  } catch {
    bodyEl.innerHTML = `<div class="no-meaning">${t('toast.meaning_error')}</div>`;
  }
}

function closeMeaning() {
  document.getElementById('meaning-popup').hidden = true;
}

document.getElementById('btn-close-meaning').addEventListener('click', closeMeaning);
document.getElementById('meaning-backdrop').addEventListener('click', closeMeaning);
document.addEventListener('verbum:show-meaning', e => showMeaning(e.detail.word));

function bindProfile() {
  document.getElementById('profile-backdrop').addEventListener('click', closeProfile);
  document.getElementById('btn-close-profile').addEventListener('click', closeProfile);
  document.getElementById('btn-logout').addEventListener('click', () => {
    localStorage.removeItem(TOKEN_KEY);
    currentUser = null;
    socket.disconnect();
    closeProfile();
    showScreen('screen-auth');
  });
}

// ─── Arkadaşlar Ekranı ───────────────────────────────────────

document.getElementById('btn-friends-lobby').addEventListener('click', openFriends);
document.getElementById('btn-friends-back').addEventListener('click', () => showScreen('screen-lobby'));
document.getElementById('btn-daily-back').addEventListener('click', () => showScreen('screen-lobby'));

function openFriends() {
  showScreen('screen-friends');
  loadFriends();
  loadFriendRequests();
}

function formatLastSeen(lastSeen, online) {
  if (online) return '<span class="friend-online-status">● Çevrimiçi</span>';
  if (!lastSeen) return '<span class="friend-status">○ Hiç görülmedi</span>';
  const diff = Date.now() - new Date(lastSeen).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  let label;
  if (mins < 1)       label = 'az önce çevrimdışı';
  else if (mins < 60) label = `${mins} dk önce görüldü`;
  else if (hours < 24) label = `${hours} saat önce görüldü`;
  else if (days < 30) label = `${days} gün önce görüldü`;
  else                label = 'uzun süredir çevrimdışı';
  return `<span class="friend-status">○ ${label}</span>`;
}

async function loadFriends() {
  const res = await fetch('/api/friends', { headers: { Authorization: 'Bearer ' + localStorage.getItem(TOKEN_KEY) } });
  const friends = await res.json();
  const list = document.getElementById('friends-list');
  const badge = document.getElementById('friends-count-badge');
  badge.textContent = friends.length || '';
  badge.hidden = friends.length === 0;
  if (friends.length === 0) {
    list.innerHTML = '<div class="friends-empty">Henüz arkadaşın yok. Yukarıdan ara!</div>';
    return;
  }
  list.innerHTML = friends.map(f => `
    <div class="friend-row" id="friend-row-${f.friendshipId}">
      <div class="friend-avatar">${f.username[0].toLocaleUpperCase('tr-TR')}${f.online ? '<div class="online-dot"></div>' : ''}</div>
      <div class="friend-name">${f.username}<br>${formatLastSeen(f.lastSeen, f.online)}</div>
      <div class="friend-actions">
        <button class="btn-friend-invite" ${!f.online ? 'disabled' : ''} onclick="inviteFriend(${f.userId}, '${f.username}')">⚡ Davet</button>
        <button class="btn-friend-remove" onclick="removeFriend(${f.friendshipId})">✕</button>
      </div>
    </div>`).join('');
}

async function loadFriendRequests() {
  const res = await fetch('/api/friends/requests', { headers: { Authorization: 'Bearer ' + localStorage.getItem(TOKEN_KEY) } });
  const requests = await res.json();
  const section = document.getElementById('friends-requests-section');
  const list = document.getElementById('friends-requests-list');
  const badge = document.getElementById('friends-requests-badge');
  if (requests.length === 0) { section.hidden = true; return; }
  section.hidden = false;
  badge.textContent = requests.length;
  list.innerHTML = requests.map(r => `
    <div class="friend-row" id="request-row-${r.id}">
      <div class="friend-avatar">${r.username[0].toLocaleUpperCase('tr-TR')}</div>
      <div class="friend-name">${r.username}</div>
      <div class="friend-actions">
        <button class="btn-friend-accept" onclick="respondRequest(${r.id}, true)">✓ Kabul</button>
        <button class="btn-friend-reject" onclick="respondRequest(${r.id}, false)">✕ Reddet</button>
      </div>
    </div>`).join('');
}

async function searchFriends() {
  const q = document.getElementById('friends-search-input').value.trim();
  if (q.length < 2) return;
  const res = await fetch('/api/friends/search?q=' + encodeURIComponent(q), { headers: { Authorization: 'Bearer ' + localStorage.getItem(TOKEN_KEY) } });
  const results = await res.json();
  const section = document.getElementById('friends-search-results');
  section.hidden = false;
  if (results.length === 0) { section.innerHTML = '<div class="friends-section-title">Arama Sonucu</div><div class="friends-empty">Kullanıcı bulunamadı.</div>'; return; }
  section.innerHTML = '<div class="friends-section-title">Arama Sonucu</div>' + results.map(u => {
    let actionBtn = '';
    if (u.friendStatus === 'friends') actionBtn = '<button class="btn-friend-pending" disabled>Arkadaş ✓</button>';
    else if (u.friendStatus === 'sent') actionBtn = '<button class="btn-friend-pending" disabled>İstek Gönderildi</button>';
    else if (u.friendStatus === 'received') actionBtn = `<button class="btn-friend-accept" onclick="respondRequest(${u.friendshipId}, true)">✓ Kabul</button>`;
    else actionBtn = `<button class="btn-friend-invite" onclick="sendFriendRequest('${u.username}', this)">+ İstek Gönder</button>`;
    return `<div class="friend-row"><div class="friend-avatar">${u.username[0].toLocaleUpperCase('tr-TR')}</div><div class="friend-name">${u.username}</div><div class="friend-actions">${actionBtn}</div></div>`;
  }).join('');
}

async function sendFriendRequest(username, btn) {
  btn.disabled = true; btn.textContent = '...';
  const res = await fetch('/api/friends/request', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem(TOKEN_KEY) },
    body: JSON.stringify({ username })
  });
  const d = await res.json();
  if (d.ok) { btn.textContent = 'İstek Gönderildi'; btn.className = 'btn-friend-pending'; }
  else { btn.disabled = false; btn.textContent = '+ İstek Gönder'; showToast(d.error || 'Hata.'); }
}

async function respondRequest(id, accept) {
  await fetch('/api/friends/' + id, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem(TOKEN_KEY) },
    body: JSON.stringify({ accept })
  });
  document.getElementById('request-row-' + id)?.remove();
  if (accept) { loadFriends(); loadFriendRequests(); }
  else loadFriendRequests();
}

async function removeFriend(friendshipId) {
  await fetch('/api/friends/' + friendshipId, { method: 'DELETE', headers: { Authorization: 'Bearer ' + localStorage.getItem(TOKEN_KEY) } });
  document.getElementById('friend-row-' + friendshipId)?.remove();
}

document.getElementById('btn-friends-search').addEventListener('click', searchFriends);
document.getElementById('friends-search-input').addEventListener('keydown', e => { if (e.key === 'Enter') searchFriends(); });

// inline onclick'ler module scope'u göremez, window'a bağla
window.sendFriendRequest = sendFriendRequest;
window.respondRequest    = respondRequest;
window.removeFriend      = removeFriend;
window.inviteFriend      = inviteFriend;

function inviteFriend(userId, username) {
  socket.emit('friend_invite', { toUserId: userId });
  showToast(`${username} adlı oyuncuya davet gönderildi (30 sn)`);
}

// ─── E-posta ile Davet ───────────────────────────────────────

document.getElementById('btn-invite-by-email').addEventListener('click', () => {
  document.getElementById('invite-email-input').value = '';
  document.getElementById('invite-name-input').value = '';
  document.getElementById('invite-message-input').value = '';
  const err = document.getElementById('invite-email-error');
  err.hidden = true;
  document.getElementById('invite-email-modal').hidden = false;
  document.getElementById('invite-email-input').focus();
});

document.getElementById('btn-invite-email-cancel').addEventListener('click', () => {
  document.getElementById('invite-email-modal').hidden = true;
});

document.getElementById('btn-invite-email-send').addEventListener('click', async () => {
  const email   = document.getElementById('invite-email-input').value.trim();
  const name    = document.getElementById('invite-name-input').value.trim();
  const message = document.getElementById('invite-message-input').value.trim();
  const errEl   = document.getElementById('invite-email-error');
  const btn     = document.getElementById('btn-invite-email-send');

  errEl.hidden = true;
  if (!email) { errEl.textContent = 'Lütfen arkadaşının e-posta adresini gir.'; errEl.hidden = false; return; }
  if (!name)  { errEl.textContent = 'Arkadaşın Verbum\'dan mail alacak. Senin olduğunu anlayabilmesi için ismini girmelisin.'; errEl.hidden = false; return; }

  btn.disabled = true;
  btn.textContent = 'Gönderiliyor...';
  const data = await apiFetch('POST', '/api/friends/invite-email', { email, fromName: name, message });
  btn.disabled = false;
  btn.textContent = 'Gönder';

  if (data.ok) {
    document.getElementById('invite-email-modal').hidden = true;
    showToast('Davet maili gönderildi!');
  } else {
    errEl.textContent = data.error || 'Bir hata oluştu.';
    errEl.hidden = false;
  }
});

// ─── Oyun Daveti (gelen) ─────────────────────────────────────

let _inviteTimer = null;
let _currentInviteId = null;

socket.on('friend_invite_received', ({ inviteId, fromUsername }) => {
  _currentInviteId = inviteId;
  document.getElementById('invite-from-name').textContent = fromUsername;
  document.getElementById('invite-popup').hidden = false;
  const fill = document.getElementById('invite-countdown-fill');
  fill.style.transition = 'none'; fill.style.width = '100%';
  setTimeout(() => { fill.style.transition = 'width 30s linear'; fill.style.width = '0%'; }, 50);
  clearTimeout(_inviteTimer);
  _inviteTimer = setTimeout(() => {
    document.getElementById('invite-popup').hidden = true;
    _currentInviteId = null;
  }, 30000);
});

document.getElementById('btn-invite-accept').addEventListener('click', () => {
  if (!_currentInviteId) return;
  socket.emit('friend_invite_response', { inviteId: _currentInviteId, accept: true });
  document.getElementById('invite-popup').hidden = true;
  clearTimeout(_inviteTimer); _currentInviteId = null;
});

document.getElementById('btn-invite-decline').addEventListener('click', () => {
  if (!_currentInviteId) return;
  socket.emit('friend_invite_response', { inviteId: _currentInviteId, accept: false });
  document.getElementById('invite-popup').hidden = true;
  clearTimeout(_inviteTimer); _currentInviteId = null;
});

socket.on('friend_invite_result', ({ ok, error, toUsername }) => {
  if (!ok) showToast(error || 'Davet gönderilemedi.');
});

socket.on('friend_invite_declined', ({ username }) => {
  showToast(`${username} daveti reddetti.`);
});

socket.on('friend_invite_expired', ({ toUsername }) => {
  showToast(`${toUsername} davete yanıt vermedi.`);
});

socket.on('friend_request_received', ({ fromUsername }) => {
  showToast(`${fromUsername} sana arkadaşlık isteği gönderdi.`, 6000);
  if (document.getElementById('screen-friends').classList.contains('active')) loadFriendRequests();
});

socket.on('friend_request_accepted', ({ byUsername }) => {
  showToast(`${byUsername} arkadaşlık isteğini kabul etti!`, 5000);
  if (document.getElementById('screen-friends').classList.contains('active')) loadFriends();
});

// ─── Çoklu Mod (Grup Odası) ──────────────────────────────────

let _grpCode = '';
let _grpHostName = '';
let _grpSelectedFriendIds = new Set();
let _grpInviteCode = '';

// Host matris durumu
let _mhMatrix = Array(9).fill('');
let _mhActiveCell = 0;
let _mhDuration = 180;

function goToMultiLobby() {
  showScreen('screen-multi-lobby');
  document.getElementById('multi-code-input').value = '';
  document.getElementById('multi-join-error').textContent = '';
  document.getElementById('btn-grp-rejoin').hidden = true;
  loadOpenRooms();
  socket.emit('grp_check_active');
}

async function loadOpenRooms() {
  const data = await apiFetch('GET', '/api/group/open');
  const list = document.getElementById('multi-open-list');
  const empty = document.getElementById('multi-open-empty');
  if (!Array.isArray(data) || data.length === 0) {
    list.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  list.innerHTML = data.map(r => {
    const langLabel = (r.lang || 'tr').toUpperCase();
    return `<div class="multi-open-row" onclick="joinOpenRoom('${r.code}','${r.lang || 'tr'}')">
      <div>
        <div class="multi-open-host">${r.hostName} <span class="lang-badge">${langLabel}</span></div>
        <div class="multi-open-info">${r.playerCount} ${t('multi.players')}</div>
      </div>
      <button class="btn-secondary" style="font-size:.85rem;padding:7px 14px">${t('multi.join')}</button>
    </div>`;
  }).join('');
}

function joinOpenRoom(code, lang) {
  if (lang) { setActiveLangTemp(lang); applyLang(lang); switchDictionary(lang); }
  socket.emit('grp_request_join', { code });
  document.getElementById('mw-host-name').textContent = '—';
  document.getElementById('mw-code').textContent = code;
  document.getElementById('mw-status').textContent = t('multi.waiting_approval');
  document.getElementById('mw-players-list').innerHTML = '';
  showScreen('screen-multi-wait');
}

window.joinOpenRoom = joinOpenRoom;

document.getElementById('btn-multi-back').addEventListener('click', () => showScreen('screen-lobby'));

document.getElementById('btn-refresh-open').addEventListener('click', loadOpenRooms);

document.getElementById('btn-multi-join-code').addEventListener('click', () => {
  const code = document.getElementById('multi-code-input').value.trim();
  const errEl = document.getElementById('multi-join-error');
  errEl.textContent = '';
  if (code.length !== 6 || !/^\d{6}$/.test(code)) {
    errEl.textContent = '6 haneli bir kod gir.'; return;
  }
  socket.emit('grp_join', { code });
});

document.getElementById('multi-code-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btn-multi-join-code').click();
});

document.getElementById('btn-multi-create').addEventListener('click', () => {
  const nameEl = document.getElementById('multi-display-name');
  nameEl.value = currentUser?.username || '';
  document.getElementById('multi-name-error').textContent = '';
  document.getElementById('multi-name-popup').hidden = false;
  setTimeout(() => nameEl.focus(), 50);
});

document.getElementById('btn-multi-name-cancel').addEventListener('click', () => {
  document.getElementById('multi-name-popup').hidden = true;
});

document.getElementById('btn-multi-name-confirm').addEventListener('click', () => {
  const name = document.getElementById('multi-display-name').value.trim();
  const errEl = document.getElementById('multi-name-error');
  errEl.textContent = '';
  if (!name) { errEl.textContent = 'Bir isim gir.'; return; }
  document.getElementById('multi-name-popup').hidden = true;
  socket.emit('grp_create', { displayName: name, lang: getActiveLang() });
});

document.getElementById('multi-display-name').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btn-multi-name-confirm').click();
});

// Host ekranı kurulumu
function setupHostScreen(code) {
  _grpCode = code;
  _mhMatrix = Array(9).fill('');
  _mhActiveCell = 0;
  _mhDuration = 180;

  document.getElementById('mh-code-val').textContent = code;
  document.getElementById('btn-mh-start').disabled = true;
  const avatarEl = document.getElementById('mh-nav-avatar');
  if (avatarEl && currentUser) avatarEl.textContent = (currentUser.username || '?')[0].toUpperCase();
  document.getElementById('btn-mh-copy-code').onclick = () => {
    navigator.clipboard?.writeText(code).catch(() => {});
    showToast(`Kod kopyalandı: ${code}`, 3000);
  };

  // Matris oluştur
  const container = document.getElementById('mh-matrix');
  container.innerHTML = '';
  for (let i = 0; i < 9; i++) {
    const cell = document.createElement('div');
    cell.className = 'tile';
    cell.dataset.pos = i;
    cell.addEventListener('click', () => {
      _mhActiveCell = i;
      renderMhMatrix();
      const inp = document.getElementById('mh-keyboard-input');
      inp.style.pointerEvents = 'auto';
      inp.focus();
    });
    container.appendChild(cell);
  }
  renderMhMatrix();

  // Süre butonları
  document.querySelectorAll('.mh-dur-btn').forEach(btn => {
    btn.className = btn.dataset.dur === '180' ? 'mh-dur-btn mh-dur-active' : 'mh-dur-btn';
    btn.onclick = () => {
      _mhDuration = parseInt(btn.dataset.dur);
      document.querySelectorAll('.mh-dur-btn').forEach(b => b.className = 'mh-dur-btn');
      btn.className = 'mh-dur-btn mh-dur-active';
    };
  });

  // Oyuncular listesi
  const playersList = document.getElementById('mh-players-list');
  playersList.innerHTML = `<div class="mh-player-row"><span class="mh-player-name">${currentUser?.username || 'Sen'}</span><span class="mh-player-badge">Oda Sahibi</span></div>`;
  document.getElementById('mh-player-count').textContent = '1';
  document.getElementById('mh-pending-section').hidden = true;

  showScreen('screen-multi-host');
}

function renderMhMatrix() {
  const cells = document.querySelectorAll('#mh-matrix .tile');
  cells.forEach((cell, i) => {
    cell.textContent = _mhMatrix[i] || '';
    cell.className = 'tile' +
      (i === _mhActiveCell ? ' active' : '') +
      (_mhMatrix[i] ? ' filled' : '');
  });
  const allFilled = _mhMatrix.every(l => l !== '');
  document.getElementById('btn-mh-start').disabled = !allFilled;
}

document.getElementById('btn-mh-close').addEventListener('click', () => {
  if (_grpCode) socket.emit('grp_leave');
  _grpCode = '';
  showScreen('screen-multi-lobby');
});

document.getElementById('btn-mh-rand-one').addEventListener('click', () => {
  const pos = _mhActiveCell < 9 && _mhMatrix[_mhActiveCell] === ''
    ? _mhActiveCell : _mhMatrix.findIndex(l => l === '');
  if (pos >= 0) {
    _mhMatrix[pos] = getRandomLetter();
    _mhActiveCell = Math.min(pos + 1, 9);
    renderMhMatrix();
  }
});

document.getElementById('btn-mh-rand-all').addEventListener('click', () => {
  for (let i = 0; i < 9; i++) {
    if (!_mhMatrix[i]) _mhMatrix[i] = getRandomLetter();
  }
  _mhActiveCell = 9;
  renderMhMatrix();
});

// Host klavye girişi
document.addEventListener('keydown', e => {
  if (!document.getElementById('screen-multi-host').classList.contains('active')) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'Backspace') {
    e.preventDefault();
    const pos = _mhActiveCell > 0 ? _mhActiveCell - 1 : 0;
    _mhActiveCell = pos;
    _mhMatrix[pos] = '';
    renderMhMatrix();
    return;
  }
  if (!VALID_LETTERS.test(e.key)) return;
  if (_mhActiveCell >= 9) return;
  e.preventDefault();
  _mhMatrix[_mhActiveCell] = normalizeLetter(e.key);
  _mhActiveCell = Math.min(_mhActiveCell + 1, 9);
  renderMhMatrix();
});

const _mhKbInp = document.getElementById('mh-keyboard-input');
_mhKbInp.addEventListener('blur', () => { _mhKbInp.style.pointerEvents = 'none'; });
_mhKbInp.addEventListener('input', () => {
  const ch = _mhKbInp.value.slice(-1);
  _mhKbInp.value = '';
  if (!ch || !VALID_LETTERS.test(ch)) return;
  if (_mhActiveCell >= 9) return;
  _mhMatrix[_mhActiveCell] = normalizeLetter(ch);
  _mhActiveCell = Math.min(_mhActiveCell + 1, 9);
  renderMhMatrix();
});

// Davet et paneli
document.getElementById('btn-mh-invite').addEventListener('click', () => {
  const panel = document.getElementById('mh-invite-panel');
  panel.hidden = !panel.hidden;
});

document.getElementById('btn-mh-inv-open').addEventListener('click', () => {
  document.getElementById('mh-invite-panel').hidden = true;
  socket.emit('grp_set_invite_mode', { code: _grpCode, mode: 'open' });
  showToast('Oda açık listeye eklendi. Oyuncular katılım isteği gönderebilir.', 4000);
});

document.getElementById('btn-mh-inv-code').addEventListener('click', () => {
  document.getElementById('mh-invite-panel').hidden = true;
  socket.emit('grp_set_invite_mode', { code: _grpCode, mode: 'code' });
  if (navigator.clipboard) {
    navigator.clipboard.writeText(_grpCode).then(() => showToast(`Kod kopyalandı: ${_grpCode}`, 4000)).catch(() => {});
  }
  showToast(`Oda kodu: ${_grpCode} — arkadaşlarınla paylaş!`, 5000);
});

document.getElementById('btn-mh-inv-friends').addEventListener('click', async () => {
  document.getElementById('mh-invite-panel').hidden = true;
  const res = await fetch('/api/friends', { headers: { Authorization: 'Bearer ' + localStorage.getItem(TOKEN_KEY) } });
  const friends = await res.json();
  const list = document.getElementById('mhf-list');
  _grpSelectedFriendIds.clear();
  if (!friends || friends.length === 0) {
    list.innerHTML = '<p style="color:var(--text-dim);font-size:.9rem;text-align:center">Henüz arkadaşın yok.</p>';
  } else {
    list.innerHTML = friends.map(f =>
      `<label class="mhf-friend-row">
        <input type="checkbox" data-uid="${f.userId}" onchange="if(this.checked)window._grpSelectedFriendIds.add('${f.userId}');else window._grpSelectedFriendIds.delete('${f.userId}')">
        <span class="mhf-friend-name">${f.username}</span>
        <span style="font-size:.75rem;color:${f.online ? '#06d6a0' : 'var(--text-dim)'}">● ${f.online ? 'Çevrimiçi' : 'Çevrimdışı'}</span>
      </label>`
    ).join('');
  }
  document.getElementById('mh-friends-popup').hidden = false;
});

window._grpSelectedFriendIds = _grpSelectedFriendIds;

document.getElementById('btn-mhf-cancel').addEventListener('click', () => {
  document.getElementById('mh-friends-popup').hidden = true;
});

document.getElementById('btn-mhf-send').addEventListener('click', () => {
  document.getElementById('mh-friends-popup').hidden = true;
  const ids = [..._grpSelectedFriendIds];
  if (ids.length === 0) { showToast('Hiç arkadaş seçmedin.', 3000); return; }
  socket.emit('grp_invite_friends', { code: _grpCode, friendIds: ids });
});

// Başlat
document.getElementById('btn-mh-start').addEventListener('click', () => {
  if (_mhMatrix.some(l => !l)) { showToast('Önce tüm 9 hücreyi doldur.', 3000); return; }
  document.getElementById('btn-mh-start').disabled = true;
  socket.emit('grp_start', { code: _grpCode, matrix: [..._mhMatrix], duration: _mhDuration });
});

// Aktif oyuna dön
document.getElementById('btn-grp-rejoin').addEventListener('click', () => {
  const code = document.getElementById('btn-grp-rejoin').dataset.code;
  if (code) socket.emit('grp_rejoin', { code });
});

// Bekleme ekranı
document.getElementById('btn-mw-leave').addEventListener('click', () => {
  socket.emit('grp_leave');
  _grpCode = '';
  restoreOriginalLang();
  showScreen('screen-multi-lobby');
});

// Grup sonuç
document.getElementById('btn-grp-to-lobby').addEventListener('click', () => {
  mode = 'solo';
  _grpCode = '';
  restoreOriginalLang();
  renderLobby();
  showScreen('screen-lobby');
});

// Gelen grup daveti
let _grpIncomingCode = '';

socket.on('grp_friend_invite', ({ code, fromName }) => {
  _grpIncomingCode = code;
  document.getElementById('grp-invite-from').textContent = fromName;
  document.getElementById('grp-invite-popup').hidden = false;
});

document.getElementById('btn-grp-invite-accept').addEventListener('click', () => {
  document.getElementById('grp-invite-popup').hidden = true;
  if (!_grpIncomingCode) return;
  socket.emit('grp_join', { code: _grpIncomingCode });
  _grpIncomingCode = '';
});

document.getElementById('btn-grp-invite-decline').addEventListener('click', () => {
  document.getElementById('grp-invite-popup').hidden = true;
  _grpIncomingCode = '';
});

// Socket olayları — Grup
socket.on('grp_created', ({ code }) => {
  setupHostScreen(code);
});

socket.on('grp_join_error', ({ error }) => {
  const errEl = document.getElementById('multi-join-error');
  if (errEl) errEl.textContent = error;
  showToast(error, 4000);
  showScreen('screen-multi-lobby');
});

function restoreOriginalLang() {
  const orig = localStorage.getItem('verbum_lang') || 'tr';
  setActiveLang(orig);
  applyLang(orig);
  switchDictionary(orig);
}

socket.on('grp_approved', ({ code, hostName, lang }) => {
  _grpCode = code;
  _grpHostName = hostName || '—';
  if (lang) { setActiveLangTemp(lang); applyLang(lang); switchDictionary(lang); }
  document.getElementById('mw-host-name').textContent = hostName || '—';
  document.getElementById('mw-code').textContent = code;
  document.getElementById('mw-status').textContent = 'Oda sahibinin oyunu başlatması bekleniyor...';
  showScreen('screen-multi-wait');
});

socket.on('grp_waiting_approval', () => {
  document.getElementById('mw-status').textContent = 'Oda sahibinin onayı bekleniyor...';
  showScreen('screen-multi-wait');
});

socket.on('grp_rejected', () => {
  showToast('Oda sahibi katılımını reddetti.', 4000);
  _grpCode = '';
  restoreOriginalLang();
  showScreen('screen-multi-lobby');
});

socket.on('grp_cancelled', () => {
  showToast('Oda sahibi oyunu iptal etti.', 4000);
  mode = 'solo';
  _grpCode = '';
  restoreOriginalLang();
  showScreen('screen-multi-lobby');
});

socket.on('grp_active_room', ({ active, code, status }) => {
  const btn = document.getElementById('btn-grp-rejoin');
  const activeScreen = document.querySelector('.screen.active')?.id;
  if (active && code) {
    btn.hidden = false;
    btn.dataset.code = code;
    // Bekleme ekranındaysak otomatik rejoin dene
    if (activeScreen === 'screen-multi-wait') {
      socket.emit('grp_rejoin', { code });
    }
  } else {
    btn.hidden = true;
    // Bekleme ekranındaysak oda kapandı bildir
    if (activeScreen === 'screen-multi-wait') {
      showToast('Oda artık mevcut değil.', 3000);
      mode = 'solo';
      _grpCode = '';
      showScreen('screen-multi-lobby');
    }
  }
});

socket.on('grp_mode_set', ({ mode: invMode }) => {
  const labels = { open: 'Açık moda geçildi', code: 'Kod modu aktif' };
  showToast(labels[invMode] || 'Mod güncellendi', 3000);
});

socket.on('grp_invites_sent', ({ count }) => {
  showToast(count > 0 ? `${count} arkadaşa davet gönderildi!` : 'Hiç davet gönderilemedi.', 3000);
});

socket.on('grp_players_update', ({ players }) => {
  // Host ekranı
  if (document.getElementById('screen-multi-host').classList.contains('active')) {
    const list = document.getElementById('mh-players-list');
    list.innerHTML = players.map((p, i) =>
      `<div class="mh-player-row"><span class="mh-player-name">${p.displayName}</span>${i === 0 ? '<span class="mh-player-badge">Oda Sahibi</span>' : ''}</div>`
    ).join('');
    document.getElementById('mh-player-count').textContent = players.length;
  }
  // Bekleme ekranı
  if (document.getElementById('screen-multi-wait').classList.contains('active')) {
    const list = document.getElementById('mw-players-list');
    list.innerHTML = players.map(p => `<div class="mw-player-chip">${p.displayName}</div>`).join('');
  }
});

socket.on('grp_join_request', ({ socketId, displayName }) => {
  const pending = document.getElementById('mh-pending-list');
  const section = document.getElementById('mh-pending-section');
  section.hidden = false;
  const row = document.createElement('div');
  row.className = 'mh-pending-row';
  row.id = `pending-${socketId}`;
  row.innerHTML = `<span class="mh-player-name">${displayName}</span>
    <div class="mh-pending-actions">
      <button class="btn-grp-accept" onclick="grpApprove('${socketId}', true)">✓ Kabul</button>
      <button class="btn-grp-reject" onclick="grpApprove('${socketId}', false)">✕ Reddet</button>
    </div>`;
  pending.appendChild(row);
});

window.grpApprove = (socketId, approve) => {
  socket.emit('grp_approve', { code: _grpCode, targetSocketId: socketId, approve });
  document.getElementById(`pending-${socketId}`)?.remove();
  if (document.querySelectorAll('.mh-pending-row').length === 0) {
    document.getElementById('mh-pending-section').hidden = true;
  }
};

socket.on('grp_player_joined', ({ displayName, playerCount }) => {
  document.getElementById('mh-player-count').textContent = playerCount;
  showToast(`${displayName} odaya katıldı!`, 3000);
});

// Oyun başlangıcı
socket.on('grp_started', ({ matrix, duration }) => {
  mode = 'group';
  state.matrix = matrix;
  setGameDuration(duration);
  renderGameMatrix(onTileClick);
  clearCurrentWord();
  updateWordDisplay();
  updateTimer(duration);
  updateScore();
  document.getElementById('words-list').innerHTML = '';
  document.getElementById('btn-extend-time').hidden = true;
  document.getElementById('multi-result').hidden = true;
  document.getElementById('result-words-section').hidden = false;
  showScreen('screen-game');
  showCountdownOverlay(true);
});

socket.on('grp_rejoin_ok', ({ matrix, duration, timeLeft, score }) => {
  mode = 'group';
  state.matrix = matrix;
  state.score = score;
  setGameDuration(duration);
  renderGameMatrix(onTileClick);
  clearCurrentWord();
  updateWordDisplay();
  updateTimer(timeLeft);
  updateScore();
  document.getElementById('words-list').innerHTML = '';
  document.getElementById('btn-extend-time').hidden = true;
  document.getElementById('multi-result').hidden = true;
  document.getElementById('result-words-section').hidden = false;
  showScreen('screen-game');
  showCountdownOverlay(false);
  state.phase = PHASES.PLAYING;
  bindGameEvents();
  requestWakeLock();
});

socket.on('grp_countdown', ({ n }) => {
  updateCountdown(n);
  playWarningBeep();
});

socket.on('grp_game_start', () => {
  showCountdownOverlay(false);
  state.phase = PHASES.PLAYING;
  updateTimer(_gameDuration);
  bindGameEvents();
  requestWakeLock();
});

socket.on('grp_timer_tick', ({ timeLeft }) => {
  clearInterval(_localTimerInterval);
  updateTimer(timeLeft);
  _playTimerSound(timeLeft);
  let t = timeLeft - 1;
  _localTimerInterval = setInterval(() => {
    if (t >= 0) { updateTimer(t); _playTimerSound(t); t--; }
    else clearInterval(_localTimerInterval);
  }, 1000);
});

socket.on('grp_word_result', result => {
  if (result.status === 'valid') {
    playWordFound();
    state.score += result.points;
    state.submittedWords.push({ word: result.word, points: result.points, valid: true });
    updateScore();
    addWordToPanel({ word: result.word, points: result.points, valid: true });
  } else if (result.status === 'invalid' || result.status === 'duplicate') {
    playInvalidWord();
    const isDup = result.status === 'duplicate';
    state.submittedWords.push({ word: result.word, points: 0, valid: false, duplicate: isDup });
    addWordToPanel({ word: result.word, points: 0, valid: false, duplicate: isDup });
  }
  showWordFeedback(result.status, result.word, result.points);
  clearCurrentWord();
  updateGameMatrix();
  updateWordDisplay();
});

socket.on('grp_ended', ({ rankings, words }) => {
  clearInterval(_localTimerInterval);
  state.phase = PHASES.RESULT;
  removeGameEvents();
  releaseWakeLock();
  const _locale = getActiveLangConfig().locale;
  const foundSet = new Set(words.map(w => w.word.toLocaleLowerCase(_locale)));
  const missed = _findMissedForMatrix(state.matrix, foundSet, _locale);
  renderGroupResult(rankings, words, missed);
  showScreen('screen-group-result');
});

function renderGroupResult(rankings, words, missed = []) {
  // Sıralama
  const rankingsEl = document.getElementById('grp-rankings');
  const medals = ['🥇', '🥈', '🥉'];
  rankingsEl.innerHTML = rankings.map((p, i) =>
    `<div class="grp-rank-row rank-${Math.min(i + 1, 4)}">
      <span class="grp-rank-badge">${medals[i] || (i + 1) + '.'}</span>
      <span class="grp-rank-name">${p.displayName}</span>
      <span class="grp-rank-score">${p.score} puan</span>
    </div>`
  ).join('');

  // Bulunan kelimeler
  document.getElementById('grp-words-count').textContent = `${words.length} kelime`;
  const list = document.getElementById('grp-words-list');
  list.innerHTML = '';
  words.forEach(({ word }) => {
    const li = document.createElement('li');
    li.className = 'valid';
    const btn = document.createElement('button');
    btn.className = 'word-meaning-btn';
    btn.textContent = word;
    btn.addEventListener('click', () => showMeaning(word));
    li.appendChild(btn);
    const pts = document.createElement('span');
    pts.className = 'word-points';
    pts.textContent = word.length + ' harf';
    li.appendChild(pts);
    list.appendChild(li);
  });

  // Kaçırılan kelimeler
  const missedSection = document.getElementById('grp-missed-section');
  const missedList = document.getElementById('grp-missed-list');
  missedList.innerHTML = '';
  if (missed.length > 0) {
    missedSection.hidden = false;
    const display = missed.slice(0, 100);
    document.getElementById('grp-missed-count').textContent =
      missed.length > 100 ? `${missed.length} kelime (ilk 100 gösteriliyor)` : `${missed.length} kelime`;
    display.forEach(word => {
      const li = document.createElement('li');
      li.className = 'valid';
      const btn = document.createElement('button');
      btn.className = 'word-meaning-btn';
      btn.textContent = word;
      btn.addEventListener('click', () => showMeaning(word));
      li.appendChild(btn);
      missedList.appendChild(li);
    });
  } else {
    missedSection.hidden = true;
  }
}

// ─── Sekme kapanınca / sayfa yenilenince kasıtlı çıkış bildir ─

window.addEventListener('beforeunload', () => {
  if (mode === 'multi' && socket.connected) socket.volatile.emit('leave_game');
  if (mode === 'group' && socket.connected) socket.volatile.emit('grp_leave');
});

// ─── Başlat ──────────────────────────────────────────────────

init();
