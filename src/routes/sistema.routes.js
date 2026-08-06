const express = require('express');
const authService = require('../services/auth.service');
const resetService = require('../services/reset.service');
const backupService = require('../services/backup.service');
const { emitSistemaReseteado } = require('../sockets');

const router = express.Router();

const FRASE_CONFIRMACION = 'BORRAR TODO';

router.get('/backup/estado', (req, res) => {
  res.json(backupService.estado());
});

router.get('/backup/descargar', async (req, res) => {
  try {
    await backupService.hacerBackup();
    const fecha = new Date().toISOString().slice(0, 10);
    res.download(backupService.ARCHIVO_BACKUP, `gallopos-backup-${fecha}.db`);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/reset', (req, res) => {
  const { password, confirmacion } = req.body;

  if (!password) {
    return res.status(400).json({ error: 'Falta la clave de ADMIN.' });
  }
  if (!authService.login('ADMIN', password)) {
    return res.status(401).json({ error: 'Clave de ADMIN incorrecta.' });
  }
  if ((confirmacion || '').trim().toUpperCase() !== FRASE_CONFIRMACION) {
    return res.status(400).json({ error: `Escribí exactamente "${FRASE_CONFIRMACION}" para confirmar.` });
  }

  resetService.resetearSistema();
  emitSistemaReseteado();
  res.status(204).end();
});

module.exports = router;
