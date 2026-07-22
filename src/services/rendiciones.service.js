const db = require('../db');
const cajaService = require('./caja.service');

function roundUpTo100(v) {
  return Math.ceil(v / 100) * 100;
}

// dd/mm sin año, para que el renglón del ticket de cierre entre en una línea
// (la comandera imprime en 80mm de ancho); si el período es de un solo día
// no repite la misma fecha dos veces.
function formatPeriodoCorto(desde, hasta) {
  const corta = (f) => {
    const [, m, d] = f.split('-');
    return `${d}/${m}`;
  };
  return desde === hasta ? corta(desde) : `${corta(desde)} a ${corta(hasta)}`;
}

// venta_items del cerrajero, de ventas cobradas dentro del período, que generan
// rendición (familia con usa_mano_obra=1 -> servicio sobre monto_mano_obra, o
// usa_precio_rendicion=1 -> duplicado sobre precio_rendicion) y que todavía no
// fueron incluidos en ninguna rendición previa (evita rendir dos veces la misma línea).
// El filtro "IS NOT NULL" es necesario porque las líneas agregadas a mano no tienen
// venta_item_id, y un NULL en el subquery de un NOT IN anula la comparación para todas
// las filas si no se excluye explícitamente.
function elegibles(cerrajero_id, fecha_desde, fecha_hasta) {
  return db
    .prepare(
      `SELECT vi.id AS venta_item_id, vi.descripcion, vi.cantidad, vi.monto_mano_obra,
              v.id AS venta_id, v.numero AS venta_numero, v.cobrado_en,
              p.codigo, f.usa_mano_obra, f.usa_precio_rendicion, p.precio_rendicion
       FROM venta_items vi
       JOIN ventas v ON v.id = vi.venta_id
       LEFT JOIN productos p ON p.id = vi.producto_id
       LEFT JOIN familias f ON f.id = p.familia_id
       WHERE vi.cerrajero_id = @cerrajero_id
         AND v.estado = 'cobrada'
         AND date(v.cobrado_en) BETWEEN date(@fecha_desde) AND date(@fecha_hasta)
         AND (f.usa_mano_obra = 1 OR f.usa_precio_rendicion = 1)
         AND vi.id NOT IN (SELECT venta_item_id FROM rendicion_detalle WHERE venta_item_id IS NOT NULL)
       ORDER BY v.cobrado_en`
    )
    .all({ cerrajero_id, fecha_desde, fecha_hasta });
}

// Proporción del total cobrado que se pagó con tarjeta de crédito (0 a 1).
// Una venta puede tener varios venta_pagos (pago combinado); solo la porción
// paga con "Crédito" activa el descuento de mano de obra del cerrajero.
function fraccionCredito(venta_id) {
  const pagos = db.prepare('SELECT forma_pago, monto FROM venta_pagos WHERE venta_id = ?').all(venta_id);
  const total = pagos.reduce((s, p) => s + p.monto, 0);
  if (total <= 0) return 0;
  const credito = pagos.filter((p) => p.forma_pago === 'Crédito').reduce((s, p) => s + p.monto, 0);
  return credito / total;
}

// Descuento por tarjeta de crédito: reduce la mano de obra ANTES de aplicar el
// % de rendición del cerrajero, en la proporción del total que se pagó con
// crédito. Solo afecta líneas de servicio (usa "mano de obra"); los duplicados
// de llave no la usan.
function calcularDetalle(rows, cerrajero) {
  const fraccionCache = new Map();
  return rows.map((r) => {
    const tipo = r.usa_mano_obra ? 'servicio' : 'duplicado';
    let monto_base = tipo === 'servicio' ? Number(r.monto_mano_obra) || 0 : (Number(r.precio_rendicion) || 0) * r.cantidad;
    if (tipo === 'servicio' && cerrajero.descuento_tarjeta_credito > 0) {
      if (!fraccionCache.has(r.venta_id)) fraccionCache.set(r.venta_id, fraccionCredito(r.venta_id));
      const fraccion = fraccionCache.get(r.venta_id);
      if (fraccion > 0) {
        monto_base = Math.round(monto_base * (1 - fraccion * (cerrajero.descuento_tarjeta_credito / 100)));
      }
    }
    const monto_rendido = Math.round(monto_base * (cerrajero.porcentaje_rendicion / 100));
    return {
      venta_item_id: r.venta_item_id,
      codigo: r.codigo || null,
      descripcion: r.descripcion,
      venta_numero: r.venta_numero,
      cobrado_en: r.cobrado_en,
      cantidad: r.cantidad,
      tipo,
      monto_base,
      porcentaje: cerrajero.porcentaje_rendicion,
      monto_rendido,
    };
  });
}

function previsualizar({ cerrajero_id, fecha_desde, fecha_hasta }) {
  const cerrajero = db.prepare('SELECT * FROM cerrajeros WHERE id = ?').get(cerrajero_id);
  if (!cerrajero) throw new Error('Cerrajero no encontrado');
  const rows = elegibles(cerrajero_id, fecha_desde, fecha_hasta);
  const detalle = calcularDetalle(rows, cerrajero);
  const total_bruto = detalle.reduce((s, d) => s + d.monto_rendido, 0);
  return { cerrajero, detalle, total_bruto };
}

const TIPOS_DESCUENTO_EXTRA = ['repuesto', 'otro', 'adelanto'];

function generar({ cerrajero_id, fecha_desde, fecha_hasta, descuentos_extra = [] }) {
  const cerrajero = db.prepare('SELECT * FROM cerrajeros WHERE id = ?').get(cerrajero_id);
  if (!cerrajero) throw new Error('Cerrajero no encontrado');

  const rows = elegibles(cerrajero_id, fecha_desde, fecha_hasta);
  const detalle = calcularDetalle(rows, cerrajero);
  if (!detalle.length) throw new Error('No hay trabajos pendientes de rendir en el período elegido');
  const total_bruto = detalle.reduce((s, d) => s + d.monto_rendido, 0);

  const descuentos = [];
  if (cerrajero.aporte_fijo > 0) {
    descuentos.push({ tipo: 'aporte', descripcion: 'Aporte fijo', monto: cerrajero.aporte_fijo });
  }
  for (const d of descuentos_extra) {
    if (!TIPOS_DESCUENTO_EXTRA.includes(d.tipo)) throw new Error('Tipo de descuento inválido');
    const monto = Number(d.monto) || 0;
    if (monto <= 0) continue;
    descuentos.push({ tipo: d.tipo, descripcion: d.descripcion || '', monto });
  }
  const total_descuentos = descuentos.reduce((s, d) => s + d.monto, 0);
  const total_pagar = roundUpTo100(total_bruto - total_descuentos);

  const tx = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO rendiciones (cerrajero_id, fecha_desde, fecha_hasta, total_bruto, total_descuentos, total_pagar)
         VALUES (@cerrajero_id, @fecha_desde, @fecha_hasta, @total_bruto, @total_descuentos, @total_pagar)`
      )
      .run({ cerrajero_id, fecha_desde, fecha_hasta, total_bruto, total_descuentos, total_pagar });
    const rendicion_id = info.lastInsertRowid;

    const insDet = db.prepare(
      `INSERT INTO rendicion_detalle (rendicion_id, venta_item_id, tipo, codigo, descripcion, venta_numero, cantidad, monto_base, porcentaje, monto_rendido)
       VALUES (@rendicion_id, @venta_item_id, @tipo, @codigo, @descripcion, @venta_numero, @cantidad, @monto_base, @porcentaje, @monto_rendido)`
    );
    for (const d of detalle) insDet.run({ rendicion_id, ...d });

    const insDesc = db.prepare(
      `INSERT INTO rendicion_descuentos (rendicion_id, tipo, descripcion, monto) VALUES (@rendicion_id, @tipo, @descripcion, @monto)`
    );
    for (const d of descuentos) insDesc.run({ rendicion_id, ...d });

    return rendicion_id;
  });

  return obtener(tx());
}

function listar({ cerrajero_id, estado } = {}) {
  let sql = `SELECT r.*, c.nombre AS cerrajero_nombre FROM rendiciones r JOIN cerrajeros c ON c.id = r.cerrajero_id WHERE 1=1`;
  const params = {};
  if (cerrajero_id) {
    sql += ' AND r.cerrajero_id = @cerrajero_id';
    params.cerrajero_id = cerrajero_id;
  }
  if (estado) {
    sql += ' AND r.estado = @estado';
    params.estado = estado;
  }
  sql += ' ORDER BY r.creado_en DESC';
  return db.prepare(sql).all(params);
}

function obtener(id) {
  const rendicion = db
    .prepare(`SELECT r.*, c.nombre AS cerrajero_nombre FROM rendiciones r JOIN cerrajeros c ON c.id = r.cerrajero_id WHERE r.id = ?`)
    .get(id);
  if (!rendicion) return null;
  rendicion.detalle = db.prepare('SELECT * FROM rendicion_detalle WHERE rendicion_id = ? ORDER BY tipo DESC, id').all(id);
  rendicion.descuentos = db.prepare('SELECT * FROM rendicion_descuentos WHERE rendicion_id = ? ORDER BY id').all(id);
  return rendicion;
}

function recalcularTotales(rendicion_id) {
  const total_bruto = db.prepare('SELECT COALESCE(SUM(monto_rendido),0) AS s FROM rendicion_detalle WHERE rendicion_id = ?').get(rendicion_id).s;
  const total_descuentos = db.prepare('SELECT COALESCE(SUM(monto),0) AS s FROM rendicion_descuentos WHERE rendicion_id = ?').get(rendicion_id).s;
  const total_pagar = roundUpTo100(total_bruto - total_descuentos);
  db.prepare('UPDATE rendiciones SET total_bruto = ?, total_descuentos = ?, total_pagar = ? WHERE id = ?').run(
    total_bruto,
    total_descuentos,
    total_pagar,
    rendicion_id
  );
}

function requerirGenerada(rendicion_id) {
  const r = db.prepare('SELECT * FROM rendiciones WHERE id = ?').get(rendicion_id);
  if (!r) throw new Error('Rendición no encontrada');
  if (r.estado !== 'generada') throw new Error('Solo se pueden editar líneas de una rendición en estado generada');
  return r;
}

// Línea agregada a mano por el admin (ej. un trabajo que no quedó cargado en una venta,
// o que se asignó al cerrajero equivocado). No tiene venta_item_id asociado.
function agregarLinea(rendicion_id, { tipo, codigo, descripcion, cantidad, precio_unitario, porcentaje }) {
  requerirGenerada(rendicion_id);
  if (!['servicio', 'duplicado'].includes(tipo)) throw new Error('Tipo de línea inválido');
  if (!descripcion || !descripcion.trim()) throw new Error('La descripción es obligatoria');
  const cant = Number(cantidad) || 1;
  const unitario = Number(precio_unitario) || 0;
  const pct = Number(porcentaje) || 0;
  const monto_base = tipo === 'servicio' ? unitario : unitario * cant;
  const monto_rendido = Math.round(monto_base * (pct / 100));

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO rendicion_detalle (rendicion_id, venta_item_id, tipo, codigo, descripcion, venta_numero, cantidad, monto_base, porcentaje, monto_rendido)
       VALUES (@rendicion_id, NULL, @tipo, @codigo, @descripcion, NULL, @cantidad, @monto_base, @porcentaje, @monto_rendido)`
    ).run({
      rendicion_id,
      tipo,
      codigo: codigo ? codigo.trim() : null,
      descripcion: descripcion.trim(),
      cantidad: cant,
      monto_base,
      porcentaje: pct,
      monto_rendido,
    });
    recalcularTotales(rendicion_id);
  });
  tx();
  return obtener(rendicion_id);
}

function quitarLinea(rendicion_id, detalle_id) {
  requerirGenerada(rendicion_id);
  const linea = db.prepare('SELECT * FROM rendicion_detalle WHERE id = ? AND rendicion_id = ?').get(detalle_id, rendicion_id);
  if (!linea) throw new Error('Línea no encontrada');
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM rendicion_detalle WHERE id = ?').run(detalle_id);
    recalcularTotales(rendicion_id);
  });
  tx();
  return obtener(rendicion_id);
}

// Gasto/descuento agregado a mano después de generada la rendición (ej. un
// repuesto que el cerrajero avisa recién más tarde, o un adelanto).
function agregarDescuento(rendicion_id, { tipo, descripcion, monto }) {
  requerirGenerada(rendicion_id);
  if (!TIPOS_DESCUENTO_EXTRA.includes(tipo)) throw new Error('Tipo de descuento inválido');
  const m = Number(monto) || 0;
  if (m <= 0) throw new Error('El monto tiene que ser mayor a 0');

  const tx = db.transaction(() => {
    db.prepare('INSERT INTO rendicion_descuentos (rendicion_id, tipo, descripcion, monto) VALUES (?, ?, ?, ?)').run(
      rendicion_id,
      tipo,
      descripcion ? descripcion.trim() : '',
      m
    );
    recalcularTotales(rendicion_id);
  });
  tx();
  return obtener(rendicion_id);
}

function quitarDescuento(rendicion_id, descuento_id) {
  requerirGenerada(rendicion_id);
  const descuento = db.prepare('SELECT * FROM rendicion_descuentos WHERE id = ? AND rendicion_id = ?').get(descuento_id, rendicion_id);
  if (!descuento) throw new Error('Descuento no encontrado');
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM rendicion_descuentos WHERE id = ?').run(descuento_id);
    recalcularTotales(rendicion_id);
  });
  tx();
  return obtener(rendicion_id);
}

// Pagarle a un cerrajero su rendición es plata que sale de la caja en
// efectivo: se registra como egreso en el turno abierto de la terminal
// desde la que se paga, igual que un retiro o un envío a caja fuerte.
const marcarPagada = db.transaction((id, { terminal, usuario_id } = {}) => {
  const r = db
    .prepare('SELECT r.*, c.nombre AS cerrajero_nombre FROM rendiciones r JOIN cerrajeros c ON c.id = r.cerrajero_id WHERE r.id = ?')
    .get(id);
  if (!r) throw new Error('Rendición no encontrada');
  if (r.estado !== 'generada') throw new Error('Solo se puede marcar como pagada una rendición en estado generada');

  // Si los descuentos superan el bruto (ej. un adelanto grande), total_pagar
  // queda en 0 o negativo: no sale plata de la caja, así que no se genera egreso.
  let caja_movimiento_id = null;
  if (r.total_pagar > 0) {
    const turno = cajaService.turnoAbiertoOCrear(terminal || 'ADMIN');
    const info = db
      .prepare(
        `INSERT INTO caja_movimientos (caja_turno_id, tipo, categoria, concepto, monto, forma_pago, referencia_tipo, referencia_id, usuario_id)
         VALUES (?, 'egreso', 'rendicion', ?, ?, 'Efectivo', 'rendicion', ?, ?)`
      )
      .run(turno.id, `${r.cerrajero_nombre} (${formatPeriodoCorto(r.fecha_desde, r.fecha_hasta)})`, r.total_pagar, id, usuario_id || null);
    caja_movimiento_id = info.lastInsertRowid;
  }

  db.prepare(
    `UPDATE rendiciones SET estado = 'pagada', pagado_en = datetime('now','localtime'), caja_movimiento_id = ? WHERE id = ?`
  ).run(caja_movimiento_id, id);
  return obtener(id);
});

function anular(id) {
  const r = db.prepare('SELECT * FROM rendiciones WHERE id = ?').get(id);
  if (!r) throw new Error('Rendición no encontrada');
  if (r.estado !== 'generada') throw new Error('Solo se puede anular una rendición en estado generada (no una ya pagada)');
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM rendicion_detalle WHERE rendicion_id = ?').run(id);
    db.prepare('DELETE FROM rendicion_descuentos WHERE rendicion_id = ?').run(id);
    db.prepare('DELETE FROM rendiciones WHERE id = ?').run(id);
  });
  tx();
}

module.exports = {
  previsualizar,
  generar,
  listar,
  obtener,
  marcarPagada,
  anular,
  agregarLinea,
  quitarLinea,
  agregarDescuento,
  quitarDescuento,
};
