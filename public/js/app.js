const titles = {
  dashboard: 'Dashboard', productos: 'Productos', familias: 'Familias', stock: 'Stock', clientes: 'Clientes',
  venta: 'Venta', pendientes: 'Pendientes', ventas: 'Ventas', presupuestos: 'Presupuestos', 'ticket-screen': 'Ticket',
  rendicion: 'Rendición cerrajeros',
  caja: 'Caja y turnos',
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
  if (id === 'productos') cargarProductos();
  if (id === 'familias') cargarFamiliasTabla();
  if (id === 'clientes') cargarClientes();
  if (id === 'pendientes') cargarPendientes();
  if (id === 'ventas') cargarVentasHistorial();
  if (id === 'presupuestos') cargarPresupuestos();
  if (id === 'rendicion') { cargarCerrajerosAdmin(); cargarRendiciones(); }
  if (id === 'caja') cargarCaja();
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
    document.getElementById('prodFavorito').checked = !!p.favorito;
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
    clienteEditId = data.id;
    document.getElementById('clienteTitulo').textContent = 'Editar cliente';
    document.getElementById('clienteCodigoBadge').textContent = `N° cliente: ${data.codigo}`;
    document.getElementById('btnEliminarCli').style.display = 'inline-block';
    const actualizado = await (await fetch(`/api/clientes/${data.id}`)).json();
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
  if (!confirm(`¿Importar "${archivo.name}"? Se agregan como clientes nuevos (no actualiza existentes).`)) {
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
    let msg = `Importación completa.\nClientes creados: ${data.creados}\nCódigos renumerados por duplicado: ${data.recodificados}`;
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

const FORMATO_MONEDA_CAJA = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
function moneyStr(v) {
  return FORMATO_MONEDA_CAJA.format(Number(v) || 0);
}

async function cargarCaja() {
  document.getElementById('cajaTerminalLabel').textContent = session.rol;
  const res = await fetch(`/api/caja/turno-activo?terminal=${session.rol}`);
  cajaTurnoActual = await res.json();
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
  movBody.innerHTML = cajaTurnoActual.movimientos.length
    ? [...cajaTurnoActual.movimientos].reverse().map((m) => `
        <tr>
          <td>${new Date(m.creado_en).toLocaleString('es-AR')}</td>
          <td>${m.tipo === 'ingreso' ? 'Ingreso' : 'Egreso'}</td>
          <td>${m.categoria}</td>
          <td>${m.concepto || ''}</td>
          <td>${m.forma_pago || ''}</td>
          <td>${moneyStr(m.monto)}</td>
        </tr>
      `).join('')
    : '<tr><td colspan="6" class="small">Sin movimientos todavía.</td></tr>';
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
  document.getElementById('cajaFormMovimiento').style.display = 'flex';
}

async function confirmarMovimientoCaja() {
  const tipo = document.getElementById('cajaMovTipo').value;
  const categoria = document.getElementById('cajaMovCategoria').value;
  const concepto = document.getElementById('cajaMovConcepto').value;
  const forma_pago = document.getElementById('cajaMovFormaPago').value;
  const monto = document.getElementById('cajaMovMonto').value;
  const res = await fetch(`/api/caja/${cajaTurnoActual.id}/movimientos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tipo, categoria, concepto, forma_pago, monto, usuario_id: session.id }),
  });
  const data = await res.json();
  if (!res.ok) {
    alert('Error: ' + data.error);
    return;
  }
  cajaTurnoActual = data;
  document.getElementById('cajaMovConcepto').value = '';
  document.getElementById('cajaMovMonto').value = '';
  document.getElementById('cajaFormMovimiento').style.display = 'none';
  renderCaja();
}

async function cerrarTurnoCaja() {
  const efectivo_contado = document.getElementById('cajaEfectivoContado').value;
  const observacion = document.getElementById('cajaObservacionCierre').value;
  const res = await fetch(`/api/caja/${cajaTurnoActual.id}/cerrar`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ efectivo_contado, observacion }),
  });
  const data = await res.json();
  if (!res.ok) {
    alert('Error: ' + data.error);
    return;
  }
  const diferencia = data.diferencia;
  cajaTurnoActual = null;
  document.getElementById('cajaEfectivoContado').value = '';
  document.getElementById('cajaObservacionCierre').value = '';
  renderCaja();
  cargarHistorialCaja();
  alert(`Turno cerrado. Diferencia: ${moneyStr(diferencia)}${Math.abs(diferencia) < 1 ? ' (caja exacta)' : diferencia < 0 ? ' (falta)' : ' (sobra)'}`);
}

async function cargarHistorialCaja() {
  const filtroTerminal = session.rol === 'ADMIN' ? '' : `?terminal=${session.rol}`;
  const res = await fetch(`/api/caja${filtroTerminal}`);
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
          <td>${t.estado === 'abierto' ? '<span class="badge green">Abierto</span>' : '<span class="badge">Cerrado</span>'}</td>
        </tr>
      `).join('')
    : '<tr><td colspan="9" class="small">Sin turnos registrados.</td></tr>';
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
  ADMIN: null, // null = todas
  CAJA: ['dashboard', 'venta', 'pendientes', 'ventas', 'presupuestos', 'clientes', 'stock', 'caja'],
  VENTA: ['venta', 'pendientes', 'clientes'],
};

function cargarSesion() {
  const raw = localStorage.getItem('gallo_session');
  session = raw ? JSON.parse(raw) : null;
}

document.querySelectorAll('.login-role').forEach((el) =>
  el.addEventListener('click', () => {
    document.querySelectorAll('.login-role').forEach((x) => x.classList.remove('selected'));
    el.classList.add('selected');
    document.getElementById('loginPassword').focus();
  })
);
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
  const inicio = session.rol === 'VENTA' ? 'venta' : session.rol === 'CAJA' ? 'pendientes' : 'dashboard';
  showScreen(inicio);
}

function actualizarHintVenta() {
  const hint = document.getElementById('ventaHint');
  if (!hint || !session) return;
  hint.textContent =
    session.rol === 'VENTA'
      ? 'En esta terminal, F10 envía la venta a Caja por LAN. No se muestran formas de pago.'
      : 'En esta terminal, F10 abre el cobro directamente.';
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
    document.getElementById('cerAporte').value = c.aporte_fijo;
    document.getElementById('cerDescuentoTarjeta').value = c.descuento_tarjeta_credito;
    document.getElementById('cerActivo').checked = !!c.activo;
  } else {
    document.getElementById('cerNombre').value = '';
    document.getElementById('cerPorcentaje').value = 30;
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
      <td>$ ${money.format(d.monto_base)}</td>
      <td>${d.porcentaje}%</td>
      <td>$ ${money.format(d.monto_rendido)}</td>
    `;
    tbody.appendChild(tr);
  });
  renderRendicionDescuentos();
}

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
  rendicionDescuentosExtra.forEach((d, i) => {
    const row = document.createElement('div');
    row.className = 'toolbar';
    row.style.marginBottom = '4px';
    row.innerHTML = `
      <select style="flex:0 0 110px" onchange="rendicionDescuentosExtra[${i}].tipo=this.value">
        <option value="repuesto" ${d.tipo === 'repuesto' ? 'selected' : ''}>Repuesto</option>
        <option value="adelanto" ${d.tipo === 'adelanto' ? 'selected' : ''}>Adelanto</option>
        <option value="otro" ${d.tipo === 'otro' ? 'selected' : ''}>Otro</option>
      </select>
      <input placeholder="Descripción" value="${d.descripcion || ''}" style="flex:1" oninput="rendicionDescuentosExtra[${i}].descripcion=this.value">
      <input type="number" step="any" placeholder="Monto" value="${d.monto || ''}" style="flex:0 0 110px" oninput="rendicionDescuentosExtra[${i}].monto=Number(this.value)||0; actualizarTotalesRendicionPreview()">
      <button class="btn light" onclick="rendicionDescuentosExtra.splice(${i},1); renderRendicionDescuentos(); actualizarTotalesRendicionPreview()">✕</button>
    `;
    cont.appendChild(row);
  });
  actualizarTotalesRendicionPreview();
}

function agregarDescuentoExtra() {
  rendicionDescuentosExtra.push({ tipo: 'repuesto', descripcion: '', monto: 0 });
  renderRendicionDescuentos();
}

function actualizarTotalesRendicionPreview() {
  const total_bruto = rendicionPreviewActual.total_bruto;
  const aporte = rendicionPreviewActual.cerrajero.aporte_fijo || 0;
  const total_descuentos = aporte + rendicionDescuentosExtra.reduce((s, d) => s + (Number(d.monto) || 0), 0);
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
        <td>$ ${money.format(d.monto_base)}</td><td>${d.porcentaje}%</td><td>$ ${money.format(d.monto_rendido)}</td>
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
        <thead><tr><th>Venta</th><th>Código</th><th>Descripción</th><th>Tipo</th><th>Base</th><th>%</th><th>Rinde</th><th></th></tr></thead>
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

function mostrarFormAgregarLineaRendicion() {
  const cerrajero = cerrajerosCache.find((c) => c.id === rendicionDetalleActualCerrajeroId);
  const cont = document.getElementById('rendAgregarLineaForm');
  cont.style.display = 'block';
  cont.innerHTML = `
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

async function mostrarTicketRendicion(id) {
  const r = await (await fetch(`/api/rendiciones/${id}`)).json();
  ultimoDocumentoParaTicket = { tipo: 'rendicion', data: r };
  document.querySelector('#ticket-screen .btn.green').style.display = 'none';
  document.getElementById('btnEditarTicketRendicion').style.display = r.estado === 'generada' ? '' : 'none';

  const duplicados = r.detalle.filter((d) => d.tipo === 'duplicado');
  const servicios = r.detalle.filter((d) => d.tipo === 'servicio');

  const grupos = {};
  duplicados.forEach((d) => {
    if (!grupos[d.descripcion]) grupos[d.descripcion] = { descripcion: d.descripcion, cantidad: 0, monto_rendido: 0 };
    grupos[d.descripcion].cantidad += Number(d.cantidad) || 0;
    grupos[d.descripcion].monto_rendido += d.monto_rendido;
  });
  const duplicadosHtml = Object.values(grupos)
    .map((g) => {
      const base = g.cantidad ? Math.round(g.monto_rendido / g.cantidad) : g.monto_rendido;
      return `${g.cantidad} x ${g.descripcion}&nbsp;&nbsp;base $${money.format(base)}&nbsp;&nbsp;total $${money.format(g.monto_rendido)}<br>`;
    })
    .join('');

  const serviciosHtml = servicios
    .map(
      (d) =>
        `${d.codigo ? d.codigo + ' — ' : ''}${d.descripcion}&nbsp;&nbsp;$${money.format(d.monto_base)}&nbsp;&nbsp;${d.porcentaje}%&nbsp;&nbsp;$${money.format(d.monto_rendido)}<br>`
    )
    .join('');

  const descuentosHtml = r.descuentos
    .map((d) => `${TIPO_DESCUENTO_LABEL[d.tipo]}${d.descripcion ? ' (' + d.descripcion + ')' : ''}: $${money.format(d.monto)}<br>`)
    .join('');

  document.getElementById('ticketContenido').innerHTML = `
    <img src="/img/logo-badge.png" class="ticket-logo" alt="El Gallo"><h4>CERRAJERÍA EL GALLO</h4>
    <div class="center">RENDICIÓN DE CERRAJERO</div><hr>
    Cerrajero: <b>${r.cerrajero_nombre}</b><br>
    Período: ${r.fecha_desde} a ${r.fecha_hasta}<hr>
    ${duplicadosHtml ? '<b>DUPLICADOS</b><br>' + duplicadosHtml + '<hr>' : ''}
    ${serviciosHtml ? '<b>SERVICIOS</b><br>' + serviciosHtml + '<hr>' : ''}
    Total bruto: $${money.format(r.total_bruto)}<br>
    ${descuentosHtml}
    <div style="font-size:14px;margin-top:4px">TOTAL A PAGAR: <b>$${money.format(r.total_pagar)}</b></div>
  `;
  showScreen('ticket-screen');
}

async function marcarRendicionPagada(id) {
  const res = await fetch(`/api/rendiciones/${id}/pagar`, { method: 'PUT' });
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
  const rows = (await res.json()).slice(0, 12);
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
      div.innerHTML = `
        <div><b>${p.codigo}</b> — ${p.descripcion}</div>
        <div class="sr-precios">
          <button type="button" data-tipo="final">Final<br>$ ${money.format(p.precio_final)}</button>
          <button type="button" data-tipo="debito">Déb/Transf<br>$ ${money.format(p.precio_debito)}</button>
          <button type="button" data-tipo="efectivo">Efectivo<br>$ ${money.format(p.precio_efectivo)}</button>
        </div>`;
      div.querySelectorAll('.sr-precios button').forEach((btn) => {
        btn.onclick = (e) => {
          e.stopPropagation();
          agregarProductoACarrito(p, btn.dataset.tipo);
          cerrar();
        };
      });
    }
    cont.appendChild(div);
  });
  cont.style.display = 'block';
}
document.getElementById('ventaBuscar').addEventListener('input', buscarProductoVenta);
document.getElementById('ventaBuscar').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') document.getElementById('ventaBuscarResultados').style.display = 'none';
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
    div.className = 'botonera-btn';
    const precioTxt = p.usa_mano_obra ? 'Servicio' : '$ ' + money.format(p.precio_final);
    div.innerHTML = `<b>${p.codigo}</b><span>${p.descripcion}</span><small>${precioTxt}</small>`;
    div.onclick = () => agregarProductoACarrito(p);
    cont.appendChild(div);
  });
}

function agregarProductoACarrito(p, tipoElegido) {
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
         <input type="number" step="any" value="${it.precio_unitario}" style="width:100px" oninput="cambiarPrecioServicioLinea(${i}, this.value)">
         ${it.tipo_precio === 'manual' ? `<button class="btn light btn-reset-precio" style="padding:2px 5px;font-size:10px;margin-top:3px" title="Recalcular desde mano de obra" onclick="resetPrecioServicioLinea(${i})">↺ auto</button>` : ''}`
      : `<div class="line-price-choice">
           <button class="${it.tipo_precio === 'final' ? 'active' : ''}" onclick="elegirPrecioLinea(${i},'final')">F</button>
           <button class="${it.tipo_precio === 'debito' ? 'active' : ''}" onclick="elegirPrecioLinea(${i},'debito')">D</button>
           <button class="${it.tipo_precio === 'efectivo' ? 'active' : ''}" onclick="elegirPrecioLinea(${i},'efectivo')">E</button>
         </div>
         <input type="number" step="any" value="${it.precio_unitario}" style="width:100px" oninput="cambiarPrecioLinea(${i}, this.value)">`;
    tr.innerHTML = `
      <td><input type="number" min="1" value="${it.cantidad}" style="width:60px" oninput="cambiarCantidadLinea(${i}, this.value)"></td>
      <td data-col="descripcion">${descripcionCell}${it.es_servicio ? ' <span class="status s-blue">servicio</span>' : ''}</td>
      <td><select onchange="cambiarCerrajeroLineaVenta(${i}, this.value)">${opcionesCerrajero(it.cerrajero_id)}</select></td>
      <td data-col="precio">${precioCell}</td>
      <td><input type="number" min="0" max="100" step="any" value="${it.descuento_pct || 0}" style="width:60px" title="Descuento sobre esta línea" oninput="cambiarDescuentoLineaPct(${i}, this.value)"></td>
      <td>${it.es_servicio ? `<input type="number" step="any" value="${it.monto_mano_obra}" style="width:100px" oninput="cambiarManoObraLinea(${i}, this.value)">` : '—'}</td>
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
async function elegirClienteParaVenta(id) {
  const cliente = await (await fetch(`/api/clientes/${id}`)).json();
  clienteVentaActual = cliente;
  document.getElementById('ventaClienteNombre').textContent = cliente.nombre;
  actualizarDatosClienteVenta();
  showScreen('venta');
}

function limpiarCarrito() {
  carritoVenta = [];
  clienteVentaActual = null;
  ventaPendienteIdEnCurso = null;
  presupuestoOrigenId = null;
  document.getElementById('ventaClienteNombre').textContent = 'Consumidor Final';
  document.getElementById('ventaDescuentoGeneral').value = 0;
  document.getElementById('presupuestoOrigenAviso').textContent = '';
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
}
function closeCobro() {
  document.getElementById('cobroModal').classList.remove('open');
  ventaEnCobroId = null;
}
function volverAMetodos() {
  ['cobroPasoMetodos', 'cobroPasoEfectivo', 'cobroPasoSimple', 'cobroPasoMarca', 'cobroPasoQr', 'cobroPasoCombinado'].forEach((id) => {
    document.getElementById(id).style.display = id === 'cobroPasoMetodos' ? 'block' : 'none';
  });
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
      btn.onclick = () => {
        qrBilleteraElegida = billetera;
        document.getElementById('qrBox').style.display = 'flex';
        document.getElementById('qrMontoTexto').innerHTML = `<b>$ ${money.format(ventaEnCobroTotal)}</b><br>${billetera} <span class="small">(simulado, sin integración real)</span>`;
        document.getElementById('btnConfirmarQr').style.display = 'inline-block';
      };
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
    let texto = `Confirmar ${forma} por $ ${money.format(ventaEnCobroTotal)}.`;
    if (forma === 'Cuenta Corriente') {
      if (!clienteVentaActual) {
        texto = 'No hay cliente seleccionado. La Cuenta Corriente requiere un cliente habilitado.';
      } else if (!clienteVentaActual.venta_a_credito) {
        texto = `⚠ ${clienteVentaActual.nombre} no está habilitado para Cuenta Corriente. Podés continuar de todas formas si lo autorizás.`;
      } else if (ventaEnCobroTotal > clienteVentaActual.limite_credito) {
        texto = `⚠ Esta venta ($ ${money.format(ventaEnCobroTotal)}) supera el límite de crédito de ${clienteVentaActual.nombre} ($ ${money.format(clienteVentaActual.limite_credito)}).`;
      } else {
        texto = `Cuenta Corriente de ${clienteVentaActual.nombre} — $ ${money.format(ventaEnCobroTotal)}. Límite: $ ${money.format(clienteVentaActual.limite_credito)}.`;
      }
    }
    document.getElementById('cobroSimpleTexto').textContent = texto;
    document.getElementById('btnConfirmarSimple').onclick = () => confirmarPagoSimple(forma);
  }
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
  const res = await fetch(`/api/ventas/${ventaEnCobroId}/cobrar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pagos, tipo_comprobante: modoEventual ? 'Eventual' : undefined, usuario_id: session.id, terminal: session.rol }),
  });
  const data = await res.json();
  if (!res.ok) {
    alert('Error: ' + data.error);
    return;
  }
  closeCobro();
  limpiarCarrito();
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
    if (e.key === 'Enter' && document.getElementById('cobroPasoEfectivo').style.display !== 'none') {
      e.preventDefault();
      confirmarPagoSimple('Efectivo');
    }
    return;
  }
  if (e.key === 'F10' && document.getElementById('venta').classList.contains('active')) {
    e.preventDefault();
    cobrarOEnviar();
  }
});

// ============================================================
// TICKET + WHATSAPP
// ============================================================
let ultimoDocumentoParaTicket = null; // { tipo: 'venta'|'presupuesto', data }

function formatearTextoTicket(tipo, doc) {
  const esVenta = tipo === 'venta';
  const fecha = new Date(doc.cobrado_en || doc.creado_en).toLocaleString('es-AR');
  const lineas = doc.items.map((it) => `${it.cantidad} x ${it.descripcion}${it.cerrajero_nombre ? ' (Cerrajero: ' + it.cerrajero_nombre + ')' : ''}  $${money.format(it.precio_unitario * it.cantidad - (it.descuento || 0))}`);
  const pagos = esVenta ? doc.pagos.map((p) => `${p.forma_pago}${p.marca ? ' (' + p.marca + ')' : ''}: $${money.format(p.monto)}`) : [];
  return [
    'CERRAJERÍA EL GALLO',
    esVenta ? `Fecha: ${fecha}` : `Presupuesto — válido ${doc.vigencia_dias} días desde ${fecha}`,
    esVenta ? `N°: ${doc.numero}  ·  ${doc.tipo_comprobante}` : `N°: ${doc.numero}`,
    `Cliente: ${doc.cliente ? doc.cliente.nombre : 'Consumidor Final'}`,
    '--------------------------',
    ...lineas,
    '--------------------------',
    `TOTAL: $${money.format(doc.total)}`,
    ...pagos,
    esVenta ? '¡Gracias por su compra!' : 'Presupuesto sujeto a modificaciones.',
  ].join('\n');
}

function mostrarTicket(venta) {
  ultimoDocumentoParaTicket = { tipo: 'venta', data: venta };
  document.querySelector('#ticket-screen .btn.green').style.display = '';
  document.getElementById('btnEditarTicketRendicion').style.display = 'none';
  const fecha = new Date(venta.cobrado_en || venta.creado_en).toLocaleString('es-AR');
  const lineasHtml = venta.items
    .map((it) => `${it.cantidad} x ${it.descripcion}&nbsp;&nbsp;$${money.format(it.precio_unitario * it.cantidad - (it.descuento || 0))}${it.cerrajero_nombre ? '<br><span style="font-size:11px">&nbsp;&nbsp;Cerrajero: ' + it.cerrajero_nombre + '</span>' : ''}<br>`)
    .join('');
  const pagosHtml = venta.pagos.map((p) => `${p.forma_pago}${p.marca ? ' (' + p.marca + ')' : ''}: $${money.format(p.monto)}<br>`).join('');
  document.getElementById('ticketContenido').innerHTML = `
    <img src="/img/logo-badge.png" class="ticket-logo" alt="El Gallo"><h4>CERRAJERÍA EL GALLO</h4>
    <div class="center">Corrientes Capital</div><hr>
    Fecha: ${fecha}<br>N°: ${venta.numero} · ${venta.tipo_comprobante}<br>
    Cliente: ${venta.cliente ? venta.cliente.nombre : 'Consumidor Final'}<hr>
    ${lineasHtml}<hr>
    TOTAL: <b>$${money.format(venta.total)}</b><br>${pagosHtml}<hr>
    <div class="center">¡Gracias por su compra!</div>
  `;
  showScreen('ticket-screen');
}

function mostrarTicketPresupuesto(presupuesto) {
  ultimoDocumentoParaTicket = { tipo: 'presupuesto', data: presupuesto };
  document.querySelector('#ticket-screen .btn.green').style.display = '';
  document.getElementById('btnEditarTicketRendicion').style.display = 'none';
  const fecha = new Date(presupuesto.creado_en).toLocaleString('es-AR');
  const lineasHtml = presupuesto.items
    .map((it) => `${it.cantidad} x ${it.descripcion}&nbsp;&nbsp;$${money.format(it.precio_unitario * it.cantidad - (it.descuento || 0))}<br>`)
    .join('');
  document.getElementById('ticketContenido').innerHTML = `
    <img src="/img/logo-badge.png" class="ticket-logo" alt="El Gallo"><h4>CERRAJERÍA EL GALLO</h4>
    <div class="center">PRESUPUESTO</div><hr>
    Fecha: ${fecha}<br>N°: ${presupuesto.numero}<br>Válido por ${presupuesto.vigencia_dias} días<br>
    Cliente: ${presupuesto.cliente ? presupuesto.cliente.nombre : 'Consumidor Final'}<hr>
    ${lineasHtml}<hr>
    TOTAL: <b>$${money.format(presupuesto.total)}</b><hr>
    <div class="center">Presupuesto sujeto a modificaciones.</div>
  `;
  showScreen('ticket-screen');
}

function enviarTicketWhatsapp() {
  if (!ultimoDocumentoParaTicket) return;
  enviarPorWhatsapp(ultimoDocumentoParaTicket.tipo, ultimoDocumentoParaTicket.data);
}
function enviarPorWhatsapp(tipo, doc) {
  let telefono = doc.cliente ? doc.cliente.telefono : null;
  if (!telefono) telefono = prompt('Número de WhatsApp del cliente (con característica, sin 0 ni 15):');
  if (!telefono) return;
  const soloNumeros = telefono.replace(/\D/g, '');
  const telFull = soloNumeros.startsWith('54') ? soloNumeros : '549' + soloNumeros;
  const texto = formatearTextoTicket(tipo, doc);
  window.open(`https://wa.me/${telFull}?text=${encodeURIComponent(texto)}`, '_blank');
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
  }
  actualizarDatosClienteVenta();
  for (const it of venta.items) {
    if (it.producto_id) {
      const producto = await (await fetch(`/api/productos/${it.producto_id}`)).json();
      agregarProductoACarrito(producto);
      const linea = carritoVenta[carritoVenta.length - 1];
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
  tr.innerHTML = `
    <td>${v.numero}</td><td>${hora}</td><td>${v.cliente_nombre || 'Consumidor Final'}</td>
    <td>${v.tipo_comprobante}</td><td>${v.forma_pago || '—'}</td><td>$ ${money.format(v.total)}</td>
    <td><span class="status ${estadoCls}">${v.estado}</span></td>
    <td><button class="btn light" onclick="verDetalleVenta(${v.id})">Ver detalle</button></td>
  `;
  return tr;
}
document.getElementById('btnBuscarVentas').addEventListener('click', cargarVentasHistorial);

let ventaDetalleActual = null;
async function verDetalleVenta(id) {
  const venta = await (await fetch(`/api/ventas/${id}`)).json();
  ventaDetalleActual = venta;
  document.getElementById('detalleVentaTitulo').textContent = `Venta N° ${venta.numero}`;
  const filasItems = venta.items
    .map(
      (it) => `
    <tr>
      <td>${it.cantidad}</td><td>${it.descripcion}</td>
      <td><select onchange="cambiarCerrajeroItemDetalle(${it.id}, this.value)">${opcionesCerrajero(it.cerrajero_id)}</select></td>
      <td>$ ${money.format(it.precio_unitario)}</td><td>$ ${money.format(it.precio_unitario * it.cantidad - (it.descuento || 0))}</td>
    </tr>`
    )
    .join('');
  const pagosTxt = venta.pagos.map((p) => `${p.forma_pago}${p.marca ? ' (' + p.marca + ')' : ''}: $ ${money.format(p.monto)}`).join(', ') || '—';
  document.getElementById('detalleVentaContenido').innerHTML = `
    <p><b>Cliente:</b> ${venta.cliente ? venta.cliente.nombre : 'Consumidor Final'} &nbsp; <b>Estado:</b> ${venta.estado} &nbsp; <b>Comprobante:</b> ${venta.tipo_comprobante}</p>
    <div class="table-wrap"><table><thead><tr><th>Cant.</th><th>Descripción</th><th>Cerrajero</th><th>Precio</th><th>Subtotal</th></tr></thead><tbody>${filasItems}</tbody></table></div>
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
  }
  actualizarDatosClienteVenta();
  for (const it of presupuesto.items) {
    const bruto = it.precio_unitario * it.cantidad;
    const descuentoPctGuardado = bruto > 0 && it.descuento ? (Number(it.descuento) / bruto) * 100 : 0;
    if (it.producto_id) {
      const producto = await (await fetch(`/api/productos/${it.producto_id}`)).json();
      agregarProductoACarrito(producto);
      const linea = carritoVenta[carritoVenta.length - 1];
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
// Arranque
// ============================================================
cargarSesion();
if (session) aplicarSesion();

cargarFamiliasGlobal().then(cargarStock);
cargarProveedoresGlobal();
cargarCerrajerosGlobal();
