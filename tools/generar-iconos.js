// Genera los PNG del ícono de la app (el que queda en el escritorio del teléfono).
// Dibuja a mano un cuadrado redondeado con tres barras, sin librerías ni fuentes.
// Uso: node tools/generar-iconos.js
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const FONDO = [31, 111, 92]; // verde de la app
const BARRA = [255, 255, 255];

function crc32(buf) {
  let c;
  const tabla = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabla[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const byte of buf) crc = tabla[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(tipo, datos) {
  const largo = Buffer.alloc(4);
  largo.writeUInt32BE(datos.length);
  const cuerpo = Buffer.concat([Buffer.from(tipo, 'ascii'), datos]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(cuerpo));
  return Buffer.concat([largo, cuerpo, crc]);
}

function png(size, pixel) {
  const filas = [];
  for (let y = 0; y < size; y++) {
    const fila = Buffer.alloc(size * 4 + 1);
    fila[0] = 0; // sin filtro
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y, size);
      fila.writeUInt8(r, 1 + x * 4);
      fila.writeUInt8(g, 2 + x * 4);
      fila.writeUInt8(b, 3 + x * 4);
      fila.writeUInt8(a, 4 + x * 4);
    }
    filas.push(fila);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.writeUInt8(8, 8); // 8 bits por canal
  ihdr.writeUInt8(6, 9); // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(filas), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Cuadrado redondeado con un signo "$": la misma marca que ya se ve en la barra de
 * arriba dentro de la app (el cuadradito verde con el "$"), para que el ícono del
 * teléfono sea lo primero que reconocés y lo que ya conocés de adentro sean la misma
 * cosa. `margen` deja aire alrededor para el ícono "maskable" (el sistema lo recorta
 * en círculo y no puede perder el dibujo).
 *
 * El signo se arma con dos anillos en forma de "C" (arriba y abajo, cada uno abierto
 * hacia el costado por donde se conecta con el otro) más una barra vertical que los
 * atraviesa — es como se dibuja un "$" con círculos y rectángulos, sin necesitar una
 * fuente ni una curva a mano.
 */
function dibujo({ margen = 0, radio = 0.22 } = {}) {
  return (x, y, size) => {
    const m = size * margen;
    const lado = size - m * 2;
    const px = x - m;
    const py = y - m;
    if (px < 0 || py < 0 || px >= lado || py >= lado) return [0, 0, 0, 0];

    const r = lado * radio;
    const cx = Math.min(Math.max(px, r), lado - r);
    const cy = Math.min(Math.max(py, r), lado - r);
    if ((px - cx) ** 2 + (py - cy) ** 2 > r * r) return [0, 0, 0, 0];

    const fx = px / lado;
    const fy = py / lado;

    // Ángulo 0 = derecha, crece en sentido horario (la "y" de la imagen crece hacia abajo)
    const anguloDesde = (ax, ay, gx, gy) => {
      let a = (Math.atan2(gy - ay, gx - ax) * 180) / Math.PI;
      if (a < 0) a += 360;
      return a;
    };
    const enAnillo = (ax, ay, radioExt, grosor, desde, hasta) => {
      const d = Math.hypot(fx - ax, fy - ay);
      if (d > radioExt || d < radioExt - grosor) return false;
      const a = anguloDesde(ax, ay, fx, fy);
      return desde <= hasta ? a >= desde && a <= hasta : a >= desde || a <= hasta;
    };

    const grosor = 0.1;
    // El gancho de arriba: un anillo casi completo, con un hueco chico abajo a la
    // derecha (30°-90°, con 0°=derecha y creciendo en sentido horario).
    if (enAnillo(0.5, 0.32, 0.22, grosor, 90, 30)) return [...BARRA, 255];
    // El de abajo, con el hueco arriba a la izquierda (210°-270°): el mismo dibujo
    // dado vuelta, así las dos puntas quedan cerca de donde pasa la barra vertical.
    if (enAnillo(0.5, 0.68, 0.22, grosor, 270, 210)) return [...BARRA, 255];

    // La barra vertical: un poco más larga que los ganchos, como el trazo del signo real
    if (fx >= 0.5 - grosor / 2 && fx <= 0.5 + grosor / 2 && fy >= 0.14 && fy <= 0.86) return [...BARRA, 255];

    return [...FONDO, 255];
  };
}

const destino = path.join(__dirname, '..', 'public', 'iconos');
fs.mkdirSync(destino, { recursive: true });

for (const size of [192, 512]) {
  fs.writeFileSync(path.join(destino, `icono-${size}.png`), png(size, dibujo()));
  // "maskable": el sistema puede recortarlo en círculo, así que el dibujo va más adentro
  fs.writeFileSync(path.join(destino, `icono-maskable-${size}.png`), png(size, dibujo({ margen: 0.1, radio: 0.5 })));
}

console.log(`Íconos generados en ${destino}`);
