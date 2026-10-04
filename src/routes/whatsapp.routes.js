const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const express = require('express');
const configuracionService = require('../services/configuracion.service');
const whatsappService = require('../services/whatsapp.service');
const whatsappBotService = require('../services/whatsappBot.service');

// ---------------------------------------------------------------------
// Webhook de Meta: lo único que se publica a internet (ver server.js, va en
// un puerto aparte que el túnel expone). Nada más del sistema queda afuera.
// ---------------------------------------------------------------------
const webhookRouter = express.Router();

// Meta llama a esto una sola vez, al cargar la URL del webhook en su panel,
// para confirmar que el servidor es dueño de esa URL.
webhookRouter.get('/webhook', (req, res) => {
  const modo = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const config = configuracionService.obtener();
  if (modo === 'subscribe' && token && config.whatsapp_verify_token && token === config.whatsapp_verify_token) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// Meta firma cada aviso con el App Secret de la app (X-Hub-Signature-256).
// Sin esta verificación, cualquiera que conozca la URL podría mandar
// mensajes falsos: el bot les "contestaría" a números inventados desde el
// WhatsApp del negocio y gastaría la clave de Anthropic.
function firmaValida(req, appSecret) {
  const firma = req.get('x-hub-signature-256') || '';
  if (!firma.startsWith('sha256=') || !req.rawBody) return false;
  const esperada = 'sha256=' + crypto.createHmac('sha256', appSecret).update(req.rawBody).digest('hex');
  const a = Buffer.from(firma);
  const b = Buffer.from(esperada);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Mensajes entrantes de WhatsApp. Se responde 200 enseguida (Meta reintenta
// el envío si tarda o si falla), y el procesamiento real sigue después.
webhookRouter.post('/webhook', (req, res) => {
  const config = configuracionService.obtener();
  if (!config.whatsapp_app_secret) {
    console.error('WhatsApp: llegó un mensaje pero falta el App Secret (Configuración → Bot de WhatsApp). Se ignora.');
    return res.sendStatus(200);
  }
  if (!firmaValida(req, config.whatsapp_app_secret)) return res.sendStatus(401);
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

// ---------------------------------------------------------------------
// Rutas internas (solo LAN, montadas en /api/whatsapp del servidor normal)
// ---------------------------------------------------------------------
const router = express.Router();

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

// La dirección pública que da Tailscale Funnel a esta PC, para mostrarle al
// dueño exactamente qué pegar en Meta. Si Tailscale no está o no responde,
// se devuelve null y la pantalla explica cómo armarla a mano.
const TAILSCALE_BINS =
  process.platform === 'win32' ? ['tailscale.exe', 'C:\\Program Files\\Tailscale\\tailscale.exe'] : ['tailscale'];
router.get('/webhook-url', (req, res) => {
  for (const bin of TAILSCALE_BINS) {
    try {
      const r = spawnSync(bin, ['status', '--json'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
      const dns = r.status === 0 ? JSON.parse(r.stdout)?.Self?.DNSName : null;
      if (dns) return res.json({ url: `https://${dns.replace(/\.$/, '')}/webhook` });
    } catch {
      // probar el siguiente
    }
  }
  res.json({ url: null });
});

module.exports = { router, webhookRouter };
