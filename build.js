const fs = require('fs');
const path = require('path');

// ── Charger .env local si présent (dev) — en prod, Netlify injecte directement ──
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  });
}

// ── Firebase config depuis env vars uniquement ──
const REQUIRED = ['FB_API_KEY','FB_AUTH_DOMAIN','FB_PROJECT_ID','FB_STORAGE_BUCKET','FB_MESSAGING_SENDER_ID','FB_APP_ID'];
const missing = REQUIRED.filter(k => !process.env[k]);
if (missing.length) {
  console.error('❌ Variables manquantes :', missing.join(', '));
  console.error('   Créez un fichier .env ou définissez les variables dans Netlify.');
  process.exit(2);
}
const FB = Object.fromEntries(REQUIRED.map(k => [k, process.env[k]]));

const events  = JSON.parse(fs.readFileSync('events.json', 'utf8'));
const template = fs.readFileSync(path.join('src', 'template.html'), 'utf8');

// Injecter les env vars Firebase dans firebase-init.js
let firebaseInit = fs.readFileSync(path.join('src', 'firebase-init.js'), 'utf8');
Object.entries(FB).forEach(([key, val]) => {
  firebaseInit = firebaseInit.replaceAll(`{{${key}}}`, val);
});

fs.mkdirSync('dist', { recursive: true });

// Fichiers copiés dans dist/ (Netlify) ET à la racine (usage local)
['app.css', 'app.js', 'manifest.json', 'logo.png'].forEach(f => {
  fs.copyFileSync(path.join('src', f), path.join('dist', f));
  fs.copyFileSync(path.join('src', f), f);
});

// firebase-init.js avec les valeurs injectées
fs.writeFileSync(path.join('dist', 'firebase-init.js'), firebaseInit, 'utf8');
fs.writeFileSync('firebase-init.js', firebaseInit, 'utf8');

const buildVersion = Date.now();

// Générer un HTML par event (dist/ pour Netlify + racine pour usage local)
events.forEach(({ id, title, eventName }) => {
  const html = template
    .replaceAll('{{TITLE}}', title)
    .replaceAll('{{EVENT_NAME}}', eventName)
    .replaceAll('src="app.js"', `src="app.js?v=${buildVersion}"`)
    .replaceAll('href="app.css"', `href="app.css?v=${buildVersion}"`)
    .replaceAll('src="firebase-init.js"', `src="firebase-init.js?v=${buildVersion}"`);
  const distOut = path.join('dist', `${id}.html`);
  fs.writeFileSync(distOut, html, 'utf8');
  const rootOut = `${id}.html`;
  fs.writeFileSync(rootOut, html, 'utf8');
  console.log(`✓ dist/${id}.html + ${id}.html`);
});

console.log(`\nBuild OK — ${events.length} fichiers générés.`);
