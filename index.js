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

if (!OPENAI_API_KEY) {
  console.warn('⚠️ OPENAI_API_KEY tanımlı değil. Lens endpointi çalışırken buna ihtiyacımız var.');
}

// CORS – Shopify için açık
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*'); // istersem buraya feradomo.com yazabilirsin
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

// JSON body (ileride lazım olabilir diye dursun)
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

// Yüklenen not görsellerini public olarak servis et
app.use('/feradomo-notes', express.static(NOTES_DIR));

// Tüm notları getir (ileride admin panel burayı kullanacak)
app.get('/api/feradomo-not', (req, res) => {
  try {
    const notes = readNotes();
    res.json(notes);
  } catch (err) {
    console.error('GET /api/feradomo-not error', err);
    res.status(500).json({ error: 'server_error' });
  }
});

// Yeni not kaydet – FormData ile "note" dosyası + fullName + productCode
app.post('/api/feradomo-not', upload.single('note'), (req, res) => {
  try {
    const file = req.file;
    const { fullName, productCode } = req.body || {};

    if (!file) {
      return res.status(400).json({
        ok: false,
        error: 'file_missing',
        message: 'El yazısı not fotoğrafı zorunludur.'
      });
    }

    if (!fullName || !productCode) {
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
      approved: false // ileride admin panelden onaylayacağız
    };

    // En başa ekle, maksimum 200 kayıt tut
    notes.unshift(note);
    writeNotes(notes.slice(0, 200));

    res.json({ ok: true, note });
  } catch (err) {
    console.error('POST /api/feradomo-not error', err);
    res.status(500).json({ ok: false, error: 'server_error' });
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
    // Gelen dosyayı bul: önce fieldname'i "image" olanı dene, yoksa ilk dosyayı al
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

    // Prompt içinde kullanmak için açıklayıcı isimler
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
