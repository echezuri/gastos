// Sirve la carpeta docs/ como archivos estáticos, igual que lo haría GitHub Pages.
// Sólo para probar la versión instalable antes de subirla.
//
// Uso: node tools/servir-pwa.js   ->   http://localhost:4322
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const raiz = path.join(__dirname, '..', 'docs');
const PUERTO = Number(process.env.PORT || 4322);

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
};

http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const relativo = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const archivo = path.join(raiz, relativo);
    if (!archivo.startsWith(raiz)) {
      res.writeHead(403).end('Prohibido');
      return;
    }
    fs.readFile(archivo, (err, datos) => {
      if (err) {
        res.writeHead(404).end('No encontrado');
        return;
      }
      res.writeHead(200, {
        'Content-Type': TIPOS[path.extname(archivo)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(datos);
    });
  })
  .listen(PUERTO, '127.0.0.1', () => {
    console.log(`PWA servida en http://127.0.0.1:${PUERTO} (carpeta docs/)`);
  });
