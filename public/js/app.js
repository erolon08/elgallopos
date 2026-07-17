const titles = { dashboard: 'Dashboard', stock: 'Stock' };

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
}

const money = new Intl.NumberFormat('es-AR');

const ESTADO_LABEL = {
  correcto: { text: 'Correcto', cls: 's-ok' },
  reponer: { text: 'Reponer', cls: 's-bad' },
  sin_stock: { text: 'Sin stock', cls: 's-bad' },
};

let ajusteProductoId = null;

async function cargarFamilias() {
  const res = await fetch('/api/familias');
  const familias = await res.json();
  const select = document.getElementById('stockFamilia');
  familias.forEach((f) => {
    const opt = document.createElement('option');
    opt.value = f.id;
    opt.textContent = f.nombre;
    select.appendChild(opt);
  });
}

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

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeAjuste();
});

const socket = io();
socket.on('stock:updated', (producto) => {
  actualizarFilaEnVivo(producto);
  const badge = document.getElementById('liveBadge');
  badge.textContent = 'Actualizado ' + new Date().toLocaleTimeString('es-AR');
  setTimeout(() => (badge.textContent = 'Sincronizado'), 2000);
});

cargarFamilias().then(cargarStock);
