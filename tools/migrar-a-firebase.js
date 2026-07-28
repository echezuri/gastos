// Pasa los datos del Sheet a Firestore, desde el backup que baja la app (⚙ → Bajar backup).
//
//   node tools/migrar-a-firebase.js data/backups/gastos-2026-07-28.json
//     -> revisa el archivo y muestra qué se va a subir. No toca nada.
//
//   node tools/migrar-a-firebase.js data/backups/gastos-2026-07-28.json --aplicar
//     -> lo sube.
//
// Entra con tu propio usuario, el mismo que usás en la app, así que no hace falta
// ninguna credencial de administrador ni ningún paquete de Google. Las variables van por
// entorno, nunca en el repositorio:
//
//   FIREBASE_PROJECT=gastos-xxxx
//   FIREBASE_API_KEY=<la apiKey de la configuración web>
//   FIREBASE_EMAIL=<tu usuario>
//   FIREBASE_PASSWORD=<tu clave>
const fs = require('node:fs');
const { COLECCIONES, ENTERAS, filasDelBackup, revisar, totalesPorMes } = require('./backup-a-filas');

// El orden sólo importa para leer la salida; en Firestore no hay claves foráneas
const ORDEN = Object.values(COLECCIONES);
const POR_LOTE = 400; // Firestore admite 500 escrituras por commit

/**
 * Firestore no adivina el tipo: cada valor viaja etiquetado.
 *
 * Los enteros van como texto porque JSON no distingue 1 de 1.0 y la API los rechaza si
 * llegan como número. La plata va siempre como doubleValue, aunque sea redonda: si el
 * mismo campo fuera entero en unas filas y decimal en otras, ordenar y comparar se
 * comporta distinto según la fila.
 */
function valorFirestore(campo, valor) {
  if (valor === null || valor === undefined) return { nullValue: null };
  if (typeof valor === 'boolean') return { booleanValue: valor };
  if (typeof valor === 'number') {
    if (ENTERAS.has(campo) && Number.isInteger(valor)) return { integerValue: String(valor) };
    return { doubleValue: valor };
  }
  return { stringValue: String(valor) };
}

function documentoFirestore(fila) {
  const fields = {};
  for (const [campo, valor] of Object.entries(fila)) fields[campo] = valorFirestore(campo, valor);
  return { fields };
}

async function entrar(apiKey, email, password) {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const datos = await res.json();
  if (!res.ok) throw new Error(`No pude entrar: ${datos.error?.message || res.status}`);
  return { idToken: datos.idToken, uid: datos.localId };
}

async function subir(proyecto, idToken, coleccion, filas) {
  const base = `projects/${proyecto}/databases/(default)/documents`;
  for (let i = 0; i < filas.length; i += POR_LOTE) {
    const parte = filas.slice(i, i + POR_LOTE);
    const writes = parte.map((fila) => ({
      update: { name: `${base}/${coleccion}/${fila.id}`, ...documentoFirestore(fila) },
    }));
    const res = await fetch(`https://firestore.googleapis.com/v1/${base}:commit`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ writes }),
    });
    if (!res.ok) {
      const detalle = await res.text();
      throw new Error(`${coleccion}: ${res.status} ${detalle.slice(0, 400)}`);
    }
    process.stdout.write(`  ${coleccion}: ${Math.min(i + POR_LOTE, filas.length)}/${filas.length}\r`);
  }
  if (filas.length) console.log(`  ${coleccion}: ${filas.length} documento(s)      `);
}

async function main() {
  const archivo = process.argv[2];
  const aplicar = process.argv.includes('--aplicar');
  if (!archivo) {
    console.error('Falta el backup. Uso: node tools/migrar-a-firebase.js <backup.json> [--aplicar]');
    process.exit(1);
  }

  const crudo = JSON.parse(fs.readFileSync(archivo, 'utf8'));
  if (crudo.sinSubir) {
    console.log(`\n  OJO: este backup se bajó con ${crudo.sinSubir} cambio(s) sin subir al Sheet.`);
    console.log('  Esos cambios no están acá. Sincronizá y bajá un backup nuevo.\n');
  }

  const porColeccion = filasDelBackup(crudo);
  const problemas = [];
  for (const coleccion of ORDEN) problemas.push(...revisar(coleccion, porColeccion[coleccion]).map((p) => `${coleccion}: ${p}`));

  console.log(`\nBackup: ${archivo}`);
  if (crudo.bajado) console.log(`Bajado: ${new Date(crudo.bajado).toLocaleString('es-AR')}`);
  console.log('');
  let total = 0;
  for (const coleccion of ORDEN) {
    console.log(`  ${coleccion.padEnd(20)} ${String(porColeccion[coleccion].length).padStart(5)} documento(s)`);
    total += porColeccion[coleccion].length;
  }

  const totales = totalesPorMes(porColeccion);
  const meses = Object.keys(totales).sort();
  console.log(`\n  ${total} documentos · ${meses.length} mes(es) con movimiento · ${meses[0]} a ${meses[meses.length - 1]}`);
  console.log(`  Suma de control: ${Math.round(Object.values(totales).reduce((a, b) => a + b, 0))}`);

  if (problemas.length) {
    console.log(`\n  ${problemas.length} problema(s):`);
    problemas.slice(0, 20).forEach((p) => console.log(`    · ${p}`));
    if (problemas.length > 20) console.log(`    · y ${problemas.length - 20} más`);
    process.exit(1);
  }

  if (!aplicar) {
    console.log('\nNo se tocó nada. Repetí con --aplicar para subirlo.\n');
    return;
  }

  const proyecto = process.env.FIREBASE_PROJECT;
  const apiKey = process.env.FIREBASE_API_KEY;
  const email = process.env.FIREBASE_EMAIL;
  const password = process.env.FIREBASE_PASSWORD;
  if (!proyecto || !apiKey || !email || !password) {
    console.error('\nFaltan FIREBASE_PROJECT, FIREBASE_API_KEY, FIREBASE_EMAIL y FIREBASE_PASSWORD.\n');
    process.exit(1);
  }

  const { idToken, uid } = await entrar(apiKey, email, password);
  console.log(`\nEntré como ${email}`);
  console.log(`Tu identificador de usuario es: ${uid}`);
  console.log('(ese es el que va en las reglas de seguridad)\n');

  for (const coleccion of ORDEN) await subir(proyecto, idToken, coleccion, porColeccion[coleccion]);
  console.log('\nListo.\n');
}

module.exports = { valorFirestore, documentoFirestore };

if (require.main === module) {
  main().catch((err) => {
    console.error(`\n${err.message}\n`);
    process.exit(1);
  });
}
