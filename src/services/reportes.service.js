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

// Igual que condicionFecha, pero admite además un rango de fechas libre
// (desde/hasta) para los resúmenes con selector de fecha a fecha; si viene
// desde u hasta, el rango libre tiene prioridad sobre año/mes.
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

// Resuelve año/mes/rango a un desde/hasta concreto (día calendario), para
// poder buscar directamente en caja_turnos (no es una consulta SQL como
// condicionRango, necesita fechas ya calculadas).
function limitesFecha({ anio, mes, desde, hasta }) {
  if (desde || hasta) return { desde: desde || null, hasta: hasta || null };
  if (!anio) return { desde: null, hasta: null };
  if (mes) {
    const ultimoDia = new Date(Number(anio), Number(mes), 0).getDate();
    const mm = String(mes).padStart(2, '0');
    return { desde: `${anio}-${mm}-01`, hasta: `${anio}-${mm}-${String(ultimoDia).padStart(2, '0')}` };
  }
  return { desde: `${anio}-01-01`, hasta: `${anio}-12-31` };
}

// Cuánto CRECIÓ (o bajó) el fondo de caja que se lleva de un turno al
// siguiente durante el período — plata que sigue físicamente en el cajón,
// sin mandarse a caja fuerte ni gastarse, porque se decidió dejarla como
// fondo para el turno que sigue. Sin este término la Diferencia del
// Dashboard muestra ese crecimiento como si fuera un sobrante sin explicar,
// aunque cada turno haya cerrado perfecto.
function cambioFondo({ anio, mes, desde, hasta }) {
  const rango = limitesFecha({ anio, mes, desde, hasta });
  if (!rango.desde && !rango.hasta) return 0;

  let fondoFinal = 0;
  if (rango.hasta) {
    const row = db
      .prepare("SELECT fondo_inicial FROM caja_turnos WHERE date(abierto_en) <= date(@hasta) ORDER BY abierto_en DESC LIMIT 1")
      .get({ hasta: rango.hasta });
    fondoFinal = row ? row.fondo_inicial : 0;
  } else {
    const row = db.prepare('SELECT fondo_inicial FROM caja_turnos ORDER BY abierto_en DESC LIMIT 1').get();
    fondoFinal = row ? row.fondo_inicial : 0;
  }

  let fondoInicial = 0;
  if (rango.desde) {
    const row = db
      .prepare("SELECT fondo_inicial FROM caja_turnos WHERE date(abierto_en) < date(@desde) ORDER BY abierto_en DESC LIMIT 1")
      .get({ desde: rango.desde });
    if (row) {
      fondoInicial = row.fondo_inicial;
    } else {
      const primero = db.prepare('SELECT fondo_inicial FROM caja_turnos ORDER BY abierto_en ASC LIMIT 1').get();
      fondoInicial = primero ? primero.fondo_inicial : 0;
    }
  }

  return fondoFinal - fondoInicial;
}

// Total facturado (ventas cobradas), sin importar la forma de pago —
// incluye lo vendido a Cuenta Corriente, que todavía no se cobró.
function facturacion({ anio, mes, desde, hasta }) {
  const { sql, params } = condicionRango('v.cobrado_en', { anio, mes, desde, hasta });
  return db.prepare(`SELECT COALESCE(SUM(v.total), 0) AS total FROM ventas v WHERE v.estado = 'cobrada' ${sql}`).get(params).total;
}

// Parte de lo facturado que quedó a cuenta del cliente (todavía no ingresó a caja).
function cuentaCorriente({ anio, mes, desde, hasta }) {
  const { sql, params } = condicionRango('v.cobrado_en', { anio, mes, desde, hasta });
  return db
    .prepare(
      `SELECT COALESCE(SUM(vp.monto), 0) AS total
       FROM venta_pagos vp JOIN ventas v ON v.id = vp.venta_id
       WHERE v.estado = 'cobrada' AND vp.forma_pago = 'Cuenta Corriente' ${sql}`
    )
    .get(params).total;
}

// Lo cobrado en efectivo (billetes en mano, va a la caja física).
function efectivo({ anio, mes, desde, hasta }) {
  const { sql, params } = condicionRango('v.cobrado_en', { anio, mes, desde, hasta });
  return db
    .prepare(
      `SELECT COALESCE(SUM(vp.monto), 0) AS total
       FROM venta_pagos vp JOIN ventas v ON v.id = vp.venta_id
       WHERE v.estado = 'cobrada' AND vp.forma_pago = 'Efectivo' ${sql}`
    )
    .get(params).total;
}

// Transferencias + tarjetas (débito/crédito) + QR: lo cobrado que nunca pasó por la caja física.
function pagoElectronico({ anio, mes, desde, hasta }) {
  const { sql, params } = condicionRango('v.cobrado_en', { anio, mes, desde, hasta });
  return db
    .prepare(
      `SELECT COALESCE(SUM(vp.monto), 0) AS total
       FROM venta_pagos vp JOIN ventas v ON v.id = vp.venta_id
       WHERE v.estado = 'cobrada' AND vp.forma_pago IN ('Transferencia', 'Débito', 'Crédito', 'QR') ${sql}`
    )
    .get(params).total;
}

// Desglose de lo cobrado por cada forma de pago (para el resumen de ventas).
function ventasPorFormaPago({ anio, mes, desde, hasta }) {
  const { sql, params } = condicionRango('v.cobrado_en', { anio, mes, desde, hasta });
  return db
    .prepare(
      `SELECT vp.forma_pago, COALESCE(SUM(vp.monto), 0) AS total
       FROM venta_pagos vp JOIN ventas v ON v.id = vp.venta_id
       WHERE v.estado = 'cobrada' ${sql}
       GROUP BY vp.forma_pago
       ORDER BY total DESC`
    )
    .all(params);
}

// Egresos de caja (gastos, retiros, empleados, rendiciones a cerrajeros, etc.),
// sin contar los envíos a caja fuerte (esos se muestran aparte).
function gastos({ anio, mes, desde, hasta, tipo_egreso, forma_pago }) {
  const { sql, params } = condicionRango('creado_en', { anio, mes, desde, hasta });
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

// Plata que entra a la caja en este período por el cobro de deuda VIEJA de
// Cuenta Corriente (un cliente saldando una venta de otro momento). La
// venta que generó esa deuda ya restó su monto de "Facturación" en
// cuentaCorriente(), pero acá es donde se ve la plata real entrando de
// vuelta — sin sumarla, la Diferencia queda mal aunque cada turno cierre
// bien (el cierre de turno sí la incluye en su efectivo esperado).
function cobrosCuentaCorriente({ anio, mes, desde, hasta, forma_pago }) {
  const { sql, params } = condicionRango('creado_en', { anio, mes, desde, hasta });
  let extra = '';
  if (forma_pago) {
    extra += ' AND forma_pago = @forma_pago';
    params.forma_pago = forma_pago;
  }
  return db
    .prepare(
      `SELECT COALESCE(SUM(monto), 0) AS total FROM caja_movimientos
       WHERE tipo = 'ingreso' AND categoria = 'cuenta_corriente' ${sql} ${extra}`
    )
    .get(params).total;
}

// Lo que se guardó en la caja fuerte al cerrar turnos en el período.
function cajaFuerte({ anio, mes, desde, hasta }) {
  const { sql, params } = condicionRango('creado_en', { anio, mes, desde, hasta });
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

function gastosPorTipo({ anio, mes, desde, hasta, forma_pago }) {
  const { sql, params } = condicionRango('creado_en', { anio, mes, desde, hasta });
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

// "desde"/"hasta" (rango de días libre) tiene prioridad sobre año/mes, igual
// que en el resto de las consultas — así se puede pedir, por ejemplo, "del
// 1 al 15 de agosto" en vez de todo el mes.
function dashboard({ anio, mes, desde, hasta, tipo_egreso, forma_pago }) {
  const anioUsado = anio || String(new Date().getFullYear());
  const fFacturacion = facturacion({ anio: anioUsado, mes, desde, hasta });
  const fCuentaCorriente = cuentaCorriente({ anio: anioUsado, mes, desde, hasta });
  const fGastos = gastos({ anio: anioUsado, mes, desde, hasta, tipo_egreso, forma_pago });
  const fCajaFuerte = cajaFuerte({ anio: anioUsado, mes, desde, hasta });
  const fPagoElectronico = pagoElectronico({ anio: anioUsado, mes, desde, hasta });
  const fCobrosCuentaCorriente = cobrosCuentaCorriente({ anio: anioUsado, mes, desde, hasta, forma_pago });
  const fCambioFondo = cambioFondo({ anio: anioUsado, mes, desde, hasta });
  const diferencia = fFacturacion - fCuentaCorriente - fGastos - fCajaFuerte - fPagoElectronico + fCobrosCuentaCorriente - fCambioFondo;
  return {
    anio: anioUsado,
    facturacion: fFacturacion,
    cuentaCorriente: fCuentaCorriente,
    gastos: fGastos,
    cajaFuerte: fCajaFuerte,
    pagoElectronico: fPagoElectronico,
    cobrosCuentaCorriente: fCobrosCuentaCorriente,
    cambioFondo: fCambioFondo,
    diferencia,
    serieMensual: serieMensual({ anio: anioUsado }),
    gastosPorTipo: gastosPorTipo({ anio: anioUsado, mes, desde, hasta, forma_pago }),
    aniosDisponibles: aniosDisponibles(),
    tiposEgresoDisponibles: tiposEgresoDisponibles(),
  };
}

// Resumen de ventas para un período (usado en el menú Resumen): total
// facturado y desglosado por forma de pago, más cuánto de eso fue efectivo /
// medios electrónicos / cuenta corriente y cuánto terminó en caja fuerte.
function resumenVentas({ desde, hasta }) {
  const { sql, params } = condicionRango('v.cobrado_en', { desde, hasta });
  const cantidadVentas = db.prepare(`SELECT COUNT(*) AS n FROM ventas v WHERE v.estado = 'cobrada' ${sql}`).get(params).n;
  return {
    desde,
    hasta,
    total: facturacion({ desde, hasta }),
    efectivo: efectivo({ desde, hasta }),
    pagoElectronico: pagoElectronico({ desde, hasta }),
    cuentaCorriente: cuentaCorriente({ desde, hasta }),
    cajaFuerte: cajaFuerte({ desde, hasta }),
    porFormaPago: ventasPorFormaPago({ desde, hasta }),
    cantidadVentas,
  };
}

// Resumen de gastos (egresos de caja, sin caja fuerte) para un período.
function resumenGastos({ desde, hasta }) {
  return {
    desde,
    hasta,
    total: gastos({ desde, hasta }),
    porTipo: gastosPorTipo({ desde, hasta }),
  };
}

// Un renglón por egreso de caja (gasto puntual), para exportar a Excel.
function exportarFilasGastos({ desde, hasta }) {
  const { sql, params } = condicionRango('creado_en', { desde, hasta });
  return db
    .prepare(
      `SELECT creado_en AS fecha, COALESCE(tipo_egreso, categoria) AS tipo, concepto, forma_pago, monto
       FROM caja_movimientos
       WHERE tipo = 'egreso' AND categoria NOT IN ('venta', 'caja_fuerte') ${sql}
       ORDER BY creado_en`
    )
    .all(params);
}

module.exports = {
  dashboard,
  aniosDisponibles,
  consultaProducto,
  consultaFamilia,
  resumenVentas,
  resumenGastos,
  exportarFilasGastos,
};
