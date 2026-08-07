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
ensureColumn('configuracion', 'telefono_recuperacion', 'TEXT');
ensureColumn('usuarios', 'reset_codigo', 'TEXT');
ensureColumn('usuarios', 'reset_expira', 'TEXT');
ensureColumn('cerrajeros', 'porcentaje_urgencia', 'REAL NOT NULL DEFAULT 0');
ensureColumn('presupuestos', 'modo_precio', "TEXT NOT NULL DEFAULT 'todos'");
ensureColumn('presupuesto_items', 'tipo_precio', "TEXT NOT NULL DEFAULT 'final'");
ensureColumn('configuracion', 'arca_punto_venta', 'TEXT');
ensureColumn('configuracion', 'arca_facturacion_activa', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('ventas', 'iva_neto', 'REAL');
ensureColumn('ventas', 'iva_monto', 'REAL');
ensureColumn('configuracion', 'mp_access_token', 'TEXT');
ensureColumn('configuracion', 'mp_activo', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('configuracion', 'mp_user_id', 'TEXT');
ensureColumn('configuracion', 'mp_store_external_id', 'TEXT');
ensureColumn('configuracion', 'mp_pos_external_id', 'TEXT');
ensureColumn('configuracion', 'mp_qr_fijo_image_url', 'TEXT');
ensureColumn('configuracion', 'mp_qr_fijo_template_url', 'TEXT');
ensureColumn('familias', 'pregunta_pila', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('productos', 'es_pila', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('venta_items', 'pila_producto_id', 'INTEGER REFERENCES productos(id)');
ensureColumn('presupuesto_items', 'pila_producto_id', 'INTEGER REFERENCES productos(id)');
ensureColumn('presupuesto_items', 'precio_final', 'REAL');
ensureColumn('presupuesto_items', 'precio_debito', 'REAL');
ensureColumn('presupuesto_items', 'precio_efectivo', 'REAL');

// El CHECK de la columna "rol" no se puede tocar con ALTER TABLE ADD COLUMN:
// hay que recrear la tabla. Se evita renombrar la tabla "usuarios" original
// (varias tablas tienen FK hacia ella y un RENAME reescribe esas referencias
// al nombre viejo) — en cambio se arma la tabla nueva aparte, se copian los
// datos, se borra la vieja y recién ahí se renombra la nueva a "usuarios".
const usuariosDef = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='usuarios'").get();
if (usuariosDef && !usuariosDef.sql.includes('STOCK')) {
  db.pragma('foreign_keys = OFF');
  db.exec(`
    CREATE TABLE usuarios_nuevo (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      usuario TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      rol TEXT NOT NULL CHECK (rol IN ('ADMIN','CAJA','VENTA','STOCK')),
      activo INTEGER NOT NULL DEFAULT 1,
      creado_en TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    INSERT INTO usuarios_nuevo (id, nombre, usuario, password_hash, rol, activo, creado_en)
      SELECT id, nombre, usuario, password_hash, rol, activo, creado_en FROM usuarios;
    DROP TABLE usuarios;
    ALTER TABLE usuarios_nuevo RENAME TO usuarios;
  `);
  db.pragma('foreign_keys = ON');
}

const yaHayUsuarioStock = db.prepare("SELECT 1 FROM usuarios WHERE rol = 'STOCK'").get();
if (!yaHayUsuarioStock) {
  const bcrypt = require('bcryptjs');
  db.prepare('INSERT INTO usuarios (nombre, usuario, password_hash, rol) VALUES (?, ?, ?, ?)').run(
    'Stock', 'stock', bcrypt.hashSync('4444', 8), 'STOCK'
  );
}

db.DB_PATH = DB_PATH;
module.exports = db;
