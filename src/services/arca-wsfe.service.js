// Llamadas al servicio de Facturación Electrónica de ARCA (WSFEv1). Por
// ahora solo las de solo-lectura, para probar que la autenticación (WSAA) y
// la conexión funcionan de punta a punta sin ningún riesgo fiscal — todavía
// no se emite ningún comprobante real (eso es el paso siguiente).
const { XMLParser } = require('fast-xml-parser');
const wsaa = require('./arca-wsaa.service');

const WSFE_URL = 'https://servicios1.afip.gov.ar/wsfev1/service.asmx';
const NS = 'http://ar.gov.afip.dif.FEV1/';

function parsear(body) {
  const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true });
  const parsed = parser.parse(body);
  const fault = parsed?.Envelope?.Body?.Fault;
  if (fault) {
    throw new Error(`ARCA (WSFE) rechazó el pedido: ${fault.faultstring || JSON.stringify(fault)}`);
  }
  return parsed?.Envelope?.Body;
}

// Ping de conectividad puro: no requiere autenticación ni toca nada fiscal.
// Sirve para confirmar que se puede llegar al servidor de ARCA antes de
// meterse con la parte que sí necesita el certificado.
async function dummy() {
  const soapBody = `<FEDummy xmlns="${NS}"/>`;
  const { status, body } = await wsaa.llamarSoap(WSFE_URL, soapBody, `"${NS}FEDummy"`);
  if (status !== 200) throw new Error(`ARCA (WSFE) respondió con error HTTP ${status}: ${body.slice(0, 500)}`);
  const resultado = parsear(body)?.FEDummyResponse?.FEDummyResult;
  if (!resultado) throw new Error(`Respuesta de FEDummy inesperada: ${body.slice(0, 500)}`);
  return resultado; // { AppServer, DbServer, AuthServer }
}

// Último número de comprobante autorizado para un punto de venta + tipo de
// comprobante. También de solo lectura (no crea ni modifica nada), pero a
// diferencia de FEDummy sí requiere el token+sign de WSAA — es la prueba
// completa de que el certificado autoriza de verdad a facturar.
async function ultimoAutorizado(ptoVta, cbteTipo) {
  const { token, sign } = await wsaa.obtenerTicket('wsfe');
  const cuit = wsaa.obtenerCuit();
  const soapBody = `<FECompUltimoAutorizado xmlns="${NS}"><Auth><Token>${token}</Token><Sign>${sign}</Sign><Cuit>${cuit}</Cuit></Auth><PtoVta>${ptoVta}</PtoVta><CbteTipo>${cbteTipo}</CbteTipo></FECompUltimoAutorizado>`;
  const { status, body } = await wsaa.llamarSoap(WSFE_URL, soapBody, `"${NS}FECompUltimoAutorizado"`);
  if (status !== 200) throw new Error(`ARCA (WSFE) respondió con error HTTP ${status}: ${body.slice(0, 500)}`);
  const resultado = parsear(body)?.FECompUltimoAutorizadoResponse?.FECompUltimoAutorizadoResult;
  if (!resultado) throw new Error(`Respuesta de FECompUltimoAutorizado inesperada: ${body.slice(0, 500)}`);
  const errores = resultado.Errors?.Err;
  if (errores) {
    const lista = Array.isArray(errores) ? errores : [errores];
    throw new Error(`ARCA (WSFE) devolvió error: ${lista.map((e) => `[${e.Code}] ${e.Msg}`).join(' | ')}`);
  }
  return resultado; // { PtoVta, CbteTipo, CbteNro }
}

module.exports = { dummy, ultimoAutorizado };
