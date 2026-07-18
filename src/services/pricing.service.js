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

// Servicios (familia con usa_mano_obra=1): el precio final no es un dato de
// catálogo, se calcula en el momento de la venta a partir de la mano de obra
// del trabajo, aplicando en cadena los recargos propios de ese código de
// servicio (ej. "11,21" o "11,21,18" para servicios de codificados).
function parsearRecargos(recargosStr) {
  if (!recargosStr) return [];
  return String(recargosStr)
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n !== 0);
}

function calcularPrecioFinalServicio(montoManoObra, recargosStr) {
  const recargos = parsearRecargos(recargosStr);
  const factor = recargos.reduce((acc, pct) => acc * (1 + pct / 100), 1);
  return roundUpTo100((Number(montoManoObra) || 0) * factor);
}

module.exports = { roundUpTo100, calcularPrecios, parsearRecargos, calcularPrecioFinalServicio };
