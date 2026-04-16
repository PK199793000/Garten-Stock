const fs = require('fs');
const path = require('path');

const events = JSON.parse(fs.readFileSync('events.json', 'utf8'));
const template = fs.readFileSync(path.join('src', 'template.html'), 'utf8');

fs.mkdirSync('dist', { recursive: true });

['app.css', 'firebase-init.js', 'app.js'].forEach(f => {
  fs.copyFileSync(path.join('src', f), path.join('dist', f));
});

events.forEach(({ id, title, eventName }) => {
  const html = template
    .replaceAll('{{TITLE}}', title)
    .replaceAll('{{EVENT_NAME}}', eventName);
  const out = path.join('dist', `${id}.html`);
  fs.writeFileSync(out, html, 'utf8');
  console.log(`✓ dist/${id}.html`);
});

console.log(`\nBuild OK — ${events.length} fichiers générés.`);
