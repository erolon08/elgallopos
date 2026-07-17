// Reglas de precio automáticas (sección 4.7 del documento maestro).
// Débito/Transferencia y Efectivo se calculan a partir del Precio Final
// aplicando el descuento de la familia, con redondeo hacia arriba a
// múltiplos de $100 (mismo criterio que la rendición de cerrajeros).

function roundUpTo100(value) {
  return Math.ceil(value / 100) * 100;
}

function calcularPrecios(precioFinal, familia) {
  const debito = roundUpTo100(precioFinal * (1 - familia.descuento_debito / 100));
  const efectivo = roundUpTo100(precioFinal * (1 - familia.descuento_efectivo / 100));
  return { precio_debito: debito, precio_efectivo: efectivo };
}

module.exports = { roundUpTo100, calcularPrecios };
