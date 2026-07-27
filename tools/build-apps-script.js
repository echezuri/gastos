// Arma el Index.html que va adentro del Google Sheet, a partir de la misma interfaz
// que usa la versión local. Un solo código fuente: acá sólo se junta todo en un archivo,
// porque Apps Script no sirve archivos sueltos.
//
// Uso: npm run build:sheets
const fs = require('node:fs');
const path = require('node:path');

const publico = path.join(__dirname, '..', 'public');
const destino = path.join(__dirname, '..', 'apps-script');
fs.mkdirSync(destino, { recursive: true });

const leer = (archivo) => fs.readFileSync(path.join(publico, archivo), 'utf8');

const html = leer('index.html');
const cuerpo = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>')).trim();

// El <body> original, sin las etiquetas de PWA (adentro del Sheet no aplican) y con
// el CSS y el JS pegados adentro.
const salida = `<!doctype html>
<html lang="es-AR">
  <head>
    <base target="_top" />
    <meta charset="utf-8" />
    <title>Gastos</title>
    <style>
${leer('styles.css')}
    </style>
  </head>
  <body>
${cuerpo.replace(/\n\s*<script src="[^"]+"><\/script>/g, '')}
    <script>
${leer('charts.js')}
    </script>
    <script>
${leer('app.js')}
    </script>
  </body>
</html>
`;

fs.writeFileSync(path.join(destino, 'Index.html'), salida, 'utf8');

const kb = (Buffer.byteLength(salida) / 1024).toFixed(1);
console.log(`apps-script/Index.html generado (${kb} KB)`);
console.log('Subilo junto con Codigo.gs al proyecto de Apps Script del Sheet.');
