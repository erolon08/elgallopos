const db = require('../db');
const cajaService = require('./caja.service');

const TIPOS_MOVIMIENTO = ['saldo_inicial', 'venta', 'pago', 'ajuste', 'nota_credito'];

// Movimiento de cuenta corriente atómico: aplica el monto (positivo suma
// deuda, negativo la resta) al saldo del cliente y deja registro en
// cc_movimientos — mismo patrón que stockService.registrarMovimiento.
const registrarMovimiento = db.transaction((params) => {
  const { cliente_id, tipo, monto, motivo, forma_pago, referencia_tipo, referencia_id, usuario_id, terminal } = params;

  if (!TIPOS_MOVIMIENTO.includes(tipo)) {
    throw new Error(`Tipo de movimiento de cuenta corriente inválido: ${tipo}`);
  }
  if (!monto || monto === 0) {
    throw new Error('El monto del movimiento no puede ser 0');
  }

  const cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(cliente_id);
  if (!cliente) throw new Error('Cliente no encontrado');

  const saldoResultante = Number(cliente.saldo_cta_cte) + Number(monto);

  db.prepare('UPDATE clientes SET saldo_cta_cte = ? WHERE id = ?').run(saldoResultante, cliente_id);

  const info = db
    .prepare(
      `INSERT INTO cc_movimientos
        (cliente_id, tipo, monto, saldo_resultante, motivo, forma_pago, referencia_tipo, referencia_id, usuario_id, terminal)
       VALUES (@cliente_id, @tipo, @monto, @saldo_resultante, @motivo, @forma_pago, @referencia_tipo, @referencia_id, @usuario_id, @terminal)`
    )
    .run({
      cliente_id,
      tipo,
      monto: Number(monto),
      saldo_resultante: saldoResultante,
      motivo: motivo || null,
      forma_pago: forma_pago || null,
      referencia_tipo: referencia_tipo || null,
      referencia_id: referencia_id || null,
      usuario_id: usuario_id || null,
      terminal: terminal || null,
    });

  return { movimiento_id: info.lastInsertRowid, saldo_resultante: saldoResultante };
});

function movimientos(cliente_id, { desde, hasta } = {}) {
  let sql = `
    SELECT cc.*, u.nombre AS usuario_nombre, v.numero AS venta_numero
    FROM cc_movimientos cc
    LEFT JOIN usuarios u ON u.id = cc.usuario_id
    LEFT JOIN ventas v ON cc.referencia_tipo = 'venta' AND cc.referencia_id = v.id
    WHERE cc.cliente_id = @cliente_id
  `;
  const params = { cliente_id };
  if (desde) {
    sql += ' AND date(cc.creado_en) >= date(@desde)';
    params.desde = desde;
  }
  if (hasta) {
    sql += ' AND date(cc.creado_en) <= date(@hasta)';
    params.hasta = hasta;
  }
  sql += ' ORDER BY cc.creado_en DESC, cc.id DESC LIMIT 500';
  return db.prepare(sql).all(params);
}

// Todas las deudas pendientes de un cliente — ventas reales a Cta. Cte. Y
// facturas migradas de posBerry — unificadas en una sola lista cronológica
// para elegir una factura puntual a cancelar en vez de un pago libre.
function pendientesDeCliente(cliente_id) {
  const deVentas = db
    .prepare(
      `SELECT id, 'venta' AS tipo, numero, total, cta_cte_saldo_pendiente AS saldo_pendiente, creado_en
       FROM ventas
       WHERE cliente_id = ? AND estado = 'cobrada' AND cta_cte_saldo_pendiente > 0`
    )
    .all(cliente_id);
  const migradas = db
    .prepare(
      `SELECT id, 'migrada' AS tipo, numero_factura AS numero, monto_original AS total, saldo_pendiente, creado_en
       FROM cc_deudas_migradas
       WHERE cliente_id = ? AND saldo_pendiente > 0`
    )
    .all(cliente_id);
  return [...deVentas, ...migradas].sort((a, b) => a.creado_en.localeCompare(b.creado_en) || a.id - b.id);
}

// Aplica "aplicado" pesos a una deuda puntual (venta real o factura
// migrada) y devuelve el dato para armar el ticket/historial.
function aplicarAdeuda(deuda, aplicado) {
  const nuevoSaldo = Math.round((deuda.saldo_pendiente - aplicado) * 100) / 100;
  if (deuda.tipo === 'migrada') {
    db.prepare('UPDATE cc_deudas_migradas SET saldo_pendiente = ? WHERE id = ?').run(nuevoSaldo, deuda.id);
  } else {
    db.prepare('UPDATE ventas SET cta_cte_saldo_pendiente = ? WHERE id = ?').run(nuevoSaldo, deuda.id);
  }
  return { numero: deuda.numero, tipo: deuda.tipo, aplicado, saldada: nuevoSaldo <= 0 };
}

// Registra que el cliente pagó (total o parcial) su deuda: resta del saldo y
// genera un ingreso en la caja del turno abierto — entra plata real al
// negocio igual que una venta cobrada, con la forma de pago que sea
// (efectivo, transferencia, cheque, tarjeta, QR...). Lo pagado se aplica de
// dos formas posibles:
//   - deuda_id + deuda_tipo puntual ('venta' o 'migrada'): cancela ESA
//     factura (no puede superar lo que le queda pendiente a ella sola).
//   - sin deuda_id (pago libre): se reparte entre TODAS las deudas
//     pendientes del cliente (ventas y facturas migradas mezcladas) de la
//     más vieja a la más nueva, como se paga una cuenta real.
// En ambos casos se marcan las deudas afectadas como saldadas si llegan a
// $0, para poder pintarlas de rojo/verde en el historial.
const registrarPago = db.transaction(({ cliente_id, monto, forma_pago, motivo, usuario_id, terminal, venta_id, deuda_id, deuda_tipo }) => {
  const montoNum = Number(monto);
  if (!montoNum || montoNum <= 0) throw new Error('El monto a cobrar tiene que ser mayor a 0');

  // venta_id queda como alias viejo de deuda_id/deuda_tipo='venta' por compatibilidad.
  const deudaIdSel = deuda_id || venta_id || null;
  const deudaTipoSel = deuda_id ? deuda_tipo || 'venta' : venta_id ? 'venta' : null;

  const clienteAntes = db.prepare('SELECT id, nombre, saldo_cta_cte FROM clientes WHERE id = ?').get(cliente_id);
  if (!clienteAntes) throw new Error('Cliente no encontrado');
  const saldoAnterior = Number(clienteAntes.saldo_cta_cte);

  const resultado = registrarMovimiento({
    cliente_id,
    tipo: 'pago',
    monto: -Math.abs(montoNum),
    motivo: motivo || 'Pago de cuenta corriente',
    forma_pago: forma_pago || 'Efectivo',
    usuario_id,
    terminal,
  });

  const ventasAfectadas = [];

  if (deudaIdSel) {
    const deuda = pendientesDeCliente(cliente_id).find(
      (d) => d.tipo === deudaTipoSel && Number(d.id) === Number(deudaIdSel)
    );
    if (!deuda) throw new Error('Esa factura no existe, no es de este cliente, o ya está saldada.');
    if (montoNum > deuda.saldo_pendiente + 0.01) {
      throw new Error(
        `El monto ($${montoNum}) no puede superar el saldo pendiente de la factura N° ${deuda.numero} ($${deuda.saldo_pendiente}). Para pagar más, hacelo como pago libre.`
      );
    }
    ventasAfectadas.push(aplicarAdeuda(deuda, montoNum));
  } else {
    let restante = montoNum;
    const pendientes = pendientesDeCliente(cliente_id);
    for (const d of pendientes) {
      if (restante <= 0) break;
      const aplicado = Math.min(restante, d.saldo_pendiente);
      ventasAfectadas.push(aplicarAdeuda(d, aplicado));
      restante -= aplicado;
    }
  }

  const turno = cajaService.turnoAbiertoOCrear(terminal);
  db.prepare(
    `INSERT INTO caja_movimientos (caja_turno_id, tipo, categoria, concepto, monto, forma_pago, referencia_tipo, referencia_id, usuario_id)
     VALUES (?, 'ingreso', 'cuenta_corriente', ?, ?, ?, 'cliente', ?, ?)`
  ).run(
    turno.id,
    `Cobro cuenta corriente — ${clienteAntes.nombre}`,
    montoNum,
    forma_pago || 'Efectivo',
    cliente_id,
    usuario_id || null
  );

  return {
    ...resultado,
    cliente_nombre: clienteAntes.nombre,
    monto_pagado: montoNum,
    forma_pago: forma_pago || 'Efectivo',
    saldo_anterior: saldoAnterior,
    saldo_nuevo: resultado.saldo_resultante,
    ventas_afectadas: ventasAfectadas,
  };
});

// Todos los clientes con saldo distinto de $0 (deben o tienen a favor) — la
// base del menú "Cuenta Corriente".
function listarDeudas() {
  return db
    .prepare(
      `SELECT id, codigo, nombre, telefono, saldo_cta_cte
       FROM clientes
       WHERE activo = 1 AND saldo_cta_cte != 0
       ORDER BY saldo_cta_cte DESC`
    )
    .all();
}

module.exports = { registrarMovimiento, movimientos, registrarPago, listarDeudas, pendientesDeCliente };
