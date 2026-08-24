-- EL GALLO POS — Esquema de base de datos
-- SQLite (modo WAL). Incluye campos reservados para facturación electrónica (AFIP)
-- que se implementará más adelante, para no tener que rediseñar tablas después.

PRAGMA foreign_keys = ON;

-- ============================================================
-- USUARIOS Y ROLES
-- ============================================================
CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  usuario TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  rol TEXT NOT NULL CHECK (rol IN ('ADMIN','CAJA','VENTA','STOCK')),
  activo INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ============================================================
-- FAMILIAS (reglas automáticas de precio y de rendición)
-- ============================================================
CREATE TABLE IF NOT EXISTS familias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE,
  descuento_debito REAL NOT NULL DEFAULT 20,   -- % que se resta del precio final
  descuento_efectivo REAL NOT NULL DEFAULT 30, -- % que se resta del precio final
  usa_precio_rendicion INTEGER NOT NULL DEFAULT 0, -- ej: DUPLICADOS
  usa_mano_obra INTEGER NOT NULL DEFAULT 0,        -- ej: SERVICIOS
  pregunta_pila INTEGER NOT NULL DEFAULT 0,        -- ej: CODIFICADOS (pregunta qué pila se usó al vender)
  activo INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ============================================================
-- PROVEEDORES
-- ============================================================
CREATE TABLE IF NOT EXISTS proveedores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE,
  telefono TEXT,
  activo INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ============================================================
-- PRODUCTOS
-- El usuario solo carga: codigo, descripcion, familia, proveedor, costo,
-- precio_final, stock_minimo, iva. precio_debito/precio_efectivo se calculan
-- automáticamente salvo que usar_regla_automatica = 0.
-- precio_rendicion: solo aplica a familias con usa_precio_rendicion = 1
-- (ej. duplicados de llaves), lo carga el ADMIN y cambia de vez en cuando.
-- ============================================================
CREATE TABLE IF NOT EXISTS productos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT NOT NULL UNIQUE,
  descripcion TEXT NOT NULL,
  familia_id INTEGER NOT NULL REFERENCES familias(id),
  proveedor_id INTEGER REFERENCES proveedores(id),
  costo REAL NOT NULL DEFAULT 0,
  precio_final REAL NOT NULL DEFAULT 0,
  precio_debito REAL NOT NULL DEFAULT 0,
  precio_efectivo REAL NOT NULL DEFAULT 0,
  precio_rendicion REAL,
  recargos_mano_obra TEXT,       -- solo familias con usa_mano_obra=1: % separados por coma, ej "11,21"
  usar_regla_automatica INTEGER NOT NULL DEFAULT 1,
  iva REAL NOT NULL DEFAULT 21,
  stock_actual REAL NOT NULL DEFAULT 0,
  stock_minimo REAL NOT NULL DEFAULT 0,
  favorito INTEGER NOT NULL DEFAULT 0,  -- aparece en la botonera rápida de Venta
  orden_botonera INTEGER NOT NULL DEFAULT 0,  -- posición manual dentro de la botonera de favoritos
  es_pila INTEGER NOT NULL DEFAULT 0,   -- este producto es una pila (se ofrece en el diálogo "¿qué pila se usó?")
  activo INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  actualizado_en TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_productos_familia ON productos(familia_id);
CREATE INDEX IF NOT EXISTS idx_productos_descripcion ON productos(descripcion);
CREATE INDEX IF NOT EXISTS idx_productos_proveedor ON productos(proveedor_id);

-- ============================================================
-- STOCK — MOVIMIENTOS (núcleo del módulo de Control de Stock)
-- tipo: venta (resta), nota_credito (devuelve/suma), ajuste (manual, +/-), compra (suma)
-- ============================================================
CREATE TABLE IF NOT EXISTS stock_movimientos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  producto_id INTEGER NOT NULL REFERENCES productos(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('venta','nota_credito','ajuste','compra')),
  cantidad REAL NOT NULL,          -- puede ser negativa (venta) o positiva (compra/devolución/ajuste+)
  stock_resultante REAL NOT NULL,
  motivo TEXT,
  referencia_tipo TEXT,            -- 'venta' | 'compra' | null
  referencia_id INTEGER,
  usuario_id INTEGER REFERENCES usuarios(id),
  terminal TEXT,
  creado_en TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_stockmov_producto ON stock_movimientos(producto_id, creado_en);

-- ============================================================
-- COMPRAS (alimentan el stock con tipo 'compra')
-- ============================================================
CREATE TABLE IF NOT EXISTS compras (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  proveedor_id INTEGER REFERENCES proveedores(id),
  numero TEXT,
  estado TEXT NOT NULL DEFAULT 'recibida' CHECK (estado IN ('recibida','anulada')),
  total REAL NOT NULL DEFAULT 0,
  usuario_id INTEGER REFERENCES usuarios(id),
  creado_en TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS compra_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  compra_id INTEGER NOT NULL REFERENCES compras(id),
  producto_id INTEGER NOT NULL REFERENCES productos(id),
  cantidad REAL NOT NULL,
  costo_unitario REAL NOT NULL
);

-- ============================================================
-- CLIENTES (base histórica ~17.879, se respeta estructura existente)
-- codigo: número de cliente único, autogenerado al crear (no lo tipea el
-- usuario). condicion_iva: dato de ARCA/AFIP (Consumidor Final, Eventual,
-- Responsable Inscripto, Exento, Monotributista) que además define el tipo
-- de comprobante en la futura facturación electrónica.
-- ============================================================
CREATE TABLE IF NOT EXISTS clientes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT UNIQUE,
  nombre TEXT NOT NULL,
  telefono TEXT,
  documento TEXT,
  cuit TEXT,
  email TEXT,
  direccion TEXT,
  localidad TEXT,
  condicion_iva TEXT NOT NULL DEFAULT 'Consumidor Final',
  tipo_cliente TEXT NOT NULL DEFAULT 'GENERAL',
  venta_a_credito INTEGER NOT NULL DEFAULT 0,
  limite_credito REAL NOT NULL DEFAULT 0,
  saldo_cta_cte REAL NOT NULL DEFAULT 0, -- cuánto debe hoy (positivo = debe); se mueve solo vía cc_movimientos
  activo INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_clientes_nombre ON clientes(nombre);
CREATE INDEX IF NOT EXISTS idx_clientes_telefono ON clientes(telefono);
CREATE INDEX IF NOT EXISTS idx_clientes_documento ON clientes(documento);

-- ============================================================
-- CUENTA CORRIENTE DE CLIENTES (kardex, mismo patrón que stock_movimientos)
-- tipo: saldo_inicial (carga de migración) | venta (Cta. Cte. al cobrar) |
-- pago (el cliente paga, resta) | ajuste (manual) | nota_credito (reversa una venta anulada)
-- monto: positivo = suma deuda, negativo = resta deuda (pago)
-- ============================================================
CREATE TABLE IF NOT EXISTS cc_movimientos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('saldo_inicial','venta','pago','ajuste','nota_credito')),
  monto REAL NOT NULL,
  saldo_resultante REAL NOT NULL,
  motivo TEXT,
  forma_pago TEXT, -- solo en tipo='pago': cómo pagó (Efectivo, Transferencia, etc.)
  referencia_tipo TEXT, -- 'venta' | null
  referencia_id INTEGER,
  usuario_id INTEGER REFERENCES usuarios(id),
  terminal TEXT,
  creado_en TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_ccmov_cliente ON cc_movimientos(cliente_id, creado_en);

-- Deuda migrada desde otro sistema (posBerry) por factura puntual, separada
-- de "ventas" a propósito: no es una venta real hecha acá (no tiene items,
-- no descuenta stock, no debe aparecer en reportes/rankings de ventas), pero
-- sí tiene que poder listarse y cancelarse individualmente igual que una
-- venta a Cta. Cte., por eso comparte el concepto de "saldo_pendiente".
CREATE TABLE IF NOT EXISTS cc_deudas_migradas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id),
  numero_factura TEXT,
  razon_social TEXT,
  monto_original REAL NOT NULL,
  saldo_pendiente REAL NOT NULL,
  creado_en TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_ccdeudas_cliente ON cc_deudas_migradas(cliente_id, saldo_pendiente);

-- patente: única por vehículo, se busca como identificador principal.
CREATE TABLE IF NOT EXISTS vehiculos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id),
  marca_modelo TEXT,
  patente TEXT UNIQUE,
  creado_en TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_vehiculos_patente ON vehiculos(patente);
CREATE INDEX IF NOT EXISTS idx_vehiculos_cliente ON vehiculos(cliente_id);

-- ============================================================
-- CERRAJEROS
-- porcentaje_rendicion: 30% fijo para todos (configurable por si cambia a futuro)
-- aporte_fijo: descuento recurrente que se aplica automático en cada rendición
-- descuento_tarjeta_credito: cuando la venta se cobró (total o parcialmente) con
-- tarjeta de crédito, este % (7.5%-15% según el cerrajero) reduce la mano de obra
-- ANTES de calcular el % de rendición, en la proporción que representó el crédito
-- sobre el total cobrado (ver rendiciones.service.js).
-- ============================================================
CREATE TABLE IF NOT EXISTS cerrajeros (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  porcentaje_rendicion REAL NOT NULL DEFAULT 30,
  porcentaje_urgencia REAL NOT NULL DEFAULT 0,
  aporte_fijo REAL NOT NULL DEFAULT 0,
  descuento_tarjeta_credito REAL NOT NULL DEFAULT 0,
  activo INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Direcciones: anotador rápido de "adónde va cada cerrajero" antes de que
-- exista una venta (todavía no hay precio ni productos definidos). Desde
-- ahí se "pasa a venta" para armar el carrito y facturar; en ese momento
-- queda marcada como convertida y sale de la lista activa.
CREATE TABLE IF NOT EXISTS direcciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  direccion TEXT NOT NULL,
  trabajo TEXT NOT NULL,
  telefono TEXT,
  cerrajero_id INTEGER REFERENCES cerrajeros(id),
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','convertida')),
  venta_id INTEGER REFERENCES ventas(id),
  creado_en TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  convertido_en TEXT
);
CREATE INDEX IF NOT EXISTS idx_direcciones_estado ON direcciones(estado);

-- Chat interno entre puestos (ADMIN/CAJA/VENTA/STOCK): el login es por rol
-- compartido, no por empleado individual, así que un mensaje va dirigido a
-- un ROL — lo ve cualquier terminal que esté conectada con ese puesto.
CREATE TABLE IF NOT EXISTS mensajes_internos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  de_rol TEXT NOT NULL,
  para_rol TEXT NOT NULL,
  texto TEXT NOT NULL,
  leido INTEGER NOT NULL DEFAULT 0,
  creado_en TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_mensajes_para_rol ON mensajes_internos(para_rol, leido);

-- ============================================================
-- CAJA — TURNOS Y MOVIMIENTOS
-- ============================================================
-- fondo_turno_siguiente: al cerrar, cuánto efectivo se deja en la caja como
-- saldo inicial del próximo turno (se sugiere como fondo_inicial al abrir el
-- siguiente). El resto del efectivo contado se envía a caja fuerte, lo que
-- genera un egreso en caja_movimientos por esa diferencia (ver cerrarTurno).
CREATE TABLE IF NOT EXISTS caja_turnos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  numero TEXT NOT NULL,
  terminal TEXT NOT NULL,
  usuario_id INTEGER REFERENCES usuarios(id),
  fondo_inicial REAL NOT NULL DEFAULT 0,
  fondo_turno_siguiente REAL,
  efectivo_esperado REAL,
  efectivo_contado REAL,
  diferencia REAL,
  observacion TEXT,
  abierto_en TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  cerrado_en TEXT,
  estado TEXT NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto','cerrado'))
);

CREATE TABLE IF NOT EXISTS caja_movimientos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  caja_turno_id INTEGER NOT NULL REFERENCES caja_turnos(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('ingreso','egreso')),
  categoria TEXT NOT NULL,        -- 'venta' | 'empleados' | 'gasto' | 'retiro' | 'otro' | 'rendicion' | 'caja_fuerte'
  tipo_egreso TEXT,                -- subcategoría libre para reportes (ej. "Combustible", o el nombre
                                   -- del cerrajero cuando categoria='rendicion'); no confundir con "tipo"
  concepto TEXT,
  monto REAL NOT NULL,
  forma_pago TEXT,                -- 'Efectivo' | 'Débito' | 'Crédito' | 'Transferencia' | 'QR' | 'Cuenta Corriente'
                                   -- solo los movimientos en Efectivo entran al arqueo de caja física
  referencia_tipo TEXT,           -- 'venta' | 'rendicion' | null
  referencia_id INTEGER,
  usuario_id INTEGER REFERENCES usuarios(id),
  creado_en TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_cajamov_turno ON caja_movimientos(caja_turno_id);

-- ============================================================
-- VENTAS
-- Campos reservados para facturación electrónica AFIP: tipo_comprobante,
-- numero_comprobante, cae, cae_vencimiento.
-- ============================================================
CREATE TABLE IF NOT EXISTS ventas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  numero TEXT UNIQUE,
  cliente_id INTEGER REFERENCES clientes(id),
  terminal_origen TEXT NOT NULL,
  usuario_id INTEGER REFERENCES usuarios(id),
  caja_turno_id INTEGER REFERENCES caja_turnos(id),
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','enviada_caja','cobrada','anulada')),
  forma_pago TEXT,
  subtotal REAL NOT NULL DEFAULT 0,
  descuento_general REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  tipo_comprobante TEXT NOT NULL DEFAULT 'Eventual', -- Eventual | Factura A | Factura B (reservado AFIP)
  numero_comprobante TEXT,
  cae TEXT,
  cae_vencimiento TEXT,
  -- Neto/IVA tal como se le reportaron a ARCA al pedir el CAE (para poder
  -- mostrarlos discriminados en el ticket de Factura A, que lo exige).
  iva_neto REAL,
  iva_monto REAL,
  enviado_whatsapp INTEGER NOT NULL DEFAULT 0,
  -- Cuánto de la parte pagada "Cuenta Corriente" de ESTA venta sigue sin
  -- cobrarse (0 = saldada). Se inicializa al cobrar y baja a medida que el
  -- cliente paga (registrarPago en cc.service.js la reparte de la venta más
  -- vieja a la más nueva). No es lo mismo que clientes.saldo_cta_cte (que es
  -- el total del cliente); esto es para poder pintar cada venta de rojo/verde.
  cta_cte_saldo_pendiente REAL NOT NULL DEFAULT 0,
  creado_en TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  cobrado_en TEXT
);
CREATE INDEX IF NOT EXISTS idx_ventas_estado ON ventas(estado);
CREATE INDEX IF NOT EXISTS idx_ventas_cliente ON ventas(cliente_id);

-- venta_items.monto_mano_obra: solo se carga en líneas de productos de familias
-- con usa_mano_obra = 1 (SERVICIOS). Es la base para calcular la rendición del
-- cerrajero, independiente del precio_unitario cobrado al cliente.
CREATE TABLE IF NOT EXISTS venta_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  venta_id INTEGER NOT NULL REFERENCES ventas(id),
  producto_id INTEGER REFERENCES productos(id),
  descripcion TEXT NOT NULL,
  cantidad REAL NOT NULL DEFAULT 1,
  precio_unitario REAL NOT NULL,
  tipo_precio TEXT NOT NULL DEFAULT 'final', -- final | debito | efectivo | manual
  descuento REAL NOT NULL DEFAULT 0,
  monto_mano_obra REAL,
  cerrajero_id INTEGER REFERENCES cerrajeros(id),
  pila_producto_id INTEGER REFERENCES productos(id), -- solo familias con pregunta_pila=1: qué pila se usó
  creado_en TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_ventaitems_venta ON venta_items(venta_id);
CREATE INDEX IF NOT EXISTS idx_ventaitems_cerrajero ON venta_items(cerrajero_id);
CREATE INDEX IF NOT EXISTS idx_ventaitems_producto ON venta_items(producto_id);

-- Detalle de cobro. Una venta con un solo medio de pago tiene una fila acá;
-- "Pago Combinado" reparte el total en varias filas (ej. mitad efectivo,
-- mitad débito). marca: Visa/Mastercard/etc para débito y crédito, billetera
-- (Mercado Pago/MODO) para QR.
CREATE TABLE IF NOT EXISTS venta_pagos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  venta_id INTEGER NOT NULL REFERENCES ventas(id),
  forma_pago TEXT NOT NULL CHECK (forma_pago IN ('Efectivo','Débito','Crédito','Transferencia','QR','Cuenta Corriente')),
  marca TEXT,
  monto REAL NOT NULL,
  creado_en TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_ventapagos_venta ON venta_pagos(venta_id);

-- Seguimiento de cada QR de cobro generado contra la API de Mercado Pago
-- (Checkout Pro). Una venta puede tener más de una fila acá si el QR se
-- generó de nuevo (ej. el cliente tardó y expiró, o se canceló y se volvió
-- a intentar). "aprobado"/"rechazado" reflejan lo que devolvió Mercado Pago;
-- la venta recién se cobra en el sistema cuando queda en 'aprobado'.
CREATE TABLE IF NOT EXISTS mp_pagos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  venta_id INTEGER NOT NULL REFERENCES ventas(id),
  external_reference TEXT NOT NULL UNIQUE,
  preference_id TEXT,
  monto REAL NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','aprobado','rechazado')),
  mp_payment_id TEXT,
  creado_en TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  actualizado_en TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_mppagos_venta ON mp_pagos(venta_id);

-- ============================================================
-- RENDICIÓN DE CERRAJEROS
-- Período libre (desde/hasta), no solo diario.
-- total_pagar = total_bruto - total_descuentos (aportes, repuestos, otros, adelantos)
-- ============================================================
CREATE TABLE IF NOT EXISTS rendiciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cerrajero_id INTEGER NOT NULL REFERENCES cerrajeros(id),
  fecha_desde TEXT NOT NULL,
  fecha_hasta TEXT NOT NULL,
  total_bruto REAL NOT NULL DEFAULT 0,
  total_descuentos REAL NOT NULL DEFAULT 0,
  total_pagar REAL NOT NULL DEFAULT 0,
  caja_movimiento_id INTEGER REFERENCES caja_movimientos(id),
  estado TEXT NOT NULL DEFAULT 'generada' CHECK (estado IN ('generada','pagada')),
  creado_en TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  pagado_en TEXT
);
CREATE INDEX IF NOT EXISTS idx_rendiciones_cerrajero ON rendiciones(cerrajero_id);

-- tipo: 'servicio' (30% de monto_mano_obra) | 'duplicado' (30% de precio_rendicion) |
-- 'codificado' (trabajo de la lista rápida de trabajos_codificados, monto completo
-- sin aplicar el % de la rendición — no es el área habitual del cerrajero).
-- venta_item_id: NULL si la línea se agregó a mano (no proviene de una venta cobrada).
-- codigo/descripcion/venta_numero/cantidad quedan "fotografiados" al generar o agregar
-- la línea, para que la rendición no dependa de que la venta original siga intacta.
CREATE TABLE IF NOT EXISTS rendicion_detalle (
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

-- Lista corta de trabajos "codificados" (autos) con precio fijo, para
-- agregar rápido a una rendición sin tipear todo a mano cada vez — el
-- cerrajero cobra el precio completo de la lista (no el % normal de la
-- rendición), porque hacer estos trabajos no es su área habitual. Editable
-- desde la pantalla de Rendición.
CREATE TABLE IF NOT EXISTS trabajos_codificados (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE,
  precio REAL NOT NULL DEFAULT 0,
  activo INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
INSERT OR IGNORE INTO trabajos_codificados (nombre, precio) VALUES
  ('Pilas', 750),
  ('Portón control', 1670),
  ('Pulsadores', 1645),
  ('K común', 2495),
  ('K Sevillana', 3450),
  ('K Sevillana especial', 6325),
  ('Reparación', 0),
  ('Alojamiento', 6440),
  ('Copia con transponder', 12305),
  ('Transponder', 8050),
  ('KD-Horse', 18800),
  ('0 llaves especiales', 37145),
  ('0 llaves', 20872),
  ('Presencia', 39100),
  ('Cranteado Yale', 6150),
  ('Cranteado Mapa', 8165),
  ('Copia oferta', 8500),
  ('Reparación mando especial', 10070),
  ('KD oferta', 13800);

-- tipo: 'aporte' (recurrente, precargado desde cerrajeros.aporte_fijo) |
-- 'repuesto' | 'otro' | 'adelanto' (eventuales, cargados al generar la rendición)
CREATE TABLE IF NOT EXISTS rendicion_descuentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rendicion_id INTEGER NOT NULL REFERENCES rendiciones(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('aporte','repuesto','otro','adelanto')),
  descripcion TEXT,
  monto REAL NOT NULL
);

-- ============================================================
-- PRESUPUESTOS
-- ============================================================
CREATE TABLE IF NOT EXISTS presupuestos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  numero TEXT UNIQUE,
  cliente_id INTEGER REFERENCES clientes(id),
  vigencia_dias INTEGER NOT NULL DEFAULT 15,
  modo_precio TEXT NOT NULL DEFAULT 'todos' CHECK (modo_precio IN ('todos','final','debito','efectivo')),
  estado TEXT NOT NULL DEFAULT 'vigente' CHECK (estado IN ('vigente','convertido','vencido','cerrado')),
  total REAL NOT NULL DEFAULT 0,
  venta_id INTEGER REFERENCES ventas(id),
  usuario_id INTEGER REFERENCES usuarios(id),
  creado_en TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS presupuesto_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  presupuesto_id INTEGER NOT NULL REFERENCES presupuestos(id),
  producto_id INTEGER REFERENCES productos(id),
  descripcion TEXT NOT NULL,
  cantidad REAL NOT NULL DEFAULT 1,
  precio_unitario REAL NOT NULL,
  tipo_precio TEXT NOT NULL DEFAULT 'final', -- final | debito | efectivo | manual
  descuento REAL NOT NULL DEFAULT 0,
  monto_mano_obra REAL,
  pila_producto_id INTEGER REFERENCES productos(id), -- solo familias con pregunta_pila=1: qué pila se usó
  -- Desglose F/D/E "congelado" tal como quedó calculado en el carrito al
  -- armar el presupuesto (incluye pila si correspondía, y si el precio se
  -- editó a mano, las otras 2 formas de pago recalculadas por el % de la
  -- familia) — evita depender de volver a mirar el precio de catálogo, que
  -- puede haber cambiado o no reflejar una edición manual.
  precio_final REAL,
  precio_debito REAL,
  precio_efectivo REAL
);

-- ============================================================
-- AGENDA Y NOTIFICACIONES (placeholder — alcance a definir más adelante)
-- ============================================================
CREATE TABLE IF NOT EXISTS agenda_trabajos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id INTEGER REFERENCES clientes(id),
  cerrajero_id INTEGER REFERENCES cerrajeros(id),
  descripcion TEXT NOT NULL,
  direccion TEXT,
  fecha_hora TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','asignado','realizado','cancelado')),
  creado_en TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS notificaciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL,
  titulo TEXT NOT NULL,
  mensaje TEXT NOT NULL,
  leida INTEGER NOT NULL DEFAULT 0,
  creado_en TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ============================================================
-- CONFIGURACIÓN — fila única (id=1) con los datos del negocio,
-- impresora y notas que se imprimen en todos los tickets.
-- ============================================================
CREATE TABLE IF NOT EXISTS configuracion (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  nombre_negocio TEXT NOT NULL DEFAULT 'CERRAJERÍA EL GALLO',
  subtitulo TEXT NOT NULL DEFAULT 'Corrientes Capital',
  logo_url TEXT,
  ticket_encabezado TEXT,
  ticket_pie TEXT,
  impresora_nombre TEXT,
  impresora_ancho_mm INTEGER NOT NULL DEFAULT 80,
  -- Datos fiscales/identidad del negocio, solo se usan en el documento A4
  -- (presupuesto/venta a página completa); todos opcionales.
  responsable_nombre TEXT,
  cuit_negocio TEXT,
  domicilio_negocio TEXT,
  condicion_fiscal_negocio TEXT,
  inicio_actividades TEXT,
  ingresos_brutos TEXT,
  -- Facturación electrónica (ARCA/AFIP): arca_facturacion_activa arranca en
  -- 0 a propósito — hasta que no se prenda a mano desde Configuración, una
  -- venta con Factura A/B nunca intenta emitir un comprobante real.
  arca_punto_venta TEXT,
  arca_facturacion_activa INTEGER NOT NULL DEFAULT 0,
  -- Cobro con QR de Mercado Pago: mp_activo arranca en 0 a propósito, igual
  -- que arca_facturacion_activa — hasta no prenderlo a mano desde
  -- Configuración con un Access Token cargado, el botón "Mercado Pago" del
  -- cobro por QR se comporta como antes (simulado, confirmación manual).
  mp_access_token TEXT,
  mp_activo INTEGER NOT NULL DEFAULT 0,
  -- QR fijo del mostrador (modelo híbrido de Mercado Pago): una sola sucursal
  -- y caja creadas una vez, con un único QR impreso que se reutiliza en cada
  -- venta empujándole el monto por API en vez de generar un QR nuevo cada vez.
  mp_user_id TEXT,
  mp_store_external_id TEXT,
  mp_pos_external_id TEXT,
  mp_qr_fijo_image_url TEXT,
  mp_qr_fijo_template_url TEXT,
  -- Bot de WhatsApp (API oficial de Meta + Claude): whatsapp_activo arranca
  -- en 0 a propósito, igual que arca_facturacion_activa/mp_activo — hasta no
  -- cargar las credenciales y prenderlo a mano desde Configuración, el
  -- webhook no contesta nada.
  whatsapp_token TEXT,
  whatsapp_phone_number_id TEXT,
  whatsapp_verify_token TEXT,
  whatsapp_activo INTEGER NOT NULL DEFAULT 0,
  whatsapp_instrucciones TEXT,
  anthropic_api_key TEXT,
  actualizado_en TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
INSERT OR IGNORE INTO configuracion (id) VALUES (1);

-- Historial de la conversación de WhatsApp por número de teléfono, para que
-- el bot tenga contexto de los últimos mensajes (no arranca de cero cada vez).
CREATE TABLE IF NOT EXISTS whatsapp_mensajes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telefono TEXT NOT NULL,
  rol TEXT NOT NULL CHECK (rol IN ('user','assistant')),
  texto TEXT NOT NULL,
  creado_en TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_mensajes_telefono ON whatsapp_mensajes(telefono, id);
