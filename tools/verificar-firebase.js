// Compara lo que quedó en Firestore contra el backup del Sheet del que salió.
//
// Migrar sin comprobar no sirve de nada: si algo se perdió por el camino, se nota meses
// después y ya no hay con qué comparar.
//
//   node tools/verificar-firebase.js <backup.json>
//
// Usa las mismas variables de entorno que el migrador:
//   FIREBASE_PROJECT · FIREBASE_API_KEY · FIREBASE_EMAIL · FIREBASE_PASSWORD
const fs = require('node:fs');
const { COLECCIONES, filasDelBackup, totalesPorMes } = require('./backup-a-filas');

const ORDEN = Object.values(COLECCIONES);

/** Lo inverso de lo que hace el migrador: de valor etiquetado a valor de JavaScript. */
function valorDeFirestore(v) {
  if (!v || typeof v !== 'object') return null;
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('stringValue' in v) return v.stringValue;
  return null;
}

function documentoAFila(doc) {
  const fila = {};
  for (const [campo, valor] of Object.entries(doc.fields || {})) fila[campo] = valorDeFirestore(valor);
  return fila;
}

async function entrar(apiKey, email, password) {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const datos = await res.json();
  if (!res.ok) throw new Error(`No pude entrar: ${datos.error?.message || res.status}`);
  return datos.idToken;
}

/** Trae una colección entera, siguiendo las páginas hasta el final. */
async function traer(proyecto, idToken, coleccion) {
  const base = `https://firestore.googleapis.com/v1/projects/${proyecto}/databases/(default)/documents/${coleccion}`;
  const filas = [];
  let token = null;
  do {
    const url = `${base}?pageSize=300${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
    if (!res.ok) throw new Error(`${coleccion}: ${res.status} ${(await res.text()).slice(0, 300)}`);
    const datos = await res.json();
    (datos.documents || []).forEach((d) => filas.push(documentoAFila(d)));
    token = datos.nextPageToken || null;
  } while (token);
  return filas;
}

async function main() {
  const archivo = process.argv[2];
  if (!archivo) {
    console.error('Falta el backup. Uso: node tools/verificar-firebase.js <backup.json>');
    process.exit(1);
  }
  const proyecto = process.env.FIREBASE_PROJECT;
  const apiKey = process.env.FIREBASE_API_KEY;
  const email = process.env.FIREBASE_EMAIL;
  const password = process.env.FIREBASE_PASSWORD;
  if (!proyecto || !apiKey || !email || !password) {
    console.error('\nFaltan FIREBASE_PROJECT, FIREBASE_API_KEY, FIREBASE_EMAIL y FIREBASE_PASSWORD.\n');
    process.exit(1);
  }

  const esperado = filasDelBackup(JSON.parse(fs.readFileSync(archivo, 'utf8')));
  const idToken = await entrar(apiKey, email, password);

  console.log('\n  colección              backup   Firebase');
  console.log('  ---------------------------------------');
  const enFirebase = {};
  let malas = 0;
  for (const coleccion of ORDEN) {
    enFirebase[coleccion] = await traer(proyecto, idToken, coleccion);
    const a = esperado[coleccion].length;
    const b = enFirebase[coleccion].length;
    if (a !== b) malas++;
    console.log(`  ${coleccion.padEnd(20)} ${String(a).padStart(6)}   ${String(b).padStart(8)}  ${a === b ? 'ok' : '<-- NO COINCIDE'}`);
  }

  const totalA = totalesPorMes(esperado);
  const totalB = totalesPorMes(enFirebase);
  const sumar = (t) => Math.round(Object.values(t).reduce((a, b) => a + b, 0));
  console.log(`\n  Suma de control     backup ${sumar(totalA)}   Firebase ${sumar(totalB)}`);

  // Mes por mes, que es donde se notaría un importe que cambió de tipo o se redondeó mal
  const meses = [...new Set([...Object.keys(totalA), ...Object.keys(totalB)])].sort();
  const distintos = meses.filter((m) => Math.round(totalA[m] || 0) !== Math.round(totalB[m] || 0));
  if (distintos.length) {
    console.log(`\n  ${distintos.length} mes(es) con diferencia:`);
    distintos.slice(0, 12).forEach((m) => console.log(`    ${m}: backup ${Math.round(totalA[m] || 0)} · Firebase ${Math.round(totalB[m] || 0)}`));
  }

  const bien = malas === 0 && distintos.length === 0 && sumar(totalA) === sumar(totalB);
  console.log(bien ? '\n  Todo coincide: no se perdió ni se cambió nada.\n' : '\n  HAY DIFERENCIAS. No cambies la app todavía.\n');
  process.exit(bien ? 0 : 1);
}

main().catch((err) => {
  console.error(`\n${err.message}\n`);
  process.exit(1);
});
