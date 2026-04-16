// ════════════════════════════════
//  AUTH SYSTEM
// ════════════════════════════════
let CURRENT_USER = null; // {id, role, barIds, displayName}
let ALL_USERS = [];      // loaded from Firebase

async function initAuth() {
  // Load users from Firebase
  if (window._fbLoadUsers) {
    ALL_USERS = await window._fbLoadUsers();
  }
  // If no users exist yet, auto-create default directeur account
  if (ALL_USERS.length === 0) {
    ALL_USERS = [{id:'directeur', pw:'garten2025', role:'directeur', barIds:[], displayName:'Directeur'}];
    if (window._fbSaveUsers) await window._fbSaveUsers(ALL_USERS);
  }
  // Show login screen
  document.getElementById('login-screen').classList.add('active');
  document.getElementById('app').style.display = 'none';
  // Allow pressing Enter on login
  document.getElementById('login-pw').addEventListener('keydown', e => { if(e.key==='Enter') doLogin(); });
  document.getElementById('login-id').addEventListener('keydown', e => { if(e.key==='Enter') document.getElementById('login-pw').focus(); });
}

function doLogin() {
  const id = document.getElementById('login-id').value.trim().toLowerCase();
  const pw = document.getElementById('login-pw').value;
  const errEl = document.getElementById('login-error');
  const user = ALL_USERS.find(u => u.id.toLowerCase()===id && u.pw===pw);
  if (!user) { errEl.textContent = 'Identifiant ou mot de passe incorrect'; return; }
  // Check page access
  const page = location.pathname.split('/').pop().replace('.html','') || 'index';
  if (user.role !== 'directeur' && user.pages && !user.pages.includes(page)) {
    errEl.textContent = "Vous n'avez pas accès à cet événement";
    return;
  }
  CURRENT_USER = user;
  errEl.textContent = '';
  document.getElementById('login-screen').classList.remove('active');
  document.getElementById('app').style.display = 'flex';
  // Update user badge
  const badge = document.getElementById('user-badge');
  if (badge) {
    const roleLabels = {directeur:'Directeur', chef_bar:'Chef de bar', magasinier:'Magasinier'};
    badge.textContent = (user.displayName || user.id) + ' · ' + (roleLabels[user.role]||user.role);
  }
  // Apply role restrictions
  applyRoleRestrictions();
  // Load data
  loadAll();
}

function doLogout() {
  if (!confirm('Se déconnecter ?')) return;
  CURRENT_USER = null;
  document.getElementById('login-id').value = '';
  document.getElementById('login-pw').value = '';
  document.getElementById('login-error').textContent = '';
  document.getElementById('login-screen').classList.add('active');
  document.getElementById('app').style.display = 'none';
}

function applyRoleRestrictions() {
  if (!CURRENT_USER) return;
  const role = CURRENT_USER.role;
  // Show/hide config button
  const cfgBtn = document.querySelector('.section-action[onclick="requestConfig()"]');
  if (cfgBtn) cfgBtn.style.display = role === 'directeur' ? '' : 'none';
  // Show/hide recap tab
  const recapBtn = document.getElementById('nav-recap');
  if (recapBtn) recapBtn.style.display = (role === 'directeur' || role === 'chef_bar') ? '' : 'none';
  // Show/hide log tab
  const logBtn = document.getElementById('nav-log');
  if (logBtn) logBtn.style.display = (role === 'directeur' || role === 'chef_bar') ? '' : 'none';
  // If not directeur, restrict to assigned bar(s)
  if (role !== 'directeur' && CURRENT_USER.barIds && CURRENT_USER.barIds.length > 0) {
    const assignedBarId = CURRENT_USER.barIds[0];
    if (BARS.find(b => b.id === assignedBarId)) {
      currentBar = assignedBarId;
    }
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
  // Render bar chips
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
      if (chip.classList.contains('selected')) { chip.style.background = b.color; chip.style.color = '#000'; }
      else { chip.style.background = ''; chip.style.color = 'var(--c-muted)'; }
    };
    wrap.appendChild(chip);
  });
  // Also add page access chips
  addPageAccessField();
}

function addPageAccessField() {
  // Remove existing page field if any
  const existing = document.getElementById('um-page-field');
  if (existing) existing.remove();
  const pages = [
    {id:'gartenstock_prix_de_diane',    name:'Prix de Diane'},
    {id:'gartenstock_carl_cox',         name:'Carl Cox'},
    {id:'gartenstock_ludovico_einaudi', name:'Ludovico Einaudi'},
    {id:'gartenstock_gotb',             name:'GOTB'},
    {id:'gartenstock_fontainebleau',    name:'Fontainebleau'},
  ];
  const role = document.getElementById('um-role').value;
  if (role === 'directeur') return;
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
    chip.style.borderColor = 'var(--c-border2)';
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
  const id = document.getElementById('um-id').value.trim().toLowerCase();
  const pw = document.getElementById('um-pw').value.trim();
  const role = document.getElementById('um-role').value;
  if (!id || !pw) { showToast('Identifiant et mot de passe requis'); return; }
  if (ALL_USERS.find(u => u.id === id)) { showToast('Identifiant déjà utilisé'); return; }
  const barIds = [...document.querySelectorAll('#um-bars-wrap .um-bar-chip.selected')].map(c => c.dataset.bid);
  const pages = [...document.querySelectorAll('#um-pages-wrap .um-bar-chip.selected')].map(c => c.dataset.pid);
  const newUser = { id, pw, role, barIds, pages, displayName: id };
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
const BAR_COLORS = ['#e8c547','#52c47a','#5b9be8','#9b7fe8','#e87a3a','#e05252','#5bc4c4','#c47a52'];
const PRODUCT_ICONS = ['🍺','🍾','💧','🥤','🍷','🥂','🥃','🍹','🧃','☕'];

let BARS = [
  {id:'b1', name:'Bar 1', color:'#e8c547'},
  {id:'b2', name:'Bar 2', color:'#52c47a'},
  {id:'b3', name:'Bar 3', color:'#5b9be8'},
  {id:'b4', name:'Bar 4', color:'#9b7fe8'},
  {id:'b5', name:'VIP',   color:'#e87a3a'},
];

// Each product has a `bars` array and a `types` array (which sortie types are enabled)
let ALL_PRODUCTS = [
  {id:'fut_blonde', name:'Fût Blonde 30L',       icon:'🍺', pack:1,  liters:30, bars:['b1','b2','b3','b4','b5'], types:['reassort','casse','staff','offert']},
  {id:'fut_brune',  name:'Fût Brune 30L',        icon:'🍺', pack:1,  liters:30, bars:['b1','b2','b3','b4'],     types:['reassort','casse','staff','offert']},
  {id:'biere_btle', name:'Bière bouteille 33cl',  icon:'🍾', pack:24, bars:['b1','b2','b3','b4'],               types:['reassort','casse','staff','offert']},
  {id:'eau_50',     name:'Eau 50cl',              icon:'💧', pack:24, bars:['b1','b2','b3','b4','b5'],          types:['reassort','casse','staff']},
  {id:'soda_33',    name:'Soda 33cl',             icon:'🥤', pack:24, bars:['b1','b2','b3','b4','b5'],          types:['reassort','casse','staff']},
  {id:'vin_bib',    name:'Vin rouge BIB 10L',     icon:'🍷', pack:1,  liters:10, bars:['b1','b2','b3','b4','b5'], types:['reassort','casse','staff','offert']},
  {id:'champ_6',    name:'Champagne 75cl',        icon:'🥂', pack:6,  bars:['b5'],                             types:['reassort','casse','offert']},
  {id:'spirit',     name:'Spiritueux 70cl',       icon:'🥃', pack:1,  bars:['b5'],                             types:['reassort','casse','staff','offert']},
];

let STOCKS = {
  b1:{fut_blonde:4,fut_brune:2,biere_btle:10,eau_50:8,soda_33:6,vin_bib:3},
  b2:{fut_blonde:4,fut_brune:2,biere_btle:10,eau_50:8,soda_33:6,vin_bib:3},
  b3:{fut_blonde:3,fut_brune:2,biere_btle:8,eau_50:6,soda_33:5,vin_bib:2},
  b4:{fut_blonde:3,fut_brune:2,biere_btle:8,eau_50:6,soda_33:5,vin_bib:2},
  b5:{fut_blonde:2,vin_bib:3,champ_6:6,spirit:12,eau_50:4,soda_33:4},
};

const CONFIG_PIN = '666';
let currentBar = BARS[0].id;
let mQty = 1, mType = 'reassort', mProduct = null;
let log = [];
let idCounter = 100; // for new bar/product ids

// ════════════════════════════════
//  FIREBASE PERSISTENCE (multi-appareils)
// ════════════════════════════════

// Applique les données reçues de Firebase à l'état local
window._fbApply = function(data) {
  let changed = false;
  if (data.log)      { log = data.log;               changed = true; }
  if (data.STOCKS)   { STOCKS = data.STOCKS;          changed = true; }
  if (data.BARS)     { BARS = data.BARS;              changed = true; }
  if (data.PRODUCTS) { ALL_PRODUCTS = data.PRODUCTS;  changed = true; }
  if (data.eventName) {
    const el = document.getElementById('event-name');
    if (el) el.textContent = data.eventName;
  }
  if (changed && document.readyState !== 'loading') {
    buildBarSelector();
    buildProducts();
    if (document.getElementById('screen-log').classList.contains('active')) buildLog();
    if (document.getElementById('screen-recap').classList.contains('active')) buildRecap();
  }
};

function saveAll() {
  const data = {
    log,
    STOCKS,
    BARS,
    PRODUCTS: ALL_PRODUCTS,
    eventName: document.getElementById('event-name').textContent,
    updatedAt: new Date().toISOString()
  };
  if (window._fbSave) window._fbSave(data);
}

function loadAll() {
  if (window._fbLoad) window._fbLoad();
}

function resetAllData() {
  if (!confirm('⚠️ Remettre à zéro toutes les données de cet événement ?\nCette action est irréversible.')) return;
  log = [];
  saveAll();
  buildBarSelector();
  buildProducts();
  buildLog();
  showToast('Données réinitialisées');
}

function uid() { return 'x' + (++idCounter); }

function getBarProducts(barId) {
  return ALL_PRODUCTS.filter(p => (p.bars||[]).includes(barId));
}

function now() {
  const d = new Date();
  return d.getHours().toString().padStart(2,'0')+':'+d.getMinutes().toString().padStart(2,'0');
}
function updateClock() { document.getElementById('clock').textContent = now(); }

// ════════════════════════════════
//  BAR SELECTOR
// ════════════════════════════════
function buildBarSelector() {
  const el = document.getElementById('bar-selector');
  el.innerHTML = '';
  if (!BARS.find(b => b.id === currentBar)) currentBar = BARS[0]?.id;
  // Filter bars based on role
  let visibleBars = BARS;
  if (CURRENT_USER && CURRENT_USER.role !== 'directeur' && CURRENT_USER.barIds && CURRENT_USER.barIds.length > 0) {
    visibleBars = BARS.filter(b => CURRENT_USER.barIds.includes(b.id));
    if (!visibleBars.find(b => b.id === currentBar)) currentBar = visibleBars[0]?.id;
  }
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
//  PRODUCTS SCREEN
// ════════════════════════════════
function buildProducts() {
  const products = getBarProducts(currentBar);
  const bar = BARS.find(b => b.id === currentBar);
  document.getElementById('bar-product-count').textContent = products.length + ' produits · ' + (bar ? bar.name : '');
  const el = document.getElementById('product-list');
  el.innerHTML = '';

  if (products.length === 0) {
    el.innerHTML = '<div class="no-products">Aucun produit assigné à ce bar.<br>Configurez-les via ⚙ Configurer.</div>';
    return;
  }

  products.forEach(p => {
    const barLog = log.filter(e => e.barId === currentBar && e.productId === p.id);
    const totalOut = barLog.reduce((s,e) => s + e.qty, 0);
    const stock = (STOCKS[currentBar] && STOCKS[currentBar][p.id]) || 0;
    const remaining = Math.max(0, stock - totalOut);
    const pct = stock > 0 ? totalOut / stock : 0;
    let sc = '#52c47a';
    if (pct >= 1) sc = '#e05252';
    else if (pct > .6) sc = '#e87a3a';
    const unitStr = p.pack > 1 ? 'pack ×'+p.pack : (p.liters ? p.liters+'L / unité' : 'unité');
    const ps = JSON.stringify(p).replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    const ptypes = p.types || ['reassort','casse','staff','offert'];
    const TYPE_LABELS = {reassort:'REASSORT', casse:'CASSE', staff:'STAFF', offert:'OFFERT'};
    const actionBtns = ptypes.map(t =>
      `<button class="pact-btn ${t}" onclick='openModal(${ps},"${t}")'>${TYPE_LABELS[t]||t.toUpperCase()}</button>`
    ).join('');
    const actionGrid = `grid-template-columns:repeat(${ptypes.length},1fr)`;
    const div = document.createElement('div');
    div.className = 'pcard';
    div.innerHTML = `
      <div class="pcard-head">
        <div class="pcard-icon">${p.icon}</div>
        <div class="pcard-name"><strong>${p.name}</strong><span>${unitStr} · stock : ${stock}</span></div>
        <div class="pcard-stock"><strong style="color:${sc}">${remaining}</strong>restants</div>
      </div>
      <div class="pcard-actions" style="${actionGrid}">${actionBtns}</div>`;
    el.appendChild(div);
  });
}

// ════════════════════════════════
//  SAISIE MODAL
// ════════════════════════════════
const ALL_TYPES = {
  reassort: {label:'Reassort', sub:'réappro camion'},
  casse:    {label:'Casse',    sub:'bris / détérioration'},
  staff:    {label:'Staff',   sub:'consommé équipe'},
  offert:   {label:'Offert',  sub:'gratuit / artiste'},
};

function openModal(p, type) {
  mProduct = p; mQty = 1; mType = type;
  document.getElementById('m-name').textContent = p.name;
  document.getElementById('m-sub').textContent = (BARS.find(b=>b.id===currentBar)||{name:''}).name + ' · ' + (p.pack > 1 ? 'pack ×'+p.pack : (p.liters ? p.liters+'L' : 'unité'));
  updateModalQty();
  buildTypeGrid(p.types || ['reassort','casse','staff','offert']);
  updateTypeUI();
  document.getElementById('overlay').classList.add('open');
}

function buildTypeGrid(types) {
  const grid = document.getElementById('m-type-grid');
  grid.innerHTML = '';
  types.forEach(t => {
    const info = ALL_TYPES[t] || {label:t, sub:''};
    const div = document.createElement('div');
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
  if (mProduct.pack > 1) hint += ' pack'+(mQty>1?'s':'')+' = '+(mQty*mProduct.pack)+' unités';
  else if (mProduct.liters) hint += ' × '+mProduct.liters+'L = '+(mQty*mProduct.liters)+'L';
  else hint += ' unité'+(mQty>1?'s':'');
  document.getElementById('m-hint').textContent = hint;
}
function adjQty(d) { mQty = Math.max(1, mQty+d); updateModalQty(); }
function setType(t) { mType = t; updateTypeUI(); }
function updateTypeUI() {
  const types = mProduct ? (mProduct.types || ['reassort','casse','staff','offert']) : [];
  types.forEach(t => {
    const el = document.getElementById('to-'+t);
    if (el) el.className = 'type-opt'+(t===mType?' sel-'+t:'');
  });
}
function confirmEntry() {
  if (!mProduct) return;
  const bar = BARS.find(b=>b.id===currentBar);
  log.unshift({id:Date.now(),time:now(),barId:currentBar,barName:bar.name,
    productId:mProduct.id,productName:mProduct.name,pack:mProduct.pack,
    qty:mQty,units:mQty*mProduct.pack,type:mType,
    userId: CURRENT_USER ? CURRENT_USER.id : 'inconnu',
    userDisplay: CURRENT_USER ? (CURRENT_USER.displayName||CURRENT_USER.id) : 'inconnu',
    userRole: CURRENT_USER ? CURRENT_USER.role : ''});
  saveAll();
  closeOverlay(); buildProducts();
  showToast('✓ '+mProduct.name+' · '+mQty+(mProduct.pack>1?' pack'+(mQty>1?'s':''):' u.')+' · '+mType);
}
function overlayClick(e) { if(e.target===document.getElementById('overlay')) closeOverlay(); }
function closeOverlay() { document.getElementById('overlay').classList.remove('open'); }

// ════════════════════════════════
//  LOG
// ════════════════════════════════
function buildLog() {
  const el = document.getElementById('log-list');
  if (!log.length) { el.innerHTML='<div class="log-empty">Aucune sortie enregistrée</div>'; return; }
  el.innerHTML='';
  log.forEach(e => {
    const div = document.createElement('div');
    div.className='log-entry';
    div.innerHTML=`<span class="log-time">${e.time}</span>
      <span class="log-bar">${e.barName}</span>
      <span class="log-product">${e.productName}</span>
      <span class="log-qty">${e.qty}${e.pack>1?' pkt':' u.'}</span>
      <span class="log-type-pill pill-${e.type}">${e.type.toUpperCase()}</span>
      ${e.userDisplay ? `<span style="font-size:10px;color:var(--c-muted);font-family:var(--font-mono);flex-shrink:0;">${e.userDisplay}</span>` : ''}`;
    el.appendChild(div);
  });
}
function clearLog() {
  if (!log.length) return;
  if (!confirm('Effacer tout l\'historique ?')) return;
  log=[]; saveAll(); buildLog(); buildProducts(); showToast('Historique effacé');
}

// ════════════════════════════════
//  RECAP
// ════════════════════════════════
function buildRecap() {
  const el = document.getElementById('recap-content');
  el.innerHTML='';
  let hasData=false;
  BARS.forEach(bar => {
    const bLog=log.filter(e=>e.barId===bar.id);
    if (!bLog.length) return;
    hasData=true;
    const tr=bLog.filter(e=>e.type==='reassort').reduce((s,e)=>s+e.units,0);
    const tc=bLog.filter(e=>e.type==='casse').reduce((s,e)=>s+e.units,0);
    const ts=bLog.filter(e=>e.type==='staff').reduce((s,e)=>s+e.units,0);
    const to=bLog.filter(e=>e.type==='offert').reduce((s,e)=>s+e.units,0);
    const byP={};
    bLog.forEach(e=>{
      if(!byP[e.productId]) byP[e.productId]={name:e.productName,pack:e.pack,reassort:0,casse:0,staff:0,offert:0};
      if(byP[e.productId][e.type]!==undefined) byP[e.productId][e.type]+=e.qty;
      else byP[e.productId][e.type]=e.qty;
    });
    const depackItems=[];
    Object.values(byP).forEach(p=>{
      if(p.pack<=1) return;
      const tot=(p.reassort||0)+(p.casse||0)+(p.staff||0)+(p.offert||0);
      const frac=tot-Math.floor(tot);
      const left=frac>0?Math.round(p.pack-frac*p.pack):0;
      if(left>0) depackItems.push({name:p.name,left});
    });
    const rows=Object.values(byP).map(p=>
      `<tr><td>${p.name}</td><td style="color:var(--c-accent)">${p.reassort||'—'}</td><td style="color:var(--c-red)">${p.casse||'—'}</td><td style="color:var(--c-green)">${p.staff||'—'}</td><td style="color:var(--c-purple)">${p.offert||'—'}</td></tr>`
    ).join('');
    const depackHTML=depackItems.length?`<div class="depack-block"><div class="depack-block-title">⚠ Stock dépaqueté non retournable</div>${depackItems.map(d=>`<div class="depack-row2"><span>${d.name}</span><span>${d.left} unités restantes</span></div>`).join('')}</div>`:'';
    const sec=document.createElement('div');
    sec.className='recap-bar-section';
    sec.innerHTML=`<div class="recap-bar-title" style="color:${bar.color}">${bar.name}</div>
      <div class="kpi-row">
        <div class="kpi"><div class="kpi-label">Reassort</div><div class="kpi-val yellow">${tr}</div></div>
        <div class="kpi"><div class="kpi-label">Pertes totales</div><div class="kpi-val red">${tc+ts+to}</div></div>
        <div class="kpi"><div class="kpi-label">Staff</div><div class="kpi-val green">${ts}</div></div>
        <div class="kpi"><div class="kpi-label">Offerts</div><div class="kpi-val purple">${to}</div></div>
      </div>${depackHTML}
      <table class="rtable"><thead><tr><th>Produit</th><th>Reassort</th><th>Casse</th><th>Staff</th><th>Offert</th></tr></thead><tbody>${rows}</tbody></table>`;
    el.appendChild(sec);
  });
  if(!hasData) el.innerHTML='<div class="recap-empty">Aucune donnée enregistrée</div>';
}

// ════════════════════════════════
//  PIN
// ════════════════════════════════
let pinBuffer='';
function requestConfig() { pinBuffer=''; updatePinDots(); document.getElementById('pin-overlay').classList.add('open'); }
function pinKey(k) {
  if(pinBuffer.length>=CONFIG_PIN.length) return;
  pinBuffer+=k; updatePinDots();
  if(pinBuffer.length===CONFIG_PIN.length) {
    setTimeout(()=>{
      if(pinBuffer===CONFIG_PIN) { document.getElementById('pin-overlay').classList.remove('open'); openConfig(); }
      else {
        document.querySelectorAll('.pin-dot').forEach(d=>{d.classList.remove('filled');d.classList.add('error');});
        setTimeout(()=>{ pinBuffer=''; updatePinDots(); document.querySelectorAll('.pin-dot').forEach(d=>d.classList.remove('error')); },700);
      }
    },100);
  }
}
function pinDel() { if(pinBuffer.length>0){pinBuffer=pinBuffer.slice(0,-1);updatePinDots();} }
function pinCancel() { pinBuffer=''; updatePinDots(); document.getElementById('pin-overlay').classList.remove('open'); }
function updatePinDots() {
  for(let i=0;i<3;i++){
    const d=document.getElementById('pd'+i);
    d.classList.toggle('filled',i<pinBuffer.length);
    d.classList.remove('error');
  }
}

// ════════════════════════════════
//  CONFIG — BUILD
// ════════════════════════════════
// Temporary config state while panel is open
let cfgBars=[], cfgProds=[];

function openConfig() {
  // Deep-clone current state
  cfgBars = BARS.map(b=>({...b}));
  cfgProds = ALL_PRODUCTS.map(p=>({...p, bars:[...p.bars], types:[...(p.types||['reassort','casse','staff','offert'])]}));

  document.getElementById('cfg-event').value = document.getElementById('event-name').textContent;
  renderCfgBars();
  renderCfgProds();
  renderCfgUsers();
  document.getElementById('cfg-overlay').classList.add('open');
}

function renderCfgBars() {
  const el = document.getElementById('cfg-bar-list');
  el.innerHTML='';
  cfgBars.forEach((bar,idx) => {
    const row = document.createElement('div');
    row.className='cfg-bar-item';
    row.innerHTML=`
      <div class="cfg-bar-dot" style="background:${bar.color}"></div>
      <input class="cfg-inp-barname" data-idx="${idx}" value="${bar.name}" placeholder="Nom du bar">
      <button class="cfg-del-btn" onclick="deleteBar('${bar.id}')" title="Supprimer ce bar">✕</button>`;
    row.querySelector('input').addEventListener('input', e => { cfgBars[idx].name = e.target.value; refreshProdBarLabels(); });
    el.appendChild(row);
  });
}

function refreshProdBarLabels() {
  // re-render prod bar checkboxes labels without full re-render
  cfgBars.forEach(b => {
    document.querySelectorAll('.cfg-bar-chk-lbl-'+b.id).forEach(el => { el.textContent = b.name; });
  });
}

const EMOJI_LIST = ['🍺','🍾','💧','🥤','🍷','🥂','🥃','🍹','🧃','☕','🍵','🫖','🧋','🥛','🍦','🍔','🌮','🍕','🥗','🍱','🧁','🍰','🎂','🍫','🍬','🍭','🫗','🫙','📦','🛒','🧊','❄️','🔥','⭐','💡','📋'];

function renderCfgProds() {
  const el = document.getElementById('cfg-prod-list');
  el.innerHTML='';
  cfgProds.forEach((p, pidx) => {
    const block = document.createElement('div');
    block.className='cfg-prod-block';

    // header with emoji picker + name + pack + delete
    const hdr = document.createElement('div');
    hdr.className='cfg-prod-hdr';
    hdr.innerHTML=`
      <div class="emoji-picker-wrap">
        <button class="emoji-trigger" id="etrig-${p.id}" onclick="toggleEmojiPicker('${p.id}')">${p.icon}</button>
        <div class="emoji-grid" id="egrid-${p.id}">
          ${EMOJI_LIST.map(e=>`<button class="emoji-opt" onclick="selectEmoji('${p.id}','${e}')">${e}</button>`).join('')}
        </div>
      </div>
      <span class="cfg-prod-hdr-title" id="hdr-title-${p.id}" style="flex:1;font-size:12px;color:var(--c-muted);font-family:var(--font-mono);margin-left:8px;">${p.name}</span>
      <button class="cfg-del-btn" onclick="deleteProduct('${p.id}')" title="Supprimer ce produit">✕</button>`;
    block.appendChild(hdr);

    // name + pack row
    const nameRow = document.createElement('div');
    nameRow.className='cfg-prod-namerow';
    nameRow.innerHTML=`
      <input class="cfg-inp-name" data-pid="${p.id}" data-field="name" value="${p.name}" placeholder="Nom">
      <div class="cfg-inp-pack-wrap">
        <span class="cfg-inp-pack-lbl">u./cdt</span>
        <input class="cfg-inp-pack" data-pid="${p.id}" data-field="pack" type="number" min="1" value="${p.pack}">
      </div>`;
    nameRow.querySelectorAll('input').forEach(inp => {
      inp.addEventListener('input', e => {
        const idx2 = cfgProds.findIndex(x=>x.id===e.target.dataset.pid);
        if(idx2===-1) return;
        if(e.target.dataset.field==='name') {
          cfgProds[idx2].name=e.target.value;
          const titleEl = block.querySelector('.cfg-prod-hdr-title');
          if(titleEl) titleEl.textContent=e.target.value;
        } else {
          cfgProds[idx2].pack=Math.max(1,parseInt(e.target.value)||1);
        }
      });
    });
    block.appendChild(nameRow);

    // types config
    const typesWrap = document.createElement('div');
    typesWrap.className='cfg-types-wrap';
    typesWrap.innerHTML='<div class="cfg-types-lbl">Types de sortie disponibles :</div>';
    const typesRow = document.createElement('div');
    typesRow.className='cfg-types-checks';
    const allT = ['reassort','casse','staff','offert'];
    const typeLabels = {reassort:'REASSORT',casse:'CASSE',staff:'STAFF',offert:'OFFERT'};
    const enabledTypes = p.types || allT;
    allT.forEach(t => {
      const on = enabledTypes.includes(t);
      const lbl = document.createElement('label');
      lbl.className=`cfg-type-check t-${t}${on?' active-'+t:''}`;
      lbl.innerHTML=`<input type="checkbox" data-pid="${p.id}" data-type="${t}" ${on?'checked':''}>${typeLabels[t]}`;
      lbl.querySelector('input').addEventListener('change', e => {
        const pidx2 = cfgProds.findIndex(x=>x.id===e.target.dataset.pid);
        const tt = e.target.dataset.type;
        if(pidx2===-1) return;
        if(!cfgProds[pidx2].types) cfgProds[pidx2].types=[...allT];
        if(e.target.checked) { if(!cfgProds[pidx2].types.includes(tt)) cfgProds[pidx2].types.push(tt); }
        else cfgProds[pidx2].types=cfgProds[pidx2].types.filter(x=>x!==tt);
        lbl.className=`cfg-type-check t-${tt}${e.target.checked?' active-'+tt:''}`;
      });
      typesRow.appendChild(lbl);
    });
    typesWrap.appendChild(typesRow);
    block.appendChild(typesWrap);

    // stocks per bar
    const hint = document.createElement('div');
    hint.className='cfg-stocks-hint';
    hint.style.marginTop='10px';
    hint.textContent='Stock de départ par bar (en conditionnements) :';
    block.appendChild(hint);

    const stockGrid = document.createElement('div');
    stockGrid.className='cfg-stock-grid';
    stockGrid.id='sgrid-'+p.id;
    block.appendChild(stockGrid);

    // bar assignment checkboxes
    const assignWrap = document.createElement('div');
    assignWrap.className='cfg-bars-assign';
    assignWrap.innerHTML='<div class="cfg-bars-assign-lbl">Bars concernés :</div>';
    const checksRow = document.createElement('div');
    checksRow.className='cfg-bars-checks';
    checksRow.id='bchecks-'+p.id;
    assignWrap.appendChild(checksRow);
    block.appendChild(assignWrap);

    el.appendChild(block);
    renderProdBarWidgets(p.id);
  });
}

function toggleEmojiPicker(pid) {
  // close all others first
  document.querySelectorAll('.emoji-grid').forEach(g => { if(g.id!=='egrid-'+pid) g.classList.remove('open'); });
  document.getElementById('egrid-'+pid).classList.toggle('open');
}

function selectEmoji(pid, emoji) {
  const idx = cfgProds.findIndex(x=>x.id===pid);
  if(idx===-1) return;
  cfgProds[idx].icon = emoji;
  document.getElementById('etrig-'+pid).textContent = emoji;
  document.getElementById('egrid-'+pid).classList.remove('open');
}

function renderProdBarWidgets(pid) {
  const p = cfgProds.find(x=>x.id===pid);
  if(!p) return;

  // checkboxes
  const checksRow = document.getElementById('bchecks-'+pid);
  if(checksRow) {
    checksRow.innerHTML='';
    cfgBars.forEach(bar => {
      const checked = p.bars.includes(bar.id);
      const lbl = document.createElement('label');
      lbl.className='cfg-bar-check';
      lbl.style.borderColor = checked ? bar.color : '';
      lbl.innerHTML=`<input type="checkbox" data-pid="${pid}" data-bid="${bar.id}" ${checked?'checked':''}><span class="cfg-bar-chk-lbl-${bar.id}" style="color:${bar.color}">${bar.name}</span>`;
      lbl.querySelector('input').addEventListener('change', e => {
        const pidx = cfgProds.findIndex(x=>x.id===e.target.dataset.pid);
        const bid = e.target.dataset.bid;
        if(e.target.checked) { if(!cfgProds[pidx].bars.includes(bid)) cfgProds[pidx].bars.push(bid); }
        else cfgProds[pidx].bars = cfgProds[pidx].bars.filter(x=>x!==bid);
        lbl.style.borderColor = e.target.checked ? bar.color : '';
        renderStockGrid(pid);
      });
      checksRow.appendChild(lbl);
    });
  }

  renderStockGrid(pid);
}

function renderStockGrid(pid) {
  const p = cfgProds.find(x=>x.id===pid);
  const grid = document.getElementById('sgrid-'+pid);
  if(!p||!grid) return;
  grid.innerHTML='';
  const assignedBars = cfgBars.filter(b=>p.bars.includes(b.id));
  if(!assignedBars.length) { grid.innerHTML='<span style="font-size:11px;color:var(--c-muted);font-family:var(--font-mono);">Aucun bar sélectionné</span>'; return; }
  assignedBars.forEach(bar => {
    const val = (STOCKS[bar.id]&&STOCKS[bar.id][pid])||0;
    const cell = document.createElement('div');
    cell.className='cfg-stock-cell';
    cell.innerHTML=`<span class="cfg-stock-bar-lbl" style="color:${bar.color}">${bar.name}</span>
      <input class="cfg-inp-stock" data-bid="${bar.id}" data-pid="${pid}" type="number" min="0" value="${val}">`;
    cell.querySelector('input').addEventListener('input', e=>{
      if(!STOCKS[e.target.dataset.bid]) STOCKS[e.target.dataset.bid]={};
      STOCKS[e.target.dataset.bid][e.target.dataset.pid]=parseInt(e.target.value)||0;
    });
    grid.appendChild(cell);
  });
}

// ════════════════════════════════
//  CONFIG — ADD / DELETE
// ════════════════════════════════
function addBar() {
  const usedColors = cfgBars.map(b=>b.color);
  const color = BAR_COLORS.find(c=>!usedColors.includes(c)) || BAR_COLORS[cfgBars.length % BAR_COLORS.length];
  const newBar = {id: uid(), name:'Nouveau bar', color};
  cfgBars.push(newBar);
  renderCfgBars();
  // Re-render prod bar widgets so new bar appears in checkboxes
  cfgProds.forEach(p => renderProdBarWidgets(p.id));
}

function deleteBar(barId) {
  if(cfgBars.length<=1){ showToast('Minimum 1 bar requis'); return; }
  if(!confirm('Supprimer ce bar ? Les données de saisie liées seront conservées dans le log.')) return;
  cfgBars = cfgBars.filter(b=>b.id!==barId);
  cfgProds.forEach(p=>{ p.bars=p.bars.filter(id=>id!==barId); });
  renderCfgBars();
  cfgProds.forEach(p=>renderProdBarWidgets(p.id));
}

function addProduct() {
  const icon = PRODUCT_ICONS[cfgProds.length % PRODUCT_ICONS.length];
  const newProd = {id: uid(), name:'Nouveau produit', icon, pack:1, bars:[], types:['reassort','casse','staff','offert']};
  cfgProds.push(newProd);
  renderCfgProds();
  setTimeout(()=>{ document.getElementById('cfg-overlay').scrollTop=99999; },50);
}

function deleteProduct(pid) {
  if(!confirm('Supprimer ce produit ?')) return;
  cfgProds = cfgProds.filter(p=>p.id!==pid);
  renderCfgProds();
}

// ════════════════════════════════
//  CONFIG — SAVE
// ════════════════════════════════
function saveConfig() {
  // event name
  const evName = document.getElementById('cfg-event').value.trim();
  if(evName) document.getElementById('event-name').textContent=evName;

  // commit bars
  BARS = cfgBars.map(b=>({...b}));

  // commit products (name, pack, icon, bars, types all already updated live in cfgProds)
  ALL_PRODUCTS = cfgProds.map(p=>({...p, bars:[...p.bars], types:[...(p.types||['reassort','casse','staff','offert'])]}));

  // make sure stocks object has entries for all bars
  BARS.forEach(b=>{ if(!STOCKS[b.id]) STOCKS[b.id]={}; });

  // fix currentBar if deleted
  if(!BARS.find(b=>b.id===currentBar)) currentBar=BARS[0]?.id;

  saveAll();
  document.getElementById('cfg-overlay').classList.remove('open');
  buildBarSelector();
  buildProducts();
  showToast('✓ Configuration enregistrée');
}

function closeConfig() { document.getElementById('cfg-overlay').classList.remove('open'); }

// ════════════════════════════════
//  EXPORT
// ════════════════════════════════
function exportCSV() {
  if(!log.length){ showToast('Aucune donnée à exporter'); return; }
  const evName = document.getElementById('event-name').textContent;
  const date = new Date().toISOString().slice(0,10);

  // ── FEUILLE 1 : Récap pivot par Bar + Produit (comparatif Kappture) ──
  // Colonnes : Événement | Bar | Produit | Stock départ | Reassort (cdt) | Reassort (unités) | Casse (unités) | Staff (unités) | Offert (unités) | Total sorti (unités)
  let csv = '\uFEFF';
  csv += '--- COMPARATIF STOCK vs VENTES (à rapprocher du rapport Kappture Qty) ---\n';
  csv += 'Événement,Bar,Produit,Stock départ (cdt),Stock départ (unités),Reassort (cdt),Reassort (unités),Casse (unités),Staff (unités),Offert (unités),Total sorti (unités)\n';

  BARS.forEach(bar => {
    const barLog = log.filter(e => e.barId === bar.id);
    if (!barLog.length) return;
    // collect all products touched for this bar
    const prodIds = [...new Set(barLog.map(e => e.productId))];
    prodIds.forEach(pid => {
      const pLog = barLog.filter(e => e.productId === pid);
      const pName = pLog[0].productName;
      const pack = pLog[0].pack;
      const stockDepartCdt = (STOCKS[bar.id] && STOCKS[bar.id][pid]) || 0;
      const stockDepartUnits = stockDepartCdt * pack;
      const reassortCdt = pLog.filter(e=>e.type==='reassort').reduce((s,e)=>s+e.qty,0);
      const reassortU   = pLog.filter(e=>e.type==='reassort').reduce((s,e)=>s+e.units,0);
      const casseU      = pLog.filter(e=>e.type==='casse').reduce((s,e)=>s+e.units,0);
      const staffU      = pLog.filter(e=>e.type==='staff').reduce((s,e)=>s+e.units,0);
      const offertU     = pLog.filter(e=>e.type==='offert').reduce((s,e)=>s+e.units,0);
      const totalU      = reassortU + casseU + staffU + offertU;
      csv += `"${evName}","${bar.name}","${pName}",${stockDepartCdt},${stockDepartUnits},${reassortCdt},${reassortU},${casseU},${staffU},${offertU},${totalU}\n`;
    });
  });

  // ── FEUILLE 2 : Journal chronologique détaillé ──
  csv += '\n--- JOURNAL DÉTAILLÉ (chronologique) ---\n';
  csv += 'Événement,Heure,Utilisateur,Rôle,Bar,Produit,Unités/cdt,Quantité (cdt),Unités,Type\n';
  [...log].reverse().forEach(e=>{
    csv += `"${evName}",${e.time},"${e.userDisplay||''}","${e.userRole||''}","${e.barName}","${e.productName}",${e.pack},${e.qty},${e.units},${e.type}\n`;
  });

  const blob = new Blob([csv],{type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'gartenstock_' + evName.replace(/[^a-zA-Z0-9]/g,'_') + '_' + date + '.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Export CSV téléchargé');
}

// ════════════════════════════════
//  NAV + TOAST
// ════════════════════════════════
function goScreen(name) {
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('screen-'+name).classList.add('active');
  document.getElementById('nav-'+name).classList.add('active');
  if(name==='log') buildLog();
  if(name==='recap') buildRecap();
}
function showToast(msg) {
  const t=document.getElementById('toast');
  t.textContent=msg; t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),2400);
}

// ════════════════════════════════
//  INIT
// ════════════════════════════════
document.getElementById('app').style.display = 'none';
buildBarSelector();
buildProducts();
updateClock();
setInterval(updateClock,15000);
initAuth();

// Close emoji pickers on outside click
document.addEventListener('click', e => {
  if (!e.target.closest('.emoji-picker-wrap')) {
    document.querySelectorAll('.emoji-grid').forEach(g => g.classList.remove('open'));
  }
});
</script>
</body>
