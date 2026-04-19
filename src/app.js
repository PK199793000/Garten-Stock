// ════════════════════════════════
//  UTILITAIRES
// ════════════════════════════════
async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

function now() {
  const d = new Date();
  return d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0');
}
function updateClock() { document.getElementById('clock').textContent = now(); }

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2400);
}

function uid() { return 'x' + (++idCounter); }

// ════════════════════════════════
//  NOTIFICATIONS STOCK BAS
// ════════════════════════════════
async function requestNotificationPermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    await Notification.requestPermission();
  }
}

function checkStockAlerts(products, barId) {
  if (!CURRENT_USER || !['directeur','chef_bar'].includes(CURRENT_USER.role)) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const bar = BARS.find(b => b.id === barId);
  products.forEach(p => {
    const remaining = calcStock(barId, p.id);
    const seuil = p.alertSeuil !== undefined ? p.alertSeuil : 2;
    const key = barId + '-' + p.id;
    if (remaining <= seuil && remaining >= 0 && !_notifiedAlerts.has(key)) {
      _notifiedAlerts.add(key);
      new Notification('⚠ Stock bas — ' + (bar ? bar.name : ''), {
        body: p.name + ' : ' + (Number.isInteger(remaining) ? remaining : remaining.toFixed(1)) + ' restant(s)',
        icon: 'logo.png',
        tag: key,
      });
    } else if (remaining > seuil) {
      _notifiedAlerts.delete(key);
    }
  });
}

// ════════════════════════════════
//  THÈME CLAIR / SOMBRE
// ════════════════════════════════
function initTheme() {
  const saved = localStorage.getItem('garten_theme') || 'dark';
  applyTheme(saved);
}

function applyTheme(theme) {
  document.documentElement.classList.toggle('light', theme === 'light');
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.textContent = theme === 'light' ? '🌙' : '☀️';
  localStorage.setItem('garten_theme', theme);
}

function toggleTheme() {
  const current = localStorage.getItem('garten_theme') || 'dark';
  applyTheme(current === 'dark' ? 'light' : 'dark');
}

// ════════════════════════════════
//  SESSION PERSISTANTE (1h inactivité)
// ════════════════════════════════
const SESSION_KEY     = 'garten_session';
const SESSION_TIMEOUT = 60 * 60 * 1000; // 1 heure en ms

function saveSession(userId) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ userId, lastActive: Date.now() }));
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

function touchSession() {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return;
  const s = JSON.parse(raw);
  s.lastActive = Date.now();
  localStorage.setItem(SESSION_KEY, JSON.stringify(s));
}

function getValidSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (Date.now() - s.lastActive > SESSION_TIMEOUT) { clearSession(); return null; }
    return s;
  } catch { return null; }
}

function initActivityTracking() {
  ['click','touchstart','keydown','scroll'].forEach(ev =>
    document.addEventListener(ev, touchSession, { passive: true })
  );
  // Vérifie l'expiration toutes les 5 minutes
  setInterval(() => {
    if (CURRENT_USER && !getValidSession()) {
      CURRENT_USER = null;
      clearSession();
      document.getElementById('login-screen').classList.add('active');
      document.getElementById('app').style.display = 'none';
      showToast('Session expirée — veuillez vous reconnecter');
    }
  }, 5 * 60 * 1000);
}

// ════════════════════════════════
//  AUTH SYSTEM
// ════════════════════════════════
let CURRENT_USER = null;
let ALL_USERS    = [];

async function initAuth() {
  if (window._fbLoadUsers) ALL_USERS = await window._fbLoadUsers();
  if (ALL_USERS.length === 0) {
    const defaultHash = await sha256('garten2025');
    ALL_USERS = [{id:'directeur', pw:defaultHash, role:'directeur', barIds:[], displayName:'Directeur'}];
    if (window._fbSaveUsers) await window._fbSaveUsers(ALL_USERS);
  }

  // ── Tentative de reprise de session ──
  const session = getValidSession();
  if (session) {
    const user = ALL_USERS.find(u => u.id === session.userId);
    if (user) {
      const page = location.pathname.split('/').pop().replace('.html','') || 'index';
      const hasAccess = user.role === 'directeur' || !user.pages?.length || user.pages.includes(page);
      if (hasAccess) {
        activateUser(user);
        return; // pas besoin d'afficher le login
      }
    }
    clearSession();
  }

  document.getElementById('login-screen').classList.add('active');
  document.getElementById('app').style.display = 'none';
  document.getElementById('login-pw').addEventListener('keydown', e => { if(e.key==='Enter') doLogin(); });
  document.getElementById('login-id').addEventListener('keydown', e => { if(e.key==='Enter') document.getElementById('login-pw').focus(); });
}

// Factorisation : active l'utilisateur (login manuel ou reprise session)
function activateUser(user) {
  CURRENT_USER = user;
  document.getElementById('login-screen').classList.remove('active');
  document.getElementById('app').style.display = 'flex';
  requestNotificationPermission();
  const badge = document.getElementById('user-badge');
  if (badge) {
    const roleLabels = {directeur:'Directeur', chef_bar:'Chef de bar', magasinier:'Magasinier'};
    badge.textContent = (user.displayName || user.id) + ' · ' + (roleLabels[user.role] || user.role);
  }
  applyRoleRestrictions();
  loadAll();
}

async function doLogin() {
  const id    = document.getElementById('login-id').value.trim().toLowerCase();
  const rawPw = document.getElementById('login-pw').value;
  const errEl = document.getElementById('login-error');
  const hash  = await sha256(rawPw);

  let user = ALL_USERS.find(u => u.id.toLowerCase() === id && u.pw === hash);

  // Migration transparente : si le mot de passe est encore en clair (<64 chars)
  if (!user) {
    const plain = ALL_USERS.find(u => u.id.toLowerCase() === id && u.pw === rawPw && u.pw.length < 64);
    if (plain) {
      plain.pw = hash;
      if (window._fbSaveUsers) await window._fbSaveUsers(ALL_USERS);
      user = plain;
    }
  }

  if (!user) { errEl.textContent = 'Identifiant ou mot de passe incorrect'; return; }

  const page = location.pathname.split('/').pop().replace('.html','') || 'index';
  if (user.role !== 'directeur' && user.pages && user.pages.length && !user.pages.includes(page)) {
    errEl.textContent = "Vous n'avez pas accès à cet événement";
    return;
  }

  errEl.textContent = '';
  saveSession(user.id);
  activateUser(user);
}

function doLogout() {
  if (!confirm('Se déconnecter ?')) return;
  CURRENT_USER = null;
  clearSession();
  document.getElementById('login-id').value = '';
  document.getElementById('login-pw').value = '';
  document.getElementById('login-error').textContent = '';
  document.getElementById('login-screen').classList.add('active');
  document.getElementById('app').style.display = 'none';
}

// ════════════════════════════════
//  CLÔTURE ÉVÉNEMENT
// ════════════════════════════════
function applyEventClosedUI() {
  const banner = document.getElementById('event-closed-banner');
  if (banner) banner.style.display = eventClosed ? 'block' : 'none';
  const invBtn = document.getElementById('inv-btn');
  if (invBtn) invBtn.style.display = eventClosed ? 'none' : '';
  const cfgBtn = document.getElementById('cfg-close-event-btn');
  if (cfgBtn) cfgBtn.textContent = eventClosed ? '🔓 Réouvrir l\'événement' : '🔒 Clore l\'événement';
}

function toggleEventClosed() {
  const msg = eventClosed
    ? 'Réouvrir l\'événement et autoriser les saisies ?'
    : 'Clore l\'événement ? Les saisies seront désactivées pour tous les utilisateurs.';
  if (!confirm(msg)) return;
  eventClosed = !eventClosed;
  saveAll();
  applyEventClosedUI();
  buildProducts();
  showToast(eventClosed ? '🔒 Événement clos' : '🔓 Événement rouvert');
  if (eventClosed) { document.getElementById('cfg-overlay').classList.remove('open'); }
}

function applyRoleRestrictions() {
  if (!CURRENT_USER) return;
  const role = CURRENT_USER.role;
  const cfgBtn = document.querySelector('.section-action[onclick="requestConfig()"]');
  if (cfgBtn) cfgBtn.style.display = role === 'directeur' ? '' : 'none';
  const recapBtn = document.getElementById('nav-recap');
  if (recapBtn) recapBtn.style.display = (role === 'directeur' || role === 'chef_bar') ? '' : 'none';
  const logBtn = document.getElementById('nav-log');
  if (logBtn) logBtn.style.display = (role === 'directeur' || role === 'chef_bar') ? '' : 'none';
  const histBtn = document.getElementById('nav-history');
  if (histBtn) histBtn.style.display = role === 'directeur' ? '' : 'none';

  if (role !== 'directeur' && CURRENT_USER.barIds && CURRENT_USER.barIds.length > 0) {
    const assignedBarId = CURRENT_USER.barIds[0];
    if (BARS.find(b => b.id === assignedBarId)) currentBar = assignedBarId;
  }
  buildBarSelector();
  buildProducts();
}

// ════════════════════════════════
//  USER MANAGEMENT
// ════════════════════════════════
let editingUserId = null;

function renderCfgUsers() {
  const el = document.getElementById('cfg-user-list');
  if (!el) return;
  el.innerHTML = '';
  const roleLabels = {directeur:'Directeur', chef_bar:'Chef de bar', magasinier:'Magasinier'};
  ALL_USERS.forEach(u => {
    const assignedBars = (u.barIds||[]).map(bid => { const b=BARS.find(x=>x.id===bid); return b?b.name:bid; }).join(', ');
    const item = document.createElement('div');
    item.className = 'cfg-user-item';
    item.innerHTML = `
      <div class="cfg-user-info">
        <div class="cfg-user-name">${u.displayName||u.id} <span class="cfg-role-pill role-${u.role}">${roleLabels[u.role]||u.role}</span></div>
        <div class="cfg-user-meta">@${u.id}${assignedBars ? ' · '+assignedBars : ''}${u.pages&&u.pages.length?' · '+u.pages.length+' event(s)':''}</div>
      </div>
      <button class="cfg-del-btn" onclick="deleteUser('${u.id}')">✕</button>`;
    el.appendChild(item);
  });
}

function openAddUserModal() {
  editingUserId = null;
  document.getElementById('um-title').textContent = 'Nouvel utilisateur';
  document.getElementById('um-id').value = '';
  document.getElementById('um-pw').value = '';
  document.getElementById('um-role').value = 'magasinier';
  umRoleChange();
  document.getElementById('user-modal-overlay').classList.add('open');
}

function closeUserModal(e) {
  if (!e || e.target === document.getElementById('user-modal-overlay')) {
    document.getElementById('user-modal-overlay').classList.remove('open');
  }
}

function umRoleChange() {
  const role = document.getElementById('um-role').value;
  const barField = document.getElementById('um-bar-field');
  barField.style.display = role === 'directeur' ? 'none' : 'block';
  const wrap = document.getElementById('um-bars-wrap');
  wrap.innerHTML = '';
  BARS.forEach(b => {
    const chip = document.createElement('div');
    chip.className = 'um-bar-chip';
    chip.textContent = b.name;
    chip.dataset.bid = b.id;
    chip.style.borderColor = b.color;
    chip.onclick = () => {
      chip.classList.toggle('selected');
      chip.style.background = chip.classList.contains('selected') ? b.color : '';
      chip.style.color = chip.classList.contains('selected') ? '#000' : 'var(--c-muted)';
    };
    wrap.appendChild(chip);
  });
  addPageAccessField();
  addAllowedTypesField(role);
}

const TYPE_DEFAULTS = {
  directeur:  ['reassort','casse','staff','offert'],
  chef_bar:   ['reassort','casse','staff','offert'],
  magasinier: ['reassort','casse'],
};
// retour et entame sont réservés au mode "Fin d'événement" — pas de bouton produit normal

function addAllowedTypesField(role) {
  const existing = document.getElementById('um-types-field');
  if (existing) existing.remove();
  const field = document.createElement('div');
  field.className = 'um-field';
  field.id = 'um-types-field';
  field.innerHTML = '<label>Types de saisie autorisés</label>';
  const wrap = document.createElement('div');
  wrap.className = 'um-bars-wrap';
  wrap.id = 'um-types-wrap';
  const defaults = TYPE_DEFAULTS[role] || ['reassort','casse','staff','offert'];
  const typeLabels = {reassort:'Sortie bar', casse:'Casse', staff:'Staff', offert:'Offert'};
  Object.keys(typeLabels).forEach(t => {
    const chip = document.createElement('div');
    chip.className = 'um-bar-chip' + (defaults.includes(t) ? ' selected' : '');
    chip.textContent = typeLabels[t];
    chip.dataset.tid = t;
    if (defaults.includes(t)) { chip.style.background = 'var(--c-accent)'; chip.style.color = '#000'; }
    chip.onclick = () => {
      chip.classList.toggle('selected');
      chip.style.background = chip.classList.contains('selected') ? 'var(--c-accent)' : '';
      chip.style.color = chip.classList.contains('selected') ? '#000' : 'var(--c-muted)';
    };
    wrap.appendChild(chip);
  });
  field.appendChild(wrap);
  const modal = document.querySelector('.user-modal');
  modal.insertBefore(field, modal.lastElementChild);
}

function addPageAccessField() {
  const existing = document.getElementById('um-page-field');
  if (existing) existing.remove();
  const pages = [
    {id:'gartenstock_prix_de_diane',    name:'Prix de Diane'},
    {id:'gartenstock_carl_cox',         name:'Carl Cox'},
    {id:'gartenstock_ludovico_einaudi', name:'Ludovico Einaudi'},
    {id:'gartenstock_gotb',             name:'GOTB'},
    {id:'gartenstock_fontainebleau',    name:'Fontainebleau'},
  ];
  if (document.getElementById('um-role').value === 'directeur') return;
  const field = document.createElement('div');
  field.className = 'um-field';
  field.id = 'um-page-field';
  field.innerHTML = '<label>Accès événements</label>';
  const wrap = document.createElement('div');
  wrap.className = 'um-bars-wrap';
  wrap.id = 'um-pages-wrap';
  pages.forEach(p => {
    const chip = document.createElement('div');
    chip.className = 'um-bar-chip';
    chip.textContent = p.name;
    chip.dataset.pid = p.id;
    chip.onclick = () => {
      chip.classList.toggle('selected');
      chip.style.background = chip.classList.contains('selected') ? 'var(--c-accent)' : '';
      chip.style.color = chip.classList.contains('selected') ? '#000' : 'var(--c-muted)';
    };
    wrap.appendChild(chip);
  });
  field.appendChild(wrap);
  document.querySelector('.user-modal').insertBefore(field, document.querySelector('.user-modal').lastElementChild);
}

async function saveUser() {
  const id    = document.getElementById('um-id').value.trim().toLowerCase();
  const rawPw = document.getElementById('um-pw').value.trim();
  const role  = document.getElementById('um-role').value;
  if (!id || !rawPw) { showToast('Identifiant et mot de passe requis'); return; }
  if (ALL_USERS.find(u => u.id === id)) { showToast('Identifiant déjà utilisé'); return; }
  const barIds      = [...document.querySelectorAll('#um-bars-wrap .um-bar-chip.selected')].map(c => c.dataset.bid);
  const pages       = [...document.querySelectorAll('#um-pages-wrap .um-bar-chip.selected')].map(c => c.dataset.pid);
  const allowedTypes= [...document.querySelectorAll('#um-types-wrap .um-bar-chip.selected')].map(c => c.dataset.tid);
  const pwHash = await sha256(rawPw);
  const newUser = {id, pw: pwHash, role, barIds, pages, allowedTypes, displayName: id};
  ALL_USERS.push(newUser);
  if (window._fbSaveUsers) await window._fbSaveUsers(ALL_USERS);
  renderCfgUsers();
  document.getElementById('user-modal-overlay').classList.remove('open');
  showToast('✓ Utilisateur créé : ' + id);
}

async function deleteUser(userId) {
  if (userId === 'directeur') { showToast('Le compte directeur ne peut pas être supprimé'); return; }
  if (!confirm('Supprimer l\'utilisateur ' + userId + ' ?')) return;
  ALL_USERS = ALL_USERS.filter(u => u.id !== userId);
  if (window._fbSaveUsers) await window._fbSaveUsers(ALL_USERS);
  renderCfgUsers();
  showToast('Utilisateur supprimé');
}

// ════════════════════════════════
//  DATA
// ════════════════════════════════
const BAR_COLORS   = ['#e8c547','#52c47a','#5b9be8','#9b7fe8','#e87a3a','#e05252','#5bc4c4','#c47a52'];
const PRODUCT_ICONS = ['🍺','🍾','💧','🥤','🍷','🥂','🥃','🍹','🧃','☕'];

let BARS = [
  {id:'b1', name:'Bar 1', color:'#e8c547'},
  {id:'b2', name:'Bar 2', color:'#52c47a'},
  {id:'b3', name:'Bar 3', color:'#5b9be8'},
  {id:'b4', name:'Bar 4', color:'#9b7fe8'},
  {id:'b5', name:'VIP',   color:'#e87a3a'},
];

let ALL_PRODUCTS = [
  // unitCl = centilitres par unité physique  |  portionCl = centilitres par verre servi
  {id:'fut_blonde', name:'Fût Blonde 30L',      icon:'🍺', pack:1,  liters:30, unitCl:3000, portionCl:25,   bars:['b1','b2','b3','b4','b5'], types:['reassort','casse','staff','offert'], alertSeuil:1},
  {id:'fut_brune',  name:'Fût Brune 30L',       icon:'🍺', pack:1,  liters:30, unitCl:3000, portionCl:25,   bars:['b1','b2','b3','b4'],     types:['reassort','casse','staff','offert'], alertSeuil:1},
  {id:'biere_btle', name:'Bière bouteille 33cl', icon:'🍾', pack:24,            unitCl:33,   portionCl:33,   bars:['b1','b2','b3','b4'],     types:['reassort','casse','staff','offert'], alertSeuil:2},
  {id:'eau_50',     name:'Eau 50cl',             icon:'💧', pack:24,            unitCl:50,   portionCl:50,   bars:['b1','b2','b3','b4','b5'],types:['reassort','casse','staff'],           alertSeuil:2},
  {id:'soda_33',    name:'Soda 33cl',            icon:'🥤', pack:24,            unitCl:33,   portionCl:33,   bars:['b1','b2','b3','b4','b5'],types:['reassort','casse','staff'],           alertSeuil:2},
  {id:'vin_bib',    name:'Vin rouge BIB 10L',    icon:'🍷', pack:1,  liters:10, unitCl:1000, portionCl:12.5, bars:['b1','b2','b3','b4','b5'],types:['reassort','casse','staff','offert'], alertSeuil:1},
  {id:'champ_6',    name:'Champagne 75cl',       icon:'🥂', pack:6,             unitCl:75,   portionCl:14,   bars:['b5'],                    types:['reassort','casse','offert'],          alertSeuil:2},
  {id:'spirit',     name:'Spiritueux 70cl',      icon:'🥃', pack:1,             unitCl:70,   portionCl:4,    bars:['b5'],                    types:['reassort','casse','staff','offert'],  alertSeuil:2},
];

let STOCKS = {
  b1:{fut_blonde:4,fut_brune:2,biere_btle:10,eau_50:8,soda_33:6,vin_bib:3},
  b2:{fut_blonde:4,fut_brune:2,biere_btle:10,eau_50:8,soda_33:6,vin_bib:3},
  b3:{fut_blonde:3,fut_brune:2,biere_btle:8,eau_50:6,soda_33:5,vin_bib:2},
  b4:{fut_blonde:3,fut_brune:2,biere_btle:8,eau_50:6,soda_33:5,vin_bib:2},
  b5:{fut_blonde:2,vin_bib:3,champ_6:6,spirit:12,eau_50:4,soda_33:4},
};

// Multi-jours
let currentDay = 'j1';
let days = ['j1'];
let DAY_STOCKS = { j1: {} }; // stocks de départ par jour, copié depuis STOCKS à la création de J1

let currentBar  = BARS[0].id;
let mQty = 1, mType = 'reassort', mProduct = null, mUnitMode = false;
let _lpTimer = null, _lpFired = false;
let log = [];
let inventaires = [];
let ventesCaisse = {}; // { barId: { productId: portionsVendues } }
let eventClosed = false;
let idCounter = 100;
const _notifiedAlerts = new Set();

// PIN haché (SHA-256) — initialisé au démarrage
let CONFIG_PIN_HASH  = '';
let CONFIG_PIN_LEN   = 3; // longueur du PIN courant

async function initPinHash() {
  CONFIG_PIN_HASH = await sha256('666');
  CONFIG_PIN_LEN  = 3;
  // Sera écrasé par les données Firebase si un pinHash est stocké
}

// ════════════════════════════════
//  STOCK CALCULATION
// ════════════════════════════════
function calcStock(barId, productId) {
  const init = (STOCKS[barId] && STOCKS[barId][productId]) || 0;
  const dayLog = log.filter(e => e.barId === barId && e.productId === productId && e.day === currentDay);
  const reassort = dayLog.filter(e => e.type === 'reassort').reduce((s,e) => s + e.qty, 0);
  const out = dayLog.filter(e => e.type !== 'reassort').reduce((s,e) => {
    return s + (e.unitMode && e.pack > 1 ? e.qty / e.pack : e.qty);
  }, 0);
  return init + reassort - out;
}

// ════════════════════════════════
//  RÉCONCILIATION CAISSE ↔ STOCK
// ════════════════════════════════
// Convertit tout en centilitres (unité pivot) pour comparer
// stock consommé (packs logistiques) et ventes POS (verres servis).
//
//  unitCl    = cL par unité physique (bouteille / fût / BIB…)
//  portionCl = cL par verre servi au client
//
// Volume sorti (cL)        = reassorts × pack × unitCl
// Volume retour (cL)       = retours   × pack × unitCl
// Volume pertes (cL)       = (casse + staff + offert + entamé) × unitCl (ou × pack × unitCl si non-unitMode)
// Volume dispo vente (cL)  = sorti − retour − pertes
// Verres théo              = dispo / portionCl
// Ventes caisse (verres)   = saisies directeur dans le récap
// Écart                    = ventes réelles − théoriques

function calcReconProduct(barId, p) {
  if (!p.unitCl || !p.portionCl) return null;
  const packSize = p.pack || 1;
  const pLog = log.filter(e => e.barId === barId && e.productId === p.id);

  let clSorti = 0, clRetour = 0, clPertes = 0;

  pLog.forEach(e => {
    // Si unitMode : e.qty est en unités individuelles ; sinon en packs
    const qCl = e.unitMode && packSize > 1
      ? e.qty * p.unitCl
      : e.qty * packSize * p.unitCl;

    if (e.type === 'reassort')     clSorti  += qCl;
    else if (e.type === 'retour')  clRetour += qCl;
    else                           clPertes += qCl; // casse / staff / offert / entame
  });

  const clDispo = clSorti - clRetour - clPertes;
  const portionsTheo = p.portionCl > 0 ? clDispo / p.portionCl : 0;
  const portionsReel = ventesCaisse[barId]?.[p.id] ?? null;
  const clReel       = portionsReel !== null ? portionsReel * p.portionCl : null;
  const ecartCl      = clReel !== null ? clReel - clDispo : null;
  const ecartPct     = clDispo > 0 && ecartCl !== null ? ecartCl / clDispo * 100 : null;

  return {
    name: p.name, unitCl: p.unitCl, portionCl: p.portionCl,
    clSorti: Math.round(clSorti), clRetour: Math.round(clRetour),
    clPertes: Math.round(clPertes), clDispo: Math.round(clDispo),
    portionsTheo: Math.round(portionsTheo * 10) / 10,
    portionsReel,
    ecartCl:  ecartCl  !== null ? Math.round(ecartCl)            : null,
    ecartPct: ecartPct !== null ? Math.round(ecartPct * 10) / 10 : null,
  };
}

function saveVentes(barId, productId, val) {
  if (!ventesCaisse[barId]) ventesCaisse[barId] = {};
  const v = parseFloat(val);
  ventesCaisse[barId][productId] = isNaN(v) ? null : v;
  saveAll();
}

function getBarProducts(barId) {
  return ALL_PRODUCTS.filter(p => (p.bars||[]).includes(barId));
}

// ════════════════════════════════
//  FIREBASE PERSISTENCE
// ════════════════════════════════
window._fbApply = function(data) {
  let changed = false;
  if (data.log)      { log = data.log;              changed = true; }
  if (data.STOCKS)   { STOCKS = data.STOCKS;         changed = true; }
  if (data.BARS)     { BARS = data.BARS;             changed = true; }
  if (data.PRODUCTS) { ALL_PRODUCTS = data.PRODUCTS; changed = true; }
  if (data.days)     { days = data.days;             changed = true; }
  if (data.DAY_STOCKS){ DAY_STOCKS = data.DAY_STOCKS; changed = true; }
  if (data.currentDay){ currentDay = data.currentDay; changed = true; }
  if (data.pinHash)    { CONFIG_PIN_HASH = data.pinHash; CONFIG_PIN_LEN = data.pinLen || 3; }
  if (data.inventaires)  { inventaires = data.inventaires; }
  if (data.ventesCaisse) { ventesCaisse = data.ventesCaisse; }
  if (data.eventClosed !== undefined) {
    eventClosed = data.eventClosed;
    applyEventClosedUI();
  }
  if (data.eventName) {
    const el = document.getElementById('event-name');
    if (el) el.textContent = data.eventName;
  }
  if (changed && document.readyState !== 'loading') {
    buildDaySelector();
    buildBarSelector();
    buildProducts();
    if (document.getElementById('screen-log').classList.contains('active')) buildLog();
    if (document.getElementById('screen-recap').classList.contains('active')) buildRecap();
  }
};

function saveAll() {
  const data = {
    log, STOCKS, BARS,
    PRODUCTS: ALL_PRODUCTS,
    days, DAY_STOCKS, currentDay,
    pinHash: CONFIG_PIN_HASH,
    pinLen:  CONFIG_PIN_LEN,
    inventaires,
    ventesCaisse,
    eventClosed,
    eventName: document.getElementById('event-name').textContent,
    updatedAt: new Date().toISOString(),
  };
  if (window._fbSave) window._fbSave(data);
}

function loadAll() {
  if (window._fbLoad) window._fbLoad();
}

function resetAllData() {
  if (!confirm('⚠️ Remettre à zéro toutes les données de cet événement ?\nCette action est irréversible.')) return;
  log = []; days = ['j1']; currentDay = 'j1'; DAY_STOCKS = {j1:{}};
  saveAll();
  buildDaySelector(); buildBarSelector(); buildProducts(); buildLog();
  showToast('Données réinitialisées');
}

// ════════════════════════════════
//  MULTI-JOURS
// ════════════════════════════════
function buildDaySelector() {
  const el = document.getElementById('day-selector');
  if (!el) return;
  if (days.length <= 1) { el.innerHTML = ''; return; }
  el.innerHTML = '';
  days.forEach(d => {
    const btn = document.createElement('button');
    btn.className = 'day-chip' + (d === currentDay ? ' active' : '');
    btn.textContent = d.toUpperCase();
    btn.onclick = () => switchDay(d);
    el.appendChild(btn);
  });
}

function switchDay(day) {
  if (!days.includes(day)) return;
  currentDay = day;
  // Restaurer les stocks du jour sélectionné
  if (DAY_STOCKS[day]) STOCKS = JSON.parse(JSON.stringify(DAY_STOCKS[day]));
  buildDaySelector();
  buildBarSelector();
  buildProducts();
  if (document.getElementById('screen-log').classList.contains('active')) buildLog();
  if (document.getElementById('screen-recap').classList.contains('active')) buildRecap();
}

function addDay() {
  const nextIdx = days.length + 1;
  const newDay  = 'j' + nextIdx;
  if (days.includes(newDay)) { showToast('Ce jour existe déjà'); return; }

  // Calculer le stock restant à la fin du jour courant → stock de départ du nouveau jour
  const endStocks = {};
  BARS.forEach(bar => {
    endStocks[bar.id] = {};
    ALL_PRODUCTS.filter(p => (p.bars||[]).includes(bar.id)).forEach(p => {
      endStocks[bar.id][p.id] = Math.max(0, calcStock(bar.id, p.id));
    });
  });

  days.push(newDay);
  DAY_STOCKS[newDay] = JSON.parse(JSON.stringify(endStocks));
  currentDay = newDay;
  STOCKS = JSON.parse(JSON.stringify(endStocks));
  saveAll();
  buildDaySelector();
  buildBarSelector();
  buildProducts();
  showToast('✓ Jour ' + newDay.toUpperCase() + ' créé');
}

function renderCfgDays() {
  const el = document.getElementById('cfg-day-list');
  if (!el) return;
  el.innerHTML = '';
  days.forEach(d => {
    const item = document.createElement('div');
    item.className = 'cfg-day-item';
    item.innerHTML = `<strong>${d.toUpperCase()}</strong>${d === currentDay ? '<span class="cfg-day-active-badge">ACTIF</span>' : `<button class="cfg-add-btn" style="margin:0;padding:5px 12px;" onclick="switchDay('${d}');closeConfig();">Activer</button>`}`;
    el.appendChild(item);
  });
}

// ════════════════════════════════
//  BAR SELECTOR
// ════════════════════════════════
function getVisibleBars() {
  if (CURRENT_USER && CURRENT_USER.role !== 'directeur' && CURRENT_USER.barIds && CURRENT_USER.barIds.length > 0) {
    return BARS.filter(b => CURRENT_USER.barIds.includes(b.id));
  }
  return BARS;
}

function buildBarSelector() {
  const el = document.getElementById('bar-selector');
  el.innerHTML = '';
  const visibleBars = getVisibleBars();
  if (!visibleBars.find(b => b.id === currentBar)) currentBar = visibleBars[0]?.id;
  visibleBars.forEach(b => {
    const chip = document.createElement('button');
    chip.className = 'bar-chip' + (b.id === currentBar ? ' active' : '');
    if (b.id === currentBar) { chip.style.background = b.color; chip.style.color = '#000'; chip.style.borderColor = b.color; }
    chip.textContent = b.name;
    chip.onclick = () => { currentBar = b.id; buildBarSelector(); buildProducts(); };
    el.appendChild(chip);
  });
}

// ════════════════════════════════
//  SWIPE POUR CHANGER DE BAR
// ════════════════════════════════
function initSwipe() {
  let touchStartX = 0;
  const appEl = document.getElementById('app');
  appEl.addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; }, {passive:true});
  appEl.addEventListener('touchend', e => {
    // Ne pas intercepter si un modal est ouvert
    if (document.getElementById('overlay').classList.contains('open')) return;
    if (document.getElementById('pin-overlay').classList.contains('open')) return;
    if (document.getElementById('cfg-overlay').classList.contains('open')) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(dx) < 60) return;
    const visible = getVisibleBars();
    const idx = visible.findIndex(b => b.id === currentBar);
    if (dx < 0 && idx < visible.length - 1) currentBar = visible[idx + 1].id;
    else if (dx > 0 && idx > 0) currentBar = visible[idx - 1].id;
    else return;
    buildBarSelector();
    buildProducts();
  }, {passive:true});
}

// ════════════════════════════════
//  PRODUCTS SCREEN
// ════════════════════════════════
function buildProducts() {
  const products = getBarProducts(currentBar);
  const bar = BARS.find(b => b.id === currentBar);
  checkStockAlerts(products, currentBar);
  document.getElementById('bar-product-count').textContent = products.length + ' produits · ' + (bar ? bar.name : '');
  const el = document.getElementById('product-list');
  el.innerHTML = '';

  if (eventClosed) {
    el.innerHTML = '<div class="no-products">🔒 Événement terminé.<br>Les saisies sont désactivées.</div>';
    return;
  }
  if (!products.length) {
    el.innerHTML = '<div class="no-products">Aucun produit assigné à ce bar.<br>Configurez-les via ⚙ Configurer.</div>';
    return;
  }

  products.forEach(p => {
    const remaining = calcStock(currentBar, p.id);
    const init = (STOCKS[currentBar] && STOCKS[currentBar][p.id]) || 0;
    const pct  = init > 0 ? (init - remaining) / init : 0;
    const seuil = p.alertSeuil !== undefined ? p.alertSeuil : 2;
    const isAlert = remaining <= seuil;
    let sc = '#52c47a';
    if (remaining <= 0) sc = '#e05252';
    else if (pct > .6) sc = '#e87a3a';
    const unitStr = p.pack > 1 ? 'pack ×'+p.pack : (p.liters ? p.liters+'L / unité' : 'unité');
    const ps = JSON.stringify(p).replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    const userAllowed = CURRENT_USER?.allowedTypes || ['reassort','casse','staff','offert'];
    const ptypes = (p.types || ['reassort','casse','staff','offert']).filter(t => userAllowed.includes(t));
    const TYPE_LABELS = TYPE_DISPLAY;
    const canQuickAdd = ['reassort','staff'];
    const actionBtns = ptypes.map(t => {
      const lp = canQuickAdd.includes(t)
        ? `onmousedown='startLongPress(${ps},"${t}")' onmouseup='cancelLongPress()' onmouseleave='cancelLongPress()' ontouchstart='startLongPress(${ps},"${t}");event.preventDefault();' ontouchend='cancelLongPress();'`
        : '';
      return `<button class="pact-btn ${t}${canQuickAdd.includes(t)?' pact-lp':''}" onclick='handlePactBtn(${ps},"${t}")' ${lp}>${TYPE_LABELS[t]||t.toUpperCase()}<span class="pact-lp-hint">⚡+1</span></button>`;
    }).join('');
    const alertBadge = isAlert ? '<span class="stock-alert-badge">⚠ BAS</span>' : '';
    const div = document.createElement('div');
    div.className = 'pcard' + (isAlert ? ' pcard--alert' : '');
    div.innerHTML = `
      <div class="pcard-head">
        <div class="pcard-icon">${p.icon}</div>
        <div class="pcard-name"><strong>${p.name}</strong><span>${unitStr} · stock : ${init}</span></div>
        <div class="pcard-stock"><strong style="color:${sc}">${Number.isInteger(remaining) ? remaining : remaining.toFixed(1)}</strong>restants${alertBadge}</div>
      </div>
      <div class="pcard-actions" style="grid-template-columns:repeat(${ptypes.length},1fr)">${actionBtns}</div>`;
    el.appendChild(div);
  });
}

// ════════════════════════════════
//  SAISIE MODAL
// ════════════════════════════════
const ALL_TYPES = {
  reassort: {label:'Sortie bar',    sub:'sortie du camion vers le bar'},
  casse:    {label:'Casse',         sub:'bris / détérioration'},
  staff:    {label:'Staff',         sub:'consommé équipe'},
  offert:   {label:'Offert',        sub:'gratuit / artiste'},
  retour:   {label:'Retour camion', sub:'pack non consommé retourné au camion'},
  entame:   {label:'Entamé perdu',  sub:'reste d\'un pack ouvert, non récupérable'},
};

// Labels d'affichage centralisés (la clé interne reste identique)
const TYPE_DISPLAY = {
  reassort: 'SORTIE BAR',
  casse:    'CASSE',
  staff:    'STAFF',
  offert:   'OFFERT',
  retour:   'RETOUR',
  entame:   'ENTAMÉ',
};

// Types qui sont des "pertes" réelles (retour n'en est pas un)
const LOSS_TYPES = ['casse','staff','offert','entame'];

function openModal(p, type) {
  mProduct = p; mQty = 1; mType = type; mUnitMode = false;
  document.getElementById('m-name').textContent = p.name;
  document.getElementById('m-sub').textContent  = (BARS.find(b=>b.id===currentBar)||{name:''}).name + ' · ' + (p.pack > 1 ? 'pack ×'+p.pack : (p.liters ? p.liters+'L' : 'unité'));
  updateModalQty();
  const userAllowed = CURRENT_USER?.allowedTypes || ['reassort','casse','staff','offert'];
  const availTypes = (p.types || ['reassort','casse','staff','offert']).filter(t => userAllowed.includes(t));
  buildTypeGrid(availTypes);
  if (!availTypes.includes(mType)) mType = availTypes[0] || type;
  updateTypeUI();
  updateUnitModeToggle();
  const needsReason = ['offert','casse'].includes(mType);
  setReasonField(needsReason, mType);
  setRecipientField(mType === 'offert');
  document.getElementById('m-reason').value = '';
  const rec = document.getElementById('m-recipient'); if(rec) rec.value = '';
  document.getElementById('overlay').classList.add('open');
}

function buildTypeGrid(types) {
  const grid = document.getElementById('m-type-grid');
  grid.innerHTML = '';
  types.forEach(t => {
    const info = ALL_TYPES[t] || {label:t, sub:''};
    const div  = document.createElement('div');
    div.className = 'type-opt';
    div.id = 'to-'+t;
    div.onclick = () => setType(t);
    div.innerHTML = `<strong>${info.label}</strong><span>${info.sub}</span>`;
    grid.appendChild(div);
  });
}

function updateModalQty() {
  document.getElementById('m-qty').textContent = mQty;
  let hint = ''+mQty;
  if (mUnitMode) {
    hint += ' unité'+(mQty>1?'s':'');
    if (mProduct.pack > 1) hint += ' ('+mQty+'/'+mProduct.pack+' du pack)';
  } else if (mProduct.pack > 1) {
    hint += ' pack'+(mQty>1?'s':'')+' = '+(mQty*mProduct.pack)+' unités';
  } else if (mProduct.liters) {
    hint += ' × '+mProduct.liters+'L = '+(mQty*mProduct.liters)+'L';
  } else {
    hint += ' unité'+(mQty>1?'s':'');
  }
  document.getElementById('m-hint').textContent = hint;
}

function adjQty(d) { mQty = Math.max(1, mQty+d); updateModalQty(); }

function toggleUnitMode() {
  mUnitMode = !mUnitMode;
  mQty = 1;
  const btn = document.getElementById('unit-mode-btn');
  if (btn) {
    btn.classList.toggle('active', mUnitMode);
    btn.textContent = mUnitMode ? '📦 Par pack' : '🔢 Par unité';
  }
  updateModalQty();
}

function updateUnitModeToggle() {
  const wrap = document.getElementById('unit-mode-wrap');
  if (!wrap) return;
  const canUnit = mProduct && mProduct.pack > 1 && ['casse','offert','staff','entame'].includes(mType);
  wrap.style.display = canUnit ? 'flex' : 'none';
  if (!canUnit && mUnitMode) {
    mUnitMode = false;
    const btn = document.getElementById('unit-mode-btn');
    if (btn) { btn.classList.remove('active'); btn.textContent = '🔢 Par unité'; }
  }
}

const REASON_LABELS = {
  offert: {label: "Motif de l'offert", placeholder: "Ex : artiste invité, geste commercial…"},
  casse:  {label: "Motif de la casse",  placeholder: "Ex : bouteille tombée, fût percé…"},
};

function setType(t) {
  mType = t;
  mUnitMode = false;
  updateTypeUI();
  updateUnitModeToggle();
  const needsReason = ['offert','casse'].includes(t);
  setReasonField(needsReason, t);
  setRecipientField(t === 'offert');
  if (!needsReason) document.getElementById('m-reason').value = '';
  if (t !== 'offert') { const r = document.getElementById('m-recipient'); if(r) r.value=''; }
  const btn = document.getElementById('unit-mode-btn');
  if (btn) { btn.classList.remove('active'); btn.textContent = '🔢 Par unité'; }
  updateModalQty();
}

function setReasonField(show, type) {
  const el = document.getElementById('m-reason-field');
  if (!el) return;
  el.style.display = show ? 'block' : 'none';
  if (show && REASON_LABELS[type]) {
    const lbl = document.getElementById('m-reason-label-text');
    if (lbl) lbl.textContent = REASON_LABELS[type].label;
    const ta = document.getElementById('m-reason');
    if (ta) ta.placeholder = REASON_LABELS[type].placeholder;
  }
}

function setRecipientField(show) {
  const el = document.getElementById('m-recipient-field');
  if (el) el.style.display = show ? 'block' : 'none';
}

function updateTypeUI() {
  const userAllowed = CURRENT_USER?.allowedTypes || ['reassort','casse','staff','offert'];
  const types = mProduct ? (mProduct.types || ['reassort','casse','staff','offert']).filter(t => userAllowed.includes(t)) : [];
  types.forEach(t => {
    const el = document.getElementById('to-'+t);
    if (el) el.className = 'type-opt'+(t===mType?' sel-'+t:'');
  });
}

function confirmEntry() {
  if (!mProduct) return;
  let reason = '', recipient = '';
  if (['offert','casse'].includes(mType)) {
    reason = (document.getElementById('m-reason').value || '').trim();
    if (!reason) {
      document.getElementById('m-reason').focus();
      showToast(mType === 'offert' ? 'Un motif est requis pour un offert' : 'Un motif est requis pour une casse');
      return;
    }
  }
  if (mType === 'offert') {
    recipient = (document.getElementById('m-recipient').value || '').trim();
    if (!recipient) {
      document.getElementById('m-recipient').focus();
      showToast('Indiquer le bénéficiaire de l\'offert');
      return;
    }
  }
  const bar = BARS.find(b => b.id === currentBar);
  const units = mUnitMode ? mQty : mQty * (mProduct.pack || 1);
  log.unshift({
    id: Date.now(), time: now(), day: currentDay,
    barId: currentBar, barName: bar.name,
    productId: mProduct.id, productName: mProduct.name, pack: mProduct.pack,
    qty: mQty, units, type: mType, unitMode: mUnitMode,
    reason, recipient,
    userId:      CURRENT_USER ? CURRENT_USER.id : 'inconnu',
    userDisplay: CURRENT_USER ? (CURRENT_USER.displayName||CURRENT_USER.id) : 'inconnu',
    userRole:    CURRENT_USER ? CURRENT_USER.role : '',
  });
  saveAll();
  closeOverlay();
  buildProducts();
  const qtyLabel = mUnitMode ? mQty+' u.' : mQty+(mProduct.pack>1?' pack'+(mQty>1?'s':''):' u.');
  showToast('✓ ' + mProduct.name + ' · ' + qtyLabel + ' · ' + mType);
}

function overlayClick(e) { if(e.target === document.getElementById('overlay')) closeOverlay(); }
function closeOverlay()   { document.getElementById('overlay').classList.remove('open'); }

// ════════════════════════════════
//  LONG PRESS QUICK ADD (+1 pack)
// ════════════════════════════════
function startLongPress(p, type) {
  _lpFired = false;
  _lpTimer = setTimeout(() => {
    _lpFired = true;
    _lpTimer = null;
    quickAdd(p, type);
  }, 600);
}

function cancelLongPress() {
  if (_lpTimer) { clearTimeout(_lpTimer); _lpTimer = null; }
}

function handlePactBtn(p, type) {
  if (_lpFired) { _lpFired = false; return; }
  openModal(p, type);
}

function quickAdd(p, type) {
  const bar = BARS.find(b => b.id === currentBar);
  log.unshift({
    id: Date.now(), time: now(), day: currentDay,
    barId: currentBar, barName: bar.name,
    productId: p.id, productName: p.name, pack: p.pack,
    qty: 1, units: p.pack || 1, type, unitMode: false,
    reason: '', recipient: '',
    userId:      CURRENT_USER ? CURRENT_USER.id : 'inconnu',
    userDisplay: CURRENT_USER ? (CURRENT_USER.displayName||CURRENT_USER.id) : 'inconnu',
    userRole:    CURRENT_USER ? CURRENT_USER.role : '',
  });
  saveAll();
  buildProducts();
  showToast('⚡ +1 ' + p.name + ' · ' + type);
}

// ════════════════════════════════
//  LOG
// ════════════════════════════════
function buildLog() {
  const el = document.getElementById('log-list');
  const dayLog = currentDay ? log.filter(e => !e.day || e.day === currentDay) : log;
  if (!dayLog.length) { el.innerHTML='<div class="log-empty">Aucune sortie enregistrée</div>'; return; }
  el.innerHTML = '';
  dayLog.forEach(e => {
    const canDelete = CURRENT_USER && (
      CURRENT_USER.role === 'directeur' ||
      (CURRENT_USER.id === e.userId && (Date.now() - e.id) < 30 * 60 * 1000)
    );
    const div = document.createElement('div');
    div.className = 'log-entry';
    div.innerHTML = `
      <span class="log-time">${e.time}</span>
      <span class="log-bar">${e.barName}</span>
      <span class="log-product">${e.productName}</span>
      <span class="log-qty">${e.unitMode ? e.qty+' u.' : e.qty+(e.pack>1?' pkt':' u.')}</span>
      <span class="log-type-pill pill-${e.type}">${TYPE_DISPLAY[e.type] || e.type.toUpperCase()}</span>
      ${e.userDisplay ? `<span style="font-size:10px;color:var(--c-muted);font-family:var(--font-mono);flex-shrink:0;">${e.userDisplay}</span>` : ''}
      ${canDelete ? `<button class="log-delete" onclick="deleteLogEntry(${e.id})" title="Annuler cette saisie">✕</button>` : ''}
      ${e.reason ? `<div class="log-reason">💬 ${e.reason}${e.recipient ? ` · <strong>${e.recipient}</strong>` : ''}</div>` : ''}`;
    el.appendChild(div);
  });
}

function deleteLogEntry(id) {
  if (!confirm('Annuler cette saisie ?')) return;
  log = log.filter(e => e.id !== id);
  saveAll();
  buildLog();
  buildProducts();
  showToast('Saisie annulée');
}

function clearLog() {
  if (!log.length) return;
  if (!confirm('Effacer tout l\'historique ?')) return;
  log = []; saveAll(); buildLog(); buildProducts(); showToast('Historique effacé');
}

// ════════════════════════════════
//  RECAP
// ════════════════════════════════
let _charts = {};

function destroyCharts() {
  Object.values(_charts).forEach(c => { try { c.destroy(); } catch(e){} });
  _charts = {};
}

function buildRecap() {
  destroyCharts();
  const el = document.getElementById('recap-content');
  el.innerHTML = '';
  const activeLog = log.filter(e => !e.day || e.day === currentDay);
  let hasData = false;

  // ── VUE GLOBALE (cross-bars, directeur uniquement) ──
  if (CURRENT_USER && CURRENT_USER.role === 'directeur' && activeLog.length) {
    const globalSec = document.createElement('div');
    globalSec.className = 'recap-bar-section';
    const allProdIds = [...new Set(activeLog.map(e => e.productId))];
    const headers = BARS.filter(b => activeLog.some(e => e.barId === b.id)).map(b => `<th>${b.name}</th>`).join('');
    const activeBars = BARS.filter(b => activeLog.some(e => e.barId === b.id));
    const rows = allProdIds.map(pid => {
      const pName = activeLog.find(e => e.productId === pid)?.productName || pid;
      const cells = activeBars.map(bar => {
        const qty = activeLog.filter(e => e.barId === bar.id && e.productId === pid && e.type !== 'reassort').reduce((s,e) => s+e.units, 0);
        return `<td>${qty || '—'}</td>`;
      }).join('');
      return `<tr><td>${pName}</td>${cells}</tr>`;
    }).join('');
    globalSec.innerHTML = `
      <div class="recap-bar-title" style="color:var(--c-accent)">Vue globale · ${currentDay.toUpperCase()}</div>
      <div style="overflow-x:auto;margin-bottom:12px;">
        <table class="global-table"><thead><tr><th>Produit</th>${headers}</tr></thead><tbody>${rows}</tbody></table>
      </div>`;
    el.appendChild(globalSec);
    hasData = true;
  }

  // ── SECTION PAR BAR ──
  BARS.forEach(bar => {
    const bLog = activeLog.filter(e => e.barId === bar.id);
    if (!bLog.length) return;
    hasData = true;

    const tr  = bLog.filter(e=>e.type==='reassort').reduce((s,e)=>s+e.units,0);
    const tc  = bLog.filter(e=>e.type==='casse').reduce((s,e)=>s+e.units,0);
    const ts  = bLog.filter(e=>e.type==='staff').reduce((s,e)=>s+e.units,0);
    const to  = bLog.filter(e=>e.type==='offert').reduce((s,e)=>s+e.units,0);
    const trt = bLog.filter(e=>e.type==='retour').reduce((s,e)=>s+e.units,0);
    const ten = bLog.filter(e=>e.type==='entame').reduce((s,e)=>s+e.units,0);

    const byP = {};
    bLog.forEach(e => {
      if (!byP[e.productId]) byP[e.productId] = {name:e.productName, pack:e.pack, reassort:0, casse:0, staff:0, offert:0, retour:0, entame:0};
      if (byP[e.productId][e.type] !== undefined) byP[e.productId][e.type] += e.qty;
    });

    const depackItems = [];
    Object.values(byP).forEach(p => {
      if (p.pack <= 1) return;
      const tot = (p.reassort||0)+(p.casse||0)+(p.staff||0)+(p.offert||0)+(p.retour||0)+(p.entame||0);
      const frac = tot - Math.floor(tot);
      const left = frac > 0 ? Math.round(p.pack - frac*p.pack) : 0;
      if (left > 0) depackItems.push({name:p.name, left});
    });

    const rows = Object.values(byP).map(p =>
      `<tr><td>${p.name}</td><td style="color:var(--c-accent)">${p.reassort||'—'}</td><td style="color:var(--c-red)">${p.casse||'—'}</td><td style="color:var(--c-green)">${p.staff||'—'}</td><td style="color:var(--c-purple)">${p.offert||'—'}</td><td style="color:#5bc4c4">${p.retour||'—'}</td><td style="color:var(--c-orange)">${p.entame||'—'}</td></tr>`
    ).join('');
    const depackHTML = depackItems.length ? `<div class="depack-block"><div class="depack-block-title">⚠ Stock dépaqueté non retournable</div>${depackItems.map(d=>`<div class="depack-row2"><span>${d.name}</span><span>${d.left} unités restantes</span></div>`).join('')}</div>` : '';

    const chartBarId  = 'chart-bar-' + bar.id;
    const chartTimeId = 'chart-time-' + bar.id;

    const sec = document.createElement('div');
    sec.className = 'recap-bar-section';
    sec.innerHTML = `
      <div class="recap-bar-title" style="color:${bar.color}">${bar.name}</div>
      <div class="kpi-row">
        <div class="kpi"><div class="kpi-label">Sortie bar</div><div class="kpi-val yellow">${tr}</div></div>
        <div class="kpi"><div class="kpi-label">Pertes réelles</div><div class="kpi-val red">${tc+ts+to+ten}</div></div>
        <div class="kpi"><div class="kpi-label">Retours camion</div><div class="kpi-val teal">${trt}</div></div>
        <div class="kpi"><div class="kpi-label">Entamés perdus</div><div class="kpi-val orange">${ten}</div></div>
      </div>
      ${depackHTML}
      <table class="rtable"><thead><tr><th>Produit</th><th>Sortie bar</th><th>Casse</th><th>Staff</th><th>Offert</th><th>Retour</th><th>Entamé</th></tr></thead><tbody>${rows}</tbody></table>
      ${buildOffertDetail(bLog)}
      ${buildCasseDetail(bLog)}
      <div class="chart-wrap print-hide"><div class="chart-title">Consommation par produit</div><canvas id="${chartBarId}" height="160"></canvas></div>
      <div class="chart-wrap print-hide" style="margin-bottom:20px;"><div class="chart-title">Activité dans le temps</div><canvas id="${chartTimeId}" height="140"></canvas></div>`;
    el.appendChild(sec);

    // Chart 1 : barres par produit (stacked)
    const prodNames  = Object.values(byP).map(p => p.name);
    const reassortD  = Object.values(byP).map(p => p.reassort||0);
    const casseD     = Object.values(byP).map(p => p.casse||0);
    const staffD     = Object.values(byP).map(p => p.staff||0);
    const offertD    = Object.values(byP).map(p => p.offert||0);
    const isDark = !document.documentElement.classList.contains('light');
    const textColor = isDark ? '#6b6b6b' : '#888882';
    const gridColor = isDark ? '#2a2a2a' : '#d8d4ce';

    if (typeof Chart !== 'undefined') {
      _charts[chartBarId] = new Chart(document.getElementById(chartBarId), {
        type: 'bar',
        data: {
          labels: prodNames,
          datasets: [
            {label:'Sortie bar', data:reassortD, backgroundColor:'rgba(232,197,71,.7)'},
            {label:'Casse',    data:casseD,    backgroundColor:'rgba(224,82,82,.7)'},
            {label:'Staff',    data:staffD,    backgroundColor:'rgba(82,196,122,.7)'},
            {label:'Offert',   data:offertD,   backgroundColor:'rgba(155,127,232,.7)'},
          ],
        },
        options: {
          responsive:true, animation:false,
          plugins:{legend:{labels:{color:textColor,font:{size:10}}}},
          scales:{
            x:{stacked:true, ticks:{color:textColor,font:{size:9}}, grid:{color:gridColor}},
            y:{stacked:true, ticks:{color:textColor,font:{size:9}}, grid:{color:gridColor}},
          },
        },
      });

      // Chart 2 : courbe temporelle (buckets 30 min)
      const timeSlots = buildTimeSlots();
      const tsLabels  = timeSlots.map(s => s.label);
      const tDataRea  = timeSlots.map(s => bLog.filter(e=>e.type==='reassort'&&slotMatch(e.time,s)).reduce((a,e)=>a+e.units,0));
      const tDataCas  = timeSlots.map(s => bLog.filter(e=>e.type==='casse'&&slotMatch(e.time,s)).reduce((a,e)=>a+e.units,0));
      const tDataSta  = timeSlots.map(s => bLog.filter(e=>e.type==='staff'&&slotMatch(e.time,s)).reduce((a,e)=>a+e.units,0));
      const tDataOff  = timeSlots.map(s => bLog.filter(e=>e.type==='offert'&&slotMatch(e.time,s)).reduce((a,e)=>a+e.units,0));

      _charts[chartTimeId] = new Chart(document.getElementById(chartTimeId), {
        type: 'line',
        data: {
          labels: tsLabels,
          datasets: [
            {label:'Sortie bar', data:tDataRea, borderColor:'#e8c547', backgroundColor:'rgba(232,197,71,.15)', tension:.3, fill:true, pointRadius:2},
            {label:'Casse',    data:tDataCas, borderColor:'#e05252', backgroundColor:'rgba(224,82,82,.1)',   tension:.3, fill:true, pointRadius:2},
            {label:'Staff',    data:tDataSta, borderColor:'#52c47a', backgroundColor:'rgba(82,196,122,.1)', tension:.3, fill:true, pointRadius:2},
            {label:'Offert',   data:tDataOff, borderColor:'#9b7fe8', backgroundColor:'rgba(155,127,232,.1)',tension:.3, fill:true, pointRadius:2},
          ],
        },
        options: {
          responsive:true, animation:false,
          plugins:{legend:{labels:{color:textColor,font:{size:10}}}},
          scales:{
            x:{ticks:{color:textColor,font:{size:9},maxRotation:45}, grid:{color:gridColor}},
            y:{ticks:{color:textColor,font:{size:9}}, grid:{color:gridColor}, beginAtZero:true},
          },
        },
      });
    }

    // ── RÉCONCILIATION CAISSE ──
    const barProdsWithConv = ALL_PRODUCTS.filter(p => p.bars.includes(bar.id) && p.unitCl && p.portionCl);
    if (barProdsWithConv.length) {
      const isDir = CURRENT_USER?.role === 'directeur';
      const reconRows = barProdsWithConv.map(p => {
        const r = calcReconProduct(bar.id, p);
        if (!r) return '';
        if (r.clSorti === 0) return ''; // rien sorti pour ce produit dans ce bar

        const ecartClass = r.ecartCl === null ? '' : r.ecartCl > 0 ? 'recon-pos' : r.ecartCl < 0 ? 'recon-neg' : 'recon-zero';
        const ecartStr = r.ecartCl === null ? '—'
          : `${r.ecartCl > 0 ? '+' : ''}${r.ecartCl} cL (${r.ecartPct > 0 ? '+' : ''}${r.ecartPct}%)`;
        const portionsTheoStr = `${r.portionsTheo} (× ${r.portionCl} cL)`;
        const inputOrVal = isDir
          ? `<input class="recon-ventes-input" type="number" min="0" step="1"
               value="${r.portionsReel !== null ? r.portionsReel : ''}"
               placeholder="?"
               onchange="saveVentes('${bar.id}','${p.id}',this.value);buildRecap();">`
          : (r.portionsReel !== null ? `<strong>${r.portionsReel}</strong>` : '<span style="color:var(--c-muted)">—</span>');

        return `<tr>
          <td><strong>${p.icon}</strong> ${p.name}</td>
          <td class="recon-num">${r.clSorti.toLocaleString('fr-FR')} cL</td>
          <td class="recon-num recon-loss">${r.clPertes > 0 ? '−'+r.clPertes : '—'}</td>
          <td class="recon-num">${r.clDispo.toLocaleString('fr-FR')} cL</td>
          <td class="recon-num recon-theo">${portionsTheoStr}</td>
          <td class="recon-num recon-input-cell">${inputOrVal}</td>
          <td class="recon-num ${ecartClass}">${ecartStr}</td>
        </tr>`;
      }).filter(Boolean).join('');

      if (reconRows) {
        const reconSec = document.createElement('div');
        reconSec.className = 'recon-section';
        reconSec.innerHTML = `
          <div class="recon-title">📊 Réconciliation caisse / stock</div>
          <div class="recon-legend">
            Unité pivot : <strong>centilitres (cL)</strong> — tout est ramené au même référentiel.
            ${isDir ? 'Saisissez les <strong>verres vendus</strong> selon votre caisse POS.' : ''}
          </div>
          <div class="recon-table-wrap">
            <table class="recon-table">
              <thead><tr>
                <th>Produit</th>
                <th>Sorti camion</th>
                <th>Pertes</th>
                <th>Dispo vente</th>
                <th>Verres théo.</th>
                <th>Ventes caisse</th>
                <th>Écart</th>
              </tr></thead>
              <tbody>${reconRows}</tbody>
            </table>
          </div>
          <div class="recon-footer">
            Verres théo. = Volume dispo ÷ portion (${barProdsWithConv.map(p=>p.portionCl+' cL / '+p.name.split(' ')[0]).join(' · ')})
          </div>`;
        sec.appendChild(reconSec);
      }
    }
  });

  // ── INVENTAIRES ──
  const dayInvs = inventaires.filter(i => i.day === currentDay);
  if (dayInvs.length) {
    const invSec = document.createElement('div');
    invSec.className = 'recap-bar-section';
    invSec.innerHTML = `<div class="recap-bar-title" style="color:var(--c-accent)">📦 Inventaires · ${currentDay.toUpperCase()}</div>`;
    dayInvs.forEach(inv => {
      const time = new Date(inv.timestamp).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
      const invRows = inv.items.map(it => {
        const cls = it.delta === 0 ? 'inv-ok' : it.delta > 0 ? 'inv-surplus' : 'inv-deficit';
        return `<tr><td>${it.productName}</td><td>${it.calculated}</td><td>${it.physical}</td><td class="${cls}">${it.delta > 0 ? '+' : ''}${it.delta}</td></tr>`;
      }).join('');
      const div = document.createElement('div');
      div.innerHTML = `
        <div style="font-size:11px;color:var(--c-muted);font-family:var(--font-mono);margin:8px 0 4px;">${time} · ${inv.barName} · ${inv.userDisplay}</div>
        <table class="rtable"><thead><tr><th>Produit</th><th>Calculé</th><th>Physique</th><th>Écart</th></tr></thead><tbody>${invRows}</tbody></table>`;
      invSec.appendChild(div);
    });
    el.appendChild(invSec);
    hasData = true;
  }

  if (!hasData) el.innerHTML = '<div class="recap-empty">Aucune donnée enregistrée</div>';
}

function buildOffertDetail(bLog) {
  const offerts = bLog.filter(e => e.type === 'offert');
  if (!offerts.length) return '';
  const rows = offerts.map(e =>
    `<tr><td>${e.time}</td><td>${e.productName}</td><td>${e.unitMode ? e.qty+' u.' : e.qty+(e.pack>1?' pkt':' u.')}</td><td>${e.recipient||'—'}</td><td>${e.reason||'—'}</td></tr>`
  ).join('');
  return `<div class="offert-detail-wrap">
    <div class="offert-detail-title">Détail des offerts</div>
    <table class="rtable offert-table"><thead><tr><th>Heure</th><th>Produit</th><th>Qté</th><th>Pour qui</th><th>Motif</th></tr></thead><tbody>${rows}</tbody></table>
  </div>`;
}

function buildCasseDetail(bLog) {
  const casses = bLog.filter(e => e.type === 'casse');
  if (!casses.length) return '';
  const rows = casses.map(e =>
    `<tr><td>${e.time}</td><td>${e.productName}</td><td>${e.unitMode ? e.qty+' u.' : e.qty+(e.pack>1?' pkt':' u.')}</td><td>${e.reason||'—'}</td></tr>`
  ).join('');
  return `<div class="offert-detail-wrap">
    <div class="offert-detail-title" style="color:var(--c-red)">Détail des casses</div>
    <table class="rtable offert-table"><thead><tr><th>Heure</th><th>Produit</th><th>Qté</th><th>Motif</th></tr></thead><tbody>${rows}</tbody></table>
  </div>`;
}

function printRecap() {
  const name = document.getElementById('event-name')?.textContent || 'Récap';
  document.title = name + ' — ' + currentDay.toUpperCase() + ' — Gärten Stock';
  window.print();
}

function buildTimeSlots() {
  const slots = [];
  for (let h = 12; h <= 27; h++) { // 12h→03h (27h = 3h du matin)
    for (let m = 0; m < 60; m += 30) {
      const hh = (h % 24).toString().padStart(2,'0');
      const mm = m.toString().padStart(2,'0');
      slots.push({label:`${hh}:${mm}`, h: h % 24, m});
    }
  }
  return slots;
}

function slotMatch(timeStr, slot) {
  if (!timeStr) return false;
  const [hh, mm] = timeStr.split(':').map(Number);
  const normalH = (hh < 12) ? hh + 24 : hh; // 00-11 → 24-35 pour trier après minuit
  const slotH   = slot.h < 12 ? slot.h + 24 : slot.h;
  return normalH === slotH && mm >= slot.m && mm < slot.m + 30;
}

// ════════════════════════════════
//  PIN
// ════════════════════════════════
let pinBuffer = '';

function initPinDots() {
  const el = document.getElementById('pin-dots');
  if (!el) return;
  el.innerHTML = '';
  for (let i = 0; i < CONFIG_PIN_LEN; i++) {
    const d = document.createElement('div');
    d.className = 'pin-dot';
    d.id = 'pd' + i;
    el.appendChild(d);
  }
}

function requestConfig() {
  pinBuffer = '';
  initPinDots();
  updatePinDots();
  document.getElementById('pin-overlay').classList.add('open');
}

function pinKey(k) {
  if (pinBuffer.length >= CONFIG_PIN_LEN) return;
  pinBuffer += k;
  updatePinDots();
  if (pinBuffer.length === CONFIG_PIN_LEN) {
    setTimeout(async () => {
      const inputHash = await sha256(pinBuffer);
      if (inputHash === CONFIG_PIN_HASH) {
        document.getElementById('pin-overlay').classList.remove('open');
        openConfig();
      } else {
        document.querySelectorAll('.pin-dot').forEach(d => { d.classList.remove('filled'); d.classList.add('error'); });
        setTimeout(() => { pinBuffer = ''; updatePinDots(); document.querySelectorAll('.pin-dot').forEach(d => d.classList.remove('error')); }, 700);
      }
    }, 100);
  }
}

function pinDel() { if (pinBuffer.length > 0) { pinBuffer = pinBuffer.slice(0,-1); updatePinDots(); } }
function pinCancel() { pinBuffer = ''; updatePinDots(); document.getElementById('pin-overlay').classList.remove('open'); }
function updatePinDots() {
  for (let i = 0; i < CONFIG_PIN_LEN; i++) {
    const d = document.getElementById('pd' + i);
    if (d) { d.classList.toggle('filled', i < pinBuffer.length); d.classList.remove('error'); }
  }
}

async function changePIN() {
  const newPin = document.getElementById('cfg-new-pin').value.trim();
  if (!newPin || newPin.length < 3 || newPin.length > 6 || !/^\d+$/.test(newPin)) {
    showToast('PIN invalide (3 à 6 chiffres requis)');
    return;
  }
  CONFIG_PIN_HASH = await sha256(newPin);
  CONFIG_PIN_LEN  = newPin.length;
  document.getElementById('cfg-new-pin').value = '';
  saveAll();
  showToast('✓ PIN mis à jour');
}

// ════════════════════════════════
//  CONFIG — BUILD
// ════════════════════════════════
let cfgBars = [], cfgProds = [];

function openConfig() {
  cfgBars  = BARS.map(b => ({...b}));
  cfgProds = ALL_PRODUCTS.map(p => ({...p, bars:[...p.bars], types:[...(p.types||['reassort','casse','staff','offert'])]}));
  document.getElementById('cfg-event').value = document.getElementById('event-name').textContent;
  renderCfgDays();
  renderCfgBars();
  renderCfgProds();
  renderCfgUsers();
  document.getElementById('cfg-overlay').classList.add('open');
}

function renderCfgBars() {
  const el = document.getElementById('cfg-bar-list');
  el.innerHTML = '';
  cfgBars.forEach((bar, idx) => {
    const row = document.createElement('div');
    row.className = 'cfg-bar-item';
    row.innerHTML = `
      <div class="cfg-bar-dot" style="background:${bar.color}"></div>
      <input class="cfg-inp-barname" data-idx="${idx}" value="${bar.name}" placeholder="Nom du bar">
      <button class="cfg-del-btn" onclick="deleteBar('${bar.id}')" title="Supprimer ce bar">✕</button>`;
    row.querySelector('input').addEventListener('input', e => { cfgBars[idx].name = e.target.value; refreshProdBarLabels(); });
    el.appendChild(row);
  });
}

function refreshProdBarLabels() {
  cfgBars.forEach(b => {
    document.querySelectorAll('.cfg-bar-chk-lbl-'+b.id).forEach(el => { el.textContent = b.name; });
  });
}

const EMOJI_LIST = ['🍺','🍾','💧','🥤','🍷','🥂','🥃','🍹','🧃','☕','🍵','🫖','🧋','🥛','🍦','🍔','🌮','🍕','🥗','🍱','🧁','🍰','🎂','🍫','🍬','🍭','🫗','🫙','📦','🛒','🧊','❄️','🔥','⭐','💡','📋'];

function renderCfgProds() {
  const el = document.getElementById('cfg-prod-list');
  el.innerHTML = '';
  cfgProds.forEach((p, pidx) => {
    const block = document.createElement('div');
    block.className = 'cfg-prod-block';

    const hdr = document.createElement('div');
    hdr.className = 'cfg-prod-hdr';
    hdr.innerHTML = `
      <div class="emoji-picker-wrap">
        <button class="emoji-trigger" id="etrig-${p.id}" onclick="toggleEmojiPicker('${p.id}')">${p.icon}</button>
        <div class="emoji-grid" id="egrid-${p.id}">${EMOJI_LIST.map(e=>`<button class="emoji-opt" onclick="selectEmoji('${p.id}','${e}')">${e}</button>`).join('')}</div>
      </div>
      <span class="cfg-prod-hdr-title" id="hdr-title-${p.id}" style="flex:1;font-size:12px;color:var(--c-muted);font-family:var(--font-mono);margin-left:8px;">${p.name}</span>
      <button class="cfg-del-btn" onclick="deleteProduct('${p.id}')" title="Supprimer">✕</button>`;
    block.appendChild(hdr);

    const nameRow = document.createElement('div');
    nameRow.className = 'cfg-prod-namerow';
    nameRow.innerHTML = `
      <input class="cfg-inp-name" data-pid="${p.id}" data-field="name" value="${p.name}" placeholder="Nom">
      <div class="cfg-inp-pack-wrap">
        <span class="cfg-inp-pack-lbl">u./cdt</span>
        <input class="cfg-inp-pack" data-pid="${p.id}" data-field="pack" type="number" min="1" value="${p.pack}">
      </div>`;
    nameRow.querySelectorAll('input').forEach(inp => {
      inp.addEventListener('input', e => {
        const idx2 = cfgProds.findIndex(x => x.id === e.target.dataset.pid);
        if (idx2 === -1) return;
        if (e.target.dataset.field === 'name') { cfgProds[idx2].name = e.target.value; const t = block.querySelector('.cfg-prod-hdr-title'); if(t) t.textContent = e.target.value; }
        else cfgProds[idx2].pack = Math.max(1, parseInt(e.target.value)||1);
      });
    });
    block.appendChild(nameRow);

    // Seuil alerte
    const alertRow = document.createElement('div');
    alertRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px;';
    alertRow.innerHTML = `<span style="font-size:11px;color:var(--c-muted);font-family:var(--font-mono);flex:1;">Alerte stock bas si &lt;</span>
      <input type="number" min="0" value="${p.alertSeuil !== undefined ? p.alertSeuil : 2}" style="width:60px;background:var(--c-surface2);border:1px solid var(--c-border2);border-radius:8px;padding:6px;font-size:13px;color:var(--c-red);font-family:var(--font-mono);text-align:center;" data-pid="${p.id}" class="cfg-alert-inp">
      <span style="font-size:11px;color:var(--c-muted);font-family:var(--font-mono);">cdt</span>`;
    alertRow.querySelector('input').addEventListener('input', e => {
      const idx2 = cfgProds.findIndex(x => x.id === e.target.dataset.pid);
      if (idx2 !== -1) cfgProds[idx2].alertSeuil = parseInt(e.target.value) || 0;
    });
    block.appendChild(alertRow);

    // Contenance / Portion (réconciliation caisse)
    const convRow = document.createElement('div');
    convRow.className = 'cfg-conv-row';
    convRow.innerHTML = `
      <span class="cfg-conv-lbl">📊 Réconciliation</span>
      <label class="cfg-conv-field">
        <span>Contenance (cL/unité)</span>
        <input type="number" min="0" step="0.5" class="cfg-conv-inp" data-pid="${p.id}" data-field="unitCl"
          value="${p.unitCl !== undefined ? p.unitCl : ''}" placeholder="ex: 33">
      </label>
      <label class="cfg-conv-field">
        <span>Portion (cL/verre)</span>
        <input type="number" min="0" step="0.5" class="cfg-conv-inp" data-pid="${p.id}" data-field="portionCl"
          value="${p.portionCl !== undefined ? p.portionCl : ''}" placeholder="ex: 25">
      </label>`;
    convRow.querySelectorAll('input').forEach(inp => {
      inp.addEventListener('input', e => {
        const idx2 = cfgProds.findIndex(x => x.id === e.target.dataset.pid);
        if (idx2 === -1) return;
        const v = parseFloat(e.target.value);
        cfgProds[idx2][e.target.dataset.field] = isNaN(v) ? undefined : v;
      });
    });
    block.appendChild(convRow);

    const typesWrap = document.createElement('div');
    typesWrap.className = 'cfg-types-wrap';
    typesWrap.innerHTML = '<div class="cfg-types-lbl">Types de sortie disponibles :</div>';
    const typesRow = document.createElement('div');
    typesRow.className = 'cfg-types-checks';
    const allT = ['reassort','casse','staff','offert'];
    const typeLabels = {reassort:'SORTIE BAR',casse:'CASSE',staff:'STAFF',offert:'OFFERT'};
    const enabledTypes = p.types || allT;
    allT.forEach(t => {
      const on  = enabledTypes.includes(t);
      const lbl = document.createElement('label');
      lbl.className = `cfg-type-check t-${t}${on?' active-'+t:''}`;
      lbl.innerHTML = `<input type="checkbox" data-pid="${p.id}" data-type="${t}" ${on?'checked':''}>${typeLabels[t]}`;
      lbl.querySelector('input').addEventListener('change', e => {
        const pidx2 = cfgProds.findIndex(x => x.id === e.target.dataset.pid);
        const tt = e.target.dataset.type;
        if (pidx2 === -1) return;
        if (!cfgProds[pidx2].types) cfgProds[pidx2].types = [...allT];
        if (e.target.checked) { if (!cfgProds[pidx2].types.includes(tt)) cfgProds[pidx2].types.push(tt); }
        else cfgProds[pidx2].types = cfgProds[pidx2].types.filter(x => x !== tt);
        lbl.className = `cfg-type-check t-${tt}${e.target.checked?' active-'+tt:''}`;
      });
      typesRow.appendChild(lbl);
    });
    typesWrap.appendChild(typesRow);
    block.appendChild(typesWrap);

    const hint = document.createElement('div');
    hint.className = 'cfg-stocks-hint';
    hint.style.marginTop = '10px';
    hint.textContent = 'Stock de départ par bar (en conditionnements) :';
    block.appendChild(hint);

    const stockGrid = document.createElement('div');
    stockGrid.className = 'cfg-stock-grid';
    stockGrid.id = 'sgrid-' + p.id;
    block.appendChild(stockGrid);

    const assignWrap = document.createElement('div');
    assignWrap.className = 'cfg-bars-assign';
    assignWrap.innerHTML = '<div class="cfg-bars-assign-lbl">Bars concernés :</div>';
    const checksRow = document.createElement('div');
    checksRow.className = 'cfg-bars-checks';
    checksRow.id = 'bchecks-' + p.id;
    assignWrap.appendChild(checksRow);
    block.appendChild(assignWrap);

    el.appendChild(block);
    renderProdBarWidgets(p.id);
  });
}

function toggleEmojiPicker(pid) {
  document.querySelectorAll('.emoji-grid').forEach(g => { if (g.id !== 'egrid-'+pid) g.classList.remove('open'); });
  document.getElementById('egrid-'+pid).classList.toggle('open');
}

function selectEmoji(pid, emoji) {
  const idx = cfgProds.findIndex(x => x.id === pid);
  if (idx === -1) return;
  cfgProds[idx].icon = emoji;
  document.getElementById('etrig-'+pid).textContent = emoji;
  document.getElementById('egrid-'+pid).classList.remove('open');
}

function renderProdBarWidgets(pid) {
  const p = cfgProds.find(x => x.id === pid);
  if (!p) return;
  const checksRow = document.getElementById('bchecks-'+pid);
  if (checksRow) {
    checksRow.innerHTML = '';
    cfgBars.forEach(bar => {
      const checked = p.bars.includes(bar.id);
      const lbl = document.createElement('label');
      lbl.className = 'cfg-bar-check';
      lbl.style.borderColor = checked ? bar.color : '';
      lbl.innerHTML = `<input type="checkbox" data-pid="${pid}" data-bid="${bar.id}" ${checked?'checked':''}><span class="cfg-bar-chk-lbl-${bar.id}" style="color:${bar.color}">${bar.name}</span>`;
      lbl.querySelector('input').addEventListener('change', e => {
        const pidx = cfgProds.findIndex(x => x.id === e.target.dataset.pid);
        const bid  = e.target.dataset.bid;
        if (e.target.checked) { if (!cfgProds[pidx].bars.includes(bid)) cfgProds[pidx].bars.push(bid); }
        else cfgProds[pidx].bars = cfgProds[pidx].bars.filter(x => x !== bid);
        lbl.style.borderColor = e.target.checked ? bar.color : '';
        renderStockGrid(pid);
      });
      checksRow.appendChild(lbl);
    });
  }
  renderStockGrid(pid);
}

function renderStockGrid(pid) {
  const p    = cfgProds.find(x => x.id === pid);
  const grid = document.getElementById('sgrid-'+pid);
  if (!p || !grid) return;
  grid.innerHTML = '';
  const assignedBars = cfgBars.filter(b => p.bars.includes(b.id));
  if (!assignedBars.length) { grid.innerHTML = '<span style="font-size:11px;color:var(--c-muted);font-family:var(--font-mono);">Aucun bar sélectionné</span>'; return; }
  assignedBars.forEach(bar => {
    const val  = (STOCKS[bar.id] && STOCKS[bar.id][pid]) || 0;
    const cell = document.createElement('div');
    cell.className = 'cfg-stock-cell';
    cell.innerHTML = `<span class="cfg-stock-bar-lbl" style="color:${bar.color}">${bar.name}</span>
      <input class="cfg-inp-stock" data-bid="${bar.id}" data-pid="${pid}" type="number" min="0" value="${val}">`;
    cell.querySelector('input').addEventListener('input', e => {
      if (!STOCKS[e.target.dataset.bid]) STOCKS[e.target.dataset.bid] = {};
      STOCKS[e.target.dataset.bid][e.target.dataset.pid] = parseInt(e.target.value) || 0;
    });
    grid.appendChild(cell);
  });
}

// ════════════════════════════════
//  MODE INVENTAIRE
// ════════════════════════════════
function openInventaire() {
  const bar = BARS.find(b => b.id === currentBar);
  document.getElementById('inv-bar-name').textContent = bar ? bar.name : '';
  document.getElementById('inv-meta').textContent = currentDay.toUpperCase() + ' · ' + new Date().toLocaleTimeString('fr-FR', {hour:'2-digit',minute:'2-digit'});
  buildInventaire();
  document.getElementById('inv-overlay').classList.add('open');
}

function closeInventaire() {
  document.getElementById('inv-overlay').classList.remove('open');
}

function buildInventaire() {
  const el = document.getElementById('inv-content');
  el.innerHTML = '';
  const products = getBarProducts(currentBar);
  if (!products.length) { el.innerHTML = '<div style="padding:24px;color:var(--c-muted);text-align:center;">Aucun produit sur ce bar</div>'; return; }

  // Afficher dernier inventaire si existant
  const lastInv = [...inventaires].reverse().find(i => i.barId === currentBar && i.day === currentDay);
  if (lastInv) {
    const meta = document.createElement('div');
    meta.className = 'inv-last';
    meta.textContent = 'Dernier inventaire : ' + new Date(lastInv.timestamp).toLocaleTimeString('fr-FR', {hour:'2-digit',minute:'2-digit'}) + ' par ' + lastInv.userDisplay;
    el.appendChild(meta);
  }

  products.forEach(p => {
    const calc = calcStock(currentBar, p.id);
    const displayCalc = Number.isInteger(calc) ? calc : calc.toFixed(1);
    const row = document.createElement('div');
    row.className = 'inv-row';
    row.dataset.pid = p.id;
    const prevPhysical = lastInv ? (lastInv.items.find(i => i.productId === p.id)?.physical ?? '') : '';
    row.innerHTML = `
      <div class="inv-prod-name">${p.icon} ${p.name}</div>
      <div class="inv-counts">
        <div class="inv-calc">
          <span class="inv-lbl">Calculé</span>
          <span class="inv-val">${displayCalc}</span>
        </div>
        <div class="inv-physical">
          <span class="inv-lbl">Physique</span>
          <input class="inv-input" type="number" min="0" step="1" placeholder="—" value="${prevPhysical}" data-pid="${p.id}" data-calc="${calc}">
        </div>
        <div class="inv-delta-wrap">
          <span class="inv-lbl">Écart</span>
          <span class="inv-delta" id="invd-${p.id}">—</span>
        </div>
      </div>`;
    row.querySelector('input').addEventListener('input', e => {
      const physical = parseFloat(e.target.value);
      const deltaEl = document.getElementById('invd-' + p.id);
      if (isNaN(physical)) { deltaEl.textContent = '—'; deltaEl.className = 'inv-delta'; return; }
      const delta = physical - parseFloat(e.target.dataset.calc);
      const d = Math.round(delta * 10) / 10;
      deltaEl.textContent = (d > 0 ? '+' : '') + d;
      deltaEl.className = 'inv-delta ' + (d === 0 ? 'ok' : d > 0 ? 'surplus' : 'deficit');
    });
    el.appendChild(row);
    // Déclencher le calcul si valeur précédente
    if (prevPhysical !== '') row.querySelector('input').dispatchEvent(new Event('input'));
  });
}

function saveInventaire() {
  const products = getBarProducts(currentBar);
  const items = [];
  let hasAny = false;
  products.forEach(p => {
    const inp = document.querySelector(`.inv-input[data-pid="${p.id}"]`);
    if (!inp || inp.value === '') return;
    const physical = parseFloat(inp.value);
    if (isNaN(physical)) return;
    const calc = calcStock(currentBar, p.id);
    items.push({productId: p.id, productName: p.name, calculated: Math.round(calc*10)/10, physical, delta: Math.round((physical-calc)*10)/10});
    hasAny = true;
  });
  if (!hasAny) { showToast('Aucune valeur saisie'); return; }
  const bar = BARS.find(b => b.id === currentBar);
  inventaires.push({
    id: Date.now(),
    timestamp: new Date().toISOString(),
    day: currentDay,
    barId: currentBar,
    barName: bar ? bar.name : '',
    userId:      CURRENT_USER ? CURRENT_USER.id : '',
    userDisplay: CURRENT_USER ? (CURRENT_USER.displayName||CURRENT_USER.id) : '',
    items,
  });
  saveAll();
  showToast('✓ Inventaire enregistré');
  closeInventaire();
}

// ════════════════════════════════
//  CONFIG — ADD / DELETE
// ════════════════════════════════
function addBar() {
  const usedColors = cfgBars.map(b => b.color);
  const color = BAR_COLORS.find(c => !usedColors.includes(c)) || BAR_COLORS[cfgBars.length % BAR_COLORS.length];
  cfgBars.push({id: uid(), name:'Nouveau bar', color});
  renderCfgBars();
  cfgProds.forEach(p => renderProdBarWidgets(p.id));
}

function deleteBar(barId) {
  if (cfgBars.length <= 1) { showToast('Minimum 1 bar requis'); return; }
  if (!confirm('Supprimer ce bar ?')) return;
  cfgBars = cfgBars.filter(b => b.id !== barId);
  cfgProds.forEach(p => { p.bars = p.bars.filter(id => id !== barId); });
  renderCfgBars();
  cfgProds.forEach(p => renderProdBarWidgets(p.id));
}

function addProduct() {
  const icon = PRODUCT_ICONS[cfgProds.length % PRODUCT_ICONS.length];
  cfgProds.push({id: uid(), name:'Nouveau produit', icon, pack:1, bars:[], types:['reassort','casse','staff','offert'], alertSeuil:2});
  renderCfgProds();
  setTimeout(() => { document.getElementById('cfg-overlay').scrollTop = 99999; }, 50);
}

function deleteProduct(pid) {
  if (!confirm('Supprimer ce produit ?')) return;
  cfgProds = cfgProds.filter(p => p.id !== pid);
  renderCfgProds();
}

// ════════════════════════════════
//  CONFIG — SAVE
// ════════════════════════════════
function saveConfig() {
  const evName = document.getElementById('cfg-event').value.trim();
  if (evName) document.getElementById('event-name').textContent = evName;
  BARS = cfgBars.map(b => ({...b}));
  ALL_PRODUCTS = cfgProds.map(p => ({...p, bars:[...p.bars], types:[...(p.types||['reassort','casse','staff','offert'])]}));
  BARS.forEach(b => { if (!STOCKS[b.id]) STOCKS[b.id] = {}; });
  if (!BARS.find(b => b.id === currentBar)) currentBar = BARS[0]?.id;
  saveAll();
  document.getElementById('cfg-overlay').classList.remove('open');
  buildDaySelector(); buildBarSelector(); buildProducts();
  showToast('✓ Configuration enregistrée');
}

function closeConfig() { document.getElementById('cfg-overlay').classList.remove('open'); }

// ════════════════════════════════
//  IMPORT STOCKS CSV
// ════════════════════════════════
function openCsvImport() {
  document.getElementById('csv-import-text').value = '';
  document.getElementById('csv-import-preview').textContent = '';
  document.getElementById('csv-import-overlay').classList.add('open');
}

function closeCsvImport(e) {
  if (!e || e.target === document.getElementById('csv-import-overlay')) {
    document.getElementById('csv-import-overlay').classList.remove('open');
  }
}

function confirmCsvImport() {
  const text   = document.getElementById('csv-import-text').value.trim();
  const lines  = text.split('\n').map(l => l.trim()).filter(Boolean);
  let count    = 0;
  const errors = [];

  lines.forEach((line, i) => {
    const parts = line.split(',').map(s => s.trim());
    if (parts.length < 3) { errors.push(`Ligne ${i+1} invalide`); return; }
    const [barId, prodId, qtyStr] = parts;
    const qty = parseInt(qtyStr);
    if (isNaN(qty) || qty < 0) { errors.push(`Ligne ${i+1} : quantité invalide`); return; }
    if (!STOCKS[barId]) STOCKS[barId] = {};
    STOCKS[barId][prodId] = qty;
    count++;
  });

  if (errors.length) { showToast('⚠ ' + errors[0]); return; }
  saveAll();
  closeCsvImport();
  buildProducts();
  showToast(`✓ ${count} stocks importés`);
}

// ════════════════════════════════
//  EXPORT CSV
// ════════════════════════════════
function exportCSV() {
  if (!log.length) { showToast('Aucune donnée à exporter'); return; }
  const evName  = document.getElementById('event-name').textContent;
  const date    = new Date().toISOString().slice(0,10);
  const dayStr  = days.length > 1 ? ` ${currentDay.toUpperCase()}` : '';
  const activeLog = log.filter(e => !e.day || e.day === currentDay);

  let csv = '\uFEFF';
  csv += `--- COMPARATIF STOCK vs VENTES${dayStr} (à rapprocher du rapport Kappture Qty) ---\n`;
  csv += 'Événement,Jour,Bar,Produit,Stock départ (cdt),Stock départ (unités),Sortie bar (cdt),Sortie bar (unités),Casse (unités),Staff (unités),Offert (unités),Retour camion (unités),Entamé perdu (unités),Total sorti (unités)\n';

  BARS.forEach(bar => {
    const barLog = activeLog.filter(e => e.barId === bar.id);
    if (!barLog.length) return;
    const prodIds = [...new Set(barLog.map(e => e.productId))];
    prodIds.forEach(pid => {
      const pLog  = barLog.filter(e => e.productId === pid);
      const pName = pLog[0].productName;
      const pack  = pLog[0].pack;
      const stockCdt   = (STOCKS[bar.id] && STOCKS[bar.id][pid]) || 0;
      const stockUnits = stockCdt * pack;
      const reassortCdt = pLog.filter(e=>e.type==='reassort').reduce((s,e)=>s+e.qty,0);
      const reassortU   = pLog.filter(e=>e.type==='reassort').reduce((s,e)=>s+e.units,0);
      const casseU      = pLog.filter(e=>e.type==='casse').reduce((s,e)=>s+e.units,0);
      const staffU      = pLog.filter(e=>e.type==='staff').reduce((s,e)=>s+e.units,0);
      const offertU     = pLog.filter(e=>e.type==='offert').reduce((s,e)=>s+e.units,0);
      const retourU     = pLog.filter(e=>e.type==='retour').reduce((s,e)=>s+e.units,0);
      const entameU     = pLog.filter(e=>e.type==='entame').reduce((s,e)=>s+e.units,0);
      const totalU      = reassortU + casseU + staffU + offertU + retourU + entameU;
      csv += `"${evName}","${currentDay.toUpperCase()}","${bar.name}","${pName}",${stockCdt},${stockUnits},${reassortCdt},${reassortU},${casseU},${staffU},${offertU},${retourU},${entameU},${totalU}\n`;
    });
  });

  csv += '\n--- JOURNAL DÉTAILLÉ (chronologique) ---\n';
  csv += 'Événement,Jour,Heure,Utilisateur,Rôle,Bar,Produit,Unités/cdt,Quantité (cdt),Unités,Type\n';
  [...activeLog].reverse().forEach(e => {
    csv += `"${evName}","${(e.day||'j1').toUpperCase()}",${e.time},"${e.userDisplay||''}","${e.userRole||''}","${e.barName}","${e.productName}",${e.pack},${e.qty},${e.units},${e.type}\n`;
  });

  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = 'gartenstock_' + evName.replace(/[^a-zA-Z0-9]/g,'_') + '_' + currentDay + '_' + date + '.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Export CSV téléchargé');
}

// ════════════════════════════════
//  HISTORIQUE INTER-EVENTS
// ════════════════════════════════
const ALL_EVENTS = [
  {id:'gartenstock_prix_de_diane',    name:'Prix de Diane'},
  {id:'gartenstock_carl_cox',         name:'Carl Cox'},
  {id:'gartenstock_ludovico_einaudi', name:'Ludovico Einaudi'},
  {id:'gartenstock_gotb',             name:'GOTB'},
  {id:'gartenstock_fontainebleau',    name:'Fontainebleau'},
];

const CURRENT_PAGE_ID = location.pathname.split('/').pop().replace('.html','') || 'index';

async function loadHistory() {
  const el = document.getElementById('history-content');
  el.innerHTML = '<div style="color:var(--c-muted);font-family:var(--font-mono);font-size:12px;padding:20px 0;">Chargement...</div>';

  const otherEvents = ALL_EVENTS.filter(e => e.id !== CURRENT_PAGE_ID);
  el.innerHTML = '';

  for (const ev of otherEvents) {
    const card = document.createElement('div');
    card.className = 'history-event-card';
    card.innerHTML = `<div class="history-event-name">${ev.name}</div><div class="history-event-meta">Chargement…</div>`;
    el.appendChild(card);

    const data = window._fbLoadEvent ? await window._fbLoadEvent(ev.id) : null;
    const meta = data ? `${(data.log||[]).length} saisies · màj ${data.updatedAt ? new Date(data.updatedAt).toLocaleDateString('fr-FR') : '?'}` : 'Aucune donnée';
    card.querySelector('.history-event-meta').textContent = meta;

    if (data && (data.log||[]).length) {
      card.onclick = () => showHistoryDetail(ev.name, data);
    } else {
      card.style.opacity = '.5';
      card.style.cursor = 'default';
    }
  }
}

function showHistoryDetail(evName, data) {
  const el = document.getElementById('history-content');
  el.innerHTML = `<span class="history-back" onclick="loadHistory()">← Retour aux événements</span>
    <div style="font-size:15px;font-weight:700;padding:0 0 12px;">${evName}</div>`;

  const bars   = data.BARS || [];
  const activeLog = data.log || [];

  bars.forEach(bar => {
    const bLog = activeLog.filter(e => e.barId === bar.id);
    if (!bLog.length) return;
    const tr  = bLog.filter(e=>e.type==='reassort').reduce((s,e)=>s+e.units,0);
    const tc  = bLog.filter(e=>e.type==='casse').reduce((s,e)=>s+e.units,0);
    const ts  = bLog.filter(e=>e.type==='staff').reduce((s,e)=>s+e.units,0);
    const to  = bLog.filter(e=>e.type==='offert').reduce((s,e)=>s+e.units,0);
    const trt = bLog.filter(e=>e.type==='retour').reduce((s,e)=>s+e.units,0);
    const ten = bLog.filter(e=>e.type==='entame').reduce((s,e)=>s+e.units,0);
    const sec = document.createElement('div');
    sec.className = 'recap-bar-section';
    sec.innerHTML = `<div class="recap-bar-title" style="color:${bar.color||'var(--c-accent)'}">${bar.name}</div>
      <div class="kpi-row">
        <div class="kpi"><div class="kpi-label">Sortie bar</div><div class="kpi-val yellow">${tr}</div></div>
        <div class="kpi"><div class="kpi-label">Pertes</div><div class="kpi-val red">${tc+ts+to+ten}</div></div>
        <div class="kpi"><div class="kpi-label">Retours</div><div class="kpi-val teal">${trt}</div></div>
        <div class="kpi"><div class="kpi-label">Entamés</div><div class="kpi-val orange">${ten}</div></div>
      </div>`;
    el.appendChild(sec);
  });
}

// ════════════════════════════════
//  FIN D'ÉVÉNEMENT (wizard 2 étapes)
// ════════════════════════════════

// Données temporaires du wizard
let _finData = {}; // { productId: { retour: qty, entame: qty, entameUnits: qty } }
let _finCurrentStep = 1;

function openFinEvent() {
  if (eventClosed) { showToast('Événement déjà clôturé'); return; }
  _finData = {};
  _finCurrentStep = 1;

  // Nom du bar
  const bar = BARS.find(b => b.id === currentBar);
  document.getElementById('fin-bar-name').textContent = bar ? bar.name : '';

  // Étape 1 : construire la liste des produits pour retours & entamés
  _buildFinStep1();

  document.getElementById('fin-step1').style.display = '';
  document.getElementById('fin-step2').style.display = 'none';
  document.getElementById('fin-step-badge').textContent = '1 / 2';
  document.getElementById('fin-back-btn').textContent = '← Annuler';

  document.getElementById('fin-overlay').classList.add('open');
}

function _buildFinStep1() {
  const list = document.getElementById('fin-products-list');
  list.innerHTML = '';

  const barProds = ALL_PRODUCTS.filter(p => p.bars.includes(currentBar));

  barProds.forEach(p => {
    const remaining = calcStock(currentBar, p.id);
    if (remaining <= 0) return; // rien à retourner ni à déclarer
    const displayQty = Number.isInteger(remaining) ? remaining : remaining.toFixed(1);
    const unitStr = p.pack > 1 ? `pack ×${p.pack}` : (p.liters ? `${p.liters}L` : 'unité');

    const row = document.createElement('div');
    row.className = 'fin-prod-row';
    row.innerHTML = `
      <div class="fin-prod-head">
        <span class="fin-prod-icon">${p.icon}</span>
        <span class="fin-prod-name">${p.name}</span>
        <span class="fin-prod-stock">Stock restant : <strong>${displayQty}</strong> ${unitStr}</span>
      </div>
      <div class="fin-prod-inputs">
        <label class="fin-prod-label">
          <span>↩ Retour camion (packs entiers)</span>
          <input type="number" min="0" step="1" value="0" class="fin-input" id="fin-retour-${p.id}" placeholder="0">
        </label>
        ${p.pack > 1 ? `
        <label class="fin-prod-label">
          <span>⚠ Entamé perdu (unités)</span>
          <input type="number" min="0" step="1" value="0" class="fin-input" id="fin-entame-${p.id}" placeholder="0">
        </label>` : `
        <label class="fin-prod-label">
          <span>⚠ Entamé perdu (unités)</span>
          <input type="number" min="0" step="1" value="0" class="fin-input" id="fin-entame-${p.id}" placeholder="0">
        </label>`}
      </div>`;
    list.appendChild(row);
  });

  if (list.children.length === 0) {
    list.innerHTML = '<div class="fin-empty">Aucun stock restant à déclarer.</div>';
  }
}

function finBack() {
  if (_finCurrentStep === 1) {
    // Fermer le wizard
    document.getElementById('fin-overlay').classList.remove('open');
  } else {
    // Retour à l'étape 1
    _finCurrentStep = 1;
    document.getElementById('fin-step1').style.display = '';
    document.getElementById('fin-step2').style.display = 'none';
    document.getElementById('fin-step-badge').textContent = '1 / 2';
    document.getElementById('fin-back-btn').textContent = '← Annuler';
  }
}

function confirmFinStep1() {
  // Lire les valeurs des inputs et les stocker dans _finData
  const barProds = ALL_PRODUCTS.filter(p => p.bars.includes(currentBar));
  const now = Date.now();

  barProds.forEach(p => {
    const retourEl = document.getElementById(`fin-retour-${p.id}`);
    const entameEl = document.getElementById(`fin-entame-${p.id}`);
    if (!retourEl && !entameEl) return;

    const retourQty = parseInt(retourEl?.value || '0', 10) || 0;
    const entameQty = parseInt(entameEl?.value || '0', 10) || 0;

    if (retourQty > 0) {
      log.unshift({
        id: `fin-retour-${p.id}-${now}`,
        barId: currentBar,
        productId: p.id,
        type: 'retour',
        qty: retourQty,
        unitMode: false,
        pack: p.pack || 1,
        ts: now,
        userId: CURRENT_USER?.id || '',
        userName: CURRENT_USER?.name || '',
        day: currentDay,
        finEvent: true,
      });
    }
    if (entameQty > 0) {
      log.unshift({
        id: `fin-entame-${p.id}-${now+1}`,
        barId: currentBar,
        productId: p.id,
        type: 'entame',
        qty: p.pack > 1 ? entameQty : entameQty,
        unitMode: p.pack > 1,
        pack: p.pack || 1,
        ts: now + 1,
        userId: CURRENT_USER?.id || '',
        userName: CURRENT_USER?.name || '',
        day: currentDay,
        finEvent: true,
      });
    }
  });

  saveAll();

  // Passer à l'étape 2 : inventaire physique
  _buildFinStep2();
  _finCurrentStep = 2;
  document.getElementById('fin-step1').style.display = 'none';
  document.getElementById('fin-step2').style.display = '';
  document.getElementById('fin-step-badge').textContent = '2 / 2';
  document.getElementById('fin-back-btn').textContent = '← Retour';
}

function _buildFinStep2() {
  const list = document.getElementById('fin-inv-list');
  list.innerHTML = '';

  const barProds = ALL_PRODUCTS.filter(p => p.bars.includes(currentBar));

  barProds.forEach(p => {
    const remaining = calcStock(currentBar, p.id);
    const displayQty = Number.isInteger(remaining) ? remaining : remaining.toFixed(1);
    const unitStr = p.pack > 1 ? `pack ×${p.pack}` : (p.liters ? `${p.liters}L` : 'unité');

    const row = document.createElement('div');
    row.className = 'fin-inv-row';
    row.innerHTML = `
      <div class="fin-prod-head">
        <span class="fin-prod-icon">${p.icon}</span>
        <span class="fin-prod-name">${p.name}</span>
        <span class="fin-prod-stock">Théorique : <strong>${displayQty}</strong> ${unitStr}</span>
      </div>
      <label class="fin-prod-label">
        <span>Inventaire physique (${unitStr})</span>
        <input type="number" min="0" step="${p.pack > 1 ? '1' : '0.5'}" value="${remaining >= 0 ? (Number.isInteger(remaining) ? remaining : remaining.toFixed(1)) : 0}" class="fin-input" id="fin-inv-${p.id}">
      </label>`;
    list.appendChild(row);
  });
}

async function confirmFinStep2() {
  // Sauvegarder l'inventaire physique
  const barProds = ALL_PRODUCTS.filter(p => p.bars.includes(currentBar));
  const snap = {
    id: `fin-inv-${currentBar}-${Date.now()}`,
    barId: currentBar,
    ts: Date.now(),
    userId: CURRENT_USER?.id || '',
    userName: CURRENT_USER?.name || '',
    day: currentDay,
    finEvent: true,
    counts: {}
  };

  barProds.forEach(p => {
    const el = document.getElementById(`fin-inv-${p.id}`);
    if (el) snap.counts[p.id] = parseFloat(el.value) || 0;
  });

  inventaires.push(snap);
  saveAll();

  // Clore l'événement pour ce bar (côté UI)
  document.getElementById('fin-overlay').classList.remove('open');
  showToast('✅ Clôture enregistrée — Session terminée');

  // Déconnexion automatique après 1,5 secondes
  setTimeout(() => {
    clearSession();
    CURRENT_USER = null;
    document.getElementById('app').style.display = 'none';
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('login-pw').value = '';
    document.getElementById('login-id').value = '';
  }, 1500);
}

// ════════════════════════════════
//  NAV
// ════════════════════════════════
function goScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('screen-'+name).classList.add('active');
  document.getElementById('nav-'+name).classList.add('active');
  if (name === 'log')     buildLog();
  if (name === 'recap')   buildRecap();
  if (name === 'history') loadHistory();
}

// ════════════════════════════════
//  INIT
// ════════════════════════════════
document.getElementById('app').style.display = 'none';

async function init() {
  initTheme();
  await initPinHash();
  buildDaySelector();
  buildBarSelector();
  buildProducts();
  updateClock();
  setInterval(updateClock, 15000);
  initSwipe();
  initActivityTracking();
  await initAuth();
  document.addEventListener('click', e => {
    if (!e.target.closest('.emoji-picker-wrap')) {
      document.querySelectorAll('.emoji-grid').forEach(g => g.classList.remove('open'));
    }
  });
}

init();
