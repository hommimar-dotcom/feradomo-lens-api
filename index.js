// index.js
const express = require('express');
const multer = require('multer');
const FormData = require('form-data');

// node-fetch v3 ESM olduğu için CJS içinde dinamik import ile kullanıyoruz
const fetch = (...args) =>
  import('node-fetch').then(({ default: fetch }) => fetch(...args));

const app = express();
const upload = multer();

const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

if (!OPENAI_API_KEY) {
  console.warn('⚠️ OPENAI_API_KEY tanımlı değil. Render ortam değişkenini kontrol et.');
}

// CORS – Shopify için açık
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*'); // istersen buraya feradomo.com yazabilirsin
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

// Basit sağlık kontrolü
app.get('/', (req, res) => {
  res.send('Feradomo Lens API çalışıyor ✅');
});

// Ana endpoint: /lens
app.post('/lens', upload.single('image'), async (req, res) => {
  try {
    // Dosya yoksa hata
    if (!req.file) {
      return res
        .status(400)
        .json({ error: 'Bir sahne (fotoğraf) yüklemen gerekiyor.' });
    }

    if (!OPENAI_API_KEY) {
      console.error('OPENAI_API_KEY tanımlı değil!');
      return res.status(500).json({
        error: 'OPENAI_API_KEY eksik. Render ortam değişkenlerini kontrol et.'
      });
    }

    // Shopify tarafında gönderdiğin model değeri (ceres-spatiosa / castrum / custom)
    const selectedModel = req.body.model || 'ceres-spatiosa';

    // Prompt içinde kullanmak için açıklayıcı isimler
    let tableDescription = 'Feradomo microcement coffee table';
    if (selectedModel === 'ceres-spatiosa') {
      tableDescription =
        'Feradomo Ceres Spatiosa microcement coffee table, soft off-white, silent luxury style';
    } else if (selectedModel === 'castrum') {
      tableDescription =
        'Feradomo Castrum microcement console table, sculptural form, silent luxury style';
    } else if (selectedModel === 'custom') {
      tableDescription =
        'a custom Feradomo microcement table designed for this space, silent luxury style';
    }

    // OpenAI için prompt
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

    // OpenAI images/edits isteği için form-data hazırlığı
    const formData = new FormData();
    formData.append('model', 'gpt-image-1');
    formData.append('prompt', prompt);

    // Orijinal sahne fotoğrafını "image" alanına ekliyoruz
    formData.append('image', req.file.buffer, {
      filename: req.file.originalname || 'scene.jpg',
      contentType: req.file.mimetype || 'image/jpeg'
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

    if (!openaiResponse.ok) {
      const errorText = await openaiResponse.text();
      console.error('❌ OpenAI hata:', openaiResponse.status, errorText);
      return res.status(500).json({
        error: 'openai_error',
        status: openaiResponse.status,
        detail: errorText,
        message: 'Görsel sahnelenirken OpenAI tarafında bir hata oluştu.'
      });
    }

    const json = await openaiResponse.json();
    const b64 = json?.data?.[0]?.b64_json;

    if (!b64) {
      console.error('❌ OpenAI cevabında b64_json bulunamadı:', json);
      return res.status(500).json({
        error: 'no_image_in_response',
        raw: json,
        message: 'OpenAI cevap döndü ama içinde görsel bulunamadı.'
      });
    }

    // Frontend şu anda base64 + mime bekliyor; mime'ı sabit png verdik
    const mime = 'image/png';

    console.log('✅ OpenAI sahneleme tamam, sonuç gönderiliyor.');

    return res.json({
      ok: true,
      image: b64,
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
  console.log(`Feradomo Lens API port ${PORT} üzerinde çalışıyor`);
});
