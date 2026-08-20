const Anthropic = require('@anthropic-ai/sdk');
const db = require('../db');
const configuracionService = require('./configuracion.service');
const productosService = require('./productos.service');
const direccionesService = require('./direcciones.service');

const MODELO = 'claude-opus-5';
const MAX_HISTORIAL = 20; // últimos N mensajes que se le mandan al modelo como contexto
const MAX_VUELTAS_TOOL = 5; // corte de seguridad: no encadenar herramientas para siempre

function obtenerHistorial(telefono) {
  return db
    .prepare('SELECT rol, texto FROM whatsapp_mensajes WHERE telefono = ? ORDER BY id DESC LIMIT ?')
    .all(telefono, MAX_HISTORIAL)
    .reverse();
}

function guardarMensaje(telefono, rol, texto) {
  db.prepare('INSERT INTO whatsapp_mensajes (telefono, rol, texto) VALUES (?, ?, ?)').run(telefono, rol, texto);
}

const TOOLS = [
  {
    name: 'buscar_producto',
    description:
      'Busca productos o servicios en el catálogo de la cerrajería por nombre o código, y devuelve precio y stock disponible.',
    input_schema: {
      type: 'object',
      properties: {
        consulta: { type: 'string', description: 'Nombre o código del producto/servicio a buscar' },
      },
      required: ['consulta'],
    },
  },
  {
    name: 'pedir_cerrajero',
    description:
      'Registra un pedido de cerrajero a domicilio para que lo despachen. Usar cuando el cliente pide que vaya un cerrajero a algún lugar (apertura de puerta, cambio de cerradura, etc.).',
    input_schema: {
      type: 'object',
      properties: {
        direccion: { type: 'string', description: 'Dirección adonde tiene que ir el cerrajero' },
        trabajo: { type: 'string', description: 'Qué hay que hacer (ej: "Apertura de puerta", "Cambio de cerradura")' },
      },
      required: ['direccion', 'trabajo'],
    },
  },
];

// El teléfono lo inyectamos nosotros (viene del remitente de WhatsApp, no lo
// puede inventar el modelo), así el pedido de cerrajero siempre queda con el
// número real de quien escribió.
function ejecutarTool(nombre, input, telefono) {
  if (nombre === 'buscar_producto') {
    const productos = productosService.listar({ q: input.consulta });
    if (!productos.length) return { encontrado: false };
    return {
      encontrado: true,
      resultados: productos.slice(0, 5).map((p) => ({
        codigo: p.codigo,
        descripcion: p.descripcion,
        precio: p.precio_final,
        stock: p.stock_actual,
      })),
    };
  }
  if (nombre === 'pedir_cerrajero') {
    const direccion = direccionesService.crear({
      direccion: input.direccion,
      trabajo: input.trabajo,
      telefono,
    });
    return { ok: true, numero_pedido: direccion.id };
  }
  return { error: 'Herramienta desconocida' };
}

function armarSystemPrompt(config) {
  return [
    `Sos el asistente de WhatsApp de ${config.nombre_negocio || 'la cerrajería'}, en Corrientes, Argentina.`,
    config.domicilio_negocio ? `Dirección del local: ${config.domicilio_negocio}.` : '',
    config.whatsapp_instrucciones || '',
    'Respondé siempre en español rioplatense/argentino, corto y directo, como un mensaje de WhatsApp real (sin markdown, sin viñetas raras).',
    'Si el cliente pide un cerrajero a domicilio o cuenta un problema que necesita que vaya alguien, usá la herramienta pedir_cerrajero (pedile la dirección si no la dio).',
    'Si pregunta por un producto, precio o si hay stock, usá buscar_producto antes de responder — no inventes precios.',
    'Si no sabés algo o el pedido es complicado, decí que un empleado le va a escribir a la brevedad.',
  ]
    .filter(Boolean)
    .join('\n');
}

// Responde un mensaje entrante de WhatsApp: guarda el mensaje del cliente,
// llama a Claude (con historial + herramientas), ejecuta las herramientas
// que pida, y devuelve el texto final para mandarle de vuelta.
async function responderMensaje(telefono, textoEntrante) {
  const config = configuracionService.obtener();
  // Se guarda el mensaje aunque falte la clave, para que quede el registro
  // de que alguien escribió mientras el bot todavía no estaba configurado.
  guardarMensaje(telefono, 'user', textoEntrante);
  if (!config.anthropic_api_key) {
    throw new Error('Falta configurar la clave de Anthropic para el bot (Configuración → Bot de WhatsApp)');
  }
  const client = new Anthropic({ apiKey: config.anthropic_api_key });

  const historial = obtenerHistorial(telefono);
  const systemPrompt = armarSystemPrompt(config);

  let mensajes = historial.map((m) => ({ role: m.rol, content: m.texto }));
  let respuestaFinal = '';

  for (let vuelta = 0; vuelta < MAX_VUELTAS_TOOL; vuelta++) {
    const respuesta = await client.messages.create({
      model: MODELO,
      max_tokens: 1024,
      system: systemPrompt,
      tools: TOOLS,
      messages: mensajes,
    });

    const bloquesTexto = respuesta.content.filter((b) => b.type === 'text');
    const usosDeHerramienta = respuesta.content.filter((b) => b.type === 'tool_use');
    if (bloquesTexto.length) {
      respuestaFinal = bloquesTexto.map((b) => b.text).join('\n');
    }

    if (respuesta.stop_reason !== 'tool_use') break;

    mensajes = [...mensajes, { role: 'assistant', content: respuesta.content }];
    const resultados = usosDeHerramienta.map((tu) => ({
      type: 'tool_result',
      tool_use_id: tu.id,
      content: JSON.stringify(ejecutarTool(tu.name, tu.input, telefono)),
    }));
    mensajes = [...mensajes, { role: 'user', content: resultados }];
  }

  if (respuestaFinal) guardarMensaje(telefono, 'assistant', respuestaFinal);
  return respuestaFinal;
}

module.exports = { responderMensaje };
