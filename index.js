const express = require('express');
const multer = require('multer');

const app = express();
const upload = multer();

const PORT = process.env.PORT || 3000;
// İleride OpenAI bağlayınca kullanacağız
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
app.post('/lens', upload.single('image'), async (req, res) => {
  try {
    // Dosya yoksa hata
    if (!req.file) {
      return res
        .status(400)
        .json({ error: 'Bir sahne (fotoğraf) yüklemen gerekiyor.' });
    }

    // Yüklenen dosyayı base64'e çevir
    const base64 = req.file.buffer.toString('base64');
    const mime = req.file.mimetype || 'image/jpeg';

    // Şimdilik DEMO: yüklediğin fotoğrafı geri döndürüyoruz
    return res.json({
      ok: true,
      image: base64,
      mime: mime,
      message:
        'Şu an demo modundayız. Yüklediğin fotoğrafı geri gösteriyorum; bir sonraki adımda sehpayı bu sahnenin içine yerleştirecek AI modelini bağlayacağız. 💫'
    });
  } catch (err) {
    console.error('Lens hata:', err);
    res.status(500).json({ error: 'Sunucu tarafında bir hata oluştu.' });
  }
});

// Sunucuyu ayağa kaldır
app.listen(PORT, () => {
  console.log(`Feradomo Lens API port ${PORT} üzerinde çalışıyor`);
});
