const $ = id => document.getElementById(id);
const gallery = $('gallery');
const uploads = [];
let selectedId = null;
let currentMode = 'pdf';
let printerCaps = {};
let lastCalc = null;

function getSessionId() {
  try {
    let sid = localStorage.getItem('bi_session_id');
    if (!sid) { sid = (crypto && crypto.randomUUID) ? crypto.randomUUID() : ('s-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,10)); localStorage.setItem('bi_session_id', sid); }
    return sid;
  } catch (e) { return null; }
}

async function api(url, opts) { const r = await fetch(url, Object.assign({}, opts || {}, { headers: Object.assign({}, (opts && opts.headers) || {}, { 'X-Session-Id': getSessionId() || '' }) })); return r.json(); }

function esc(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function isImage(name){ return /\.(png|jpe?g|gif|bmp|webp|tiff)$/i.test(name); }
function isPdf(name){ return /\.pdf$/i.test(name); }

function showSection(sec){
  document.querySelectorAll('.side-item').forEach(b => b.classList.toggle('active', (b.dataset.secs||'').split(/\s+/).includes(sec)));
  document.querySelectorAll('.section').forEach(s => s.classList.toggle('active', s.id === sec));
}

document.querySelectorAll('.side-item').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.side-item').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    const secs = (btn.dataset.secs || btn.dataset.sec || '').split(/\s+/).filter(Boolean);
    secs.forEach(id => { const t = document.getElementById(id); if (t) t.classList.add('active'); });
    if (btn.dataset.mode) { currentMode = btn.dataset.mode; applycurrentMode(); }
  });
});

async function loadFiles() {
  const files = await api('/api/files');
  const sig = (files || []).map(f => f.id).join('|') + '#' + (files || []).length;
  if (sig === loadFiles.__lastSig) return;
  loadFiles.__lastSig = sig;
  uploads.length = 0; uploads.push(...files);
  if (selectedId && !files.some(f => f.id === selectedId)) selectedId = null;
  renderGallery();
  // keep printer list filtered without unnecessary DOM churn
  await refreshPrinters();
}

function selectedPages(){
  const sel = $('pagesSelect');
  if (!sel) return 'all';
  if (sel.value !== 'custom') return sel.value;
  const v = ($('pagesInput').value || '').trim();
  return v || 'all';
}

function renderGallery(){
  const visible = uploads.filter(f => currentMode === 'image' ? isImage(f.name) : !isImage(f.name));
  if (selectedId && !visible.some(f => f.id === selectedId)) selectedId = null;
  gallery.innerHTML = visible.map(f => {
    const thumbPreview = isImage(f.name) ? `<img src="${f.url}" alt="${esc(f.name)}">` : `<div class="pdfthumb">DOC<br><span>${esc(f.name)}</span></div>`;
    return `<div class="thumb ${selectedId===f.id?'sel':''}" data-id="${esc(f.id)}">
      <button class="rm" data-id="${esc(f.id)}" title="Remove">X</button>
      <div class="preview">${thumbPreview}</div>
      <div class="caption">${esc(f.name)} <small>(${Math.round(f.size/1024)}KB)</small></div>
    </div>`;
  }).join('');
  if (!visible.length) gallery.innerHTML = `<div class="muted" style="grid-column:1/-1;padding:12px">No ${currentMode === 'image' ? 'images' : 'documents'} uploaded yet.</div>`;
  gallery.querySelectorAll('.thumb').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target && e.target.classList && e.target.classList.contains('rm')) return;
      selectedId = el.dataset.id; renderGallery(); updatePrintTarget(); renderDocPreview();
    });
  });
  gallery.querySelectorAll('.rm').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Delete this file?')) return;
      await removeFile(btn.dataset.id);
      renderDocPreview();
    });
  });
  updateRemoveBtn();
  updatePrintTarget();
  renderDocPreview();
}

function updatePrintTarget(){
  const f = uploads.find(x => x.id === selectedId);
  $('printTarget').textContent = f ? `Selected: ${f.name}` : 'Select a document below to print.';
  const pageOpts = $('pageOpts');
  if (f && !isImage(f.name)) pageOpts.style.display = '';
  else pageOpts.style.display = 'none';
  updateRemoveBtn();
}

function updateRemoveBtn(){
  const btn = $('removeBtn');
  const f = uploads.find(x => x.id === selectedId);
  btn.disabled = !f;
  btn.onclick = async () => {
    if (!selectedId) return;
    if (!confirm('Delete the selected file?')) return;
    await removeFile(selectedId);
  };
}

async function removeFile(id){
  try {
    await api('/api/files/' + encodeURIComponent(id), { method: 'DELETE' });
    if (selectedId === id) selectedId = null;
    await loadFiles();
  } catch (e) { alert('Remove failed: ' + e); }
}

function renderDocPreview(){
  const wrap = $('docPreview');
  const f = uploads.find(x => x.id === selectedId);
  if (!f) { wrap.innerHTML = ''; wrap.dataset.key = ''; return; }
  const key = f.id + '::' + f.url;
  if (wrap.dataset.key === key) return;
  wrap.dataset.key = key;
  if (isImage(f.name)) {
    wrap.innerHTML = `<img src="${f.url}" alt="${esc(f.name)}" class="docpreview-img">`;
  } else if (isPdf(f.name)) {
    wrap.innerHTML = `<iframe src="${f.url}" class="docpreview-frame" title="${esc(f.name)}"></iframe>
      <div class="muted" style="margin-top:6px">PDF inline preview. If it does not render, open the file directly.</div>`;
  } else {
    wrap.innerHTML = `<div class="fileicon big">DOC</div>`;
  }
}

function syncPrinterCaps(){ /* placeholder */ }

async function refreshPrinters() {
  try { printerCaps = await api('/api/printer-capabilities'); } catch (e) { printerCaps = {}; }
  const allPrinters = Object.keys(printerCaps);
  const mode = document.querySelector('input[name="mode"]:checked')?.value || 'color';
  const side = document.querySelector('input[name="side"]:checked')?.value || 'single';
  const filtered = allPrinters.filter(p => {
    const c = printerCaps[p] || {};
    if (c.enabled === false) return false;
    if (mode === 'color' && !c.color) return false;
    if (mode === 'mono'  && !c.mono)  return false;
    if (side === 'duplex' && !c.duplex) return false;
    return true;
  });
  const sel = $('printerSel');
  const prev = sel.value;
  const currentOptions = Array.from(sel.options).map(o => o.value).join('|');
  const newOptions = filtered.join('|');
  if (currentOptions !== newOptions) {
    sel.innerHTML = filtered.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('');
  }
  if (filtered.includes(prev)) sel.value = prev;
  else if (filtered.length) sel.value = filtered[0];
  if (!sel.value && filtered.length) sel.value = filtered[0];
  updatePrintTarget();
}

function selectedPages(){
  const sel = $('pagesSelect');
  if (!sel) return 'all';
  if (sel.value !== 'custom') return sel.value;
  const v = ($('pagesInput').value || '').trim();
  return v || 'all';
}

function applycurrentMode(){
  const input = $('fileInput');
  const dz = $('dropzone').querySelector('p');
  const heading = $('uploadHeading');
  if (currentMode === 'image') {
    input.accept = 'image/jpeg,.jpg,.jpeg';
    if (dz) dz.textContent = 'Drag and drop JPEG/JPG image here, or click to choose';
    if (heading) heading.textContent = '1. UPLOAD IMAGE';
  } else {
    input.accept = '.pdf';
    if (dz) dz.textContent = 'Drag and drop your PDF here, or click to choose';
    if (heading) heading.textContent = '1. UPLOAD PDF';
  }
}

const dropzone = $('dropzone');
const fileInput = $('fileInput');
dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('over'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('over'));
dropzone.addEventListener('drop', e => { e.preventDefault(); dropzone.classList.remove('over'); handleFiles(e.dataTransfer.files); });
fileInput.addEventListener('change', e => handleFiles(e.target.files));

async function handleFiles(files){
  if (!files || !files.length) return;
  const fd = new FormData();
  for (const f of files) fd.append('files', f);
  $('uploadStatus').textContent = 'Uploading...';
  try {
    const r = await api('/api/upload', { method:'POST', body: fd });
    $('uploadStatus').textContent = `Uploaded ${r.files.length} file(s).`;
    await loadFiles();
    if (r.files && r.files.length) {
      const first = r.files[0];
      if (uploads.some(u => u.id === first.id)) selectedId = first.id;
      renderGallery(); updatePrintTarget(); renderDocPreview();
      // for document uploads, advance to Review; images stay on Upload (preview shown below)
      if (currentMode !== 'image') { document.querySelector('.side-item[data-secs*="sec-review"]')?.click(); }
    }
  } catch (e) { $('uploadStatus').textContent = 'Upload failed: ' + e; }
}

document.querySelectorAll('input[name="mode"]').forEach(r => r.addEventListener('change', refreshPrinters));
document.querySelectorAll('input[name="side"]').forEach(r => r.addEventListener('change', refreshPrinters));
$('printerSel').addEventListener('change', refreshPrinters);

$('pagesSelect').addEventListener('change', () => {
  const inp = $('pagesInput');
  inp.style.display = $('pagesSelect').value === 'custom' ? '' : 'none';
  if (inp.style.display !== 'none') inp.focus();
});

$('removeBtn').addEventListener('click', async () => {
  if (!selectedId) return;
  if (!confirm('Delete the selected file?')) return;
  await removeFile(selectedId);
});

const okReviewBtn = $('okReviewBtn');
if (okReviewBtn) okReviewBtn.addEventListener('click', () => {
  document.querySelector('.side-item[data-secs*="sec-print"]')?.click();
});

$('calcBtn').addEventListener('click', async () => {
  const f = uploads.find(x => x.id === selectedId);
  if (!f) { alert('Select a document first.'); return; }
  const printer = $('printerSel').value;
  const color = document.querySelector('input[name="mode"]:checked').value === 'color';
  const duplex = document.querySelector('input[name="side"]:checked').value === 'duplex';
  const copies = parseInt($('copiesInput').value,10) || 1;
  const quality = $('qualitySel').value;
  const pages = isImage(f.name) ? 'all' : selectedPages();
  $('printLog').textContent = 'Calculating...';
  try {
    const r = await api('/api/calculate-cost', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ fileId: f.id, printer, color, copies, quality, duplex, pages, copiesPerPage: 1 })
    });
    lastCalc = r;
    const tbody = document.querySelector('#costTable tbody');
    tbody.innerHTML = `
      <tr><td>Selected file</td><td>${esc(f.name)}</td></tr>
      <tr><td>Printer</td><td>${esc(printer)}</td></tr>
      <tr><td>Print mode</td><td>${color ? 'Color' : 'Black & White'}</td></tr>
      <tr><td>Sides</td><td>${duplex ? 'Both sides (duplex)' : 'Single side'}</td></tr>
      <tr><td>Print quality</td><td>${quality === 'high' ? 'HIGH' : 'Normal'}</td></tr>
      <tr><td>Pages selected</td><td>${r.pagesCount}</td></tr>
      <tr><td>Copies</td><td>${copies}</td></tr>
      <tr><td>Rate per page</td><td>${r.currency} ${Number(r.rate).toFixed(4)}</td></tr>
      <tr><td><b>Total cost</b></td><td><b>${r.currency} ${Number(r.estimatedCost).toFixed(2)}</b></td></tr>`;
    $('costTable').style.display = '';
    $('readyDetail').textContent = `Ready to print: ${f.name}. Estimated cost: ${r.currency} ${Number(r.estimatedCost).toFixed(2)}`;
    document.querySelector('.side-item[data-secs*="sec-ready"]')?.click();
    $('printLog').textContent = '';
    $('submitPrintBtn').disabled = false;
  } catch (e) { $('printLog').textContent = 'Error: ' + e; }
});

$('submitPrintBtn').addEventListener('click', async () => {
  const f = uploads.find(x => x.id === selectedId);
  if (!f) return;
  const customerName = prompt('Customer name (minimum 5 characters):');
  if (!customerName || customerName.trim().length < 5) { alert('Customer name is required (at least 5 characters).'); return; }
  const printer = $('printerSel').value;
  const color = document.querySelector('input[name="mode"]:checked').value === 'color';
  const duplex = document.querySelector('input[name="side"]:checked').value === 'duplex';
  $('readyLog').textContent = 'Submitting print job...';
  try {
    const r = await api('/api/print', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ fileId: f.id, printer, color, copies: parseInt($('copiesInput').value,10) || 1, pages: (isImage(f.name) ? 'all' : selectedPages()), duplex, copiesPerPage: 1, quality: $('qualitySel').value, customerName: customerName.trim() })
    });
    $('readyLog').textContent = r.jobId
      ? `Print job submitted!\nJob ID: ${r.jobId}\nStatus: ${r.status} (waiting for admin approval)\nPrinter: ${printer}\nEstimated cost: ${r.estimatedCost}\nCustomer: ${r.customerName}`
      : JSON.stringify(r, null, 2);
    $('submitPrintBtn').disabled = true;
    await loadFiles();
  } catch (e) { $('readyLog').textContent = 'Error: ' + e; }
});

function applyTheme(){ try { api('/api/theme').then(r => document.body.classList.toggle('theme-light', r.theme === 'light')); } catch (e) {} }
applyTheme();
setInterval(applyTheme, 15000);

document.querySelectorAll('.tab').forEach(t => {
  t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    currentMode = t.dataset.mode;
    applycurrentMode();
    selectedId = null;
    const firstSide = document.querySelector(`.side-item[data-mode="${t.dataset.mode}"]`) || document.querySelector('.side-item.active');
    document.querySelectorAll('.side-item').forEach(b => b.classList.remove('active'));
    if (firstSide) firstSide.classList.add('active');
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    const up = document.getElementById('sec-upload'); if (up) up.classList.add('active');
    renderGallery(); updatePrintTarget(); renderDocPreview();
  });
});

applycurrentMode();
loadFiles();
setInterval(loadFiles, 8000);