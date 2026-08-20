const configuracionService = require('./configuracion.service');

// Envía un mensaje de texto por la API oficial de WhatsApp (Meta Graph API).
// Requiere que el negocio ya tenga cargado el Access Token y el Phone
// Number ID desde Configuración → Bot de WhatsApp.
async function enviarMensaje(telefono, texto) {
  const config = configuracionService.obtener();
  if (!config.whatsapp_token || !config.whatsapp_phone_number_id) {
    throw new Error('Falta configurar el bot de WhatsApp (Configuración → Bot de WhatsApp)');
  }

  const res = await fetch(`https://graph.facebook.com/v21.0/${config.whatsapp_phone_number_id}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.whatsapp_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: telefono,
      type: 'text',
      text: { body: texto },
    }),
  });

  if (!res.ok) {
    const detalle = await res.text();
    throw new Error(`Meta rechazó el envío (HTTP ${res.status}): ${detalle}`);
  }
  return res.json();
}

module.exports = { enviarMensaje };
