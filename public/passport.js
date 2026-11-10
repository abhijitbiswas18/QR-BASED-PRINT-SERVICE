/* Passport Photo Print - client-side, creates print jobs */

const $ = (id) => document.getElementById(id);

// ---------- State ----------
const state = {
  img: null,
  photoSize: 'passport',
  correction: 0.7,
  crop: null,
  faceBox: null,
  resultDataUrl: null,
  bgColor: '#ffffff',
};

const PHOTO_SIZES = { 'passport': { w: 31, h: 41 } };
const MM_TO_PX = 300 / 25.4;

function photoPx() {
  const s = PHOTO_SIZES[state.photoSize];
  return { w: Math.round(s.w * MM_TO_PX), h: Math.round(s.h * MM_TO_PX) };
}
const PAGE_SIZES = {
  'A4':     { w: 210, h: 297 },
  'A5':     { w: 148, h: 210 },
  'Letter': { w: 215.9, h: 279.4 },
  '4x6':    { w: 101.6, h: 152.4 },
};

// ---------- Project API helpers ----------
function getSessionId() {
  try {
    let sid = localStorage.getItem('bi_session_id');
    if (!sid) { sid = (crypto && crypto.randomUUID) ? crypto.randomUUID() : ('s-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,10)); localStorage.setItem('bi_session_id', sid); }
    return sid;
  } catch (e) { return null; }
}
async function api(url, opts) {
  const r = await fetch(url, Object.assign({}, opts || {}, { headers: Object.assign({}, (opts && opts.headers) || {}, { 'X-Session-Id': getSessionId() || '' }) }));
  return r.json();
}
function esc(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// ---------- Theme ----------
try {
  const tt = $('themeToggle');
  if (tt) tt.addEventListener('click', () => {
    document.body.classList.toggle('light');
    tt.textContent = document.body.classList.contains('light') ? '☀️' : '🌙';
  });
} catch (e) {}

// ---------- Upload ----------
const dropZone = $('dropZone');
const fileInput = $('fileInput');
const uploadStatus = $('uploadStatus');

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') fileInput.click(); });
fileInput.addEventListener('change', (e) => handleFile(e.target.files[0]));
['dragenter','dragover'].forEach(ev => dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.add('dragover'); }));
['dragleave','drop'].forEach(ev => dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.remove('dragover'); }));
dropZone.addEventListener('drop', (e) => { if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]); });

function setStatus(el, msg, type) {
  el.textContent = msg;
  el.className = 'status' + (type ? ' ' + type : '');
}

function parseBgColor(s) {
  const v = String(s || '').trim().toLowerCase();
  if (v === '' || v === 'white') return '#ffffff';
  if (v === 'blue' || v === 'light blue' || v === 'lightblue') return '#add8e6';
  if (/^#[0-9a-f]{3,8}$/.test(v)) return v;
  return '#ffffff';
}

async function removeBackgroundAuto(img) {
  const wrap = $('bgProgressWrap');
  const bar = $('bgProgressBar');
  const text = $('bgProgressText');
  const sel = $('bgColorSel');
  const color = sel ? sel.value : (state.bgColor || '#ffffff');
  state.bgColor = color;
  if (wrap) wrap.style.display = '';
  if (bar) bar.style.width = '0%';
  if (text) text.textContent = 'Loading background-removal model...';
  try {
    const removeBackground = (await import('https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/dist/index.mjs')).removeBackground;
    const canvas0 = document.createElement('canvas');
    canvas0.width = img.width;
    canvas0.height = img.height;
    const c0 = canvas0.getContext('2d');
    c0.drawImage(img, 0, 0);
    const blob = await new Promise((res) => canvas0.toBlob(res, 'image/png'));
    if (text) text.textContent = 'Removing background...';
    const fgBlob = await removeBackground(blob, {
      progress: (key, current, total) => {
        if (total) {
          const pct = Math.round((current / total) * 100);
          if (bar) bar.style.width = pct + '%';
          if (text) text.textContent = `Downloading ${key}: ${current}/${total}`;
        }
      }
    });
    if (bar) bar.style.width = '100%';
    if (text) text.textContent = 'Compositing...';
    const fgImg = new Image();
    const fgUrl = URL.createObjectURL(fgBlob);
    await new Promise((res, rej) => { fgImg.onload = res; fgImg.onerror = rej; fgImg.src = fgUrl; });
    const canvas = document.createElement('canvas');
    canvas.width = fgImg.width;
    canvas.height = fgImg.height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(fgImg, 0, 0);
    const dataUrl = canvas.toDataURL('image/png');
    URL.revokeObjectURL(fgUrl);
    const newImg = new Image();
    await new Promise((res, rej) => { newImg.onload = res; newImg.onerror = rej; newImg.src = dataUrl; });
    state.img = newImg;
    state.resultDataUrl = null;
    state.crop = null;
    state.faceBox = null;
    drawOriginal();
    if (text) text.textContent = 'Background removed.';
    setStatus(uploadStatus, 'Background removed. Detecting face...', 'success');
    detectFace();
  } catch (e) {
    console.error(e);
    if (text) text.textContent = 'Background removal failed: ' + e;
    setStatus(uploadStatus, 'Background removal failed; using original.', 'error');
    detectFace();
  } finally {
    if (wrap) setTimeout(() => { wrap.style.display = 'none'; }, 1500);
  }
}

function handleFile(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) { setStatus(uploadStatus, 'Please select an image file.', 'error'); return; }
  setStatus(uploadStatus, 'Loading image...', '');
  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = new Image();
    img.onload = async () => {
      state.img = img;
      drawOriginal();
      $('processCard').hidden = false;
      setStatus(uploadStatus, 'Image loaded. Removing background...', 'success');
      await removeBackgroundAuto(img);
    };
    img.onerror = () => setStatus(uploadStatus, 'Could not load image.', 'error');
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

// ---------- Original preview ----------
const originalCanvas = $('originalCanvas');
const resultCanvas = $('resultCanvas');
const octx = originalCanvas.getContext('2d');
const rctx = resultCanvas.getContext('2d');

function drawOriginal() {
  if (!state.img) return;
  const c = originalCanvas;
  const scale = Math.min(c.width / state.img.width, c.height / state.img.height);
  const w = state.img.width * scale;
  const h = state.img.height * scale;
  octx.clearRect(0,0,c.width,c.height);
  octx.fillStyle = getComputedStyle(document.body).getPropertyValue('--canvas-bg') || '#0b1220';
  octx.fillRect(0,0,c.width,c.height);
  octx.drawImage(state.img, (c.width-w)/2, (c.height-h)/2, w, h);
  if (state.crop) drawCropOverlay(scale, (c.width-w)/2, (c.height-h)/2);
}

function drawCropOverlay(scale, offX, offY) {
  const c = state.crop;
  octx.strokeStyle = '#22c55e';
  octx.lineWidth = 2;
  octx.strokeRect(offX + c.x*scale, offY + c.y*scale, c.w*scale, c.h*scale);
}

// ---------- Face detection ----------
async function loadModels() {
  if (window._modelsLoaded) return true;
  const MODEL_URL = 'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@0.22.2/weights';
  try {
    await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
    window._modelsLoaded = true;
    return true;
  } catch (e) {
    console.error('Model load failed', e);
    return false;
  }
}

async function detectFace() {
  const status = $('detectStatus');
  setStatus(status, 'Loading face detection model...', '');
  const ok = await loadModels();
  if (!ok) {
    setStatus(status, 'Face detection model failed to load. Use manual adjust.', 'error');
    buildCenterCrop();
    renderResult();
    return;
  }
  setStatus(status, 'Detecting face...', '');
  try {
    const det = await faceapi.detectSingleFace(state.img, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.3 }));
    if (!det) {
      setStatus(status, 'No face detected. Using center crop. You can adjust manually.', 'error');
      buildCenterCrop();
      renderResult();
      return;
    }
    state.faceBox = det.box;
    buildCropFromFace(det.box);
    setStatus(status, 'Face detected and centered.', 'success');
  } catch (e) {
    console.error(e);
    setStatus(status, 'Detection error. Using center crop.', 'error');
    buildCenterCrop();
  }
  renderResult();
  drawOriginal();
}

function buildCenterCrop() {
  const img = state.img;
  const target = aspectRatio();
  let w, h;
  if (img.width / img.height > target) {
    h = img.height; w = h * target;
  } else {
    w = img.width; h = w / target;
  }
  state.crop = { x: (img.width - w)/2, y: (img.height - h)/2, w, h };
}

function aspectRatio() {
  const p = photoPx();
  return p.w / p.h;
}

function buildCropFromFace(box) {
  const img = state.img;
  const target = aspectRatio();
  const faceH = box.height;
  let frameH = faceH * (0.35 + 1 + 2.0);
  let frameW = frameH * target;
  const faceCx = box.x + box.width / 2;
  const faceTop = box.y;
  const frameTop = faceTop - faceH * 0.35;
  let x = faceCx - frameW / 2;
  let y = frameTop;
  if (x < 0) x = 0;
  if (y < 0) y = 0;
  if (frameW > img.width) { frameW = img.width; frameH = frameW / target; }
  if (frameH > img.height) { frameH = img.height; frameW = frameH * target; }
  if (x + frameW > img.width) x = img.width - frameW;
  if (y + frameH > img.height) y = img.height - frameH;
  if (x < 0) x = 0;
  if (y < 0) y = 0;
  state.crop = { x, y, w: frameW, h: frameH };
}

// ---------- Color correction ----------
function colorCorrect(ctx, w, h, strength) {
  const imgData = ctx.getImageData(0,0,w,h);
  const d = imgData.data;
  let rSum=0,gSum=0,bSum=0,n=0;
  for (let i=0;i<d.length;i+=4){ rSum+=d[i]; gSum+=d[i+1]; bSum+=d[i+2]; n++; }
  const rMean=rSum/n, gMean=gSum/n, bMean=bSum/n;
  const gray = (rMean+gMean+bMean)/3;
  const rScale = 1 + (gray/rMean - 1)*strength;
  const gScale = 1 + (gray/gMean - 1)*strength;
  const bScale = 1 + (gray/bMean - 1)*strength;
  const contrast = 1 + 0.15*strength;
  const brightness = 5*strength;
  for (let i=0;i<d.length;i+=4){
    let r = d[i]*rScale;
    let g = d[i+1]*gScale;
    let b = d[i+2]*bScale;
    r = (r-128)*contrast + 128 + brightness;
    g = (g-128)*contrast + 128 + brightness;
    b = (b-128)*contrast + 128 + brightness;
    d[i]   = Math.max(0,Math.min(255,r));
    d[i+1] = Math.max(0,Math.min(255,g));
    d[i+2] = Math.max(0,Math.min(255,b));
  }
  ctx.putImageData(imgData,0,0);
}

// ---------- Render result ----------
function renderResult() {
  if (!state.img || !state.crop) return;
  const p = photoPx();
  resultCanvas.width = p.w;
  resultCanvas.height = p.h;
  const c = state.crop;
  rctx.clearRect(0,0,p.w,p.h);
  rctx.fillStyle = state.bgColor || '#ffffff';
  rctx.fillRect(0,0,p.w,p.h);
  rctx.drawImage(state.img, c.x, c.y, c.w, c.h, 0, 0, p.w, p.h);
  colorCorrect(rctx, p.w, p.h, state.correction);
  state.resultDataUrl = resultCanvas.toDataURL('image/png');
  drawOriginal();
}

// ---------- Manual adjust ----------
function nudge(dx, dy) {
  if (!state.crop) return;
  state.crop.x = Math.max(0, Math.min(state.img.width - state.crop.w, state.crop.x + dx));
  state.crop.y = Math.max(0, Math.min(state.img.height - state.crop.h, state.crop.y + dy));
  renderResult();
}
function zoom(factor) {
  if (!state.crop) return;
  const img = state.img;
  const c = state.crop;
  const cx = c.x + c.w/2;
  const cy = c.y + c.h/2;
  let newW = c.w * factor;
  let newH = c.h * factor;
  const target = aspectRatio();
  newH = newW / target;
  let x = cx - newW/2;
  let y = cy - newH/2;
  if (x < 0) x = 0;
  if (y < 0) y = 0;
  if (x + newW > img.width) { newW = img.width - x; newH = newW/target; }
  if (y + newH > img.height) { newH = img.height - y; newW = newH*target; }
  if (newW < 40 || newH < 40) return;
  state.crop = { x, y, w: newW, h: newH };
  renderResult();
}

$('nudgeUp').addEventListener('click', () => nudge(0, -state.crop.h*0.05));
$('nudgeDown').addEventListener('click', () => nudge(0, state.crop.h*0.05));
$('nudgeLeft').addEventListener('click', () => nudge(-state.crop.w*0.05, 0));
$('nudgeRight').addEventListener('click', () => nudge(state.crop.w*0.05, 0));
$('zoomIn').addEventListener('click', () => zoom(0.9));
$('zoomOut').addEventListener('click', () => zoom(1.1));
$('reDetect').addEventListener('click', () => detectFace());

// ---------- Controls ----------
$('photoSize').addEventListener('change', (e) => {
  state.photoSize = e.target.value;
  if (state.faceBox) buildCropFromFace(state.faceBox);
  else if (state.crop) buildCenterCrop();
  renderResult();
});
const _bgSel = $('bgColorSel');
if (_bgSel) _bgSel.addEventListener('change', (e) => { state.bgColor = e.target.value; });
$('correctionStrength').addEventListener('input', (e) => {
  state.correction = e.target.value / 100;
  $('correctionValue').textContent = e.target.value + '%';
  renderResult();
});
$('showBefore').addEventListener('change', (e) => {
  if (e.target.checked) {
    const p = photoPx();
    rctx.clearRect(0,0,p.w,p.h);
    rctx.fillStyle = state.bgColor || '#ffffff';
    rctx.fillRect(0,0,p.w,p.h);
    const c = state.crop;
    rctx.drawImage(state.img, c.x, c.y, c.w, c.h, 0, 0, p.w, p.h);
  } else {
    renderResult();
  }
});

// ---------- Print flow ----------
$('toPrintBtn').addEventListener('click', () => {
  $('printCard').hidden = false;
  $('printCard').scrollIntoView({ behavior: 'smooth' });
  updatePrintPreview();
  loadPrinters();
});
$('backToEdit').addEventListener('click', () => { $('printCard').hidden = true; });

const pageSizeSel = $('pageSize');
const photosSel = $('photosPerPage');
const showBorderCb = $('showBorder');
[pageSizeSel, photosSel, showBorderCb].forEach(el => el.addEventListener('change', updatePrintPreview));

function colsForCount() { return 6; }

function updatePrintPreview() {
  const preview = $('printPreview');
  const page = PAGE_SIZES[pageSizeSel.value];
  const photo = PHOTO_SIZES[state.photoSize];
  const count = parseInt(photosSel.value, 10);
  const border = showBorderCb.checked;
  const cols = 6;
  const rows = Math.ceil(count / cols);
  preview.innerHTML = '';
  const pxPerMm = 96 / 25.4;
  preview.style.width = (page.w * pxPerMm) + 'px';
  preview.style.height = (page.h * pxPerMm) + 'px';
  preview.style.transformOrigin = 'top center';
  const wrap = preview.parentElement;
  const avail = (wrap.clientWidth || 600) - 16;
  const scale = Math.min(1, avail / (page.w * pxPerMm));
  preview.style.transform = `scale(${scale})`;
  preview.style.transformOrigin = 'top left';
  wrap.style.height = (page.h * pxPerMm * scale + 24) + 'px';
  wrap.style.overflow = 'hidden';
  preview.style.position = 'relative';
  preview.style.boxSizing = 'border-box';
  preview.style.display = 'grid';
  preview.style.gridTemplateColumns = `repeat(${cols}, ${photo.w}mm)`;
  preview.style.gap = '7mm 2.4mm';
  preview.style.padding = '6mm';
  preview.style.alignContent = 'start';
  preview.style.justifyContent = 'center';
  for (let i = 0; i < count; i++) {
    const slot = document.createElement('div');
    slot.style.background = '#fff';
    slot.style.boxSizing = 'border-box';
    slot.style.width = photo.w + 'mm';
    slot.style.height = photo.h + 'mm';
    slot.style.display = 'flex';
    slot.style.alignItems = 'center';
    slot.style.justifyContent = 'center';
    const img = document.createElement('img');
    img.src = state.resultDataUrl;
    img.style.width = photo.w + 'mm';
    img.style.height = photo.h + 'mm';
    if (border) img.style.border = '3px solid #000';
    img.style.boxSizing = 'border-box';
    slot.appendChild(img);
    preview.appendChild(slot);
  }
  window._printConfig = { page: pageSizeSel.value, count, border };
}

// ---------- Printers ----------
async function loadPrinters() {
  try {
    const printers = await api('/api/printers');
    const sel = $('printerSel');
    const prev = sel.value;
    sel.innerHTML = printers.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('');
    sel.value = printers.includes(prev) ? prev : (printers[0] || '');
  } catch (e) {}
}

// ---------- Render layout to canvas ----------
async function renderLayoutCanvas() {
  const cfg = window._printConfig || { page: 'A4', count: 12, border: true };
  const page = PAGE_SIZES[cfg.page];
  const photo = PHOTO_SIZES[state.photoSize];
  const count = cfg.count;
  const border = cfg.border;
  const cols = 6;
  const pxPerMm = 300 / 25.4;
  const canvasW = Math.round(page.w * pxPerMm);
  const canvasH = Math.round(page.h * pxPerMm);
  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvasW, canvasH);

  // load result image
  const img = new Image();
  img.src = state.resultDataUrl;
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });

  const margin = 6;
  const gutterH = 2.4;
  const gutterV = 7;
  const photoWpx = Math.round(photo.w * pxPerMm);
  const photoHpx = Math.round(photo.h * pxPerMm);
  const marginPx = Math.round(margin * pxPerMm);
  const gutterHPx = Math.round(gutterH * pxPerMm);
  const gutterVPx = Math.round(gutterV * pxPerMm);

  for (let i = 0; i < count; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = marginPx + col * (photoWpx + gutterHPx);
    const y = marginPx + row * (photoHpx + gutterVPx);
    ctx.drawImage(img, x, y, photoWpx, photoHpx);
    if (border) {
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = Math.round(3 * (300/96));
      ctx.strokeRect(x + 0.5, y + 0.5, photoWpx - 1, photoHpx - 1);
    }
  }
  return canvas;
}

// track uploaded layout file id
state.layoutFileId = null;

// ---------- Calculate cost ----------
$('calcBtn').addEventListener('click', async () => {
  if (!state.resultDataUrl) { alert('Generate a passport photo first.'); return; }
  const printer = $('printerSel').value;
  if (!printer) { alert('Select a printer.'); return; }
  $('jobStatus').textContent = 'Rendering print layout...';
  try {
    const canvas = await renderLayoutCanvas();
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
    const fd = new FormData();
    fd.append('files', new File([blob], 'passport-print.png', { type: 'image/png' }));
    $('jobStatus').textContent = 'Uploading layout...';
    const up = await api('/api/upload', { method: 'POST', body: fd });
    if (!up.files || !up.files.length) throw new Error('upload failed');
    state.layoutFileId = up.files[0].id;

    const color = document.querySelector('input[name="mode"]:checked').value === 'color';
    const copies = parseInt($('copiesInput').value, 10) || 1;
    const quality = $('qualitySel').value;
    $('jobStatus').textContent = 'Calculating cost...';
    const photosPerPage = parseInt(photosSel.value, 10) || 6;
    const r = await api('/api/calculate-cost', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileId: state.layoutFileId, printer, color, copies, quality, duplex: false, pages: 'all', photosPerPage })
    });
    $('jobStatus').textContent = `Layout ready. Estimated cost: ${r.currency} ${Number(r.estimatedCost).toFixed(2)} (rate/page ${r.currency} ${Number(r.rate).toFixed(4)}, pages ${r.pagesCount})`;
    $('createJobBtn').disabled = false;
  } catch (e) {
    $('jobStatus').textContent = 'Error: ' + e;
  }
});

// ---------- Create print job ----------
$('createJobBtn').addEventListener('click', async () => {
  if (!state.resultDataUrl) { alert('Generate a passport photo first.'); return; }
  const printer = $('printerSel').value;
  if (!printer) { alert('Select a printer.'); return; }
  if (!state.layoutFileId) { alert('Click "Calculate cost" first.'); return; }
  const customerName = prompt('Customer name (minimum 5 characters):');
  if (!customerName || customerName.trim().length < 5) { alert('Customer name is required (at least 5 characters).'); return; }

  const color = document.querySelector('input[name="mode"]:checked').value === 'color';
  const copies = parseInt($('copiesInput').value, 10) || 1;
  const quality = $('qualitySel').value;
  const photosPerPage = parseInt(photosSel.value, 10) || 6;
  $('jobStatus').textContent = 'Creating print job...';
  try {
    const r = await api('/api/print', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileId: state.layoutFileId, printer, color, copies, pages: 'all', duplex: false, copiesPerPage: 1, quality, photosPerPage, customerName: customerName.trim() })
    });
    if (r.jobId) {
      $('jobStatus').textContent = `Print job created!\nJob ID: ${r.jobId}\nStatus: ${r.status}\nPrinter: ${printer}\nEstimated cost: ${r.estimatedCost}\nCustomer: ${r.customerName}`;
      $('createJobBtn').disabled = true;
      state.layoutFileId = null;
    } else {
      $('jobStatus').textContent = JSON.stringify(r, null, 2);
    }
  } catch (e) {
    $('jobStatus').textContent = 'Error: ' + e;
  }
});

// ---------- Init branding/theme ----------
async function applyBranding() {
  try {
    const r = await fetch('/api/header').then(x => x.json());
    const t = r && r.text ? r.text : 'BI Print Service';
    document.title = t + ' - Passport Photo Print';
    const h1 = document.querySelector('header.bar h1');
    if (h1) h1.textContent = t + ' - Passport Photo Print';
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
