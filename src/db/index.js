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
ensureColumn('clientes', 'saldo_cta_cte', 'REAL NOT NULL DEFAULT 0');
ensureColumn('ventas', 'cta_cte_saldo_pendiente', 'REAL NOT NULL DEFAULT 0');
ensureColumn('direcciones', 'venta_id', 'INTEGER REFERENCES ventas(id)');
ensureColumn('configuracion', 'whatsapp_token', 'TEXT');
ensureColumn('configuracion', 'whatsapp_phone_number_id', 'TEXT');
ensureColumn('configuracion', 'whatsapp_verify_token', 'TEXT');
ensureColumn('configuracion', 'whatsapp_activo', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('configuracion', 'whatsapp_instrucciones', 'TEXT');
ensureColumn('configuracion', 'anthropic_api_key', 'TEXT');
// Va acá (no en schema.sql) porque necesita que la columna de arriba ya
// exista: en una base migrada, schema.sql corre ANTES que estos
// ensureColumn, así que un CREATE INDEX sobre esa columna ahí arriba
// fallaba en bases ya existentes que todavía no la tenían.
db.exec('CREATE INDEX IF NOT EXISTS idx_ventas_ctacte_pendiente ON ventas(cta_cte_saldo_pendiente)');

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

// El CHECK de rendicion_detalle.tipo no incluía 'codificado' (trabajos de
// la lista rápida de trabajos_codificados, que no son ni un "servicio" ni
// un "duplicado" real) — mismo problema y misma solución que arriba con
// usuarios.rol: un CHECK no se puede tocar con ALTER TABLE, hay que
// recrear la tabla.
const rendicionDetalleDef = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='rendicion_detalle'").get();
if (rendicionDetalleDef && !rendicionDetalleDef.sql.includes('codificado')) {
  db.pragma('foreign_keys = OFF');
  db.exec(`
    CREATE TABLE rendicion_detalle_nuevo (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rendicion_id INTEGER NOT NULL REFERENCES rendiciones(id),
      venta_item_id INTEGER REFERENCES venta_items(id),
      tipo TEXT NOT NULL CHECK (tipo IN ('servicio','duplicado','codificado')),
      codigo TEXT,
      descripcion TEXT NOT NULL,
      venta_numero TEXT,
      cantidad REAL NOT NULL DEFAULT 1,
      monto_base REAL NOT NULL,
      porcentaje REAL NOT NULL,
      monto_rendido REAL NOT NULL,
      creado_en TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    INSERT INTO rendicion_detalle_nuevo
      (id, rendicion_id, venta_item_id, tipo, codigo, descripcion, venta_numero, cantidad, monto_base, porcentaje, monto_rendido, creado_en)
      SELECT id, rendicion_id, venta_item_id, tipo, codigo, descripcion, venta_numero, cantidad, monto_base, porcentaje, monto_rendido, creado_en
      FROM rendicion_detalle;
    DROP TABLE rendicion_detalle;
    ALTER TABLE rendicion_detalle_nuevo RENAME TO rendicion_detalle;
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
