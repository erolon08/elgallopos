const path = require('node:path');
const http = require('node:http');
const express = require('express');

require('./db'); // asegura que el schema esté creado antes de levantar rutas

const sockets = require('./sockets');
const stockRoutes = require('./routes/stock.routes');
const familiasRoutes = require('./routes/familias.routes');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api/stock', stockRoutes);
app.use('/api/familias', familiasRoutes);

const server = http.createServer(app);
sockets.init(server);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`EL GALLO POS escuchando en http://0.0.0.0:${PORT}`);
});
