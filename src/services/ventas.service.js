const db = require('../db');
const stockService = require('./stock.service');

function generarNumero() {
  const { max } = db.prepare("SELECT MAX(CAST(numero AS INTEGER)) AS max FROM ventas").get();
  return String((max || 0) + 1).padStart(6, '0');
}

function turnoAbierto(terminal) {
  let turno = db.prepare("SELECT * FROM caja_turnos WHERE terminal = ? AND estado = 'abierto'").get(terminal);
  if (!turno) {
    const info = db
      .prepare("INSERT INTO caja_turnos (numero, terminal, fondo_inicial) VALUES (?, ?, 0)")
      .run('T-' + Date.now(), terminal);
    turno = db.prepare('SELECT * FROM caja_turnos WHERE id = ?').get(info.lastInsertRowid);
  }
  return turno;
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
      `SELECT vi.*, c.nombre AS cerrajero_nombre
       FROM venta_items vi LEFT JOIN cerrajeros c ON c.id = vi.cerrajero_id
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
  if (estado) {
    sql += ' AND v.estado = @estado';
    params.estado = estado;
  }
  sql += ' ORDER BY v.id DESC LIMIT 300';
  return db.prepare(sql).all(params);
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

  const turno = turnoAbierto(datos.terminal || venta.terminal_origen);

  const insertPago = db.prepare('INSERT INTO venta_pagos (venta_id, forma_pago, marca, monto) VALUES (?, ?, ?, ?)');
  const insertCajaMov = db.prepare(`
    INSERT INTO caja_movimientos (caja_turno_id, tipo, categoria, concepto, monto, referencia_tipo, referencia_id, usuario_id)
    VALUES (@caja_turno_id, 'ingreso', 'venta', @concepto, @monto, 'venta', @referencia_id, @usuario_id)
  `);
  datos.pagos.forEach((p) => {
    insertPago.run(id, p.forma_pago, p.marca || null, Number(p.monto) || 0);
    insertCajaMov.run({
      caja_turno_id: turno.id,
      concepto: `Venta N° ${venta.numero} — ${p.forma_pago}${p.marca ? ' (' + p.marca + ')' : ''}`,
      monto: Number(p.monto) || 0,
      referencia_id: id,
      usuario_id: datos.usuario_id || null,
    });
  });

  const formaPagoResumen = datos.pagos.length > 1 ? 'Pago combinado' : datos.pagos[0].forma_pago;

  db.prepare(
    `UPDATE ventas SET estado = 'cobrada', forma_pago = ?, tipo_comprobante = ?, caja_turno_id = ?, cobrado_en = datetime('now') WHERE id = ?`
  ).run(formaPagoResumen, datos.tipo_comprobante || venta.tipo_comprobante, turno.id, id);

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
    const turno = turnoAbierto(terminal || venta.terminal_origen);
    db.prepare(
      `INSERT INTO caja_movimientos (caja_turno_id, tipo, categoria, concepto, monto, referencia_tipo, referencia_id, usuario_id)
       VALUES (?, 'egreso', 'venta', ?, ?, 'venta', ?, ?)`
    ).run(turno.id, `Anulación venta N° ${venta.numero}${motivo ? ' — ' + motivo : ''}`, venta.total, id, usuario_id || null);
  }

  db.prepare("UPDATE ventas SET estado = 'anulada' WHERE id = ?").run(id);
  return obtener(id);
});

function actualizarCerrajeroLinea(venta_item_id, cerrajero_id) {
  const info = db.prepare('UPDATE venta_items SET cerrajero_id = ? WHERE id = ?').run(cerrajero_id || null, venta_item_id);
  return info.changes > 0;
}

module.exports = { crear, obtener, listar, cobrar, enviarACaja, anular, actualizarCerrajeroLinea, generarNumero };
