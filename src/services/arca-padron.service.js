// Consulta de datos de un CUIT en el padrón de ARCA (ex AFIP): trae razón
// social/nombre y domicilio fiscal para no tener que tipearlos a mano al
// cargar un cliente. Usa el mismo certificado que ya está autorizado para
// facturar (arca-wsaa.service.js), pero además hay que habilitar el
// servicio para ese certificado desde el Administrador de Relaciones de
// Clave Fiscal de ARCA (ahí figura como "Consulta de constancia de
// inscripción" / "ws_sr_constancia_inscripcion") — si no está habilitado,
// ARCA rechaza el pedido con un error que dice justamente eso.
//
// OJO: ese nombre de la AUTORIZACIÓN no es el mismo que el nombre del
// SERVICIO que hay que pedirle a WSAA para conseguir el ticket — WSAA no
// valida el nombre del servicio contra nada al emitir el ticket (por eso
// no tiraba error ahí), pero personaServiceA13 sí lo valida al usarlo, y
// devuelve un error explícito si no coinciden: "Token recibido es para el
// servicio [ws_sr_constancia_inscripcion], debería ser servicio
// [ws_sr_padron_a13]". Por eso acá va "ws_sr_padron_a13", aunque en el
// panel de ARCA la autorización se llame distinto.
const { XMLParser } = require('fast-xml-parser');
const wsaa = require('./arca-wsaa.service');

const PADRON_URL = 'https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA13';
const NS = 'http://a13.soap.ws.server.puc.sr/';
const SERVICIO = 'ws_sr_padron_a13';

// Si es monotributista, ARCA no manda "impuesto: IVA" (el monotributo lo
// reemplaza). Id 30 = IVA, id 32 = Exento, en la lista de impuestos del
// régimen general. Si no se puede determinar con confianza no se devuelve
// nada — mejor dejar que lo elija la persona a mano a que quede mal
// cargado (de esto depende si se puede facturar Factura A o B).
function condicionIvaDesdePadron(persona) {
  if (persona.datosMonotributo) return 'Monotributista';
  const impuestos = persona.datosRegimenGeneral?.impuesto;
  const lista = Array.isArray(impuestos) ? impuestos : impuestos ? [impuestos] : [];
  if (lista.some((i) => Number(i.idImpuesto) === 30)) return 'Responsable Inscripto';
  if (lista.some((i) => Number(i.idImpuesto) === 32)) return 'Exento';
  return null;
}

async function consultarCuit(cuit) {
  const cuitLimpio = String(cuit || '').replace(/\D/g, '');
  if (cuitLimpio.length !== 11) throw new Error('El CUIT tiene que tener 11 dígitos.');

  const { token, sign } = await wsaa.obtenerTicket(SERVICIO);
  const cuitRepresentada = wsaa.obtenerCuit();

  // El error real no era de orden: era de namespace. Este WSDL espera
  // token/sign/cuitRepresentada/idPersona SIN namespace ("<{}sign>", con
  // llaves vacías en el error de ARCA = sin namespace), pero al ponerle
  // xmlns="NS" directo al <getPersona> ese namespace se heredaba también
  // en los hijos. Por eso ahora <getPersona> lleva el namespace con
  // prefijo (a13:) en vez de default, así los hijos quedan sin namespace
  // propio como corresponde.
  const soapBody = `<a13:getPersona xmlns:a13="${NS}"><token>${token}</token><sign>${sign}</sign><cuitRepresentada>${cuitRepresentada}</cuitRepresentada><idPersona>${cuitLimpio}</idPersona></a13:getPersona>`;
  const { status, body } = await wsaa.llamarSoap(PADRON_URL, soapBody, '');
  if (status !== 200) throw new Error(`ARCA (Padrón) respondió con error HTTP ${status}: ${body.slice(0, 500)}`);

  const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true });
  const parsed = parser.parse(body);
  const fault = parsed?.Envelope?.Body?.Fault;
  if (fault) {
    throw new Error(`ARCA (Padrón) rechazó el pedido: ${fault.faultstring || JSON.stringify(fault)}`);
  }

  const persona = parsed?.Envelope?.Body?.getPersonaResponse?.personaReturn;
  const datos = persona?.datosGenerales;
  if (!datos) throw new Error('ARCA no encontró datos para ese CUIT.');

  const nombre = datos.razonSocial || [datos.nombre, datos.apellido].filter(Boolean).join(' ') || null;
  const domicilio = datos.domicilioFiscal || {};

  return {
    cuit: cuitLimpio,
    nombre,
    direccion: domicilio.direccion || null,
    localidad: domicilio.localidad || null,
    provincia: domicilio.descripcionProvincia || null,
    condicion_iva: condicionIvaDesdePadron(persona),
  };
}

module.exports = { consultarCuit };
