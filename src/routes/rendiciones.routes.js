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
  const r = rendicionesService.resumen({ desde, hasta });
  const libro = XLSX.utils.book_new();
  const porCerrajero = r.porCerrajero.map((c) => ({
    Cerrajero: c.cerrajero_nombre,
    Rendiciones: c.cantidad,
    'Total pagado': c.total_pagar,
    'Mano de obra facturada': c.mano_obra,
  }));
  porCerrajero.push({ Cerrajero: 'TOTAL', Rendiciones: r.filas.length, 'Total pagado': r.totalGeneral, 'Mano de obra facturada': r.totalManoObra });
  XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(porCerrajero), 'Por cerrajero');
  XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(r.filas), 'Rendiciones');
  const buffer = XLSX.write(libro, { type: 'buffer', bookType: 'xlsx' });
  const nombre = `rendiciones_${desde || 'inicio'}_a_${hasta || 'hoy'}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
  res.send(buffer);
});

router.get('/preview', (req, res) => {
  // filtros llega como JSON codificado en la query (GET no admite bien un
  // array de objetos): [{ fecha_desde, fecha_hasta, tipo }, ...]
  const { cerrajero_id, filtros } = req.query;
  if (!cerrajero_id || !filtros) {
    return res.status(400).json({ error: 'Faltan cerrajero_id o filtros' });
  }
  try {
    const filtrosParsed = JSON.parse(filtros);
    res.json(rendicionesService.previsualizar({ cerrajero_id: Number(cerrajero_id), filtros: filtrosParsed }));
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
  const { cerrajero_id, filtros, descuentos_extra } = req.body;
  if (!cerrajero_id || !filtros || !filtros.length) {
    return res.status(400).json({ error: 'Faltan cerrajero_id o filtros' });
  }
  try {
    const rendicion = rendicionesService.generar({ cerrajero_id, filtros, descuentos_extra });
    res.status(201).json(rendicion);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Para cerrajeros con pago_manual: carga directo el monto a pagar, sin
// calcular nada por ventas.
router.post('/manual', (req, res) => {
  const { cerrajero_id, monto, descripcion } = req.body;
  if (!cerrajero_id || !monto) {
    return res.status(400).json({ error: 'Faltan cerrajero_id o monto' });
  }
  try {
    const rendicion = rendicionesService.generarManual({ cerrajero_id, monto, descripcion });
    res.status(201).json(rendicion);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Para quien cobra por hora (cerrajeros.valor_hora > 0): horas × valor.
router.post('/horas', (req, res) => {
  const { cerrajero_id, horas, valor_hora, descripcion } = req.body;
  if (!cerrajero_id) return res.status(400).json({ error: 'Falta cerrajero_id' });
  try {
    const rendicion = rendicionesService.generarPorHoras({ cerrajero_id, horas, valor_hora, descripcion });
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
