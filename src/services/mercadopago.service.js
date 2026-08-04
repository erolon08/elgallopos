// Cobro con QR real contra la API de Mercado Pago (Checkout Pro). El flujo es
// por sondeo (polling) desde el propio servidor hacia Mercado Pago, no por
// webhook — así funciona aunque la PC del local no tenga una URL pública en
// internet, que es el caso normal de este POS.
const db = require('../db');

const MP_API = 'https://api.mercadopago.com';

function obtenerConfig() {
  const cfg = db
    .prepare(
      'SELECT mp_access_token, mp_activo, mp_user_id, mp_store_external_id, mp_pos_external_id FROM configuracion WHERE id = 1'
    )
    .get();
  return {
    accessToken: cfg.mp_access_token || null,
    activo: !!cfg.mp_activo,
    userId: cfg.mp_user_id || null,
    storeExternalId: cfg.mp_store_external_id || null,
    posExternalId: cfg.mp_pos_external_id || null,
  };
}

function activo() {
  const { accessToken, activo: prendido } = obtenerConfig();
  return prendido && !!accessToken;
}

function qrFijoConfigurado() {
  const { userId, storeExternalId, posExternalId } = obtenerConfig();
  return !!(userId && storeExternalId && posExternalId);
}

// Da de alta (o reutiliza si ya existe) una sucursal y una caja fijas en la
// cuenta de Mercado Pago del negocio. La caja trae un único QR que Mercado
// Pago aloja como imagen — ese QR se imprime UNA vez y se deja en el
// mostrador; de ahí en más cada venta le "empuja" el monto por API (ver
// crearPagoQr) en vez de generar un QR nuevo por venta.
async function configurarQrFijo() {
  const { accessToken } = obtenerConfig();
  if (!accessToken) throw new Error('Mercado Pago no tiene un Access Token configurado en Configuración.');

  const meResp = await fetch(`${MP_API}/users/me`, { headers: { Authorization: `Bearer ${accessToken}` } });
  const me = await meResp.json();
  if (!meResp.ok) throw new Error(`No se pudo identificar la cuenta de Mercado Pago: ${me.message || meResp.status}`);
  const userId = String(me.id);

  const storeExternalId = 'ELGALLOPOS';
  const posExternalId = 'MOSTRADOR';

  const negocio = db.prepare('SELECT nombre_negocio, domicilio_negocio FROM configuracion WHERE id = 1').get();
  const direccion = (negocio.domicilio_negocio || '').trim() || 'Corrientes Capital';

  let storeId;
  const storeResp = await fetch(`${MP_API}/users/${userId}/stores`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      name: negocio.nombre_negocio || 'Cerrajería El Gallo',
      external_id: storeExternalId,
      business_hours: {
        monday: [{ open: '08:00', close: '20:00' }],
        tuesday: [{ open: '08:00', close: '20:00' }],
        wednesday: [{ open: '08:00', close: '20:00' }],
        thursday: [{ open: '08:00', close: '20:00' }],
        friday: [{ open: '08:00', close: '20:00' }],
        saturday: [{ open: '08:00', close: '13:00' }],
      },
      location: {
        street_name: direccion,
        street_number: '0',
        city_name: 'Corrientes',
        state_name: 'Corrientes',
        latitude: -27.4694,
        longitude: -58.8306,
        reference: negocio.nombre_negocio || 'Cerrajería El Gallo',
      },
    }),
  });
  const storeData = await storeResp.json();
  if (storeResp.ok) {
    storeId = storeData.id;
  } else {
    // Puede que ya exista de un intento anterior (no es un error real): se busca por external_id en vez de crear otra.
    const listResp = await fetch(`${MP_API}/users/${userId}/stores/search?external_id=${storeExternalId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const listData = await listResp.json();
    const existente = (listData.results || [])[0];
    if (!existente) throw new Error(`No se pudo crear la sucursal en Mercado Pago: ${storeData.message || storeResp.status}`);
    storeId = existente.id;
  }

  let qr;
  const posResp = await fetch(`${MP_API}/pos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      name: 'Mostrador',
      fixed_amount: false,
      store_id: storeId,
      external_store_id: storeExternalId,
      external_id: posExternalId,
    }),
  });
  const posData = await posResp.json();
  if (posResp.ok) {
    qr = posData.qr;
  } else {
    const listResp = await fetch(`${MP_API}/pos?external_id=${posExternalId}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    const listData = await listResp.json();
    const existente = (listData.results || [])[0];
    if (!existente) throw new Error(`No se pudo crear la caja en Mercado Pago: ${posData.message || posResp.status}`);
    qr = existente.qr;
  }

  db.prepare(
    `UPDATE configuracion SET mp_user_id = ?, mp_store_external_id = ?, mp_pos_external_id = ?,
       mp_qr_fijo_image_url = ?, mp_qr_fijo_template_url = ? WHERE id = 1`
  ).run(userId, storeExternalId, posExternalId, qr.image, qr.template_image || null);

  return { qrImageUrl: qr.image, qrTemplateUrl: qr.template_image || null };
}

async function crearPagoQr({ ventaId, monto, descripcion }) {
  const { accessToken, userId, storeExternalId, posExternalId } = obtenerConfig();
  if (!accessToken) throw new Error('Mercado Pago no tiene un Access Token configurado en Configuración.');

  const externalReference = `venta-${ventaId}-${Date.now()}`;
  const titulo = descripcion || `Venta N° ${ventaId}`;

  if (userId && storeExternalId && posExternalId) {
    // QR fijo del mostrador: se le empuja el monto de esta venta al mismo QR
    // ya impreso (no se genera una imagen nueva).
    const url = `${MP_API}/instore/qr/seller/collectors/${userId}/stores/${storeExternalId}/pos/${posExternalId}/orders`;
    const body = {
      external_reference: externalReference,
      title: titulo,
      total_amount: Number(monto),
      items: [
        {
          title: titulo,
          unit_price: Number(monto),
          quantity: 1,
          unit_measure: 'unit',
          total_amount: Number(monto),
        },
      ],
    };
    const resp = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      let data = {};
      try {
        data = await resp.json();
      } catch (err) {
        // sin cuerpo en la respuesta de error, se sigue con el status solo
      }
      throw new Error(`Mercado Pago rechazó la solicitud: ${data.message || resp.status}`);
    }
    db.prepare(
      `INSERT INTO mp_pagos (venta_id, external_reference, preference_id, monto, estado)
       VALUES (?, ?, NULL, ?, 'pendiente')`
    ).run(ventaId, externalReference, Number(monto));
    return { externalReference, qrFijo: true };
  }

  // Sin QR fijo configurado: se genera un QR nuevo por venta (Checkout Pro), como antes.
  const body = {
    items: [{ title: titulo, quantity: 1, currency_id: 'ARS', unit_price: Number(monto) }],
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

  return { externalReference, initPoint: data.init_point, qrFijo: false };
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

module.exports = { activo, qrFijoConfigurado, configurarQrFijo, crearPagoQr, consultarPago };
