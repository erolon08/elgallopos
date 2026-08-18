const express = require('express');
const mensajesService = require('../services/mensajes.service');
const sockets = require('../sockets');

const router = express.Router();

router.get('/conversacion', (req, res) => {
  const { rol, con } = req.query;
  if (!rol || !con) return res.status(400).json({ error: 'Faltan parámetros' });
  res.json(mensajesService.conversacion(rol, con));
});

router.get('/no-leidos', (req, res) => {
  const { rol } = req.query;
  if (!rol) return res.status(400).json({ error: 'Falta el rol' });
  res.json(mensajesService.noLeidosPorRemitente(rol));
});

router.post('/', (req, res) => {
  try {
    const mensaje = mensajesService.enviar(req.body);
    sockets.emitMensajeNuevo(mensaje);
    res.status(201).json(mensaje);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/leidos', (req, res) => {
  const { rol, con } = req.body;
  if (!rol || !con) return res.status(400).json({ error: 'Faltan parámetros' });
  mensajesService.marcarLeidos(rol, con);
  res.status(204).end();
});

module.exports = router;
