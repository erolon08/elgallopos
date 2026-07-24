const path = require('node:path');
const fs = require('node:fs');
const Database = require('better-sqlite3');

const DB_PATH = process.env.GALLO_DB_PATH || path.join(__dirname, '..', '..', 'data', 'gallopos.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// CREATE TABLE IF NOT EXISTS no agrega columnas nuevas a tablas que ya existían
// antes del cambio. Para que una base con datos reales (no recién sembrada)
// también reciba las columnas agregadas en versiones posteriores, se completan
// acá con ALTER TABLE — sin tocar los datos existentes.
function ensureColumn(tabla, columna, definicion) {
  const columnas = db.prepare(`PRAGMA table_info(${tabla})`).all();
  if (!columnas.some((c) => c.name === columna)) {
    db.exec(`ALTER TABLE ${tabla} ADD COLUMN ${columna} ${definicion}`);
  }
}
ensureColumn('productos', 'orden_botonera', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('configuracion', 'responsable_nombre', 'TEXT');
ensureColumn('configuracion', 'cuit_negocio', 'TEXT');
ensureColumn('configuracion', 'domicilio_negocio', 'TEXT');
ensureColumn('configuracion', 'condicion_fiscal_negocio', 'TEXT');
ensureColumn('configuracion', 'inicio_actividades', 'TEXT');
ensureColumn('configuracion', 'ingresos_brutos', 'TEXT');

module.exports = db;
