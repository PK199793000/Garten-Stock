const fs = require('fs');
const path = require('path');

// ── Firebase config depuis env vars (Netlify) ou valeurs par défaut (dev local) ──
const FB = {
  FB_API_KEY:            process.env.FB_API_KEY            || 'AIzaSyBuZ5HMfnM06sVYIzbog4lOER8q4BoJ760',
  FB_AUTH_DOMAIN:        process.env.FB_AUTH_DOMAIN        || 'garten-stock.firebaseapp.com',
  FB_PROJECT_ID:         process.env.FB_PROJECT_ID         || 'garten-stock',
  FB_STORAGE_BUCKET:     process.env.FB_STORAGE_BUCKET     || 'garten-stock.firebasestorage.app',
  FB_MESSAGING_SENDER_ID:process.env.FB_MESSAGING_SENDER_ID|| '474916104313',
  FB_APP_ID:             process.env.FB_APP_ID             || '1:474916104313:web:bff56ddb8646c3f2940ca8',
};

const events  = JSON.parse(fs.readFileSync('events.json', 'utf8'));
const template = fs.readFileSync(path.join('src', 'template.html'), 'utf8');

// Injecter les env vars Firebase dans firebase-init.js
let firebaseInit = fs.readFileSync(path.join('src', 'firebase-init.js'), 'utf8');
Object.entries(FB).forEach(([key, val]) => {
  firebaseInit = firebaseInit.replaceAll(`{{${key}}}`, val);
});

fs.mkdirSync('dist', { recursive: true });

// Fichiers copiés tels quels
['app.css', 'app.js', 'manifest.json', 'logo.png'].forEach(f => {
  fs.copyFileSync(path.join('src', f), path.join('dist', f));
});

// firebase-init.js avec les valeurs injectées
fs.writeFileSync(path.join('dist', 'firebase-init.js'), firebaseInit, 'utf8');

// Générer un HTML par event
events.forEach(({ id, title, eventName }) => {
  const html = template
    .replaceAll('{{TITLE}}', title)
    .replaceAll('{{EVENT_NAME}}', eventName);
  const out = path.join('dist', `${id}.html`);
  fs.writeFileSync(out, html, 'utf8');
  console.log(`✓ dist/${id}.html`);
});

console.log(`\nBuild OK — ${events.length} fichiers générés.`);
