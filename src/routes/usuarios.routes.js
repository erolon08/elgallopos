const express = require('express');
const usuariosService = require('../services/usuarios.service');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(usuariosService.listar());
});

router.put('/:id/password', (req, res) => {
  const { password } = req.body;
  if (!password || String(password).length < 4) {
    return res.status(400).json({ error: 'La clave debe tener al menos 4 caracteres' });
  }
  usuariosService.cambiarPassword(Number(req.params.id), password);
  res.status(204).end();
});

module.exports = router;
