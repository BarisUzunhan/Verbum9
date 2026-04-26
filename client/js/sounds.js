let ctx = null;

function audio() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  return ctx;
}

function tone(freq, duration, type = 'sine', volume = 0.25) {
  const ac = audio();
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.connect(gain);
  gain.connect(ac.destination);
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(volume, ac.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + duration);
  osc.start(ac.currentTime);
  osc.stop(ac.currentTime + duration);
}

export function playWordFound() {
  const ac = audio();
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.connect(gain);
  gain.connect(ac.destination);
  osc.type = 'sine';
  osc.frequency.setValueAtTime(660, ac.currentTime);
  osc.frequency.exponentialRampToValueAtTime(880, ac.currentTime + 0.1);
  gain.gain.setValueAtTime(0.3, ac.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.35);
  osc.start(ac.currentTime);
  osc.stop(ac.currentTime + 0.35);
}

export function playWarningBeep() {
  tone(440, 0.18, 'sine', 0.2);
}

export function playUrgentBeep() {
  tone(660, 0.12, 'sine', 0.22);
}

export function playInvalidWord() {
  tone(220, 0.15, 'sawtooth', 0.12);
}
