// Servidor local: sirve la interfaz y expone la API JSON. Sin dependencias externas.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const store = require('./db');
const auth = require('./auth');

const PORT = Number(process.env.PORT || 4321);
// En tu PC escucha sólo local; en el servidor tiene que aceptar de afuera.
const HOST = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
const SEGURO = process.env.NODE_ENV === 'production';
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

function sendJson(res, status, data) {
  send(res, status, JSON.stringify(data), { 'Content-Type': 'application/json; charset=utf-8' });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 5 * 1024 * 1024) {
        reject(new Error('cuerpo demasiado grande'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('JSON inválido'));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, 'Prohibido');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'No encontrado');
    send(res, 200, data, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  });
}

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

// --------------------------- API ---------------------------

/** Lo que la pantalla necesita para dibujarse: evita varias idas y vueltas seguidas. */
function estadoDeVista(vista) {
  const year = Number(vista.year);
  const month = Number(vista.month);
  const estado = { year: store.getYear(year), years: store.listYears() };
  if (month >= 1 && month <= 12) {
    estado.movements = store.getMovements({
      year,
      month,
      section: vista.section || null,
      category: vista.category || null,
    });
  }
  estado.catalog = { catalog: store.listCatalog(), subcategories: store.listSubcategories() };
  return estado;
}

const routes = [
  {
    method: 'GET',
    pattern: /^\/api\/bootstrap$/,
    handler: (_m, _b, url) =>
      estadoDeVista({
        year: Number(url.searchParams.get('year')) || new Date().getFullYear(),
        month: Number(url.searchParams.get('month')) || 1,
      }),
  },
  {
    method: 'GET',
    pattern: /^\/api\/years$/,
    handler: () => ({ years: store.listYears() }),
  },
  {
    method: 'GET',
    pattern: /^\/api\/year\/(\d{4})$/,
    handler: (m) => store.getYear(Number(m[1])),
  },
  {
    method: 'POST',
    pattern: /^\/api\/year\/(\d{4})$/,
    handler: (m, body) => {
      const year = Number(m[1]);
      if (body.copyFrom) store.cloneYearCategories(Number(body.copyFrom), year);
      else for (const s of store.GRID_SECTIONS) store.ensureCategory({ year, section: s, name: 'NUEVO' });
      return store.getYear(year);
    },
  },
  {
    method: 'PUT',
    pattern: /^\/api\/cell$/,
    handler: (_m, body) => {
      const { year, section, category, month } = body;
      if (!store.GRID_SECTIONS.includes(section)) throw new HttpError(400, 'sección inválida');
      if (!(month >= 1 && month <= 12)) throw new HttpError(400, 'mes inválido');
      store.setCell({ year: Number(year), section, category, month: Number(month), amount: num(body.amount) });
      return { ok: true };
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/category$/,
    handler: (_m, body) => {
      const name = String(body.name || '').trim();
      if (!name) throw new HttpError(400, 'falta el nombre');
      store.ensureCategory({ year: Number(body.year), section: body.section, name });
      return { ok: true, name };
    },
  },
  {
    method: 'PATCH',
    pattern: /^\/api\/category$/,
    handler: (_m, body) => {
      if (body.direction) store.moveCategory({ year: Number(body.year), section: body.section, name: body.name, direction: body.direction });
      else store.renameCategory({ year: Number(body.year), section: body.section, from: body.from, to: String(body.to || '').trim() });
      return { ok: true };
    },
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/category$/,
    handler: (_m, body) => {
      store.deleteCategory({ year: Number(body.year), section: body.section, name: body.name });
      return { ok: true };
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/movements$/,
    handler: (_m, _b, url) => ({
      movements: store.getMovements({
        year: Number(url.searchParams.get('year')),
        month: Number(url.searchParams.get('month')),
        section: url.searchParams.get('section') || null,
        category: url.searchParams.get('category') || null,
      }),
    }),
  },
  {
    method: 'POST',
    pattern: /^\/api\/movements$/,
    handler: (_m, body) => ({ id: store.addMovement({ ...body, amount: num(body.amount) }) }),
  },
  {
    method: 'PUT',
    pattern: /^\/api\/movements\/(\d+)$/,
    handler: (m, body) => {
      const patch = { ...body };
      if ('amount' in patch) patch.amount = num(patch.amount);
      store.updateMovement(Number(m[1]), patch);
      return { ok: true };
    },
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/movements\/(\d+)$/,
    handler: (m) => {
      store.deleteMovement(Number(m[1]));
      return { ok: true };
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/catalog$/,
    handler: () => ({ catalog: store.listCatalog(), subcategories: store.listSubcategories() }),
  },
  {
    method: 'GET',
    pattern: /^\/api\/subcategories$/,
    handler: () => ({ subcategories: store.listSubcategories() }),
  },
  {
    method: 'POST',
    pattern: /^\/api\/subcategories$/,
    handler: (_m, body) => ({
      name: store.addSubcategory({ section: body.section, category: body.category, name: body.name }),
    }),
  },
  { method: 'GET', pattern: /^\/api\/vehicles$/, handler: () => ({ vehicles: store.getVehicles() }) },
  { method: 'GET', pattern: /^\/api\/quinta$/, handler: () => store.getQuinta() },
  {
    method: 'POST',
    pattern: /^\/api\/rows\/(vehicles|services|service_plan|quinta_items|quinta_todos)$/,
    handler: (m, body) => ({ id: store.insertRow(m[1], body) }),
  },
  {
    method: 'PUT',
    pattern: /^\/api\/rows\/(vehicles|services|service_plan|quinta_items|quinta_todos)\/(\d+)$/,
    handler: (m, body) => {
      store.updateRow(m[1], Number(m[2]), body);
      return { ok: true };
    },
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/rows\/(vehicles|services|service_plan|quinta_items|quinta_todos)\/(\d+)$/,
    handler: (m) => {
      store.deleteRow(m[1], Number(m[2]));
      return { ok: true };
    },
  },
  { method: 'GET', pattern: /^\/api\/backup$/, handler: () => store.exportAll() },
];

// Rutas que no piden sesión: saber si hace falta clave, y entregarla.
const PUBLICAS = [/^\/api\/session$/, /^\/api\/login$/, /^\/api\/logout$/];

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/api/')) return serveStatic(req, res);

  // --- sesión ---
  const ip = req.headers['fly-client-ip'] || req.socket.remoteAddress || 'desconocida';

  if (url.pathname === '/api/session' && req.method === 'GET') {
    return sendJson(res, 200, { pideClave: auth.enabled, autenticado: auth.autenticado(req) });
  }

  if (url.pathname === '/api/login' && req.method === 'POST') {
    if (auth.bloqueado(ip)) {
      return sendJson(res, 429, { error: 'Demasiados intentos. Probá de nuevo en un minuto.' });
    }
    const body = await readBody(req).catch(() => ({}));
    if (!auth.claveCorrecta(body.clave)) {
      auth.registrarFallo(ip);
      return sendJson(res, 401, { error: 'Clave incorrecta' });
    }
    auth.limpiarIntentos(ip);
    res.setHeader('Set-Cookie', auth.cookieDeSesion(auth.crearSesion(), SEGURO));
    return sendJson(res, 200, { ok: true });
  }

  if (url.pathname === '/api/logout' && req.method === 'POST') {
    res.setHeader('Set-Cookie', auth.cookieVacia(SEGURO));
    return sendJson(res, 200, { ok: true });
  }

  if (!PUBLICAS.some((p) => p.test(url.pathname)) && !auth.autenticado(req)) {
    return sendJson(res, 401, { error: 'Sesión vencida' });
  }

  const route = routes.find((r) => r.method === req.method && r.pattern.test(url.pathname));
  if (!route) return sendJson(res, 404, { error: 'ruta no encontrada' });

  try {
    const body = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) ? await readBody(req) : {};
    const data = route.handler(url.pathname.match(route.pattern), body, url);
    // Las escrituras devuelven de una el estado actualizado de lo que estás mirando.
    if (req.method !== 'GET' && body && body.vista && data && !data.error) {
      data.estado = estadoDeVista(body.vista);
    }
    if (url.pathname === '/api/backup') {
      const stamp = new Date().toISOString().slice(0, 10);
      return send(res, 200, JSON.stringify(data, null, 2), {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="gastos-backup-${stamp}.json"`,
      });
    }
    sendJson(res, 200, data);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error(err);
    sendJson(res, status, { error: err.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Gastos escuchando en http://${HOST}:${PORT}`);
  console.log(`Base de datos: ${store.DB_PATH}`);
  console.log(auth.enabled ? 'Acceso con clave: activado' : 'Acceso con clave: desactivado (sin GASTOS_PASSWORD)');
});
