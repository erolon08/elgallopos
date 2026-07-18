const express = require('express');
const db = require('../db');
const productosService = require('../services/productos.service');

const router = express.Router();

router.get('/', (req, res) => {
  const { q, familia_id, proveedor_id, stock, incompletos } = req.query;
  res.json(
    productosService.listar({
      q,
      familia_id: familia_id ? Number(familia_id) : undefined,
      proveedor_id: proveedor_id ? Number(proveedor_id) : undefined,
      stock,
      incompletos,
    })
  );
});

router.get('/:id', (req, res) => {
  const producto = productosService.obtener(Number(req.params.id));
  if (!producto) return res.status(404).json({ error: 'Producto no encontrado' });
  res.json(producto);
});

router.post('/', (req, res) => {
  const { codigo, descripcion, familia_id } = req.body;
  if (!codigo || !descripcion || !familia_id) {
    return res.status(400).json({ error: 'Código, descripción y familia son obligatorios' });
  }
  try {
    res.status(201).json(productosService.crear(req.body));
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Ya existe un producto con ese código' });
    }
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id', (req, res) => {
  try {
    const producto = productosService.actualizar(Number(req.params.id), req.body);
    if (!producto) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json(producto);
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Ya existe un producto con ese código' });
    }
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', (req, res) => {
  const ok = productosService.desactivar(Number(req.params.id));
  if (!ok) return res.status(404).json({ error: 'Producto no encontrado' });
  res.status(204).end();
});

module.exports = router;
