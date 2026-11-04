const $ = id => document.getElementById(id);
const gallery = $('gallery');
const uploads = [];
let selectedId = null;
let printerCaps = {};

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

async function loadFiles() {
  const files = await api('/api/files');
  const sig = (files || []).map(f => f.id).join('|') + '#' + (files || []).length;
  if (sig === loadFiles.__lastSig) return;
  loadFiles.__lastSig = sig;
  uploads.length = 0; uploads.push(...files);
  if (selectedId && !files.some(f => f.id === selectedId)) selectedId = null;
  renderGallery();
  const printers = await api('/api/printers');
  const sel = $('printerSel');
  const prev = sel.value;
  sel.innerHTML = printers.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('');
  sel.value = printers.includes(prev) ? prev : (printers[0] || '');
  try { printerCaps = await api('/api/printer-capabilities'); } catch (e) { printerCaps = {}; }
  refreshPrinters();
}

function selectedPages(){
  const sel = $('pagesSelect');
  if (!sel) return 'all';
  if (sel.value !== 'custom') return sel.value;
  const v = ($('pagesInput').value || '').trim();
  return v || 'all';
}

function renderGallery(){
  const visible = uploads.filter(f => isImage(f.name));
  if (selectedId && !visible.some(f => f.id === selectedId)) selectedId = null;
  gallery.innerHTML = visible.map(f => {
    const thumbPreview = isImage(f.name) ? `<img src="${f.url}" alt="${esc(f.name)}">` : `<div class="pdfthumb">DOC<br><span>${esc(f.name)}</span></div>`;
    return `<div class="thumb ${selectedId===f.id?'sel':''}" data-id="${esc(f.id)}">
      <button class="rm" data-id="${esc(f.id)}" title="Remove">X</button>
      <div class="preview">${thumbPreview}</div>
      <div class="caption">${esc(f.name)} <small>(${Math.round(f.size/1024)}KB)</small></div>
    </div>`;
  }).join('');
  if (!visible.length) gallery.innerHTML = `<div class="muted" style="grid-column:1/-1;padding:12px">No images uploaded yet.</div>`;
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
  $('printTarget').textContent = f ? `Selected: ${f.name}` : 'Select an image below to print.';
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
  wrap.innerHTML = `<img src="${f.url}" alt="${esc(f.name)}" class="docpreview-img">`;
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
      document.querySelector('.side-item[data-sec="sec-review"]')?.click();
    }
  } catch (e) { $('uploadStatus').textContent = 'Upload failed: ' + e; }
}

document.querySelectorAll('input[name="mode"]').forEach(r => r.addEventListener('change', refreshPrinters));
document.querySelectorAll('input[name="side"]').forEach(r => r.addEventListener('change', refreshPrinters));
$('printerSel').addEventListener('change', refreshPrinters);

function selectedPages(){
  const sel = $('pagesSelect');
  if (!sel) return 'all';
  if (sel.value !== 'custom') return sel.value;
  const v = ($('pagesInput').value || '').trim();
  return v || 'all';
}

$('removeBtn').addEventListener('click', async () => {
  if (!selectedId) return;
  if (!confirm('Delete the selected file?')) return;
  await removeFile(selectedId);
});

$('calcBtn').addEventListener('click', async () => {
  const f = uploads.find(x => x.id === selectedId);
  if (!f) { alert('Select an image first.'); return; }
  const printer = $('printerSel').value;
  const color = document.querySelector('input[name="mode"]:checked').value === 'color';
  const duplex = false; /* side selection removed */
  const copies = parseInt($('copiesInput').value,10) || 1;
  const quality = $('qualitySel') ? $('qualitySel').value : 'normal';
  $('printLog').textContent = 'Calculating...';
  try {
    const r = await api('/api/calculate-cost', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ fileId: f.id, printer, color, copies, quality, duplex, pages: selectedPages(), copiesPerPage: 1 })
    });
    const tbody = document.querySelector('#costTable tbody');
    tbody.innerHTML = `
      <tr><td>Selected file</td><td>${esc(f.name)}</td></tr>
      <tr><td>Printer</td><td>${esc(printer)}</td></tr>
      <tr><td>Print mode</td><td>${color ? 'Color' : 'Black & White'}</td></tr>
      <tr><td>Sides</td><td>${duplex ? 'Both sides (duplex)' : 'Single side'}</td></tr>
      <tr><td>Print quality</td><td>${quality === 'high' ? 'HIGH' : 'Normal'}</td></tr>
      <tr><td>Copies</td><td>${copies}</td></tr>
      <tr><td>Rate per page</td><td>${r.currency} ${Number(r.rate).toFixed(4)}</td></tr>
      <tr><td><b>Total cost</b></td><td><b>${r.currency} ${Number(r.estimatedCost).toFixed(2)}</b></td></tr>`;
    $('costTable').style.display = '';
    $('readyDetail').textContent = `Ready to print. Estimated cost: ${r.currency} ${Number(r.estimatedCost).toFixed(2)}`;
    document.querySelectorAll('.side-item').forEach(b => b.classList.remove('active'));
    const si = document.querySelector('.side-item[data-sec="sec-ready"]'); if (si) si.classList.add('active');
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    const sr = document.getElementById('sec-ready'); if (sr) sr.classList.add('active');
    $('printLog').textContent = '';
    if ($('submitPrintBtn')) $('submitPrintBtn').disabled = false;
  } catch (e) { $('printLog').textContent = 'Error: ' + e; }
});

async function submitImagePrintJob() {
  const f = uploads.find(x => x.id === selectedId);
  if (!f) return;
  const customerName = prompt('Customer name (minimum 5 characters):');
  if (!customerName || customerName.trim().length < 5) { alert('Customer name is required (at least 5 characters).'); return; }
  const printer = $('printerSel').value;
  const color = document.querySelector('input[name="mode"]:checked').value === 'color';
  const duplex = false; /* side selection removed */
  const quality = $('qualitySel') ? $('qualitySel').value : 'normal';
  const readyLog = $('readyLog');
  if (readyLog) readyLog.textContent = 'Submitting print job...';
  try {
    const r = await api('/api/print', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ fileId: f.id, printer, color, copies: parseInt($('copiesInput').value,10) || 1, pages: 'all', duplex, copiesPerPage: 1, quality, customerName: customerName.trim() })
    });
    if (readyLog) readyLog.textContent = r.jobId
      ? `Print job submitted!\nJob ID: ${r.jobId}\nStatus: ${r.status} (waiting for admin approval)\nPrinter: ${printer}\nEstimated cost: ${r.estimatedCost}\nCustomer: ${r.customerName}`
      : JSON.stringify(r, null, 2);
    const btn = $('submitPrintBtn'); if (btn) btn.disabled = true;
    await loadFiles();
  } catch (e) { if (readyLog) readyLog.textContent = 'Error: ' + e; }
}

const submitBtn = $('submitPrintBtn');
if (submitBtn) submitBtn.addEventListener('click', async () => { await submitImagePrintJob(); });

const removeBtn = $('removeBtn');
if (removeBtn) removeBtn.addEventListener('click', async () => {
  if (!selectedId) return;
  if (!confirm('Delete the selected file?')) return;
  await removeFile(selectedId);
});

const okBtn = $('okReviewBtn');
if (okBtn) okBtn.addEventListener('click', async () => {
  const pt = $('printTypeSel');
  const val = pt ? pt.value : 'print_now';
  if (val === 'print_now') {
    document.querySelectorAll('.side-item').forEach(b => b.classList.remove('active'));
    const side = document.querySelector('.side-item[data-sec="sec-print"]');
    if (side) side.classList.add('active');
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    const sec = document.getElementById('sec-print'); if (sec) sec.classList.add('active');
  } else {
    // Print After Edit: create the print job with printer name "Print After Edit" (cost forced to 100)
    const f = uploads.find(x => x.id === selectedId);
    const readyLog = $('readyLog');
    if (!f) { alert('Select an image first.'); return; }
    const customerName = prompt('Customer name (minimum 5 characters):');
    if (!customerName || customerName.trim().length < 5) { alert('Customer name is required (at least 5 characters).'); return; }
    if (readyLog) readyLog.textContent = 'Creating Print After Edit job...';
    try {
      const r = await api('/api/print', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ fileId: f.id, printer: 'Print After Edit', color: true, copies: 1, pages: 'all', duplex: false, copiesPerPage: 1, quality: 'normal', customerName: customerName.trim() })
      });
      if (readyLog) readyLog.textContent = r.jobId
        ? `Print job created (Print After Edit)!\nJob ID: ${r.jobId}\nStatus: ${r.status}\nPrinter: Print After Edit\nCost: ${r.estimatedCost}\nCustomer: ${r.customerName}`
        : JSON.stringify(r, null, 2);
      if ($('submitPrintBtn')) $('submitPrintBtn').disabled = true;
      await loadFiles();
      showSection('sec-ready');
    } catch (e) { if (readyLog) readyLog.textContent = 'Error: ' + e; }
  }
});

document.querySelectorAll('.side-item').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.side-item').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    const t = document.getElementById(btn.dataset.sec);
    if (t) t.classList.add('active');
  });
});

$('pagesSelect')?.addEventListener('change', () => {
  const inp = $('pagesInput');
  if (!inp) return;
  inp.style.display = $('pagesSelect').value === 'custom' ? '' : 'none';
  if (inp.style.display !== 'none') inp.focus();
});

function showSection(sec){
  document.querySelectorAll('.side-item').forEach(b => b.classList.toggle('active', b.dataset.sec === sec));
  document.querySelectorAll('.section').forEach(s => s.classList.toggle('active', s.id === sec));
}
async function applyBranding() {
  try {
    const r = await fetch('/api/header').then(x => x.json());
    const t = r && r.text ? r.text : 'BI Print Service';
    document.title = t + ' - Image Print';
    const h1 = document.querySelector('header.bar h1');
    if (h1) h1.textContent = t + ' - Image Print';
    const fav = r && r.faviconUrl ? r.faviconUrl : '/favicon.png';
    let link = document.querySelector('link[rel~="icon"]');
    if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
    link.href = fav;
  } catch (e) {}
}
applyBranding();

async function applyTheme(){ try { const r = await api('/api/theme'); document.body.classList.toggle('theme-light', r.theme === 'light'); } catch (e) {} }
applyTheme();
setInterval(applyTheme, 15000);

loadFiles();