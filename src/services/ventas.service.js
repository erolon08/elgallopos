const db = require('../db');
const stockService = require('./stock.service');
const cajaService = require('./caja.service');
const ccService = require('./cc.service');
const configuracionService = require('./configuracion.service');
const arcaFacturacionService = require('./arca-facturacion.service');

// 1 = productos, 2 = servicios, 3 = productos y servicios (lo que pide ARCA
// en cada comprobante). "items" ya trae usa_mano_obra por línea (servicio),
// tal como los arma cobrar().
function determinarConcepto(items) {
  const hayServicios = items.some((it) => it.usa_mano_obra);
  const hayProductos = items.some((it) => !it.usa_mano_obra);
  if (hayServicios && hayProductos) return 3;
  return hayServicios ? 2 : 1;
}

// Si corresponde Factura A/B y la facturación electrónica está activa,
// intenta emitirla contra ARCA ANTES de tocar la base (el pedido a ARCA es
// asíncrono y no puede ir dentro de la transacción sincrónica de cobrar()).
// Si ARCA falla por lo que sea (sin conexión, caído, error), no se bloquea
// el cobro: la venta se cobra igual, pero baja a "Eventual" — se puede
// facturar más tarde a mano desde la pantalla de Ventas.
async function intentarFacturar(tipoComprobante, total, cliente, items) {
  if (tipoComprobante !== 'Factura A' && tipoComprobante !== 'Factura B') {
    return { tipo_comprobante: tipoComprobante };
  }
  const config = configuracionService.obtener();
  if (!config.arca_facturacion_activa || !config.arca_punto_venta) {
    // Sin facturación electrónica activa no hay forma de conseguir un CAE
    // real — nunca se deja una venta marcada "Factura A/B" sin CAE, porque
    // eso imprimiría un comprobante que dice ser una factura sin serlo.
    return { tipo_comprobante: 'Eventual' };
  }
  try {
    const resultado = await arcaFacturacionService.emitirFactura({
      tipoComprobante,
      total,
      cliente,
      ptoVta: config.arca_punto_venta,
      concepto: determinarConcepto(items),
    });
    return {
      tipo_comprobante: tipoComprobante,
      numero_comprobante: resultado.numeroCompleto,
      cae: resultado.cae,
      cae_vencimiento: resultado.caeVencimiento,
      iva_neto: resultado.impNeto,
      iva_monto: resultado.impIva,
    };
  } catch (err) {
    console.error(`No se pudo facturar electrónicamente (queda como Eventual): ${err.message}`);
    return { tipo_comprobante: 'Eventual', arca_error: err.message };
  }
}


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
      (venta_id, producto_id, descripcion, cantidad, precio_unitario, tipo_precio, descuento, monto_mano_obra, cerrajero_id, pila_producto_id)
    VALUES (@venta_id, @producto_id, @descripcion, @cantidad, @precio_unitario, @tipo_precio, @descuento, @monto_mano_obra, @cerrajero_id, @pila_producto_id)
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
      pila_producto_id: it.pila_producto_id || null,
    });
  });

  if (datos.presupuesto_id) {
    db.prepare("UPDATE presupuestos SET estado = 'convertido', venta_id = ? WHERE id = ?").run(venta_id, datos.presupuesto_id);
  }

  if (datos.direccion_id) {
    db.prepare("UPDATE direcciones SET estado = 'convertida', venta_id = ?, convertido_en = datetime('now','localtime') WHERE id = ?").run(venta_id, datos.direccion_id);
  }

  return obtener(venta_id);
});

function obtener(id) {
  const venta = db.prepare('SELECT * FROM ventas WHERE id = ?').get(id);
  if (!venta) return null;
  const items = db
    .prepare(
      `SELECT vi.*, c.nombre AS cerrajero_nombre, p.codigo AS producto_codigo,
              pp.codigo AS pila_codigo, pp.descripcion AS pila_descripcion,
              pp.precio_final AS pila_precio_final, pp.precio_debito AS pila_precio_debito,
              pp.precio_efectivo AS pila_precio_efectivo
       FROM venta_items vi
       LEFT JOIN cerrajeros c ON c.id = vi.cerrajero_id
       LEFT JOIN productos p ON p.id = vi.producto_id
       LEFT JOIN productos pp ON pp.id = vi.pila_producto_id
       WHERE vi.venta_id = ? ORDER BY vi.id`
    )
    .all(id);
  const pagos = db.prepare('SELECT * FROM venta_pagos WHERE venta_id = ? ORDER BY id').all(id);
  const cliente = venta.cliente_id ? db.prepare('SELECT * FROM clientes WHERE id = ?').get(venta.cliente_id) : null;
  return { ...venta, items, pagos, cliente };
}

function listar({ fecha_desde, fecha_hasta, cliente_id, cliente, patente, cerrajero_id, estado, numero, dni, incluir_anuladas } = {}) {
  // GROUP_CONCAT junta la descripción de todas las líneas de la venta en un
  // solo texto (para mostrar "qué se vendió" en el listado sin tener que
  // abrir el detalle) — reemplaza al DISTINCT que hacía falta antes para
  // no repetir la fila de venta por cada línea/vehículo que matcheaba el
  // JOIN, ya que ahora GROUP BY v.id cumple ese mismo propósito.
  let sql = `
    SELECT v.*, cl.nombre AS cliente_nombre, GROUP_CONCAT(vi.descripcion, ', ') AS descripcion_items
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
  if (cliente) {
    sql += ' AND cl.nombre LIKE @cliente';
    params.cliente = `%${cliente}%`;
  }
  if (numero) {
    sql += ' AND v.numero LIKE @numero';
    params.numero = `%${numero}%`;
  }
  if (patente) {
    sql += ' AND veh.patente LIKE @patente';
    params.patente = `%${patente.toUpperCase().replace(/\s+/g, '')}%`;
  }
  if (dni) {
    sql += ' AND cl.documento LIKE @dni';
    params.dni = `%${dni}%`;
  }
  if (cerrajero_id) {
    sql += ' AND vi.cerrajero_id = @cerrajero_id';
    params.cerrajero_id = cerrajero_id;
  }
  if (estado) {
    sql += ' AND v.estado = @estado';
    params.estado = estado;
  } else {
    // Sin un estado puntual pedido (ej. desde la bandeja de Pendientes, que
    // sí filtra por 'pendiente'/'enviada_caja'), el historial de Ventas
    // muestra todo MENOS las pendientes: son borradores sin cobrar que
    // viven en esa otra bandeja, y desde "Ver detalle" acá no hay forma de
    // completarlas.
    sql += " AND v.estado != 'pendiente'";
    // Las anuladas tampoco se muestran salvo que se pidan a propósito
    // (Configuración → "Mostrar ventas anuladas" prendido).
    if (!incluir_anuladas || incluir_anuladas === 'false') {
      sql += " AND v.estado != 'anulada'";
    }
  }
  sql += ' GROUP BY v.id ORDER BY v.id DESC LIMIT 300';
  return db.prepare(sql).all(params);
}

// Un renglón por línea de venta (no por venta), para exportar a Excel: permite
// filtrar/pivotear en la planilla por producto, cerrajero, forma de pago, etc.
// para armar una rendición puntual sin depender de este sistema.
function exportarFilas({ desde, hasta, cerrajero_id }) {
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
  if (cerrajero_id) {
    cond += ' AND vi.cerrajero_id = @cerrajero_id';
    params.cerrajero_id = cerrajero_id;
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
              c.nombre AS cerrajero, f.nombre AS familia, p.codigo AS producto_codigo
       FROM ventas v
       LEFT JOIN clientes cl ON cl.id = v.cliente_id
       JOIN venta_items vi ON vi.venta_id = v.id
       LEFT JOIN cerrajeros c ON c.id = vi.cerrajero_id
       LEFT JOIN productos p ON p.id = vi.producto_id
       LEFT JOIN familias f ON f.id = p.familia_id
       ${cond}
       ORDER BY v.cobrado_en, v.id`
    )
    .all(params);

  return items.map((it) => ({
    Fecha: it.cobrado_en,
    'N° Venta': it.numero,
    Cliente: it.cliente || 'Consumidor Final',
    Comprobante: it.tipo_comprobante,
    'Código': it.producto_codigo || '',
    Producto: it.descripcion,
    Familia: it.familia || '',
    Cantidad: it.cantidad,
    'Precio Unitario': Math.round(it.precio_unitario),
    Descuento: Math.round(it.descuento || 0),
    'Subtotal Línea': Math.round(it.precio_unitario * it.cantidad - (it.descuento || 0)),
    Cerrajero: it.cerrajero || '',
    'Formas de Pago': pagosPorVenta[it.venta_id] || '',
    'Total Venta': Math.round(it.total_venta),
  }));
}

// Transacción sincrónica de cobro en sí (better-sqlite3 no admite await
// adentro de una transacción) — cobrar(), más abajo, primero resuelve la
// parte asíncrona (facturación electrónica) y recién después llama a esta.
const cobrarTx = db.transaction((id, datos) => {
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
    // Pila consumida al vender un producto de una familia "pregunta_pila"
    // (ej. codificados): se descuenta del stock aparte, sin cobrarla —
    // ya está incluida en el precio del codificado.
    if (it.pila_producto_id) {
      stockService.registrarMovimiento({
        producto_id: it.pila_producto_id,
        tipo: 'venta',
        cantidad: -Math.abs(it.cantidad),
        motivo: `Pila usada en Venta N° ${venta.numero}`,
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
    // La parte pagada "Cuenta Corriente" suma como deuda del cliente.
    if (p.forma_pago === 'Cuenta Corriente' && venta.cliente_id) {
      ccService.registrarMovimiento({
        cliente_id: venta.cliente_id,
        tipo: 'venta',
        monto: Math.abs(Number(p.monto) || 0),
        motivo: `Venta N° ${venta.numero}`,
        referencia_tipo: 'venta',
        referencia_id: id,
        usuario_id: datos.usuario_id,
        terminal: datos.terminal,
      });
    }
  });

  const formaPagoResumen = datos.pagos.length > 1 ? 'Pago combinado' : datos.pagos[0].forma_pago;
  // Cuánto de esta venta quedó a Cuenta Corriente sin cobrar todavía — arranca
  // pendiente del total (si tuvo parte Cta. Cte.), y baja después con cada
  // pago del cliente (ver registrarPago en cc.service.js).
  const totalCtaCte = datos.pagos
    .filter((p) => p.forma_pago === 'Cuenta Corriente')
    .reduce((acc, p) => acc + (Number(p.monto) || 0), 0);

  db.prepare(
    `UPDATE ventas SET estado = 'cobrada', forma_pago = ?, tipo_comprobante = ?,
       numero_comprobante = ?, cae = ?, cae_vencimiento = ?, iva_neto = ?, iva_monto = ?,
       caja_turno_id = ?, cta_cte_saldo_pendiente = ?, cobrado_en = datetime('now','localtime') WHERE id = ?`
  ).run(
    formaPagoResumen,
    datos.tipo_comprobante || venta.tipo_comprobante,
    datos.numero_comprobante || null,
    datos.cae || null,
    datos.cae_vencimiento || null,
    datos.iva_neto ?? null,
    datos.iva_monto ?? null,
    turno.id,
    totalCtaCte,
    id
  );

  return obtener(id);
});

// Punto de entrada real para cobrar una venta: si corresponde Factura A/B
// con facturación electrónica activa, primero intenta conseguir el CAE
// (async, fuera de la transacción) y recién con ese resultado (CAE
// conseguido, o "Eventual" si ARCA falló) ejecuta el cobro en sí.
async function cobrar(id, datos) {
  const venta = db.prepare('SELECT * FROM ventas WHERE id = ?').get(id);
  if (!venta) throw new Error('Venta no encontrada');
  if (venta.estado === 'cobrada') throw new Error('La venta ya fue cobrada');
  if (venta.estado === 'anulada') throw new Error('La venta está anulada');

  const tipoComprobantePedido = datos.tipo_comprobante || venta.tipo_comprobante;
  let facturaInfo = { tipo_comprobante: tipoComprobantePedido };
  if (tipoComprobantePedido === 'Factura A' || tipoComprobantePedido === 'Factura B') {
    const items = db
      .prepare(
        'SELECT vi.*, f.usa_mano_obra FROM venta_items vi LEFT JOIN productos p ON p.id = vi.producto_id LEFT JOIN familias f ON f.id = p.familia_id WHERE vi.venta_id = ?'
      )
      .all(id);
    const cliente = venta.cliente_id ? db.prepare('SELECT * FROM clientes WHERE id = ?').get(venta.cliente_id) : null;
    facturaInfo = await intentarFacturar(tipoComprobantePedido, venta.total, cliente, items);
  }

  const ventaCobrada = cobrarTx(id, { ...datos, ...facturaInfo });
  // arca_error es informativo para esta respuesta puntual (avisarle al
  // cajero que quedó "Eventual" por una falla de ARCA, no porque él lo haya
  // elegido) — no se guarda en la base, la venta ya quedó bien como Eventual.
  return facturaInfo.arca_error ? { ...ventaCobrada, arca_error: facturaInfo.arca_error } : ventaCobrada;
}

// Convierte una venta ya cobrada como "Eventual" en una Factura A/B real,
// pidiendo el CAE a ARCA en el momento (a diferencia de cobrar(), acá si
// falla se corta con un error — no hay a qué "bajar", ya está cobrada).
async function facturarVentaExistente(id, { tipo_comprobante, cliente_id } = {}) {
  const venta = db.prepare('SELECT * FROM ventas WHERE id = ?').get(id);
  if (!venta) throw new Error('Venta no encontrada');
  if (venta.estado !== 'cobrada') throw new Error('Solo se puede facturar una venta ya cobrada');
  if (venta.cae) throw new Error('Esta venta ya tiene una factura electrónica emitida');
  if (tipo_comprobante !== 'Factura A' && tipo_comprobante !== 'Factura B') {
    throw new Error('Elegí Factura A o Factura B');
  }

  const config = configuracionService.obtener();
  if (!config.arca_facturacion_activa || !config.arca_punto_venta) {
    throw new Error('La facturación electrónica no está activa (Configuración → Facturación electrónica).');
  }

  const clienteIdFinal = cliente_id || venta.cliente_id;
  const cliente = clienteIdFinal ? db.prepare('SELECT * FROM clientes WHERE id = ?').get(clienteIdFinal) : null;
  const items = db
    .prepare(
      'SELECT vi.*, f.usa_mano_obra FROM venta_items vi LEFT JOIN productos p ON p.id = vi.producto_id LEFT JOIN familias f ON f.id = p.familia_id WHERE vi.venta_id = ?'
    )
    .all(id);

  const resultado = await arcaFacturacionService.emitirFactura({
    tipoComprobante: tipo_comprobante,
    total: venta.total,
    cliente,
    ptoVta: config.arca_punto_venta,
    concepto: determinarConcepto(items),
  });

  db.prepare(
    `UPDATE ventas SET tipo_comprobante = ?, numero_comprobante = ?, cae = ?, cae_vencimiento = ?,
       iva_neto = ?, iva_monto = ?, cliente_id = ? WHERE id = ?`
  ).run(
    tipo_comprobante,
    resultado.numeroCompleto,
    resultado.cae,
    resultado.caeVencimiento,
    resultado.impNeto,
    resultado.impIva,
    clienteIdFinal || null,
    id
  );

  return obtener(id);
}

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
      (venta_id, producto_id, descripcion, cantidad, precio_unitario, tipo_precio, descuento, monto_mano_obra, cerrajero_id, pila_producto_id)
    VALUES (@venta_id, @producto_id, @descripcion, @cantidad, @precio_unitario, @tipo_precio, @descuento, @monto_mano_obra, @cerrajero_id, @pila_producto_id)
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
      pila_producto_id: it.pila_producto_id || null,
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
      if (it.pila_producto_id) {
        stockService.registrarMovimiento({
          producto_id: it.pila_producto_id,
          tipo: 'nota_credito',
          cantidad: Math.abs(it.cantidad),
          motivo: `Anulación venta N° ${venta.numero} — pila devuelta${motivo ? ' — ' + motivo : ''}`,
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
      // Revierte la deuda que había sumado esta venta a la cuenta corriente.
      if (p.forma_pago === 'Cuenta Corriente' && venta.cliente_id) {
        ccService.registrarMovimiento({
          cliente_id: venta.cliente_id,
          tipo: 'nota_credito',
          monto: -Math.abs(Number(p.monto) || 0),
          motivo: `Anulación venta N° ${venta.numero}${motivo ? ' — ' + motivo : ''}`,
          referencia_tipo: 'venta',
          referencia_id: id,
          usuario_id,
          terminal,
        });
      }
    });
  }

  db.prepare("UPDATE ventas SET estado = 'anulada', cta_cte_saldo_pendiente = 0, motivo_anulacion = ? WHERE id = ?").run(motivo || null, id);
  return obtener(id);
});

// Borra para siempre una venta ya anulada — para vaciar el historial (ej.
// arrancar de cero después de pruebas), no para el flujo normal de trabajo
// (para eso está "anular", que preserva todo como registro). Solo se
// permite sobre ventas ya anuladas: una cobrada/pendiente hay que anularla
// primero (así se revierte el stock y la cuenta corriente).
//
// A diferencia de "anular" (que deja el movimiento de caja como historial
// de que esa plata entró/salió de verdad), acá se borran también los
// movimientos de caja de esta venta — si se está borrando del todo es
// porque esa plata no cuenta para nada (prueba, error, etc.), así que no
// tiene que seguir sumando en el resumen de caja.
//
// Lo que referencia a esta venta pero no depende de que siga intacta
// (direcciones, presupuestos, el detalle de una rendición) se desvincula
// en vez de borrarse — esos registros son historia propia, no dejan de
// existir porque se borre la venta que los originó.
const borrarDefinitivo = db.transaction((id) => {
  const venta = db.prepare('SELECT * FROM ventas WHERE id = ?').get(id);
  if (!venta) throw new Error('Venta no encontrada');
  if (venta.estado !== 'anulada') throw new Error('Solo se puede borrar una venta ya anulada');

  db.prepare('UPDATE direcciones SET venta_id = NULL WHERE venta_id = ?').run(id);
  db.prepare('UPDATE presupuestos SET venta_id = NULL WHERE venta_id = ?').run(id);
  db.prepare(
    `UPDATE rendicion_detalle SET venta_item_id = NULL
     WHERE venta_item_id IN (SELECT id FROM venta_items WHERE venta_id = ?)`
  ).run(id);
  db.prepare("DELETE FROM caja_movimientos WHERE referencia_tipo = 'venta' AND referencia_id = ?").run(id);
  db.prepare('DELETE FROM venta_pagos WHERE venta_id = ?').run(id);
  db.prepare('DELETE FROM mp_pagos WHERE venta_id = ?').run(id);
  db.prepare('DELETE FROM venta_items WHERE venta_id = ?').run(id);
  db.prepare('DELETE FROM ventas WHERE id = ?').run(id);
});

function actualizarCerrajeroLinea(venta_item_id, cerrajero_id) {
  const info = db.prepare('UPDATE venta_items SET cerrajero_id = ? WHERE id = ?').run(cerrajero_id || null, venta_item_id);
  return info.changes > 0;
}

module.exports = {
  crear,
  obtener,
  listar,
  exportarFilas,
  cobrar,
  facturarVentaExistente,
  enviarACaja,
  anular,
  borrarDefinitivo,
  actualizar,
  actualizarCerrajeroLinea,
  generarNumero,
};
