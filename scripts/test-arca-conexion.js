// Prueba de punta a punta contra los servidores reales de ARCA, sin ningún
// riesgo fiscal: no emite ningún comprobante, solo verifica que el
// certificado (arca/) autentica correctamente y que se puede consultar el
// último número autorizado para el punto de venta.
//
// Uso: npm run test-arca-conexion

const PUNTO_VENTA = 7; // el que diste de alta para Gallo POS

const wsfe = require('../src/services/arca-wsfe.service');

async function main() {
  console.log('== Probando conexión con ARCA ==\n');

  console.log('1) FEDummy (conectividad, sin autenticar)...');
  try {
    const dummy = await wsfe.dummy();
    console.log(`   AppServer: ${dummy.AppServer} | DbServer: ${dummy.DbServer} | AuthServer: ${dummy.AuthServer}`);
    if (dummy.AppServer !== 'OK' || dummy.DbServer !== 'OK' || dummy.AuthServer !== 'OK') {
      console.log('   ⚠ Alguno de los servidores de ARCA no está OK — puede ser un problema temporal de ellos, no del certificado.');
    } else {
      console.log('   ✓ Todo OK.');
    }
  } catch (err) {
    console.error('   ✗ Falló:', err.message);
    process.exit(1);
  }

  console.log(`\n2) Último comprobante autorizado en el Punto de Venta ${PUNTO_VENTA} (esto sí exige el certificado)...`);
  for (const [nombre, tipo] of [['Factura A', 1], ['Factura B', 6]]) {
    try {
      const r = await wsfe.ultimoAutorizado(PUNTO_VENTA, tipo);
      console.log(`   ${nombre}: último número autorizado = ${r.CbteNro} (0 si todavía no facturaste nada ahí)`);
    } catch (err) {
      console.error(`   ✗ ${nombre} falló:`, err.message);
      process.exit(1);
    }
  }

  console.log('\n✓ Conexión con ARCA funcionando de punta a punta. El certificado autentica correctamente.');
}

main().catch((err) => {
  console.error('\nError inesperado:', err);
  process.exit(1);
});
