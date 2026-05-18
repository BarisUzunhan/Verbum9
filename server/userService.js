const crypto   = require('crypto');
const supabase  = require('./supabase');

// ─── E-posta şifrelemesi (AES-256-GCM) ───────────────────────────

const EMAIL_ALGO = 'aes-256-gcm';

function encryptEmail(email) {
  const hex = process.env.EMAIL_ENCRYPTION_KEY;
  if (!hex || !email) return email || null;
  const key = Buffer.from(hex, 'hex');
  const iv  = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(EMAIL_ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(email, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

function decryptEmail(stored) {
  if (!stored) return null;
  const hex = process.env.EMAIL_ENCRYPTION_KEY;
  // Şifreleme anahtarı yoksa veya değer düz metinse (eski kayıtlar) olduğu gibi döndür
  if (!hex || !stored.includes(':')) return stored;
  try {
    const key = Buffer.from(hex, 'hex');
    const [ivHex, tagHex, dataHex] = stored.split(':');
    const decipher = crypto.createDecipheriv(EMAIL_ALGO, key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

// ─── Seviye hesabı ────────────────────────────────────────────────

function calcLevel(totalScore) {
  if (totalScore < 100) return 1;
  if (totalScore < 500) return 2;
  return 3 + Math.floor((totalScore - 500) / 1000);
}

// ─── DB (snake_case) ↔ JS (camelCase) dönüşümü ───────────────────

function fromDB(u) {
  if (!u) return null;
  return {
    id:                u.id,
    username:          u.username,
    passwordHash:      u.password_hash,
    token:             u.token,
    email:             decryptEmail(u.email),
    emailVerified:     u.email_verified     ?? false,
    verificationToken: u.verification_token ?? null,
    totalScore:        u.total_score,
    level:             u.level,
    klBalance:         u.kl_balance,
    gamesPlayed:       u.games_played,
    gamesWon:          u.games_won,
    createdAt:         u.created_at,
  };
}

function toDB(u) {
  return {
    id:                 u.id,
    username:           u.username,
    password_hash:      u.passwordHash,
    token:              u.token             ?? null,
    email:              encryptEmail(u.email),
    email_verified:     u.emailVerified     ?? false,
    verification_token: u.verificationToken ?? null,
    total_score:        u.totalScore   || 0,
    level:              u.level        || 1,
    kl_balance:         u.klBalance    || 0,
    games_played:       u.gamesPlayed  || 0,
    games_won:          u.gamesWon     || 0,
    created_at:         u.createdAt,
  };
}

// ─── Hassas alanları gizle ────────────────────────────────────────

function safeUser(u) {
  if (!u) return null;
  const { passwordHash, token, email, ...rest } = u;
  return rest;
}

// ─── Okuma ───────────────────────────────────────────────────────

async function getUserByToken(token) {
  if (!token) return null;
  const { data } = await supabase
    .from('users').select('*').eq('token', token).maybeSingle();
  return fromDB(data);
}

async function getUserByVerificationToken(token) {
  if (!token) return null;
  const { data } = await supabase
    .from('users').select('*').eq('verification_token', token).maybeSingle();
  return fromDB(data);
}

async function verifyEmail(token) {
  const { data } = await supabase
    .from('users')
    .update({ email_verified: true, verification_token: null })
    .eq('verification_token', token)
    .select().single();
  return fromDB(data);
}

async function setVerificationToken(userId, token) {
  await supabase
    .from('users')
    .update({ verification_token: token })
    .eq('id', userId);
}

async function getUserByUsername(username) {
  const norm = (username || '').trim().toLocaleLowerCase('tr-TR');
  const { data } = await supabase
    .from('users').select('*').ilike('username', norm).maybeSingle();
  return fromDB(data);
}

async function getUserByEmail(email) {
  if (!email) return null;
  const emailNorm = email.trim().toLowerCase();
  const { data } = await supabase.from('users').select('*');
  if (!data) return null;
  let fallback = null;
  for (const row of data) {
    const decrypted = decryptEmail(row.email);
    if (decrypted && decrypted.toLowerCase() === emailNorm) {
      if (row.email_verified) return fromDB(row);
      fallback = row;
    }
  }
  return fromDB(fallback);
}

async function resetPassword(token, newPasswordHash) {
  const { data } = await supabase
    .from('users')
    .update({ password_hash: newPasswordHash, verification_token: null })
    .eq('verification_token', token)
    .select().single();
  return fromDB(data);
}

// ─── Yazma ───────────────────────────────────────────────────────

async function createUser(userData) {
  const { data, error } = await supabase
    .from('users').insert(toDB(userData)).select().single();
  if (error) throw error;
  return fromDB(data);
}

async function updateUserToken(id, token) {
  const { data } = await supabase
    .from('users').update({ token }).eq('id', id).select().single();
  return fromDB(data);
}

async function deductKL(token, amount) {
  if (!token) return null;
  const user = await getUserByToken(token);
  if (!user || (user.klBalance || 0) < amount) return null;
  const { data } = await supabase
    .from('users')
    .update({ kl_balance: user.klBalance - amount })
    .eq('id', user.id).select().single();
  return safeUser(fromDB(data));
}

async function recordGameResult(token, { scoreDelta, won }) {
  if (!token) return null;
  const user = await getUserByToken(token);
  if (!user) return null;

  const newScore = (user.totalScore || 0) + scoreDelta;
  const { data } = await supabase
    .from('users')
    .update({
      total_score:  newScore,
      kl_balance:   (user.klBalance  || 0) + scoreDelta,
      games_played: (user.gamesPlayed || 0) + 1,
      games_won:    (user.gamesWon    || 0) + (won ? 1 : 0),
      level:        calcLevel(newScore),
    })
    .eq('id', user.id).select().single();
  return safeUser(fromDB(data));
}

// ─── Dışa aktarım ────────────────────────────────────────────────

module.exports = {
  calcLevel,
  safeUser,
  getUserByToken,
  getUserByUsername,
  getUserByEmail,
  getUserByVerificationToken,
  createUser,
  updateUserToken,
  verifyEmail,
  setVerificationToken,
  resetPassword,
  deductKL,
  recordGameResult,
};
