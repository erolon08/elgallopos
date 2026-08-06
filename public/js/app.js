const titles = {
  dashboard: 'Dashboard', productos: 'Productos', familias: 'Familias', stock: 'Stock', clientes: 'Clientes',
  venta: 'Venta', pendientes: 'Pendientes', ventas: 'Ventas', presupuestos: 'Presupuestos', 'ticket-screen': 'Ticket',
  rendicion: 'Rendición cerrajeros',
  caja: 'Caja y turnos', ranking: 'Ranking', resumen: 'Resumen', configuracion: 'Configuración',
};

// ============================================================
// TEMA DE COLORES
// ============================================================
function aplicarTema(tema) {
  document.documentElement.setAttribute('data-theme', tema);
  document.querySelectorAll('.theme-swatch').forEach((b) => b.classList.toggle('active', b.dataset.theme === tema));
  localStorage.setItem('gallo_theme', tema);
}
document.querySelectorAll('.theme-swatch').forEach((b) => b.addEventListener('click', () => aplicarTema(b.dataset.theme)));
aplicarTema(localStorage.getItem('gallo_theme') || 'rojo');

document.querySelectorAll('.nav button[data-screen]').forEach((b) =>
  b.addEventListener('click', () => showScreen(b.dataset.screen))
);

let ultimaPantallaAntesDelTicket = 'venta';

function showScreen(id) {
  const actualActiva = document.querySelector('.screen.active');
  if (actualActiva && actualActiva.id !== 'ticket-screen' && id === 'ticket-screen') {
    ultimaPantallaAntesDelTicket = actualActiva.id;
  }
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  document.querySelectorAll('.nav button[data-screen]').forEach((b) =>
    b.classList.toggle('active', b.dataset.screen === id)
  );
  document.getElementById('screenTitle').textContent = titles[id] || id;
  document.querySelector('.main').classList.toggle('venta-compacta', id === 'venta');
  if (id === 'dashboard') cargarDashboard();
  if (id === 'ranking') cargarRanking();
  if (id === 'configuracion') { cargarCerrajerosAdmin(); cargarConfiguracion(); cargarUsuariosClaves(); }
  if (id === 'productos') cargarProductos();
  if (id === 'familias') cargarFamiliasTabla();
  if (id === 'clientes') cargarClientes();
  if (id === 'pendientes') cargarPendientes();
  if (id === 'ventas') cargarVentasHistorial();
  if (id === 'presupuestos') cargarPresupuestos();
  if (id === 'rendicion') { cargarCerrajerosAdmin(); cargarRendiciones(); }
  if (id === 'caja') cargarCaja();
  if (id === 'resumen') inicializarResumen();
  if (id === 'venta') { actualizarHintVenta(); cargarBotoneraVenta(); ajustarAltoVenta(); }
}

function ajustarAltoVenta() {
  const shell = document.getElementById('ventaShell');
  if (!shell) return;
  const top = shell.getBoundingClientRect().top;
  shell.style.height = Math.max(300, window.innerHeight - top - 20) + 'px';
}
window.addEventListener('resize', () => {
  if (document.getElementById('venta').classList.contains('active')) ajustarAltoVenta();
});

const money = new Intl.NumberFormat('es-AR');
// ARCA devuelve las fechas del CAE como "AAAAMMDD" (ej. "20260811"); esto
// las pasa a "11/08/2026" para mostrarlas en el ticket.
function formatFechaAfip(aaaammdd) {
  const s = String(aaaammdd || '');
  if (s.length !== 8) return s;
  return `${s.slice(6, 8)}/${s.slice(4, 6)}/${s.slice(0, 4)}`;
}
function roundUpTo100(v) {
  return Math.ceil(v / 100) * 100;
}

const ESTADO_LABEL = {
  correcto: { text: 'Correcto', cls: 's-ok' },
  reponer: { text: 'Reponer', cls: 's-bad' },
  sin_stock: { text: 'Sin stock', cls: 's-bad' },
};

let ajusteProductoId = null;
let familiasCache = [];
let proveedoresCache = [];

function populateSelect(select, items, { placeholder } = {}) {
  const previous = select.value;
  select.innerHTML = '';
  if (placeholder) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = placeholder;
    select.appendChild(opt);
  }
  items.forEach((it) => {
    const opt = document.createElement('option');
    opt.value = it.id;
    opt.textContent = it.nombre;
    select.appendChild(opt);
  });
  if ([...select.options].some((o) => o.value === previous)) select.value = previous;
}

async function cargarFamiliasGlobal() {
  const res = await fetch('/api/familias?soloActivas=true');
  familiasCache = await res.json();
  populateSelect(document.getElementById('stockFamilia'), familiasCache, { placeholder: 'Todas' });
  populateSelect(document.getElementById('prodFamilia'), familiasCache, { placeholder: 'Todas' });
  populateSelect(document.getElementById('prodFamiliaSel'), familiasCache);
  populateSelect(document.getElementById('rkFamiliaId'), familiasCache, { placeholder: 'Elegir familia' });
  populateSelect(document.getElementById('masPrecFamilia'), familiasCache, { placeholder: 'Todas' });
}

async function cargarProveedoresGlobal() {
  const res = await fetch('/api/proveedores');
  proveedoresCache = await res.json();
  populateSelect(document.getElementById('prodProveedor'), proveedoresCache, { placeholder: 'Todos' });
  populateSelect(document.getElementById('masPrecProveedor'), proveedoresCache, { placeholder: 'Todos' });

  const modalSel = document.getElementById('prodProveedorSel');
  const previous = modalSel.value;
  modalSel.innerHTML = '<option value="">Sin proveedor</option>';
  proveedoresCache.forEach((p) => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.nombre;
    modalSel.appendChild(opt);
  });
  const nuevoOpt = document.createElement('option');
  nuevoOpt.value = '__nuevo__';
  nuevoOpt.textContent = '+ Nuevo proveedor...';
  modalSel.appendChild(nuevoOpt);
  if ([...modalSel.options].some((o) => o.value === previous)) modalSel.value = previous;
}

// ============================================================
// STOCK
// ============================================================
async function cargarStock() {
  const q = document.getElementById('stockSearch').value.trim();
  const familia_id = document.getElementById('stockFamilia').value;
  const soloBajoMinimo = document.getElementById('stockSoloBajoMinimo').checked;

  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (familia_id) params.set('familia_id', familia_id);
  if (soloBajoMinimo) params.set('soloBajoMinimo', 'true');

  const res = await fetch('/api/stock?' + params.toString());
  const rows = await res.json();
  renderStock(rows);
}

function renderStock(rows) {
  const tbody = document.getElementById('stockBody');
  tbody.innerHTML = '';
  rows.forEach((r) => tbody.appendChild(filaStock(r)));
}

function filaStock(r) {
  const tr = document.createElement('tr');
  tr.dataset.productoId = r.id;
  const estado = ESTADO_LABEL[r.estado] || ESTADO_LABEL.correcto;
  tr.innerHTML = `
    <td>${r.codigo}</td>
    <td>${r.descripcion}</td>
    <td>${r.familia}</td>
    <td class="celda-actual">${money.format(r.stock_actual)}</td>
    <td>${money.format(r.stock_minimo)}</td>
    <td class="celda-estado"><span class="status ${estado.cls}">${estado.text}</span></td>
    <td>
      <button class="btn light" onclick="openAjuste(${r.id}, '${r.descripcion.replace(/'/g, "\\'")}')">Ajustar</button>
      <button class="btn outline" onclick="abrirHistorialStock(${r.id}, '${r.descripcion.replace(/'/g, "\\'")}')">Historial</button>
    </td>
  `;
  return tr;
}

function openAjuste(producto_id, descripcion) {
  ajusteProductoId = producto_id;
  document.getElementById('ajusteTitulo').textContent = 'Ajuste de stock — ' + descripcion;
  document.getElementById('ajusteCantidad').value = '';
  document.getElementById('ajusteMotivo').value = '';
  document.getElementById('ajusteModal').classList.add('open');
}

function closeAjuste() {
  document.getElementById('ajusteModal').classList.remove('open');
  ajusteProductoId = null;
}

let historialStockProductoId = null;
const TIPO_MOVIMIENTO_STOCK_LABEL = { venta: 'Venta', compra: 'Compra', ajuste: 'Ajuste', nota_credito: 'Nota de crédito' };

function abrirHistorialStock(producto_id, descripcion) {
  historialStockProductoId = producto_id;
  document.getElementById('historialStockTitulo').textContent = 'Historial de stock: ' + descripcion;
  document.getElementById('historialStockDesde').value = '';
  document.getElementById('historialStockHasta').value = '';
  document.getElementById('historialStockModal').classList.add('open');
  cargarHistorialStock();
}

function closeHistorialStock() {
  document.getElementById('historialStockModal').classList.remove('open');
  historialStockProductoId = null;
}

async function cargarHistorialStock() {
  const desde = document.getElementById('historialStockDesde').value;
  const hasta = document.getElementById('historialStockHasta').value;
  const params = new URLSearchParams();
  if (desde) params.set('desde', desde);
  if (hasta) params.set('hasta', hasta);
  const rows = await (await fetch(`/api/stock/${historialStockProductoId}/movimientos?` + params.toString())).json();

  document.getElementById('historialStockActual').textContent = rows.length
    ? `Stock actual: ${money.format(rows[0].stock_resultante)}`
    : 'Sin movimientos en el rango seleccionado.';

  document.getElementById('historialStockBody').innerHTML = rows
    .map((m) => {
      let descripcion = TIPO_MOVIMIENTO_STOCK_LABEL[m.tipo] || m.tipo;
      if (m.tipo === 'venta' && m.venta_numero) descripcion += `: ${m.venta_numero}`;
      else if (m.tipo === 'compra' && m.compra_numero) descripcion += `: ${m.compra_numero}`;
      if (m.motivo) descripcion += ` (${m.motivo})`;
      const fecha = new Date(m.creado_en).toLocaleString('es-AR');
      const cantidadClase = m.cantidad < 0 ? 'text-red' : 'text-green';
      return `
        <tr>
          <td>${fecha}</td>
          <td>${descripcion}</td>
          <td class="${cantidadClase}">${m.cantidad > 0 ? '+' : ''}${money.format(m.cantidad)}</td>
          <td>${money.format(m.stock_resultante)}</td>
          <td>${m.usuario_nombre || m.terminal || '—'}</td>
        </tr>`;
    })
    .join('');
}

['historialStockDesde', 'historialStockHasta'].forEach((id) =>
  document.getElementById(id).addEventListener('change', cargarHistorialStock)
);

async function confirmarAjuste() {
  const cantidad = Number(document.getElementById('ajusteCantidad').value);
  const motivo = document.getElementById('ajusteMotivo').value.trim();
  if (!cantidad) {
    alert('Ingresá una cantidad distinta de 0.');
    return;
  }
  const res = await fetch(`/api/stock/${ajusteProductoId}/ajuste`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cantidad, motivo, terminal: session.rol, usuario_id: session.id }),
  });
  if (!res.ok) {
    const err = await res.json();
    alert('Error: ' + err.error);
    return;
  }
  closeAjuste();
  cargarStock();
}

function actualizarFilaEnVivo(producto) {
  const tr = document.querySelector(`#stockBody tr[data-producto-id="${producto.id}"]`);
  if (!tr) return; // no está en la vista/filtro actual
  const estado = ESTADO_LABEL[producto.estado] || ESTADO_LABEL.correcto;
  tr.querySelector('.celda-actual').textContent = money.format(producto.stock_actual);
  tr.querySelector('.celda-estado').innerHTML = `<span class="status ${estado.cls}">${estado.text}</span>`;
}

document.getElementById('btnBuscarStock').addEventListener('click', cargarStock);
document.getElementById('stockSearch').addEventListener('input', cargarStock);
document.getElementById('stockFamilia').addEventListener('change', cargarStock);
document.getElementById('stockSoloBajoMinimo').addEventListener('change', cargarStock);

// ============================================================
// PRODUCTOS
// ============================================================
let productoEditId = null;

async function cargarProductos() {
  const q = document.getElementById('prodSearch').value.trim();
  const familia_id = document.getElementById('prodFamilia').value;
  const proveedor_id = document.getElementById('prodProveedor').value;
  const stock = document.getElementById('prodStock').value;
  const incompletos = document.getElementById('prodIncompletos').checked;

  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (familia_id) params.set('familia_id', familia_id);
  if (proveedor_id) params.set('proveedor_id', proveedor_id);
  if (stock) params.set('stock', stock);
  if (incompletos) params.set('incompletos', 'true');

  const res = await fetch('/api/productos?' + params.toString());
  const rows = await res.json();
  const tbody = document.getElementById('prodBody');
  tbody.innerHTML = '';
  rows.forEach((p) => tbody.appendChild(filaProducto(p)));
}

async function importarExcel(event) {
  const input = event.target;
  const archivo = input.files[0];
  if (!archivo) return;

  if (!confirm(`¿Importar "${archivo.name}"? Los productos con código existente se actualizan, el resto se crea nuevo.`)) {
    input.value = '';
    return;
  }

  const formData = new FormData();
  formData.append('archivo', archivo);

  const boton = document.querySelector('button[onclick*="prodImportarInput"]');
  const textoOriginal = boton.textContent;
  boton.textContent = 'Importando...';
  boton.disabled = true;

  try {
    const res = await fetch('/api/productos/importar', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) {
      alert('Error al importar: ' + data.error);
      return;
    }
    let msg = `Importación completa.\nCreados: ${data.creados}\nActualizados: ${data.actualizados}`;
    if (data.familiasNuevas.length) msg += `\nFamilias nuevas: ${data.familiasNuevas.join(', ')}`;
    if (data.totalErrores) msg += `\nFilas con error: ${data.totalErrores} (revisá códigos/descripciones vacíos)`;
    alert(msg);
    await cargarFamiliasGlobal();
    await cargarProveedoresGlobal();
    cargarProductos();
  } catch (err) {
    alert('Error al importar: ' + err.message);
  } finally {
    boton.textContent = textoOriginal;
    boton.disabled = false;
    input.value = '';
  }
}

function filaProducto(p) {
  const tr = document.createElement('tr');
  const incompletoMsg = p.usa_mano_obra ? 'Falta configurar los recargos de mano de obra' : 'Falta proveedor, costo o precio final';
  const incompletoTag = p.incompleto ? ` <span class="status s-warn" title="${incompletoMsg}">Incompleto</span>` : '';

  const columnasPrecio = p.usa_mano_obra
    ? `<td colspan="3">Fórmula: mano de obra ${formatearRecargos(p.recargos_mano_obra)}</td><td>—</td>`
    : p.usa_precio_rendicion
    ? `<td colspan="3">Precio único: $ ${money.format(p.precio_final)}</td><td>$ ${money.format(p.costo)}</td>`
    : `
    <td>$ ${money.format(p.precio_final)}</td>
    <td>$ ${money.format(p.precio_debito)}</td>
    <td>$ ${money.format(p.precio_efectivo)}</td>
    <td>$ ${money.format(p.costo)}</td>`;

  tr.innerHTML = `
    <td>${p.codigo}</td>
    <td>${p.descripcion}${incompletoTag}</td>
    <td>${p.familia}</td>
    <td>${p.proveedor || '—'}</td>
    ${columnasPrecio}
    <td>${money.format(p.stock_minimo)}</td>
    <td>${p.iva}%</td>
    <td>
      <button class="btn light" title="${p.favorito ? 'Quitar de la botonera' : 'Agregar a la botonera de Venta'}" onclick="toggleFavoritoProducto(${p.id})">${p.favorito ? '⭐' : '☆'}</button>
      <button class="btn light" onclick="openProducto(${p.id})">Editar</button>
    </td>
  `;
  return tr;
}

async function toggleFavoritoProducto(id) {
  await fetch(`/api/productos/${id}/favorito`, { method: 'POST' });
  cargarProductos();
}

function formatearRecargos(recargosStr) {
  const recargos = (recargosStr || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return recargos.length ? recargos.map((r) => `+${r}%`).join(' ') : '(sin configurar)';
}

function updateRendicionFieldVisibility() {
  const familia = familiasCache.find((f) => String(f.id) === String(document.getElementById('prodFamiliaSel').value));
  document.getElementById('prodRendicionField').style.display = familia && familia.usa_precio_rendicion ? 'block' : 'none';
}

function esFamiliaServicio() {
  const familia = familiasCache.find((f) => String(f.id) === String(document.getElementById('prodFamiliaSel').value));
  return !!(familia && familia.usa_mano_obra);
}

function esFamiliaPrecioUnico() {
  const familia = familiasCache.find((f) => String(f.id) === String(document.getElementById('prodFamiliaSel').value));
  return !!(familia && familia.usa_precio_rendicion);
}

function toggleCamposPorFamilia() {
  const esServicio = esFamiliaServicio();
  const precioUnico = esFamiliaPrecioUnico();
  document.getElementById('prodCamposNormales').style.display = esServicio ? 'none' : 'block';
  document.getElementById('prodCamposServicio').style.display = esServicio ? 'block' : 'none';
  document.getElementById('prodCostoField').style.display = esServicio ? 'none' : 'flex';
  // Familias de precio único (ej. DUPLICADOS): un solo precio, sin la regla
  // de descuento débito/efectivo ni el checkbox que la activa/desactiva.
  document.getElementById('prodReglaAutomaticaRow').style.display = precioUnico ? 'none' : 'block';
  document.getElementById('prodPrecioDebitoField').style.display = precioUnico ? 'none' : 'block';
  document.getElementById('prodPrecioEfectivoField').style.display = precioUnico ? 'none' : 'block';
  document.getElementById('prodPrecioFinalLabel').textContent = precioUnico ? 'Precio' : 'Precio final';
  if (esServicio) recalcularPreviewServicio();
}

function recalcularPreviewServicio() {
  const recargos = document
    .getElementById('prodRecargos')
    .value.split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n !== 0);
  const manoObra = Number(document.getElementById('prodManoObraPrueba').value) || 0;
  const factor = recargos.reduce((acc, pct) => acc * (1 + pct / 100), 1);
  document.getElementById('prodPrecioFinalPrueba').value = manoObra ? '$ ' + money.format(roundUpTo100(manoObra * factor)) : '';
}

function toggleReglaAutomatica() {
  const usaRegla = document.getElementById('prodUsaRegla').checked;
  document.getElementById('prodPrecioDebito').readOnly = usaRegla;
  document.getElementById('prodPrecioEfectivo').readOnly = usaRegla;
  if (usaRegla) recalcularPreview();
}

function recalcularPreview() {
  if (!document.getElementById('prodUsaRegla').checked) return;
  const familia = familiasCache.find((f) => String(f.id) === String(document.getElementById('prodFamiliaSel').value));
  if (!familia) return;
  const precioFinal = Number(document.getElementById('prodPrecioFinal').value) || 0;
  document.getElementById('prodPrecioDebito').value = roundUpTo100(precioFinal * (1 - familia.descuento_debito / 100));
  document.getElementById('prodPrecioEfectivo').value = roundUpTo100(precioFinal * (1 - familia.descuento_efectivo / 100));
}

document.getElementById('prodFamiliaSel').addEventListener('change', () => {
  updateRendicionFieldVisibility();
  toggleCamposPorFamilia();
  recalcularPreview();
});

document.getElementById('prodProveedorSel').addEventListener('change', async (e) => {
  if (e.target.value !== '__nuevo__') return;
  const nombre = prompt('Nombre del nuevo proveedor:');
  if (!nombre || !nombre.trim()) {
    e.target.value = '';
    return;
  }
  const res = await fetch('/api/proveedores', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: nombre.trim() }),
  });
  const data = await res.json();
  if (!res.ok) {
    alert('Error: ' + data.error);
    e.target.value = '';
    return;
  }
  await cargarProveedoresGlobal();
  document.getElementById('prodProveedorSel').value = data.id;
});

async function openProducto(id) {
  productoEditId = id || null;
  document.getElementById('productoTitulo').textContent = id ? 'Editar producto' : 'Nuevo producto';
  document.getElementById('btnEliminarProd').style.display = id ? 'inline-block' : 'none';

  if (id) {
    const res = await fetch(`/api/productos/${id}`);
    const p = await res.json();
    document.getElementById('prodCodigo').value = p.codigo;
    document.getElementById('prodDescripcion').value = p.descripcion;
    document.getElementById('prodFamiliaSel').value = p.familia_id;
    document.getElementById('prodProveedorSel').value = p.proveedor_id || '';
    document.getElementById('prodCosto').value = p.costo;
    document.getElementById('prodStockMinimo').value = p.stock_minimo;
    document.getElementById('prodIva').value = p.iva;
    document.getElementById('prodPrecioRendicion').value = p.precio_rendicion ?? '';
    document.getElementById('prodPrecioFinal').value = p.precio_final;
    document.getElementById('prodUsaRegla').checked = !!p.usar_regla_automatica;
    document.getElementById('prodRecargos').value = p.recargos_mano_obra || '';
    document.getElementById('prodManoObraPrueba').value = '';
    document.getElementById('prodPrecioFinalPrueba').value = '';
    document.getElementById('prodFavorito').checked = !!p.favorito;
    document.getElementById('prodEsPila').checked = !!p.es_pila;
    updateRendicionFieldVisibility();
    toggleCamposPorFamilia();
    toggleReglaAutomatica();
    if (!p.usar_regla_automatica) {
      document.getElementById('prodPrecioDebito').value = p.precio_debito;
      document.getElementById('prodPrecioEfectivo').value = p.precio_efectivo;
    }
  } else {
    document.getElementById('prodCodigo').value = '';
    document.getElementById('prodDescripcion').value = '';
    document.getElementById('prodFamiliaSel').selectedIndex = 0;
    document.getElementById('prodProveedorSel').value = '';
    document.getElementById('prodCosto').value = '';
    document.getElementById('prodStockMinimo').value = '';
    document.getElementById('prodIva').value = 21;
    document.getElementById('prodPrecioRendicion').value = '';
    document.getElementById('prodPrecioFinal').value = '';
    document.getElementById('prodUsaRegla').checked = true;
    document.getElementById('prodRecargos').value = '';
    document.getElementById('prodManoObraPrueba').value = '';
    document.getElementById('prodPrecioFinalPrueba').value = '';
    document.getElementById('prodFavorito').checked = false;
    document.getElementById('prodEsPila').checked = false;
    updateRendicionFieldVisibility();
    toggleCamposPorFamilia();
    toggleReglaAutomatica();
  }
  document.getElementById('productoModal').classList.add('open');
}

function closeProducto() {
  document.getElementById('productoModal').classList.remove('open');
  productoEditId = null;
}

async function guardarProducto() {
  const esServicio = esFamiliaServicio();
  const payload = {
    codigo: document.getElementById('prodCodigo').value.trim(),
    descripcion: document.getElementById('prodDescripcion').value.trim(),
    familia_id: Number(document.getElementById('prodFamiliaSel').value),
    proveedor_id: document.getElementById('prodProveedorSel').value || null,
    stock_minimo: Number(document.getElementById('prodStockMinimo').value) || 0,
    iva: Number(document.getElementById('prodIva').value) || 0,
    precio_rendicion: document.getElementById('prodPrecioRendicion').value || null,
    favorito: document.getElementById('prodFavorito').checked,
    es_pila: document.getElementById('prodEsPila').checked,
  };
  if (esServicio) {
    payload.recargos_mano_obra = document.getElementById('prodRecargos').value.trim() || null;
  } else {
    payload.costo = Number(document.getElementById('prodCosto').value) || 0;
    payload.precio_final = Number(document.getElementById('prodPrecioFinal').value) || 0;
    payload.usar_regla_automatica = document.getElementById('prodUsaRegla').checked;
    payload.precio_debito = Number(document.getElementById('prodPrecioDebito').value) || 0;
    payload.precio_efectivo = Number(document.getElementById('prodPrecioEfectivo').value) || 0;
  }
  if (!payload.codigo || !payload.descripcion || !payload.familia_id) {
    alert('Código, descripción y familia son obligatorios.');
    return;
  }
  if (esServicio && !payload.recargos_mano_obra) {
    if (!confirm('No configuraste los recargos de mano de obra para este servicio. ¿Guardar de todas formas?')) return;
  }
  const url = productoEditId ? `/api/productos/${productoEditId}` : '/api/productos';
  const method = productoEditId ? 'PUT' : 'POST';
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await res.json();
  if (!res.ok) {
    alert('Error: ' + data.error);
    return;
  }
  closeProducto();
  cargarProductos();
}

async function eliminarProducto() {
  if (!productoEditId) return;
  if (!confirm('¿Desactivar este producto? Ya no aparecerá en las listas de venta ni stock.')) return;
  await fetch(`/api/productos/${productoEditId}`, { method: 'DELETE' });
  closeProducto();
  cargarProductos();
}

document.getElementById('btnBuscarProd').addEventListener('click', cargarProductos);
document.getElementById('prodSearch').addEventListener('input', cargarProductos);
['prodFamilia', 'prodProveedor', 'prodStock', 'prodIncompletos'].forEach((id) =>
  document.getElementById(id).addEventListener('change', cargarProductos)
);

// Actualización masiva de precios por proveedor y/o familia (ej: "subió
// Bronzen 15%"): primero arma una vista previa (sin tocar la base) para que
// el usuario vea exactamente qué códigos y montos van a cambiar antes de
// aplicar de verdad.
function abrirActualizarPrecios() {
  document.getElementById('masPrecProveedor').value = '';
  document.getElementById('masPrecFamilia').value = '';
  document.getElementById('masPrecAumentoCosto').value = '';
  document.getElementById('masPrecMargen').value = '';
  document.getElementById('masPrecPreviewWrap').style.display = 'none';
  document.getElementById('actualizarPreciosModal').classList.add('open');
}
function closeActualizarPrecios() {
  document.getElementById('actualizarPreciosModal').classList.remove('open');
}
async function previsualizarActualizarPrecios() {
  const proveedor_id = document.getElementById('masPrecProveedor').value;
  const familia_id = document.getElementById('masPrecFamilia').value;
  const aumento_costo = document.getElementById('masPrecAumentoCosto').value;
  const margen = document.getElementById('masPrecMargen').value;
  if (!proveedor_id && !familia_id) return alert('Elegí un proveedor y/o una familia.');
  if (aumento_costo === '' || !Number.isFinite(Number(aumento_costo))) return alert('Ingresá el % de aumento del costo (puede ser 0).');
  if (margen === '' || !Number.isFinite(Number(margen))) return alert('Ingresá el margen sobre el costo.');

  const params = new URLSearchParams({ aumento_costo, margen });
  if (proveedor_id) params.set('proveedor_id', proveedor_id);
  if (familia_id) params.set('familia_id', familia_id);
  const res = await fetch('/api/productos/actualizar-precios/preview?' + params.toString());
  const filas = await res.json();
  if (!res.ok) return alert('Error: ' + filas.error);

  const tbody = document.getElementById('masPrecPreviewBody');
  tbody.innerHTML = filas.length
    ? filas
        .map(
          (f) => `<tr><td>${f.codigo}</td><td>${f.descripcion}</td><td>$ ${money.format(f.costo_actual)}</td><td>$ ${money.format(f.costo_nuevo)}</td><td>$ ${money.format(f.precio_final_actual)}</td><td><b>$ ${money.format(f.precio_final_nuevo)}</b></td></tr>`
        )
        .join('')
    : '<tr><td colspan="6">No hay productos que matcheen ese filtro.</td></tr>';
  document.getElementById('masPrecPreviewTotal').textContent = `${filas.length} producto(s) van a actualizarse.`;
  document.getElementById('masPrecPreviewWrap').style.display = 'block';
}
async function confirmarActualizarPrecios() {
  const proveedor_id = document.getElementById('masPrecProveedor').value;
  const familia_id = document.getElementById('masPrecFamilia').value;
  const aumento_costo = document.getElementById('masPrecAumentoCosto').value;
  const margen = document.getElementById('masPrecMargen').value;
  if (!confirm('¿Confirmás aplicar este cambio de precios? No se puede deshacer con un clic.')) return;

  const res = await fetch('/api/productos/actualizar-precios', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      proveedor_id: proveedor_id || null,
      familia_id: familia_id || null,
      aumento_costo,
      margen,
    }),
  });
  const data = await res.json();
  if (!res.ok) return alert('Error: ' + data.error);
  alert(`Listo, se actualizaron ${data.actualizados} producto(s).`);
  closeActualizarPrecios();
  cargarProductos();
}

// ============================================================
// FAMILIAS
// ============================================================
let familiaEditId = null;

async function cargarFamiliasTabla() {
  const res = await fetch('/api/familias');
  const familias = await res.json();
  const tbody = document.getElementById('familiasBody');
  tbody.innerHTML = '';
  familias.forEach((f) => tbody.appendChild(filaFamilia(f)));
}

function filaFamilia(f) {
  const tr = document.createElement('tr');
  const estado = f.activo
    ? '<span class="status s-ok">Activa</span>'
    : '<span class="status s-bad">Inactiva</span>';
  tr.innerHTML = `
    <td>${f.nombre}</td>
    <td>${f.descuento_debito}%</td>
    <td>${f.descuento_efectivo}%</td>
    <td>${f.usa_precio_rendicion ? 'Sí' : '—'}</td>
    <td>${f.usa_mano_obra ? 'Sí' : '—'}</td>
    <td>${estado}</td>
    <td>
      <button class="btn light" onclick="openFamilia(${f.id})">Editar</button>
      <button class="btn light" onclick="toggleFamiliaActiva(${f.id}, ${f.activo})">${f.activo ? 'Desactivar' : 'Activar'}</button>
      <button class="btn light" onclick="eliminarFamilia(${f.id})">Eliminar</button>
    </td>
  `;
  return tr;
}

async function openFamilia(id) {
  familiaEditId = id || null;
  document.getElementById('familiaTitulo').textContent = id ? 'Editar familia' : 'Nueva familia';
  document.getElementById('famActivaWrap').style.display = id ? 'block' : 'none';

  if (id) {
    const familias = await (await fetch('/api/familias')).json();
    const f = familias.find((x) => x.id === id);
    document.getElementById('famNombre').value = f.nombre;
    document.getElementById('famDebito').value = f.descuento_debito;
    document.getElementById('famEfectivo').value = f.descuento_efectivo;
    document.getElementById('famUsaRendicion').checked = !!f.usa_precio_rendicion;
    document.getElementById('famUsaManoObra').checked = !!f.usa_mano_obra;
    document.getElementById('famPreguntaPila').checked = !!f.pregunta_pila;
    document.getElementById('famActiva').checked = !!f.activo;
  } else {
    document.getElementById('famNombre').value = '';
    document.getElementById('famDebito').value = 20;
    document.getElementById('famEfectivo').value = 30;
    document.getElementById('famUsaRendicion').checked = false;
    document.getElementById('famUsaManoObra').checked = false;
    document.getElementById('famPreguntaPila').checked = false;
    document.getElementById('famActiva').checked = true;
  }
  document.getElementById('familiaModal').classList.add('open');
}

function closeFamilia() {
  document.getElementById('familiaModal').classList.remove('open');
  familiaEditId = null;
}

async function guardarFamilia() {
  const payload = {
    nombre: document.getElementById('famNombre').value.trim(),
    descuento_debito: Number(document.getElementById('famDebito').value) || 0,
    descuento_efectivo: Number(document.getElementById('famEfectivo').value) || 0,
    usa_precio_rendicion: document.getElementById('famUsaRendicion').checked,
    usa_mano_obra: document.getElementById('famUsaManoObra').checked,
    pregunta_pila: document.getElementById('famPreguntaPila').checked,
    activo: document.getElementById('famActiva').checked,
  };
  if (!payload.nombre) {
    alert('El nombre es obligatorio.');
    return;
  }
  const url = familiaEditId ? `/api/familias/${familiaEditId}` : '/api/familias';
  const method = familiaEditId ? 'PUT' : 'POST';
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await res.json();
  if (!res.ok) {
    alert('Error: ' + data.error);
    return;
  }
  closeFamilia();
  cargarFamiliasTabla();
  cargarFamiliasGlobal();
}

async function toggleFamiliaActiva(id, activo) {
  await fetch(`/api/familias/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ activo: !activo }),
  });
  cargarFamiliasTabla();
  cargarFamiliasGlobal();
}

async function eliminarFamilia(id) {
  if (!confirm('¿Eliminar esta familia? Solo se puede si ningún producto activo la usa.')) return;
  const res = await fetch(`/api/familias/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const data = await res.json();
    alert('Error: ' + data.error);
    return;
  }
  cargarFamiliasTabla();
  cargarFamiliasGlobal();
}

// ============================================================
// CLIENTES
// ============================================================
let clienteEditId = null;
let vehiculosEnEdicion = [];

async function cargarClientes() {
  const q = document.getElementById('cliSearch').value.trim();
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  const res = await fetch('/api/clientes?' + params.toString());
  const rows = await res.json();
  const tbody = document.getElementById('cliBody');
  tbody.innerHTML = '';
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="small">Sin resultados.</td></tr>';
    return;
  }
  rows.forEach((c) => tbody.appendChild(filaCliente(c)));
}

function filaCliente(c) {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td>${c.codigo}</td>
    <td>${c.nombre}</td>
    <td>${c.documento || c.cuit || '—'}</td>
    <td>${c.telefono || '—'}</td>
    <td>${c.condicion_iva}</td>
    <td>${c.venta_a_credito ? `<span class="status s-blue">$ ${money.format(c.limite_credito)}</span>` : '—'}</td>
    <td>${c.patentes || '—'}</td>
    <td>
      <button class="btn light" onclick="openCliente(${c.id})">Ver / Editar</button>
      <button class="btn primary" onclick="elegirClienteParaVenta(${c.id})">Usar en venta</button>
    </td>
  `;
  return tr;
}

document.getElementById('btnBuscarCli').addEventListener('click', cargarClientes);
document.getElementById('cliSearch').addEventListener('keydown', (e) => { if (e.key === 'Enter') cargarClientes(); });
document.getElementById('cliSearch').addEventListener('input', cargarClientes);

function toggleLimiteCredito() {
  document.getElementById('cliLimiteField').style.display = document.getElementById('cliVentaCredito').checked ? 'block' : 'none';
}

function filaVehiculoModal(v) {
  const tr = document.createElement('tr');
  tr.innerHTML = `<td>${v.marca_modelo || '—'}</td><td>${v.patente || '—'}</td><td><button class="btn light" onclick="quitarVehiculoUI(${v.id})">Quitar</button></td>`;
  return tr;
}
function renderVehiculosModal() {
  const tbody = document.getElementById('cliVehiculosBody');
  tbody.innerHTML = '';
  vehiculosEnEdicion.forEach((v) => tbody.appendChild(filaVehiculoModal(v)));
}

let vehiculoTempId = -1;

async function agregarVehiculoUI() {
  const marca_modelo = prompt('Marca / Modelo del vehículo:');
  if (marca_modelo == null) return;
  const patente = prompt('Patente:');
  if (patente == null) return;
  if (!clienteEditId) {
    // Cliente todavía no guardado: se acumula localmente y se sube recién al guardar.
    vehiculosEnEdicion.push({ id: vehiculoTempId--, marca_modelo, patente });
    renderVehiculosModal();
    return;
  }
  const res = await fetch(`/api/clientes/${clienteEditId}/vehiculos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ marca_modelo, patente }),
  });
  const data = await res.json();
  if (!res.ok) {
    alert('Error: ' + data.error);
    return;
  }
  vehiculosEnEdicion.push(data);
  renderVehiculosModal();
}

async function quitarVehiculoUI(vehiculoId) {
  if (!confirm('¿Quitar este vehículo del cliente?')) return;
  if (vehiculoId > 0) {
    await fetch(`/api/clientes/vehiculos/${vehiculoId}`, { method: 'DELETE' });
  }
  vehiculosEnEdicion = vehiculosEnEdicion.filter((v) => v.id !== vehiculoId);
  renderVehiculosModal();
}

async function openCliente(id) {
  clienteEditId = id || null;
  document.getElementById('clienteTitulo').textContent = id ? 'Editar cliente' : 'Nuevo cliente';
  document.getElementById('btnEliminarCli').style.display = id ? 'inline-block' : 'none';

  const c = id ? await (await fetch(`/api/clientes/${id}`)).json() : null;
  document.getElementById('clienteCodigoBadge').textContent = c ? `N° cliente: ${c.codigo}` : '';
  document.getElementById('cliNombre').value = c ? c.nombre : '';
  document.getElementById('cliCondicionIva').value = c ? c.condicion_iva : 'Consumidor Final';
  document.getElementById('cliDocumento').value = c ? c.documento || '' : '';
  document.getElementById('cliCuit').value = c ? c.cuit || '' : '';
  document.getElementById('cliTelefono').value = c ? c.telefono || '' : '';
  document.getElementById('cliEmail').value = c ? c.email || '' : '';
  document.getElementById('cliDireccion').value = c ? c.direccion || '' : '';
  document.getElementById('cliLocalidad').value = c ? c.localidad || '' : '';
  document.getElementById('cliVentaCredito').checked = c ? !!c.venta_a_credito : false;
  document.getElementById('cliLimiteCredito').value = c ? c.limite_credito : '';
  toggleLimiteCredito();
  vehiculosEnEdicion = c ? c.vehiculos : [];
  renderVehiculosModal();
  document.getElementById('clienteModal').classList.add('open');
}

function closeCliente() {
  document.getElementById('clienteModal').classList.remove('open');
  clienteEditId = null;
  vehiculosEnEdicion = [];
  clienteModalOrigenVenta = false;
}

async function guardarCliente() {
  const payload = {
    nombre: document.getElementById('cliNombre').value.trim(),
    condicion_iva: document.getElementById('cliCondicionIva').value,
    documento: document.getElementById('cliDocumento').value.trim() || null,
    cuit: document.getElementById('cliCuit').value.trim() || null,
    telefono: document.getElementById('cliTelefono').value.trim() || null,
    email: document.getElementById('cliEmail').value.trim() || null,
    direccion: document.getElementById('cliDireccion').value.trim() || null,
    localidad: document.getElementById('cliLocalidad').value.trim() || null,
    venta_a_credito: document.getElementById('cliVentaCredito').checked,
    limite_credito: Number(document.getElementById('cliLimiteCredito').value) || 0,
  };
  if (!payload.nombre) {
    alert('El nombre / razón social es obligatorio.');
    return;
  }
  const url = clienteEditId ? `/api/clientes/${clienteEditId}` : '/api/clientes';
  const method = clienteEditId ? 'PUT' : 'POST';
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await res.json();
  if (!res.ok) {
    alert('Error: ' + data.error);
    return;
  }
  if (!clienteEditId) {
    // Recién creado: subimos los vehículos que se habían cargado localmente antes de guardar.
    const pendientes = vehiculosEnEdicion.filter((v) => v.id < 0);
    for (const v of pendientes) {
      const vres = await fetch(`/api/clientes/${data.id}/vehiculos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ marca_modelo: v.marca_modelo, patente: v.patente }),
      });
      if (!vres.ok) {
        const verr = await vres.json();
        alert(`Cliente guardado, pero no se pudo agregar el vehículo ${v.patente}: ${verr.error}`);
      }
    }
    const actualizado = await (await fetch(`/api/clientes/${data.id}`)).json();
    if (clienteModalOrigenVenta) {
      // Se creó desde la búsqueda rápida de la pantalla de Venta: lo dejamos
      // seleccionado ahí mismo y cerramos, sin quedarse en modo edición.
      clienteModalOrigenVenta = false;
      closeCliente();
      elegirClienteEnVenta(actualizado);
      cargarClientes();
      return;
    }
    clienteEditId = data.id;
    document.getElementById('clienteTitulo').textContent = 'Editar cliente';
    document.getElementById('clienteCodigoBadge').textContent = `N° cliente: ${data.codigo}`;
    document.getElementById('btnEliminarCli').style.display = 'inline-block';
    vehiculosEnEdicion = actualizado.vehiculos;
    renderVehiculosModal();
  }
  cargarClientes();
}

async function eliminarCliente() {
  if (!clienteEditId) return;
  if (!confirm('¿Desactivar este cliente?')) return;
  await fetch(`/api/clientes/${clienteEditId}`, { method: 'DELETE' });
  closeCliente();
  cargarClientes();
}

async function importarClientesExcel(event) {
  const input = event.target;
  const archivo = input.files[0];
  if (!archivo) return;
  if (!confirm(`¿Importar "${archivo.name}"? Se agregan solo los clientes con un código que todavía no existe en el sistema; los que ya existen se saltean (no se duplican ni se actualizan).`)) {
    input.value = '';
    return;
  }
  const formData = new FormData();
  formData.append('archivo', archivo);
  const boton = document.querySelector('button[onclick*="cliImportarInput"]');
  const textoOriginal = boton.textContent;
  boton.textContent = 'Importando...';
  boton.disabled = true;
  try {
    const res = await fetch('/api/clientes/importar', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) {
      alert('Error al importar: ' + data.error);
      return;
    }
    let msg = `Importación completa.\nClientes creados: ${data.creados}\nYa existían (salteados): ${data.omitidos}`;
    if (data.recodificados) msg += `\nSin código en la planilla (se les asignó uno nuevo): ${data.recodificados}`;
    if (data.totalErrores) msg += `\nFilas con error: ${data.totalErrores}`;
    alert(msg);
    cargarClientes();
  } catch (err) {
    alert('Error al importar: ' + err.message);
  } finally {
    boton.textContent = textoOriginal;
    boton.disabled = false;
    input.value = '';
  }
}

// ============================================================
// CAJA Y TURNOS
// ============================================================
let cajaTurnoActual = null;
let cajaMovimientoEditandoId = null;

const FORMATO_MONEDA_CAJA = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
function moneyStr(v) {
  return FORMATO_MONEDA_CAJA.format(Number(v) || 0);
}

// La caja es una sola compartida por todo el negocio (no una por rol/terminal):
// da lo mismo si es ADMIN o CAJA quien mira esta pantalla, siempre se ve el
// mismo turno abierto (o la falta de uno) y el mismo historial completo.
async function cargarCaja() {
  const res = await fetch('/api/caja/turno-activo');
  cajaTurnoActual = await res.json();
  if (!cajaTurnoActual) {
    const sugRes = await fetch('/api/caja/fondo-sugerido');
    const { fondo_sugerido } = await sugRes.json();
    document.getElementById('cajaFondoInicial').value = fondo_sugerido;
  }
  renderCaja();
  cargarHistorialCaja();
}

function renderCaja() {
  const sinTurno = document.getElementById('cajaSinTurno');
  const conTurno = document.getElementById('cajaConTurno');
  if (!cajaTurnoActual) {
    sinTurno.style.display = 'block';
    conTurno.style.display = 'none';
    return;
  }
  sinTurno.style.display = 'none';
  conTurno.style.display = 'block';
  document.getElementById('cajaTurnoNumero').textContent = cajaTurnoActual.numero;
  document.getElementById('cajaTurnoTerminal').textContent = cajaTurnoActual.terminal;
  document.getElementById('cajaTurnoAbiertoEn').textContent = new Date(cajaTurnoActual.abierto_en).toLocaleString('es-AR');
  document.getElementById('cajaTurnoFondo').textContent = moneyStr(cajaTurnoActual.fondo_inicial);
  document.getElementById('cajaTotalIngresos').textContent = moneyStr(cajaTurnoActual.resumen.totalIngresos);
  document.getElementById('cajaTotalEgresos').textContent = moneyStr(cajaTurnoActual.resumen.totalEgresos);
  document.getElementById('cajaEfectivoEsperado').textContent = moneyStr(cajaTurnoActual.resumen.efectivoEsperado);

  const formasBody = document.getElementById('cajaResumenFormasBody');
  const formas = Object.entries(cajaTurnoActual.resumen.porFormaPago);
  formasBody.innerHTML = formas.length
    ? formas.map(([fp, r]) => `<tr><td>${fp}</td><td>${moneyStr(r.ingresos)}</td><td>${moneyStr(r.egresos)}</td></tr>`).join('')
    : '<tr><td colspan="3" class="small">Sin movimientos todavía.</td></tr>';

  const movBody = document.getElementById('cajaMovimientosBody');
  const movimientosManuales = cajaTurnoActual.movimientos.filter((m) => m.categoria !== 'venta');
  movBody.innerHTML = movimientosManuales.length
    ? [...movimientosManuales].reverse().map((m) => `
        <tr>
          <td>${new Date(m.creado_en).toLocaleString('es-AR')}</td>
          <td>${m.tipo === 'ingreso' ? 'Ingreso' : 'Egreso'}</td>
          <td>${m.categoria}</td>
          <td>${m.concepto || ''}</td>
          <td>${m.forma_pago || ''}</td>
          <td>${moneyStr(m.monto)}</td>
          <td>${!m.referencia_tipo
            ? `<button class="btn light" onclick="editarMovimientoCaja(${m.id})">✎</button> <button class="btn light" onclick="quitarMovimientoCaja(${m.id})">✕</button>`
            : ''}</td>
        </tr>
      `).join('')
    : '<tr><td colspan="7" class="small">Sin movimientos manuales todavía.</td></tr>';

  const fondoSiguienteInput = document.getElementById('cajaFondoSiguiente');
  if (!fondoSiguienteInput.value) fondoSiguienteInput.value = cajaTurnoActual.fondo_inicial;
  actualizarCajaFuerteCierre();
}

function actualizarCajaFuerteCierre() {
  const contado = Number(document.getElementById('cajaEfectivoContado').value) || 0;
  const fondoSiguiente = Number(document.getElementById('cajaFondoSiguiente').value) || 0;
  const aCajaFuerte = contado - fondoSiguiente;
  const el = document.getElementById('cajaFuerteCierrePreview');
  el.textContent = aCajaFuerte < 0
    ? 'El fondo para el próximo turno no puede ser mayor al efectivo contado.'
    : `A caja fuerte: ${moneyStr(aCajaFuerte)}`;
}

// ============================================================
// ARQUEO DE BILLETES — para cargar "Fondo para el próximo turno" contando
// los billetes uno por uno en vez de escribir un número a ojo.
// ============================================================
const DENOMINACIONES_ARS = [20000, 10000, 2000, 1000, 500, 200, 100, 50, 20, 10];
let arqueoBilletesTargetId = null;

function abrirArqueoBilletes(targetInputId) {
  arqueoBilletesTargetId = targetInputId;
  const body = document.getElementById('arqueoBilletesBody');
  body.innerHTML = DENOMINACIONES_ARS.map(
    (valor, i) => `
      <tr>
        <td>$ ${money.format(valor)}</td>
        <td><input type="number" min="0" step="1" value="0" style="width:70px" data-valor="${valor}" oninput="actualizarTotalArqueo()" id="arqueoCant${i}"></td>
        <td id="arqueoSubtotal${i}">$ 0</td>
      </tr>`
  ).join('');
  actualizarTotalArqueo();
  document.getElementById('arqueoBilletesModal').classList.add('open');
}

function actualizarTotalArqueo() {
  let total = 0;
  DENOMINACIONES_ARS.forEach((valor, i) => {
    const cantidad = Number(document.getElementById(`arqueoCant${i}`).value) || 0;
    const subtotal = valor * cantidad;
    total += subtotal;
    document.getElementById(`arqueoSubtotal${i}`).textContent = '$ ' + money.format(subtotal);
  });
  document.getElementById('arqueoBilletesTotal').textContent = '$ ' + money.format(total);
  return total;
}

function cerrarArqueoBilletes() {
  document.getElementById('arqueoBilletesModal').classList.remove('open');
  arqueoBilletesTargetId = null;
}

function confirmarArqueoBilletes() {
  const total = actualizarTotalArqueo();
  const target = document.getElementById(arqueoBilletesTargetId);
  target.value = total;
  if (arqueoBilletesTargetId === 'cajaFondoSiguiente') actualizarCajaFuerteCierre();
  cerrarArqueoBilletes();
}

async function abrirTurnoCaja() {
  const fondo_inicial = document.getElementById('cajaFondoInicial').value;
  const res = await fetch('/api/caja/abrir', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ terminal: session.rol, usuario_id: session.id, fondo_inicial }),
  });
  const data = await res.json();
  if (!res.ok) {
    alert('Error: ' + data.error);
    return;
  }
  cajaTurnoActual = data;
  renderCaja();
  cargarHistorialCaja();
}

function mostrarFormMovimientoCaja() {
  cajaMovimientoEditandoId = null;
  document.getElementById('cajaMovTipo').value = 'egreso';
  document.getElementById('cajaMovCategoria').value = 'retiro';
  document.getElementById('cajaMovConcepto').value = '';
  document.getElementById('cajaMovFormaPago').value = 'Efectivo';
  document.getElementById('cajaMovMonto').value = '';
  document.getElementById('btnGuardarMovimientoCaja').textContent = 'Guardar';
  document.getElementById('cajaFormMovimiento').style.display = 'flex';
}

function editarMovimientoCaja(movId) {
  const m = cajaTurnoActual.movimientos.find((x) => x.id === movId);
  if (!m) return;
  cajaMovimientoEditandoId = movId;
  document.getElementById('cajaMovTipo').value = m.tipo;
  document.getElementById('cajaMovCategoria').value = m.categoria;
  document.getElementById('cajaMovConcepto').value = m.concepto || '';
  document.getElementById('cajaMovFormaPago').value = m.forma_pago || 'Efectivo';
  document.getElementById('cajaMovMonto').value = m.monto;
  document.getElementById('btnGuardarMovimientoCaja').textContent = 'Guardar cambios';
  document.getElementById('cajaFormMovimiento').style.display = 'flex';
}

async function quitarMovimientoCaja(movId) {
  const res = await fetch(`/api/caja/${cajaTurnoActual.id}/movimientos/${movId}`, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) {
    alert('Error: ' + data.error);
    return;
  }
  cajaTurnoActual = data;
  renderCaja();
}

async function confirmarMovimientoCaja() {
  const tipo = document.getElementById('cajaMovTipo').value;
  const categoria = document.getElementById('cajaMovCategoria').value;
  const concepto = document.getElementById('cajaMovConcepto').value;
  const forma_pago = document.getElementById('cajaMovFormaPago').value;
  const monto = document.getElementById('cajaMovMonto').value;
  const editando = cajaMovimientoEditandoId;
  const url = editando ? `/api/caja/${cajaTurnoActual.id}/movimientos/${editando}` : `/api/caja/${cajaTurnoActual.id}/movimientos`;
  const res = await fetch(url, {
    method: editando ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tipo, categoria, concepto, forma_pago, monto, usuario_id: session.id }),
  });
  const data = await res.json();
  if (!res.ok) {
    alert('Error: ' + data.error);
    return;
  }
  cajaTurnoActual = data;
  cajaMovimientoEditandoId = null;
  document.getElementById('cajaMovConcepto').value = '';
  document.getElementById('cajaMovMonto').value = '';
  document.getElementById('cajaFormMovimiento').style.display = 'none';
  renderCaja();
}

async function cerrarTurnoCaja() {
  const efectivo_contado = document.getElementById('cajaEfectivoContado').value;
  const fondo_turno_siguiente = document.getElementById('cajaFondoSiguiente').value;
  const observacion = document.getElementById('cajaObservacionCierre').value;
  const res = await fetch(`/api/caja/${cajaTurnoActual.id}/cerrar`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ efectivo_contado, fondo_turno_siguiente, observacion }),
  });
  const data = await res.json();
  if (!res.ok) {
    alert('Error: ' + data.error);
    return;
  }
  cajaTurnoActual = null;
  document.getElementById('cajaEfectivoContado').value = '';
  document.getElementById('cajaFondoSiguiente').value = '';
  document.getElementById('cajaObservacionCierre').value = '';
  document.getElementById('cajaFuerteCierrePreview').textContent = '';
  await cargarCaja();
  mostrarTicketCierre(data);
}

function construirTicketCierreHtml(t) {
  const ventasMov = t.movimientos.filter((m) => m.categoria === 'venta');
  const porFormaVentas = {};
  ventasMov.forEach((m) => {
    const fp = m.forma_pago || 'Otro';
    porFormaVentas[fp] = (porFormaVentas[fp] || 0) + (m.tipo === 'ingreso' ? m.monto : -m.monto);
  });
  const totalVentas = Object.values(porFormaVentas).reduce((a, b) => a + b, 0);
  const ventasHtml = Object.entries(porFormaVentas)
    .filter(([, monto]) => monto !== 0)
    .map(([fp, monto]) => `${fp}&nbsp;&nbsp;${moneyStr(monto)}<br>`)
    .join('') || 'Sin ventas.<br>';

  const gastosMov = t.movimientos.filter((m) => m.categoria !== 'venta' && m.categoria !== 'caja_fuerte');
  const totalGastos = gastosMov.reduce((a, m) => a + (m.tipo === 'egreso' ? m.monto : -m.monto), 0);
  const gastosHtml = gastosMov.length
    ? gastosMov.map((m) => `${m.concepto || m.categoria}&nbsp;&nbsp;${moneyStr(m.tipo === 'egreso' ? -m.monto : m.monto)}<br>`).join('')
    : 'Sin movimientos.<br>';

  // Suma todos los envíos a caja fuerte del turno, no solo el automático del
  // cierre: también puede haber traslados cargados a mano durante el turno
  // (categoría "Caja fuerte" en Movimientos), y el ticket tiene que mostrar
  // el total real enviado, no solo el primero que encuentre.
  const totalCajaFuerte = t.movimientos.filter((m) => m.categoria === 'caja_fuerte').reduce((a, m) => a + m.monto, 0);
  const diferencia = t.diferencia || 0;
  const estadoDif = Math.abs(diferencia) < 1 ? 'CAJA EXACTA' : diferencia > 0 ? 'SOBRANTE' : 'FALTANTE';

  return `
    ${ticketEncabezadoHtml()}
    <div class="center">CIERRE DE CAJA</div><hr>
    Terminal: ${t.terminal} &nbsp; Turno: ${t.numero}<br>
    Apertura: ${new Date(t.abierto_en).toLocaleString('es-AR')}<br>
    Cierre: ${t.cerrado_en ? new Date(t.cerrado_en).toLocaleString('es-AR') : '—'}<hr>
    SALDO INICIAL&nbsp;&nbsp;<b>${moneyStr(t.fondo_inicial)}</b><hr>
    <b>VENTAS POR FORMA DE PAGO</b><br>
    ${ventasHtml}
    TOTAL VENTAS&nbsp;&nbsp;<b>${moneyStr(totalVentas)}</b><hr>
    <b>MOVIMIENTOS DE CAJA</b><br>
    ${gastosHtml}
    TOTAL MOVIMIENTOS&nbsp;&nbsp;<b>${moneyStr(-totalGastos)}</b><hr>
    SALDO DE CAJA (esperado)&nbsp;&nbsp;${moneyStr(t.efectivo_esperado)}<br>
    EFECTIVO CONTADO&nbsp;&nbsp;${moneyStr(t.efectivo_contado)}<br>
    DIFERENCIA&nbsp;&nbsp;<b>${moneyStr(diferencia)} (${estadoDif})</b><hr>
    FONDO PRÓXIMO TURNO&nbsp;&nbsp;<b>${moneyStr(t.fondo_turno_siguiente)}</b><br>
    ${totalCajaFuerte > 0 ? `ENVÍO A CAJA FUERTE&nbsp;&nbsp;<b>${moneyStr(totalCajaFuerte)}</b><br>` : ''}
    ${t.observacion ? `<hr>Observación: ${t.observacion}<br>` : ''}
    ${ticketPieHtml()}
  `;
}

// El ticket térmico y el A4 comparten la misma pantalla (#ticket-screen);
// según el tipo de documento se muestra uno u otro, ocultando y vaciando el
// que no corresponde para no dejar contenido viejo pisado atrás.
function mostrarTicketComoTermico(html) {
  const elA4 = document.getElementById('ticketA4Contenido');
  elA4.style.display = 'none';
  elA4.innerHTML = '';
  const el = document.getElementById('ticketContenido');
  el.style.display = '';
  el.innerHTML = html;
}
function mostrarTicketComoA4(html) {
  const el = document.getElementById('ticketContenido');
  el.style.display = 'none';
  el.innerHTML = '';
  const elA4 = document.getElementById('ticketA4Contenido');
  elA4.style.display = 'block';
  elA4.innerHTML = html;
}

async function mostrarTicketCierre(t) {
  await cargarConfiguracionGlobal();
  ultimoDocumentoParaTicket = { tipo: 'cierre', data: t };
  document.getElementById('btnEnviarImagenWhatsapp').style.display = 'none';
  document.getElementById('btnEnviarImagenA4Whatsapp').style.display = 'none';
  document.getElementById('btnImprimirA4').style.display = 'none';
  document.getElementById('btnEditarTicketRendicion').style.display = 'none';
  document.getElementById('btnEditarTicketCierre').style.display = '';
  mostrarTicketComoTermico(construirTicketCierreHtml(t));
  showScreen('ticket-screen');
}

function editarCierreDesdeTicket() {
  if (!ultimoDocumentoParaTicket || ultimoDocumentoParaTicket.tipo !== 'cierre') return;
  showScreen('caja');
  abrirModificarCierre(ultimoDocumentoParaTicket.data.id);
}

async function imprimirTicketCierre(turnoId) {
  const t = await (await fetch(`/api/caja/${turnoId}`)).json();
  mostrarTicketCierre(t);
}

async function abrirModificarCierre(turnoId) {
  const t = await (await fetch(`/api/caja/${turnoId}`)).json();
  document.getElementById('cierreModalTurnoId').value = t.id;
  document.getElementById('cierreModalContado').value = t.efectivo_contado;
  document.getElementById('cierreModalFondoSiguiente').value = t.fondo_turno_siguiente;
  document.getElementById('cierreModalObservacion').value = t.observacion || '';
  document.getElementById('editarCierreModal').classList.add('open');
}

function closeEditarCierre() {
  document.getElementById('editarCierreModal').classList.remove('open');
}

async function confirmarModificarCierre() {
  const id = document.getElementById('cierreModalTurnoId').value;
  const efectivo_contado = document.getElementById('cierreModalContado').value;
  const fondo_turno_siguiente = document.getElementById('cierreModalFondoSiguiente').value;
  const observacion = document.getElementById('cierreModalObservacion').value;
  const res = await fetch(`/api/caja/${id}/cierre`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ efectivo_contado, fondo_turno_siguiente, observacion }),
  });
  const data = await res.json();
  if (!res.ok) {
    alert('Error: ' + data.error);
    return;
  }
  closeEditarCierre();
  await cargarHistorialCaja();
  mostrarTicketCierre(data);
}

async function cargarHistorialCaja() {
  const res = await fetch('/api/caja');
  const turnos = await res.json();
  const body = document.getElementById('cajaHistorialBody');
  body.innerHTML = turnos.length
    ? turnos.map((t) => `
        <tr>
          <td>${t.numero}</td>
          <td>${t.terminal}</td>
          <td>${new Date(t.abierto_en).toLocaleString('es-AR')}</td>
          <td>${t.cerrado_en ? new Date(t.cerrado_en).toLocaleString('es-AR') : '—'}</td>
          <td>${moneyStr(t.fondo_inicial)}</td>
          <td>${t.efectivo_esperado != null ? moneyStr(t.efectivo_esperado) : '—'}</td>
          <td>${t.efectivo_contado != null ? moneyStr(t.efectivo_contado) : '—'}</td>
          <td>${t.diferencia != null ? moneyStr(t.diferencia) : '—'}</td>
          <td>${t.fondo_turno_siguiente != null ? moneyStr(t.fondo_turno_siguiente) : '—'}</td>
          <td>${t.estado === 'abierto' ? '<span class="badge green">Abierto</span>' : '<span class="badge">Cerrado</span>'}</td>
          <td>${t.estado === 'cerrado'
            ? `<button class="btn light" onclick="imprimirTicketCierre(${t.id})">🖨️</button> <button class="btn light" onclick="abrirModificarCierre(${t.id})">✎</button>`
            : ''}</td>
        </tr>
      `).join('')
    : '<tr><td colspan="11" class="small">Sin turnos registrados.</td></tr>';
}

// ============================================================
// DASHBOARD — panel financiero
// ============================================================
function fechaLocalHoy() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function moneyDash(v) {
  return '$ ' + money.format(Math.round(v));
}

async function cargarDashboard() {
  if (!document.getElementById('gmFecha').value) {
    document.getElementById('gmFecha').value = fechaLocalHoy();
  }
  const params = new URLSearchParams();
  const anio = document.getElementById('dashAnio').value;
  const mes = document.getElementById('dashMes').value;
  const tipoEgreso = document.getElementById('dashTipoEgreso').value;
  const formaPago = document.getElementById('dashFormaPago').value;
  if (anio) params.set('anio', anio);
  if (mes) params.set('mes', mes);
  if (tipoEgreso) params.set('tipo_egreso', tipoEgreso);
  if (formaPago) params.set('forma_pago', formaPago);
  const r = await (await fetch('/api/reportes/dashboard?' + params.toString())).json();

  const selAnio = document.getElementById('dashAnio');
  if (!selAnio.options.length) {
    selAnio.innerHTML = r.aniosDisponibles.map((a) => `<option value="${a}">${a}</option>`).join('');
    selAnio.value = r.anio;
  }
  const selTipo = document.getElementById('dashTipoEgreso');
  const tipoPrevio = selTipo.value;
  selTipo.innerHTML =
    '<option value="">Todos los egresos</option>' +
    r.tiposEgresoDisponibles.map((t) => `<option value="${t}" ${t === tipoPrevio ? 'selected' : ''}>${t}</option>`).join('');

  renderDashboardKpis(r);
  renderControlCierre(r);
  renderLecturaRapida(r);
  renderChartMensual(r.serieMensual);
  renderChartTipos(r.gastosPorTipo);
}

function renderDashboardKpis(r) {
  document.getElementById('dkFacturacion').textContent = moneyDash(r.facturacion);
  document.getElementById('dkCuentaCorriente').textContent = moneyDash(r.cuentaCorriente);
  document.getElementById('dkGastos').textContent = moneyDash(r.gastos);
  document.getElementById('dkCajaFuerte').textContent = moneyDash(r.cajaFuerte);
  document.getElementById('dkPagoElectronico').textContent = moneyDash(r.pagoElectronico);
  const dif = document.getElementById('dkDiferencia');
  dif.textContent = moneyDash(r.diferencia);
  dif.style.color = Math.abs(r.diferencia) < 1 ? 'var(--green)' : 'var(--red)';
  document.getElementById('dkDiferenciaHint').textContent = Math.abs(r.diferencia) < 1 ? 'Cierre correcto' : 'Revisar diferencia';
}

function renderControlCierre(r) {
  const saldoCobrado = r.facturacion - r.cuentaCorriente;
  document.getElementById('ccFacturacion').textContent = moneyDash(r.facturacion);
  document.getElementById('ccCuentaCorriente').textContent = moneyDash(r.cuentaCorriente);
  document.getElementById('ccSaldoCobrado').textContent = moneyDash(saldoCobrado);
  document.getElementById('ccGastos').textContent = moneyDash(r.gastos);
  document.getElementById('ccCajaFuerte').textContent = moneyDash(r.cajaFuerte);
  document.getElementById('ccPagoElectronico').textContent = moneyDash(r.pagoElectronico);
  const ccDif = document.getElementById('ccDiferencia');
  ccDif.textContent = moneyDash(r.diferencia);
  ccDif.style.color = Math.abs(r.diferencia) < 1 ? 'var(--green)' : 'var(--red)';
}

function renderLecturaRapida(r) {
  const badge = document.getElementById('lecturaBadge');
  if (Math.abs(r.diferencia) < 1) {
    badge.className = 'lectura-badge ok';
    badge.textContent = '✅ Cierre correcto: la diferencia da $0';
  } else {
    badge.className = 'lectura-badge warn';
    badge.textContent = `⚠️ Revisar: la diferencia da ${moneyDash(r.diferencia)}`;
  }
}

const MESES_LABEL_DASH = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
function renderChartMensual(serie) {
  const cont = document.getElementById('dashChartMensual');
  const max = Math.max(1, ...serie.flatMap((m) => [m.facturacion, m.gastos, m.cajaFuerte, m.pagoElectronico]));
  const leyenda = `
    <div class="chart-legend">
      <span><i style="background:var(--green)"></i>Facturación</span>
      <span><i style="background:var(--red)"></i>Gastos</span>
      <span><i style="background:var(--blue)"></i>Caja Fuerte</span>
      <span><i style="background:#7c3aed"></i>Electrónico</span>
    </div>`;
  const barras = serie
    .map(
      (m, i) => `
    <div class="chart-mensual-mes" title="${MESES_LABEL_DASH[i]}: Facturación ${moneyDash(m.facturacion)}, Gastos ${moneyDash(m.gastos)}, Caja fuerte ${moneyDash(m.cajaFuerte)}, Electrónico ${moneyDash(m.pagoElectronico)}">
      <div class="chart-mensual-barras">
        <div style="height:${(m.facturacion / max) * 100}%;background:var(--green)"></div>
        <div style="height:${(m.gastos / max) * 100}%;background:var(--red)"></div>
        <div style="height:${(m.cajaFuerte / max) * 100}%;background:var(--blue)"></div>
        <div style="height:${(m.pagoElectronico / max) * 100}%;background:#7c3aed"></div>
      </div>
      <div class="chart-mensual-label">${MESES_LABEL_DASH[i]}</div>
    </div>`
    )
    .join('');
  cont.innerHTML = leyenda + `<div class="chart-mensual">${barras}</div>`;
}

function renderChartTipos(rows) {
  const cont = document.getElementById('dashChartTipos');
  if (!rows.length) {
    cont.innerHTML = '<p class="small">Sin gastos en el período.</p>';
    return;
  }
  const max = Math.max(...rows.map((r) => r.total));
  cont.innerHTML = rows
    .map(
      (r) => `
    <div class="chart-tipos-fila">
      <div class="chart-tipos-label" title="${r.etiqueta}">${r.etiqueta}</div>
      <div class="chart-tipos-barra-wrap"><div class="chart-tipos-barra" style="width:${(r.total / max) * 100}%"></div></div>
      <div class="chart-tipos-monto">${moneyDash(r.total)}</div>
    </div>`
    )
    .join('');
}

async function guardarGastoManualDashboard() {
  const fecha = document.getElementById('gmFecha').value;
  const tipo_egreso = document.getElementById('gmTipo').value.trim();
  const detalle = document.getElementById('gmDetalle').value.trim();
  const monto = Number(document.getElementById('gmMonto').value) || 0;
  const forma_pago = document.getElementById('gmFormaPago').value;
  if (!tipo_egreso) {
    alert('Ingresá el tipo de gasto.');
    return;
  }
  if (monto <= 0) {
    alert('El monto debe ser mayor a 0.');
    return;
  }
  const res = await fetch('/api/reportes/gasto-manual', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ terminal: session.rol, usuario_id: session.id, fecha, tipo_egreso, detalle, monto, forma_pago }),
  });
  const data = await res.json();
  if (!res.ok) {
    alert('Error: ' + data.error);
    return;
  }
  document.getElementById('gmTipo').value = '';
  document.getElementById('gmDetalle').value = '';
  document.getElementById('gmMonto').value = 0;
  cargarDashboard();
}

// ============================================================
// RANKING — cuánto se vendió de un producto o familia + stock actual
// ============================================================
async function cargarRanking() {
  const sel = document.getElementById('rkConsultaAnio');
  if (sel.options.length) return;
  const anios = await (await fetch('/api/reportes/anios-disponibles')).json();
  sel.innerHTML = anios.map((a) => `<option value="${a}">${a}</option>`).join('');
}


let rkObjetivoTipo = 'producto';
let rkFechaModo = 'mes';
let rkProductoSeleccionado = null;

function cambiarObjetivoRanking(tipo) {
  rkObjetivoTipo = tipo;
  document.querySelectorAll('#rkObjetivoTabs button').forEach((b) => b.classList.toggle('active', b.dataset.obj === tipo));
  document.getElementById('rkObjetivoProducto').style.display = tipo === 'producto' ? 'block' : 'none';
  document.getElementById('rkObjetivoFamilia').style.display = tipo === 'familia' ? 'block' : 'none';
}

function cambiarModoFechaRanking(modo) {
  rkFechaModo = modo;
  document.querySelectorAll('#rkFechaTabs button').forEach((b) => b.classList.toggle('active', b.dataset.modo === modo));
  document.getElementById('rkFechaMesFields').style.display = modo === 'mes' ? 'flex' : 'none';
  document.getElementById('rkFechaRangoFields').style.display = modo === 'rango' ? 'flex' : 'none';
}

function elegirProductoRanking(p) {
  rkProductoSeleccionado = p;
  document.getElementById('rkProductoSeleccionadoTxt').innerHTML = `Elegido: <b>${p.codigo}</b> — ${p.descripcion}`;
  document.getElementById('rkProductoResultados').style.display = 'none';
  document.getElementById('rkProductoBuscar').value = '';
}

async function buscarProductoRanking() {
  const q = document.getElementById('rkProductoBuscar').value.trim();
  const cont = document.getElementById('rkProductoResultados');
  if (!q) {
    cont.style.display = 'none';
    return;
  }
  const res = await fetch('/api/productos?q=' + encodeURIComponent(q));
  const rows = (await res.json()).slice(0, 12);
  cont.innerHTML = rows.length
    ? rows.map((p) => `<div class="search-result-item" data-id="${p.id}"><b>${p.codigo}</b> — ${p.descripcion}</div>`).join('')
    : '<div class="small" style="padding:8px 12px">Sin resultados.</div>';
  cont.querySelectorAll('.search-result-item').forEach((el) => {
    const p = rows.find((x) => String(x.id) === el.dataset.id);
    el.onclick = () => elegirProductoRanking(p);
  });
  inicializarItemsBuscador('rkProductoResultados');
  cont.style.display = 'block';
}
document.getElementById('rkProductoBuscar').addEventListener('input', buscarProductoRanking);
document.getElementById('rkProductoBuscar').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    moverBuscadorIndice('rkProductoResultados', 1);
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    moverBuscadorIndice('rkProductoResultados', -1);
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    elegirResultadoConEnter('rkProductoResultados');
  }
});
document.addEventListener('click', (e) => {
  const cont = document.getElementById('rkProductoResultados');
  if (cont && !e.target.closest('#rkObjetivoProducto')) cont.style.display = 'none';
});

function filaStockClase(p) {
  if (p.stock_actual <= 0) return 's-bad';
  if (p.stock_actual < p.stock_minimo) return 's-bad';
  return 's-ok';
}

async function consultarRanking() {
  const params = new URLSearchParams();
  if (rkObjetivoTipo === 'producto') {
    if (!rkProductoSeleccionado) {
      alert('Elegí un producto de la lista de resultados.');
      return;
    }
    params.set('producto_id', rkProductoSeleccionado.id);
  } else {
    const familiaId = document.getElementById('rkFamiliaId').value;
    if (!familiaId) {
      alert('Elegí una familia.');
      return;
    }
    params.set('familia_id', familiaId);
  }
  if (rkFechaModo === 'mes') {
    const anio = document.getElementById('rkConsultaAnio').value;
    const mes = document.getElementById('rkConsultaMes').value;
    if (anio) params.set('anio', anio);
    if (mes) params.set('mes', mes);
  } else {
    const desde = document.getElementById('rkConsultaDesde').value;
    const hasta = document.getElementById('rkConsultaHasta').value;
    if (desde) params.set('desde', desde);
    if (hasta) params.set('hasta', hasta);
  }

  const r = await (await fetch('/api/reportes/consulta?' + params.toString())).json();
  const cont = document.getElementById('rkConsultaResultado');

  if (r.tipo === 'producto') {
    const p = r.producto;
    cont.innerHTML = `
      <div class="grid dash-kpis" style="grid-template-columns:repeat(3,minmax(0,1fr))">
        <div class="card kpi kpi-green"><div class="label">Cantidad vendida</div><div class="value">${r.cantidad}</div><div class="hint">${p.codigo} — ${p.descripcion}</div></div>
        <div class="card kpi kpi-blue"><div class="label">Importe facturado</div><div class="value">${moneyDash(r.importe)}</div></div>
        <div class="card kpi"><div class="label">Stock actual</div><div class="value"><span class="status ${filaStockClase(p)}">${money.format(p.stock_actual)}</span></div><div class="hint">Mínimo: ${money.format(p.stock_minimo)}</div></div>
      </div>`;
  } else {
    const filas = r.detalle
      .map(
        (d) => `<tr><td>${d.codigo}</td><td>${d.nombre}</td><td>${d.cantidad}</td><td>${moneyDash(d.importe)}</td><td><span class="status ${filaStockClase(d)}">${money.format(d.stock_actual)}</span></td></tr>`
      )
      .join('');
    cont.innerHTML = `
      <table class="table">
        <thead><tr><th>Código</th><th>Producto</th><th>Cantidad vendida</th><th>Importe</th><th>Stock actual</th></tr></thead>
        <tbody>${filas || '<tr><td colspan="5" class="small">Esta familia no tiene productos activos.</td></tr>'}</tbody>
        <tfoot><tr><td colspan="2"><b>Total</b></td><td><b>${r.total.cantidad}</b></td><td><b>${moneyDash(r.total.importe)}</b></td><td></td></tr></tfoot>
      </table>`;
  }
}

// ============================================================
// CONFIGURACIÓN — negocio, impresora, cerrajeros, notas de ticket
// ============================================================
let configCache = null;

async function cargarConfiguracionGlobal() {
  configCache = await (await fetch('/api/configuracion')).json();
}

async function cargarUsuariosClaves() {
  const usuarios = await (await fetch('/api/usuarios')).json();
  const tbody = document.getElementById('usuariosClavesBody');
  tbody.innerHTML = usuarios
    .map(
      (u) => `
      <tr>
        <td><b>${u.rol}</b></td>
        <td>${u.usuario}</td>
        <td><input type="password" id="claveActual-${u.id}" placeholder="Clave actual" style="width:140px"></td>
        <td><input type="password" id="clave-${u.id}" placeholder="Nueva clave" style="width:140px"></td>
        <td><button class="btn light" onclick="guardarClaveUsuario(${u.id})">Guardar</button></td>
      </tr>`
    )
    .join('');
}

async function guardarClaveUsuario(id) {
  const passwordActual = document.getElementById(`claveActual-${id}`).value.trim();
  const input = document.getElementById(`clave-${id}`);
  const password = input.value.trim();
  if (!passwordActual) {
    alert('Ingresá la clave actual de ese puesto para poder cambiarla.');
    return;
  }
  if (!password) return;
  const res = await fetch(`/api/usuarios/${id}/password`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password, passwordActual }),
  });
  if (!res.ok) {
    const data = await res.json();
    alert(data.error || 'No se pudo guardar la clave.');
    return;
  }
  input.value = '';
  document.getElementById(`claveActual-${id}`).value = '';
  alert('Clave actualizada.');
}

async function cargarConfiguracion() {
  await cargarConfiguracionGlobal();
  document.getElementById('cfgImpresoraNombre').value = configCache.impresora_nombre || '';
  document.getElementById('cfgImpresoraAncho').value = String(configCache.impresora_ancho_mm || 80);
  document.getElementById('cfgNombreNegocio').value = configCache.nombre_negocio || '';
  document.getElementById('cfgSubtitulo').value = configCache.subtitulo || '';
  document.getElementById('cfgLogoPreview').src = configCache.logo_url || '/img/logo-badge.png';
  document.getElementById('cfgTicketEncabezado').value = configCache.ticket_encabezado || '';
  document.getElementById('cfgTicketPie').value = configCache.ticket_pie || '';
  document.getElementById('cfgResponsableNombre').value = configCache.responsable_nombre || '';
  document.getElementById('cfgCuitNegocio').value = configCache.cuit_negocio || '';
  document.getElementById('cfgCondicionFiscalNegocio').value = configCache.condicion_fiscal_negocio || '';
  document.getElementById('cfgDomicilioNegocio').value = configCache.domicilio_negocio || '';
  document.getElementById('cfgInicioActividades').value = configCache.inicio_actividades || '';
  document.getElementById('cfgIngresosBrutos').value = configCache.ingresos_brutos || '';
  document.getElementById('cfgTelefonoRecuperacion').value = configCache.telefono_recuperacion || '';
  document.getElementById('cfgArcaPuntoVenta').value = configCache.arca_punto_venta || '';
  document.getElementById('cfgArcaActiva').checked = !!configCache.arca_facturacion_activa;
  document.getElementById('cfgMpAccessToken').value = configCache.mp_access_token || '';
  document.getElementById('cfgMpActiva').checked = !!configCache.mp_activo;
  mostrarEstadoQrFijoMp();
}

function mostrarEstadoQrFijoMp() {
  const estadoEl = document.getElementById('mpQrFijoEstado');
  const wrap = document.getElementById('mpQrFijoImagenWrap');
  if (configCache.mp_qr_fijo_image_url) {
    estadoEl.textContent = 'QR fijo ya configurado.';
    document.getElementById('mpQrFijoImagen').src = configCache.mp_qr_fijo_image_url;
    const linkTemplate = document.getElementById('mpQrFijoTemplateLink');
    if (configCache.mp_qr_fijo_template_url) {
      linkTemplate.href = configCache.mp_qr_fijo_template_url;
      linkTemplate.style.display = 'inline';
    } else {
      linkTemplate.style.display = 'none';
    }
    wrap.style.display = 'block';
  } else {
    estadoEl.textContent = 'Todavía no configurado (se usa un QR nuevo por cada venta).';
    wrap.style.display = 'none';
  }
}

async function configurarQrFijoMp() {
  if (!configCache.mp_access_token) {
    alert('Primero cargá y guardá el Access Token de Mercado Pago.');
    return;
  }
  document.getElementById('mpQrFijoEstado').textContent = 'Configurando…';
  const res = await fetch('/api/mercadopago/qr-fijo/configurar', { method: 'POST' });
  const data = await res.json();
  if (!res.ok) {
    document.getElementById('mpQrFijoEstado').textContent = '';
    alert('Error: ' + data.error);
    return;
  }
  await cargarConfiguracionGlobal();
  mostrarEstadoQrFijoMp();
  alert('Listo, se configuró el QR fijo. Imprimilo y pegalo en el mostrador.');
}

async function guardarArcaConfig() {
  const payload = {
    arca_punto_venta: document.getElementById('cfgArcaPuntoVenta').value.trim(),
    arca_facturacion_activa: document.getElementById('cfgArcaActiva').checked,
  };
  await fetch('/api/configuracion', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  await cargarConfiguracionGlobal();
  alert('Configuración de facturación electrónica guardada.');
}

async function guardarMpConfig() {
  const payload = {
    mp_access_token: document.getElementById('cfgMpAccessToken').value.trim(),
    mp_activo: document.getElementById('cfgMpActiva').checked,
  };
  await fetch('/api/configuracion', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  await cargarConfiguracionGlobal();
  alert('Configuración de cobro con QR guardada.');
}

async function guardarTelefonoRecuperacionConfig() {
  const payload = { telefono_recuperacion: document.getElementById('cfgTelefonoRecuperacion').value.trim() };
  await fetch('/api/configuracion', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  await cargarConfiguracionGlobal();
  alert('Teléfono de recuperación guardado.');
}

async function guardarImpresoraConfig() {
  const payload = {
    impresora_nombre: document.getElementById('cfgImpresoraNombre').value.trim() || null,
    impresora_ancho_mm: Number(document.getElementById('cfgImpresoraAncho').value),
  };
  await fetch('/api/configuracion', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  await cargarConfiguracionGlobal();
  alert('Impresora guardada.');
}

async function guardarDatosNegocioConfig() {
  const payload = {
    nombre_negocio: document.getElementById('cfgNombreNegocio').value.trim() || 'CERRAJERÍA EL GALLO',
    subtitulo: document.getElementById('cfgSubtitulo').value.trim(),
  };
  const archivo = document.getElementById('cfgLogoInput').files[0];
  if (archivo) {
    const fd = new FormData();
    fd.append('logo', archivo);
    await fetch('/api/configuracion/logo', { method: 'POST', body: fd });
    document.getElementById('cfgLogoInput').value = '';
  }
  await fetch('/api/configuracion', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  await cargarConfiguracionGlobal();
  document.getElementById('cfgLogoPreview').src = configCache.logo_url || '/img/logo-badge.png';
  alert('Datos del negocio guardados.');
}

async function guardarDatosFiscalesConfig() {
  const payload = {
    responsable_nombre: document.getElementById('cfgResponsableNombre').value.trim(),
    cuit_negocio: document.getElementById('cfgCuitNegocio').value.trim(),
    condicion_fiscal_negocio: document.getElementById('cfgCondicionFiscalNegocio').value.trim(),
    domicilio_negocio: document.getElementById('cfgDomicilioNegocio').value.trim(),
    inicio_actividades: document.getElementById('cfgInicioActividades').value.trim(),
    ingresos_brutos: document.getElementById('cfgIngresosBrutos').value.trim(),
  };
  await fetch('/api/configuracion', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  await cargarConfiguracionGlobal();
  alert('Datos fiscales guardados.');
}

async function guardarNotasTicketConfig() {
  const payload = {
    ticket_encabezado: document.getElementById('cfgTicketEncabezado').value.trim() || null,
    ticket_pie: document.getElementById('cfgTicketPie').value.trim() || null,
  };
  await fetch('/api/configuracion', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  await cargarConfiguracionGlobal();
  alert('Notas del ticket guardadas.');
}

function ticketEncabezadoHtml() {
  const cfg = configCache || {};
  document.getElementById('ticketContenido').style.width = (cfg.impresora_ancho_mm || 80) + 'mm';
  const logo = cfg.logo_url || '/img/logo-badge.png';
  const nombre = cfg.nombre_negocio || 'CERRAJERÍA EL GALLO';
  const sub = cfg.subtitulo ? `<div class="center">${cfg.subtitulo}</div>` : '';
  const nota = cfg.ticket_encabezado ? `<div class="center">${cfg.ticket_encabezado.replace(/\n/g, '<br>')}</div>` : '';
  return `<img src="${logo}" class="ticket-logo" alt="${nombre}"><h4>${nombre}</h4>${sub}${nota}`;
}

function ticketPieHtml() {
  const cfg = configCache || {};
  if (!cfg.ticket_pie) return '';
  return `<hr><div class="center">${cfg.ticket_pie.replace(/\n/g, '<br>')}</div>`;
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeAjuste();
    closeProducto();
    closeFamilia();
    closeCliente();
  }
});

// ============================================================
// SOCKET.IO — sincronización en tiempo real entre terminales
// ============================================================
const socket = io();
socket.on('stock:updated', (producto) => {
  actualizarFilaEnVivo(producto);
  const badge = document.getElementById('liveBadge');
  badge.textContent = 'Actualizado ' + new Date().toLocaleTimeString('es-AR');
  setTimeout(() => (badge.textContent = 'Sincronizado'), 2000);
});
['venta:nueva', 'venta:cobrada', 'venta:anulada', 'venta:actualizada'].forEach((evento) => {
  socket.on(evento, () => {
    const activa = document.querySelector('.screen.active');
    if (!activa) return;
    if (activa.id === 'pendientes') cargarPendientes();
    if (activa.id === 'ventas') cargarVentasHistorial();
    if (activa.id === 'presupuestos') cargarPresupuestos();
    if (activa.id === 'caja') cargarCaja();
  });
});
socket.on('caja:actualizada', () => {
  const activa = document.querySelector('.screen.active');
  if (activa && activa.id === 'caja') cargarCaja();
});

// ============================================================
// SESIÓN / LOGIN POR ROL
// ============================================================
let session = null;
const PANTALLAS_POR_ROL = {
  // Stock queda reservado exclusivamente al puesto STOCK, ni ADMIN lo ve.
  ADMIN: ['dashboard', 'ranking', 'resumen', 'configuracion', 'productos', 'familias', 'clientes', 'pendientes', 'venta', 'ventas', 'presupuestos', 'rendicion', 'caja'],
  CAJA: ['venta', 'pendientes', 'ventas', 'presupuestos', 'clientes', 'caja'],
  VENTA: ['venta', 'pendientes', 'presupuestos', 'clientes'],
  STOCK: ['stock', 'productos'],
};

function cargarSesion() {
  const raw = localStorage.getItem('gallo_session');
  session = raw ? JSON.parse(raw) : null;
}

// El link de recuperar clave solo tiene sentido con ADMIN elegido: los demás
// puestos, si olvidan la clave, la piden a un ADMIN (que se las cambia desde
// Configuración → Usuarios y claves), no tienen recuperación por WhatsApp.
function actualizarLinkOlvideClave() {
  const rol = document.querySelector('.login-role.selected').dataset.rol;
  document.getElementById('linkOlvideClave').style.display = rol === 'ADMIN' ? '' : 'none';
}
document.querySelectorAll('.login-role').forEach((el) =>
  el.addEventListener('click', () => {
    document.querySelectorAll('.login-role').forEach((x) => x.classList.remove('selected'));
    el.classList.add('selected');
    document.getElementById('loginPassword').focus();
    actualizarLinkOlvideClave();
  })
);
actualizarLinkOlvideClave();
document.getElementById('loginPassword').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doLogin();
});

async function doLogin() {
  const rolEl = document.querySelector('.login-role.selected');
  const rol = rolEl.dataset.rol;
  const password = document.getElementById('loginPassword').value;
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rol, password }),
  });
  const data = await res.json();
  if (!res.ok) {
    document.getElementById('loginError').textContent = data.error;
    return;
  }
  session = data;
  localStorage.setItem('gallo_session', JSON.stringify(session));
  document.getElementById('loginPassword').value = '';
  document.getElementById('loginError').textContent = '';
  aplicarSesion();
}

// Recuperar clave sin conocer la vieja: como el sistema no tiene integración
// con la API de WhatsApp Business (paga, requiere aprobación de Meta), no
// puede enviar mensajes por sí solo. En cambio genera un código y abre
// WhatsApp con el texto ya armado para que quien esté en la PC se lo mande
// al teléfono de recuperación configurado en Configuración — mismo truco que
// ya se usa para mandar los tickets.
function abrirOlvideClave(event) {
  event.preventDefault();
  const rolEl = document.querySelector('.login-role.selected');
  document.getElementById('olvideClavePuesto').textContent = 'Puesto: ' + rolEl.dataset.rol;
  document.getElementById('olvideClavePaso1').style.display = 'block';
  document.getElementById('olvideClavePaso2').style.display = 'none';
  document.getElementById('olvideClaveCodigo').value = '';
  document.getElementById('olvideClaveNueva').value = '';
  document.getElementById('olvideClaveError').textContent = '';
  document.getElementById('olvideClaveModal').classList.add('open');
}

function closeOlvideClave() {
  document.getElementById('olvideClaveModal').classList.remove('open');
}

async function enviarCodigoOlvideClave() {
  const rol = document.querySelector('.login-role.selected').dataset.rol;
  const cfg = await (await fetch('/api/configuracion')).json();
  if (!cfg.telefono_recuperacion) {
    document.getElementById('olvideClaveError').textContent = 'No hay un teléfono de recuperación configurado. Pedile al admin que lo cargue en Configuración → Usuarios y claves.';
    return;
  }
  const res = await fetch('/api/usuarios/recuperar/solicitar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rol }),
  });
  const data = await res.json();
  if (!res.ok) {
    document.getElementById('olvideClaveError').textContent = data.error;
    return;
  }
  const texto = `Código para recuperar la clave de ${rol} en EL GALLO POS: ${data.codigo} (vale por 15 minutos)`;
  window.open(`https://wa.me/${telefonoWhatsappCompleto(cfg.telefono_recuperacion)}?text=${encodeURIComponent(texto)}`, '_blank');
  document.getElementById('olvideClavePaso1').style.display = 'none';
  document.getElementById('olvideClavePaso2').style.display = 'block';
  document.getElementById('olvideClaveError').textContent = '';
}

async function confirmarOlvideClave() {
  const rol = document.querySelector('.login-role.selected').dataset.rol;
  const codigo = document.getElementById('olvideClaveCodigo').value.trim();
  const password = document.getElementById('olvideClaveNueva').value.trim();
  if (!codigo || !password) return;
  const res = await fetch('/api/usuarios/recuperar/confirmar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rol, codigo, password }),
  });
  if (!res.ok) {
    const data = await res.json();
    document.getElementById('olvideClaveError').textContent = data.error;
    return;
  }
  closeOlvideClave();
  alert('Clave actualizada. Ya podés ingresar con la clave nueva.');
}

function logout() {
  session = null;
  localStorage.removeItem('gallo_session');
  document.getElementById('loginScreen').style.display = 'flex';
}

function aplicarSesion() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('sessionRoleLabel').textContent = session.rol;
  const permitidas = PANTALLAS_POR_ROL[session.rol];
  document.querySelectorAll('.nav button[data-screen]').forEach((b) => {
    b.style.display = !permitidas || permitidas.includes(b.dataset.screen) ? 'block' : 'none';
  });
  const inicio = session.rol === 'VENTA' ? 'venta' : session.rol === 'CAJA' ? 'pendientes' : session.rol === 'STOCK' ? 'stock' : 'dashboard';
  showScreen(inicio);
}

function actualizarHintVenta() {
  const hint = document.getElementById('ventaHint');
  if (!hint || !session) return;
  hint.textContent =
    session.rol === 'VENTA'
      ? 'En esta terminal, F10 envía la venta a Caja por LAN. No se muestran formas de pago.'
      : 'En esta terminal, F10 abre el cobro directamente.';
  // ADMIN puede cobrar en el momento, pero también puede mandar la venta a
  // Caja por LAN (igual que hace VENTA), en vez de cobrarla ahí mismo.
  const btnEnviarACaja = document.getElementById('btnEnviarACajaVenta');
  if (btnEnviarACaja) btnEnviarACaja.style.display = session.rol === 'ADMIN' ? '' : 'none';
}

async function enviarACajaDesdeVenta() {
  if (!carritoVenta.length) {
    alert('Agregá al menos un producto.');
    return;
  }
  if (ventaPendienteIdEnCurso) {
    const payload = {
      cliente_id: clienteVentaActual ? clienteVentaActual.id : null,
      descuento_general: calcularDescuentoGeneralMonto(),
      items: itemsParaApi(),
    };
    const res = await fetch(`/api/ventas/${ventaPendienteIdEnCurso}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      alert('Error: ' + data.error);
      return;
    }
    if (data.estado !== 'enviada_caja') {
      const res2 = await fetch(`/api/ventas/${ventaPendienteIdEnCurso}/enviar-caja`, { method: 'POST' });
      const data2 = await res2.json();
      if (!res2.ok) {
        alert('Error: ' + data2.error);
        return;
      }
    }
    alert('Venta enviada a Caja por LAN.');
    limpiarCarrito();
    return;
  }
  const payload = {
    cliente_id: clienteVentaActual ? clienteVentaActual.id : null,
    terminal_origen: session.rol,
    usuario_id: session.id,
    estado: 'enviada_caja',
    descuento_general: calcularDescuentoGeneralMonto(),
    items: itemsParaApi(),
    presupuesto_id: presupuestoOrigenId,
  };
  const res = await fetch('/api/ventas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await res.json();
  if (!res.ok) {
    alert('Error: ' + data.error);
    return;
  }
  alert('Venta enviada a Caja por LAN.');
  limpiarCarrito();
}

// ============================================================
// CERRAJEROS (cache global para selects)
// ============================================================
let cerrajerosCache = [];
async function cargarCerrajerosGlobal() {
  const res = await fetch('/api/cerrajeros');
  cerrajerosCache = await res.json();
  const opts = (sel) => {
    const previo = sel.value;
    sel.innerHTML = '<option value="">Sin asignar</option>';
    cerrajerosCache.forEach((c) => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.nombre;
      sel.appendChild(opt);
    });
    if ([...sel.options].some((o) => o.value === previo)) sel.value = previo;
  };
  opts(document.getElementById('ventaCerrajeroDefault'));
  opts(document.getElementById('ventasCerrajero'));
}

// ============================================================
// CERRAJEROS — administración (ABM)
// ============================================================
let cerrajeroEditId = null;

async function cargarCerrajerosAdmin() {
  const res = await fetch('/api/cerrajeros?todos=1');
  const cerrajeros = await res.json();
  const tbody = document.getElementById('cerrajerosBody');
  tbody.innerHTML = '';
  cerrajeros.forEach((c) => tbody.appendChild(filaCerrajero(c)));

  const opts = (sel, conPlaceholder) => {
    const previo = sel.value;
    sel.innerHTML = conPlaceholder ? '<option value="">Todos</option>' : '';
    cerrajeros.filter((c) => c.activo).forEach((c) => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.nombre;
      sel.appendChild(opt);
    });
    if ([...sel.options].some((o) => o.value === previo)) sel.value = previo;
  };
  opts(document.getElementById('rendCerrajero'), false);
  opts(document.getElementById('rendHistCerrajero'), true);
}

function filaCerrajero(c) {
  const tr = document.createElement('tr');
  const estado = c.activo ? '<span class="status s-ok">Activo</span>' : '<span class="status s-bad">Inactivo</span>';
  tr.innerHTML = `
    <td>${c.nombre}</td>
    <td>${c.porcentaje_rendicion}%</td>
    <td>${c.porcentaje_urgencia > 0 ? c.porcentaje_urgencia + '%' : '—'}</td>
    <td>$ ${money.format(c.aporte_fijo)}</td>
    <td>${c.descuento_tarjeta_credito}%</td>
    <td>${estado}</td>
    <td>
      <button class="btn light" onclick="openCerrajero(${c.id})">Editar</button>
      <button class="btn light" onclick="toggleCerrajeroActivo(${c.id}, ${c.activo})">${c.activo ? 'Desactivar' : 'Activar'}</button>
    </td>
  `;
  return tr;
}

async function openCerrajero(id) {
  cerrajeroEditId = id || null;
  document.getElementById('cerrajeroTitulo').textContent = id ? 'Editar cerrajero' : 'Nuevo cerrajero';
  document.getElementById('cerActivoWrap').style.display = id ? 'block' : 'none';
  if (id) {
    const cerrajeros = await (await fetch('/api/cerrajeros?todos=1')).json();
    const c = cerrajeros.find((x) => x.id === id);
    document.getElementById('cerNombre').value = c.nombre;
    document.getElementById('cerPorcentaje').value = c.porcentaje_rendicion;
    document.getElementById('cerPorcentajeUrgencia').value = c.porcentaje_urgencia;
    document.getElementById('cerAporte').value = c.aporte_fijo;
    document.getElementById('cerDescuentoTarjeta').value = c.descuento_tarjeta_credito;
    document.getElementById('cerActivo').checked = !!c.activo;
  } else {
    document.getElementById('cerNombre').value = '';
    document.getElementById('cerPorcentaje').value = 30;
    document.getElementById('cerPorcentajeUrgencia').value = 0;
    document.getElementById('cerAporte').value = 0;
    document.getElementById('cerDescuentoTarjeta').value = 0;
    document.getElementById('cerActivo').checked = true;
  }
  document.getElementById('cerrajeroModal').classList.add('open');
}

function closeCerrajero() {
  document.getElementById('cerrajeroModal').classList.remove('open');
  cerrajeroEditId = null;
}

async function guardarCerrajero() {
  const payload = {
    nombre: document.getElementById('cerNombre').value.trim(),
    porcentaje_rendicion: Number(document.getElementById('cerPorcentaje').value) || 0,
    porcentaje_urgencia: Number(document.getElementById('cerPorcentajeUrgencia').value) || 0,
    aporte_fijo: Number(document.getElementById('cerAporte').value) || 0,
    descuento_tarjeta_credito: Number(document.getElementById('cerDescuentoTarjeta').value) || 0,
    activo: document.getElementById('cerActivo').checked,
  };
  if (!payload.nombre) {
    alert('El nombre es obligatorio.');
    return;
  }
  const url = cerrajeroEditId ? `/api/cerrajeros/${cerrajeroEditId}` : '/api/cerrajeros';
  const method = cerrajeroEditId ? 'PUT' : 'POST';
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await res.json();
  if (!res.ok) {
    alert('Error: ' + data.error);
    return;
  }
  closeCerrajero();
  cargarCerrajerosAdmin();
  cargarCerrajerosGlobal();
}

async function toggleCerrajeroActivo(id, activo) {
  await fetch(`/api/cerrajeros/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ activo: !activo }),
  });
  cargarCerrajerosAdmin();
  cargarCerrajerosGlobal();
}

// ============================================================
// RENDICIÓN DE CERRAJEROS
// ============================================================
let rendicionPreviewActual = null; // { cerrajero_id, fecha_desde, fecha_hasta, detalle, total_bruto, cerrajero }
let rendicionDescuentosExtra = [];

const TIPO_MOVIMIENTO_LABEL = { servicio: 'Servicio', duplicado: 'Duplicado' };
const TIPO_DESCUENTO_LABEL = { aporte: 'Aporte fijo', repuesto: 'Repuesto', otro: 'Otro', adelanto: 'Adelanto' };

async function calcularRendicionPreview() {
  const cerrajero_id = document.getElementById('rendCerrajero').value;
  const fecha_desde = document.getElementById('rendDesde').value;
  const fecha_hasta = document.getElementById('rendHasta').value;
  if (!cerrajero_id || !fecha_desde || !fecha_hasta) {
    alert('Elegí cerrajero, fecha desde y fecha hasta.');
    return;
  }
  const res = await fetch(`/api/rendiciones/preview?cerrajero_id=${cerrajero_id}&fecha_desde=${fecha_desde}&fecha_hasta=${fecha_hasta}`);
  const data = await res.json();
  if (!res.ok) {
    alert('Error: ' + data.error);
    return;
  }
  rendicionPreviewActual = { cerrajero_id, fecha_desde, fecha_hasta, ...data };
  rendicionDescuentosExtra = [];

  document.getElementById('rendPreviewVacio').style.display = data.detalle.length ? 'none' : 'block';
  document.getElementById('rendPreviewWrap').style.display = data.detalle.length ? 'block' : 'none';
  if (!data.detalle.length) return;

  const tbody = document.getElementById('rendPreviewBody');
  tbody.innerHTML = '';
  data.detalle.forEach((d) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${d.venta_numero}</td>
      <td>${new Date(d.cobrado_en).toLocaleDateString('es-AR')}</td>
      <td>${d.codigo || '—'}</td>
      <td>${d.descripcion}</td>
      <td>${TIPO_MOVIMIENTO_LABEL[d.tipo]}</td>
      <td>${d.cantidad}</td>
      <td>$ ${money.format(d.monto_base)}</td>
      <td>${d.porcentaje}%</td>
      <td>$ ${money.format(d.monto_rendido)}</td>
    `;
    tbody.appendChild(tr);
  });
  renderRendicionDescuentos();
}

// Cada gasto se confirma con "Guardar gasto" y pasa a la lista de abajo (ya
// cargado, con su ✕ para sacarlo); el formulario queda vacío y listo para
// cargar el siguiente sin perder los anteriores. Recién al final, "Generar
// rendición" manda todos los gastos ya cargados junto con el resto.
function renderRendicionDescuentos() {
  const cont = document.getElementById('rendDescuentosBody');
  cont.innerHTML = '';
  const aporte = rendicionPreviewActual.cerrajero.aporte_fijo;
  if (aporte > 0) {
    const div = document.createElement('div');
    div.className = 'small';
    div.style.marginBottom = '4px';
    div.textContent = `Aporte fijo: $ ${money.format(aporte)}`;
    cont.appendChild(div);
  }
  if (!rendicionDescuentosExtra.length) {
    const div = document.createElement('div');
    div.className = 'small';
    div.style.marginBottom = '4px';
    div.textContent = 'Sin gastos cargados todavía.';
    cont.appendChild(div);
  }
  rendicionDescuentosExtra.forEach((d, i) => {
    const row = document.createElement('div');
    row.className = 'toolbar';
    row.style.marginBottom = '4px';
    row.innerHTML = `
      <span class="small" style="flex:1">${TIPO_DESCUENTO_LABEL[d.tipo]}${d.descripcion ? ' — ' + d.descripcion : ''}: <b>$ ${money.format(d.monto)}</b></span>
      <button class="btn light" onclick="rendicionDescuentosExtra.splice(${i},1); renderRendicionDescuentos()">✕</button>
    `;
    cont.appendChild(row);
  });
  actualizarTotalesRendicionPreview();
}

function guardarGastoExtraRendicion() {
  const tipo = document.getElementById('rendGastoTipo').value;
  const descripcion = document.getElementById('rendGastoDescripcion').value.trim();
  const monto = Number(document.getElementById('rendGastoMonto').value) || 0;
  if (monto <= 0) {
    alert('El monto tiene que ser mayor a 0.');
    return;
  }
  rendicionDescuentosExtra.push({ tipo, descripcion, monto });
  document.getElementById('rendGastoDescripcion').value = '';
  document.getElementById('rendGastoMonto').value = '';
  renderRendicionDescuentos();
}

// El aporte se descuenta a valor completo; los gastos (repuesto/adelanto/otro)
// reducen la base ANTES de aplicar el % de rendición del cerrajero, así que
// se restan del bruto ya escalados a ese mismo % (ver nota en
// rendiciones.service.js calcularTotalDescuentos, misma cuenta en el server).
function actualizarTotalesRendicionPreview() {
  const total_bruto = rendicionPreviewActual.total_bruto;
  const pct = rendicionPreviewActual.cerrajero.porcentaje_rendicion;
  const aporte = rendicionPreviewActual.cerrajero.aporte_fijo || 0;
  const gastos = rendicionDescuentosExtra.reduce((s, d) => s + (Number(d.monto) || 0), 0);
  const total_descuentos = aporte + gastos * (pct / 100);
  const total_pagar = roundUpTo100(total_bruto - total_descuentos);
  document.getElementById('rendTotalBruto').textContent = '$ ' + money.format(total_bruto);
  document.getElementById('rendTotalDescuentos').textContent = '$ ' + money.format(total_descuentos);
  document.getElementById('rendTotalPagar').textContent = '$ ' + money.format(total_pagar);
}

async function generarRendicion() {
  if (!rendicionPreviewActual) return;
  const payload = {
    cerrajero_id: rendicionPreviewActual.cerrajero_id,
    fecha_desde: rendicionPreviewActual.fecha_desde,
    fecha_hasta: rendicionPreviewActual.fecha_hasta,
    descuentos_extra: rendicionDescuentosExtra.filter((d) => d.monto > 0),
  };
  const res = await fetch('/api/rendiciones', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    alert('Error: ' + data.error);
    return;
  }
  rendicionPreviewActual = null;
  rendicionDescuentosExtra = [];
  document.getElementById('rendPreviewWrap').style.display = 'none';
  document.getElementById('rendPreviewVacio').style.display = 'none';
  cargarRendiciones();
  mostrarTicketRendicion(data.id);
}

async function cargarRendiciones() {
  const cerrajero_id = document.getElementById('rendHistCerrajero').value;
  const estado = document.getElementById('rendHistEstado').value;
  const params = new URLSearchParams();
  if (cerrajero_id) params.set('cerrajero_id', cerrajero_id);
  if (estado) params.set('estado', estado);
  const res = await fetch(`/api/rendiciones?${params}`);
  const rendiciones = await res.json();
  const tbody = document.getElementById('rendicionesBody');
  tbody.innerHTML = '';
  rendiciones.forEach((r) => tbody.appendChild(filaRendicion(r)));
}

function filaRendicion(r) {
  const tr = document.createElement('tr');
  const estado = r.estado === 'pagada' ? '<span class="status s-ok">Pagada</span>' : '<span class="status s-warn">Generada</span>';
  const acciones = [`<button class="btn light" onclick="verDetalleRendicion(${r.id})">Ver</button>`];
  if (r.estado === 'generada') {
    acciones.push(`<button class="btn light" onclick="marcarRendicionPagada(${r.id})">Marcar pagada</button>`);
    acciones.push(`<button class="btn light" onclick="anularRendicion(${r.id})">Anular</button>`);
  }
  tr.innerHTML = `
    <td>${r.cerrajero_nombre}</td>
    <td>${r.fecha_desde} a ${r.fecha_hasta}</td>
    <td>$ ${money.format(r.total_bruto)}</td>
    <td>$ ${money.format(r.total_descuentos)}</td>
    <td>$ ${money.format(r.total_pagar)}</td>
    <td>${estado}</td>
    <td>${acciones.join(' ')}</td>
  `;
  return tr;
}

let rendicionDetalleActualId = null;
let rendicionDetalleActualCerrajeroId = null;

async function verDetalleRendicion(id) {
  const r = await (await fetch(`/api/rendiciones/${id}`)).json();
  rendicionDetalleActualId = id;
  rendicionDetalleActualCerrajeroId = r.cerrajero_id;
  document.getElementById('rendDetalleTitulo').textContent = `${r.cerrajero_nombre} — ${r.fecha_desde} a ${r.fecha_hasta}`;
  const editable = r.estado === 'generada';
  const filasDetalle = r.detalle
    .map(
      (d) => `<tr>
        <td>${d.venta_numero || '—'}</td><td>${d.codigo || '—'}</td><td>${d.descripcion}</td><td>${TIPO_MOVIMIENTO_LABEL[d.tipo]}</td>
        <td>${d.cantidad}</td><td>$ ${money.format(d.monto_base)}</td><td>${d.porcentaje}%</td><td>$ ${money.format(d.monto_rendido)}</td>
        <td>${editable ? `<button class="btn light" onclick="quitarLineaRendicion(${id}, ${d.id})">✕</button>` : ''}</td>
      </tr>`
    )
    .join('');
  const filasDescuentos = r.descuentos
    .map(
      (d) => `<tr>
        <td>${TIPO_DESCUENTO_LABEL[d.tipo]}</td><td>${d.descripcion || '—'}</td><td>$ ${money.format(d.monto)}</td>
        <td>${editable ? `<button class="btn light" onclick="quitarDescuentoRendicion(${id}, ${d.id})">✕</button>` : ''}</td>
      </tr>`
    )
    .join('');
  document.getElementById('rendDetalleContenido').innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Venta</th><th>Código</th><th>Descripción</th><th>Tipo</th><th>Cant.</th><th>Base</th><th>%</th><th>Rinde</th><th></th></tr></thead>
        <tbody>${filasDetalle}</tbody>
      </table>
    </div>
    ${
      editable
        ? `<div class="toolbar" style="margin-top:8px"><button class="btn light" onclick="mostrarFormAgregarLineaRendicion()">+ Agregar línea</button></div>
           <div id="rendAgregarLineaForm" style="display:none;margin-top:8px"></div>`
        : ''
    }
    <div class="table-wrap" style="margin-top:10px">
      <table>
        <thead><tr><th>Descuento</th><th>Descripción</th><th>Monto</th><th></th></tr></thead>
        <tbody>${filasDescuentos || '<tr><td colspan="4">Sin descuentos</td></tr>'}</tbody>
      </table>
    </div>
    ${
      editable
        ? `<div class="toolbar" style="margin-top:8px"><button class="btn light" onclick="mostrarFormAgregarDescuentoRendicion()">+ Agregar gasto</button></div>
           <div id="rendAgregarDescuentoForm" style="display:none;margin-top:8px"></div>`
        : ''
    }
    <div class="small" style="text-align:right;margin-top:10px">
      <div>Total bruto: <b>$ ${money.format(r.total_bruto)}</b></div>
      <div>Total descuentos: <b>$ ${money.format(r.total_descuentos)}</b></div>
      <div style="font-size:16px">Total a pagar: <b>$ ${money.format(r.total_pagar)}</b></div>
    </div>
  `;
  document.getElementById('rendicionDetalleModal').classList.add('open');
}

function mostrarFormAgregarDescuentoRendicion() {
  const cont = document.getElementById('rendAgregarDescuentoForm');
  cont.style.display = 'block';
  cont.innerHTML = `
    <div class="two-col-form">
      <div class="field"><label>Tipo</label>
        <select id="rdTipo">
          <option value="repuesto">Repuesto</option>
          <option value="adelanto">Adelanto</option>
          <option value="otro">Otro</option>
        </select>
      </div>
      <div class="field"><label>Descripción</label><input id="rdDescripcion"></div>
      <div class="field"><label>Monto</label><input id="rdMonto" type="number" step="any" value="0"></div>
    </div>
    <div class="toolbar" style="margin-top:8px">
      <button class="btn primary" onclick="confirmarAgregarDescuentoRendicion()">Agregar</button>
      <button class="btn outline" onclick="document.getElementById('rendAgregarDescuentoForm').style.display='none'">Cancelar</button>
    </div>
  `;
}

async function confirmarAgregarDescuentoRendicion() {
  const payload = {
    tipo: document.getElementById('rdTipo').value,
    descripcion: document.getElementById('rdDescripcion').value.trim(),
    monto: Number(document.getElementById('rdMonto').value) || 0,
  };
  if (payload.monto <= 0) {
    alert('El monto tiene que ser mayor a 0.');
    return;
  }
  const res = await fetch(`/api/rendiciones/${rendicionDetalleActualId}/descuentos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    alert('Error: ' + data.error);
    return;
  }
  verDetalleRendicion(rendicionDetalleActualId);
  cargarRendiciones();
}

async function quitarDescuentoRendicion(rendicionId, descuentoId) {
  const res = await fetch(`/api/rendiciones/${rendicionId}/descuentos/${descuentoId}`, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) {
    alert('Error: ' + data.error);
    return;
  }
  verDetalleRendicion(rendicionId);
  cargarRendiciones();
}

function closeRendicionDetalle() {
  document.getElementById('rendicionDetalleModal').classList.remove('open');
  rendicionDetalleActualId = null;
  rendicionDetalleActualCerrajeroId = null;
}

// Precios de referencia de trabajos de codificados (autos): el cerrajero
// suele hacer estos trabajos sueltos, sin pasar por una venta de mostrador.
// Elegir uno acá solo autocompleta descripción y precio — como cualquier
// línea manual, quedan editables antes de tocar "Agregar" (los precios de
// esta lista cambian de tanto en tanto y no siempre coinciden con lo cobrado).
const CATALOGO_CODIFICADOS = [
  { descripcion: 'Pilas', precio: 750 },
  { descripcion: 'Portón control', precio: 1670 },
  { descripcion: 'Pulsadores', precio: 1645 },
  { descripcion: 'K común', precio: 2495 },
  { descripcion: 'K Sevillana', precio: 3450 },
  { descripcion: 'K Sevillana especial', precio: 6325 },
  { descripcion: 'Reparación', precio: 0 },
  { descripcion: 'Alojamiento', precio: 6440 },
  { descripcion: 'Copia con transponder', precio: 12305 },
  { descripcion: 'Transponder', precio: 8050 },
  { descripcion: 'KD-Horse', precio: 18800 },
  { descripcion: '0 llaves especiales', precio: 37145 },
  { descripcion: '0 llaves', precio: 20872 },
  { descripcion: 'Presencia', precio: 39100 },
  { descripcion: 'Cranteado Yale', precio: 6150 },
  { descripcion: 'Cranteado Mapa', precio: 8165 },
  { descripcion: 'Copia oferta', precio: 8500 },
  { descripcion: 'Reparación mando especial', precio: 10070 },
  { descripcion: 'KD oferta', precio: 13800 },
];

function mostrarFormAgregarLineaRendicion() {
  const cerrajero = cerrajerosCache.find((c) => c.id === rendicionDetalleActualCerrajeroId);
  const cont = document.getElementById('rendAgregarLineaForm');
  cont.style.display = 'block';
  const opcionesCodificados = CATALOGO_CODIFICADOS.map(
    (c, i) => `<option value="${i}">${c.descripcion} — $ ${money.format(c.precio)}</option>`
  ).join('');
  cont.innerHTML = `
    <div class="field" style="margin-bottom:8px">
      <label>Codificados (elegí para autocompletar; podés editar precio y cantidad después)</label>
      <select id="rlCodificado" onchange="elegirCodificadoRendicion(this.value)">
        <option value="">— Elegir trabajo de codificados —</option>
        ${opcionesCodificados}
      </select>
    </div>
    <div class="two-col-form">
      <div class="field"><label>Tipo</label>
        <select id="rlTipo"><option value="servicio">Servicio</option><option value="duplicado">Duplicado</option></select>
      </div>
      <div class="field"><label>Código (opcional)</label><input id="rlCodigo" placeholder="Ej: 1001"></div>
      <div class="field"><label>Descripción</label><input id="rlDescripcion"></div>
      <div class="field"><label>Cantidad</label><input id="rlCantidad" type="number" step="any" value="1"></div>
      <div class="field"><label>Precio unitario (base)</label><input id="rlPrecioUnitario" type="number" step="any" value="0"></div>
      <div class="field"><label>% Rendición</label><input id="rlPorcentaje" type="number" step="any" value="${cerrajero ? cerrajero.porcentaje_rendicion : 30}"></div>
    </div>
    <div class="toolbar" style="margin-top:8px">
      <button class="btn primary" onclick="confirmarAgregarLineaRendicion()">Agregar</button>
      <button class="btn outline" onclick="document.getElementById('rendAgregarLineaForm').style.display='none'">Cancelar</button>
    </div>
  `;
}

function elegirCodificadoRendicion(idx) {
  if (idx === '') return;
  const item = CATALOGO_CODIFICADOS[Number(idx)];
  document.getElementById('rlTipo').value = 'duplicado';
  document.getElementById('rlDescripcion').value = item.descripcion;
  document.getElementById('rlPrecioUnitario').value = item.precio;
  const cantidad = document.getElementById('rlCantidad');
  cantidad.focus();
  cantidad.select();
}

async function confirmarAgregarLineaRendicion() {
  const payload = {
    tipo: document.getElementById('rlTipo').value,
    codigo: document.getElementById('rlCodigo').value.trim(),
    descripcion: document.getElementById('rlDescripcion').value.trim(),
    cantidad: Number(document.getElementById('rlCantidad').value) || 1,
    precio_unitario: Number(document.getElementById('rlPrecioUnitario').value) || 0,
    porcentaje: Number(document.getElementById('rlPorcentaje').value) || 0,
  };
  if (!payload.descripcion) {
    alert('La descripción es obligatoria.');
    return;
  }
  const res = await fetch(`/api/rendiciones/${rendicionDetalleActualId}/detalle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    alert('Error: ' + data.error);
    return;
  }
  verDetalleRendicion(rendicionDetalleActualId);
  cargarRendiciones();
}

async function quitarLineaRendicion(rendicionId, detalleId) {
  const res = await fetch(`/api/rendiciones/${rendicionId}/detalle/${detalleId}`, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) {
    alert('Error: ' + data.error);
    return;
  }
  verDetalleRendicion(rendicionId);
  cargarRendiciones();
}

async function imprimirRendicionActual() {
  if (!rendicionDetalleActualId) return;
  await mostrarTicketRendicion(rendicionDetalleActualId);
  closeRendicionDetalle();
}

function editarRendicionDesdeTicket() {
  if (!ultimoDocumentoParaTicket || ultimoDocumentoParaTicket.tipo !== 'rendicion') return;
  const id = ultimoDocumentoParaTicket.data.id;
  showScreen('rendicion');
  verDetalleRendicion(id);
}

// La rendición tiene tablas con bastantes columnas (código, base, %, rinde);
// en el ticket térmico angosto (80mm) se desbordaba y perdía los márgenes,
// así que siempre se muestra en formato A4 (como una hoja de comprobante),
// nunca como ticket térmico.
function construirRendicionA4Html(r) {
  const cfg = configCache || {};
  const logo = cfg.logo_url || '/img/logo-badge.png';
  const nombreNegocio = cfg.nombre_negocio || 'CERRAJERÍA EL GALLO';
  const fecha = new Date(r.creado_en).toLocaleString('es-AR');

  const duplicados = r.detalle.filter((d) => d.tipo === 'duplicado');
  const servicios = r.detalle.filter((d) => d.tipo === 'servicio');

  const grupos = {};
  duplicados.forEach((d) => {
    if (!grupos[d.descripcion]) grupos[d.descripcion] = { descripcion: d.descripcion, cantidad: 0, monto_rendido: 0 };
    grupos[d.descripcion].cantidad += Number(d.cantidad) || 0;
    grupos[d.descripcion].monto_rendido += d.monto_rendido;
  });
  const filasDuplicados = Object.values(grupos)
    .map((g) => {
      const base = g.cantidad ? Math.round(g.monto_rendido / g.cantidad) : g.monto_rendido;
      return `<tr><td>${g.descripcion}</td><td class="a4-num">${g.cantidad}</td><td class="a4-num">$${money.format(base)}</td><td class="a4-num">$${money.format(g.monto_rendido)}</td></tr>`;
    })
    .join('');

  const filasServicios = servicios
    .map(
      (d) =>
        `<tr><td>${d.codigo || ''}</td><td>${d.descripcion}</td><td class="a4-num">${d.cantidad}</td><td class="a4-num">$${money.format(d.monto_base)}</td><td class="a4-num">${d.porcentaje}%</td><td class="a4-num">$${money.format(d.monto_rendido)}</td></tr>`
    )
    .join('');

  const filasDescuentos = r.descuentos
    .map(
      (d) =>
        `<tr><td>${TIPO_DESCUENTO_LABEL[d.tipo]}</td><td>${d.descripcion || ''}</td><td class="a4-num">$${money.format(d.monto)}</td></tr>`
    )
    .join('');

  return `
    <div class="a4-top">
      <div class="a4-empresa">
        <h2>${nombreNegocio}</h2>
        ${cfg.responsable_nombre ? `<div>${cfg.responsable_nombre}</div>` : ''}
        ${cfg.domicilio_negocio ? `<div>Domicilio: ${cfg.domicilio_negocio}</div>` : ''}
        <img src="${logo}" alt="${nombreNegocio}">
      </div>
      <div class="a4-tipo-box">R</div>
      <div class="a4-doc-info">
        <div class="a4-muted">${r.estado === 'pagada' ? 'PAGADA' : 'GENERADA'}</div>
        <div class="a4-doc-numero">Rendición N° ${r.id}</div>
        <div>Fecha: ${fecha}</div>
      </div>
    </div>
    <div class="a4-datos">
      <p><b>Cerrajero:</b> ${r.cerrajero_nombre}</p>
      <p><b>Período:</b> ${r.fecha_desde} a ${r.fecha_hasta}</p>
    </div>
    ${
      filasDuplicados
        ? `<h3 style="margin:14px 0 6px;font-size:13px">Duplicados</h3>
    <table class="a4-tabla">
      <thead><tr><th>Descripción</th><th>Cant.</th><th>Base</th><th>Total</th></tr></thead>
      <tbody>${filasDuplicados}</tbody>
    </table>`
        : ''
    }
    ${
      filasServicios
        ? `<h3 style="margin:14px 0 6px;font-size:13px">Servicios</h3>
    <table class="a4-tabla">
      <thead><tr><th>Código</th><th>Descripción</th><th>Cant.</th><th>Base</th><th>%</th><th>Rinde</th></tr></thead>
      <tbody>${filasServicios}</tbody>
    </table>`
        : ''
    }
    ${
      filasDescuentos
        ? `<h3 style="margin:14px 0 6px;font-size:13px">Descuentos</h3>
    <table class="a4-tabla">
      <thead><tr><th>Tipo</th><th>Descripción</th><th>Monto</th></tr></thead>
      <tbody>${filasDescuentos}</tbody>
    </table>`
        : ''
    }
    <div class="a4-abajo">
      <div class="a4-observaciones">Observaciones / Firma</div>
      <div style="display:flex;flex-direction:column;gap:6px">
        <div class="a4-total">TOTAL BRUTO<br>$${money.format(r.total_bruto)}</div>
        <div class="a4-total">TOTAL DESCUENTOS<br>$${money.format(r.total_descuentos)}</div>
        <div class="a4-total">TOTAL A PAGAR<br>$${money.format(r.total_pagar)}</div>
      </div>
    </div>
    ${cfg.ticket_pie ? `<p class="a4-muted">${cfg.ticket_pie.replace(/\n/g, '<br>')}</p>` : ''}
    <p class="a4-muted a4-impreso">Impreso: ${new Date().toLocaleDateString('es-AR')}</p>
  `;
}

async function mostrarTicketRendicion(id) {
  await cargarConfiguracionGlobal();
  const r = await (await fetch(`/api/rendiciones/${id}`)).json();
  ultimoDocumentoParaTicket = { tipo: 'rendicion', data: r };
  document.getElementById('btnEnviarImagenWhatsapp').style.display = 'none';
  document.getElementById('btnEnviarImagenA4Whatsapp').style.display = '';
  document.getElementById('btnImprimirA4').style.display = 'none';
  document.getElementById('btnEditarTicketRendicion').style.display = r.estado === 'generada' ? '' : 'none';
  document.getElementById('btnEditarTicketCierre').style.display = 'none';
  mostrarTicketComoA4(construirRendicionA4Html(r));
  showScreen('ticket-screen');
}

async function marcarRendicionPagada(id) {
  const res = await fetch(`/api/rendiciones/${id}/pagar`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ terminal: session.rol, usuario_id: session.id }),
  });
  const data = await res.json();
  if (!res.ok) {
    alert('Error: ' + data.error);
    return;
  }
  cargarRendiciones();
}

async function anularRendicion(id) {
  const res = await fetch(`/api/rendiciones/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const data = await res.json();
    alert('Error: ' + data.error);
    return;
  }
  cargarRendiciones();
}

// ============================================================
// VENTA — carrito
// ============================================================
let carritoVenta = [];
let tipoPrecioGlobal = 'final';
let clienteVentaActual = null; // null = Consumidor Final
let ventaPendienteIdEnCurso = null;

async function buscarProductoVenta() {
  const q = document.getElementById('ventaBuscar').value.trim();
  const cont = document.getElementById('ventaBuscarResultados');
  if (!q) {
    cont.style.display = 'none';
    return;
  }
  const res = await fetch('/api/productos?q=' + encodeURIComponent(q));
  const rows = await res.json();
  if (!rows.length) {
    cont.innerHTML = '<div class="small">Sin resultados.</div>';
    cont.style.display = 'block';
    return;
  }
  cont.innerHTML = '';
  const cerrar = () => {
    document.getElementById('ventaBuscar').value = '';
    cont.style.display = 'none';
  };
  rows.forEach((p) => {
    const div = document.createElement('div');
    div.className = 'search-result-item';
    if (p.usa_mano_obra) {
      div.innerHTML = `<div><b>${p.codigo}</b> — ${p.descripcion} <span class="small">(mano de obra + recargos)</span></div>`;
      div.onclick = () => {
        agregarProductoACarrito(p);
        cerrar();
      };
    } else {
      const stockTxt = `<span class="status ${filaStockClase(p)}">Stock: ${money.format(p.stock_actual)}</span>`;
      const otrosPrecios = p.usa_precio_rendicion
        ? ''
        : `<span>Déb/Transf: $ ${money.format(p.precio_debito)}</span><span>Efectivo: $ ${money.format(p.precio_efectivo)}</span>`;
      div.innerHTML = `
        <div><b>${p.codigo}</b> — ${p.descripcion} — <b>$ ${money.format(p.precio_final)}</b></div>
        <div class="sr-legend">${otrosPrecios}${stockTxt}</div>`;
      div.onclick = () => {
        agregarProductoACarrito(p, 'final');
        cerrar();
      };
    }
    cont.appendChild(div);
  });
  inicializarItemsBuscador('ventaBuscarResultados');
  cont.style.display = 'block';
}
// Navegación por teclado (↑/↓) y mouse en las listas de resultados de búsqueda:
// buscadorIndices guarda, por cada contenedor de resultados, cuál está resaltado.
const buscadorIndices = {};

function resaltarBuscadorItem(contenedorId, indice) {
  const items = [...document.getElementById(contenedorId).querySelectorAll('.search-result-item')];
  items.forEach((el) => el.classList.remove('activo'));
  const i = Math.max(items.length ? 0 : -1, Math.min(indice, items.length - 1));
  buscadorIndices[contenedorId] = i;
  if (i >= 0) {
    items[i].classList.add('activo');
    items[i].scrollIntoView({ block: 'nearest' });
  }
}

// Llamar después de armar los resultados: engancha el hover del mouse para que
// sincronice con el resaltado de teclado, y deja resaltado el primero (así Enter
// directo, sin tocar nada más, ya selecciona algo).
function inicializarItemsBuscador(contenedorId) {
  const items = [...document.getElementById(contenedorId).querySelectorAll('.search-result-item')];
  items.forEach((el, i) => el.addEventListener('mouseenter', () => resaltarBuscadorItem(contenedorId, i)));
  resaltarBuscadorItem(contenedorId, 0);
}

function moverBuscadorIndice(contenedorId, delta) {
  resaltarBuscadorItem(contenedorId, (buscadorIndices[contenedorId] ?? -1) + delta);
}

function elegirResultadoConEnter(contenedorId) {
  const items = [...document.getElementById(contenedorId).querySelectorAll('.search-result-item')];
  items[buscadorIndices[contenedorId]]?.click();
}

document.getElementById('ventaBuscar').addEventListener('input', buscarProductoVenta);
document.getElementById('ventaBuscar').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') document.getElementById('ventaBuscarResultados').style.display = 'none';
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    moverBuscadorIndice('ventaBuscarResultados', 1);
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    moverBuscadorIndice('ventaBuscarResultados', -1);
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    elegirResultadoConEnter('ventaBuscarResultados');
  }
});
document.addEventListener('click', (e) => {
  const cont = document.getElementById('ventaBuscarResultados');
  if (cont && !e.target.closest('.search-big')) cont.style.display = 'none';
});

let botoneraCache = [];
let botoneraFamiliaActiva = 'todas';

async function cargarBotoneraVenta() {
  botoneraCache = await (await fetch('/api/productos?favorito=true')).json();
  const familias = [...new Set(botoneraCache.map((p) => p.familia))];
  if (botoneraFamiliaActiva !== 'todas' && !familias.includes(botoneraFamiliaActiva)) {
    botoneraFamiliaActiva = 'todas';
  }
  renderBotoneraTabs(familias);
  renderBotoneraVenta();
}

function renderBotoneraTabs(familias) {
  const cont = document.getElementById('ventaBotoneraTabs');
  if (!cont) return;
  if (familias.length <= 1) {
    cont.innerHTML = '';
    return;
  }
  const tabs = ['todas', ...familias];
  cont.innerHTML = tabs
    .map(
      (f) =>
        `<button class="${botoneraFamiliaActiva === f ? 'active' : ''}" onclick="cambiarBotoneraFamilia(this.dataset.f)" data-f="${f.replace(/"/g, '&quot;')}">${f === 'todas' ? 'Todas' : f}</button>`
    )
    .join('');
}

function cambiarBotoneraFamilia(f) {
  botoneraFamiliaActiva = f;
  renderBotoneraTabs([...new Set(botoneraCache.map((p) => p.familia))]);
  renderBotoneraVenta();
}

let botoneraOrdenando = false;

function toggleOrdenarBotonera() {
  botoneraOrdenando = !botoneraOrdenando;
  botoneraSeleccionado = null;
  document.getElementById('btnOrdenarBotonera').classList.toggle('active-ordenar', botoneraOrdenando);
  document.getElementById('btnOrdenarBotonera').textContent = botoneraOrdenando ? '✔ Listo' : '✎ Ordenar';
  renderBotoneraVenta();
}

// En modo "Ordenar": click derecho elige un botón (se marca), y click
// izquierdo sobre otro botón los intercambia de lugar — más rápido que
// mover de a un paso con flechas cuando hay que llevar un botón lejos.
let botoneraSeleccionado = null;

function renderBotoneraVenta() {
  const cont = document.getElementById('ventaBotonera');
  if (!cont) return;
  const rows = botoneraFamiliaActiva === 'todas' ? botoneraCache : botoneraCache.filter((p) => p.familia === botoneraFamiliaActiva);
  cont.innerHTML = '';
  if (!rows.length) {
    cont.innerHTML = '<p class="small">Marcá productos como favoritos (⭐) desde Productos para que aparezcan acá.</p>';
    return;
  }
  rows.forEach((p) => {
    const div = document.createElement('div');
    const precioTxt = p.usa_mano_obra ? 'Servicio' : '$ ' + money.format(p.precio_final);
    div.innerHTML = `<b>${p.codigo}</b><span>${p.descripcion}</span><small>${precioTxt}</small>`;
    if (botoneraOrdenando) {
      div.className = 'botonera-btn' + (p.id === botoneraSeleccionado ? ' seleccionado' : '');
      div.title = 'Click derecho: elegir este botón. Click izquierdo sobre otro: intercambiar lugares.';
      div.oncontextmenu = (e) => {
        e.preventDefault();
        seleccionarBotoneraOrden(p.id);
      };
      div.onclick = () => intercambiarBotoneraOrden(p.id);
    } else {
      div.className = 'botonera-btn';
      div.onclick = () => agregarProductoACarrito(p);
    }
    cont.appendChild(div);
  });
}

function seleccionarBotoneraOrden(id) {
  botoneraSeleccionado = botoneraSeleccionado === id ? null : id;
  renderBotoneraVenta();
}

async function intercambiarBotoneraOrden(id) {
  if (!botoneraSeleccionado || botoneraSeleccionado === id) {
    botoneraSeleccionado = null;
    renderBotoneraVenta();
    return;
  }
  const rows = botoneraFamiliaActiva === 'todas' ? botoneraCache : botoneraCache.filter((p) => p.familia === botoneraFamiliaActiva);
  const idxA = rows.findIndex((p) => p.id === botoneraSeleccionado);
  const idxB = rows.findIndex((p) => p.id === id);
  botoneraSeleccionado = null;
  if (idxA === -1 || idxB === -1) {
    renderBotoneraVenta();
    return;
  }
  [rows[idxA], rows[idxB]] = [rows[idxB], rows[idxA]];
  if (botoneraFamiliaActiva !== 'todas') {
    // Reinserta el subconjunto reordenado en su lugar dentro de la lista completa.
    const otras = botoneraCache.filter((p) => p.familia !== botoneraFamiliaActiva);
    botoneraCache = [...otras, ...rows];
  } else {
    botoneraCache = rows;
  }
  renderBotoneraVenta();
  await fetch('/api/productos/orden-botonera', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orden: rows.map((p) => p.id) }),
  });
}

// Familias como CODIFICADOS tienen pregunta_pila=1: antes de agregarlos al
// carrito se pregunta si se usó una pila (para descontarla del stock aparte,
// sin cobrarla). Los productos que son ellos mismos una pila (es_pila=1)
// quedan afuera de la pregunta — no tiene sentido preguntarle a una pila si
// usa pila.
let pilaDialogoPendiente = null;

function agregarProductoACarrito(p, tipoElegido) {
  if (p.pregunta_pila && !p.es_pila) {
    mostrarDialogoPila(p, tipoElegido);
    return;
  }
  agregarProductoACarritoInterno(p, tipoElegido, null);
}

function mostrarDialogoPila(p, tipoElegido) {
  pilaDialogoPendiente = { p, tipoElegido };
  document.getElementById('pilaModalProducto').textContent = p.descripcion;
  document.getElementById('pilaModalPreguntaWrap').style.display = 'flex';
  document.getElementById('pilaModalSeleccionWrap').style.display = 'none';
  document.getElementById('pilaModal').classList.add('open');
}

function cancelarDialogoPila() {
  pilaDialogoPendiente = null;
  document.getElementById('pilaModal').classList.remove('open');
}

function responderUsaPila(usa) {
  if (!pilaDialogoPendiente) return;
  if (!usa) {
    const { p, tipoElegido } = pilaDialogoPendiente;
    pilaDialogoPendiente = null;
    document.getElementById('pilaModal').classList.remove('open');
    agregarProductoACarritoInterno(p, tipoElegido, null);
    return;
  }
  cargarSelectPilas();
  document.getElementById('pilaModalPreguntaWrap').style.display = 'none';
  document.getElementById('pilaModalSeleccionWrap').style.display = 'block';
}

async function cargarSelectPilas() {
  const sel = document.getElementById('pilaModalSelect');
  sel.innerHTML = '<option value="">Cargando…</option>';
  const pilas = await (await fetch('/api/productos?es_pila=true')).json();
  if (!pilas.length) {
    sel.innerHTML = '<option value="">No hay ningún producto marcado como "Es una pila" — cargalo en Productos</option>';
    return;
  }
  sel.innerHTML = pilas.map((pila) => `<option value="${pila.id}">${pila.descripcion} (stock: ${pila.stock_actual})</option>`).join('');
}

function confirmarPilaSeleccionada() {
  if (!pilaDialogoPendiente) return;
  const pilaId = Number(document.getElementById('pilaModalSelect').value);
  if (!pilaId) {
    alert('Elegí qué pila se usó.');
    return;
  }
  const { p, tipoElegido } = pilaDialogoPendiente;
  pilaDialogoPendiente = null;
  document.getElementById('pilaModal').classList.remove('open');
  agregarProductoACarritoInterno(p, tipoElegido, pilaId);
}

function agregarProductoACarritoInterno(p, tipoElegido, pilaProductoId) {
  const cerrajeroDefault = document.getElementById('ventaCerrajeroDefault').value || null;
  if (p.usa_mano_obra) {
    carritoVenta.push({
      producto_id: p.id,
      descripcion: p.descripcion,
      cantidad: 1,
      es_servicio: true,
      recargos_mano_obra: p.recargos_mano_obra || '',
      descuento_debito_servicio: Number(p.descuento_debito) || 0,
      monto_mano_obra: 0,
      precio_unitario: 0,
      descuento_pct: 0,
      tipo_precio: tipoElegido || 'final',
      cerrajero_id: cerrajeroDefault,
      pila_producto_id: pilaProductoId,
    });
  } else if (p.usa_precio_rendicion) {
    carritoVenta.push({
      producto_id: p.id,
      descripcion: p.descripcion,
      cantidad: 1,
      es_servicio: false,
      precio_unico: true,
      precios: { final: p.precio_final, debito: p.precio_final, efectivo: p.precio_final },
      precio_unitario: p.precio_final,
      tipo_precio: 'final',
      descuento_pct: 0,
      cerrajero_id: cerrajeroDefault,
      pila_producto_id: pilaProductoId,
    });
  } else {
    const tipo = tipoElegido || tipoPrecioGlobal;
    carritoVenta.push({
      producto_id: p.id,
      descripcion: p.descripcion,
      cantidad: 1,
      es_servicio: false,
      precios: { final: p.precio_final, debito: p.precio_debito, efectivo: p.precio_efectivo },
      precio_unitario: p.precios ? p.precios[tipo] : p[`precio_${tipo}`],
      tipo_precio: tipo,
      descuento_pct: 0,
      cerrajero_id: cerrajeroDefault,
      pila_producto_id: pilaProductoId,
    });
  }
  renderVenta();
}

function calcularPrecioServicio(item) {
  const recargos = (item.recargos_mano_obra || '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n !== 0);
  const factor = recargos.reduce((acc, pct) => acc * (1 + pct / 100), 1);
  return roundUpTo100((Number(item.monto_mano_obra) || 0) * factor);
}

function calcularPreciosServicio(item) {
  const final = calcularPrecioServicio(item);
  const debitoPct = Math.min(100, Math.max(0, Number(item.descuento_debito_servicio) || 0));
  const debito = roundUpTo100(final * (1 - debitoPct / 100));
  const efectivo = roundUpTo100(Number(item.monto_mano_obra) || 0);
  return { final, debito, efectivo };
}

function calcularSubtotalLinea(it) {
  const bruto = it.precio_unitario * it.cantidad;
  const descPct = Math.min(100, Math.max(0, Number(it.descuento_pct) || 0));
  return bruto - bruto * (descPct / 100);
}

function renderVenta() {
  const tbody = document.getElementById('ventaBody');
  tbody.innerHTML = '';
  carritoVenta.forEach((it, i) => {
    if (it.es_servicio && it.tipo_precio !== 'manual') {
      it.precio_unitario = calcularPreciosServicio(it)[it.tipo_precio];
    }
    const subtotal = calcularSubtotalLinea(it);
    const tr = document.createElement('tr');
    const descripcionCell = it.es_servicio
      ? `<input value="${it.descripcion}" style="width:170px" oninput="cambiarDescripcionLinea(${i}, this.value)">`
      : `<b>${it.descripcion}</b>`;
    const precioCell = it.es_servicio
      ? `<div class="line-price-choice">
           <button class="${it.tipo_precio === 'final' ? 'active' : ''}" onclick="elegirPrecioServicioLinea(${i},'final')">F</button>
           <button class="${it.tipo_precio === 'debito' ? 'active' : ''}" onclick="elegirPrecioServicioLinea(${i},'debito')">D</button>
           <button class="${it.tipo_precio === 'efectivo' ? 'active' : ''}" onclick="elegirPrecioServicioLinea(${i},'efectivo')">E</button>
         </div>
         <input type="number" step="any" value="${it.precio_unitario}" style="width:70px" oninput="cambiarPrecioServicioLinea(${i}, this.value)">
         ${it.tipo_precio === 'manual' ? `<button class="btn light btn-reset-precio" style="padding:2px 5px;font-size:10px;margin-top:3px" title="Recalcular desde mano de obra" onclick="resetPrecioServicioLinea(${i})">↺ auto</button>` : ''}`
      : it.precio_unico
      ? `<input type="number" step="any" value="${it.precio_unitario}" style="width:70px" oninput="cambiarPrecioLinea(${i}, this.value)">`
      : `<div class="line-price-choice">
           <button class="${it.tipo_precio === 'final' ? 'active' : ''}" onclick="elegirPrecioLinea(${i},'final')">F</button>
           <button class="${it.tipo_precio === 'debito' ? 'active' : ''}" onclick="elegirPrecioLinea(${i},'debito')">D</button>
           <button class="${it.tipo_precio === 'efectivo' ? 'active' : ''}" onclick="elegirPrecioLinea(${i},'efectivo')">E</button>
         </div>
         <input type="number" step="any" value="${it.precio_unitario}" style="width:70px" oninput="cambiarPrecioLinea(${i}, this.value)">`;
    tr.innerHTML = `
      <td><input type="number" min="1" value="${it.cantidad}" style="width:38px" oninput="cambiarCantidadLinea(${i}, this.value)"></td>
      <td data-col="descripcion">${descripcionCell}${it.es_servicio ? ' <span class="status s-blue">servicio</span>' : ''}</td>
      <td><select onchange="cambiarCerrajeroLineaVenta(${i}, this.value)">${opcionesCerrajero(it.cerrajero_id)}</select></td>
      <td data-col="precio">${precioCell}</td>
      <td><input type="number" min="0" max="100" step="any" value="${it.descuento_pct || 0}" style="width:38px" title="Descuento sobre esta línea" oninput="cambiarDescuentoLineaPct(${i}, this.value)"></td>
      <td>${it.es_servicio ? `<input type="number" step="any" value="${it.monto_mano_obra}" style="width:70px" oninput="cambiarManoObraLinea(${i}, this.value)">` : '—'}</td>
      <td data-col="subtotal"><b>$ ${money.format(subtotal)}</b></td>
      <td><button class="btn light" onclick="quitarLineaVenta(${i})">🗑</button></td>
    `;
    tbody.appendChild(tr);
  });
  actualizarTotalVenta();
}
function actualizarTotalVenta() {
  const subtotal = carritoVenta.reduce((acc, it) => acc + calcularSubtotalLinea(it), 0);
  const descGeneralPct = Math.min(100, Math.max(0, Number(document.getElementById('ventaDescuentoGeneral').value) || 0));
  const total = subtotal - subtotal * (descGeneralPct / 100);
  document.getElementById('ventaTotal').textContent = money.format(Math.max(0, total));
}
function calcularDescuentoGeneralMonto() {
  const subtotal = carritoVenta.reduce((acc, it) => acc + calcularSubtotalLinea(it), 0);
  const descGeneralPct = Math.min(100, Math.max(0, Number(document.getElementById('ventaDescuentoGeneral').value) || 0));
  return subtotal * (descGeneralPct / 100);
}
function actualizarFilaEnVivoVenta(i) {
  const it = carritoVenta[i];
  if (it.es_servicio && it.tipo_precio !== 'manual') {
    it.precio_unitario = calcularPreciosServicio(it)[it.tipo_precio];
  }
  const tr = document.getElementById('ventaBody').children[i];
  if (tr) {
    if (it.es_servicio) {
      const precioCell = tr.querySelector('[data-col="precio"]');
      precioCell.querySelector('input').value = it.precio_unitario;
      let resetBtn = precioCell.querySelector('.btn-reset-precio');
      if (it.tipo_precio === 'manual' && !resetBtn) {
        resetBtn = document.createElement('button');
        resetBtn.className = 'btn light btn-reset-precio';
        resetBtn.style.cssText = 'padding:2px 5px;font-size:10px;margin-top:3px';
        resetBtn.title = 'Recalcular desde mano de obra';
        resetBtn.textContent = '↺ auto';
        resetBtn.onclick = () => resetPrecioServicioLinea(i);
        precioCell.appendChild(resetBtn);
      } else if (it.tipo_precio !== 'manual' && resetBtn) {
        resetBtn.remove();
      }
    }
    tr.querySelector('[data-col="subtotal"]').innerHTML = `<b>$ ${money.format(calcularSubtotalLinea(it))}</b>`;
  }
  actualizarTotalVenta();
}
function opcionesCerrajero(actualId) {
  return (
    '<option value="">Sin asignar</option>' +
    cerrajerosCache.map((c) => `<option value="${c.id}" ${String(c.id) === String(actualId) ? 'selected' : ''}>${c.nombre}</option>`).join('')
  );
}
function cambiarCantidadLinea(i, v) {
  carritoVenta[i].cantidad = Math.max(1, Number(v) || 1);
  actualizarFilaEnVivoVenta(i);
}
function cambiarPrecioLinea(i, v) {
  carritoVenta[i].precio_unitario = Number(v) || 0;
  carritoVenta[i].tipo_precio = 'manual';
  actualizarFilaEnVivoVenta(i);
}
function cambiarDescuentoLineaPct(i, v) {
  carritoVenta[i].descuento_pct = Math.min(100, Math.max(0, Number(v) || 0));
  actualizarFilaEnVivoVenta(i);
}
function elegirPrecioLinea(i, tipo) {
  const it = carritoVenta[i];
  it.tipo_precio = tipo;
  it.precio_unitario = it.precios[tipo];
  renderVenta();
}
function elegirPrecioServicioLinea(i, tipo) {
  const it = carritoVenta[i];
  it.tipo_precio = tipo;
  it.precio_unitario = calcularPreciosServicio(it)[tipo];
  renderVenta();
}
function cambiarDescripcionLinea(i, v) {
  carritoVenta[i].descripcion = v;
}
function cambiarPrecioServicioLinea(i, v) {
  carritoVenta[i].precio_unitario = Number(v) || 0;
  carritoVenta[i].tipo_precio = 'manual';
  actualizarFilaEnVivoVenta(i);
}
function resetPrecioServicioLinea(i) {
  carritoVenta[i].tipo_precio = 'final';
  renderVenta();
}
function cambiarManoObraLinea(i, v) {
  carritoVenta[i].monto_mano_obra = Number(v) || 0;
  actualizarFilaEnVivoVenta(i);
}
function cambiarCerrajeroLineaVenta(i, v) {
  carritoVenta[i].cerrajero_id = v || null;
}
function aplicarCerrajeroATodas() {
  if (!carritoVenta.length) return;
  const cerrajeroId = document.getElementById('ventaCerrajeroDefault').value || null;
  carritoVenta.forEach((it) => {
    it.cerrajero_id = cerrajeroId;
  });
  renderVenta();
}
function quitarLineaVenta(i) {
  carritoVenta.splice(i, 1);
  renderVenta();
}
function datosClienteVentaTexto(c) {
  if (!c) return '';
  const doc = c.cuit ? `CUIT ${c.cuit}` : c.documento ? `DNI ${c.documento}` : null;
  return [doc, c.direccion, c.condicion_iva].filter(Boolean).join(' · ');
}
function actualizarDatosClienteVenta() {
  const el = document.getElementById('ventaClienteDatos');
  if (el) el.textContent = datosClienteVentaTexto(clienteVentaActual);
}

// Comprobante automático según la situación fiscal del cliente: Responsable
// Inscripto y Monotributista facturan A, Consumidor Final y Exento facturan
// B. Sin cliente elegido (o con una situación que no matchea ninguna regla)
// queda "No fiscal", igual que antes.
function comprobanteAutomaticoSegunCliente(cliente) {
  const situacion = ((cliente && cliente.condicion_iva) || '').toLowerCase();
  if (situacion.includes('responsable inscripto') || situacion.includes('monotributista')) return 'Factura A';
  if (situacion.includes('consumidor final') || situacion.includes('exento')) return 'Factura B';
  return 'Eventual';
}

// La Cuenta Corriente como condición de venta solo se puede elegir si el
// cliente tiene esa opción habilitada en su ficha.
function actualizarComprobanteYCondicionSegunCliente() {
  document.getElementById('ventaTipoComprobante').value = comprobanteAutomaticoSegunCliente(clienteVentaActual);
  const habilitado = !!(clienteVentaActual && clienteVentaActual.venta_a_credito);
  const opcionCtaCte = document.getElementById('ventaCondicionCtaCte');
  opcionCtaCte.disabled = !habilitado;
  if (!habilitado) document.getElementById('ventaCondicionVenta').value = 'Contado';
}

async function elegirClienteParaVenta(id) {
  const cliente = await (await fetch(`/api/clientes/${id}`)).json();
  clienteVentaActual = cliente;
  document.getElementById('ventaClienteNombre').textContent = cliente.nombre;
  actualizarDatosClienteVenta();
  actualizarComprobanteYCondicionSegunCliente();
  showScreen('venta');
}

function elegirClienteEnVenta(cliente) {
  clienteVentaActual = cliente;
  actualizarComprobanteYCondicionSegunCliente();
  document.getElementById('ventaClienteNombre').textContent = cliente.nombre;
  actualizarDatosClienteVenta();
  const cont = document.getElementById('ventaClienteResultados');
  cont.style.display = 'none';
  document.getElementById('ventaClienteBuscar').value = '';
}

async function buscarClienteVenta() {
  const q = document.getElementById('ventaClienteBuscar').value.trim();
  const cont = document.getElementById('ventaClienteResultados');
  if (!q) {
    cont.style.display = 'none';
    return;
  }
  const res = await fetch('/api/clientes?q=' + encodeURIComponent(q));
  const rows = (await res.json()).slice(0, 20);
  cont.innerHTML = rows.length
    ? rows
        .map((c) => {
          const doc = c.cuit ? `CUIT ${c.cuit}` : c.documento ? `DNI ${c.documento}` : null;
          const datos = [c.codigo ? 'N° ' + c.codigo : null, doc, c.direccion].filter(Boolean).join(' · ');
          return `<div class="search-result-item" data-id="${c.id}"><b>${c.nombre}</b>${datos ? `<div class="small">${datos}</div>` : ''}</div>`;
        })
        .join('')
    : '<div class="small" style="padding:8px 12px">Sin resultados. Podés cargarlo con "+ Nuevo cliente".</div>';
  cont.querySelectorAll('.search-result-item').forEach((el) => {
    const cliente = rows.find((c) => String(c.id) === el.dataset.id);
    el.onclick = () => elegirClienteEnVenta(cliente);
  });
  inicializarItemsBuscador('ventaClienteResultados');
  cont.style.display = 'block';
}
document.getElementById('ventaClienteBuscar').addEventListener('input', buscarClienteVenta);
document.getElementById('ventaClienteBuscar').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') document.getElementById('ventaClienteResultados').style.display = 'none';
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    moverBuscadorIndice('ventaClienteResultados', 1);
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    moverBuscadorIndice('ventaClienteResultados', -1);
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    elegirResultadoConEnter('ventaClienteResultados');
  }
});
document.addEventListener('click', (e) => {
  const cont = document.getElementById('ventaClienteResultados');
  if (cont && !e.target.closest('#ventaClienteBuscar') && !e.target.closest('#ventaClienteResultados')) {
    cont.style.display = 'none';
  }
});

let clienteModalOrigenVenta = false;
function nuevoClienteDesdeVenta() {
  document.getElementById('ventaClienteResultados').style.display = 'none';
  document.getElementById('ventaClienteBuscar').value = '';
  clienteModalOrigenVenta = true;
  openCliente();
}

function limpiarCarrito() {
  carritoVenta = [];
  clienteVentaActual = null;
  ventaPendienteIdEnCurso = null;
  presupuestoOrigenId = null;
  document.getElementById('ventaClienteNombre').textContent = 'Consumidor Final';
  document.getElementById('ventaDescuentoGeneral').value = 0;
  document.getElementById('presupuestoOrigenAviso').textContent = '';
  actualizarComprobanteYCondicionSegunCliente();
  actualizarDatosClienteVenta();
  renderVenta();
}
function cancelarVenta() {
  if (carritoVenta.length && !confirm('¿Cancelar esta venta? Se pierde lo cargado.')) return;
  limpiarCarrito();
}

function itemsParaApi() {
  return carritoVenta.map((it) => {
    const bruto = it.precio_unitario * it.cantidad;
    const descPct = Math.min(100, Math.max(0, Number(it.descuento_pct) || 0));
    return {
      producto_id: it.producto_id,
      descripcion: it.descripcion,
      cantidad: it.cantidad,
      precio_unitario: it.precio_unitario,
      tipo_precio: it.tipo_precio,
      descuento: bruto * (descPct / 100),
      monto_mano_obra: it.es_servicio ? it.monto_mano_obra : null,
      cerrajero_id: it.cerrajero_id || null,
      pila_producto_id: it.pila_producto_id || null,
    };
  });
}

async function guardarPendiente() {
  if (!carritoVenta.length) {
    alert('Agregá al menos un producto.');
    return;
  }
  const payload = {
    cliente_id: clienteVentaActual ? clienteVentaActual.id : null,
    descuento_general: calcularDescuentoGeneralMonto(),
    items: itemsParaApi(),
  };
  let res;
  if (ventaPendienteIdEnCurso) {
    res = await fetch(`/api/ventas/${ventaPendienteIdEnCurso}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } else {
    payload.terminal_origen = session.rol;
    payload.usuario_id = session.id;
    payload.estado = 'pendiente';
    payload.presupuesto_id = presupuestoOrigenId;
    res = await fetch('/api/ventas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  }
  const data = await res.json();
  if (!res.ok) {
    alert('Error: ' + data.error);
    return;
  }
  alert('Venta guardada en Pendientes.');
  limpiarCarrito();
}

async function cobrarOEnviar() {
  if (!carritoVenta.length) {
    alert('Agregá al menos un producto.');
    return;
  }
  if (ventaPendienteIdEnCurso) {
    const payload = {
      cliente_id: clienteVentaActual ? clienteVentaActual.id : null,
      descuento_general: calcularDescuentoGeneralMonto(),
      items: itemsParaApi(),
    };
    const res = await fetch(`/api/ventas/${ventaPendienteIdEnCurso}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      alert('Error: ' + data.error);
      return;
    }
    abrirCobro(data.id, data.total);
    return;
  }
  const payload = {
    cliente_id: clienteVentaActual ? clienteVentaActual.id : null,
    terminal_origen: session.rol,
    usuario_id: session.id,
    estado: session.rol === 'VENTA' ? 'enviada_caja' : 'pendiente',
    descuento_general: calcularDescuentoGeneralMonto(),
    items: itemsParaApi(),
    presupuesto_id: presupuestoOrigenId,
  };
  const res = await fetch('/api/ventas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await res.json();
  if (!res.ok) {
    alert('Error: ' + data.error);
    return;
  }
  if (session.rol === 'VENTA') {
    alert('Venta enviada a Caja por LAN.');
    limpiarCarrito();
    return;
  }
  abrirCobro(data.id, data.total);
}

// ============================================================
// COBRO
// ============================================================
let ventaEnCobroId = null;
let ventaEnCobroTotal = 0;
let modoEventual = false;
let qrBilleteraElegida = null;
let filasCombinado = [];

const MARCAS_DEBITO = ['Visa Débito', 'Mastercard Débito', 'Cabal Débito', 'Maestro', 'Naranja Débito', 'Otra'];
const MARCAS_CREDITO = ['Visa Crédito', 'Mastercard Crédito', 'Cabal Crédito', 'American Express', 'Naranja', 'Otra'];
const BILLETERAS_QR = ['Mercado Pago', 'MODO', 'Cuenta DNI', 'Naranja X', 'Personal Pay', 'Otro QR'];

function abrirCobro(ventaId, total) {
  ventaEnCobroId = ventaId;
  ventaEnCobroTotal = total;
  modoEventual = false;
  document.getElementById('eventualHint').classList.remove('active');
  document.getElementById('cobroTotal').textContent = money.format(total);
  volverAMetodos();
  document.getElementById('cobroModal').classList.add('open');
  // Si en la pantalla de Venta ya se eligió "Cuenta Corriente" como
  // condición, se salta directo a esa confirmación en vez de mostrar los
  // botones de forma de pago — ya se sabe que no se cobra en el momento.
  if (document.getElementById('ventaCondicionVenta').value === 'Cuenta Corriente') {
    elegirFormaPago('Cuenta Corriente');
  }
}
function closeCobro() {
  detenerPollingMp();
  document.getElementById('cobroModal').classList.remove('open');
  ventaEnCobroId = null;
}
function volverAMetodos() {
  detenerPollingMp();
  ['cobroPasoMetodos', 'cobroPasoEfectivo', 'cobroPasoSimple', 'cobroPasoMarca', 'cobroPasoQr', 'cobroPasoCombinado'].forEach((id) => {
    document.getElementById(id).style.display = id === 'cobroPasoMetodos' ? 'block' : 'none';
  });
}

// Cobro con QR de Mercado Pago: si está activo y configurado en Configuración,
// genera un QR real y sondea el estado del pago cada 3s hasta que Mercado
// Pago lo confirme — recién ahí se cierra la venta sola. Para las demás
// billeteras (o si Mercado Pago no está configurado) se mantiene el flujo
// simulado de siempre, con confirmación manual.
let mpPollInterval = null;

async function seleccionarBilleteraQr(billetera) {
  qrBilleteraElegida = billetera;
  detenerPollingMp();
  const qrBox = document.getElementById('qrBox');
  const textoEl = document.getElementById('qrMontoTexto');
  const btnConfirmar = document.getElementById('btnConfirmarQr');
  qrBox.style.display = 'flex';
  qrBox.innerHTML = '';

  if (billetera === 'Mercado Pago' && configCache.mp_activo && configCache.mp_access_token) {
    textoEl.innerHTML = `<b>$ ${money.format(ventaEnCobroTotal)}</b><br>Generando QR de Mercado Pago…`;
    btnConfirmar.style.display = 'none';
    try {
      const res = await fetch('/api/mercadopago/qr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ venta_id: ventaEnCobroId, monto: ventaEnCobroTotal, descripcion: 'Venta El Gallo POS' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo generar el QR');
      if (data.qr_fijo) {
        // El monto ya se le mandó al QR fijo del mostrador: no hace falta mostrar ninguna imagen nueva.
        qrBox.style.display = 'none';
        textoEl.innerHTML = `<b>$ ${money.format(ventaEnCobroTotal)}</b><br>Monto enviado al QR fijo del mostrador — esperando que el cliente pague…`;
      } else {
        const img = document.createElement('img');
        img.src = data.qr;
        img.style.width = '100%';
        img.style.height = '100%';
        qrBox.appendChild(img);
        textoEl.innerHTML = `<b>$ ${money.format(ventaEnCobroTotal)}</b><br>Mercado Pago — esperando que el cliente pague…`;
      }
      iniciarPollingMp(data.external_reference);
    } catch (err) {
      textoEl.innerHTML = `<b>$ ${money.format(ventaEnCobroTotal)}</b><br><span style="color:#c0392b">No se pudo generar el QR: ${err.message}</span>`;
      btnConfirmar.style.display = 'inline-block';
    }
  } else {
    textoEl.innerHTML = `<b>$ ${money.format(ventaEnCobroTotal)}</b><br>${billetera} <span class="small">(simulado, sin integración real)</span>`;
    btnConfirmar.style.display = 'inline-block';
  }
}

function iniciarPollingMp(externalReference) {
  mpPollInterval = setInterval(async () => {
    try {
      const res = await fetch(`/api/mercadopago/estado/${externalReference}`);
      const data = await res.json();
      if (data.estado === 'aprobado') {
        detenerPollingMp();
        document.getElementById('qrMontoTexto').innerHTML = `<b>$ ${money.format(ventaEnCobroTotal)}</b><br>✅ Pago aprobado por Mercado Pago`;
        await finalizarCobro([{ forma_pago: 'QR', marca: 'Mercado Pago', monto: ventaEnCobroTotal }]);
      } else if (data.estado === 'rechazado') {
        detenerPollingMp();
        document.getElementById('qrMontoTexto').innerHTML = `<b>$ ${money.format(ventaEnCobroTotal)}</b><br>❌ Pago rechazado. Generá el QR de nuevo o probá otro medio.`;
        document.getElementById('btnConfirmarQr').style.display = 'inline-block';
      }
    } catch (err) {
      // Falla momentánea de red al consultar: no corta el sondeo, reintenta en el próximo ciclo.
    }
  }, 3000);
}

function detenerPollingMp() {
  if (mpPollInterval) {
    clearInterval(mpPollInterval);
    mpPollInterval = null;
  }
}

function elegirFormaPago(forma) {
  if (forma === 'Efectivo') {
    document.getElementById('cobroPasoMetodos').style.display = 'none';
    document.getElementById('cobroPasoEfectivo').style.display = 'block';
    document.getElementById('efectivoRecibido').value = ventaEnCobroTotal;
    calcularVuelto();
    document.getElementById('efectivoRecibido').focus();
    document.getElementById('efectivoRecibido').select();
  } else if (forma === 'Débito' || forma === 'Crédito') {
    document.getElementById('cobroPasoMetodos').style.display = 'none';
    document.getElementById('cobroPasoMarca').style.display = 'block';
    const grid = document.getElementById('marcasGrid');
    grid.innerHTML = '';
    (forma === 'Débito' ? MARCAS_DEBITO : MARCAS_CREDITO).forEach((marca) => {
      const btn = document.createElement('div');
      btn.className = 'brand-btn';
      btn.textContent = marca;
      btn.onclick = () => confirmarPagoSimple(forma, marca);
      grid.appendChild(btn);
    });
  } else if (forma === 'QR') {
    document.getElementById('cobroPasoMetodos').style.display = 'none';
    document.getElementById('cobroPasoQr').style.display = 'block';
    qrBilleteraElegida = null;
    document.getElementById('qrBox').style.display = 'none';
    document.getElementById('qrMontoTexto').textContent = '';
    document.getElementById('btnConfirmarQr').style.display = 'none';
    const grid = document.getElementById('qrGrid');
    grid.innerHTML = '';
    BILLETERAS_QR.forEach((billetera) => {
      const btn = document.createElement('div');
      btn.className = 'brand-btn';
      btn.textContent = billetera;
      btn.onclick = () => seleccionarBilleteraQr(billetera);
      grid.appendChild(btn);
    });
  } else if (forma === 'Pago Combinado') {
    document.getElementById('cobroPasoMetodos').style.display = 'none';
    document.getElementById('cobroPasoCombinado').style.display = 'block';
    filasCombinado = [
      { forma_pago: 'Efectivo', marca: '', monto: ventaEnCobroTotal },
      { forma_pago: 'Débito', marca: '', monto: 0 },
    ];
    renderCombinado();
  } else {
    // Transferencia | Cuenta Corriente
    document.getElementById('cobroPasoMetodos').style.display = 'none';
    document.getElementById('cobroPasoSimple').style.display = 'block';
    const btnConfirmar = document.getElementById('btnConfirmarSimple');
    const btnIrAClientes = document.getElementById('btnIrAClientesCtaCte');
    btnConfirmar.style.display = '';
    btnIrAClientes.style.display = 'none';
    let texto = `Confirmar ${forma} por $ ${money.format(ventaEnCobroTotal)}.`;
    if (forma === 'Cuenta Corriente') {
      if (!clienteVentaActual || !clienteVentaActual.venta_a_credito) {
        // Sin el cliente habilitado no se puede facturar a Cuenta Corriente
        // bajo ningún concepto — no hay botón de "igual continuar".
        texto = clienteVentaActual
          ? `${clienteVentaActual.nombre} no tiene la Cuenta Corriente habilitada. Andá a Clientes y habilitala antes de facturar así.`
          : 'No hay cliente seleccionado. La Cuenta Corriente requiere un cliente habilitado.';
        btnConfirmar.style.display = 'none';
        btnIrAClientes.style.display = clienteVentaActual ? '' : 'none';
      } else if (ventaEnCobroTotal > clienteVentaActual.limite_credito) {
        texto = `⚠ Esta venta ($ ${money.format(ventaEnCobroTotal)}) supera el límite de crédito de ${clienteVentaActual.nombre} ($ ${money.format(clienteVentaActual.limite_credito)}).`;
      } else {
        texto = `Cuenta Corriente de ${clienteVentaActual.nombre} — $ ${money.format(ventaEnCobroTotal)}. Límite: $ ${money.format(clienteVentaActual.limite_credito)}.`;
      }
    }
    document.getElementById('cobroSimpleTexto').textContent = texto;
    btnConfirmar.onclick = () => confirmarPagoSimple(forma);
  }
}

function irAHabilitarCtaCte() {
  if (!clienteVentaActual) return;
  const clienteId = clienteVentaActual.id;
  closeCobro();
  showScreen('clientes');
  openCliente(clienteId);
}

function calcularVuelto() {
  const recibido = Number(document.getElementById('efectivoRecibido').value) || 0;
  document.getElementById('efectivoVuelto').value = Math.max(0, recibido - ventaEnCobroTotal);
}
document.getElementById('efectivoRecibido').addEventListener('input', calcularVuelto);

async function confirmarPagoSimple(forma, marca) {
  await finalizarCobro([{ forma_pago: forma, marca: marca || null, monto: ventaEnCobroTotal }]);
}

function renderCombinado() {
  const cont = document.getElementById('combinadoFilas');
  cont.innerHTML = '';
  filasCombinado.forEach((f, i) => {
    const row = document.createElement('div');
    row.className = 'combinado-row';
    row.innerHTML = `
      <div class="field"><label>Forma</label>
        <select onchange="filasCombinado[${i}].forma_pago=this.value">
          ${['Efectivo', 'Débito', 'Crédito', 'Transferencia', 'QR', 'Cuenta Corriente']
            .map((fp) => `<option value="${fp}" ${fp === f.forma_pago ? 'selected' : ''}>${fp}</option>`)
            .join('')}
        </select>
      </div>
      <div class="field"><label>Marca (opcional)</label><input value="${f.marca || ''}" onchange="filasCombinado[${i}].marca=this.value"></div>
      <div class="field"><label>Monto</label><input type="number" step="any" value="${f.monto}" onchange="filasCombinado[${i}].monto=Number(this.value)||0;renderCombinadoRestante()"></div>
      <button class="btn light" onclick="quitarFilaCombinado(${i})">🗑</button>
    `;
    cont.appendChild(row);
  });
  renderCombinadoRestante();
}
function renderCombinadoRestante() {
  const asignado = filasCombinado.reduce((a, f) => a + (Number(f.monto) || 0), 0);
  document.getElementById('combinadoRestante').textContent = money.format(ventaEnCobroTotal - asignado);
}
function agregarFilaCombinado() {
  filasCombinado.push({ forma_pago: 'Efectivo', marca: '', monto: 0 });
  renderCombinado();
}
function quitarFilaCombinado(i) {
  filasCombinado.splice(i, 1);
  renderCombinado();
}
async function confirmarPagoCombinado() {
  const asignado = filasCombinado.reduce((a, f) => a + (Number(f.monto) || 0), 0);
  if (Math.abs(asignado - ventaEnCobroTotal) > 1) {
    alert('La suma de los pagos no coincide con el total.');
    return;
  }
  await finalizarCobro(filasCombinado.map((f) => ({ forma_pago: f.forma_pago, marca: f.marca || null, monto: f.monto })));
}

async function finalizarCobro(pagos) {
  const tipoComprobante = modoEventual ? 'Eventual' : document.getElementById('ventaTipoComprobante').value;
  const res = await fetch(`/api/ventas/${ventaEnCobroId}/cobrar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pagos, tipo_comprobante: tipoComprobante, usuario_id: session.id, terminal: session.rol }),
  });
  const data = await res.json();
  if (!res.ok) {
    alert('Error: ' + data.error);
    return;
  }
  closeCobro();
  limpiarCarrito();
  if (data.arca_error) {
    alert(
      `Error CAE: no se pudo facturar electrónicamente esta venta, quedó como Eventual.\n` +
        `Detalle: ${data.arca_error}\n\n` +
        `La podés facturar más tarde desde Ventas → botón "Facturar" cuando vuelva la conexión con ARCA.`
    );
  }
  mostrarTicket(data);
}

document.addEventListener('keydown', (e) => {
  const modalAbierto = document.getElementById('cobroModal').classList.contains('open');
  if (modalAbierto) {
    if (e.ctrlKey && e.key === 'F10') {
      e.preventDefault();
      modoEventual = !modoEventual;
      document.getElementById('eventualHint').classList.toggle('active', modoEventual);
      return;
    }
    if (document.getElementById('cobroPasoMetodos').style.display !== 'none') {
      const teclas = { F1: 'Efectivo', F2: 'Débito', F3: 'Transferencia', F4: 'Crédito', F5: 'QR', F6: 'Cuenta Corriente', F7: 'Pago Combinado' };
      if (teclas[e.key]) {
        e.preventDefault();
        elegirFormaPago(teclas[e.key]);
        return;
      }
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      closeCobro();
      return;
    }
    if (e.key === 'Enter') {
      if (document.getElementById('cobroPasoEfectivo').style.display !== 'none') {
        e.preventDefault();
        confirmarPagoSimple('Efectivo');
      } else if (document.getElementById('cobroPasoSimple').style.display !== 'none') {
        e.preventDefault();
        document.getElementById('btnConfirmarSimple').click();
      }
    }
    return;
  }
  if (document.getElementById('venta').classList.contains('active')) {
    const atajosVenta = {
      F10: cobrarOEnviar,
      F9: guardarComoPresupuesto,
      F8: guardarPendiente,
      F6: cancelarVenta,
      F2: nuevoClienteDesdeVenta,
    };
    if (atajosVenta[e.key]) {
      e.preventDefault();
      atajosVenta[e.key]();
    }
  }
});

// ============================================================
// TICKET + WHATSAPP
// ============================================================
let ultimoDocumentoParaTicket = null; // { tipo: 'venta'|'presupuesto', data }

// Desglose de precios por línea/total de un presupuesto: un producto tiene
// los 3 tipos de precio (Final / Débito o Transferencia / Efectivo), un
// servicio solo tiene 2 (Final / Efectivo, éste aclarando que es sin factura
// y solo efectivo), salvo el código 1003 que también tiene los 3. El precio
// "Débito o Transferencia" de un servicio sin ese tercer precio se toma
// igual al Final (no tiene descuento por tarjeta/transferencia), para que el
// TOTAL de esa columna siga sumando el presupuesto completo.
function esCodigo1003Presupuesto(it) {
  return it.producto_codigo === '1003';
}
function calcularPreciosPresupuestoItem(it) {
  const esServicio = !!it.usa_mano_obra;
  const bruto = Number(it.precio_unitario) * Number(it.cantidad);
  const descPct = bruto > 0 ? (Number(it.descuento || 0) / bruto) * 100 : 0;
  const factor = Number(it.cantidad) * (1 - descPct / 100);

  // Precio tocado a mano: no sigue el % de recargo/descuento por forma de
  // pago del catálogo (por algo se cambió a mano), así que se respeta ese
  // precio igual en las 3 columnas en vez de recalcularlo desde el producto.
  if (it.tipo_precio === 'manual') {
    const unico = (Number(it.precio_unitario) || 0) * factor;
    return { esServicio, tieneDebito: false, final: unico, debito: unico, efectivo: unico };
  }

  if (!esServicio) {
    // Sin producto de catálogo vinculado (línea manual/vieja sin producto_id,
    // o el producto ya no existe) no hay forma de saber el desglose por
    // forma de pago: se usa el precio guardado en la línea como único
    // precio, en vez de mostrar $NaN o un $0 falso.
    const sinDatosCatalogo = it.producto_precio_final == null || it.producto_precio_debito == null || it.producto_precio_efectivo == null;
    if (sinDatosCatalogo) {
      const unico = (Number(it.precio_unitario) || 0) * factor;
      return { esServicio: false, tieneDebito: false, final: unico, debito: unico, efectivo: unico };
    }
    return {
      esServicio: false,
      tieneDebito: true,
      final: Number(it.producto_precio_final) * factor,
      debito: Number(it.producto_precio_debito) * factor,
      efectivo: Number(it.producto_precio_efectivo) * factor,
    };
  }

  const base = calcularPreciosServicio({
    recargos_mano_obra: it.recargos_mano_obra || '',
    monto_mano_obra: it.monto_mano_obra || 0,
    descuento_debito_servicio: Number(it.familia_descuento_debito) || 0,
  });
  return {
    esServicio: true,
    tieneDebito: esCodigo1003Presupuesto(it),
    final: base.final * factor,
    debito: base.debito * factor,
    efectivo: base.efectivo * factor,
  };
}
// El precio no se repite por línea (productos y servicios tienen distinta
// cantidad de tipos de precio, y ya queda todo en el total): cada línea es
// solo cantidad + descripción, y el desglose por forma de pago va únicamente
// en el total combinado de abajo.
function calcularDesglosePresupuesto(presupuesto) {
  const lineas = presupuesto.items.map((it) => ({ ...it, ...calcularPreciosPresupuestoItem(it) }));
  const totales = lineas.reduce(
    (acc, l) => {
      acc.final += l.final;
      acc.debito += l.tieneDebito ? l.debito : l.final;
      acc.efectivo += l.efectivo;
      return acc;
    },
    { final: 0, debito: 0, efectivo: 0 }
  );
  return {
    lineas,
    totales,
    hayDebito: lineas.some((l) => l.tieneDebito),
    modo_precio: presupuesto.modo_precio || 'todos',
    // Suma real de precio_unitario×cantidad-descuento tal cual quedó cargada la
    // línea (incluye precios tocados a mano, que no siguen la lista F/D/E del
    // producto). Se usa cuando el presupuesto pide mostrar un solo precio: ese
    // precio tiene que ser el que se cargó, no el recalculado desde el catálogo.
    totalReal: presupuesto.total,
  };
}
// El presupuesto puede pedir mostrar los 3 precios (Final/Débito/Efectivo) o
// uno solo puntual (ej. cuando se le puso un precio efectivo a mano que no
// sigue el % de descuento automático, y mostrar los otros dos confundiría).
function totalesAMostrarPresupuesto(desglose) {
  const t = desglose.totales;
  const modo = desglose.modo_precio;
  if (modo === 'final') return [{ label: 'TOTAL Final', monto: desglose.totalReal }];
  if (modo === 'debito') return [{ label: 'TOTAL Débito o Transferencia', monto: desglose.totalReal }];
  if (modo === 'efectivo') return [{ label: 'TOTAL Efectivo (sin factura, solo efectivo)', monto: desglose.totalReal }];
  const todos = [{ label: 'TOTAL Final', monto: t.final }];
  if (desglose.hayDebito) todos.push({ label: 'TOTAL Débito o Transferencia', monto: t.debito });
  todos.push({ label: 'TOTAL Efectivo (sin factura, solo efectivo)', monto: t.efectivo });
  return todos;
}
// Los totales van en una tabla (label a la izquierda, monto a la derecha)
// para que los montos queden alineados entre sí aunque las etiquetas tengan
// distinto largo ("TOTAL Final" vs "TOTAL Efectivo (sin factura...)").
function totalesPresupuestoHtml(desglose) {
  const [principal, ...resto] = totalesAMostrarPresupuesto(desglose);
  let html = `<div class="ticket-total"><span>${principal.label}</span><span>$${money.format(principal.monto)}</span></div>`;
  if (resto.length) {
    html += '<table class="ticket-totales-tabla">';
    resto.forEach((tt) => {
      html += `<tr><td>${tt.label}</td><td class="ticket-total-sub">$${money.format(tt.monto)}</td></tr>`;
    });
    html += '</table>';
  }
  return html;
}

// Un comprobante es "fiscal" solo si es Factura A o B; los presupuestos
// nunca lo son (son solo un presupuesto, no una venta facturada). Los datos
// fiscales del CLIENTE (CUIT, situación) se muestran siempre, sea o no
// fiscal el comprobante; los del NEGOCIO (CUIT, Ingresos Brutos, Inicio de
// Actividades) solo cuando sí lo es — tanto en el ticket térmico como en A4.
function esFacturaFiscal(tipo, doc) {
  return tipo === 'venta' && (doc.tipo_comprobante === 'Factura A' || doc.tipo_comprobante === 'Factura B');
}

// En una venta ya cobrada, la condición real es la forma de pago que
// efectivamente se usó (si fue "Cuenta Corriente", quedó a cuenta; cualquier
// otra forma es contado). Un presupuesto todavía no tiene pagos, así que se
// estima según si el cliente tiene la Cuenta Corriente habilitada.
function condicionVentaTexto(tipo, doc) {
  if (tipo === 'venta') {
    return doc.pagos && doc.pagos.some((p) => p.forma_pago === 'Cuenta Corriente') ? 'CUENTA CORRIENTE' : 'CONTADO';
  }
  return doc.cliente && doc.cliente.venta_a_credito ? 'CUENTA CORRIENTE' : 'CONTADO';
}

function datosFiscalesClienteHtmlTicket(tipo, doc) {
  const cliente = doc.cliente;
  let html = `Situación: ${(cliente && cliente.condicion_iva) || 'Consumidor Final'}<br>`;
  if (cliente && cliente.cuit) html += `CUIT: ${cliente.cuit}<br>`;
  if (cliente && cliente.direccion) html += `Domicilio: ${cliente.direccion}<br>`;
  html += `Cond. Venta: ${condicionVentaTexto(tipo, doc)}<br>`;
  return html;
}

function datosFiscalesNegocioHtmlTicket(esFiscal) {
  const cfg = configCache || {};
  if (!esFiscal) return 'No válido como factura<br>';
  let html = '';
  if (cfg.responsable_nombre) html += `${cfg.responsable_nombre}<br>`;
  if (cfg.domicilio_negocio) html += `${cfg.domicilio_negocio}<br>`;
  if (cfg.condicion_fiscal_negocio) html += `${cfg.condicion_fiscal_negocio}<br>`;
  html += `CUIT: ${cfg.cuit_negocio || '--'}<br>Ingresos Brutos: ${cfg.ingresos_brutos || '--'}<br>Inicio de Actividades: ${cfg.inicio_actividades || '--'}<br>`;
  return html;
}

async function mostrarTicket(venta) {
  await cargarConfiguracionGlobal();
  ultimoDocumentoParaTicket = { tipo: 'venta', data: venta };
  document.getElementById('btnEnviarImagenWhatsapp').style.display = '';
  document.getElementById('btnEnviarImagenA4Whatsapp').style.display = '';
  document.getElementById('btnImprimirA4').style.display = '';
  document.getElementById('btnEditarTicketRendicion').style.display = 'none';
  document.getElementById('btnEditarTicketCierre').style.display = 'none';
  const esFiscal = esFacturaFiscal('venta', venta);
  const fecha = new Date(venta.cobrado_en || venta.creado_en).toLocaleString('es-AR');
  const lineasHtml = venta.items
    .map((it) => {
      const descLinea =
        it.descuento > 0 ? `<br><span class="ticket-descuento">&nbsp;&nbsp;Descuento: -$${money.format(it.descuento)}</span>` : '';
      return `${it.cantidad} x ${it.descripcion}&nbsp;&nbsp;$${money.format(it.precio_unitario * it.cantidad - (it.descuento || 0))}${descLinea}${it.cerrajero_nombre ? '<br><span style="font-size:11px">&nbsp;&nbsp;Cerrajero: ' + it.cerrajero_nombre + '</span>' : ''}<br>`;
    })
    .join('');
  const descuentoGeneralHtml =
    venta.descuento_general > 0 ? `Descuento general: -$${money.format(venta.descuento_general)}<br>` : '';
  const pagosHtml = venta.pagos.map((p) => `${p.forma_pago}${p.marca ? ' (' + p.marca + ')' : ''}: $${money.format(p.monto)}<br>`).join('');
  const caeHtml = venta.cae
    ? `<hr>Comprobante N°: ${venta.numero_comprobante}<br>CAE: ${venta.cae}<br>Vto. CAE: ${formatFechaAfip(venta.cae_vencimiento)}<br>`
    : '';
  // Factura A tiene que discriminar el IVA (a diferencia de la B, que va a
  // Consumidor Final y solo necesita el total).
  const ivaHtml =
    venta.tipo_comprobante === 'Factura A' && venta.iva_neto != null
      ? `Neto: $${money.format(venta.iva_neto)}<br>IVA 21%: $${money.format(venta.iva_monto)}<br>`
      : '';
  // El tipo de comprobante (Factura A/B) se destaca en un recuadro aparte,
  // más grande, para que salte a la vista de una — y los datos fiscales del
  // negocio van en letra chica y separados con líneas, para no alargar el
  // ticket (es una tira angosta, no una hoja).
  const tipoBoxHtml = esFiscal ? `<div class="center"><span class="ticket-tipo-box">${venta.tipo_comprobante.toUpperCase()}</span></div>` : '';
  mostrarTicketComoTermico(`
    ${ticketEncabezadoHtml()}
    ${tipoBoxHtml}
    <hr><span class="ticket-negocio-chico">${datosFiscalesNegocioHtmlTicket(esFiscal)}</span><hr>
    Fecha: ${fecha}<br>N°: ${venta.numero}${esFiscal ? '' : ' · ' + venta.tipo_comprobante}<br>
    Cliente: ${venta.cliente ? venta.cliente.nombre : 'Consumidor Final'}<br>
    ${datosFiscalesClienteHtmlTicket('venta', venta)}<hr>
    ${lineasHtml}<hr>
    ${ivaHtml}
    ${descuentoGeneralHtml}
    <div class="ticket-total">TOTAL: $${money.format(venta.total)}</div>
    ${pagosHtml}
    ${caeHtml}<hr>
    <div class="center">¡Gracias por su compra!</div>
    ${ticketPieHtml()}
  `);
  showScreen('ticket-screen');
}

async function mostrarTicketPresupuesto(presupuesto) {
  await cargarConfiguracionGlobal();
  ultimoDocumentoParaTicket = { tipo: 'presupuesto', data: presupuesto };
  document.getElementById('btnEnviarImagenWhatsapp').style.display = '';
  document.getElementById('btnEnviarImagenA4Whatsapp').style.display = '';
  document.getElementById('btnImprimirA4').style.display = '';
  document.getElementById('btnEditarTicketRendicion').style.display = 'none';
  document.getElementById('btnEditarTicketCierre').style.display = 'none';
  const fecha = new Date(presupuesto.creado_en).toLocaleString('es-AR');
  const desglose = calcularDesglosePresupuesto(presupuesto);
  const lineasHtml = desglose.lineas.map((l) => `${l.cantidad} x ${l.descripcion}<br>`).join('');
  mostrarTicketComoTermico(`
    ${ticketEncabezadoHtml()}
    ${datosFiscalesNegocioHtmlTicket(false)}
    <div class="center">PRESUPUESTO</div><hr>
    Fecha: ${fecha}<br>N°: ${presupuesto.numero}<br>Válido por ${presupuesto.vigencia_dias} días<br>
    Cliente: ${presupuesto.cliente ? presupuesto.cliente.nombre : 'Consumidor Final'}<br>
    ${datosFiscalesClienteHtmlTicket('presupuesto', presupuesto)}<hr>
    ${lineasHtml}<hr>
    ${totalesPresupuestoHtml(desglose)}
    <hr>
    <div class="center">Presupuesto sujeto a modificaciones.</div>
    ${ticketPieHtml()}
  `);
  showScreen('ticket-screen');
}

// El presupuesto no repite el precio en cada línea (queda solo en el total
// de abajo, que ya lo desglosa por forma de pago): la tabla es únicamente
// código/cantidad/descripción.
function tablaPresupuestoA4Html(desglose) {
  const filas = desglose.lineas
    .map(
      (l) => `
      <tr>
        <td>${l.producto_codigo || ''}</td>
        <td class="a4-num">${l.cantidad}</td>
        <td>${l.descripcion}${l.cerrajero_nombre ? `<br><span class="a4-muted">Cerrajero: ${l.cerrajero_nombre}</span>` : ''}</td>
      </tr>`
    )
    .join('');
  return `
    <table class="a4-tabla">
      <thead><tr><th>Código</th><th>Cant.</th><th>Descripción</th></tr></thead>
      <tbody>${filas}</tbody>
    </table>`;
}
function totalesPresupuestoA4Html(desglose) {
  const modo = desglose.modo_precio;
  if (modo !== 'todos') {
    const titulo = { final: 'TOTAL FINAL', debito: 'TOTAL DÉBITO O TRANSFERENCIA', efectivo: 'TOTAL EFECTIVO' }[modo];
    const sinFactura = modo === 'efectivo' ? '<br><span class="a4-muted" style="font-size:11px">(sin factura, solo efectivo)</span>' : '';
    return `<div class="a4-total">${titulo}<br>$${money.format(desglose.totalReal)}${sinFactura}</div>`;
  }
  const t = desglose.totales;
  let html = `<div class="a4-total">TOTAL FINAL<br>$${money.format(t.final)}</div>`;
  if (desglose.hayDebito) html += `<div class="a4-total">TOTAL DÉBITO O TRANSFERENCIA<br>$${money.format(t.debito)}</div>`;
  html += `<div class="a4-total">TOTAL EFECTIVO<br>$${money.format(t.efectivo)}<br><span class="a4-muted" style="font-size:11px">(sin factura, solo efectivo)</span></div>`;
  return html;
}

// Formato de página completa (A4), pensado para imprimir en una impresora
// común de oficina en vez de la comandera térmica de 80mm: mismo contenido
// que el ticket, pero con una tabla prolija y letra normal (no monoespaciada
// ni forzada a negrita, que en A4 no hace falta para que se vea nítido).
function construirDocumentoA4Html(tipo, doc) {
  const cfg = configCache || {};
  const logo = cfg.logo_url || '/img/logo-badge.png';
  const nombreNegocio = cfg.nombre_negocio || 'CERRAJERÍA EL GALLO';
  const esPresupuesto = tipo === 'presupuesto';
  // Los datos fiscales (CUIT, Ingresos Brutos, etc.) solo se muestran cuando
  // el comprobante es una Factura A o B real; un presupuesto o una venta no
  // fiscal (Eventual) nunca deben llevarlos, para no confundirlos con una
  // factura válida cuando en realidad no lo son.
  const esFiscal = esFacturaFiscal(tipo, doc);
  const letraTipo = esPresupuesto ? 'P' : esFiscal ? doc.tipo_comprobante.slice(-1) : 'V';
  const cliente = doc.cliente;
  const fecha = new Date(doc.creado_en || doc.cobrado_en).toLocaleString('es-AR');
  const condVenta = condicionVentaTexto(tipo, doc);
  const cuartaFila = esPresupuesto
    ? `<p><b>Vigencia:</b> ${doc.vigencia_dias} días</p>`
    : `<p><b>Comprobante:</b> ${doc.tipo_comprobante}</p>`;
  const desglose = esPresupuesto ? calcularDesglosePresupuesto(doc) : null;
  const tablaHtml = esPresupuesto
    ? tablaPresupuestoA4Html(desglose)
    : `
    <table class="a4-tabla">
      <thead><tr><th>Código</th><th>Cant.</th><th>Descripción</th><th>Precio U.</th><th>Descuento</th><th>SubTotal</th></tr></thead>
      <tbody>${doc.items
        .map(
          (it) => `
      <tr>
        <td>${it.producto_codigo || ''}</td>
        <td class="a4-num">${it.cantidad}</td>
        <td>${it.descripcion}${it.cerrajero_nombre ? `<br><span class="a4-muted">Cerrajero: ${it.cerrajero_nombre}</span>` : ''}</td>
        <td class="a4-num">$${money.format(it.precio_unitario)}</td>
        <td class="a4-num">$${money.format(it.descuento || 0)}</td>
        <td class="a4-num">$${money.format(it.precio_unitario * it.cantidad - (it.descuento || 0))}</td>
      </tr>`
        )
        .join('')}</tbody>
    </table>`;
  const ivaBloqueA4Html =
    !esPresupuesto && doc.tipo_comprobante === 'Factura A' && doc.iva_neto != null
      ? `<div class="a4-total">NETO<br>$${money.format(doc.iva_neto)}</div><div class="a4-total">IVA 21%<br>$${money.format(doc.iva_monto)}</div>`
      : '';
  const totalBloqueHtml = esPresupuesto
    ? totalesPresupuestoA4Html(desglose)
    : `${ivaBloqueA4Html}<div class="a4-total">TOTAL<br>$${money.format(doc.total)}</div>`;
  const pagosHtml = !esPresupuesto && doc.pagos && doc.pagos.length
    ? `<p><b>Forma de pago:</b> ${doc.pagos.map((p) => `${p.forma_pago}${p.marca ? ' (' + p.marca + ')' : ''}: $${money.format(p.monto)}`).join(' / ')}</p>`
    : '';
  return `
    <div class="a4-top">
      <div class="a4-empresa">
        <h2>${nombreNegocio}</h2>
        ${cfg.responsable_nombre ? `<div>${cfg.responsable_nombre}</div>` : ''}
        ${cfg.domicilio_negocio ? `<div>Domicilio: ${cfg.domicilio_negocio}</div>` : ''}
        ${cfg.condicion_fiscal_negocio ? `<div>${cfg.condicion_fiscal_negocio}</div>` : ''}
        <img src="${logo}" alt="${nombreNegocio}">
      </div>
      <div class="a4-tipo-box">${letraTipo}</div>
      <div class="a4-doc-info">
        ${esFiscal ? '' : '<div class="a4-muted">No válido como factura</div>'}
        <div class="a4-doc-numero">N° ${esFiscal && doc.numero_comprobante ? doc.numero_comprobante : doc.numero}</div>
        <div>Fecha: ${fecha}</div>
        ${esFiscal ? `
          <div>Inicio de Actividades: ${cfg.inicio_actividades || '--'}</div>
          <div>CUIT: ${cfg.cuit_negocio || '--'} / Ingresos Brutos: ${cfg.ingresos_brutos || '--'}</div>
          ${doc.cae ? `<div>CAE: ${doc.cae}</div><div>Vto. CAE: ${formatFechaAfip(doc.cae_vencimiento)}</div>` : ''}
        ` : ''}
      </div>
    </div>
    <div class="a4-datos">
      <p><b>Cliente:</b> ${cliente ? cliente.nombre : 'Consumidor Final'}</p>
      <p><b>CUIT:</b> ${(cliente && cliente.cuit) || ''}</p>
      <p><b>Localidad:</b> ${(cliente && cliente.localidad) || ''}</p>
      <p><b>DNI:</b> ${(cliente && cliente.documento) || ''}</p>
      <p><b>Situación:</b> ${(cliente && cliente.condicion_iva) || 'Consumidor Final'}</p>
      <p><b>Cond. Venta:</b> ${condVenta}</p>
      <p><b>Domicilio:</b> ${(cliente && cliente.direccion) || ''}</p>
      ${cuartaFila}
    </div>
    ${tablaHtml}
    <div class="a4-abajo">
      <div class="a4-observaciones">Observaciones / Firma${
        esPresupuesto
          ? '<br><span class="a4-muted">Precio Final: puede abonarse en 3, 6 u 8 pagos según la tarjeta de crédito.</span>'
          : ''
      }</div>
      <div style="display:flex;flex-direction:column;gap:6px">${totalBloqueHtml}</div>
    </div>
    ${pagosHtml}
    ${esPresupuesto ? '<p class="a4-muted">Presupuesto sujeto a modificaciones.</p>' : ''}
    ${cfg.ticket_pie ? `<p class="a4-muted">${cfg.ticket_pie.replace(/\n/g, '<br>')}</p>` : ''}
    <p class="a4-muted a4-impreso">Impreso: ${new Date().toLocaleDateString('es-AR')}</p>
  `;
}

let volverAlModoTicketNormal = null;
function imprimirEnA4() {
  if (!ultimoDocumentoParaTicket) return;
  const { tipo, data } = ultimoDocumentoParaTicket;
  if (tipo !== 'venta' && tipo !== 'presupuesto') return;
  document.getElementById('ticketA4Contenido').innerHTML = construirDocumentoA4Html(tipo, data);
  document.body.classList.add('modo-impresion-a4');
  volverAlModoTicketNormal = () => {
    document.body.classList.remove('modo-impresion-a4');
    window.removeEventListener('afterprint', volverAlModoTicketNormal);
    volverAlModoTicketNormal = null;
  };
  window.addEventListener('afterprint', volverAlModoTicketNormal);
  window.print();
}

// Si el cliente tiene teléfono guardado, se abre su chat directo. Si no,
// en vez de pedirlo en un cuadro propio (paso extra e inútil: al final hay
// que elegir el contacto a mano en WhatsApp igual), se abre WhatsApp sin
// destinatario — ahí adentro se elige el contacto y el mensaje ya viene
// escrito, listo para mandar.
function enviarImagenWhatsapp() {
  if (!ultimoDocumentoParaTicket) return;
  enviarImagenPorWhatsapp('ticketContenido', 'ticket');
}
// El A4 normalmente solo se arma al imprimir; acá se genera igual pero sin
// disparar el diálogo de impresión, para poder capturarlo como imagen.
function enviarImagenA4Whatsapp() {
  if (!ultimoDocumentoParaTicket) return;
  const { tipo, data } = ultimoDocumentoParaTicket;
  // La rendición ya se muestra siempre en A4 (mostrarTicketComoA4), así que
  // el contenido a capturar ya está armado; venta/presupuesto en cambio
  // muestran el ticket térmico por defecto, así que hay que generar el A4
  // recién en este momento (no se arma de entrada).
  if (tipo === 'venta' || tipo === 'presupuesto') {
    document.getElementById('ticketA4Contenido').innerHTML = construirDocumentoA4Html(tipo, data);
  }
  enviarImagenPorWhatsapp('ticketA4Contenido', tipo === 'rendicion' ? 'rendicion-a4' : 'presupuesto-a4');
}

function telefonoWhatsappCompleto(telefono) {
  const soloNumeros = telefono.replace(/\D/g, '');
  return soloNumeros.startsWith('54') ? soloNumeros : '549' + soloNumeros;
}

function urlWhatsapp(telefono, texto) {
  const destino = telefono ? telefonoWhatsappCompleto(telefono) : '';
  return `https://wa.me/${destino}?text=${encodeURIComponent(texto)}`;
}

function abrirVentanaWhatsapp(ventanaPreabierta, telefono, texto) {
  const url = urlWhatsapp(telefono, texto);
  if (ventanaPreabierta) ventanaPreabierta.location.href = url;
  else window.open(url, '_blank');
}

// El A4 (igual que la rendición/cierre) normalmente está oculto (display:none,
// solo se muestra al imprimir); para poder capturarlo con html2canvas hay que
// mostrarlo un instante, pero fuera de la vista (position:fixed a la
// izquierda de la pantalla) para que no se note el flash en el ticket visible.
async function generarCanvasElemento(elId) {
  const el = document.getElementById(elId);
  const estabaOculto = getComputedStyle(el).display === 'none';
  if (estabaOculto) {
    el.style.position = 'fixed';
    el.style.left = '-9999px';
    el.style.top = '0';
    el.style.display = 'block';
  }
  try {
    return await html2canvas(el, { backgroundColor: '#ffffff', scale: 2 });
  } finally {
    if (estabaOculto) {
      el.style.position = '';
      el.style.left = '';
      el.style.top = '';
      el.style.display = '';
    }
  }
}

// WhatsApp no deja adjuntar una imagen por link (wa.me solo permite texto
// precargado); es una limitación de WhatsApp, no de esta app. Por eso hay 3
// niveles, de mejor a peor, según lo que permita el navegador:
// 1) navigator.share con archivos (típico en celulares): se abre el selector
//    nativo con la imagen ya lista para elegir WhatsApp.
// 2) Clipboard API (requiere HTTPS): se copia la imagen al portapapeles y se
//    abre el chat, para pegarla con Ctrl+V directo en el cuadro de mensaje.
// 3) Descarga + adjuntar a mano (único camino posible sin HTTPS).
//
// La ventana de WhatsApp se abre ACÁ, de entrada, en el mismo instante del
// clic: generar la imagen (html2canvas + toBlob) tarda un poco, y si se
// llama a window.open() recién después de esa espera, el navegador ya no lo
// considera un gesto directo del usuario y lo bloquea como popup (pasaba
// siempre en algunas PC, nunca en otras, según qué tan estricto sea cada
// Chrome). Abriendo la ventana ya mismo y rellenándola después evita el
// bloqueo en cualquier navegador.
async function enviarImagenPorWhatsapp(elId, prefijoArchivo) {
  const doc = ultimoDocumentoParaTicket.data;
  const telefono = doc.cliente ? doc.cliente.telefono : null;
  const ventana = window.open('', '_blank');
  let canvas;
  try {
    canvas = await generarCanvasElemento(elId);
  } catch (err) {
    if (ventana) ventana.close();
    alert('No se pudo generar la imagen: ' + err.message);
    return;
  }
  canvas.toBlob(async (blob) => {
    if (!blob) {
      if (ventana) ventana.close();
      alert('No se pudo generar la imagen.');
      return;
    }
    const archivo = new File([blob], `${prefijoArchivo}-${Date.now()}.jpg`, { type: 'image/jpeg' });
    if (navigator.canShare && navigator.canShare({ files: [archivo] })) {
      if (ventana) ventana.close();
      try {
        await navigator.share({ files: [archivo], title: 'Ticket', text: 'Te envío el ticket.' });
        return;
      } catch (err) {
        if (err.name === 'AbortError') return; // el usuario canceló el selector, no hacer nada más
      }
    }
    if (window.isSecureContext && navigator.clipboard && window.ClipboardItem) {
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': await convertirAPng(blob) })]);
        abrirVentanaWhatsapp(ventana, telefono, 'Te envío el ticket 📎');
        alert('Se copió la imagen al portapapeles. En el chat que se acaba de abrir, hacé clic en el cuadro de mensaje y pegala con Ctrl+V.');
        return;
      } catch (err) {
        // si falla el portapapeles, seguir con la descarga como último recurso
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = archivo.name;
    a.click();
    URL.revokeObjectURL(url);
    abrirVentanaWhatsapp(ventana, telefono, 'Te envío el ticket adjunto 📎');
    alert('Se descargó la imagen. WhatsApp no permite adjuntarla sola desde el navegador: adjuntala manualmente en el chat que se acaba de abrir (clip 📎 → Galería/Archivo → elegí el archivo recién descargado).');
  }, 'image/jpeg', 0.92);
}

// El portapapeles del navegador solo acepta PNG, y el ticket se genera en JPEG
// para que pese menos al descargarlo; esta función convierte on-the-fly.
function convertirAPng(blobJpeg) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      canvas.getContext('2d').drawImage(img, 0, 0);
      canvas.toBlob((blobPng) => (blobPng ? resolve(blobPng) : reject(new Error('No se pudo convertir a PNG'))), 'image/png');
    };
    img.onerror = () => reject(new Error('No se pudo cargar la imagen del ticket'));
    img.src = URL.createObjectURL(blobJpeg);
  });
}

// Copia al portapapeles lo que se esté mostrando en pantalla (térmico o A4),
// sin pasar por WhatsApp — para pegarlo con Ctrl+V donde se necesite (Word,
// mail, etc.). Si el navegador no permite portapapeles (sin HTTPS), descarga
// la imagen como último recurso.
async function copiarImagenTicket() {
  const elA4 = document.getElementById('ticketA4Contenido');
  const elId = elA4 && elA4.style.display !== 'none' && elA4.innerHTML ? 'ticketA4Contenido' : 'ticketContenido';
  let canvas;
  try {
    canvas = await generarCanvasElemento(elId);
  } catch (err) {
    alert('No se pudo generar la imagen: ' + err.message);
    return;
  }
  canvas.toBlob(async (blob) => {
    if (!blob) return alert('No se pudo generar la imagen.');
    if (window.isSecureContext && navigator.clipboard && window.ClipboardItem) {
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': await convertirAPng(blob) })]);
        alert('Imagen copiada. Pegala donde quieras con Ctrl+V.');
        return;
      } catch (err) {
        // si falla el portapapeles, seguir con la descarga como último recurso
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ticket-${Date.now()}.jpg`;
    a.click();
    URL.revokeObjectURL(url);
    alert('No se pudo copiar al portapapeles (el navegador lo bloquea sin conexión segura). Se descargó la imagen en su lugar.');
  }, 'image/jpeg', 0.92);
}

// ============================================================
// PENDIENTES
// ============================================================
async function cargarPendientes() {
  const [pendientes, enviadas] = await Promise.all([
    fetch('/api/ventas?estado=pendiente').then((r) => r.json()),
    fetch('/api/ventas?estado=enviada_caja').then((r) => r.json()),
  ]);
  const rows = [...enviadas, ...pendientes];
  const tbody = document.getElementById('pendientesBody');
  tbody.innerHTML = '';
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="small">No hay ventas pendientes.</td></tr>';
    return;
  }
  rows.forEach((v) => {
    const tr = document.createElement('tr');
    const hora = new Date(v.creado_en).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
    const estado =
      v.estado === 'enviada_caja'
        ? '<span class="status s-warn">Esperando caja</span>'
        : '<span class="status s-blue">Guardada</span>';
    const acciones =
      session.rol === 'VENTA'
        ? `<button class="btn primary" onclick="verPendiente(${v.id})">Ver</button>`
        : `<button class="btn light" onclick="abrirPendienteParaEditar(${v.id})">Abrir</button>
           <button class="btn primary" onclick="facturarPendiente(${v.id})">Facturar</button>`;
    tr.innerHTML = `
      <td>${v.numero}</td>
      <td>${v.estado === 'enviada_caja' ? 'Recibida por LAN' : 'Guardada local'}</td>
      <td>${v.terminal_origen}</td>
      <td>${hora}</td>
      <td>${v.cliente_nombre || 'Consumidor Final'}</td>
      <td>$ ${money.format(v.total)}</td>
      <td>${estado}</td>
      <td>${acciones}</td>
    `;
    tbody.appendChild(tr);
  });
}
async function verPendiente(id) {
  const venta = await (await fetch(`/api/ventas/${id}`)).json();
  alert(`Venta N° ${venta.numero} — $ ${money.format(venta.total)} — ${venta.estado === 'enviada_caja' ? 'esperando que Caja la cobre.' : 'guardada.'}`);
}
async function facturarPendiente(id) {
  const venta = await (await fetch(`/api/ventas/${id}`)).json();
  abrirCobro(venta.id, venta.total);
}
async function abrirPendienteParaEditar(id) {
  const venta = await (await fetch(`/api/ventas/${id}`)).json();
  limpiarCarrito();
  ventaPendienteIdEnCurso = id;
  if (venta.cliente) {
    clienteVentaActual = venta.cliente;
    document.getElementById('ventaClienteNombre').textContent = venta.cliente.nombre;
    actualizarComprobanteYCondicionSegunCliente();
  }
  actualizarDatosClienteVenta();
  for (const it of venta.items) {
    if (it.producto_id) {
      const producto = await (await fetch(`/api/productos/${it.producto_id}`)).json();
      // Se restaura tal cual quedó guardada la línea (incluida la pila
      // elegida, si la había) sin volver a preguntar — la pregunta es solo
      // al agregar el producto por primera vez.
      agregarProductoACarritoInterno(producto, undefined, it.pila_producto_id || null);
      const linea = carritoVenta[carritoVenta.length - 1];
      linea.descripcion = it.descripcion;
      linea.cantidad = it.cantidad;
      linea.cerrajero_id = it.cerrajero_id || null;
      const bruto = it.precio_unitario * it.cantidad;
      linea.descuento_pct = bruto > 0 && it.descuento ? (Number(it.descuento) / bruto) * 100 : 0;
      if (linea.es_servicio) {
        linea.monto_mano_obra = it.monto_mano_obra || 0;
        linea.tipo_precio = ['final', 'debito', 'efectivo'].includes(it.tipo_precio) ? it.tipo_precio : 'manual';
        linea.precio_unitario = it.precio_unitario;
      } else {
        linea.precio_unitario = it.precio_unitario;
        linea.tipo_precio = it.tipo_precio || 'manual';
      }
    } else {
      carritoVenta.push({
        producto_id: null,
        descripcion: it.descripcion,
        cantidad: it.cantidad,
        es_servicio: false,
        precios: { final: it.precio_unitario, debito: it.precio_unitario, efectivo: it.precio_unitario },
        precio_unitario: it.precio_unitario,
        tipo_precio: 'manual',
        descuento_pct: 0,
        cerrajero_id: it.cerrajero_id || null,
      });
    }
  }
  const pctGeneral = venta.subtotal > 0 ? (Number(venta.descuento_general) / venta.subtotal) * 100 : 0;
  document.getElementById('ventaDescuentoGeneral').value = Math.round(pctGeneral * 100) / 100;
  renderVenta();
  document.getElementById('presupuestoOrigenAviso').textContent =
    `Editando la venta N° ${venta.numero}${venta.estado === 'enviada_caja' ? ' (enviada por LAN)' : ''}. Los cambios se guardan sobre la misma venta.`;
  showScreen('venta');
}

// ============================================================
// VENTAS — historial
// ============================================================
async function cargarVentasHistorial() {
  const params = new URLSearchParams();
  const desde = document.getElementById('ventasDesde').value;
  const hasta = document.getElementById('ventasHasta').value;
  const numero = document.getElementById('ventasNumero').value.trim();
  const cerrajero_id = document.getElementById('ventasCerrajero').value;
  const patente = document.getElementById('ventasPatente').value.trim();
  const estado = document.getElementById('ventasEstado').value;
  if (desde) params.set('fecha_desde', desde);
  if (hasta) params.set('fecha_hasta', hasta);
  if (numero) params.set('numero', numero);
  if (cerrajero_id) params.set('cerrajero_id', cerrajero_id);
  if (patente) params.set('patente', patente);
  if (estado) params.set('estado', estado);

  const res = await fetch('/api/ventas?' + params.toString());
  const rows = await res.json();
  const tbody = document.getElementById('ventasBody');
  tbody.innerHTML = '';
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="small">Sin resultados.</td></tr>';
    return;
  }
  rows.forEach((v) => tbody.appendChild(filaVentaHistorial(v)));
}
function filaVentaHistorial(v) {
  const tr = document.createElement('tr');
  const hora = new Date(v.creado_en).toLocaleString('es-AR');
  const estadoCls = v.estado === 'cobrada' ? 's-ok' : v.estado === 'anulada' ? 's-bad' : 's-warn';
  const puedeFacturar = v.estado === 'cobrada' && v.tipo_comprobante === 'Eventual';
  const botonFacturar = puedeFacturar
    ? `<button class="btn green" onclick='abrirFacturarVenta(${v.id}, ${JSON.stringify(v.cliente_nombre || null)}, ${v.cliente_id || 'null'})'>Facturar</button>`
    : '';
  tr.innerHTML = `
    <td>${v.numero}</td><td>${hora}</td><td>${v.cliente_nombre || 'Consumidor Final'}</td>
    <td>${v.tipo_comprobante}</td><td>${v.forma_pago || '—'}</td><td>$ ${money.format(v.total)}</td>
    <td><span class="status ${estadoCls}">${v.estado}</span></td>
    <td><button class="btn light" onclick="verDetalleVenta(${v.id})">Ver detalle</button> ${botonFacturar}</td>
  `;
  return tr;
}

// ============================================================
// FACTURAR UNA VENTA "EVENTUAL" YA COBRADA (si ARCA falló en el momento del
// cobro, o si directamente se cobró sin facturar y después se decide hacerlo)
// ============================================================
let facturarClienteElegidoId = null;

function abrirFacturarVenta(id, clienteNombreActual, clienteIdActual) {
  document.getElementById('facturarVentaId').value = id;
  document.getElementById('facturarTipoComprobante').value = 'Factura B';
  document.getElementById('facturarClienteBuscar').value = '';
  document.getElementById('facturarClienteResultados').style.display = 'none';
  facturarClienteElegidoId = clienteIdActual || null;
  document.getElementById('facturarClienteElegido').textContent = clienteNombreActual
    ? `Cliente: ${clienteNombreActual}`
    : 'Sin cliente asignado — se factura a Consumidor Final, o buscá uno abajo.';
  document.getElementById('facturarVentaModal').classList.add('open');
}

function closeFacturarVenta() {
  document.getElementById('facturarVentaModal').classList.remove('open');
}

async function buscarClienteFacturar() {
  const q = document.getElementById('facturarClienteBuscar').value.trim();
  const cont = document.getElementById('facturarClienteResultados');
  if (!q) {
    cont.style.display = 'none';
    return;
  }
  const res = await fetch('/api/clientes?q=' + encodeURIComponent(q));
  const rows = await res.json();
  cont.innerHTML =
    rows
      .slice(0, 15)
      .map(
        (c) =>
          `<div class="search-result-item" onclick='elegirClienteFacturar(${c.id}, ${JSON.stringify(c.nombre)})'>${c.nombre}${c.cuit ? ' — CUIT ' + c.cuit : ''}</div>`
      )
      .join('') || '<div class="search-result-item">Sin resultados.</div>';
  cont.style.display = 'block';
}

function elegirClienteFacturar(id, nombre) {
  facturarClienteElegidoId = id;
  document.getElementById('facturarClienteElegido').textContent = `Cliente: ${nombre}`;
  document.getElementById('facturarClienteResultados').style.display = 'none';
  document.getElementById('facturarClienteBuscar').value = '';
}

async function confirmarFacturarVenta() {
  const id = document.getElementById('facturarVentaId').value;
  const tipo_comprobante = document.getElementById('facturarTipoComprobante').value;
  const res = await fetch(`/api/ventas/${id}/facturar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tipo_comprobante, cliente_id: facturarClienteElegidoId }),
  });
  const data = await res.json();
  if (!res.ok) {
    alert('Error CAE: no se pudo facturar. ' + data.error);
    return;
  }
  closeFacturarVenta();
  cargarVentasHistorial();
  alert(`Factura emitida: ${data.numero_comprobante} — CAE ${data.cae}`);
}
document.getElementById('facturarClienteBuscar').addEventListener('input', buscarClienteFacturar);
document.getElementById('btnBuscarVentas').addEventListener('click', cargarVentasHistorial);
['ventasDesde', 'ventasHasta', 'ventasCerrajero'].forEach((id) =>
  document.getElementById(id).addEventListener('change', cargarVentasHistorial)
);
['ventasNumero', 'ventasPatente'].forEach((id) =>
  document.getElementById(id).addEventListener('input', cargarVentasHistorial)
);

function descargarExcelVentas() {
  const desde = document.getElementById('ventasDesde').value;
  const hasta = document.getElementById('ventasHasta').value;
  const params = new URLSearchParams();
  if (desde) params.set('desde', desde);
  if (hasta) params.set('hasta', hasta);
  window.open('/api/ventas/exportar?' + params.toString(), '_blank');
}

let ventaDetalleActual = null;
async function verDetalleVenta(id) {
  const venta = await (await fetch(`/api/ventas/${id}`)).json();
  ventaDetalleActual = venta;
  document.getElementById('detalleVentaTitulo').textContent = `Venta N° ${venta.numero}`;
  const filasItems = venta.items
    .map(
      (it) => `
    <tr>
      <td>${it.producto_codigo || '—'}</td><td>${it.cantidad}</td><td>${it.descripcion}</td>
      <td><select onchange="cambiarCerrajeroItemDetalle(${it.id}, this.value)">${opcionesCerrajero(it.cerrajero_id)}</select></td>
      <td>$ ${money.format(it.precio_unitario)}</td><td>$ ${money.format(it.precio_unitario * it.cantidad - (it.descuento || 0))}</td>
    </tr>`
    )
    .join('');
  const pagosTxt = venta.pagos.map((p) => `${p.forma_pago}${p.marca ? ' (' + p.marca + ')' : ''}: $ ${money.format(p.monto)}`).join(', ') || '—';
  document.getElementById('detalleVentaContenido').innerHTML = `
    <p><b>Cliente:</b> ${venta.cliente ? venta.cliente.nombre : 'Consumidor Final'} &nbsp; <b>Estado:</b> ${venta.estado} &nbsp; <b>Comprobante:</b> ${venta.tipo_comprobante}</p>
    <div class="table-wrap"><table><thead><tr><th>Código</th><th>Cant.</th><th>Descripción</th><th>Cerrajero</th><th>Precio</th><th>Subtotal</th></tr></thead><tbody>${filasItems}</tbody></table></div>
    <p style="margin-top:10px"><b>Pagos:</b> ${pagosTxt}</p>
    <p><b>Total: $ ${money.format(venta.total)}</b></p>
  `;
  document.getElementById('btnAnularVenta').style.display = venta.estado === 'anulada' ? 'none' : 'inline-block';
  document.getElementById('detalleVentaModal').classList.add('open');
}
function closeDetalleVenta() {
  document.getElementById('detalleVentaModal').classList.remove('open');
  cargarVentasHistorial();
}
async function cambiarCerrajeroItemDetalle(itemId, cerrajeroId) {
  await fetch(`/api/ventas/items/${itemId}/cerrajero`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cerrajero_id: cerrajeroId || null }),
  });
}
async function anularVentaUI() {
  if (!ventaDetalleActual) return;
  const motivo = prompt('Motivo de la anulación (opcional):') || '';
  const res = await fetch(`/api/ventas/${ventaDetalleActual.id}/anular`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ motivo, usuario_id: session.id, terminal: session.rol }),
  });
  const data = await res.json();
  if (!res.ok) {
    alert('Error: ' + data.error);
    return;
  }
  alert('Venta anulada. El stock se repuso automáticamente.');
  closeDetalleVenta();
}
function imprimirVentaDesdeDetalle() {
  if (ventaDetalleActual) mostrarTicket(ventaDetalleActual);
}
function whatsappVentaDesdeDetalle() {
  if (ventaDetalleActual) enviarPorWhatsapp('venta', ventaDetalleActual);
}

// ============================================================
// PRESUPUESTOS
// ============================================================
async function guardarComoPresupuesto() {
  if (!carritoVenta.length) {
    alert('Agregá al menos un producto.');
    return;
  }
  const payload = {
    cliente_id: clienteVentaActual ? clienteVentaActual.id : null,
    vigencia_dias: Number(document.getElementById('presupuestoVigencia').value) || 15,
    modo_precio: document.getElementById('presupuestoModoPrecio').value || 'todos',
    usuario_id: session.id,
    items: itemsParaApi(),
  };
  const res = await fetch('/api/presupuestos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await res.json();
  if (!res.ok) {
    alert('Error: ' + data.error);
    return;
  }
  limpiarCarrito();
  mostrarTicketPresupuesto(data);
}

async function cargarPresupuestos() {
  const estado = document.getElementById('presupuestosEstado').value;
  const res = await fetch('/api/presupuestos' + (estado ? '?estado=' + encodeURIComponent(estado) : ''));
  const rows = await res.json();
  const tbody = document.getElementById('presupuestosBody');
  tbody.innerHTML = '';
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="small">No hay presupuestos para mostrar.</td></tr>';
    return;
  }
  rows.forEach((p) => tbody.appendChild(filaPresupuesto(p)));
}
function filaPresupuesto(p) {
  const tr = document.createElement('tr');
  const fecha = new Date(p.creado_en).toLocaleDateString('es-AR');
  const estadoCls = p.estado === 'vigente' ? 's-warn' : p.estado === 'convertido' ? 's-ok' : 's-bad';
  const accionesVigente =
    p.estado === 'vigente'
      ? `<button class="btn green" onclick="convertirPresupuestoEnVenta(${p.id})">Convertir en venta</button>
         <button class="btn light" onclick="cerrarPresupuestoUI(${p.id})">Cerrar</button>`
      : '';
  tr.innerHTML = `
    <td>${p.numero}</td><td>${p.cliente_nombre || 'Consumidor Final'}</td><td>${fecha}</td>
    <td>$ ${money.format(p.total)}</td><td><span class="status ${estadoCls}">${p.estado}</span></td>
    <td><button class="btn light" onclick="verPresupuesto(${p.id})">Ver</button> ${accionesVigente}</td>
  `;
  return tr;
}
async function verPresupuesto(id) {
  const presupuesto = await (await fetch(`/api/presupuestos/${id}`)).json();
  mostrarTicketPresupuesto(presupuesto);
}

async function cerrarPresupuestoUI(id) {
  if (!confirm('¿Cerrar este presupuesto sin convertirlo en venta?')) return;
  await fetch(`/api/presupuestos/${id}/cerrar`, { method: 'POST' });
  cargarPresupuestos();
}

let presupuestoOrigenId = null;
async function convertirPresupuestoEnVenta(id) {
  const presupuesto = await (await fetch(`/api/presupuestos/${id}`)).json();
  limpiarCarrito();
  presupuestoOrigenId = id;
  if (presupuesto.cliente) {
    clienteVentaActual = presupuesto.cliente;
    document.getElementById('ventaClienteNombre').textContent = presupuesto.cliente.nombre;
    actualizarComprobanteYCondicionSegunCliente();
  }
  actualizarDatosClienteVenta();
  for (const it of presupuesto.items) {
    const bruto = it.precio_unitario * it.cantidad;
    const descuentoPctGuardado = bruto > 0 && it.descuento ? (Number(it.descuento) / bruto) * 100 : 0;
    if (it.producto_id) {
      const producto = await (await fetch(`/api/productos/${it.producto_id}`)).json();
      // Se reconstruye la línea sin volver a preguntar por la pila (los
      // presupuestos no tienen ese dato guardado, ya que no descuentan stock).
      agregarProductoACarritoInterno(producto, undefined, null);
      const linea = carritoVenta[carritoVenta.length - 1];
      linea.descripcion = it.descripcion;
      linea.cantidad = it.cantidad;
      linea.descuento_pct = descuentoPctGuardado;
      if (linea.es_servicio) {
        linea.monto_mano_obra = it.monto_mano_obra || 0;
        const precios = calcularPreciosServicio(linea);
        const tipoDetectado = Object.keys(precios).find((k) => Math.abs(precios[k] - it.precio_unitario) < 0.01);
        linea.tipo_precio = tipoDetectado || 'manual';
        linea.precio_unitario = it.precio_unitario;
      } else {
        linea.precio_unitario = it.precio_unitario;
        linea.tipo_precio = 'manual';
      }
    } else {
      carritoVenta.push({
        producto_id: null,
        descripcion: it.descripcion,
        cantidad: it.cantidad,
        es_servicio: false,
        precios: { final: it.precio_unitario, debito: it.precio_unitario, efectivo: it.precio_unitario },
        precio_unitario: it.precio_unitario,
        tipo_precio: 'manual',
        descuento_pct: descuentoPctGuardado,
        cerrajero_id: null,
      });
    }
  }
  renderVenta();
  document.getElementById('presupuestoOrigenAviso').textContent = `Convirtiendo el presupuesto ${presupuesto.numero}. Revisá cerrajero y mano de obra antes de cobrar.`;
  showScreen('venta');
}

// ============================================================
// RESUMEN (Ventas / Rendiciones / Gastos, por rango de fechas)
// ============================================================
function inicializarResumen() {
  if (document.getElementById('resVentasDesde').value) return; // ya se inicializó antes, no pisar lo que eligió el usuario
  const hoy = new Date();
  const primerDiaMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().slice(0, 10);
  const hoyStr = hoy.toISOString().slice(0, 10);
  ['resVentas', 'resRend', 'resGastos'].forEach((prefijo) => {
    document.getElementById(`${prefijo}Desde`).value = primerDiaMes;
    document.getElementById(`${prefijo}Hasta`).value = hoyStr;
  });
  cargarResumenVentas();
  cargarResumenRendiciones();
  cargarResumenGastos();
}

function resumenA4Header(titulo, desde, hasta) {
  const cfg = configCache || {};
  const logo = cfg.logo_url || '/img/logo-badge.png';
  const nombreNegocio = cfg.nombre_negocio || 'CERRAJERÍA EL GALLO';
  return `
    <div class="a4-top">
      <div class="a4-empresa">
        <h2>${nombreNegocio}</h2>
        ${cfg.responsable_nombre ? `<div>${cfg.responsable_nombre}</div>` : ''}
        <img src="${logo}" alt="${nombreNegocio}">
      </div>
      <div class="a4-tipo-box">R</div>
      <div class="a4-doc-info">
        <div class="a4-doc-numero">${titulo}</div>
        <div>Período: ${desde || 'inicio'} a ${hasta || 'hoy'}</div>
        <div class="a4-muted">Impreso: ${new Date().toLocaleDateString('es-AR')}</div>
      </div>
    </div>
  `;
}

// --- Ventas ---
async function cargarResumenVentas() {
  const desde = document.getElementById('resVentasDesde').value;
  const hasta = document.getElementById('resVentasHasta').value;
  const params = new URLSearchParams();
  if (desde) params.set('desde', desde);
  if (hasta) params.set('hasta', hasta);
  const r = await (await fetch('/api/reportes/resumen-ventas?' + params.toString())).json();
  ultimoResumenVentas = r;
  const filas = r.porFormaPago.map((f) => `<tr><td>${f.forma_pago}</td><td class="a4-num">$ ${money.format(f.total)}</td></tr>`).join('');
  document.getElementById('resVentasResultado').innerHTML = `
    <p><b>${r.cantidadVentas}</b> venta(s) — Total facturado: <b>$ ${money.format(r.total)}</b></p>
    <div class="table-wrap"><table><thead><tr><th>Forma de pago</th><th>Monto</th></tr></thead><tbody>${filas || '<tr><td colspan="2">Sin ventas en el período.</td></tr>'}</tbody></table></div>
    <p class="small" style="margin-top:8px">Efectivo: $ ${money.format(r.efectivo)} — Medios electrónicos: $ ${money.format(r.pagoElectronico)} — Cuenta corriente: $ ${money.format(r.cuentaCorriente)} — A caja fuerte: $ ${money.format(r.cajaFuerte)}</p>
  `;
}
let ultimoResumenVentas = null;
function descargarExcelResumenVentas() {
  const desde = document.getElementById('resVentasDesde').value;
  const hasta = document.getElementById('resVentasHasta').value;
  const params = new URLSearchParams();
  if (desde) params.set('desde', desde);
  if (hasta) params.set('hasta', hasta);
  window.open('/api/ventas/exportar?' + params.toString(), '_blank');
}
async function verResumenVentasA4() {
  if (!ultimoResumenVentas) await cargarResumenVentas();
  const r = ultimoResumenVentas;
  const filas = r.porFormaPago.map((f) => `<tr><td>${f.forma_pago}</td><td class="a4-num">$ ${money.format(f.total)}</td></tr>`).join('');
  const html = `
    ${resumenA4Header('Resumen de Ventas', r.desde, r.hasta)}
    <p><b>Cantidad de ventas:</b> ${r.cantidadVentas}</p>
    <table class="a4-tabla">
      <thead><tr><th>Forma de pago</th><th>Monto</th></tr></thead>
      <tbody>${filas}</tbody>
    </table>
    <p class="a4-muted">Efectivo: $ ${money.format(r.efectivo)} — Medios electrónicos: $ ${money.format(r.pagoElectronico)} — Cuenta corriente: $ ${money.format(r.cuentaCorriente)} — Enviado a caja fuerte: $ ${money.format(r.cajaFuerte)}</p>
    <div class="a4-total">TOTAL FACTURADO: $ ${money.format(r.total)}</div>
  `;
  ultimoDocumentoParaTicket = { tipo: 'resumen', data: r };
  document.getElementById('btnEnviarImagenWhatsapp').style.display = 'none';
  document.getElementById('btnEnviarImagenA4Whatsapp').style.display = 'none';
  document.getElementById('btnImprimirA4').style.display = 'none';
  document.getElementById('btnEditarTicketRendicion').style.display = 'none';
  document.getElementById('btnEditarTicketCierre').style.display = 'none';
  mostrarTicketComoA4(html);
  showScreen('ticket-screen');
}

// --- Rendiciones ---
let ultimoResumenRendiciones = null;
async function cargarResumenRendiciones() {
  const desde = document.getElementById('resRendDesde').value;
  const hasta = document.getElementById('resRendHasta').value;
  const params = new URLSearchParams();
  if (desde) params.set('desde', desde);
  if (hasta) params.set('hasta', hasta);
  const r = await (await fetch('/api/rendiciones/resumen?' + params.toString())).json();
  ultimoResumenRendiciones = r;
  const filas = r.porCerrajero
    .map((c) => `<tr><td>${c.cerrajero_nombre}</td><td class="a4-num">${c.cantidad}</td><td class="a4-num">$ ${money.format(c.total_pagar)}</td></tr>`)
    .join('');
  document.getElementById('resRendResultado').innerHTML = `
    <p>Total pagado a cerrajeros: <b>$ ${money.format(r.totalGeneral)}</b></p>
    <div class="table-wrap"><table><thead><tr><th>Cerrajero</th><th>Rendiciones</th><th>Total pagado</th></tr></thead><tbody>${filas || '<tr><td colspan="3">Sin rendiciones en el período.</td></tr>'}</tbody></table></div>
  `;
}
function descargarExcelResumenRendiciones() {
  const desde = document.getElementById('resRendDesde').value;
  const hasta = document.getElementById('resRendHasta').value;
  const params = new URLSearchParams();
  if (desde) params.set('desde', desde);
  if (hasta) params.set('hasta', hasta);
  window.open('/api/rendiciones/exportar?' + params.toString(), '_blank');
}
async function verResumenRendicionesA4() {
  if (!ultimoResumenRendiciones) await cargarResumenRendiciones();
  const r = ultimoResumenRendiciones;
  const filas = r.porCerrajero
    .map((c) => `<tr><td>${c.cerrajero_nombre}</td><td class="a4-num">${c.cantidad}</td><td class="a4-num">$ ${money.format(c.total_pagar)}</td></tr>`)
    .join('');
  const html = `
    ${resumenA4Header('Resumen de Rendiciones de cerrajeros', r.desde, r.hasta)}
    <table class="a4-tabla">
      <thead><tr><th>Cerrajero</th><th>Rendiciones</th><th>Total pagado</th></tr></thead>
      <tbody>${filas}</tbody>
    </table>
    <div class="a4-total">TOTAL PAGADO: $ ${money.format(r.totalGeneral)}</div>
  `;
  ultimoDocumentoParaTicket = { tipo: 'resumen', data: r };
  document.getElementById('btnEnviarImagenWhatsapp').style.display = 'none';
  document.getElementById('btnEnviarImagenA4Whatsapp').style.display = 'none';
  document.getElementById('btnImprimirA4').style.display = 'none';
  document.getElementById('btnEditarTicketRendicion').style.display = 'none';
  document.getElementById('btnEditarTicketCierre').style.display = 'none';
  mostrarTicketComoA4(html);
  showScreen('ticket-screen');
}

// --- Gastos ---
let ultimoResumenGastos = null;
async function cargarResumenGastos() {
  const desde = document.getElementById('resGastosDesde').value;
  const hasta = document.getElementById('resGastosHasta').value;
  const params = new URLSearchParams();
  if (desde) params.set('desde', desde);
  if (hasta) params.set('hasta', hasta);
  const r = await (await fetch('/api/reportes/resumen-gastos?' + params.toString())).json();
  ultimoResumenGastos = r;
  const filas = r.porTipo.map((t) => `<tr><td>${t.etiqueta}</td><td class="a4-num">$ ${money.format(t.total)}</td></tr>`).join('');
  document.getElementById('resGastosResultado').innerHTML = `
    <p>Total de gastos: <b>$ ${money.format(r.total)}</b></p>
    <div class="table-wrap"><table><thead><tr><th>Tipo</th><th>Monto</th></tr></thead><tbody>${filas || '<tr><td colspan="2">Sin gastos en el período.</td></tr>'}</tbody></table></div>
  `;
}
function descargarExcelResumenGastos() {
  const desde = document.getElementById('resGastosDesde').value;
  const hasta = document.getElementById('resGastosHasta').value;
  const params = new URLSearchParams();
  if (desde) params.set('desde', desde);
  if (hasta) params.set('hasta', hasta);
  window.open('/api/reportes/exportar-gastos?' + params.toString(), '_blank');
}
async function verResumenGastosA4() {
  if (!ultimoResumenGastos) await cargarResumenGastos();
  const r = ultimoResumenGastos;
  const filas = r.porTipo.map((t) => `<tr><td>${t.etiqueta}</td><td class="a4-num">$ ${money.format(t.total)}</td></tr>`).join('');
  const html = `
    ${resumenA4Header('Resumen de Gastos', r.desde, r.hasta)}
    <table class="a4-tabla">
      <thead><tr><th>Tipo</th><th>Monto</th></tr></thead>
      <tbody>${filas}</tbody>
    </table>
    <div class="a4-total">TOTAL DE GASTOS: $ ${money.format(r.total)}</div>
  `;
  ultimoDocumentoParaTicket = { tipo: 'resumen', data: r };
  document.getElementById('btnEnviarImagenWhatsapp').style.display = 'none';
  document.getElementById('btnEnviarImagenA4Whatsapp').style.display = 'none';
  document.getElementById('btnImprimirA4').style.display = 'none';
  document.getElementById('btnEditarTicketRendicion').style.display = 'none';
  document.getElementById('btnEditarTicketCierre').style.display = 'none';
  mostrarTicketComoA4(html);
  showScreen('ticket-screen');
}

// ============================================================
// Arranque
// ============================================================
cargarSesion();
if (session) aplicarSesion();

cargarFamiliasGlobal().then(cargarStock);
cargarProveedoresGlobal();
cargarCerrajerosGlobal();
cargarConfiguracionGlobal();
