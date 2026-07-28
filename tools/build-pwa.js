// Arma la carpeta pwa/: la aplicación instalable que usa el Google Sheet como base de datos.
//
// Sale de la misma interfaz de public/ y de la misma lógica que corre adentro de Google
// (apps-script/Codigo.gs). Acá sólo se juntan las piezas y se agregan los archivos que
// únicamente hacen falta en la versión instalada.
//
// Uso: npm run build:pwa   ->   deja todo en docs/, que es lo que publica GitHub Pages
const fs = require('node:fs');
const path = require('node:path');

const raiz = path.join(__dirname, '..');
const publico = path.join(raiz, 'public');
// GitHub Pages sólo puede publicar la raíz del repositorio o la carpeta docs/
const destino = path.join(raiz, 'docs');

// Archivos de la interfaz que se copian tal cual
const COPIAR = ['styles.css', 'charts.js', 'app.js', 'manifest.webmanifest', 'sw.js', 'config.js', 'almacen-local.js', 'sheets-api.js'];

fs.rmSync(destino, { recursive: true, force: true });
fs.mkdirSync(path.join(destino, 'iconos'), { recursive: true });

for (const archivo of COPIAR) {
  fs.copyFileSync(path.join(publico, archivo), path.join(destino, archivo));
}
for (const icono of fs.readdirSync(path.join(publico, 'iconos'))) {
  fs.copyFileSync(path.join(publico, 'iconos', icono), path.join(destino, 'iconos', icono));
}

// La lógica es la misma que corre en el Sheet, sin tocar una línea
const logica = fs.readFileSync(path.join(raiz, 'apps-script', 'Codigo.gs'), 'utf8');
fs.writeFileSync(
  path.join(destino, 'logica.js'),
  `// GENERADO por "npm run build:pwa" desde apps-script/Codigo.gs — no editar acá.
//
// Es la misma lógica que corre adentro del Google Sheet. En el navegador trabaja contra
// la copia local de la planilla (almacen-local.js), y por eso responde al instante.
'use strict';

${logica}
`,
  'utf8'
);

// El index sólo cambia en los scripts que carga
const scripts = `<script src="https://accounts.google.com/gsi/client" async defer></script>
    <script src="config.js"></script>
    <script src="almacen-local.js"></script>
    <script src="sheets-api.js"></script>
    <script src="logica.js"></script>
    <script src="charts.js"></script>`;

let html = fs
  .readFileSync(path.join(publico, 'index.html'), 'utf8')
  .replace('<!-- PWA:SCRIPTS -->\n    <script src="charts.js"></script>', scripts);

if (!html.includes('almacen-local.js')) {
  throw new Error('No pude insertar los scripts de la PWA en index.html');
}

// Cada build marca sus archivos con una versión. Sin esto, el navegador (y GitHub Pages,
// que cachea) pueden seguir usando la copia vieja después de actualizar.
const version = Date.now().toString(36);
html = html.replace(/(src|href)="((?!http)[^"]+\.(?:js|css))"/g, `$1="$2?v=${version}"`);
fs.writeFileSync(path.join(destino, 'index.html'), html, 'utf8');

// El service worker también cambia de nombre de caché en cada build
const sw = fs
  .readFileSync(path.join(publico, 'sw.js'), 'utf8')
  .replace(/const VERSION = '[^']+'/, `const VERSION = 'gastos-${version}'`);
fs.writeFileSync(path.join(destino, 'sw.js'), sw, 'utf8');

// GitHub Pages no publica carpetas que empiezan con guion bajo ni procesa Jekyll: esto lo evita
fs.writeFileSync(path.join(destino, '.nojekyll'), '', 'utf8');

const total = fs.readdirSync(destino).length;
console.log(`docs/ armada con ${total} archivos: eso es lo que publica GitHub Pages.`);
