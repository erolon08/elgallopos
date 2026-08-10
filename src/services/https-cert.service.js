// Certificado HTTPS autofirmado para poder usar el sistema en la red local
// sin depender de internet: el navegador solo habilita el portapapeles
// (Ctrl+C / Ctrl+V de imágenes) en un "contexto seguro" (HTTPS o
// localhost) — por http:// plano (la IP de la LAN) lo bloquea siempre.
// Se genera una sola vez y se reutiliza entre reinicios; incluye como SAN
// todas las IPs LAN que tenga la máquina en ese momento, para que sirva
// desde cualquier otra PC de la red.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const DIR = path.join(__dirname, '..', '..', 'data', 'certs');
const KEY_PATH = path.join(DIR, 'server.key');
const CERT_PATH = path.join(DIR, 'server.crt');

function direccionesLan() {
  const ifaces = os.networkInterfaces();
  const ips = [];
  for (const lista of Object.values(ifaces)) {
    for (const info of lista || []) {
      if (info.family === 'IPv4' && !info.internal) ips.push(info.address);
    }
  }
  return ips;
}

function generarCertificado() {
  const forge = require('node-forge');

  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 15);

  const attrs = [
    { name: 'commonName', value: 'El Gallo POS' },
    { name: 'organizationName', value: 'Cerrajeria El Gallo' },
    { name: 'countryName', value: 'AR' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);

  const altNames = [
    { type: 2, value: 'localhost' }, // DNS
    { type: 7, ip: '127.0.0.1' }, // IP
  ];
  for (const ip of direccionesLan()) altNames.push({ type: 7, ip });

  cert.setExtensions([
    { name: 'basicConstraints', cA: true },
    { name: 'keyUsage', keyCertSign: true, digitalSignature: true, keyEncipherment: true },
    { name: 'extKeyUsage', serverAuth: true },
    { name: 'subjectAltName', altNames },
  ]);

  cert.sign(keys.privateKey, forge.md.sha256.create());

  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(KEY_PATH, forge.pki.privateKeyToPem(keys.privateKey));
  fs.writeFileSync(CERT_PATH, forge.pki.certificateToPem(cert));
}

function obtenerCertificado() {
  if (!fs.existsSync(KEY_PATH) || !fs.existsSync(CERT_PATH)) {
    generarCertificado();
  }
  return { key: fs.readFileSync(KEY_PATH), cert: fs.readFileSync(CERT_PATH) };
}

module.exports = { obtenerCertificado };
