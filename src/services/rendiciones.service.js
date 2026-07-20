const db = require('../db');

// venta_items del cerrajero, de ventas cobradas dentro del período, que generan
// rendición (familia con usa_mano_obra=1 -> servicio sobre monto_mano_obra, o
// usa_precio_rendicion=1 -> duplicado sobre precio_rendicion) y que todavía no
// fueron incluidos en ninguna rendición previa (evita rendir dos veces la misma línea).
function elegibles(cerrajero_id, fecha_desde, fecha_hasta) {
  return db
    .prepare(
      `SELECT vi.id AS venta_item_id, vi.descripcion, vi.cantidad, vi.monto_mano_obra,
              v.numero AS venta_numero, v.cobrado_en,
              f.usa_mano_obra, f.usa_precio_rendicion, p.precio_rendicion
       FROM venta_items vi
       JOIN ventas v ON v.id = vi.venta_id
       LEFT JOIN productos p ON p.id = vi.producto_id
       LEFT JOIN familias f ON f.id = p.familia_id
       WHERE vi.cerrajero_id = @cerrajero_id
         AND v.estado = 'cobrada'
         AND date(v.cobrado_en) BETWEEN date(@fecha_desde) AND date(@fecha_hasta)
         AND (f.usa_mano_obra = 1 OR f.usa_precio_rendicion = 1)
         AND vi.id NOT IN (SELECT venta_item_id FROM rendicion_detalle)
       ORDER BY v.cobrado_en`
    )
    .all({ cerrajero_id, fecha_desde, fecha_hasta });
}

function calcularDetalle(rows, porcentaje) {
  return rows.map((r) => {
    const tipo = r.usa_mano_obra ? 'servicio' : 'duplicado';
    const monto_base = tipo === 'servicio' ? Number(r.monto_mano_obra) || 0 : (Number(r.precio_rendicion) || 0) * r.cantidad;
    const monto_rendido = Math.round(monto_base * (porcentaje / 100));
    return {
      venta_item_id: r.venta_item_id,
      descripcion: r.descripcion,
      venta_numero: r.venta_numero,
      cobrado_en: r.cobrado_en,
      tipo,
      monto_base,
      porcentaje,
      monto_rendido,
    };
  });
}

function previsualizar({ cerrajero_id, fecha_desde, fecha_hasta }) {
  const cerrajero = db.prepare('SELECT * FROM cerrajeros WHERE id = ?').get(cerrajero_id);
  if (!cerrajero) throw new Error('Cerrajero no encontrado');
  const rows = elegibles(cerrajero_id, fecha_desde, fecha_hasta);
  const detalle = calcularDetalle(rows, cerrajero.porcentaje_rendicion);
  const total_bruto = detalle.reduce((s, d) => s + d.monto_rendido, 0);
  return { cerrajero, detalle, total_bruto };
}

const TIPOS_DESCUENTO_EXTRA = ['repuesto', 'otro', 'adelanto'];

function generar({ cerrajero_id, fecha_desde, fecha_hasta, descuentos_extra = [] }) {
  const cerrajero = db.prepare('SELECT * FROM cerrajeros WHERE id = ?').get(cerrajero_id);
  if (!cerrajero) throw new Error('Cerrajero no encontrado');

  const rows = elegibles(cerrajero_id, fecha_desde, fecha_hasta);
  const detalle = calcularDetalle(rows, cerrajero.porcentaje_rendicion);
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
  const total_pagar = total_bruto - total_descuentos;

  const tx = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO rendiciones (cerrajero_id, fecha_desde, fecha_hasta, total_bruto, total_descuentos, total_pagar)
         VALUES (@cerrajero_id, @fecha_desde, @fecha_hasta, @total_bruto, @total_descuentos, @total_pagar)`
      )
      .run({ cerrajero_id, fecha_desde, fecha_hasta, total_bruto, total_descuentos, total_pagar });
    const rendicion_id = info.lastInsertRowid;

    const insDet = db.prepare(
      `INSERT INTO rendicion_detalle (rendicion_id, venta_item_id, tipo, monto_base, porcentaje, monto_rendido)
       VALUES (@rendicion_id, @venta_item_id, @tipo, @monto_base, @porcentaje, @monto_rendido)`
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
  rendicion.detalle = db
    .prepare(
      `SELECT rd.*, vi.descripcion, v.numero AS venta_numero
       FROM rendicion_detalle rd
       JOIN venta_items vi ON vi.id = rd.venta_item_id
       JOIN ventas v ON v.id = vi.venta_id
       WHERE rd.rendicion_id = ?
       ORDER BY rd.id`
    )
    .all(id);
  rendicion.descuentos = db.prepare('SELECT * FROM rendicion_descuentos WHERE rendicion_id = ? ORDER BY id').all(id);
  return rendicion;
}

function marcarPagada(id) {
  const r = db.prepare('SELECT * FROM rendiciones WHERE id = ?').get(id);
  if (!r) throw new Error('Rendición no encontrada');
  if (r.estado !== 'generada') throw new Error('Solo se puede marcar como pagada una rendición en estado generada');
  db.prepare(`UPDATE rendiciones SET estado = 'pagada', pagado_en = datetime('now') WHERE id = ?`).run(id);
  return obtener(id);
}

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

module.exports = { previsualizar, generar, listar, obtener, marcarPagada, anular };
