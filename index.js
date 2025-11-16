const express = require('express');
const multer = require('multer');
const FormData = require('form-data');

// node-fetch'i dinamik import ile kullanıyoruz
const fetch = (...args) =>
  import('node-fetch').then(({ default: fetch }) => fetch(...args));

const upload = multer();
const app = express();

const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
}

app.get('/', (req, res) => {
  res.send('Feradomo Lens API çalışıyor.');
});

app.post('/lens', upload.single('image'), async (req, res) => {
  try {
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OPENAI_API_KEY tanımlı değil.' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'image alanı boş.' });
    }

    const model = req.body.model || 'ceres-spatiosa';

    let modelDescription = 'microcement coffee table';
    if (model === 'castrum') {
      modelDescription = 'Feradomo Castrum microcement console table';
    } else if (model === 'ceres-spatiosa') {
      modelDescription = 'Feradomo Ceres Spatiosa microcement coffee table';
    } else if (model === 'custom') {
      modelDescription = 'custom Feradomo microcement design table';
    }

    const prompt = `
      Ultra realistic photo of the SAME interior space, with a ${modelDescription}
      placed in the correct perspective on the floor, matching the existing light and shadows.
      Keep the original walls, floor, furniture and colors. Only add the table in a natural way.
      High-end interior photography, 4k, no text, no extra objects.
    `;

    const form = new FormData();
    form.append('model', 'gpt-image-1');
    form.append('prompt', prompt);
    form.append('image', req.file.buffer, {
      filename: req.file.originalname || 'room.png'
    });
    form.append('size', '1024x1024');
    form.append('response_format', 'b64_json');

    const response = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        ...form.getHeaders()
      },
      body: form
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenAI hata:', errorText);
      return res.status(500).json({ error: 'OpenAI isteği başarısız.' });
    }

    const data = await response.json();

    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) {
      return res.status(500).json({ error: 'OpenAI yanıtı beklenen formatta değil.' });
    }

    res.json({ image: b64 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Sunucu hatası.' });
  }
});

app.listen(PORT, () => {
  console.log(`Feradomo Lens API port ${PORT} üzerinde çalışıyor.`);
});
