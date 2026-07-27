// Acceso con clave. Sin dependencias: scrypt para la clave, HMAC para la sesión.
//
// Se activa sola cuando existe la variable de entorno GASTOS_PASSWORD. Si no está
// (o sea, corriendo en tu PC), la app funciona como siempre, sin pedir nada.
const crypto = require('node:crypto');
const store = require('./db');

const PASSWORD = process.env.GASTOS_PASSWORD || '';
const enabled = Boolean(PASSWORD);
const DIAS = 90;
const MAX_INTENTOS = 5;
const ESPERA_MS = 60_000;

store.db.exec('CREATE TABLE IF NOT EXISTS config (clave TEXT PRIMARY KEY, valor TEXT NOT NULL)');

/** Secreto de firma: del entorno, o uno propio guardado en la base (así la sesión sobrevive reinicios). */
function secreto() {
  if (process.env.GASTOS_SECRET) return process.env.GASTOS_SECRET;
  const fila = store.db.prepare("SELECT valor FROM config WHERE clave = 'secreto'").get();
  if (fila) return fila.valor;
  const nuevo = crypto.randomBytes(32).toString('hex');
  store.db.prepare("INSERT INTO config (clave, valor) VALUES ('secreto', ?)").run(nuevo);
  return nuevo;
}

const SAL = 'gastos.v1';
const claveHash = enabled ? crypto.scryptSync(PASSWORD, SAL, 64) : null;

function firmar(datos) {
  return crypto.createHmac('sha256', secreto()).update(datos).digest('hex');
}

function iguales(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

function crearSesion() {
  const vence = Date.now() + DIAS * 24 * 60 * 60 * 1000;
  return `${vence}.${firmar(String(vence))}`;
}

function sesionValida(token) {
  if (!token) return false;
  const [vence, firma] = String(token).split('.');
  if (!vence || !firma) return false;
  if (!iguales(firma, firmar(vence))) return false;
  return Number(vence) > Date.now();
}

function claveCorrecta(intento) {
  if (!enabled) return true;
  const hash = crypto.scryptSync(String(intento || ''), SAL, 64);
  return crypto.timingSafeEqual(hash, claveHash);
}

// Freno para que nadie pruebe claves a lo bruto
const intentos = new Map();

function bloqueado(ip) {
  const registro = intentos.get(ip);
  return Boolean(registro && registro.hasta > Date.now());
}

function registrarFallo(ip) {
  const registro = intentos.get(ip) || { fallos: 0, hasta: 0 };
  registro.fallos++;
  if (registro.fallos >= MAX_INTENTOS) {
    registro.hasta = Date.now() + ESPERA_MS;
    registro.fallos = 0;
  }
  intentos.set(ip, registro);
}

function limpiarIntentos(ip) {
  intentos.delete(ip);
}

function leerCookies(req) {
  const cabecera = req.headers.cookie || '';
  return Object.fromEntries(
    cabecera
      .split(';')
      .map((c) => c.trim().split('='))
      .filter(([k, v]) => k && v !== undefined)
      .map(([k, ...v]) => [k, decodeURIComponent(v.join('='))])
  );
}

function autenticado(req) {
  if (!enabled) return true;
  return sesionValida(leerCookies(req).sesion);
}

function cookieDeSesion(token, seguro) {
  const partes = [
    `sesion=${token}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${DIAS * 24 * 60 * 60}`,
  ];
  if (seguro) partes.push('Secure');
  return partes.join('; ');
}

function cookieVacia(seguro) {
  const partes = ['sesion=', 'HttpOnly', 'Path=/', 'SameSite=Lax', 'Max-Age=0'];
  if (seguro) partes.push('Secure');
  return partes.join('; ');
}

module.exports = {
  enabled,
  autenticado,
  claveCorrecta,
  crearSesion,
  cookieDeSesion,
  cookieVacia,
  bloqueado,
  registrarFallo,
  limpiarIntentos,
  leerCookies,
};
