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

module.exports = { dashboard };
