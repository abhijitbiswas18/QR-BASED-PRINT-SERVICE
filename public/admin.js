// Theme (dark/light) persisted per browser
(function(){
  const t = localStorage.getItem('bi_admin_theme') || 'dark';
  if (t === 'light') document.body.classList.add('theme-light');
})();
const $ = id => document.getElementById(id);
async function applyBranding() {
  try {
    const r = await fetch('/api/header').then(x => x.json());
    const t = r && r.text ? r.text : 'BI Print Service';
    document.title = t + ' - Admin Panel';
    const h1 = document.querySelector('header.bar h1');
    if (h1) h1.textContent = t + ' - Admin Panel';
    const fav = r && r.faviconUrl ? r.faviconUrl : '/favicon.png';
    let link = document.querySelector('link[rel~="icon"]');
    if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
    link.href = fav;
  } catch (e) {}
}
applyBranding();
const TOKEN_KEY = 'bi_admin_token';
let token = localStorage.getItem(TOKEN_KEY) || '';
let printersCache = [];
let allJobs = [];
const pendingPrinter = {}; // preserve in-progress printer overrides across auto-refresh

async function api(url, opts={}) {
  const headers = Object.assign({}, opts.headers || {});
  if (token) headers['x-admin-token'] = token;
  const r = await fetch(url, Object.assign({}, opts, { headers }));
  if (r.status === 401) { logout(); throw new Error('unauthorized'); }
  return r.json();
}

function logout() {
  token = '';
  localStorage.removeItem(TOKEN_KEY);
  $('panel').style.display = 'none';
  $('loginCard').style.display = '';
}

async function login() {
  const pw = $('adminPw').value;
  const r = await fetch('/api/admin/login', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ password: pw })
  }).then(x=>x.json());
  if (r && r.ok) {
    token = r.token;
    localStorage.setItem(TOKEN_KEY, token);
    $('loginCard').style.display = 'none';
    $('panel').style.display = '';
    await loadPrinters();
    await loadServerUrl();
    await loadPrinterCfg();
    await loadAdminQr();
    await loadAdminTheme();
    await loadAdminFiles();
    await loadCostCenter();
    await loadBranding();
    await loadFinance();
    await loadJobs();
    document.querySelectorAll('.side-item').forEach(b => b.classList.remove('active'));
    document.querySelector('.side-item[data-section="sec-jobs"]')?.classList.add('active');
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.getElementById('sec-jobs')?.classList.add('active');
    startAuto();
  } else {
    $('loginErr').textContent = 'Wrong password.';
  }
}

async function loadPrinters() {
  try { printersCache = await api('/api/printers'); } catch (e) { printersCache = []; }
}

async function loadPrinterCfg() {
  try {
    const r = await api('/api/admin/printer-config');
    const all = r.printers || [];
    systemPrinters = all;
    const cfg = r.config || {};
    const body = $('printerCfgBody');
    if (!all.length) { body.innerHTML = '<tr><td colspan="5" class="muted">No system printers found.</td></tr>'; return; }
    body.innerHTML = all.map(p => {
      const c = cfg[p] || {enabled:true,color:true,mono:true,duplex:false};
      return `<tr>
        <td>${esc(p)}</td>
        <td><input type="checkbox" class="pc-enabled" data-p="${esc(p)}" ${c.enabled?'checked':''}></td>
        <td><input type="checkbox" class="pc-color" data-p="${esc(p)}" ${c.color?'checked':''}></td>
        <td><input type="checkbox" class="pc-mono" data-p="${esc(p)}" ${c.mono?'checked':''}></td>
        <td><input type="checkbox" class="pc-duplex" data-p="${esc(p)}" ${c.duplex?'checked':''}></td>
      </tr>`;
    }).join('');
    $('printerCfgStatus').textContent = 'Loaded ' + all.length + ' printer(s).';
  } catch (e) { $('printerCfgStatus').textContent = 'Error: ' + e; }
}
async function savePrinterCfg() {
  const cfg = {};
  document.querySelectorAll('#printerCfgBody tr').forEach(row => {
    if (!row.cells || row.cells.length < 5) return;
    const name = row.cells[0].textContent.trim();
    const enabled = row.querySelector('.pc-enabled').checked;
    const color   = row.querySelector('.pc-color').checked;
    const mono    = row.querySelector('.pc-mono').checked;
    const duplex  = row.querySelector('.pc-duplex').checked;
    cfg[name] = { enabled, color: (color || !mono), mono: (mono || !color), duplex };
    if (!cfg[name].color && !cfg[name].mono) cfg[name].color = true;
  });
  await api('/api/admin/printer-config', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ config: cfg }) });
  $('printerCfgStatus').textContent = 'Saved.';
  await loadPrinters();
}

$('refreshPrintersBtn').addEventListener('click', loadPrinterCfg);
$('savePrinterCfgBtn').addEventListener('click', async () => {
  try { await savePrinterCfg(); } catch (e) { $('printerCfgStatus').textContent = 'Error: ' + e; }
});

function statusBadge(s) {
  return `<span class="badge st-${s}">${s}</span>`;
}

function renderJobs() {
  const filter = ($('statusFilter') && $('statusFilter').value) || 'all';
  const source = Array.isArray(allJobs) ? allJobs : [];
  let jobs = (filter === 'all') ? source : source.filter(j => j.status === filter);
  const q = (($('jobSearch') && $('jobSearch').value) || '').trim().toLowerCase();
  if (q) {
    jobs = jobs.filter(j => [j.id, j.printer, j.fileId, j.fileName, j.status, j.error, j.pages, j.quality, j.customerName]
      .some(v => v != null && String(v).toLowerCase().includes(q)));
  }
  const body = $('jobsBody');
  if (!jobs || !jobs.length) { body.innerHTML = '<tr><td colspan="13" class="muted">No matching jobs.</td></tr>'; return; }
  body.innerHTML = jobs.map((j, idx) => {
    const chosen = pendingPrinter[j.id] || j.printer;
    const printerOpts = printersCache.map(p => `<option value="${esc(p)}" ${p===chosen?'selected':''}>${esc(p)}</option>`).join('');
    const created = new Date(j.created).toLocaleString();
    const downloadLink = `<a class="btn-sm" style="background:#0f172a;border:1px solid #475569;color:#93c5fd;text-decoration:none" href="/uploads/${encodeURIComponent(j.fileId)}" download="${esc(j.fileName)}">Download</a>`;
    const actions = (j.status === 'pending' || j.status === 'approved')
      ? `<div class="row-actions">
           <select class="job-printer" data-id="${esc(j.id)}">${printerOpts}</select>
           <button class="btn-sm btn-ok" data-action="approve" data-id="${esc(j.id)}">Approve & Print</button>
           <button class="btn-sm btn-danger" data-action="reject" data-id="${esc(j.id)}">Reject</button>
           ${downloadLink}
         </div>` :
      (j.status === 'failed'
        ? `<div class="row-actions">
             <select class="job-printer" data-id="${esc(j.id)}">${printerOpts}</select>
             <button class="btn-sm btn-ok" data-action="approve" data-id="${esc(j.id)}">Retry</button>
             ${downloadLink}
           </div>` :
      (j.status === 'printed'
        ? `<div class="row-actions">
             <select class="job-printer" data-id="${esc(j.id)}">${printerOpts}</select>
             <button class="btn-sm btn-ok" data-action="reprint" data-id="${esc(j.id)}">Reprint</button>
             ${downloadLink}
           </div>`
        : `<div class="row-actions">${downloadLink}</div>`));
    const resText = j.error ? `<div style="color:#fca5a5;font-size:11px">${esc(j.error)}</div>` : '';
    return `<tr>
      <td>${idx + 1}</td>
      <td>${esc(j.customerName || '')}</td>
      <td><code>${esc(j.id)}</code></td>
      <td>${esc(j.printer)}</td>
      <td>${j.color ? 'Color' : 'B&W'}</td>
      <td>${esc(j.pages)}</td>
      <td>${j.copies || 1}</td>
      <td>${j.copiesPerPage}</td>
      <td>${j.quality === 'high' ? 'HIGH' : 'Normal'}</td>
      <td>${statusBadge(j.status)}${resText}</td>
      <td>${created}</td>
      <td>${Number(j.estimatedCost || 0).toFixed(2)}</td>
      <td>${actions}</td>
    </tr>`;
  }).join('');

  // record manual printer overrides so auto-refresh doesn't reset them
  body.querySelectorAll('[data-action="reprint"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const sel = body.querySelector(`.job-printer[data-id="${id}"]`);
      const printer = sel ? sel.value : null;
      btn.disabled = true; btn.textContent = 'Reprinting...';
      try {
        const updated = await api(`/api/admin/jobs/${encodeURIComponent(id)}/reprint`, {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ printer })
        });
        alert(updated.status === 'printed' ? `Reprinted successfully (${updated.id})` : `Status: ${updated.status}\n${updated.error||''}`);
        delete pendingPrinter[id];
      } catch (e) { alert('Error: ' + e); }
      await loadJobs();
    });
  });
    // pendingPrinter recorded via change handlers below
  body.querySelectorAll('[data-action="approve"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const sel = body.querySelector(`.job-printer[data-id="${id}"]`);
      const printer = sel ? sel.value : null;
      btn.disabled = true; btn.textContent = 'Printing…';
      try {
        const updated = await api(`/api/admin/jobs/${encodeURIComponent(id)}/approve`, {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ printer })
        });
        delete pendingPrinter[id];
        alert(updated.status === 'printed' ? `Printed successfully (${updated.id})` : `Status: ${updated.status}\n${updated.error||''}`);
      } catch (e) { alert('Error: ' + e); }
      await loadJobs();
    });
  });
  body.querySelectorAll('[data-action="reject"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      if (!confirm('Reject this job?')) return;
      try { await api(`/api/admin/jobs/${encodeURIComponent(id)}/reject`, { method:'POST' }); delete pendingPrinter[id]; }
      catch (e) { alert('Error: ' + e); }
      await loadJobs();
    });
  });
  body.querySelectorAll('.job-printer').forEach(sel => {
    sel.addEventListener('change', () => { pendingPrinter[sel.dataset.id] = sel.value; });
  });
}

function esc(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

async function loadServerUrl() {
  try {
    const c = await api('/api/admin/config');
    $('serverUrlInput').value = c.serverUrl;
    $('urlStatus').textContent = c.persisted ? 'Custom address saved.' : 'Auto-detected address.';
  } catch (e) { $('urlStatus').textContent = 'Error: ' + e; }
}

$('saveUrlBtn').addEventListener('click', async () => {
  try {
    const r = await api('/api/admin/config', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ serverUrl: $('serverUrlInput').value }) });
    $('urlStatus').textContent = 'Saved: ' + r.serverUrl;
  } catch (e) { $('urlStatus').textContent = 'Error: ' + e; }
});
$('resetUrlBtn').addEventListener('click', async () => {
  try {
    const r = await api('/api/admin/config/reset', { method:'POST' });
    $('serverUrlInput').value = r.serverUrl;
    $('urlStatus').textContent = 'Reset to auto: ' + r.serverUrl;
  } catch (e) { $('urlStatus').textContent = 'Error: ' + e; }
});

async function loadJobs() {
  try {
    const jobs = await api('/api/admin/jobs');
    allJobs = Array.isArray(jobs) ? jobs : [];
    renderJobs();
  } catch (e) { /* handled */ }
}

let autoTimer = null;
function startAuto() {
  if (autoTimer) clearInterval(autoTimer);
  autoTimer = setInterval(() => {
    if ($('autoRefresh').checked) loadJobs();
  }, 5000);
}

async function loadAdminQr() {
  try {
    const r = await api('/api/qr');
    $('adminQrImg').src = r.dataUrl;
    $('adminQrUrl').textContent = r.url;
  } catch (e) { $('adminQrUrl').textContent = 'Error: ' + e; }
}
function printAdminQr() {
  const qrSrc = $('adminQrImg').src;
  const url = $('adminQrUrl').textContent;
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument;
  doc.open();
  doc.write(`<!DOCTYPE html><html><head><title>Print QR</title><style>body{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;font-family:sans-serif}img{max-width:80%;height:auto}p{margin-top:20px;font-size:14px;word-break:break-all}</style></head><body><img src="${qrSrc}" alt="QR"><p>${url}</p><script>window.onload=function(){window.print();};window.onafterprint=function(){setTimeout(function(){window.close();},200);};<\/script></body></html>`);
  doc.close();
  setTimeout(() => { try { iframe.remove(); } catch(e){} }, 30000);
}

async function loadAdminFiles() {
  try {
    const files = await api('/api/admin/files');
    const body = $('adminFilesBody');
    if (!files || !files.length) { body.innerHTML = '<tr><td colspan="4" class="muted">No uploaded files.</td></tr>'; $('adminFilesStatus').textContent = ''; return; }
    body.innerHTML = files.map(f => `<tr>
      <td>${esc(f.name)}<br><small class="muted">${esc(f.id)}</small></td>
      <td>${Math.round(f.size/1024)} KB</td>
      <td>${f.submitted ? 'Yes' : 'No'}</td>
      <td class="row-actions">
        <a class="btn-sm" style="background:#0f172a;border:1px solid #475569;color:#93c5fd;text-decoration:none" href="/uploads/${encodeURIComponent(f.id)}" download="${esc(f.name)}">Download</a>
        <button class="btn-sm btn-danger" data-del="${esc(f.id)}">Delete</button>
      </td>
    </tr>`).join('');
    body.querySelectorAll('[data-del]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Permanently delete this file?')) return;
        btn.disabled = true;
        try { await api('/api/admin/files/' + encodeURIComponent(btn.dataset.del), { method:'DELETE' }); }
        catch (e) { alert('Error: ' + e); }
        await loadAdminFiles();
      });
    });
    $('adminFilesStatus').textContent = `Loaded ${files.length} file(s).`;
  } catch (e) { $('adminFilesStatus').textContent = 'Error: ' + e; }
}

async function loadCostCenter() {
  try {
    const r = await api('/api/admin/cost-center');
    $('costCurrency').value = r.currency || 'USD';
    const labels = {
      colorNormalSimplex: 'Color / Normal / Single side',
      colorNormalDuplex:  'Color / Normal / Both sides',
      colorHighSimplex:   'Color / HIGH / Single side',
      colorHighDuplex:    'Color / HIGH / Both sides',
      monoNormalSimplex:  'Mono / Normal / Single side',
      monoNormalDuplex:   'Mono / Normal / Both sides',
      monoHighSimplex:    'Mono / HIGH / Single side',
      monoHighDuplex:     'Mono / HIGH / Both sides',
    };
    const body = document.getElementById('costCfgBody');
    const keys = r.COST_KEYS || Object.keys(r.rates);
    body.innerHTML = keys.map(k => `<tr>
      <td>${labels[k] || k}</td>
      <td><input type="number" step="0.01" min="0" class="cost-rate" data-k="${k}" value="${Number(r.rates[k] || 0)}" style="width:100px;padding:4px 6px;border-radius:6px;border:1px solid #475569;background:#0f172a;color:#e2e8f0"></td>
    </tr>`).join('');
    $('costStatus').textContent = 'Loaded.';
  } catch (e) { $('costStatus').textContent = 'Error: ' + e; }
}
async function saveCostCenter() {
  const rates = {};
  document.querySelectorAll('.cost-rate').forEach(inp => { rates[inp.dataset.k] = inp.value; });
  await api('/api/admin/cost-center', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ rates, currency: $('costCurrency').value }) });
  $('costStatus').textContent = 'Saved.';
}
document.getElementById('saveCostBtn').addEventListener('click', async () => {
  try { await saveCostCenter(); } catch (e) { $('costStatus').textContent = 'Error: ' + e; }
});
$('adminPw').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
$('statusFilter')?.addEventListener('change', renderJobs);
$('jobSearch')?.addEventListener('input', renderJobs);
$('refreshBtn').addEventListener('click', loadJobs);
async function loadFinance() {
  const period = $('finPeriod').value;
  try {
    const r = await api(`/api/admin/finance?period=${encodeURIComponent(period)}`);
    $('finTotalJobs').textContent = r.totals.jobs;
    $('finTotalCost').textContent = (r.currency || 'USD') + ' ' + Number(r.totals.cost).toFixed(2);
    const avg = r.totals.jobs ? (r.totals.cost / r.totals.jobs) : 0;
    $('finAvgCost').textContent = (r.currency || 'USD') + ' ' + avg.toFixed(2);
    drawFinanceChart(r.buckets, r.currency);
    const body = $('finBody');
    body.innerHTML = (r.buckets || []).map(b => `<tr><td>${esc(b.label)}</td><td>${b.jobs}</td><td>${Number(b.cost).toFixed(2)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">No approved/printed jobs yet.</td></tr>';
    const pb = $('finPrinterBody');
    pb.innerHTML = Object.keys(r.byPrinter || {}).map(k => `<tr><td>${esc(k)}</td><td>${r.byPrinter[k].jobs}</td><td>${Number(r.byPrinter[k].cost).toFixed(2)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">none</td></tr>';
    const qb = $('finQualityBody');
    qb.innerHTML = `<tr><td>Normal</td><td>${(r.byQuality && r.byQuality.normal) || 0}</td></tr><tr><td>HIGH</td><td>${(r.byQuality && r.byQuality.high) || 0}</td></tr>`;
  } catch (e) { console.error('loadFinance', e); }
}
function drawFinanceChart(buckets, currency) {
  const canvas = $('finChart');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.fillStyle = '#0f172a'; ctx.fillRect(0,0,W,H);
  if (!buckets || !buckets.length) { ctx.fillStyle = '#94a3b8'; ctx.font='14px sans-serif'; ctx.textAlign='center'; ctx.fillText('No data', W/2, H/2); return; }
  const max = Math.max(1, ...buckets.map(b => b.cost));
  const pad = 40;
  const bw = (W - pad*2) / buckets.length;
  const chartH = H - pad*2;
  buckets.forEach((b,i) => {
    const h = (b.cost / max) * chartH;
    const x = pad + i*bw + 4;
    const y = H - pad - h;
    ctx.fillStyle = '#60a5fd';
    ctx.fillRect(x, y, Math.max(2, bw-8), h);
    ctx.fillStyle = '#94a3b8'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(b.label, x + (bw-8)/2, H - pad + 14);
    ctx.fillStyle = '#e2e8f0';
    ctx.fillText(Number(b.cost).toFixed(2), x + (bw-8)/2, y - 4);
  });
  ctx.strokeStyle = '#475569'; ctx.beginPath();
  ctx.moveTo(pad, H-pad); ctx.lineTo(W-pad, H-pad); ctx.stroke();
}
if ($('finPeriod')) $('finPeriod').addEventListener('change', loadFinance);
if ($('finRefreshBtn')) $('finRefreshBtn').addEventListener('click', loadFinance);
const _printQrBtn = $('printQrBtn'); if (_printQrBtn) _printQrBtn.addEventListener('click', printAdminQr);

$('changePwBtn').addEventListener('click', async () => {
  const oldPw = $('oldPw').value;
  const newPw = $('newPw').value;
  const confirm = $('newPw2').value;
  if (newPw !== confirm) { $('pwStatus').textContent = 'New passwords do not match.'; return; }
  try {
    await api('/api/admin/change-password', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ oldPassword: oldPw, newPassword: newPw }) });
    $('pwStatus').textContent = 'Password changed. Please log in again.';
    setTimeout(logout, 1200);
  } catch (e) { $('pwStatus').textContent = 'Error: ' + e; }
});

document.querySelectorAll('.side-item').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.side-item').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    const t = document.getElementById(btn.dataset.section);
    if (t) t.classList.add('active');
  });
});

function syncThemeBtn() {
  const light = document.body.classList.contains('theme-light');
  const btn = document.getElementById('themeBtn');
  if (btn) btn.textContent = light ? 'Theme: Light' : 'Theme: Dark';
}
async function loadAdminTheme() {
  try {
    const r = await api('/api/admin/theme');
    document.body.classList.toggle('theme-light', r.theme === 'light');
    syncThemeBtn();
  } catch (e) {}
}
async function toggleAdminTheme() {
  const next = document.body.classList.contains('theme-light') ? 'dark' : 'light';
  try {
    const r = await api('/api/admin/theme', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ theme: next }) });
    document.body.classList.toggle('theme-light', r.theme === 'light');
    syncThemeBtn();
  } catch (e) {}
}
syncThemeBtn();
const _themeBtn = document.getElementById('themeBtn');
if (_themeBtn) _themeBtn.addEventListener('click', toggleAdminTheme);

$('loginBtn').addEventListener('click', login);

const lb = document.getElementById('logoutBtn'); if (lb) lb.addEventListener('click', logout);
const slb = document.getElementById('sideLogoutBtn'); if (slb) slb.addEventListener('click', logout);

async function loadBranding() {
  try {
    const r = await api('/api/admin/brand');
    $('headerTextInput').value = r.headerText || '';
    $('faviconPreview').src = r.faviconUrl || '/favicon.png';
    $('brandStatus').textContent = 'Loaded.';
    applyBranding();
  } catch (e) { $('brandStatus').textContent = 'Error: ' + e; }
}
$('saveBrandBtn').addEventListener('click', async () => {
  const headerText = ($('headerTextInput').value || '').trim() || 'BI Print Service';
  const file = $('faviconFile').files[0];
  let faviconDataUrl = null;
  if (file) {
    faviconDataUrl = await new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = () => rej(fr.error);
      fr.readAsDataURL(file);
    });
  }
  try {
    const r = await api('/api/admin/brand', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ headerText, faviconDataUrl }) });
    $('brandStatus').textContent = 'Saved. User page will reflect this (refresh to see).';
    $('faviconPreview').src = r.faviconUrl;
    applyBranding();
  } catch (e) { $('brandStatus').textContent = 'Error: ' + e; }
});
(async () => {
  if (token) {
    try {
      await loadPrinters();
      await loadServerUrl();
      await loadPrinterCfg();
      await loadAdminQr();
      await loadAdminTheme();
      await loadAdminFiles();
      await loadCostCenter();
      await loadBranding();
      await loadFinance();
      $('loginCard').style.display = 'none';
      $('panel').style.display = '';
      await loadJobs();
      document.querySelectorAll('.side-item').forEach(b => b.classList.remove('active'));
      document.querySelector('.side-item[data-section="sec-jobs"]')?.classList.add('active');
      document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
      document.getElementById('sec-jobs')?.classList.add('active');
      startAuto();
    } catch (e) {
      logout();
    }
  }
})();
