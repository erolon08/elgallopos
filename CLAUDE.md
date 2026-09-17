# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Qué es

El Gallo POS: sistema de punto de venta para una cerrajería (Cerrajería El Gallo, Argentina). Un solo proceso Node/Express sirve la API y el frontend estático; corre en una PC del local y las demás terminales entran por la LAN (o por Tailscale, ver `windows-cliente/`). Todo el código, los comentarios, los textos de la UI y los mensajes de commit están en castellano rioplatense (voseo) — mantenerlo así.

## Comandos

```bash
npm install
npm start                 # node src/server.js  → http://0.0.0.0:3000 y https://0.0.0.0:3443
npm run dev               # igual, con --watch
npm run seed              # datos demo (usuarios por rol, productos de prueba). Solo desarrollo.
npm run reset-ventas      # borra ventas/presupuestos/rendiciones; NO toca productos, clientes ni stock_actual
npm run limpiar-demo      # borra productos y clientes de prueba (previo a importar los Excel reales)
```

Variables de entorno útiles: `GALLO_DB_PATH` (ruta de la base; **usarla siempre para probar contra una base de scratch, nunca contra `data/gallopos.db`**), `PORT`, `HTTPS_PORT`, `GDRIVE_REMOTE`, `GDRIVE_BACKUP_FOLDER`.

Scripts ARCA (`npm run generar-csr-arca`, `test-arca-conexion`, `test-arca-emitir-factura`): el último **emite una factura fiscal real e irreversible** — no correrlo sin que el dueño lo pida explícitamente.

**No hay suite de tests ni linter.** La forma establecida de verificar un cambio es:
1. `node -c <archivo>` para sintaxis.
2. Un script Node suelto que setea `process.env.GALLO_DB_PATH` a una base temporal y llama a los services directamente (la lógica de negocio es toda síncrona con better-sqlite3, así que se prueba sin levantar el server).
3. Para UI: levantar `src/server.js` con `GALLO_DB_PATH` + `PORT` de scratch en background, sembrar un usuario (`INSERT INTO usuarios ... rol='ADMIN'` con `bcryptjs.hashSync`) y manejarlo con Playwright (`/opt/node22/lib/node_modules/playwright`, Chromium en `/opt/pw-browsers/chromium`). El login es por rol + clave: `.login-role[data-rol="ADMIN"]` → `#loginPassword` → botón "Ingresar". Las pantallas se abren con `button[data-screen="<id>"]`. Matar el server y borrar la base de scratch antes de commitear.

## Arquitectura

### Capas del backend
`src/routes/*.routes.js` → `src/services/*.service.js` → `src/db/index.js`.

- **Routes** son finas: parsean `req`, llaman al service, emiten el evento socket si corresponde y traducen excepciones a `res.status(400).json({ error: err.message })`. La lógica de negocio nunca va acá.
- **Services** contienen toda la lógica. better-sqlite3 es síncrono; toda operación con más de un write va envuelta en `db.transaction(...)`. Los services se llaman entre sí directamente (`ventas.service` usa `stock`, `caja`, `cc`).
- **La API no tiene autenticación.** `/api/*` está abierto en la LAN. El login (`POST /api/auth/login`) es por **rol** (ADMIN/CAJA/VENTA/STOCK, una fila en `usuarios` por rol, clave compartida) y devuelve un objeto de sesión que el frontend guarda en `localStorage`. Todo el control de permisos es del lado del cliente (`PANTALLAS_POR_ROL` y chequeos `session.rol === 'VENTA'` en `app.js`). No asumir que una ruta está protegida.

### Base de datos y migraciones (lo más importante de saber)
SQLite (`data/gallopos.db`, WAL, FK on). `src/db/schema.sql` es solo `CREATE TABLE IF NOT EXISTS` — **no modifica tablas que ya existen**, y la base de producción tiene años de datos. Por eso las migraciones viven en `src/db/index.js` y corren en cada arranque:

- Columna nueva → agregar una línea `ensureColumn('tabla', 'columna', 'DEFINICION')` **además** de ponerla en `schema.sql`.
- Cambiar un `CHECK (... IN (...))` (ej. sumar una forma de pago o un tipo) → SQLite no lo permite con `ALTER`. El patrón del archivo: leer `sqlite_master.sql`, si no contiene el valor nuevo → `foreign_keys = OFF`, crear `tabla_nuevo`, `INSERT ... SELECT`, `DROP` la vieja, `RENAME`, recrear índices, `foreign_keys = ON`. Nunca renombrar la tabla original primero (reescribe las FK que apuntan a ella).
- Índices sobre columnas migradas van en `index.js` después del `ensureColumn`, no en `schema.sql` (ahí correrían antes de que exista la columna).

### Patrón "libro mayor" (ledger)
`productos.stock_actual` y `clientes.saldo_cta_cte` **nunca se escriben directo**. Siempre pasan por `stockService.registrarMovimiento(...)` / `ccService.registrarMovimiento(...)`: una transacción que aplica el delta y deja la fila de auditoría (`stock_movimientos` / `cc_movimientos`) con `referencia_tipo`/`referencia_id` apuntando al origen. Deshacer algo (anular una venta, `desanular`) **agrega movimientos inversos, no borra los anteriores**.

### Caja y turnos (`caja.service.js`)
- Invariante: **hay a lo sumo un turno `abierto`**, compartido por todas las terminales. `turnoAbiertoOCrear()` lo devuelve o lo crea con el fondo sugerido; cualquier cobro, rendición o gasto se cuelga de él.
- Cerrar un turno crea automáticamente el siguiente `abierto` heredando `fondo_turno_siguiente`. `aplicarCierre()` es la única función que calcula esperado/diferencia/envío a caja fuerte y la comparten cerrar, "Modificar cierre" y "Recuperar cierre".
- `caja_movimientos` con `referencia_tipo` no nulo son generados por el sistema (venta, rendición, cierre) y no se editan desde la UI; los manuales (gasto, retiro, etc.) sí. `categorias_movimiento` es una lista extensible por el usuario.
- `reabrirTurno` solo funciona mientras el turno sucesor no tiene movimientos: es el "deshacer" del cierre.

### Precios (`pricing.service.js`)
Todo precio que ve el cliente se **redondea hacia arriba a múltiplos de $100** (`roundUpTo100`). `calcularPrecios(precio_final, familia)` deriva débito/efectivo con los descuentos de la familia; los servicios (`familias.usa_mano_obra`) no tienen precio de catálogo: se calculan en la venta desde la mano de obra × recargos en cadena. Familias con `usa_precio_rendicion` (duplicados) copian el precio sin redondear. Cualquier cálculo nuevo de precio debe pasar por estas funciones.

### Frontend: un solo archivo por capa, sin build
`public/index.html` (todas las pantallas como `<section class="screen" id="...">` y todos los modales inline), `public/js/app.js` (~7k líneas de JS plano, sin framework ni bundler) y `public/css/styles.css`. Servido con `Cache-Control: no-cache` a propósito (la ventana "app" de Chrome se quedaba con versiones viejas).

- Navegación: `showScreen(id)` — activa la sección, actualiza el título desde `titles` y despacha el loader de esa pantalla en su `if`. Pantalla nueva = sección en HTML + entrada en `titles` + `if` en `showScreen` + agregarla a `PANTALLAS_POR_ROL` de los roles que la ven.
- Modales: `document.getElementById('xModal').classList.add('open')` / `.remove('open')`.
- Estado global en variables `let` de módulo (`session`, `carritoVenta`, `clienteVentaActual`, `cajaTurnoActual`, ...). Al agregar un flujo paralelo a uno existente (ej. editar movimientos dentro de un modal), usar variables y funciones **nuevas** con otro prefijo en vez de reutilizar las del flujo vivo.
- Helpers: `money` (Intl es-AR, sin símbolo), `moneyStr` (con `$`), `escapeHtml`. Al armar HTML con datos de usuario, escapar.
- Tiempo real: `socket.io`. El server emite (`emitVentaEvent('venta:*')`, `caja:actualizada`, `stock:updated`, `mensaje:*`, `sistema:reseteado`); los handlers del cliente simplemente vuelven a correr el loader de la pantalla activa. Una ruta que cambie ventas/caja/stock debe emitir el evento correspondiente.

### Integraciones y datos sensibles
- `configuracion` es una tabla de **una sola fila (`id = 1`)** con toda la configuración del negocio, incluidos tokens (ARCA, Mercado Pago, WhatsApp, Anthropic). Se lee con `configuracionService.obtener()`.
- Carpetas ignoradas por git: `data/` (base, `backups/`, `certs/`, `gdrive-carpeta-id.txt`), `arca/` (certificado y clave privada de facturación), `node_modules/`.
- ARCA (`arca-wsaa` → token 12 h cacheado; `arca-wsfe`/`arca-facturacion` → CAE real; `arca-padron` → consulta de CUIT). Si falla al cobrar, la venta queda como "Eventual" y sigue.
- Mercado Pago es por **polling** desde el server (la PC no tiene URL pública). El bot de WhatsApp usa la API de Meta + Anthropic SDK.
- HTTPS 3443 con certificado autofirmado generado en `data/certs/` — existe solo para habilitar el portapapeles de imágenes en la LAN.
- Backup: diario local (`data/backups/`) + semanal a Google Drive vía `rclone` externo. En Windows Node no completa `.exe` al spawnear: usar `rclone.exe` (ya resuelto en `RCLONE_BIN`).

### Cómo llega el código a producción
No hay CI ni deploy. El dueño (no técnico) descarga el ZIP de GitHub y **pisa la carpeta del sistema**; `data/` y `arca/` sobreviven porque no están en el ZIP. La rama por defecto del repo es la rama `claude/...` de trabajo. Cualquier cambio que requiera un paso manual extra (instalar algo, crear un archivo en `data/`) hay que explicárselo paso a paso en castellano y con rutas de Windows.
