const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const db = require('../db');
const productosService = require('../services/productos.service');
const importacionService = require('../services/importacion.service');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

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

router.post('/importar', upload.single('archivo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió ningún archivo' });

  let workbook;
  try {
    workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
  } catch (err) {
    return res.status(400).json({ error: 'No se pudo leer el archivo. ¿Es un Excel válido (.xlsx)?' });
  }

  const hoja = workbook.Sheets[workbook.SheetNames[0]];
  const filas = XLSX.utils.sheet_to_json(hoja, { header: 1, range: 1, defval: null, blankrows: false });

  try {
    const resultado = importacionService.importarProductos(filas);
    res.json(resultado);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', (req, res) => {
  const ok = productosService.desactivar(Number(req.params.id));
  if (!ok) return res.status(404).json({ error: 'Producto no encontrado' });
  res.status(204).end();
});

module.exports = router;
