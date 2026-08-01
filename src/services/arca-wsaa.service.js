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
const WSAA_URL = 'https://wsaa.afip.gov.ar/ws/services/LoginCgi';

const cacheTickets = new Map(); // servicio -> { token, sign, expira }

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
// certificado (campo serialNumber, "CUIT 20304239655") en vez de tener que
// configurarlo aparte — así no se puede desincronizar del certificado real.
function obtenerCuit() {
  const { certPem } = cargarCredenciales();
  const cert = forge.pki.certificateFromPem(certPem);
  const campo = cert.subject.getField('serialNumber');
  const match = campo && String(campo.value).match(/(\d{11})/);
  if (!match) {
    throw new Error('No se pudo leer el CUIT del certificado (campo serialNumber ausente o con formato inesperado).');
  }
  return match[1];
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

function llamarSoap(url, soapBody) {
  const envelope = `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body>${soapBody}</soapenv:Body></soapenv:Envelope>`;
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          SOAPAction: '',
          'Content-Length': Buffer.byteLength(envelope),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      }
    );
    req.on('error', reject);
    req.write(envelope);
    req.end();
  });
}

// Pide (o devuelve del caché) el token+sign para un servicio de ARCA. "wsfe"
// es el único que usa Gallo POS por ahora.
async function obtenerTicket(servicio = 'wsfe') {
  const cacheado = cacheTickets.get(servicio);
  if (cacheado && cacheado.expira > Date.now() + 5 * 60 * 1000) {
    return cacheado;
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
    throw new Error(`ARCA (WSAA) rechazó el login: ${fault.faultstring || JSON.stringify(fault)}`);
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
  return resultado;
}

module.exports = { obtenerTicket, llamarSoap, cargarCredenciales, obtenerCuit, ARCA_DIR };
