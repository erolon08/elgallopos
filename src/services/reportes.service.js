const db = require('../db');

function condicionFecha(columna, { anio, mes }) {
  const cond = [];
  const params = {};
  if (anio) {
    cond.push(`strftime('%Y', ${columna}) = @anio`);
    params.anio = String(anio);
  }
  if (mes) {
    cond.push(`strftime('%m', ${columna}) = @mes`);
    params.mes = String(mes).padStart(2, '0');
  }
  return { sql: cond.length ? 'AND ' + cond.join(' AND ') : '', params };
}

// Total facturado (ventas cobradas), sin importar la forma de pago —
// incluye lo vendido a Cuenta Corriente, que todavía no se cobró.
function facturacion({ anio, mes }) {
  const { sql, params } = condicionFecha('v.cobrado_en', { anio, mes });
  return db.prepare(`SELECT COALESCE(SUM(v.total), 0) AS total FROM ventas v WHERE v.estado = 'cobrada' ${sql}`).get(params).total;
}

// Parte de lo facturado que quedó a cuenta del cliente (todavía no ingresó a caja).
function cuentaCorriente({ anio, mes }) {
  const { sql, params } = condicionFecha('v.cobrado_en', { anio, mes });
  return db
    .prepare(
      `SELECT COALESCE(SUM(vp.monto), 0) AS total
       FROM venta_pagos vp JOIN ventas v ON v.id = vp.venta_id
       WHERE v.estado = 'cobrada' AND vp.forma_pago = 'Cuenta Corriente' ${sql}`
    )
    .get(params).total;
}

// Transferencias + tarjetas (débito/crédito) + QR: lo cobrado que nunca pasó por la caja física.
function pagoElectronico({ anio, mes }) {
  const { sql, params } = condicionFecha('v.cobrado_en', { anio, mes });
  return db
    .prepare(
      `SELECT COALESCE(SUM(vp.monto), 0) AS total
       FROM venta_pagos vp JOIN ventas v ON v.id = vp.venta_id
       WHERE v.estado = 'cobrada' AND vp.forma_pago IN ('Transferencia', 'Débito', 'Crédito', 'QR') ${sql}`
    )
    .get(params).total;
}

// Egresos de caja (gastos, retiros, empleados, rendiciones a cerrajeros, etc.),
// sin contar los envíos a caja fuerte (esos se muestran aparte).
function gastos({ anio, mes, tipo_egreso, forma_pago }) {
  const { sql, params } = condicionFecha('creado_en', { anio, mes });
  let extra = '';
  if (tipo_egreso) {
    extra += ' AND COALESCE(tipo_egreso, categoria) = @tipo_egreso';
    params.tipo_egreso = tipo_egreso;
  }
  if (forma_pago) {
    extra += ' AND forma_pago = @forma_pago';
    params.forma_pago = forma_pago;
  }
  return db
    .prepare(
      `SELECT COALESCE(SUM(monto), 0) AS total FROM caja_movimientos
       WHERE tipo = 'egreso' AND categoria NOT IN ('venta', 'caja_fuerte') ${sql} ${extra}`
    )
    .get(params).total;
}

// Lo que se guardó en la caja fuerte al cerrar turnos en el período.
function cajaFuerte({ anio, mes }) {
  const { sql, params } = condicionFecha('creado_en', { anio, mes });
  return db.prepare(`SELECT COALESCE(SUM(monto), 0) AS total FROM caja_movimientos WHERE categoria = 'caja_fuerte' ${sql}`).get(params).total;
}

function serieMensual({ anio }) {
  const meses = [];
  for (let m = 1; m <= 12; m++) {
    const mm = String(m).padStart(2, '0');
    meses.push({
      mes: mm,
      facturacion: facturacion({ anio, mes: mm }),
      gastos: gastos({ anio, mes: mm }),
      cajaFuerte: cajaFuerte({ anio, mes: mm }),
      pagoElectronico: pagoElectronico({ anio, mes: mm }),
    });
  }
  return meses;
}

function gastosPorTipo({ anio, mes, forma_pago }) {
  const { sql, params } = condicionFecha('creado_en', { anio, mes });
  let extra = '';
  if (forma_pago) {
    extra += ' AND forma_pago = @forma_pago';
    params.forma_pago = forma_pago;
  }
  return db
    .prepare(
      `SELECT COALESCE(tipo_egreso, categoria) AS etiqueta, SUM(monto) AS total
       FROM caja_movimientos
       WHERE tipo = 'egreso' AND categoria NOT IN ('venta', 'caja_fuerte') ${sql} ${extra}
       GROUP BY etiqueta
       ORDER BY total DESC
       LIMIT 15`
    )
    .all(params);
}

function aniosDisponibles() {
  const rows = db
    .prepare(
      `SELECT DISTINCT strftime('%Y', fecha) AS anio FROM (
         SELECT cobrado_en AS fecha FROM ventas WHERE cobrado_en IS NOT NULL
         UNION ALL SELECT creado_en AS fecha FROM caja_movimientos
       )
       WHERE fecha IS NOT NULL
       ORDER BY anio DESC`
    )
    .all()
    .map((r) => r.anio);
  const actual = String(new Date().getFullYear());
  if (!rows.includes(actual)) rows.unshift(actual);
  return rows;
}

function tiposEgresoDisponibles() {
  return db
    .prepare(
      `SELECT DISTINCT COALESCE(tipo_egreso, categoria) AS etiqueta
       FROM caja_movimientos
       WHERE tipo = 'egreso' AND categoria NOT IN ('venta', 'caja_fuerte')
       ORDER BY etiqueta`
    )
    .all()
    .map((r) => r.etiqueta);
}

// Productos/servicios más vendidos por cantidad, con su importe facturado
// (agrupados por descripción: así se juntan también las líneas cargadas a mano).
function rankingProductos({ anio, mes, limit }) {
  const { sql, params } = condicionFecha('v.cobrado_en', { anio, mes });
  return db
    .prepare(
      `SELECT vi.descripcion AS nombre,
              SUM(vi.cantidad) AS cantidad,
              SUM(vi.cantidad * vi.precio_unitario - vi.descuento) AS importe
       FROM venta_items vi JOIN ventas v ON v.id = vi.venta_id
       WHERE v.estado = 'cobrada' ${sql}
       GROUP BY vi.descripcion
       ORDER BY importe DESC
       LIMIT @limit`
    )
    .all({ ...params, limit });
}

// Clientes que más compraron en el período (por importe total y cantidad de ventas).
function rankingClientes({ anio, mes, limit }) {
  const { sql, params } = condicionFecha('v.cobrado_en', { anio, mes });
  return db
    .prepare(
      `SELECT c.id AS cliente_id, c.nombre AS nombre,
              COUNT(*) AS cantidad,
              SUM(v.total) AS importe
       FROM ventas v JOIN clientes c ON c.id = v.cliente_id
       WHERE v.estado = 'cobrada' ${sql}
       GROUP BY v.cliente_id
       ORDER BY importe DESC
       LIMIT @limit`
    )
    .all({ ...params, limit });
}

// Cerrajeros que más mano de obra generaron en el período (base de sus rendiciones).
function rankingCerrajeros({ anio, mes, limit }) {
  const { sql, params } = condicionFecha('v.cobrado_en', { anio, mes });
  return db
    .prepare(
      `SELECT cj.id AS cerrajero_id, cj.nombre AS nombre,
              COUNT(*) AS cantidad,
              SUM(vi.monto_mano_obra) AS importe
       FROM venta_items vi
       JOIN ventas v ON v.id = vi.venta_id
       JOIN cerrajeros cj ON cj.id = vi.cerrajero_id
       WHERE v.estado = 'cobrada' AND vi.cerrajero_id IS NOT NULL ${sql}
       GROUP BY vi.cerrajero_id
       ORDER BY importe DESC
       LIMIT @limit`
    )
    .all({ ...params, limit });
}

function ranking({ anio, mes, limit }) {
  const lim = Number(limit) || 15;
  return {
    productos: rankingProductos({ anio, mes, limit: lim }),
    clientes: rankingClientes({ anio, mes, limit: lim }),
    cerrajeros: rankingCerrajeros({ anio, mes, limit: lim }),
    aniosDisponibles: aniosDisponibles(),
  };
}

// Igual que condicionFecha, pero admite un rango de fechas libre (desde/hasta)
// además de año/mes. Si viene desde u hasta, el rango libre tiene prioridad.
function condicionRango(columna, { anio, mes, desde, hasta }) {
  if (desde || hasta) {
    const cond = [];
    const params = {};
    if (desde) {
      cond.push(`date(${columna}) >= date(@desde)`);
      params.desde = desde;
    }
    if (hasta) {
      cond.push(`date(${columna}) <= date(@hasta)`);
      params.hasta = hasta;
    }
    return { sql: cond.length ? 'AND ' + cond.join(' AND ') : '', params };
  }
  return condicionFecha(columna, { anio, mes });
}

// Cuánto se vendió de un producto puntual en el período, más su stock actual
// (para decidir cuánto reponer).
function consultaProducto({ producto_id, anio, mes, desde, hasta }) {
  const { sql, params } = condicionRango('v.cobrado_en', { anio, mes, desde, hasta });
  params.producto_id = producto_id;
  const totales = db
    .prepare(
      `SELECT COALESCE(SUM(vi.cantidad), 0) AS cantidad,
              COALESCE(SUM(vi.cantidad * vi.precio_unitario - vi.descuento), 0) AS importe
       FROM venta_items vi JOIN ventas v ON v.id = vi.venta_id
       WHERE v.estado = 'cobrada' AND vi.producto_id = @producto_id ${sql}`
    )
    .get(params);
  const producto = db.prepare('SELECT id, codigo, descripcion, stock_actual, stock_minimo FROM productos WHERE id = ?').get(producto_id);
  return { producto, cantidad: totales.cantidad, importe: totales.importe };
}

// Igual que consultaProducto pero para todos los productos activos de una familia
// (incluye los que no tuvieron ventas en el período, con cantidad 0, para no
// perderlos de vista a la hora de decidir la reposición).
function consultaFamilia({ familia_id, anio, mes, desde, hasta }) {
  const { sql, params } = condicionRango('v.cobrado_en', { anio, mes, desde, hasta });
  params.familia_id = familia_id;
  const detalle = db
    .prepare(
      `SELECT p.id AS producto_id, p.codigo, p.descripcion AS nombre, p.stock_actual, p.stock_minimo,
              COALESCE(SUM(vi.cantidad), 0) AS cantidad,
              COALESCE(SUM(vi.cantidad * vi.precio_unitario - vi.descuento), 0) AS importe
       FROM productos p
       LEFT JOIN (
         SELECT vi.producto_id, vi.cantidad, vi.precio_unitario, vi.descuento
         FROM venta_items vi JOIN ventas v ON v.id = vi.venta_id
         WHERE v.estado = 'cobrada' ${sql}
       ) vi ON vi.producto_id = p.id
       WHERE p.familia_id = @familia_id AND p.activo = 1
       GROUP BY p.id
       ORDER BY cantidad DESC`
    )
    .all(params);
  const total = detalle.reduce((acc, r) => ({ cantidad: acc.cantidad + r.cantidad, importe: acc.importe + r.importe }), { cantidad: 0, importe: 0 });
  return { detalle, total };
}

function dashboard({ anio, mes, tipo_egreso, forma_pago }) {
  const anioUsado = anio || String(new Date().getFullYear());
  const fFacturacion = facturacion({ anio: anioUsado, mes });
  const fCuentaCorriente = cuentaCorriente({ anio: anioUsado, mes });
  const fGastos = gastos({ anio: anioUsado, mes, tipo_egreso, forma_pago });
  const fCajaFuerte = cajaFuerte({ anio: anioUsado, mes });
  const fPagoElectronico = pagoElectronico({ anio: anioUsado, mes });
  const diferencia = fFacturacion - fCuentaCorriente - fGastos - fCajaFuerte - fPagoElectronico;
  return {
    anio: anioUsado,
    facturacion: fFacturacion,
    cuentaCorriente: fCuentaCorriente,
    gastos: fGastos,
    cajaFuerte: fCajaFuerte,
    pagoElectronico: fPagoElectronico,
    diferencia,
    serieMensual: serieMensual({ anio: anioUsado }),
    gastosPorTipo: gastosPorTipo({ anio: anioUsado, mes, forma_pago }),
    aniosDisponibles: aniosDisponibles(),
    tiposEgresoDisponibles: tiposEgresoDisponibles(),
  };
}

module.exports = { dashboard, ranking, consultaProducto, consultaFamilia };
