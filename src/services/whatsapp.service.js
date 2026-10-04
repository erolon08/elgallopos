const configuracionService = require('./configuracion.service');

// Envía un mensaje de texto por la API oficial de WhatsApp (Meta Graph API).
// Requiere que el negocio ya tenga cargado el Access Token y el Phone
// Number ID desde Configuración → Bot de WhatsApp.
// Solo dígitos; si viene sin código de país (ej. "3794123456", como se
// escribe en la pantalla de prueba) se le agrega el de Argentina para
// celulares (549).
function normalizarTelefono(telefono) {
  const digitos = String(telefono).replace(/\D/g, '');
  return digitos.length === 10 ? '549' + digitos : digitos;
}

async function enviarMensaje(telefono, texto) {
  const config = configuracionService.obtener();
  if (!config.whatsapp_token || !config.whatsapp_phone_number_id) {
    throw new Error('Falta configurar el bot de WhatsApp (Configuración → Bot de WhatsApp)');
  }
  const numero = normalizarTelefono(telefono);
  try {
    return await enviarA(config, numero, texto);
  } catch (err) {
    // Particularidad de Meta con celulares argentinos: los mensajes llegan
    // desde "549..." pero a veces solo acepta mandar a "54..." sin el 9
    // (error 131030, sobre todo con el número de prueba).
    if (err.codigoMeta === 131030 && /^549\d{10}$/.test(numero)) {
      return enviarA(config, '54' + numero.slice(3), texto);
    }
    throw err;
  }
}

async function enviarA(config, telefono, texto) {
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
    const err = new Error(`Meta rechazó el envío (HTTP ${res.status}): ${detalle}`);
    try {
      err.codigoMeta = JSON.parse(detalle)?.error?.code;
    } catch {
      // detalle no era JSON
    }
    throw err;
  }
  return res.json();
}

module.exports = { enviarMensaje };
