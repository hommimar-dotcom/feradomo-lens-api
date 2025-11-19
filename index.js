// index.js
const express = require('express');
const multer = require('multer');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

// node-fetch v3 ESM olduğu için CJS içinde dinamik import ile kullanıyoruz
const fetch = (...args) =>
  import('node-fetch').then(({ default: fetch }) => fetch(...args));

const app = express();

// Dosyaları RAM'de tutalım (hem Lens hem Not için)
const upload = multer({ storage: multer.memoryStorage() });

const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const ADMIN_TOKEN = process.env.FERADOMO_ADMIN_TOKEN || '';

if (!OPENAI_API_KEY) {
  console.warn(
    '⚠️ OPENAI_API_KEY tanımlı değil. Lens endpointi çalışırken buna ihtiyacımız var.'
  );
}

// CORS – Shopify için açık
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*'); // istersen buraya feradomo.com yazabilirsin
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

// JSON body (ileride başka şeyler için lazım olabilir diye dursun)
app.use(express.json({ limit: '5mb' }));

// ---------------------------------------------------
// 1) FERADOMO KOLEKTİF DEFTERİ – EL YAZISI NOT YÜKLEME
// ---------------------------------------------------

// Not görselleri ve mini "database" için yollar
const NOTES_DIR = path.join(__dirname, 'public', 'feradomo-notes');
const NOTES_DB = path.join(__dirname, 'feradomo-notes-db.json');

// Klasör / dosya yoksa oluştur
if (!fs.existsSync(NOTES_DIR)) {
  fs.mkdirSync(NOTES_DIR, { recursive: true });
}
if (!fs.existsSync(NOTES_DB)) {
  fs.writeFileSync(NOTES_DB, '[]', 'utf-8');
}

function readNotes() {
  try {
    const raw = fs.readFileSync(NOTES_DB, 'utf-8');
    return JSON.parse(raw);
  } catch (_err) {
    return [];
  }
}

function writeNotes(notes) {
  fs.writeFileSync(NOTES_DB, JSON.stringify(notes, null, 2), 'utf-8');
}

// Basit HTML escape (admin panelde isim/kod yazarken)
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Yüklenen not görsellerini public olarak servis et
app.use('/feradomo-notes', express.static(NOTES_DIR));

// Tüm notları getir (approvedOnly parametresi ile filtre)
app.get('/api/feradomo-not', (req, res) => {
  try {
    const { approvedOnly } = req.query;
    let notes = readNotes();

    if (approvedOnly === '1') {
      notes = notes.filter((n) => n && n.approved);
    }

    console.log(
      `📖 GET /api/feradomo-not (approvedOnly=${approvedOnly}) -> ${notes.length} kayıt`
    );
    res.json(notes);
  } catch (err) {
    console.error('GET /api/feradomo-not error', err);
    res.status(500).json({ error: 'server_error' });
  }
});

// Yeni not kaydet – FormData ile "note" dosyası + fullName + productCode
app.post('/api/feradomo-not', upload.single('note'), (req, res) => {
  try {
    console.log('➡️  POST /api/feradomo-not alındı');
    console.log('   body:', req.body);
    console.log('   file:', req.file && req.file.originalname);

    const file = req.file;
    const { fullName, productCode } = req.body || {};

    if (!file) {
      console.warn('⚠️  Dosya yok');
      return res.status(400).json({
        ok: false,
        error: 'file_missing',
        message: 'El yazısı not fotoğrafı zorunludur.'
      });
    }

    if (!fullName || !productCode) {
      console.warn('⚠️  Zorunlu alanlar eksik', { fullName, productCode });
      return res.status(400).json({
        ok: false,
        error: 'fields_missing',
        message: 'İsim Soyisim ve ürün kodu zorunludur.'
      });
    }

    const id = Date.now().toString();
    const ext = path.extname(file.originalname || '').toLowerCase() || '.png';
    const filename = `note-${id}${ext}`;
    const filepath = path.join(NOTES_DIR, filename);

    // Buffer'ı direkt diske yaz
    fs.writeFileSync(filepath, file.buffer);

    const publicUrl = `/feradomo-notes/${filename}`;

    const notes = readNotes();
    const note = {
      id,
      imageUrl: publicUrl,
      fullName: fullName.slice(0, 80),
      productCode: productCode.slice(0, 80),
      createdAt: new Date().toISOString(),
      approved: false // onay süreci için default false
    };

    // En başa ekle, maksimum 200 kayıt tut
    notes.unshift(note);
    writeNotes(notes.slice(0, 200));

    console.log('📝 Yeni not kaydedildi:', {
      id: note.id,
      fullName: note.fullName,
      productCode: note.productCode
    });

    res.json({
      ok: true,
      note,
      message: 'Notun kaydedildi. Teşekkür ederiz.'
    });
  } catch (err) {
    console.error('POST /api/feradomo-not error', err);
    res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// Belirli bir notu onaylamak için basit admin endpoint
// Kullanım: GET /api/feradomo-not-approve?id=...&token=FERADOMO_ADMIN_TOKEN
app.get('/api/feradomo-not-approve', (req, res) => {
  try {
    if (!ADMIN_TOKEN) {
      return res.status(500).json({
        ok: false,
        error: 'no_admin_token',
        message: 'FERADOMO_ADMIN_TOKEN tanımlı değil.'
      });
    }

    const { id, token } = req.query;

    if (!id || !token) {
      return res.status(400).json({
        ok: false,
        error: 'missing_params',
        message: 'id ve token zorunludur.'
      });
    }

    if (token !== ADMIN_TOKEN) {
      return res.status(403).json({
        ok: false,
        error: 'forbidden',
        message: 'Geçersiz admin token.'
      });
    }

    const notes = readNotes();
    const idx = notes.findIndex((n) => String(n.id) === String(id));

    if (idx === -1) {
      return res.status(404).json({
        ok: false,
        error: 'not_found',
        message: 'Not bulunamadı.'
      });
    }

    notes[idx].approved = true;
    writeNotes(notes);

    console.log('✅ Not onaylandı:', {
      id: notes[idx].id,
      fullName: notes[idx].fullName,
      productCode: notes[idx].productCode
    });

    return res.json({ ok: true, note: notes[idx] });
  } catch (err) {
    console.error('GET /api/feradomo-not-approve error', err);
    res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// ---------------------------------------------------
// 1.b) BASİT ADMIN PANEL – NOTLARI LİSTELE / ONAYLA
// ---------------------------------------------------
// URL: /admin/feradomo-not?token=FERADOMO_ADMIN_TOKEN
app.get('/admin/feradomo-not', (req, res) => {
  try {
    if (!ADMIN_TOKEN) {
      return res
        .status(500)
        .send('FERADOMO_ADMIN_TOKEN tanımlı değil. Environment ayarlarını kontrol et.');
    }

    const { token, showAll } = req.query;

    if (!token || token !== ADMIN_TOKEN) {
      return res.status(403).send('Yetkisiz erişim. (Geçersiz token)');
    }

    let notes = readNotes();

    // Varsayılan: sadece onaysızları göster
    if (showAll !== '1') {
      notes = notes.filter((n) => !n.approved);
    }

    const safeToken = encodeURIComponent(token);

    const itemsHtml = notes
      .map((note) => {
        const id = escapeHtml(note.id);
        const fullName = escapeHtml(note.fullName || '');
        const productCode = escapeHtml(note.productCode || '');
        const createdAt = escapeHtml(
          note.createdAt ? new Date(note.createdAt).toLocaleString('tr-TR') : ''
        );
        const imgSrc = escapeHtml(note.imageUrl || '');

        const approveUrl = `/api/feradomo-not-approve?id=${encodeURIComponent(
          note.id
        )}&token=${safeToken}`;

        const statusLabel = note.approved ? 'Onaylı' : 'Onaysız';

        return `
          <article class="note-card" data-note-id="${id}">
            <div class="note-image-wrap">
              ${
                imgSrc
                  ? `<img src="${imgSrc}" alt="El yazısı not – ${fullName}" />`
                  : '<div class="no-image">Görsel yok</div>'
              }
            </div>
            <div class="note-meta">
              <div class="note-name">${fullName || 'İsim yok'}</div>
              <div class="note-code">${productCode || 'Kod yok'}</div>
              <div class="note-created">${createdAt}</div>
              <div class="note-status ${
                note.approved ? 'note-status--approved' : 'note-status--pending'
              }">${statusLabel}</div>
            </div>
            <div class="note-actions">
              ${
                note.approved
                  ? '<button class="note-btn note-btn--disabled" disabled>Onaylı</button>'
                  : `<button class="note-btn" data-approve-url="${approveUrl}">Onayla</button>`
              }
            </div>
          </article>
        `;
      })
      .join('\n');

    const html = `
<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8" />
  <title>Feradomo Kolektif – Not Yönetimi</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body {
      margin: 0;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
      background: #050505;
      color: #f5f1e8;
    }
    .page {
      max-width: 1200px;
      margin: 0 auto;
      padding: 24px 16px 40px;
    }
    .page-header {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: 8px;
      align-items: baseline;
      margin-bottom: 16px;
    }
    .page-title {
      font-size: 20px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }
    .page-subtitle {
      font-size: 13px;
      opacity: 0.8;
    }
    .page-filters {
      display: flex;
      gap: 8px;
      align-items: center;
      font-size: 12px;
      margin-top: 8px;
    }
    .page-link {
      color: #f5e0bf;
      text-decoration: none;
      border-bottom: 1px dotted rgba(245, 224, 191, 0.7);
    }
    .page-link:hover {
      opacity: 0.9;
    }
    .notes-grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 16px;
      margin-top: 24px;
    }
    @media (min-width: 640px) {
      .notes-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
    @media (min-width: 960px) {
      .notes-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
    }
    .note-card {
      background: #111;
      border-radius: 18px;
      padding: 10px 10px 8px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .note-image-wrap {
      background: #000;
      border-radius: 14px;
      padding: 8px;
      overflow: hidden;
      max-height: 260px;
    }
    .note-image-wrap img {
      width: 100%;
      height: auto;
      display: block;
      object-fit: contain;
    }
    .no-image {
      font-size: 12px;
      opacity: 0.7;
      text-align: center;
      padding: 24px 0;
    }
    .note-meta {
      padding: 4px 4px 2px;
      display: flex;
      flex-direction: column;
      gap: 2px;
      font-size: 12px;
    }
    .note-name {
      font-size: 12px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      opacity: 0.95;
    }
    .note-code {
      font-size: 11px;
      opacity: 0.8;
    }
    .note-created {
      font-size: 11px;
      opacity: 0.65;
    }
    .note-status {
      margin-top: 3px;
      font-size: 11px;
      padding: 3px 8px;
      border-radius: 999px;
      display: inline-block;
    }
    .note-status--pending {
      background: rgba(245, 224, 191, 0.1);
      color: #f5e0bf;
    }
    .note-status--approved {
      background: rgba(142, 250, 184, 0.1);
      color: #8efab8;
    }
    .note-actions {
      display: flex;
      justify-content: flex-end;
      margin-top: 6px;
    }
    .note-btn {
      border-radius: 999px;
      padding: 6px 14px;
      font-size: 12px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      cursor: pointer;
      border: 1px solid #f5e0bf;
      background: #f5e0bf;
      color: #1a1208;
    }
    .note-btn:hover {
      opacity: 0.9;
    }
    .note-btn--disabled {
      background: transparent;
      color: rgba(245, 241, 232, 0.7);
      border-color: rgba(245, 241, 232, 0.3);
      cursor: default;
    }
    .empty-state {
      font-size: 13px;
      opacity: 0.75;
      margin-top: 24px;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="page-header">
      <div>
        <div class="page-title">FERADOMO KOLEKTİF – NOT YÖNETİMİ</div>
        <div class="page-subtitle">
          Müşterilerin yüklediği el yazısı notları buradan inceleyip onaylayabilirsin.
        </div>
      </div>
      <div class="page-filters">
        <span>Filtre:</span>
        <a class="page-link" href="/admin/feradomo-not?token=${safeToken}">Sadece onaysız</a>
        <span>·</span>
        <a class="page-link" href="/admin/feradomo-not?token=${safeToken}&showAll=1">Tüm notlar</a>
      </div>
    </div>

    ${
      notes.length
        ? `<div class="notes-grid">${itemsHtml}</div>`
        : '<div class="empty-state">Gösterilecek not yok.</div>'
    }
  </div>

  <script>
    (function () {
      const buttons = document.querySelectorAll('[data-approve-url]');
      buttons.forEach(function (btn) {
        btn.addEventListener('click', async function () {
          const url = btn.getAttribute('data-approve-url');
          if (!url) return;

          btn.disabled = true;
          const originalText = btn.textContent;
          btn.textContent = 'Onaylanıyor...';

          try {
            const res = await fetch(url);
            const data = await res.json().catch(() => ({}));

            if (!res.ok || !data || data.ok === false) {
              alert('Onay sırasında bir hata oluştu.');
              btn.disabled = false;
              btn.textContent = originalText;
              return;
            }

            const card = btn.closest('.note-card');
            if (card) {
              card.style.opacity = '0.4';
              card.style.pointerEvents = 'none';
            }
            btn.textContent = 'Onaylandı';
          } catch (err) {
            console.error('Approve error', err);
            alert('Bağlantı hatası. Tekrar dene.');
            btn.disabled = false;
            btn.textContent = originalText;
          }
        });
      });
    })();
  </script>
</body>
</html>
    `;

    res.send(html);
  } catch (err) {
    console.error('GET /admin/feradomo-not error', err);
    res.status(500).send('Sunucu hatası.');
  }
});

// ------------------------------------
// 2) SAĞLIK KONTROLÜ (root endpoint)
// ------------------------------------
app.get('/', (req, res) => {
  res.send('Feradomo Lens & Kolektif API çalışıyor ✅');
});

// ------------------------------------
// 3) FERADOMO LENS – SEHPA YERLEŞTİRME
// ------------------------------------

// Ana endpoint: /lens
// upload.any: Shopify'dan field name değişse bile sorun yaşama
app.post('/lens', upload.any(), async (req, res) => {
  try {
    const file =
      (req.files && req.files.find((f) => f.fieldname === 'image')) ||
      (req.files && req.files[0]) ||
      req.file;

    if (!file) {
      console.error('❌ Dosya bulunamadı. Gelen fields:', req.files);
      return res
        .status(400)
        .json({ error: 'no_image', message: 'Bir sahne (fotoğraf) yüklemen gerekiyor.' });
    }

    const fileBuffer = file.buffer;
    const originalName = file.originalname || 'scene.jpg';
    const mimeType = file.mimetype || 'image/jpeg';

    if (!OPENAI_API_KEY) {
      console.error('OPENAI_API_KEY tanımlı değil!');
      return res.status(500).json({
        error: 'no_api_key',
        message: 'OPENAI_API_KEY eksik. Render ortam değişkenlerini kontrol et.'
      });
    }

    // Shopify tarafında gönderdiğin model değeri (regina / ceres-spatiosa / castrum / custom vs.)
    const selectedModel = req.body.model || 'ceres-spatiosa';

    let tableDescription = 'Feradomo microcement coffee table';
    if (selectedModel === 'ceres-spatiosa') {
      tableDescription =
        'Feradomo Ceres Spatiosa microcement coffee table, soft off-white, silent luxury style';
    } else if (selectedModel === 'castrum') {
      tableDescription =
        'Feradomo Castrum microcement console table, sculptural form, silent luxury style';
    } else if (selectedModel === 'regina') {
      tableDescription =
        'Feradomo Regina microcement coffee table, soft organic form, silent luxury style';
    } else if (selectedModel === 'custom') {
      tableDescription =
        'a custom Feradomo microcement table designed for this space, silent luxury style';
    }

    const prompt = `
You are a high-end interior renderer for a luxury microcement furniture brand called Feradomo.

Take the uploaded interior photograph and realistically place a ${tableDescription} into the scene.

Rules:
- Keep perspective, camera angle, and composition consistent with the original photo.
- Match the lighting and shadows of the room so the table feels real, not CGI.
- Respect the existing color palette: warm beige tones, soft microcement textures, calm and minimal.
- Do not change walls, windows, or existing furniture except what is strictly necessary to place the table naturally.
- Output a single ultra-realistic photo of the same room with the Feradomo table added.
    `.trim();

    const formData = new FormData();
    formData.append('model', 'gpt-image-1');
    formData.append('prompt', prompt);
    formData.append('size', '1536x1024');
    formData.append('n', '1');

    formData.append('image', fileBuffer, {
      filename: originalName,
      contentType: mimeType
    });

    console.log('📤 OpenAI images/edits isteği gönderiliyor...');

    const openaiResponse = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        ...formData.getHeaders()
      },
      body: formData
    });

    const rawText = await openaiResponse.text();
    let parsed = null;
    try {
      parsed = JSON.parse(rawText);
    } catch (_e) {
      // bazen text gelebilir; sorun değil
    }

    console.log('🔎 OpenAI raw cevap status:', openaiResponse.status);

    if (!openaiResponse.ok) {
      let apiMessage = 'OpenAI tarafında bir hata oluştu.';
      if (parsed && parsed.error && parsed.error.message) {
        apiMessage = parsed.error.message;
      }

      console.error('❌ OpenAI hata:', openaiResponse.status, rawText);

      return res.status(openaiResponse.status).json({
        error: 'openai_error',
        message: apiMessage,
        detail: rawText,
        status: openaiResponse.status
      });
    }

    const json = parsed || {};
    const b64 = json?.data?.[0]?.b64_json;

    if (!b64) {
      console.error('❌ OpenAI cevabında b64_json bulunamadı:', json);
      return res.status(500).json({
        error: 'no_image_in_response',
        message: 'OpenAI cevap döndü ama içinde görsel bulunamadı.',
        detail: rawText
      });
    }

    const mime = 'image/png';
    const dataUri = `data:${mime};base64,${b64}`;

    console.log('✅ OpenAI sahneleme tamam, sonuç gönderiliyor.');

    return res.json({
      ok: true,
      image: dataUri,
      mime,
      message: 'Sehpa mekânının içine yerleştirildi. Sessiz lüks sahnen hazır. ✨'
    });
  } catch (err) {
    console.error('❌ Lens hata:', err);
    res.status(500).json({
      error: 'server_error',
      message: 'Sunucu tarafında beklenmedik bir hata oluştu.'
    });
  }
});

// Sunucuyu ayağa kaldır
app.listen(PORT, () => {
  console.log(`Feradomo Lens & Kolektif API port ${PORT} üzerinde çalışıyor`);
});
