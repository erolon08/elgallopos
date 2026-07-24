const path = require('node:path');
const http = require('node:http');
const express = require('express');

require('./db'); // asegura que el schema esté creado antes de levantar rutas

const sockets = require('./sockets');
const stockRoutes = require('./routes/stock.routes');
const familiasRoutes = require('./routes/familias.routes');
const proveedoresRoutes = require('./routes/proveedores.routes');
const productosRoutes = require('./routes/productos.routes');
const clientesRoutes = require('./routes/clientes.routes');
const authRoutes = require('./routes/auth.routes');
const ventasRoutes = require('./routes/ventas.routes');
const cerrajerosRoutes = require('./routes/cerrajeros.routes');
const presupuestosRoutes = require('./routes/presupuestos.routes');
const rendicionesRoutes = require('./routes/rendiciones.routes');
const cajaRoutes = require('./routes/caja.routes');
const reportesRoutes = require('./routes/reportes.routes');
const configuracionRoutes = require('./routes/configuracion.routes');
const usuariosRoutes = require('./routes/usuarios.routes');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api/stock', stockRoutes);
app.use('/api/familias', familiasRoutes);
app.use('/api/proveedores', proveedoresRoutes);
app.use('/api/productos', productosRoutes);
app.use('/api/clientes', clientesRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/ventas', ventasRoutes);
app.use('/api/cerrajeros', cerrajerosRoutes);
app.use('/api/presupuestos', presupuestosRoutes);
app.use('/api/rendiciones', rendicionesRoutes);
app.use('/api/caja', cajaRoutes);
app.use('/api/reportes', reportesRoutes);
app.use('/api/configuracion', configuracionRoutes);
app.use('/api/usuarios', usuariosRoutes);

const server = http.createServer(app);
sockets.init(server);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`EL GALLO POS escuchando en http://0.0.0.0:${PORT}`);
});
