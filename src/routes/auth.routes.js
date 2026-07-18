const express = require('express');
const authService = require('../services/auth.service');

const router = express.Router();

router.post('/login', (req, res) => {
  const { rol, password } = req.body;
  if (!rol || !password) return res.status(400).json({ error: 'Falta rol o clave' });
  const usuario = authService.login(rol, password);
  if (!usuario) return res.status(401).json({ error: 'Clave incorrecta' });
  res.json(usuario);
});

module.exports = router;
