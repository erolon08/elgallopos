const titles = { dashboard: 'Dashboard', productos: 'Productos', familias: 'Familias', stock: 'Stock' };

document.querySelectorAll('.nav button[data-screen]').forEach((b) =>
  b.addEventListener('click', () => showScreen(b.dataset.screen))
);

function showScreen(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  document.querySelectorAll('.nav button[data-screen]').forEach((b) =>
    b.classList.toggle('active', b.dataset.screen === id)
  );
  document.getElementById('screenTitle').textContent = titles[id] || id;
  if (id === 'productos') cargarProductos();
  if (id === 'familias') cargarFamiliasTabla();
}

const money = new Intl.NumberFormat('es-AR');
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
}

async function cargarProveedoresGlobal() {
  const res = await fetch('/api/proveedores');
  proveedoresCache = await res.json();
  populateSelect(document.getElementById('prodProveedor'), proveedoresCache, { placeholder: 'Todos' });

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
    <td><button class="btn light" onclick="openAjuste(${r.id}, '${r.descripcion.replace(/'/g, "\\'")}')">Ajustar</button></td>
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
    body: JSON.stringify({ cantidad, motivo, terminal: 'ADMIN' }),
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
document.getElementById('stockSearch').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') cargarStock();
});
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

function filaProducto(p) {
  const tr = document.createElement('tr');
  const incompletoMsg = p.usa_mano_obra ? 'Falta configurar los recargos de mano de obra' : 'Falta proveedor, costo o precio final';
  const incompletoTag = p.incompleto ? ` <span class="status s-warn" title="${incompletoMsg}">Incompleto</span>` : '';

  const columnasPrecio = p.usa_mano_obra
    ? `<td colspan="3">Fórmula: mano de obra ${formatearRecargos(p.recargos_mano_obra)}</td><td>—</td>`
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
    <td><button class="btn light" onclick="openProducto(${p.id})">Editar</button></td>
  `;
  return tr;
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

function toggleCamposPorFamilia() {
  const esServicio = esFamiliaServicio();
  document.getElementById('prodCamposNormales').style.display = esServicio ? 'none' : 'block';
  document.getElementById('prodCamposServicio').style.display = esServicio ? 'block' : 'none';
  document.getElementById('prodCostoField').style.display = esServicio ? 'none' : 'flex';
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
document.getElementById('prodSearch').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') cargarProductos();
});
['prodFamilia', 'prodProveedor', 'prodStock', 'prodIncompletos'].forEach((id) =>
  document.getElementById(id).addEventListener('change', cargarProductos)
);

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
    document.getElementById('famActiva').checked = !!f.activo;
  } else {
    document.getElementById('famNombre').value = '';
    document.getElementById('famDebito').value = 20;
    document.getElementById('famEfectivo').value = 30;
    document.getElementById('famUsaRendicion').checked = false;
    document.getElementById('famUsaManoObra').checked = false;
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

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeAjuste();
    closeProducto();
    closeFamilia();
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

cargarFamiliasGlobal().then(cargarStock);
cargarProveedoresGlobal();
