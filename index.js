const express = require('express');
const multer = require('multer');
const FormData = require('form-data');

// node-fetch'i dinamik import ile kullan
const fetch = (...args) =>
  import('node-fetch').then(({ default: fetch }) => fetch(...args));

const app = express();
const upload = multer();

const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

// CORS – şimdilik her yerden istek gelsin (Shopify preview vs. için)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
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
app.post('/lens', upload.single('scene'), async (req, res) => {
  try {
    // Dosya gelmemişse
    if (!req.file) {
      return res
        .status(400)
        .json({ error: 'Bir sahne (fotoğraf) yüklemen gerekiyor.' });
    }

    // Şimdilik DEMO: Gerçek AI yerine sabit bir demo görüntü dönüyoruz.
    // (Önce backend tamamen stabil olsun, sonra OpenAI entegrasyonunu ekleriz.)
    const demoUrl =
      'https://images.pexels.com/photos/37347/office-freelancer-computer-business-37347.jpeg?auto=compress&cs=tinysrgb&w=1600';

    return res.json({
      ok: true,
      // front-end hangi ismi beklerse ikisini de verelim
      imageUrl: demoUrl,
      previewUrl: demoUrl,
      message:
        'Şu an demo modundayız, backend sorunsuz çalışıyor. Sonraki adım: gerçek sahneleme AI entegrasyonu. 💫'
    });

    /**
     * NOT:
     * Buraya daha sonra gerçek OpenAI / başka AI servisi çağrısını ekleyeceğiz.
     * OPENAI_API_KEY'i environment variable olarak Render tarafına zaten koymuştun.
     */
  } catch (err) {
    console.error('Lens hata:', err);
    res.status(500).json({ error: 'Sunucu tarafında bir hata oluştu.' });
  }
});

// Sunucuyu ayağa kaldır
app.listen(PORT, () => {
  console.log(`Feradomo Lens API port ${PORT} üzerinde çalışıyor`);
});
