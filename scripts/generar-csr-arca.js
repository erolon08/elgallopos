// Genera la clave privada y el "pedido de certificado" (CSR) que hacen falta
// para dar de alta el certificado digital del servicio de Facturación
// Electrónica (WSFE) en ARCA. No se conecta a ARCA ni sube nada solo: arma
// los archivos localmente, y después hay que subir el .csr a mano en el
// Administrador de Relaciones de Clave Fiscal (arca.gob.ar).
//
// Cómo usarlo: completá los 3 datos de acá abajo (entre comillas) y guardá
// el archivo. Después corré, desde la carpeta del sistema:
//   npm run generar-csr-arca
//
// La clave privada que genera (arca/arca-clave-privada.key) NUNCA se
// comparte ni se sube a ningún lado — es la que después va a usar el
// sistema para firmar los pedidos de factura. Por eso la carpeta arca/
// está en .gitignore.

const CUIT = ''; // Ej: '20304050607' (11 números, sin guiones)
const RAZON_SOCIAL = ''; // Ej: 'CERRAJERIA EL GALLO'
const ALIAS = ''; // Ej: 'gallopos' — un nombre corto para identificar este certificado, sin espacios

const fs = require('node:fs');
const path = require('node:path');
const forge = require('node-forge');

const OUT_DIR = path.join(__dirname, '..', 'arca');

function main() {
  const cuitLimpio = CUIT.replace(/\D/g, '');
  if (cuitLimpio.length !== 11) {
    console.error('Completá CUIT en este archivo (scripts/generar-csr-arca.js) con los 11 números, sin guiones.');
    process.exit(1);
  }
  if (!RAZON_SOCIAL.trim()) {
    console.error('Completá RAZON_SOCIAL en este archivo (scripts/generar-csr-arca.js).');
    process.exit(1);
  }
  if (!ALIAS.trim() || /\s/.test(ALIAS)) {
    console.error('Completá ALIAS en este archivo (scripts/generar-csr-arca.js), sin espacios.');
    process.exit(1);
  }

  console.log('Generando clave privada (2048 bits, puede tardar unos segundos)...');
  const keys = forge.pki.rsa.generateKeyPair(2048);

  const csr = forge.pki.createCertificationRequest();
  csr.publicKey = keys.publicKey;
  csr.setSubject([
    { name: 'commonName', value: ALIAS.trim() },
    { name: 'organizationName', value: RAZON_SOCIAL.trim() },
    { name: 'countryName', value: 'AR' },
    { name: 'serialNumber', value: `CUIT ${cuitLimpio}` },
  ]);
  csr.sign(keys.privateKey, forge.md.sha256.create());

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const rutaKey = path.join(OUT_DIR, 'arca-clave-privada.key');
  const rutaCsr = path.join(OUT_DIR, 'arca-solicitud.csr');

  fs.writeFileSync(rutaKey, forge.pki.privateKeyToPem(keys.privateKey));
  fs.writeFileSync(rutaCsr, forge.pki.certificationRequestToPem(csr));

  console.log('\nListo. Se crearon 2 archivos en la carpeta "arca/":');
  console.log(`  - ${rutaKey}  (clave privada — NO la compartas ni la subas a ningún lado)`);
  console.log(`  - ${rutaCsr}  (pedido de certificado — este sí se sube a ARCA)`);
  console.log('\nPróximo paso:');
  console.log('  1. Entrá a arca.gob.ar con tu Clave Fiscal.');
  console.log('  2. Buscá "Administrador de Relaciones de Clave Fiscal".');
  console.log('  3. Ahí gestioná el certificado digital y, cuando pida el archivo del pedido,');
  console.log('     subí el archivo arca-solicitud.csr que se acaba de crear.');
  console.log('  4. Cuando ARCA te dé el certificado, guardá ese archivo también dentro de la carpeta "arca/"');
  console.log('     (avisame cuando lo tengas y seguimos con el siguiente paso: autorizarlo para el servicio de Facturación Electrónica).');
}

main();
