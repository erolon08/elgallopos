// OJO: este script emite una factura ELECTRÓNICA REAL en ARCA. No es una
// simulación ni un ambiente de prueba — es un comprobante fiscal válido e
// IRREVERSIBLE (no se puede "deshacer", solo correguir con una nota de
// crédito más adelante). Por eso pide una confirmación explícita abajo
// antes de mandar nada.
//
// Pensado para hacer UNA factura de prueba, de un monto chico, y confirmar
// que Gallo POS ya puede facturar de punta a punta antes de conectarlo a
// la pantalla de Venta.
//
// Uso: completá los datos de acá abajo, cambiá CONFIRMO a true, y corré:
//   npm run test-arca-emitir-factura

const CONFIRMO = false; // cambiar a "true" recién cuando estés seguro de emitir de verdad

const PUNTO_VENTA = 7;
const TIPO_COMPROBANTE = 'Factura B'; // 'Factura A' o 'Factura B'
const MONTO_TOTAL = 100; // en pesos, CON IVA incluido — dejalo chico para la prueba
const CONCEPTO = 1; // 1 = productos, 2 = servicios, 3 = productos y servicios

// Datos del cliente. Para Factura A, CLIENTE_CUIT es obligatorio. Si se
// dejan los 3 en blanco, se factura a Consumidor Final sin identificar.
const CLIENTE_CUIT = '';
const CLIENTE_DNI = '';
const CLIENTE_CONDICION_IVA = 'Consumidor Final'; // Responsable Inscripto | Monotributista | Exento | Consumidor Final

const arcaFacturacion = require('../src/services/arca-facturacion.service');

async function main() {
  if (!CONFIRMO) {
    console.log('No se emitió nada.');
    console.log('Este script está frenado a propósito: abrí el archivo scripts/test-arca-emitir-factura.js,');
    console.log('revisá los datos de arriba (punto de venta, monto, cliente) y cambiá CONFIRMO a true para emitir de verdad.');
    return;
  }

  console.log(`Emitiendo ${TIPO_COMPROBANTE} de $${MONTO_TOTAL} en el Punto de Venta ${PUNTO_VENTA}...`);
  try {
    const resultado = await arcaFacturacion.emitirFactura({
      tipoComprobante: TIPO_COMPROBANTE,
      total: MONTO_TOTAL,
      concepto: CONCEPTO,
      ptoVta: PUNTO_VENTA,
      cliente: {
        cuit: CLIENTE_CUIT || null,
        documento: CLIENTE_DNI || null,
        condicion_iva: CLIENTE_CONDICION_IVA,
      },
    });
    console.log('\n✓ Factura emitida y autorizada por ARCA.');
    console.log(`  Comprobante: ${resultado.numeroCompleto} (${resultado.tipoComprobante})`);
    console.log(`  CAE: ${resultado.cae}`);
    console.log(`  Vencimiento del CAE: ${resultado.caeVencimiento}`);
    console.log(`  Neto: $${resultado.impNeto} + IVA: $${resultado.impIva} = Total: $${resultado.impTotal}`);
    if (resultado.observaciones) {
      console.log(`  Observaciones de ARCA (no bloquean, pero conviene revisarlas): ${resultado.observaciones}`);
    }
  } catch (err) {
    console.error('\n✗ No se pudo emitir la factura:', err.message);
    process.exit(1);
  }
}

main();
