# Verbum9 — Tasarım Dokümanı

## Bağlam

Verbum9, Türkçe odaklı bir online kelime yarışı oyunudur. Temel mekaniği: 3×3 (9 harfli) bir matrisi iki oyuncunun sırayla doldurması, ardından 3 dakika boyunca matristeki harflerle (kullanım sayısı kadar) sözlükte yer alan geçerli kelimeleri yazmaya çalışmasıdır. Karşı tarafta olmayan her kelime, harf sayısı kadar puan kazandırır.

Dokümanda tanımlı geniş özellik kümesi: 1v1 online + tek oyunculu + sınıf modu (çoklu) + günlük oyun, hesap & sosyal giriş, arkadaş sistemi, ipucu, KL oyun parası, seviye sistemi, mesajlaşma, sözlük yönetimi/itiraz, admin panel, bot rakip.

**Geliştirme profili:**
- Yazılım deneyimi sınırlı; HTML / CSS / JS rahat olunan kısım.
- Yaklaşım: **Aşamalı MVP** — her aşamanın sonunda çalışan bir sürüm olacak.
- Platform: Önce **web + PWA** (mobilde de tarayıcıda çalışır, ana ekrana eklenebilir). Sonradan native mobil yolu açık.
- Hedef: Önce lokalde öğren, sonra ücretsiz tier hosting'e yayınla.
- Sözlük: Açık kaynak / TDK temelli temel liste **+** bizim kontrol ettiğimiz onay/red katmanı.

---

## Teknoloji Yığını

| Katman | Seçim | Neden |
|---|---|---|
| **Frontend** | Vanilla **HTML + CSS + JavaScript** (ES module) | Mevcut bilgi seviyesine uygun; framework öğrenme yükü yok. |
| **PWA** | `manifest.json` + Service Worker | Mobilde ana ekrana eklenir, offline tek oyunculu çalışır. |
| **Backend** | **Node.js + Express** | JavaScript tek dilli → öğrenme yükü minimum. |
| **Gerçek zamanlı** | **Socket.IO** | Harf seçimi, kelime yazımı, skor güncellemeleri için. |
| **Veritabanı (lokal)** | **SQLite** | Tek dosya, kurulum yok. Öğrenirken ideal. |
| **Veritabanı (canlı)** | **PostgreSQL** (Railway/Supabase) | Yayına çıkarken SQLite'tan göç. Aynı SQL dili. |
| **ORM** | **Prisma** | Şema tanımı, migration, tip güvenliği. |
| **Auth** | bcrypt + JWT → sonra **Firebase Auth** | Sosyal login hazır servis ile daha az iş. |
| **Native (sonradan)** | **Capacitor** | Aynı HTML/CSS/JS → Android+iOS. |
| **Hosting** | Vercel (frontend) + Railway/Render (backend) | Ücretsiz tier. |
| **Sözlük** | Açık kaynak + bizim onay katmanı | Kaynak + admin override + kullanıcı itirazı. |

---

## Kritik Mimari Kararlar

### Sözlük yönetimi

Üç katman:

- `base_words` — Açık kaynaktan içe aktarılan ham liste.
- `admin_overrides` — `approved` / `rejected` kararları.
- `user_disputes` — Kullanıcı itirazları; admin paneline düşer.

**Geçerlilik algoritması:**
```
override = admin_overrides[word]
if override == 'rejected'  → geçersiz
if override == 'approved'  → geçerli
if word in base_words      → geçerli
else                       → geçersiz
```

**Sesteş kelimeler:** `homophone_words` listesi — bu kelimeler oyunda iki kez yazılabilir.

**Emir kipi filtresi:** MVP'de Zemberek-NLP çıktısı; derin morfoloji Faz 6'da.

### 1v1 Eşzamanlılık

- Oyun durumu **sunucuda** tutulur.
- Her oyun `roomId` ile Socket.IO room.
- Zamanlayıcı sunucuda; istemciye tick gönderilir.
- Bağlantı koparsa: 30 sn reconnect penceresi.

### Veritabanı Şeması

```
users         (id, username UNIQUE, email, password_hash, social_provider, social_id,
               language, total_score, level, kl_balance, created_at)
games         (id, mode, status, started_at, ended_at, winner_id)
game_players  (game_id, user_id, score, hints_used, joined_at)
game_words    (id, game_id, user_id, word, letter_count, score, status)
matrix_letters(game_id, position [0-8], letter)
friendships   (user_id, friend_id, status, created_at)
invitations   (from_user, to_user, game_id, status, expires_at)
base_words        (word PK)
admin_overrides   (word PK, decision, decided_by, decided_at, reason)
user_disputes     (id, user_id, word, game_id, status, created_at, resolved_at)
homophone_words   (word, count)
daily_game        (id, date UNIQUE, matrix_letters, ended)
chat_messages     (game_id, from_user, to_user, message_template_id, sent_at)
```

---

## Aşamalı Yol Haritası

> Her fazın sonunda **çalışan, oynanabilir** bir sürüm olacak.

### Faz 0 — Hazırlık
- Klasör yapısı, git init, npm init.
- Boş Express + statik HTML → "Hello Verbum9".

### Faz 1 — Tek Oyunculu Çekirdek (backend yok)
- 3×3 matris UI, harf seçimi (sıralı + rastgele).
- 5 sn geri sayım + 3 dk oyun saati.
- Kelime girişi (matris harfleri kontrolü + statik sözlük).
- Skor hesabı, yan panel, özet ekranı, ses efektleri.
- Mobil dokunmatik uyumlu.
- **Doğrulama:** Telefon tarayıcısında baştan sona oyun oyna.

### Faz 2 — Sözlük Altyapısı
- Açık kaynak Türkçe kelime listesi → SQLite.
- `/api/dictionary/check` endpoint.
- Sesteş ve emir kipi filtreleri.

### Faz 3 — Hesap & Profil & Veritabanı
- Kayıt / giriş (bcrypt + JWT).
- Profil sayfası, seviye hesabı.
- Oyun sonuçları DB'ye.

### Faz 4 — Online 1v1 (Socket.IO)
- Eşleştirme kuyruğu, bot atama.
- Oyun odası, kelime doğrulama sunucuda.
- Sonuç ekranı: kelime karşılaştırma tablosu.

### Faz 5 — KL Para, İpucu, Seviye, Daily
- KL bakiyesi (sadece 1v1).
- 150 KL = 1 ipucu.
- Günlük oyun (günde 1 kez, ertesi gün sonuçlar).

### Faz 6 — Sosyal & Çoklu Mod
- Arkadaş listesi, davet, hazır mesajlar.
- Çoklu mod (sınıf/salon): puan = harf × olmayan kişi sayısı.

### Faz 7 — Admin Panel & İtiraz Yönetimi
- `/admin` sayfası, itiraz listesi, onay/red, blacklist.

### Faz 8 — Sosyal Login & PWA
- Firebase Auth (Google, Facebook, Instagram).
- `manifest.json` + Service Worker, offline mod.

### Faz 9 — Yayına Alma
- Vercel + Railway, SQLite→Postgres göçü.
- Domain, HTTPS, Sentry, analitik.

### Faz 10 — Native (sonradan, opsiyonel)
- Capacitor ile Android + iOS.
- Push notification.

---

## Klasör Yapısı

```
Verbum9/
├── client/
│   ├── index.html
│   ├── css/
│   ├── js/
│   │   ├── game.js       # Oyun mantığı
│   │   ├── ui.js         # DOM
│   │   ├── socket.js     # Socket.IO istemci
│   │   └── api.js        # REST çağrıları
│   ├── assets/           # Sesler, ikonlar
│   └── manifest.json
├── server/
│   ├── index.js
│   ├── routes/
│   ├── sockets/
│   ├── game/
│   ├── dictionary/
│   └── auth/
├── shared/
├── prisma/
│   └── schema.prisma
├── data/
│   ├── base_words.txt
│   └── homophones.txt
├── TASARIM.md            # Bu dosya
└── package.json
```

---

## Bekleyen Kararlar (Sıradaki Fazlarda Netleşecek)

1. **Domain** — `verbum9.com` müsaitlik kontrolü (Faz 9 öncesi).
2. **Logo / görsel kimlik** — Faz 8'de.
3. **Çoklu dil** — MVP sadece Türkçe.
4. **KVKK/yasal** — Faz 9 öncesi.
5. **Bot zekası** — Başlangıçta basit; daha akıllı bot Faz 6'da.

---

## Sürüm Geçmişi

### v1.0 — 2026-04-26
- İlk tasarım dokümanı oluşturuldu.
- `Vebum9.docx` analiz edildi; tüm özellikler özetlendi.
- Teknoloji yığını ve 11 fazlı yol haritası belirlendi.
- Sözlük üç katmanlı mimari tanımlandı.
- Veritabanı şema taslağı oluşturuldu.
