// Service worker: guarda la app en el teléfono para que abra aunque no haya señal.
// Los datos NO se cachean (siempre se piden al servidor); lo que se guarda offline es
// la carga de movimientos, y eso lo maneja la página con su propia cola.
// Rutas relativas: la app puede estar en una subcarpeta (GitHub Pages)
const VERSION = 'gastos-v5'; // ícono nuevo: fuerza a soltar la caché vieja
const SHELL = [
  './',
  'index.html',
  'app.js',
  'charts.js',
  'styles.css',
  'logica.js',
  'datos-firebase.js',
  'firebase.js',
  'config.js',
  'manifest.webmanifest',
  'iconos/icono-192.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      // uno por uno: si falta alguno (por ejemplo en la versión local), no se cae todo
      .then((cache) => Promise.all(SHELL.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((claves) => Promise.all(claves.filter((c) => c !== VERSION).map((c) => caches.delete(c))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // las cargas offline las maneja la página
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // los datos siempre frescos

  // Red primero, cache como respaldo: así una versión nueva se toma enseguida
  // y sin señal la app abre igual.
  event.respondWith(
    fetch(request)
      .then((respuesta) => {
        // Sólo se guarda lo que salió bien: cachear un 404 o un error deja la app
        // pegada a una versión rota hasta que se limpie a mano.
        if (respuesta.ok && respuesta.type === 'basic') {
          const copia = respuesta.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copia));
        }
        return respuesta;
      })
      .catch(() => caches.match(request).then((cacheada) => cacheada || caches.match('index.html')))
  );
});
