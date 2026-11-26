// Autenticación contra ARCA (WSAA): firma un "Login Ticket Request" con el
// certificado digital + clave privada (los que se generan con
// scripts/generar-csr-arca.js y se autorizan en el portal de ARCA) y obtiene
// un token+sign que WSFE exige en cada llamada. El token vale 12 horas, así
// que se cachea en memoria por servicio ("wsfe") y solo se pide uno nuevo
// cuando está por vencer.
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const forge = require('node-forge');
const { XMLParser } = require('fast-xml-parser');

const ARCA_DIR = path.join(__dirname, '..', '..', 'arca');
const WSAA_URL = 'https://wsaa.afip.gov.ar/ws/services/LoginCms';

const cacheTickets = new Map(); // servicio -> { token, sign, expira }

// El ticket también se guarda en disco (junto a la base, en data/, que no
// va a GitHub): ARCA no da un ticket nuevo mientras el anterior siga vigente
// (hasta 12 h), así que si solo viviera en memoria, reiniciar el sistema
// —o un corte justo cuando ARCA ya lo había entregado— dejaba sin poder
// facturar hasta que venciera.
const DATA_DIR = path.dirname(process.env.GALLO_DB_PATH || path.join(__dirname, '..', '..', 'data', 'gallopos.db'));
const rutaTicketGuardado = (servicio) => path.join(DATA_DIR, `arca-ticket-${servicio}.json`);

function leerTicketGuardado(servicio) {
  try {
    const t = JSON.parse(fs.readFileSync(rutaTicketGuardado(servicio), 'utf8'));
    if (t && t.token && t.sign && t.expira && t.cuit === obtenerCuit()) return t;
  } catch {
    // no hay ticket guardado (o está roto): se pide uno nuevo
  }
  return null;
}

function guardarTicket(servicio, ticket) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(rutaTicketGuardado(servicio), JSON.stringify({ ...ticket, cuit: obtenerCuit() }));
  } catch (err) {
    console.error('No se pudo guardar el ticket de ARCA en disco (sigue en memoria):', err.message);
  }
}

function archivoUnico(extensiones, descripcion) {
  if (!fs.existsSync(ARCA_DIR)) {
    throw new Error('No existe la carpeta arca/ — corré primero "npm run generar-csr-arca" y completá el trámite en ARCA.');
  }
  const candidatos = fs
    .readdirSync(ARCA_DIR)
    .filter((f) => extensiones.some((ext) => f.toLowerCase().endsWith(ext)));
  if (candidatos.length === 0) {
    throw new Error(`No se encontró el ${descripcion} en la carpeta arca/ (se busca un archivo con extensión ${extensiones.join(' o ')}).`);
  }
  if (candidatos.length > 1) {
    throw new Error(`Hay más de un archivo que podría ser el ${descripcion} en arca/ (${candidatos.join(', ')}) — dejá solo uno ahí.`);
  }
  return path.join(ARCA_DIR, candidatos[0]);
}

function cargarCredenciales() {
  const rutaKey = path.join(ARCA_DIR, 'arca-clave-privada.key');
  if (!fs.existsSync(rutaKey)) {
    throw new Error('No se encontró arca/arca-clave-privada.key — corré "npm run generar-csr-arca" primero.');
  }
  const rutaCert = archivoUnico(['.crt', '.pem', '.cer'], 'certificado que te dio ARCA');
  return {
    privateKeyPem: fs.readFileSync(rutaKey, 'utf8'),
    certPem: fs.readFileSync(rutaCert, 'utf8'),
  };
}

// El CUIT que hay que mandar en cada llamada a WSFE se saca directo del
// certificado (en vez de tener que configurarlo aparte, así no se puede
// desincronizar del certificado real). El campo donde ARCA lo pone en el
// certificado emitido puede no llamarse "serialNumber" tal cual el pedido
// (CSR) lo tenía, así que se revisan todos los campos del subject buscando
// un número de 11 dígitos, en vez de asumir un nombre de campo fijo.
function obtenerCuit() {
  const { certPem } = cargarCredenciales();
  const cert = forge.pki.certificateFromPem(certPem);
  for (const attr of cert.subject.attributes) {
    const match = String(attr.value).match(/(\d{11})/);
    if (match) return match[1];
  }
  const detalle = cert.subject.attributes
    .map((a) => `${a.name || a.shortName || a.type}=${a.value}`)
    .join(', ');
  throw new Error(`No se encontró un CUIT (11 dígitos) en ningún campo del certificado. Campos del certificado: ${detalle || '(vacío)'}`);
}

function crearLoginTicketRequestXml(servicio) {
  const ahora = new Date();
  const generacion = new Date(ahora.getTime() - 10 * 60 * 1000);
  const expiracion = new Date(ahora.getTime() + 10 * 60 * 1000);
  const uniqueId = Math.floor(ahora.getTime() / 1000);
  return `<?xml version="1.0" encoding="UTF-8"?><loginTicketRequest version="1.0"><header><uniqueId>${uniqueId}</uniqueId><generationTime>${generacion.toISOString()}</generationTime><expirationTime>${expiracion.toISOString()}</expirationTime></header><service>${servicio}</service></loginTicketRequest>`;
}

// Firma el XML como PKCS#7/CMS SignedData (no separado del contenido: ARCA
// espera el ticket incluido dentro de la firma, no aparte) y lo devuelve en
// base64, tal como lo pide el método loginCms de WSAA.
function firmarCms(xml, certPem, privateKeyPem) {
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(xml, 'utf8');
  p7.addCertificate(certPem);
  p7.addSigner({
    key: privateKeyPem,
    certificate: certPem,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() },
    ],
  });
  p7.sign({ detached: false });
  const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
  return forge.util.encode64(der);
}

// Una conexión nueva por pedido: desde Node 19 el agente por defecto reusa
// conexiones (keep-alive), y los servidores de ARCA cierran las que quedan
// quietas — reusar una ya cerrada da "read ECONNRESET".
const agenteArca = new https.Agent({ keepAlive: false });
const TIMEOUT_MS = 30000;
const ESPERAS_REINTENTO_MS = [1000, 3000];
const CODIGOS_TRANSITORIOS = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EPIPE', 'EAI_AGAIN', 'ENOTFOUND', 'ENETUNREACH', 'EHOSTUNREACH']);

// Un intento. Si falla, el error lleva `transitorio` (corte de red, vale la
// pena reintentar) y `posiblementeEntregado` (el pedido ya había salido
// entero: ARCA pudo haberlo procesado aunque no llegó la respuesta).
function llamarSoapUnaVez(url, envelope, soapAction) {
  return new Promise((resolve, reject) => {
    let enviado = false;
    const req = https.request(
      url,
      {
        method: 'POST',
        agent: agenteArca,
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          SOAPAction: soapAction,
          'Content-Length': Buffer.byteLength(envelope),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
        res.on('error', (err) => {
          err.posiblementeEntregado = true;
          err.transitorio = true;
          reject(err);
        });
      }
    );
    req.on('finish', () => (enviado = true));
    req.setTimeout(TIMEOUT_MS, () => {
      const err = new Error('ARCA no respondió a tiempo');
      err.code = 'ETIMEDOUT';
      req.destroy(err);
    });
    req.on('error', (err) => {
      err.transitorio = CODIGOS_TRANSITORIOS.has(err.code) || /socket hang up/i.test(err.message);
      err.posiblementeEntregado = enviado;
      reject(err);
    });
    req.write(envelope);
    req.end();
  });
}

// El servidor de WSFE (a diferencia de WSAA) exige que el header SOAPAction
// coincida exactamente con la operación que se está llamando (ej.
// "http://ar.gov.afip.dif.FEV1/FEDummy") — si va vacío, lo rechaza antes de
// siquiera mirar el cuerpo del pedido.
// Ante un corte de red reintenta hasta 3 veces. Un pedido que NO es
// idempotente (FECAESolicitar: emite un comprobante) solo se reintenta si
// el corte fue antes de terminar de mandarlo; si ya había salido, el error
// sube con `posiblementeEntregado` para que quien llamó verifique en ARCA
// antes de volver a pedirlo.
async function llamarSoap(url, soapBody, soapAction = '', { idempotente = true } = {}) {
  const envelope = `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body>${soapBody}</soapenv:Body></soapenv:Envelope>`;
  for (let intento = 0; ; intento++) {
    try {
      return await llamarSoapUnaVez(url, envelope, soapAction);
    } catch (err) {
      const puedeReintentar = err.transitorio && (idempotente || !err.posiblementeEntregado) && intento < ESPERAS_REINTENTO_MS.length;
      if (!puedeReintentar) {
        if (err.transitorio) {
          const amigable = new Error(
            `Se cortó la conexión con ARCA (${err.code || err.message}). Suele ser un corte momentáneo de los servidores de ARCA: probá de nuevo en unos minutos.`
          );
          amigable.code = err.code;
          amigable.transitorio = true;
          amigable.posiblementeEntregado = err.posiblementeEntregado;
          throw amigable;
        }
        throw err;
      }
      await new Promise((r) => setTimeout(r, ESPERAS_REINTENTO_MS[intento]));
    }
  }
}

// Pide (o devuelve del caché) el token+sign para un servicio de ARCA. "wsfe"
// es el único que usa Gallo POS por ahora.
async function obtenerTicket(servicio = 'wsfe') {
  const vigente = (t) => t && t.expira > Date.now() + 5 * 60 * 1000;
  const cacheado = cacheTickets.get(servicio);
  if (vigente(cacheado)) return cacheado;
  const guardado = leerTicketGuardado(servicio);
  if (vigente(guardado)) {
    cacheTickets.set(servicio, guardado);
    return guardado;
  }

  const { certPem, privateKeyPem } = cargarCredenciales();
  const xml = crearLoginTicketRequestXml(servicio);
  const cms = firmarCms(xml, certPem, privateKeyPem);
  const soapBody = `<loginCms xmlns="https://wsaa.afip.gov.ar/ws/services/LoginCgi"><in0>${cms}</in0></loginCms>`;
  const { status, body } = await llamarSoap(WSAA_URL, soapBody);

  if (status !== 200) {
    throw new Error(`ARCA (WSAA) respondió con error HTTP ${status}: ${body.slice(0, 500)}`);
  }

  const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true });
  const parsed = parser.parse(body);
  const fault = parsed?.Envelope?.Body?.Fault;
  if (fault) {
    const texto = String(fault.faultstring || JSON.stringify(fault));
    if (/alreadyAuthenticated|ya posee un TA valido/i.test(`${fault.faultcode || ''} ${texto}`)) {
      throw new Error(
        'ARCA dice que ya entregó un permiso de facturación que sigue vigente, pero el sistema no lo tiene guardado ' +
          '(pasa si se cortó la conexión justo cuando ARCA lo mandaba). Ese permiso vence solo en unas horas (máximo 12): ' +
          'hasta entonces no se puede facturar electrónicamente. Detalle de ARCA: ' + texto
      );
    }
    throw new Error(`ARCA (WSAA) rechazó el login: ${texto}`);
  }

  const loginCmsReturn = parsed?.Envelope?.Body?.loginCmsResponse?.loginCmsReturn;
  if (!loginCmsReturn) {
    throw new Error(`Respuesta de ARCA (WSAA) inesperada, no trae loginCmsReturn: ${body.slice(0, 500)}`);
  }
  const ticket = parser.parse(loginCmsReturn);
  const credenciales = ticket?.loginTicketResponse?.credentials;
  const expirationTime = ticket?.loginTicketResponse?.header?.expirationTime;
  if (!credenciales?.token || !credenciales?.sign) {
    throw new Error(`No se pudo leer token/sign del ticket de ARCA: ${loginCmsReturn.slice(0, 500)}`);
  }

  const resultado = {
    token: String(credenciales.token),
    sign: String(credenciales.sign),
    expira: expirationTime ? new Date(expirationTime).getTime() : Date.now() + 11 * 60 * 60 * 1000,
  };
  cacheTickets.set(servicio, resultado);
  guardarTicket(servicio, resultado);
  return resultado;
}

module.exports = { obtenerTicket, llamarSoap, cargarCredenciales, obtenerCuit, ARCA_DIR };
