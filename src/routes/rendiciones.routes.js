const express = require('express');
const XLSX = require('xlsx');
const rendicionesService = require('../services/rendiciones.service');

const router = express.Router();

router.get('/resumen', (req, res) => {
  const { desde, hasta } = req.query;
  res.json(rendicionesService.resumen({ desde, hasta }));
});

router.get('/exportar', (req, res) => {
  const { desde, hasta } = req.query;
  const filas = rendicionesService.exportarFilas({ desde, hasta });
  const hoja = XLSX.utils.json_to_sheet(filas);
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, 'Rendiciones');
  const buffer = XLSX.write(libro, { type: 'buffer', bookType: 'xlsx' });
  const nombre = `rendiciones_${desde || 'inicio'}_a_${hasta || 'hoy'}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
  res.send(buffer);
});

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
    res.json(rendicionesService.marcarPagada(Number(req.params.id), req.body));
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

// Borrado definitivo: a diferencia de "anular" (arriba), funciona sin
// importar el estado (incluso ya pagada) — pensado para vaciar el
// historial una vez, no para el flujo normal.
router.delete('/:id/definitivo', (req, res) => {
  try {
    rendicionesService.borrarDefinitivo(Number(req.params.id));
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

router.post('/:id/descuentos', (req, res) => {
  try {
    res.status(201).json(rendicionesService.agregarDescuento(Number(req.params.id), req.body));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id/descuentos/:descuentoId', (req, res) => {
  try {
    res.json(rendicionesService.quitarDescuento(Number(req.params.id), Number(req.params.descuentoId)));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
