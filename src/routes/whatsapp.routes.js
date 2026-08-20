const express = require('express');
const configuracionService = require('../services/configuracion.service');
const whatsappService = require('../services/whatsapp.service');
const whatsappBotService = require('../services/whatsappBot.service');

const router = express.Router();

// Meta llama a esto una sola vez, al cargar la URL del webhook en su panel,
// para confirmar que el servidor es dueño de esa URL.
router.get('/webhook', (req, res) => {
  const modo = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const config = configuracionService.obtener();
  if (modo === 'subscribe' && token && config.whatsapp_verify_token && token === config.whatsapp_verify_token) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// Mensajes entrantes de WhatsApp. Se responde 200 enseguida (Meta reintenta
// el envío si tarda o si falla), y el procesamiento real sigue después.
router.post('/webhook', (req, res) => {
  res.sendStatus(200);
  procesarWebhook(req.body).catch((err) => {
    console.error('Error procesando mensaje de WhatsApp:', err.message);
  });
});

async function procesarWebhook(body) {
  const config = configuracionService.obtener();
  if (!config.whatsapp_activo) return;

  const value = body?.entry?.[0]?.changes?.[0]?.value;
  const mensaje = value?.messages?.[0];
  if (!mensaje || mensaje.type !== 'text') return;

  const telefono = mensaje.from;
  const texto = mensaje.text.body;
  const respuesta = await whatsappBotService.responderMensaje(telefono, texto);
  if (respuesta) await whatsappService.enviarMensaje(telefono, respuesta);
}

// Para probar la configuración desde la pantalla: manda un mensaje de
// prueba a un número, sin pasar por el bot ni el webhook.
router.post('/probar', async (req, res) => {
  try {
    const { telefono } = req.body;
    if (!telefono) return res.status(400).json({ error: 'Falta el teléfono' });
    await whatsappService.enviarMensaje(telefono, '✅ Mensaje de prueba desde El Gallo POS. Si lo ves, el bot está bien configurado.');
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
