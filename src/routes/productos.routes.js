const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const db = require('../db');
const productosService = require('../services/productos.service');
const importacionService = require('../services/importacion.service');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

router.get('/', (req, res) => {
  const { q, familia_id, proveedor_id, stock, incompletos, favorito, es_pila } = req.query;
  res.json(
    productosService.listar({
      q,
      familia_id: familia_id ? Number(familia_id) : undefined,
      proveedor_id: proveedor_id ? Number(proveedor_id) : undefined,
      stock,
      incompletos,
      favorito,
      es_pila,
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

function validarParametrosMasivo({ proveedor_id, familia_id, aumento_costo, margen }) {
  if (!proveedor_id && !familia_id) return 'Elegí un proveedor y/o una familia';
  if (aumento_costo === undefined || aumento_costo === '' || !Number.isFinite(Number(aumento_costo))) {
    return 'Falta el % de aumento de costo';
  }
  if (margen === undefined || margen === '' || !Number.isFinite(Number(margen))) {
    return 'Falta el margen sobre el costo';
  }
  return null;
}

router.get('/actualizar-precios/preview', (req, res) => {
  const { proveedor_id, familia_id, aumento_costo, margen } = req.query;
  const error = validarParametrosMasivo({ proveedor_id, familia_id, aumento_costo, margen });
  if (error) return res.status(400).json({ error });
  res.json(
    productosService.previsualizarActualizacionMasiva({
      proveedor_id: proveedor_id ? Number(proveedor_id) : undefined,
      familia_id: familia_id ? Number(familia_id) : undefined,
      aumento_costo,
      margen,
    })
  );
});

router.post('/actualizar-precios', (req, res) => {
  const { proveedor_id, familia_id, aumento_costo, margen } = req.body;
  const error = validarParametrosMasivo({ proveedor_id, familia_id, aumento_costo, margen });
  if (error) return res.status(400).json({ error });
  const actualizados = productosService.aplicarActualizacionMasiva({
    proveedor_id: proveedor_id ? Number(proveedor_id) : undefined,
    familia_id: familia_id ? Number(familia_id) : undefined,
    aumento_costo,
    margen,
  });
  res.json({ actualizados });
});

router.put('/orden-botonera', (req, res) => {
  const { orden } = req.body;
  if (!Array.isArray(orden) || !orden.length) {
    return res.status(400).json({ error: 'Falta el orden de productos' });
  }
  productosService.guardarOrdenBotonera(orden);
  res.status(204).end();
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

router.post('/:id/favorito', (req, res) => {
  const producto = productosService.toggleFavorito(Number(req.params.id));
  if (!producto) return res.status(404).json({ error: 'Producto no encontrado' });
  res.json(producto);
});

router.delete('/:id', (req, res) => {
  const ok = productosService.desactivar(Number(req.params.id));
  if (!ok) return res.status(404).json({ error: 'Producto no encontrado' });
  res.status(204).end();
});

module.exports = router;
