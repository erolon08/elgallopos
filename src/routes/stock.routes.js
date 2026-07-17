const express = require('express');
const stockService = require('../services/stock.service');
const { emitStockUpdated } = require('../sockets');

const router = express.Router();

router.get('/', (req, res) => {
  const { q, familia_id, soloBajoMinimo } = req.query;
  const rows = stockService.listarStock({
    q,
    familia_id: familia_id ? Number(familia_id) : undefined,
    soloBajoMinimo: soloBajoMinimo === 'true',
  });
  res.json(rows);
});

router.get('/:id/movimientos', (req, res) => {
  const rows = stockService.movimientos(Number(req.params.id));
  res.json(rows);
});

router.post('/:id/ajuste', (req, res) => {
  const producto_id = Number(req.params.id);
  const { cantidad, motivo, terminal, usuario_id } = req.body;

  const cantidadNum = Number(cantidad);
  if (!Number.isFinite(cantidadNum) || cantidadNum === 0) {
    return res.status(400).json({ error: 'Cantidad inválida' });
  }

  try {
    const resultado = stockService.registrarMovimiento({
      producto_id,
      tipo: 'ajuste',
      cantidad: cantidadNum,
      motivo,
      terminal,
      usuario_id,
    });
    emitStockUpdated(resultado.producto);
    res.json(resultado);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
