// ─────────────────────────────────────────────────────────────────────────────
// Cornerstone Kiosk — arresting officer intake app
// ─────────────────────────────────────────────────────────────────────────────
// Kiosk hosted at kiosk.cornerstonetech.online. Officer signs in with a shared
// credential (default: arrest / Welcome1!), fills a 4-step wizard, and submits.
// The submission POSTs to Jail's public /api/public/kiosk-arrests endpoint,
// where it queues under "Pending Completion" for a booking officer.
//
// Behavior notes:
//   - Kiosk auto-locks 90s after the "Submitted" screen appears, and on any
//     idle >5min (any input resets the timer).
//   - Charge library is pulled from Jail's public GET /api/public/charge-library
//     with a fallback to a small built-in list if the fetch fails so the kiosk
//     is never blocked at intake.
//   - No secrets are stored in the browser. The shared kiosk credential lives
//     in the shipped bundle (it's a public-facing intake terminal — real auth
//     is enforced downstream when a booking officer accepts the submission).
// ─────────────────────────────────────────────────────────────────────────────

// Config — swap in per-deploy via a build step later. Baked as literals now
// so the kiosk works with a single static-file deploy.
const KIOSK_USER = 'arrest';
const KIOSK_PASS = 'Welcome1!';
const JAIL_API_BASE = 'https://jail.cornerstonetech.online/api';
const IDLE_LOCK_MS = 5 * 60 * 1000;
const POST_SUBMIT_LOCK_MS = 90 * 1000;

// State
let wiz = { step: 0, charges: [] };
let chargeLibrary = null;
let chargeLibraryLoading = false;
let idleTimer = null;
let postSubmitTimer = null;

// ─── Clock ───────────────────────────────────────────────────────────────────
function tickClock() {
  const el = document.getElementById('hdrClock');
  if (!el) return;
  const d = new Date();
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  el.textContent = h + ':' + m;
}
setInterval(tickClock, 15 * 1000);
tickClock();

// ─── Login / lock ────────────────────────────────────────────────────────────
function kioskLogin(e) {
  e.preventDefault();
  const user = (document.getElementById('user').value || '').trim();
  const pw = document.getElementById('pw').value || '';
  const errEl = document.getElementById('loginErr');
  if (user !== KIOSK_USER || pw !== KIOSK_PASS) {
    errEl.textContent = 'Incorrect user or password.';
    errEl.style.display = 'block';
    return false;
  }
  errEl.style.display = 'none';
  document.getElementById('user').value = '';
  document.getElementById('pw').value = '';
  document.getElementById('lock').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  resetWizard();
  armIdleTimer();
  loadChargeLibrary();
  return false;
}

function kioskLogout() {
  clearTimeout(idleTimer);
  clearTimeout(postSubmitTimer);
  document.getElementById('app').style.display = 'none';
  document.getElementById('lock').style.display = 'flex';
  document.getElementById('user').focus();
  resetWizard();
}

function armIdleTimer() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { kioskLogout(); }, IDLE_LOCK_MS);
}
['mousemove', 'keydown', 'touchstart', 'click', 'input'].forEach(ev => {
  document.addEventListener(ev, () => {
    if (document.getElementById('app').style.display !== 'none') armIdleTimer();
  }, { passive: true });
});

// ─── Wizard ──────────────────────────────────────────────────────────────────
function resetWizard() {
  wiz = { step: 0, charges: [] };
  ['last','first','middle','dob','sex','ssn','agency','officer','badge','arrestTime','arrestLoc','chargeSearch','notes'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  renderChargeList();
  showStep(0);
  const errEl = document.getElementById('submitErr');
  if (errEl) errEl.style.display = 'none';
}

function showStep(n) {
  wiz.step = n;
  [0,1,2,3].forEach(i => {
    const p = document.getElementById('wizStep' + i);
    if (p) p.style.display = i === n ? 'block' : 'none';
  });
  const done = document.getElementById('wizDone');
  if (done) done.style.display = n === -1 ? 'block' : 'none';
  document.querySelectorAll('.progress-step').forEach((el, i) => {
    el.classList.remove('done','active');
    if (n === -1) { el.classList.add('done'); return; }
    if (i < n) el.classList.add('done');
    else if (i === n) el.classList.add('active');
  });
  window.scrollTo(0, 0);
  if (n === 3) renderReview();
}

function wizNext() {
  if (wiz.step === 0) {
    const first = (document.getElementById('first').value || '').trim();
    const last = (document.getElementById('last').value || '').trim();
    const dob = document.getElementById('dob').value || '';
    if (!last || !first) return alert('Last and first name are required.');
    if (!dob) return alert('Date of birth is required.');
  }
  if (wiz.step === 1) {
    const agency = (document.getElementById('agency').value || '').trim();
    const officer = (document.getElementById('officer').value || '').trim();
    const badge = (document.getElementById('badge').value || '').trim();
    if (!agency || !officer || !badge) return alert('Agency, officer, and badge number are required.');
  }
  if (wiz.step === 2) {
    if (!wiz.charges.length) return alert('Add at least one charge before continuing.');
  }
  if (wiz.step < 3) showStep(wiz.step + 1);
}
function wizPrev() {
  if (wiz.step > 0) showStep(wiz.step - 1);
}

// ─── Charges — autocomplete from Jail's public charge library ────────────────
async function loadChargeLibrary() {
  if (chargeLibrary || chargeLibraryLoading) return;
  chargeLibraryLoading = true;
  try {
    const res = await fetch(JAIL_API_BASE + '/public/charge-library', { headers: { 'Accept': 'application/json' } });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) chargeLibrary = data;
    }
  } catch (_) { /* offline — fall back below */ }
  chargeLibraryLoading = false;
  if (!chargeLibrary) chargeLibrary = _fallbackChargeLibrary();
}
function _fallbackChargeLibrary() {
  return [
    { code: 'ORC 2903.02', desc: 'Murder', cls: 'F1' },
    { code: 'ORC 2903.11', desc: 'Felonious Assault', cls: 'F2' },
    { code: 'ORC 2903.13', desc: 'Assault', cls: 'M1' },
    { code: 'ORC 2911.01', desc: 'Aggravated Robbery', cls: 'F1' },
    { code: 'ORC 2911.02', desc: 'Robbery', cls: 'F2' },
    { code: 'ORC 2913.02', desc: 'Theft', cls: 'F5' },
    { code: 'ORC 2919.25', desc: 'Domestic Violence', cls: 'M1' },
    { code: 'ORC 2925.03', desc: 'Trafficking in Drugs', cls: 'F1' },
    { code: 'ORC 2925.11', desc: 'Drug Possession', cls: 'M1' },
    { code: 'ORC 4511.19', desc: 'OVI / DUI', cls: 'M1' },
    { code: 'ORC 2921.31', desc: 'Obstructing Official Business', cls: 'M2' },
    { code: 'ORC 2923.13', desc: 'Weapons Under Disability', cls: 'F3' },
  ];
}
function onChargeSearch() {
  const q = (document.getElementById('chargeSearch').value || '').trim().toLowerCase();
  const results = document.getElementById('chargeResults');
  if (!q || q.length < 2) { results.classList.remove('show'); results.innerHTML = ''; return; }
  if (!chargeLibrary) { results.classList.add('show'); results.innerHTML = '<div class="charge-result"><div class="cr-desc">Loading charge library…</div></div>'; return; }
  const hits = chargeLibrary.filter(c =>
    (c.code || '').toLowerCase().includes(q) ||
    (c.desc || '').toLowerCase().includes(q) ||
    (c.cls || '').toLowerCase() === q
  ).slice(0, 12);
  if (!hits.length) {
    results.classList.add('show');
    results.innerHTML = '<div class="charge-result"><div class="cr-desc">No matches. <a href="#" onclick="addCustomCharge(event)" style="color:var(--blue);font-weight:700">Add "' + escHtml(q) + '" as custom</a></div></div>';
    return;
  }
  results.classList.add('show');
  results.innerHTML = hits.map(h => (
    '<div class="charge-result" onclick="pickCharge(\'' + escAttr(h.code) + '\')">' +
      '<div class="cr-code">' + escHtml(h.code) + '</div>' +
      '<div class="cr-desc">' + escHtml(h.desc) + '</div>' +
      (h.cls ? '<div class="cr-cls">' + escHtml(h.cls) + '</div>' : '') +
    '</div>'
  )).join('');
}
function pickCharge(code) {
  const c = (chargeLibrary || []).find(x => x.code === code);
  if (!c) return;
  if (wiz.charges.some(x => x.code === c.code)) return; // dedupe
  wiz.charges.push({ code: c.code, desc: c.desc, cls: c.cls || '' });
  document.getElementById('chargeSearch').value = '';
  document.getElementById('chargeResults').classList.remove('show');
  renderChargeList();
}
function addCustomCharge(e) {
  if (e && e.preventDefault) e.preventDefault();
  const q = (document.getElementById('chargeSearch').value || '').trim();
  if (!q) return;
  wiz.charges.push({ code: q.toUpperCase(), desc: '(custom charge — booking to verify)', cls: '' });
  document.getElementById('chargeSearch').value = '';
  document.getElementById('chargeResults').classList.remove('show');
  renderChargeList();
}
function removeCharge(code) {
  wiz.charges = wiz.charges.filter(c => c.code !== code);
  renderChargeList();
}
function renderChargeList() {
  const el = document.getElementById('chargeList');
  if (!el) return;
  el.innerHTML = wiz.charges.map(c => (
    '<div class="charge-chip">' +
      '<div class="cc-code">' + escHtml(c.code) + '</div>' +
      '<div class="cc-desc">' + escHtml(c.desc) + (c.cls ? ' <span style="color:var(--lslate);font-size:12px">· ' + escHtml(c.cls) + '</span>' : '') + '</div>' +
      '<button class="cc-remove" onclick="removeCharge(\'' + escAttr(c.code) + '\')">Remove</button>' +
    '</div>'
  )).join('');
}

// ─── Review ──────────────────────────────────────────────────────────────────
function readForm() {
  return {
    inmate: {
      lastName: (document.getElementById('last').value || '').trim(),
      firstName: (document.getElementById('first').value || '').trim(),
      middleName: (document.getElementById('middle').value || '').trim(),
      dob: document.getElementById('dob').value || '',
      sex: document.getElementById('sex').value || '',
      ssn: (document.getElementById('ssn').value || '').trim(),
    },
    arresting: {
      agency: (document.getElementById('agency').value || '').trim(),
      officer: (document.getElementById('officer').value || '').trim(),
      badge: (document.getElementById('badge').value || '').trim(),
      arrestTime: document.getElementById('arrestTime').value || '',
      arrestLocation: (document.getElementById('arrestLoc').value || '').trim(),
    },
    charges: wiz.charges.slice(),
    notes: (document.getElementById('notes').value || '').trim(),
  };
}
function renderReview() {
  const f = readForm();
  const name = [f.inmate.lastName, f.inmate.firstName].filter(Boolean).join(', ') + (f.inmate.middleName ? ' ' + f.inmate.middleName : '');
  const rows = [
    ['Inmate name', name || '—'],
    ['DOB', f.inmate.dob || '—'],
    ['Sex', f.inmate.sex || '—'],
    ['SSN', f.inmate.ssn || '—'],
    ['Arresting agency', f.arresting.agency || '—'],
    ['Officer', f.arresting.officer + (f.arresting.badge ? ' · #' + f.arresting.badge : '') || '—'],
    ['Arrest time', f.arresting.arrestTime ? new Date(f.arresting.arrestTime).toLocaleString() : '—'],
    ['Arrest location', f.arresting.arrestLocation || '—'],
    ['Charges', f.charges.length ? f.charges.map(c => c.code + ' ' + c.desc).join(' · ') : '—'],
    ['Notes', f.notes || '—'],
  ];
  document.getElementById('review').innerHTML = rows.map(r => (
    '<div class="rv-row"><div class="rv-k">' + escHtml(r[0]) + '</div><div class="rv-v">' + escHtml(r[1]) + '</div></div>'
  )).join('');
}

// ─── Submit ──────────────────────────────────────────────────────────────────
async function submitIntake() {
  const submitBtn = document.getElementById('submitBtn');
  const errEl = document.getElementById('submitErr');
  errEl.style.display = 'none';
  const payload = readForm();
  payload.source = 'kiosk';
  payload.origin = window.location.hostname;
  payload.submittedAt = new Date().toISOString();
  submitBtn.disabled = true;
  submitBtn.textContent = 'Submitting…';
  try {
    const res = await fetch(JAIL_API_BASE + '/public/kiosk-arrests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error('Server ' + res.status + (t ? ' — ' + t.slice(0, 200) : ''));
    }
    const body = await res.json().catch(() => ({}));
    showStep(-1);
    const msg = document.getElementById('doneMsg');
    if (msg) msg.textContent = 'Queued for booking' + (body && body.id ? ' (ref ' + body.id + ')' : '') + '. This kiosk will lock in 90 seconds — you can also press Lock now.';
    clearTimeout(postSubmitTimer);
    postSubmitTimer = setTimeout(kioskLogout, POST_SUBMIT_LOCK_MS);
  } catch (e) {
    errEl.textContent = 'Submit failed: ' + (e.message || 'network error') + '. Your data is still on-screen — press Submit again to retry.';
    errEl.style.display = 'block';
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Submit to Booking';
  }
}

// ─── Utilities ───────────────────────────────────────────────────────────────
function escHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function escAttr(s) { return escHtml(s).replace(/'/g, '&#39;'); }

// Expose for onclick handlers in the HTML.
window.kioskLogin = kioskLogin;
window.kioskLogout = kioskLogout;
window.wizNext = wizNext;
window.wizPrev = wizPrev;
window.onChargeSearch = onChargeSearch;
window.pickCharge = pickCharge;
window.addCustomCharge = addCustomCharge;
window.removeCharge = removeCharge;
window.submitIntake = submitIntake;
