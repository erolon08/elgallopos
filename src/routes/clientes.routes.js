const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const clientesService = require('../services/clientes.service');
const importacionClientesService = require('../services/importacion-clientes.service');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

router.get('/', (req, res) => {
  res.json(clientesService.listar({ q: req.query.q }));
});

router.get('/:id', (req, res) => {
  const cliente = clientesService.obtener(Number(req.params.id));
  if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado' });
  res.json(cliente);
});

router.post('/', (req, res) => {
  try {
    res.status(201).json(clientesService.crear(req.body));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id', (req, res) => {
  try {
    const cliente = clientesService.actualizar(Number(req.params.id), req.body);
    if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json(cliente);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', (req, res) => {
  const ok = clientesService.desactivar(Number(req.params.id));
  if (!ok) return res.status(404).json({ error: 'Cliente no encontrado' });
  res.status(204).end();
});

router.post('/:id/vehiculos', (req, res) => {
  try {
    res.status(201).json(clientesService.agregarVehiculo(Number(req.params.id), req.body));
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Ya existe un vehículo cargado con esa patente' });
    }
    res.status(400).json({ error: err.message });
  }
});

router.put('/vehiculos/:vehiculoId', (req, res) => {
  try {
    const vehiculo = clientesService.actualizarVehiculo(Number(req.params.vehiculoId), req.body);
    if (!vehiculo) return res.status(404).json({ error: 'Vehículo no encontrado' });
    res.json(vehiculo);
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Ya existe un vehículo cargado con esa patente' });
    }
    res.status(400).json({ error: err.message });
  }
});

router.delete('/vehiculos/:vehiculoId', (req, res) => {
  const ok = clientesService.eliminarVehiculo(Number(req.params.vehiculoId));
  if (!ok) return res.status(404).json({ error: 'Vehículo no encontrado' });
  res.status(204).end();
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
    const resultado = importacionClientesService.importarClientes(filas);
    res.json(resultado);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
