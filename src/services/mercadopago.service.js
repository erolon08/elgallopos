// Cobro con QR real contra la API de Mercado Pago (Checkout Pro). El flujo es
// por sondeo (polling) desde el propio servidor hacia Mercado Pago, no por
// webhook — así funciona aunque la PC del local no tenga una URL pública en
// internet, que es el caso normal de este POS.
const db = require('../db');

const MP_API = 'https://api.mercadopago.com';

function obtenerConfig() {
  const cfg = db.prepare('SELECT mp_access_token, mp_activo FROM configuracion WHERE id = 1').get();
  return { accessToken: cfg.mp_access_token || null, activo: !!cfg.mp_activo };
}

function activo() {
  const { accessToken, activo: prendido } = obtenerConfig();
  return prendido && !!accessToken;
}

async function crearPagoQr({ ventaId, monto, descripcion }) {
  const { accessToken } = obtenerConfig();
  if (!accessToken) throw new Error('Mercado Pago no tiene un Access Token configurado en Configuración.');

  const externalReference = `venta-${ventaId}-${Date.now()}`;
  const body = {
    items: [
      {
        title: descripcion || `Venta N° ${ventaId}`,
        quantity: 1,
        currency_id: 'ARS',
        unit_price: Number(monto),
      },
    ],
    external_reference: externalReference,
  };

  const resp = await fetch(`${MP_API}/checkout/preferences`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(`Mercado Pago rechazó la solicitud: ${data.message || resp.status}`);
  }

  db.prepare(
    `INSERT INTO mp_pagos (venta_id, external_reference, preference_id, monto, estado)
     VALUES (?, ?, ?, ?, 'pendiente')`
  ).run(ventaId, externalReference, String(data.id), Number(monto));

  return { externalReference, initPoint: data.init_point };
}

async function consultarPago(externalReference) {
  const fila = db.prepare('SELECT * FROM mp_pagos WHERE external_reference = ?').get(externalReference);
  if (!fila) throw new Error('No se encontró ese pago.');
  // Una vez que quedó aprobado o rechazado no vuelve a cambiar: se contesta
  // directo desde la base sin volver a consultar a Mercado Pago.
  if (fila.estado !== 'pendiente') return { estado: fila.estado, mpPaymentId: fila.mp_payment_id };

  const { accessToken } = obtenerConfig();
  if (!accessToken) throw new Error('Mercado Pago no tiene un Access Token configurado en Configuración.');

  const url = `${MP_API}/v1/payments/search?external_reference=${encodeURIComponent(externalReference)}&sort=date_created&criteria=desc`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await resp.json();
  if (!resp.ok) throw new Error(`Mercado Pago no respondió la consulta: ${data.message || resp.status}`);

  const pago = (data.results || [])[0];
  if (!pago) return { estado: 'pendiente', mpPaymentId: null };

  let estado = 'pendiente';
  if (pago.status === 'approved') estado = 'aprobado';
  else if (pago.status === 'rejected' || pago.status === 'cancelled') estado = 'rechazado';

  if (estado !== 'pendiente') {
    db.prepare(
      `UPDATE mp_pagos SET estado = ?, mp_payment_id = ?, actualizado_en = datetime('now','localtime')
       WHERE external_reference = ?`
    ).run(estado, String(pago.id), externalReference);
  }
  return { estado, mpPaymentId: pago.id ? String(pago.id) : null };
}

module.exports = { activo, crearPagoQr, consultarPago };
