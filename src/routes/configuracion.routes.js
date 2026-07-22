const express = require('express');
const multer = require('multer');
const configuracionService = require('../services/configuracion.service');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 3 * 1024 * 1024 } });

router.get('/', (req, res) => {
  res.json(configuracionService.obtener());
});

router.put('/', (req, res) => {
  res.json(configuracionService.actualizar(req.body));
});

router.post('/logo', upload.single('logo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió ninguna imagen' });
  const dataUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
  res.json(configuracionService.actualizar({ logo_url: dataUrl }));
});

module.exports = router;
