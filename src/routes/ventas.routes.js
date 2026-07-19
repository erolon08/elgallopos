const express = require('express');
const ventasService = require('../services/ventas.service');
const { emitVentaEvent } = require('../sockets');

const router = express.Router();

router.get('/', (req, res) => {
  const { fecha_desde, fecha_hasta, cliente_id, patente, cerrajero_id, estado, numero } = req.query;
  res.json(
    ventasService.listar({
      fecha_desde,
      fecha_hasta,
      cliente_id: cliente_id ? Number(cliente_id) : undefined,
      patente,
      cerrajero_id: cerrajero_id ? Number(cerrajero_id) : undefined,
      estado,
      numero,
    })
  );
});

router.get('/:id', (req, res) => {
  const venta = ventasService.obtener(Number(req.params.id));
  if (!venta) return res.status(404).json({ error: 'Venta no encontrada' });
  res.json(venta);
});

router.post('/', (req, res) => {
  try {
    const venta = ventasService.crear(req.body);
    emitVentaEvent('venta:nueva', venta);
    res.status(201).json(venta);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id', (req, res) => {
  try {
    const venta = ventasService.actualizar(Number(req.params.id), req.body);
    emitVentaEvent('venta:actualizada', venta);
    res.json(venta);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/cobrar', (req, res) => {
  try {
    const venta = ventasService.cobrar(Number(req.params.id), req.body);
    emitVentaEvent('venta:cobrada', venta);
    res.json(venta);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/anular', (req, res) => {
  try {
    const venta = ventasService.anular(Number(req.params.id), req.body);
    emitVentaEvent('venta:anulada', venta);
    res.json(venta);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/enviar-caja', (req, res) => {
  try {
    const venta = ventasService.enviarACaja(Number(req.params.id));
    emitVentaEvent('venta:nueva', venta);
    res.json(venta);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/items/:itemId/cerrajero', (req, res) => {
  const ok = ventasService.actualizarCerrajeroLinea(Number(req.params.itemId), req.body.cerrajero_id || null);
  if (!ok) return res.status(404).json({ error: 'Línea de venta no encontrada' });
  res.status(204).end();
});

module.exports = router;
