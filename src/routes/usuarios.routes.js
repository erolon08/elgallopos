const express = require('express');
const usuariosService = require('../services/usuarios.service');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(usuariosService.listar());
});

router.put('/:id/password', (req, res) => {
  const { password, passwordActual } = req.body;
  if (!password || String(password).length < 4) {
    return res.status(400).json({ error: 'La clave debe tener al menos 4 caracteres' });
  }
  try {
    usuariosService.cambiarPasswordConVerificacion(Number(req.params.id), passwordActual, password);
    res.status(204).end();
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/recuperar/solicitar', (req, res) => {
  const { rol } = req.body;
  try {
    const resultado = usuariosService.solicitarRecuperacion(rol);
    res.json(resultado);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/recuperar/confirmar', (req, res) => {
  const { rol, codigo, password } = req.body;
  if (!password || String(password).length < 4) {
    return res.status(400).json({ error: 'La clave debe tener al menos 4 caracteres' });
  }
  try {
    usuariosService.confirmarRecuperacion(rol, codigo, password);
    res.status(204).end();
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
