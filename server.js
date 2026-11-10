const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const os      = require('os');
const { spawn } = require('child_process');
const QRCode  = require('qrcode');

const ROOT        = process.pkg ? path.dirname(process.execPath) : __dirname;
const ASSETS_ROOT  = __dirname;
const UPLOADS     = path.join(ROOT, 'uploads');
const CONVERTED   = path.join(ROOT, 'converted');
const DATA_DIR    = path.join(ROOT, 'data');
const JOBS_FILE   = path.join(DATA_DIR, 'jobs.json');
const CONFIG_FILE  = path.join(DATA_DIR, 'config.json');
const PRINTERS_CONFIG_FILE = path.join(DATA_DIR, 'printer-config.json');
const COST_CENTER_FILE = path.join(DATA_DIR, 'cost-center.json');
const SUBMITTED_FILE = path.join(DATA_DIR, 'submitted.json');
const UPLOAD_META_FILE = path.join(DATA_DIR, 'upload-meta.json');
let PRINT_PS    = path.join(ASSETS_ROOT, 'print-image.ps1');
let MAKE_PREVIEW_PS = path.join(ASSETS_ROOT, 'make-preview-pdf.ps1');
let SUMATRA     = path.join(ASSETS_ROOT, 'vendor', 'sumatra', 'SumatraPDF.exe');
if (!process.pkg && !fs.existsSync(SUMATRA)) {
  SUMATRA = 'C:\\Users\\Abhijit\\tools\\sumatra\\SumatraPDF.exe';
}

// Packaged-mode: extract read-only embedded assets to a writable working dir
if (process.pkg) {
  function ensureExtract(rel, destRel) {
    const dest = path.join(ROOT, destRel);
    if (fs.existsSync(dest)) return dest;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const buf = fs.readFileSync(path.join(ASSETS_ROOT, rel));
    fs.writeFileSync(dest, buf);
    return dest;
  }
  try { PRINT_PS = ensureExtract('print-image.ps1', 'print-image.ps1'); } catch (e) { console.error('extract print-image.ps1:', e.message); }
  try { MAKE_PREVIEW_PS = ensureExtract('make-preview-pdf.ps1', 'make-preview-pdf.ps1'); } catch (e) { console.error('extract make-preview-pdf.ps1:', e.message); }
  try { SUMATRA = ensureExtract(path.join('vendor', 'sumatra', 'SumatraPDF.exe'), path.join('vendor', 'sumatra', 'SumatraPDF.exe')); } catch (e) { console.error('extract sumatra:', e.message); }
}
const PORT        = process.env.PORT || 3000;
const HOST_URL    = process.env.HOST_URL || null;
const PWD_FILE    = path.join(DATA_DIR, 'admin-password.txt');
let   ADMIN_PASSWORD = (function () {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  try { if (fs.existsSync(PWD_FILE)) { const p = fs.readFileSync(PWD_FILE, 'utf8').trim(); if (p) return p; } } catch (e) {}
  return 'admin';
})();

if (!fs.existsSync(UPLOADS))   fs.mkdirSync(UPLOADS, { recursive: true });
if (!fs.existsSync(CONVERTED)) fs.mkdirSync(CONVERTED, { recursive: true });
if (!fs.existsSync(DATA_DIR))   fs.mkdirSync(DATA_DIR, { recursive: true });

const app = express();
app.use(express.json());
app.use(express.static(path.join(ASSETS_ROOT, 'public'), { index: false }));

// Serve index.html with the persisted theme applied (avoids flash / async fetch).
app.get('/', (_req, res) => {
  try {
    const htmlPath = path.join(ASSETS_ROOT, 'public', 'index.html');
    let html = fs.readFileSync(htmlPath, 'utf8');
    const theme = getTheme();
    const header = getHeader();
    const favicon = getFavicon();
    html = html.replace('<body>', `<body class="${theme === 'light' ? 'theme-light' : ''}">`);
    html = html.replace('<title>BI Print Service</title>', `<title>${header} - PDF Print</title>`);
    html = html.replace('<h1>BI Print Service</h1>', `<h1>${header} - PDF Print</h1>`);
    if (!/rel="icon"/.test(html)) {
      html = html.replace('</head>', `<link rel="icon" href="${favicon}">\n</head>`);
    } else {
      html = html.replace(/<link rel="icon"[^>]*>/, `<link rel="icon" href="${favicon}">`);
    }
    res.type('html').send(html);
  } catch (e) {
    res.sendFile(path.join(ASSETS_ROOT, 'public', 'index.html'));
  }
});
app.use('/uploads', express.static(UPLOADS));

const storage = multer.diskStorage({
  destination: UPLOADS,
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, Date.now() + '_' + safe);
  }
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

const IMAGE_EXT  = new Set(['.jpg','.jpeg','.png','.gif','.bmp','.tiff','.webp']);
const OFFICE_EXT = new Set(['.doc','.docx','.odt','.odf','.ods','.odp','.rtf']);

// ---------- Job store (file-backed) ----------
let jobs = [];
try {
  if (fs.existsSync(JOBS_FILE)) {
    jobs = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf8')) || [];
  }
} catch (e) { jobs = []; }

function saveJobs() {
  try { fs.writeFileSync(JOBS_FILE, JSON.stringify(jobs, null, 2)); } catch (e) { console.error('saveJobs:', e.message); }
}

function newJobId() {
  return 'JOB-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
}

let config = { serverUrl: process.env.HOST_URL || null, theme: 'dark', headerText: 'BI Print Service', faviconUrl: '/favicon.png' };
try {
  if (fs.existsSync(CONFIG_FILE)) {
    const c = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) || {};
    if (!process.env.HOST_URL && c.serverUrl) config.serverUrl = c.serverUrl;
    if (c.theme) config.theme = c.theme;
    if (c.headerText) config.headerText = c.headerText;
    if (c.faviconUrl) config.faviconUrl = c.faviconUrl;
  }
  if (process.env.THEME) config.theme = process.env.THEME;
  if (process.env.HEADER_TEXT) config.headerText = process.env.HEADER_TEXT;
} catch (e) { /* ignore */ }

let serverUrl = config.serverUrl;

function getServerUrl() {
  if (config.serverUrl) return config.serverUrl;
  const ip = (Object.values(os.networkInterfaces()).flat()
    .find(n => n && n.family === 'IPv4' && !n.internal)?.address) || 'localhost';
  return `http://${ip}:${PORT}/`;
}

function persistConfig() {
  try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2)); } catch (e) { console.error('persistConfig:', e.message); }
}

function setServerUrl(url) {
  config.serverUrl = url;
  serverUrl = url;
  persistConfig();
}

function getHeader() { return (config.headerText && String(config.headerText).trim()) || 'BI Print Service'; }
function setHeader(t) { config.headerText = (t && String(t).trim()) || 'BI Print Service'; persistConfig(); }
function getFavicon() { return (config.faviconUrl && String(config.faviconUrl).trim()) || '/favicon.png'; }
function setFavicon(u) { config.faviconUrl = (u && String(u).trim()) || '/favicon.png'; persistConfig(); }
function getTheme() { return (config.theme === 'light') ? 'light' : 'dark'; }
function setTheme(t) {
  config.theme = (t === 'light') ? 'light' : 'dark';
  persistConfig();
}

function saveServerUrl(url) {
  setServerUrl(url);
}

let submittedFiles = [];
try {
  if (fs.existsSync(SUBMITTED_FILE)) {
    submittedFiles = JSON.parse(fs.readFileSync(SUBMITTED_FILE, 'utf8')) || [];
  }
} catch (e) { submittedFiles = []; }

let uploadMeta = {};
try {
  if (fs.existsSync(UPLOAD_META_FILE)) uploadMeta = JSON.parse(fs.readFileSync(UPLOAD_META_FILE, 'utf8')) || {};
} catch (e) { uploadMeta = {}; }
function saveUploadMeta() {
  try { fs.writeFileSync(UPLOAD_META_FILE, JSON.stringify(uploadMeta, null, 2)); } catch (e) {}
}
function getSessionId(req) {
  const v = req && (req.headers && req.headers['x-session-id']) || (req && req.query && req.query.sid);
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s || s.length > 128) return null;
  return s;
}
function isFileOwner(id, sid, isAdmin) {
  if (isAdmin) return true;
  const owner = (uploadMeta[id] && uploadMeta[id].owner) || null;
  if (owner === null) return true; // legacy/unowned files visible to all
  return owner === sid;
}

function isSubmitted(id) { return Array.isArray(submittedFiles) && submittedFiles.includes(id); }
function markSubmitted(id) {
  if (!Array.isArray(submittedFiles)) submittedFiles = [];
  if (!submittedFiles.includes(id)) { submittedFiles.push(id); try { fs.writeFileSync(SUBMITTED_FILE, JSON.stringify(submittedFiles, null, 2)); } catch(e){} }
}
function unmarkSubmitted(id) {
  submittedFiles = (submittedFiles || []).filter(x => x !== id);
  try { fs.writeFileSync(SUBMITTED_FILE, JSON.stringify(submittedFiles, null, 2)); } catch(e){}
}
function adminAuth(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (token !== ADMIN_PASSWORD) return res.status(401).json({ error: 'unauthorized' });
  next();
}


let printerConfig = {};
try {
  if (fs.existsSync(PRINTERS_CONFIG_FILE)) {
    printerConfig = JSON.parse(fs.readFileSync(PRINTERS_CONFIG_FILE, 'utf8')) || {};
  }
} catch (e) { printerConfig = {}; }

function getPrinterConfig(name) {
  const c = (printerConfig && printerConfig[name]) || {};
  return {
    enabled: c.enabled !== false,
    color:   c.color !== false,
    mono:    c.mono  !== false,
    duplex:  c.duplex === true
  };
}
function savePrinterConfig(cfg) {
  printerConfig = cfg || {};
  try { fs.writeFileSync(PRINTERS_CONFIG_FILE, JSON.stringify(printerConfig, null, 2)); } catch (e) { console.error('savePrinterConfig:', e.message); }
}

// ---------- Cost center (admin-controlled rates) ----------
const COST_KEYS = ['colorNormalSimplex','colorNormalDuplex','colorHighSimplex','colorHighDuplex','monoNormalSimplex','monoNormalDuplex','monoHighSimplex','monoHighDuplex','passportPhoto'];
const DEFAULT_COST_RATES = {
  colorNormalSimplex: 20, colorNormalDuplex: 20,
  colorHighSimplex: 20, colorHighDuplex: 20,
  monoNormalSimplex: 10, monoNormalDuplex: 10,
  monoHighSimplex: 10, monoHighDuplex: 10,
  passportPhoto: 10
};
let costCurrency = 'INR';
let costRates = {};
try {
  if (fs.existsSync(COST_CENTER_FILE)) {
    const c = JSON.parse(fs.readFileSync(COST_CENTER_FILE, 'utf8')) || {};
    costRates = c.rates || {};
    if (c.currency) costCurrency = c.currency;
  }
} catch (e) { costRates = {}; }

function getRate(key) {
  if (Object.prototype.hasOwnProperty.call(costRates, key)) {
    const n = Number(costRates[key]);
    return isNaN(n) ? 0 : n;
  }
  if (DEFAULT_COST_RATES.hasOwnProperty(key)) return DEFAULT_COST_RATES[key];
  return 0;
}
function costKey(job) {
  const color = (job.color !== false && job.color !== 'false' && job.color !== '0') ? 'color' : 'mono';
  const quality = (job.quality === 'high') ? 'High' : 'Normal';
  const side = job.duplex ? 'Duplex' : 'Simplex';
  const c = color.charAt(0).toUpperCase() + color.slice(1);
  return c.toLowerCase() + quality + side;
}
function computeCost(job) {
  if (job.photosPerPage) {
    const rate = (job.photosPerPage / 6) * getRate('passportPhoto');
    const copies = Math.max(1, parseInt(job.copies, 10) || 1);
    return Math.round(rate * copies * 100) / 100;
  }
  const rate = getRate(costKey(job));
  const copies = Math.max(1, parseInt(job.copies, 10) || 1);
  const pages = (job.pageCount && job.pageCount > 0) ? job.pageCount : 1;
  return Math.round(rate * copies * pages * 100) / 100;
}
function saveCostRates(rates, currency) {
  costRates = rates || {};
  if (currency) costCurrency = currency;
  try { fs.writeFileSync(COST_CENTER_FILE, JSON.stringify({ rates: costRates, currency: costCurrency }, null, 2)); } catch (e) { console.error('saveCostRates:', e.message); }
}

function psPrinters() {
  return new Promise((resolve) => {
    const ps = spawn('powershell.exe', ['-NoProfile','-Command',
      'Get-Printer | Select-Object Name | ConvertTo-Json -Compress'], { windowsHide: true });
    let out = '';
    ps.stdout.on('data', d => out += d);
    ps.on('close', () => {
      try {
        const parsed = JSON.parse(out.trim() || '[]');
        const arr = Array.isArray(parsed) ? parsed : [parsed];
        resolve(arr.map(x => x.Name).filter(Boolean).filter(n => !/\(redirected/i.test(n)));
      } catch (e) { resolve([]); }
    });
    ps.on('error', () => resolve([]));
  });
}

function makePreviewPdf(inputImage, cpp, quality, paperSize) {
  return new Promise((resolve) => {
    const outName = 'preview-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6) + '.pdf';
    const outPath = path.join(CONVERTED, outName);
    const p = spawn('powershell.exe', ['-NoProfile','-ExecutionPolicy','Bypass','-File', MAKE_PREVIEW_PS, '-InputImage', inputImage, '-CopiesPerPage', String(cpp || 1), '-Quality', (quality === 'high' ? 'high' : 'normal'), '-PaperSize', (paperSize || 'A4'), '-OutputPdf', outPath], { windowsHide: true });
    let stdout = '', stderr = '';
    const t = setTimeout(() => { p.kill(); resolve({ ok: false, code: -1, stdout, stderr: stderr + '\nTIMEOUT' }); }, 180000);
    p.stdout.on('data', d => stdout += d);
    p.stderr.on('data', d => stderr += d);
    p.on('close', code => {
      clearTimeout(t);
      if (fs.existsSync(outPath)) resolve({ ok: true, pdf: outName, code, stdout, stderr });
      else resolve({ ok: false, code, stdout, stderr: (stderr || 'preview generation failed') + '\n' + stdout });
    });
    p.on('error', e => { clearTimeout(t); resolve({ ok: false, code: -1, stdout, stderr: String(e) }); });
  });
}

async function countPdfPages(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    const { PDFParse } = require('pdf-parse');
    const parser = new PDFParse({ data: buf });
    const result = await parser.getText();
    await parser.destroy();
    if (result && typeof result.total === 'number' && result.total > 0) return result.total;
  } catch (e) {}
  // fallback heuristic
  try {
    const text = fs.readFileSync(filePath).toString('latin1');
    const matches = text.match(/\/Type\s*\/Page[^s]/g);
    if (matches && matches.length) return matches.length;
    const alt = text.match(/\/Type\/Page\b/g);
    if (alt && alt.length) return alt.length;
  } catch (e) {}
  return 1;
}

function parseSelectedPageCount(pagesStr, total) {
  if (!total || total < 1) total = 1;
  const s = String(pagesStr || 'all').trim().toLowerCase();
  if (s === '' || s === 'all' || s === '*' ) return total;
  if (s === 'odd') return Math.ceil(total / 2);
  if (s === 'even') return Math.floor(total / 2);
  if (s === 'last') return 1;
  const parts = s.split(',');
  const set = new Set();
  parts.forEach(tok => {
    tok = tok.trim();
    if (!tok) return;
    const m = tok.match(/^(-?\d+)\s*-\s*(-?\d+)$/);
    if (m) {
      let a = parseInt(m[1], 10); let b = parseInt(m[2], 10);
      if (isNaN(a) || isNaN(b)) return;
      if (a < 0) a = total + a + 1;
      if (b < 0) b = total + b + 1;
      const lo = Math.max(1, Math.min(a, b));
      const hi = Math.min(total, Math.max(a, b));
      for (let i = lo; i <= hi; i++) set.add(i);
    } else {
      const n = parseInt(tok, 10);
      if (isNaN(n)) return;
      const page = n < 0 ? total + n + 1 : n;
      if (page >= 1 && page <= total) set.add(page);
    }
  });
  if (set.size === 0) return 1;
  return set.size;
}
function execFileP(cmd, args, timeoutMs = 120000) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { windowsHide: true });
    let stdout = '', stderr = '';
    const t = setTimeout(() => { p.kill(); resolve({ ok: false, code: -1, stdout, stderr: stderr + '\nTIMEOUT' }); }, timeoutMs);
    p.stdout.on('data', d => stdout += d);
    p.stderr.on('data', d => stderr += d);
    p.on('close', code => { clearTimeout(t); resolve({ ok: code === 0, code, stdout, stderr }); });
    p.on('error', e => { clearTimeout(t); resolve({ ok: false, code: -1, stdout, stderr: String(e) }); });
  });
}

function findSoffice() {
  const candidates = [
    process.env.LIBREOFFICE_PATH,
    'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
    'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  try {
    const r = require('child_process').execSync('where soffice', { windowsHide: true, stdio: ['ignore','pipe','ignore'] }).toString().trim();
    if (r) return r.split(/\r?\n/)[0].trim();
  } catch (e) {}
  return null;
}

function convertToPdf(soffice, filePath) {
  return new Promise((resolve) => {
    const base = path.basename(filePath, path.extname(filePath));
    const targetPdf = path.join(CONVERTED, base + '.pdf');
    try { if (fs.existsSync(targetPdf)) fs.unlinkSync(targetPdf); } catch (e) {}
    const profileDir = path.join(os.tmpdir(), 'lo_profile_' + Date.now());
    const args = [
      '--headless','--invisible','--nofirststartwizard',
      `-env:UserInstallation=file:///${profileDir.replace(/\\/g,'/')}`,
      '--convert-to','pdf','--outdir', CONVERTED, filePath
    ];
    const p = spawn(soffice, args, { windowsHide: true });
    let stdout = '', stderr = '';
    const t = setTimeout(() => { p.kill(); resolve({ ok: false, code: -1, stdout, stderr: stderr + '\nTIMEOUT' }); }, 240000);
    p.stdout.on('data', d => stdout += d);
    p.stderr.on('data', d => stderr += d);
    p.on('close', code => {
      clearTimeout(t);
      if (fs.existsSync(targetPdf)) resolve({ ok: true, pdf: targetPdf, code, stdout, stderr });
      else resolve({ ok: false, code, stdout, stderr: (stderr || 'conversion failed') + '\n' + stdout });
    });
    p.on('error', e => { clearTimeout(t); resolve({ ok: false, code: -1, stdout, stderr: String(e) }); });
  });
}

// performer for an approved job
async function performPrint(job) {
  if (job.printer === 'Print After Edit') {
    return { ok: true, code: 0, stdout: 'Skipped printing (Print After Edit)', stderr: '' };
  }
  const filePath = path.join(UPLOADS, path.basename(job.fileId));
  if (!fs.existsSync(filePath)) throw new Error('file missing: ' + job.fileId);
  const ext = path.extname(filePath).toLowerCase();
  const IMAGE_EXT = new Set(['.jpg','.jpeg','.png','.gif','.bmp','.tiff','.webp']);
  const OFFICE_EXT = new Set(['.doc','.docx','.odt','.odf','.ods','.odp','.rtf']);
  const cfg = getPrinterConfig(job.printer);
  let wantColor = (job.color !== false && job.color !== 'false' && job.color !== '0');
  if (!cfg.color) wantColor = false;
  if (!cfg.mono)  wantColor = true;
  const doDuplex = !!(job.duplex && cfg.duplex);
  const numCopies = Math.max(1, parseInt(job.copies, 10) || 1);

  // If a preview PDF was generated (images), print that instead of the raw image.
  const hasPreview = job.previewPdf && fs.existsSync(path.join(CONVERTED, job.previewPdf));
  if (hasPreview) {
    const printPath = path.join(CONVERTED, job.previewPdf);
    const parts = [];
    if (numCopies > 1) parts.push(numCopies + 'x');
    parts.push(wantColor ? 'color' : 'monochrome');
    if (doDuplex) parts.push('duplex');
    else parts.push('simplex');
    const settings = parts.join(',');
    return execFileP(SUMATRA,
      ['-silent','-print-to', job.printer, '-print-settings', settings, '-exit-when-done', printPath],
      240000);
  }

  if (IMAGE_EXT.has(ext)) {
    return execFileP('powershell.exe',
      ['-NoProfile','-ExecutionPolicy','Bypass','-File', PRINT_PS, '-FilePath', filePath, '-PrinterName', job.printer, '-Color', wantColor ? 'true' : 'false', '-CopiesPerPage', String(job.copiesPerPage || 1), '-Duplex', doDuplex ? 'true' : 'false', '-Copies', String(numCopies)],
      120000);
  }

  let printPath = filePath;
  if (OFFICE_EXT.has(ext)) {
    const soffice = findSoffice();
    if (!soffice) throw new Error('LibreOffice (soffice) not found');
    const conv = await convertToPdf(soffice, filePath);
    if (!conv.ok) throw new Error('conversion failed');
    printPath = conv.pdf;
  }

  const parts = [];
  if (job.pages && String(job.pages).toLowerCase() !== 'all') parts.push(String(job.pages));
  parts.push(wantColor ? 'color' : 'monochrome');
  if (numCopies > 1) parts.push(numCopies + 'x');
  if (doDuplex) parts.push('duplex');
  else parts.push('simplex');
  const settings = parts.join(',');
  return execFileP(SUMATRA,
    ['-silent','-print-to', job.printer, '-print-settings', settings, '-exit-when-done', printPath],
    240000);
}
// ---------- routes ----------
app.post('/api/upload', upload.array('files', 20), (req, res) => {
  const sid = getSessionId(req) || ('srv-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,8));
  const files = (req.files || []).map(f => {
    const id = f.filename;
    uploadMeta[id] = { owner: sid, createdAt: new Date().toISOString() };
    return {
      id,
      name: f.originalname,
      size: f.size,
      type: f.mimetype,
      url: '/uploads/' + encodeURIComponent(id)
    };
  });
  saveUploadMeta();
  res.json({ files, sessionId: sid });
});

app.get('/api/files', (req, res) => {
  const sid = getSessionId(req);
  const list = fs.readdirSync(UPLOADS).map(name => {
    const st = fs.statSync(path.join(UPLOADS, name));
    return { id: name, name, size: st.size, url: '/uploads/' + encodeURIComponent(name), submitted: isSubmitted(name), owner: (uploadMeta[name] && uploadMeta[name].owner) || null };
  }).filter(f => !isSubmitted(f.id) && isFileOwner(f.id, sid, false));
  res.json(list);
});

app.delete('/api/files/:id', (req, res) => {
  const id = path.basename(req.params.id);
  const full = path.join(UPLOADS, id);
  if (!fs.existsSync(full)) return res.status(404).json({ error: 'not found' });
  const sid = getSessionId(req);
  const isAdmin = (req.headers['x-admin-token'] === ADMIN_PASSWORD);
  if (!isFileOwner(id, sid, isAdmin)) return res.status(403).json({ error: 'not owner / unauthorized' });
  try { fs.unlinkSync(full); delete uploadMeta[id]; saveUploadMeta(); unmarkSubmitted(id); res.json({ ok: true, id }); }
  catch (e) { res.status(500).json({ error: String(e) }); }
});

app.get('/api/printers', async (_req, res) => {
  const all = await psPrinters();
  const enabled = (all || []).filter(p => (getPrinterConfig(p).enabled));
  res.json(enabled);
});

app.get('/api/printer-capabilities', async (_req, res) => {
  const all = await psPrinters();
  const out = {};
  (all || []).forEach(p => { out[p] = getPrinterConfig(p); });
  res.json(out);
});

// Create a print job (queued, not printed)
app.post('/api/print', async (req, res) => {
  try {
    const { fileId, printer, color, copiesPerPage, pages, duplex, copies, quality, paperSize, customerName, photosPerPage } = req.body;
    if (!fileId || !printer) return res.status(400).json({ error: 'fileId and printer required' });
    const cust = (customerName == null ? '' : String(customerName)).trim();
    if (cust.length < 5) return res.status(400).json({ error: 'Customer name is required (at least 5 characters).' });
    const filePath = path.join(UPLOADS, path.basename(fileId));
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'file not found' });
    const ext = path.extname(filePath).toLowerCase();

    let previewPdf = null;
    const IMAGE_EXT = new Set(['.jpg','.jpeg','.png','.gif','.bmp','.tiff','.webp']);
    const isEditJob = (printer === 'Print After Edit');
    if (IMAGE_EXT.has(ext) && !isEditJob) {
      const preview = await makePreviewPdf(filePath, Math.max(1, parseInt(copiesPerPage, 10) || 1), quality, paperSize);
      if (!preview.ok) return res.status(500).json({ error: 'preview generation failed', detail: preview });
      previewPdf = preview.pdf;
    }

    let totalPages = 1;
    const OFFICE_EXT2 = new Set(['.doc','.docx','.odt','.odf','.ods','.odp','.rtf']);
    if (IMAGE_EXT.has(ext)) {
      totalPages = 1;
    } else if (OFFICE_EXT2.has(ext)) {
      const soffice = findSoffice();
      if (soffice) {
        const conv = await convertToPdf(soffice, filePath);
        if (conv.ok) totalPages = await countPdfPages(conv.pdf);
      }
    } else {
      totalPages = await countPdfPages(filePath);
    }
    const selectedPagesCount = parseSelectedPageCount((pages && String(pages).trim() !== '') ? String(pages).trim() : 'all', totalPages);
    const numCopies = Math.max(1, parseInt(copies, 10) || 1);
    const job = {
      id: newJobId(),
      fileId: path.basename(fileId),
      fileName: path.basename(fileId).replace(/^\d+_/, ''),
      printer,
      color: (color === false || color === 'false' || color === '0') ? false : true,
      copiesPerPage: Math.max(1, parseInt(copiesPerPage, 10) || 1),
      pages: (pages && String(pages).trim() !== '') ? String(pages).trim() : 'all',
      duplex: (duplex === true || duplex === 'true' || duplex === 'on' || duplex === '1'),
      copies: numCopies,
      customerName: cust,
      previewPdf,
      pageCount: selectedPagesCount,
      paperSize: (paperSize || 'A4'),
      quality: (quality === 'high' ? 'high' : 'normal'),
      status: 'pending',
      created: new Date().toISOString(),
      approvedAt: null,
      completedAt: null,
      error: null,
      result: null
    };
    if (photosPerPage) job.photosPerPage = Math.max(1, parseInt(photosPerPage, 10) || 6);
    if (job.photosPerPage) {
      const _pp = job.photosPerPage;
      const _rate = (_pp / 6) * getRate('passportPhoto');
      job.estimatedCost = Math.round(_rate * numCopies * 100) / 100;
    } else {
      job.estimatedCost = isEditJob ? 100 : computeCost(job);
    }
    jobs.unshift(job);
    saveJobs();
    markSubmitted(job.fileId);
    res.json({ jobId: job.id, status: job.status, previewPdf: job.previewPdf, estimatedCost: job.estimatedCost, customerName: job.customerName });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ ok: false });
  res.json({ ok: true, token: ADMIN_PASSWORD });
});

app.get('/api/admin/jobs', adminAuth, (_req, res) => {
  res.json(jobs);
});

app.post('/api/admin/jobs/:id/approve', adminAuth, async (req, res) => {
  const job = jobs.find(j => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: 'job not found' });
  if (req.body && req.body.printer) job.printer = req.body.printer;
  if (job.status === 'rejected') return res.status(400).json({ error: 'job already rejected' });
  job.status = 'approved';
  job.approvedAt = new Date().toISOString();
  saveJobs();
  try {
    const r = await performPrint(job);
    job.result = r;
    if (r && r.ok) { job.status = 'printed'; }
    else { job.status = 'failed'; job.error = (r && r.stderr) || 'print failed'; }
  } catch (e) {
    job.status = 'failed';
    job.error = String(e);
    job.result = { ok: false, error: String(e) };
  }
  job.completedAt = new Date().toISOString();
  saveJobs();
  res.json(job);
});

app.post('/api/admin/jobs/:id/reject', adminAuth, (req, res) => {
  const job = jobs.find(j => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: 'job not found' });
  if (job.status === 'printed') return res.status(400).json({ error: 'job already printed' });
  job.status = 'rejected';
  job.completedAt = new Date().toISOString();
  saveJobs();
  res.json(job);
});

app.post('/api/admin/jobs/:id/reprint', adminAuth, async (req, res) => {
  const job = jobs.find(j => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: 'job not found' });
  if (req.body && req.body.printer) job.printer = req.body.printer;
  job.status = 'approved';
  job.approvedAt = new Date().toISOString();
  saveJobs();
  try {
    const r = await performPrint(job);
    job.result = r;
    if (r && r.ok) { job.status = 'printed'; }
    else { job.status = 'failed'; job.error = (r && r.stderr) || 'print failed'; }
  } catch (e) {
    job.status = 'failed';
    job.error = String(e);
    job.result = { ok: false, error: String(e) };
  }
  job.completedAt = new Date().toISOString();
  saveJobs();
  res.json(job);
});

app.get('/api/admin/files', adminAuth, (_req, res) => {
  const list = fs.readdirSync(UPLOADS).map(name => {
    const st = fs.statSync(path.join(UPLOADS, name));
    return { id: name, name, size: st.size, url: '/uploads/' + encodeURIComponent(name), submitted: isSubmitted(name), owner: (uploadMeta[name] && uploadMeta[name].owner) || null };
  });
  res.json(list);
});

app.delete('/api/admin/files/:id', adminAuth, (req, res) => {
  const id = path.basename(req.params.id);
  const full = path.join(UPLOADS, id);
  if (!fs.existsSync(full)) return res.status(404).json({ error: 'not found' });
  try { fs.unlinkSync(full); unmarkSubmitted(id); res.json({ ok: true, id }); }
  catch (e) { res.status(500).json({ error: String(e) }); }
});

app.get('/api/admin/printer-config', adminAuth, async (_req, res) => {
  const all = await psPrinters();
  const config = {};
  all.forEach(p => { config[p] = getPrinterConfig(p); });
  Object.keys(printerConfig).forEach(p => { if (!(p in config)) config[p] = getPrinterConfig(p); });
  res.json({ printers: all, config });
});

app.post('/api/admin/printer-config', adminAuth, (req, res) => {
  const incoming = (req.body && req.body.config) || {};
  const merged = {};
  Object.keys(incoming).forEach(k => {
    const c = incoming[k] || {};
    merged[k] = { enabled: c.enabled !== false, color: c.color !== false, mono: c.mono !== false, duplex: c.duplex === true };
    if (!merged[k].color && !merged[k].mono) merged[k].color = true;
  });
  savePrinterConfig(merged);
  res.json({ ok: true });
});

app.get('/api/admin/theme', adminAuth, (_req, res) => { res.json({ theme: getTheme() }); });
app.post('/api/admin/theme', adminAuth, (req, res) => {
  const t = (req.body && req.body.theme) === 'light' ? 'light' : 'dark';
  setTheme(t);
  res.json({ ok: true, theme: getTheme() });
});

app.post('/api/admin/change-password', adminAuth, (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  if (oldPassword !== ADMIN_PASSWORD) return res.status(401).json({ error: 'wrong current password' });
  if (!newPassword || String(newPassword).length < 4) return res.status(400).json({ error: 'new password must be at least 4 characters' });
  ADMIN_PASSWORD = String(newPassword);
  try {
    if (!process.env.ADMIN_PASSWORD) {
      fs.writeFileSync(PWD_FILE, ADMIN_PASSWORD, 'utf8');
    }
  } catch (e) {}
  res.json({ ok: true });
});
app.get('/api/admin/cost-center', adminAuth, async (_req, res) => {
  const all = await psPrinters();
  const rates = {};
  COST_KEYS.forEach(k => { rates[k] = getRate(k); });
  res.json({ currency: costCurrency || 'INR', rates, COST_KEYS });
});

app.post('/api/admin/cost-center', adminAuth, (req, res) => {
  const incoming = (req.body && req.body.rates) || {};
  const rates = {};
  COST_KEYS.forEach(k => { rates[k] = Number(incoming[k]) || 0; });
  saveCostRates(rates, req.body && req.body.currency);
  res.json({ ok: true });
});
app.post('/api/calculate-cost', async (req, res) => {
  try {
    const { fileId, printer, color, quality, duplex, copies, pages, photosPerPage } = req.body || {};
    if (!fileId) return res.status(400).json({ error: 'fileId required' });
    const filePath = path.join(UPLOADS, path.basename(fileId));
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'file not found' });
    const sid = getSessionId(req);
    const isAdmin = (req.headers['x-admin-token'] === ADMIN_PASSWORD);
    if (!isFileOwner(path.basename(fileId), sid, isAdmin)) return res.status(403).json({ error: 'not owner / unauthorized' });
    const ext = path.extname(filePath).toLowerCase();

    if (photosPerPage) {
      const pp = Math.max(1, parseInt(photosPerPage, 10) || 6);
      const numCopies = Math.max(1, parseInt(copies, 10) || 1);
      const rate = (pp / 6) * getRate('passportPhoto');
      const estimatedCost = Math.round(rate * numCopies * 100) / 100;
      return res.json({ pagesTotal: 1, pagesCount: 1, copies: numCopies, rate, currency: costCurrency || 'INR', estimatedCost, key: 'passportPhoto' });
    }

    // determine total pages for the document
    let total = 1;
    const IMAGE_EXT = new Set(['.jpg','.jpeg','.png','.gif','.bmp','.tiff','.webp']);
    const OFFICE_EXT = new Set(['.doc','.docx','.odt','.odf','.ods','.odp','.rtf']);
    if (IMAGE_EXT.has(ext)) {
      total = 1;
    } else if (OFFICE_EXT.has(ext)) {
      const soffice = findSoffice();
      if (!soffice) return res.status(400).json({ error: 'LibreOffice (soffice) not found' });
      const conv = await convertToPdf(soffice, filePath);
      if (!conv.ok) return res.status(500).json({ error: 'conversion failed', detail: conv });
      total = await countPdfPages(conv.pdf);
    } else {
      total = await countPdfPages(filePath);
    }

    const pageStr = (pages && String(pages).trim() !== '') ? String(pages).trim() : 'all';
    const pagesCount = parseSelectedPageCount(pageStr, total);
    const numCopies = Math.max(1, parseInt(copies, 10) || 1);
    const wantColor = (color !== false && color !== 'false' && color !== '0');
    const q = (quality === 'high') ? 'high' : 'normal';
    const isDuplex = (duplex === true || duplex === 'true' || duplex === 'on' || duplex === '1');

    // rate lookup by capability-adjusted printer config
    let ratePrinter = printer;
    if (!ratePrinter) {
      const all = await psPrinters();
      ratePrinter = (all && all.length) ? all[0] : null;
    }
    const cfg = ratePrinter ? getPrinterConfig(ratePrinter) : { color: true, mono: true, duplex: false };
    const effectiveColor = cfg.color ? wantColor : (cfg.mono ? false : wantColor);
    const effectiveDuplex = isDuplex && cfg.duplex;
    const key = (effectiveColor ? 'color' : 'mono') + (q === 'high' ? 'High' : 'Normal') + (effectiveDuplex ? 'Duplex' : 'Simplex');
    const rate = getRate(key);
    const estimatedCost = Math.round(rate * pagesCount * numCopies * 100) / 100;
    res.json({ pagesTotal: total, pagesCount, copies: numCopies, rate, currency: costCurrency || 'INR', estimatedCost, key });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});
app.get('/api/admin/finance', adminAuth, (req, res) => {
  const period = (req.query.period || 'monthly').toLowerCase();
  const eligible = jobs.filter(j => j.status === 'printed' || j.status === 'approved');
  function bucketKey(dateStr) {
    const d = new Date(dateStr || new Date().toISOString());
    if (isNaN(d.getTime())) return null;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    if (period === 'daily') return `${y}-${m}-${day}`;
    if (period === 'yearly') return `${y}`;
    return `${y}-${m}`; // monthly
  }
  const map = new Map();
  eligible.forEach(j => {
    const k = bucketKey(j.completedAt || j.approvedAt || j.created);
    if (!k) return;
    if (!map.has(k)) map.set(k, { label: k, jobs: 0, cost: 0 });
    const b = map.get(k);
    b.jobs += 1;
    b.cost = Math.round((b.cost + (Number(j.estimatedCost) || 0)) * 100) / 100;
  });
  const buckets = Array.from(map.entries())
    .sort((a,b) => a[0].localeCompare(b[0]))
    .map(([k,v]) => ({ label: v.label, jobs: v.jobs, cost: v.cost }));
  const totals = { jobs: buckets.reduce((a,b)=>a+b.jobs,0), cost: Math.round(buckets.reduce((a,b)=>a+b.cost,0)*100)/100 };
  // extra breakdowns
  const byPrinter = {};
  const byQuality = { normal: 0, high: 0 };
  eligible.forEach(j => {
    const pr = j.printer || 'Unknown';
    if (!byPrinter[pr]) byPrinter[pr] = { jobs: 0, cost: 0 };
    byPrinter[pr].jobs += 1;
    byPrinter[pr].cost = Math.round((byPrinter[pr].cost + (Number(j.estimatedCost)||0))*100)/100;
    if (j.quality === 'high') byQuality.high++; else byQuality.normal++;
  });
  res.json({ period, currency: costCurrency || 'INR', buckets, totals, byPrinter, byQuality });
});
app.get('/api/theme', (_req, res) => { res.json({ theme: getTheme() }); });

app.get('/api/header', (_req, res) => {
  res.json({ text: getHeader(), faviconUrl: getFavicon() });
});

app.get('/api/admin/brand', adminAuth, (_req, res) => {
  res.json({ headerText: getHeader(), faviconUrl: getFavicon() });
});

app.post('/api/admin/brand', adminAuth, (req, res) => {
  try {
    const { headerText, faviconDataUrl } = req.body || {};
    if (headerText != null) setHeader(headerText);
    if (faviconDataUrl && typeof faviconDataUrl === 'string' && faviconDataUrl.startsWith('data:')) {
      const m = faviconDataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/);
      if (!m) return res.status(400).json({ error: 'invalid data url' });
      const mime = m[1];
      const ext = (mime.includes('png') ? 'png' : mime.includes('ico') ? 'ico' : mime.includes('svg') ? 'svg' : 'png');
      const buf = Buffer.from(m[2], 'base64');
      const name = 'favicon.' + ext;
      const full = path.join(UPLOADS, name);
      fs.writeFileSync(full, buf);
      setFavicon('/uploads/' + encodeURIComponent(name));
    }
    res.json({ ok: true, headerText: getHeader(), faviconUrl: getFavicon() });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});
app.get('/api/qr', async (_req, res) => {
  const url = getServerUrl();
  const dataUrl = await QRCode.toDataURL(url, { width: 320, margin: 2 });
  res.json({ url, dataUrl });
});

app.get('/api/admin/config', adminAuth, (_req, res) => {
  res.json({ serverUrl: getServerUrl(), persisted: !!config.serverUrl, detected: !config.serverUrl });
});

app.post('/api/admin/config', adminAuth, (req, res) => {
  const { serverUrl: newUrl } = req.body || {};
  const val = String(newUrl || '').trim();
  if (!/^https?:\/\/.+/i.test(val)) {
    return res.status(400).json({ error: 'Invalid URL. Must start with http:// or https://' });
  }
  const normalized = val.endsWith('/') ? val : val + '/';
  saveServerUrl(normalized);
  res.json({ ok: true, serverUrl: normalized });
});

app.post('/api/admin/config/reset', adminAuth, (_req, res) => {
  config.serverUrl = process.env.HOST_URL || null;
  serverUrl = config.serverUrl;
  try { if (fs.existsSync(CONFIG_FILE)) fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2)); } catch (e) {}
  res.json({ ok: true, serverUrl: getServerUrl() });
});

app.listen(PORT, '0.0.0.0', () => {
  const ip = (Object.values(os.networkInterfaces()).flat()
    .find(n => n && n.family === 'IPv4' && !n.internal)?.address) || 'localhost';
  console.log(`BI Print Service running on http://0.0.0.0:${PORT}`);
  console.log(`Open locally: http://localhost:${PORT}/`);
  console.log(`Phone access (same Wi-Fi): http://${ip}:${PORT}/`);
  console.log(`Admin panel: http://localhost:${PORT}/admin.html`);
  console.log(`Admin password: ${ADMIN_PASSWORD}  (set ADMIN_PASSWORD env to change)`);
});
