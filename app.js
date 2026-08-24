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
  _initAgencyDatalist();
  _wireArrestLocAutocomplete();
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
  ['last','first','middle','dob','sex','ssn','agency','officerLast','officerFirst','badge','arrestTime','arrestLoc','arrestLocDetails','chargeSearch','notes'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const hint = document.getElementById('arrestLocHint');
  if (hint) hint.textContent = 'Required. Type or pick from suggestions.';
  const ssn = document.getElementById('ssn');
  if (ssn) ssn.style.borderColor = '';
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
    const sex = document.getElementById('sex').value || '';
    const ssn = (document.getElementById('ssn').value || '').trim();
    if (!last || !first) return alert('Last and first name are required.');
    if (!dob) return alert('Date of birth is required.');
    if (!sex) return alert('Sex is required.');
    const digits = ssn.replace(/\D/g, '');
    if (digits.length !== 9) return alert('SSN must be a full 9-digit number (used to cross-reference prior bookings).');
  }
  if (wiz.step === 1) {
    const agency = (document.getElementById('agency').value || '').trim();
    const oL = (document.getElementById('officerLast').value || '').trim();
    const oF = (document.getElementById('officerFirst').value || '').trim();
    const badge = (document.getElementById('badge').value || '').trim();
    const loc = (document.getElementById('arrestLoc').value || '').trim();
    if (!agency) return alert('Arresting agency is required.');
    if (!oL || !oF) return alert('Officer last and first name are required.');
    if (!badge) return alert('Badge number is required.');
    if (!loc) return alert('Arrest location is required.');
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
  const dobRaw = document.getElementById('dob').value || '';
  // DOB always saves in ISO YYYY-MM-DD (from <input type="date">) so the
  // downstream booking wizard's date-parsing stays consistent. We also
  // ship a US-format mirror (MM/DD/YYYY) for display / SO# generation.
  let dobUS = '';
  if (dobRaw && /^\d{4}-\d{2}-\d{2}$/.test(dobRaw)) {
    const [y, m, d] = dobRaw.split('-');
    dobUS = m + '/' + d + '/' + y;
  }
  const ssnRaw = (document.getElementById('ssn').value || '').trim();
  const ssnDigits = ssnRaw.replace(/\D/g, '');
  const ssnFormatted = ssnDigits.length === 9
    ? ssnDigits.slice(0, 3) + '-' + ssnDigits.slice(3, 5) + '-' + ssnDigits.slice(5)
    : ssnRaw;
  let arrestLocationDetails = null;
  try {
    const raw = document.getElementById('arrestLocDetails').value;
    if (raw) arrestLocationDetails = JSON.parse(raw);
  } catch (_) {}
  return {
    inmate: {
      lastName: (document.getElementById('last').value || '').trim(),
      firstName: (document.getElementById('first').value || '').trim(),
      middleName: (document.getElementById('middle').value || '').trim(),
      dob: dobRaw,            // ISO YYYY-MM-DD (as-typed)
      dobUS,                  // MM/DD/YYYY mirror for display
      sex: document.getElementById('sex').value || '',
      ssn: ssnFormatted,      // XXX-XX-XXXX
      ssnDigits,              // raw 9 digits for cross-ref
    },
    arresting: (function(){
      const oL = (document.getElementById('officerLast').value || '').trim();
      const oF = (document.getElementById('officerFirst').value || '').trim();
      const combined = [oL, oF].filter(Boolean).join(', ');
      return {
        agency: (document.getElementById('agency').value || '').trim(),
        officer: combined,       // "LAST, First" — downstream displays that expect a single field
        officerLast: oL,
        officerFirst: oF,
        badge: (document.getElementById('badge').value || '').trim(),
        arrestTime: document.getElementById('arrestTime').value || '',
        arrestLocation: (document.getElementById('arrestLoc').value || '').trim(),
        arrestLocationDetails,  // {placeId, formattedAddress, lat, lng, street, city, state, zip, ...} or null
      };
    })(),
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

// ─── SSN formatting ──────────────────────────────────────────────────────────
// XXX-XX-XXXX auto-format as digits are typed. Handles paste of raw 9-digit
// numbers or fragments — never overshoots the maxlength cap. Visual state:
// green border once we have 9 digits, red on blur if fewer than 9.
function onSsnInput(e) {
  const el = e.target;
  const digits = el.value.replace(/\D/g, '').slice(0, 9);
  let formatted = digits;
  if (digits.length > 5) formatted = digits.slice(0, 3) + '-' + digits.slice(3, 5) + '-' + digits.slice(5);
  else if (digits.length > 3) formatted = digits.slice(0, 3) + '-' + digits.slice(3);
  el.value = formatted;
  el.style.borderColor = digits.length === 9 ? '#16a34a' : '';
}
function validateSsn() {
  const el = document.getElementById('ssn');
  const digits = (el.value || '').replace(/\D/g, '');
  el.style.borderColor = digits.length === 9 ? '#16a34a' : (digits.length === 0 ? '' : '#b91c1c');
}
window.onSsnInput = onSsnInput;
window.validateSsn = validateSsn;

// ─── Google Places arrest-location autocomplete ─────────────────────────────
// Loaded via the script tag in index.html. When the officer opens the wizard,
// we bind Autocomplete to #arrestLoc and stash the picked Place's structured
// details (address, lat/lng, components) in the hidden #arrestLocDetails so
// the booking record downstream carries a proper structured arrestLocation
// rather than a free-text string.
let _kioskMapsReady = false;
let _kioskAutocomplete = null;
window.initKioskMaps = function () {
  _kioskMapsReady = true;
  _wireArrestLocAutocomplete();
};
function _wireArrestLocAutocomplete() {
  if (!_kioskMapsReady) return;
  if (_kioskAutocomplete) return;
  const inp = document.getElementById('arrestLoc');
  if (!inp || !window.google || !google.maps || !google.maps.places) return;
  try {
    _kioskAutocomplete = new google.maps.places.Autocomplete(inp, {
      types: ['geocode'],
      fields: ['place_id', 'formatted_address', 'geometry', 'address_components'],
    });
    _kioskAutocomplete.addListener('place_changed', () => {
      const place = _kioskAutocomplete.getPlace();
      if (!place || !place.geometry) return;
      const comps = {};
      (place.address_components || []).forEach(c => {
        (c.types || []).forEach(t => { comps[t] = c.short_name; });
      });
      const details = {
        placeId: place.place_id || '',
        formattedAddress: place.formatted_address || inp.value,
        lat: place.geometry.location ? place.geometry.location.lat() : null,
        lng: place.geometry.location ? place.geometry.location.lng() : null,
        streetNumber: comps.street_number || '',
        street: comps.route || '',
        city: comps.locality || comps.sublocality || comps.postal_town || '',
        state: comps.administrative_area_level_1 || '',
        zip: comps.postal_code || '',
        county: comps.administrative_area_level_2 || '',
        country: comps.country || '',
        enteredAt: new Date().toISOString(),
      };
      const hidden = document.getElementById('arrestLocDetails');
      if (hidden) hidden.value = JSON.stringify(details);
      const hint = document.getElementById('arrestLocHint');
      if (hint) hint.textContent = '✓ Verified: ' + details.formattedAddress;
    });
  } catch (e) {
    console.warn('[Kiosk] Places autocomplete init failed — falling back to free-text.', e && e.message);
  }
}

// ─── Agency autocomplete ─────────────────────────────────────────────────────
// Common arresting agencies pre-populate the dropdown. The input is a
// datalist-bound text field — the officer can type to filter, pick from
// the dropdown, or type an agency that isn't listed (free form). No lock-in.
const ARRESTING_AGENCIES = [
  'Logan County Sheriff\'s Office',
  'Bellefontaine Police Department',
  'Union County Sheriff\'s Office',
  'Hardin County Sheriff\'s Office',
  'Champaign County Sheriff\'s Office',
  'Auglaize County Sheriff\'s Office',
  'Shelby County Sheriff\'s Office',
  'Marysville Police Department',
  'Kenton Police Department',
  'Urbana Police Department',
  'Ohio State Highway Patrol',
  'Ohio State Highway Patrol — Bellefontaine Post',
  'Ohio Bureau of Criminal Investigation (BCI)',
  'US Marshals Service',
  'Federal Bureau of Investigation (FBI)',
  'Drug Enforcement Administration (DEA)',
  'Bureau of Alcohol, Tobacco, Firearms &amp; Explosives (ATF)',
  'Immigration and Customs Enforcement (ICE)',
  'US Border Patrol',
  'Adult Parole Authority',
  'Ohio Adult Parole Authority',
  'Court Order / Bench Warrant',
];
function _initAgencyDatalist() {
  if (document.getElementById('agencyDL')) return;
  const dl = document.createElement('datalist');
  dl.id = 'agencyDL';
  dl.innerHTML = ARRESTING_AGENCIES.map(a => '<option value="' + escAttr(a) + '"></option>').join('');
  document.body.appendChild(dl);
  const inp = document.getElementById('agency');
  if (inp) { inp.setAttribute('list', 'agencyDL'); inp.setAttribute('placeholder', 'Type or pick — agency not listed? Just type it.'); }
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
