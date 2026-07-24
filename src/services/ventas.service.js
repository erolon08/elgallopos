const db = require('../db');
const stockService = require('./stock.service');
const cajaService = require('./caja.service');

function generarNumero() {
  const { max } = db.prepare("SELECT MAX(CAST(numero AS INTEGER)) AS max FROM ventas").get();
  return String((max || 0) + 1).padStart(6, '0');
}

function calcularTotales(items, descuento_general) {
  const subtotal = items.reduce((acc, it) => {
    const bruto = Number(it.precio_unitario) * Number(it.cantidad || 1);
    return acc + (bruto - (Number(it.descuento) || 0));
  }, 0);
  const total = Math.max(0, subtotal - (Number(descuento_general) || 0));
  return { subtotal, total };
}

const crear = db.transaction((datos) => {
  if (!datos.items || !datos.items.length) throw new Error('La venta no tiene productos');
  const { subtotal, total } = calcularTotales(datos.items, datos.descuento_general);

  const info = db
    .prepare(
      `INSERT INTO ventas
        (numero, cliente_id, terminal_origen, usuario_id, estado, subtotal, descuento_general, total, tipo_comprobante)
       VALUES (@numero, @cliente_id, @terminal_origen, @usuario_id, @estado, @subtotal, @descuento_general, @total, @tipo_comprobante)`
    )
    .run({
      numero: generarNumero(),
      cliente_id: datos.cliente_id || null,
      terminal_origen: datos.terminal_origen || 'ADMIN',
      usuario_id: datos.usuario_id || null,
      estado: datos.estado || 'pendiente',
      subtotal,
      descuento_general: Number(datos.descuento_general) || 0,
      total,
      tipo_comprobante: datos.tipo_comprobante || 'Eventual',
    });
  const venta_id = info.lastInsertRowid;

  const insertItem = db.prepare(`
    INSERT INTO venta_items
      (venta_id, producto_id, descripcion, cantidad, precio_unitario, tipo_precio, descuento, monto_mano_obra, cerrajero_id)
    VALUES (@venta_id, @producto_id, @descripcion, @cantidad, @precio_unitario, @tipo_precio, @descuento, @monto_mano_obra, @cerrajero_id)
  `);
  datos.items.forEach((it) => {
    insertItem.run({
      venta_id,
      producto_id: it.producto_id || null,
      descripcion: it.descripcion,
      cantidad: Number(it.cantidad) || 1,
      precio_unitario: Number(it.precio_unitario) || 0,
      tipo_precio: it.tipo_precio || 'final',
      descuento: Number(it.descuento) || 0,
      monto_mano_obra: it.monto_mano_obra != null && it.monto_mano_obra !== '' ? Number(it.monto_mano_obra) : null,
      cerrajero_id: it.cerrajero_id || null,
    });
  });

  if (datos.presupuesto_id) {
    db.prepare("UPDATE presupuestos SET estado = 'convertido', venta_id = ? WHERE id = ?").run(venta_id, datos.presupuesto_id);
  }

  return obtener(venta_id);
});

function obtener(id) {
  const venta = db.prepare('SELECT * FROM ventas WHERE id = ?').get(id);
  if (!venta) return null;
  const items = db
    .prepare(
      `SELECT vi.*, c.nombre AS cerrajero_nombre, p.codigo AS producto_codigo
       FROM venta_items vi
       LEFT JOIN cerrajeros c ON c.id = vi.cerrajero_id
       LEFT JOIN productos p ON p.id = vi.producto_id
       WHERE vi.venta_id = ? ORDER BY vi.id`
    )
    .all(id);
  const pagos = db.prepare('SELECT * FROM venta_pagos WHERE venta_id = ? ORDER BY id').all(id);
  const cliente = venta.cliente_id ? db.prepare('SELECT * FROM clientes WHERE id = ?').get(venta.cliente_id) : null;
  return { ...venta, items, pagos, cliente };
}

function listar({ fecha_desde, fecha_hasta, cliente_id, patente, cerrajero_id, estado, numero } = {}) {
  let sql = `
    SELECT DISTINCT v.*, cl.nombre AS cliente_nombre
    FROM ventas v
    LEFT JOIN clientes cl ON cl.id = v.cliente_id
    LEFT JOIN venta_items vi ON vi.venta_id = v.id
    LEFT JOIN vehiculos veh ON veh.cliente_id = v.cliente_id
    WHERE 1 = 1
  `;
  const params = {};
  if (fecha_desde) {
    sql += ' AND date(v.creado_en) >= date(@fecha_desde)';
    params.fecha_desde = fecha_desde;
  }
  if (fecha_hasta) {
    sql += ' AND date(v.creado_en) <= date(@fecha_hasta)';
    params.fecha_hasta = fecha_hasta;
  }
  if (cliente_id) {
    sql += ' AND v.cliente_id = @cliente_id';
    params.cliente_id = cliente_id;
  }
  if (numero) {
    sql += ' AND v.numero LIKE @numero';
    params.numero = `%${numero}%`;
  }
  if (patente) {
    sql += ' AND veh.patente LIKE @patente';
    params.patente = `%${patente.toUpperCase().replace(/\s+/g, '')}%`;
  }
  if (cerrajero_id) {
    sql += ' AND vi.cerrajero_id = @cerrajero_id';
    params.cerrajero_id = cerrajero_id;
  }
  if (estado === 'activas') {
    sql += " AND v.estado != 'anulada'";
  } else if (estado) {
    sql += ' AND v.estado = @estado';
    params.estado = estado;
  }
  sql += ' ORDER BY v.id DESC LIMIT 300';
  return db.prepare(sql).all(params);
}

// Un renglón por línea de venta (no por venta), para exportar a Excel: permite
// filtrar/pivotear en la planilla por producto, cerrajero, forma de pago, etc.
// para armar una rendición puntual sin depender de este sistema.
function exportarFilas({ desde, hasta }) {
  const params = {};
  let cond = "WHERE v.estado = 'cobrada'";
  if (desde) {
    cond += ' AND date(v.cobrado_en) >= date(@desde)';
    params.desde = desde;
  }
  if (hasta) {
    cond += ' AND date(v.cobrado_en) <= date(@hasta)';
    params.hasta = hasta;
  }

  const pagosPorVenta = {};
  db.prepare('SELECT venta_id, forma_pago, monto FROM venta_pagos').all().forEach((p) => {
    const txt = `${p.forma_pago}: $${Math.round(p.monto)}`;
    pagosPorVenta[p.venta_id] = pagosPorVenta[p.venta_id] ? `${pagosPorVenta[p.venta_id]} / ${txt}` : txt;
  });

  const items = db
    .prepare(
      `SELECT v.id AS venta_id, v.numero, v.cobrado_en, v.tipo_comprobante, v.total AS total_venta,
              cl.nombre AS cliente, vi.descripcion, vi.cantidad, vi.precio_unitario, vi.descuento,
              c.nombre AS cerrajero
       FROM ventas v
       LEFT JOIN clientes cl ON cl.id = v.cliente_id
       JOIN venta_items vi ON vi.venta_id = v.id
       LEFT JOIN cerrajeros c ON c.id = vi.cerrajero_id
       ${cond}
       ORDER BY v.cobrado_en, v.id`
    )
    .all(params);

  return items.map((it) => ({
    Fecha: it.cobrado_en,
    'N° Venta': it.numero,
    Cliente: it.cliente || 'Consumidor Final',
    Comprobante: it.tipo_comprobante,
    Producto: it.descripcion,
    Cantidad: it.cantidad,
    'Precio Unitario': Math.round(it.precio_unitario),
    Descuento: Math.round(it.descuento || 0),
    'Subtotal Línea': Math.round(it.precio_unitario * it.cantidad - (it.descuento || 0)),
    Cerrajero: it.cerrajero || '',
    'Formas de Pago': pagosPorVenta[it.venta_id] || '',
    'Total Venta': Math.round(it.total_venta),
  }));
}

const cobrar = db.transaction((id, datos) => {
  const venta = db.prepare('SELECT * FROM ventas WHERE id = ?').get(id);
  if (!venta) throw new Error('Venta no encontrada');
  if (venta.estado === 'cobrada') throw new Error('La venta ya fue cobrada');
  if (venta.estado === 'anulada') throw new Error('La venta está anulada');
  if (!datos.pagos || !datos.pagos.length) throw new Error('Falta el detalle de pago');

  const sumaPagos = datos.pagos.reduce((acc, p) => acc + (Number(p.monto) || 0), 0);
  if (Math.abs(sumaPagos - venta.total) > 1) {
    throw new Error(`El total pagado ($${sumaPagos}) no coincide con el total de la venta ($${venta.total})`);
  }

  const items = db.prepare('SELECT vi.*, f.usa_mano_obra FROM venta_items vi LEFT JOIN productos p ON p.id = vi.producto_id LEFT JOIN familias f ON f.id = p.familia_id WHERE vi.venta_id = ?').all(id);
  items.forEach((it) => {
    if (it.producto_id && !it.usa_mano_obra) {
      stockService.registrarMovimiento({
        producto_id: it.producto_id,
        tipo: 'venta',
        cantidad: -Math.abs(it.cantidad),
        motivo: `Venta N° ${venta.numero}`,
        referencia_tipo: 'venta',
        referencia_id: id,
        usuario_id: datos.usuario_id,
        terminal: datos.terminal,
      });
    }
  });

  const turno = cajaService.turnoAbiertoOCrear(datos.terminal || venta.terminal_origen);

  const insertPago = db.prepare('INSERT INTO venta_pagos (venta_id, forma_pago, marca, monto) VALUES (?, ?, ?, ?)');
  const insertCajaMov = db.prepare(`
    INSERT INTO caja_movimientos (caja_turno_id, tipo, categoria, concepto, monto, forma_pago, referencia_tipo, referencia_id, usuario_id)
    VALUES (@caja_turno_id, 'ingreso', 'venta', @concepto, @monto, @forma_pago, 'venta', @referencia_id, @usuario_id)
  `);
  datos.pagos.forEach((p) => {
    insertPago.run(id, p.forma_pago, p.marca || null, Number(p.monto) || 0);
    insertCajaMov.run({
      caja_turno_id: turno.id,
      concepto: `Venta N° ${venta.numero} — ${p.forma_pago}${p.marca ? ' (' + p.marca + ')' : ''}`,
      monto: Number(p.monto) || 0,
      forma_pago: p.forma_pago,
      referencia_id: id,
      usuario_id: datos.usuario_id || null,
    });
  });

  const formaPagoResumen = datos.pagos.length > 1 ? 'Pago combinado' : datos.pagos[0].forma_pago;

  db.prepare(
    `UPDATE ventas SET estado = 'cobrada', forma_pago = ?, tipo_comprobante = ?, caja_turno_id = ?, cobrado_en = datetime('now','localtime') WHERE id = ?`
  ).run(formaPagoResumen, datos.tipo_comprobante || venta.tipo_comprobante, turno.id, id);

  return obtener(id);
});

const actualizar = db.transaction((id, datos) => {
  const actual = db.prepare('SELECT * FROM ventas WHERE id = ?').get(id);
  if (!actual) throw new Error('Venta no encontrada');
  if (actual.estado !== 'pendiente' && actual.estado !== 'enviada_caja') {
    throw new Error('Solo se pueden modificar ventas pendientes o enviadas a Caja');
  }
  if (!datos.items || !datos.items.length) throw new Error('La venta no tiene productos');
  const { subtotal, total } = calcularTotales(datos.items, datos.descuento_general);

  db.prepare(
    `UPDATE ventas SET cliente_id = @cliente_id, subtotal = @subtotal, descuento_general = @descuento_general, total = @total
     WHERE id = @id`
  ).run({
    id,
    cliente_id: datos.cliente_id || null,
    subtotal,
    descuento_general: Number(datos.descuento_general) || 0,
    total,
  });

  db.prepare('DELETE FROM venta_items WHERE venta_id = ?').run(id);
  const insertItem = db.prepare(`
    INSERT INTO venta_items
      (venta_id, producto_id, descripcion, cantidad, precio_unitario, tipo_precio, descuento, monto_mano_obra, cerrajero_id)
    VALUES (@venta_id, @producto_id, @descripcion, @cantidad, @precio_unitario, @tipo_precio, @descuento, @monto_mano_obra, @cerrajero_id)
  `);
  datos.items.forEach((it) => {
    insertItem.run({
      venta_id: id,
      producto_id: it.producto_id || null,
      descripcion: it.descripcion,
      cantidad: Number(it.cantidad) || 1,
      precio_unitario: Number(it.precio_unitario) || 0,
      tipo_precio: it.tipo_precio || 'final',
      descuento: Number(it.descuento) || 0,
      monto_mano_obra: it.monto_mano_obra != null && it.monto_mano_obra !== '' ? Number(it.monto_mano_obra) : null,
      cerrajero_id: it.cerrajero_id || null,
    });
  });

  return obtener(id);
});

function enviarACaja(id) {
  const info = db.prepare("UPDATE ventas SET estado = 'enviada_caja' WHERE id = ? AND estado = 'pendiente'").run(id);
  if (info.changes === 0) throw new Error('La venta no está disponible para enviar a Caja');
  return obtener(id);
}

const anular = db.transaction((id, { motivo, usuario_id, terminal } = {}) => {
  const venta = db.prepare('SELECT * FROM ventas WHERE id = ?').get(id);
  if (!venta) throw new Error('Venta no encontrada');
  if (venta.estado === 'anulada') return obtener(id);

  if (venta.estado === 'cobrada') {
    const items = db.prepare('SELECT vi.*, f.usa_mano_obra FROM venta_items vi LEFT JOIN productos p ON p.id = vi.producto_id LEFT JOIN familias f ON f.id = p.familia_id WHERE vi.venta_id = ?').all(id);
    items.forEach((it) => {
      if (it.producto_id && !it.usa_mano_obra) {
        stockService.registrarMovimiento({
          producto_id: it.producto_id,
          tipo: 'nota_credito',
          cantidad: Math.abs(it.cantidad),
          motivo: `Anulación venta N° ${venta.numero}${motivo ? ' — ' + motivo : ''}`,
          referencia_tipo: 'venta',
          referencia_id: id,
          usuario_id,
          terminal,
        });
      }
    });
    const turno = cajaService.turnoAbiertoOCrear(terminal || venta.terminal_origen);
    const pagos = db.prepare('SELECT * FROM venta_pagos WHERE venta_id = ?').all(id);
    const insertCajaMov = db.prepare(`
      INSERT INTO caja_movimientos (caja_turno_id, tipo, categoria, concepto, monto, forma_pago, referencia_tipo, referencia_id, usuario_id)
      VALUES (?, 'egreso', 'venta', ?, ?, ?, 'venta', ?, ?)
    `);
    pagos.forEach((p) => {
      insertCajaMov.run(
        turno.id,
        `Anulación venta N° ${venta.numero}${motivo ? ' — ' + motivo : ''} (${p.forma_pago})`,
        p.monto,
        p.forma_pago,
        id,
        usuario_id || null
      );
    });
  }

  db.prepare("UPDATE ventas SET estado = 'anulada' WHERE id = ?").run(id);
  return obtener(id);
});

function actualizarCerrajeroLinea(venta_item_id, cerrajero_id) {
  const info = db.prepare('UPDATE venta_items SET cerrajero_id = ? WHERE id = ?').run(cerrajero_id || null, venta_item_id);
  return info.changes > 0;
}

module.exports = { crear, obtener, listar, exportarFilas, cobrar, enviarACaja, anular, actualizar, actualizarCerrajeroLinea, generarNumero };
