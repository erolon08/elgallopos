const express = require('express');
const rendicionesService = require('../services/rendiciones.service');

const router = express.Router();

router.get('/preview', (req, res) => {
  const { cerrajero_id, fecha_desde, fecha_hasta } = req.query;
  if (!cerrajero_id || !fecha_desde || !fecha_hasta) {
    return res.status(400).json({ error: 'Faltan cerrajero_id, fecha_desde o fecha_hasta' });
  }
  try {
    res.json(rendicionesService.previsualizar({ cerrajero_id: Number(cerrajero_id), fecha_desde, fecha_hasta }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/', (req, res) => {
  const { cerrajero_id, estado } = req.query;
  res.json(rendicionesService.listar({ cerrajero_id: cerrajero_id ? Number(cerrajero_id) : undefined, estado }));
});

router.get('/:id', (req, res) => {
  const rendicion = rendicionesService.obtener(Number(req.params.id));
  if (!rendicion) return res.status(404).json({ error: 'Rendición no encontrada' });
  res.json(rendicion);
});

router.post('/', (req, res) => {
  const { cerrajero_id, fecha_desde, fecha_hasta, descuentos_extra } = req.body;
  if (!cerrajero_id || !fecha_desde || !fecha_hasta) {
    return res.status(400).json({ error: 'Faltan cerrajero_id, fecha_desde o fecha_hasta' });
  }
  try {
    const rendicion = rendicionesService.generar({ cerrajero_id, fecha_desde, fecha_hasta, descuentos_extra });
    res.status(201).json(rendicion);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id/pagar', (req, res) => {
  try {
    res.json(rendicionesService.marcarPagada(Number(req.params.id)));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', (req, res) => {
  try {
    rendicionesService.anular(Number(req.params.id));
    res.status(204).end();
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/detalle', (req, res) => {
  try {
    res.status(201).json(rendicionesService.agregarLinea(Number(req.params.id), req.body));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id/detalle/:detalleId', (req, res) => {
  try {
    res.json(rendicionesService.quitarLinea(Number(req.params.id), Number(req.params.detalleId)));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
