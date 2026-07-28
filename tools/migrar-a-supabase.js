// Pasa los datos del Sheet a Supabase, desde el backup que baja la app (⚙ → Bajar backup).
//
// El backup es exactamente lo que tenía la planilla, así que sirve de fuente sin tener que
// pedirle permisos a Google desde acá.
//
//   node tools/migrar-a-supabase.js data/backups/gastos-2026-07-28.json
//     -> revisa el archivo y muestra qué se va a insertar. No toca nada.
//
//   node tools/migrar-a-supabase.js data/backups/gastos-2026-07-28.json --aplicar
//     -> lo inserta.
//
// Las credenciales van por variable de entorno, nunca en el repositorio:
//   SUPABASE_URL=https://xxxx.supabase.co
//   SUPABASE_KEY=<la service_role, de Settings → API>
const fs = require('node:fs');

// Pestaña del Sheet -> tabla de Postgres. Las columnas ya se llaman igual en los dos lados.
const TABLAS = {
  Categorias: 'categorias',
  Celdas: 'celdas',
  Movimientos: 'movimientos',
  Subcategorias: 'subcategorias',
  Auto: 'autos',
  AutoServices: 'auto_services',
  AutoPlan: 'auto_plan',
  Quinta: 'quinta',
  QuintaPendientes: 'quinta_pendientes',
};

// El orden importa: services y plan apuntan a autos
const ORDEN = ['categorias', 'celdas', 'movimientos', 'subcategorias', 'autos', 'auto_services', 'auto_plan', 'quinta', 'quinta_pendientes'];

const BOOLEANAS = new Set(['pagado', 'hecho']);
const ENTERAS = new Set(['id', 'anio', 'mes', 'dia', 'orden', 'auto_id']);
const NUMERICAS = new Set(['monto', 'monto_moneda', 'cotizacion', 'monto_usd', 'precio_ars', 'precio_usd', 'mano_obra_ars', 'total_usd']);
// En autos, "anio" y "km" son texto libre ("2014 / 2015"), no números
const TEXTO_IGUAL = { autos: new Set(['anio', 'km']) };

const vacio = (v) => v === '' || v === null || v === undefined;

function convertirValor(tabla, columna, valor) {
  if (BOOLEANAS.has(columna)) {
    return valor === true || valor === 1 || valor === '1' || valor === 'true' || valor === 'TRUE' || valor === 'VERDADERO';
  }
  // Las columnas de texto del esquema son todas "not null default ''": mandar null ahí
  // hace que Postgres rechace la fila entera. Los vacíos de la planilla van como ''.
  const esNumero = (ENTERAS.has(columna) || NUMERICAS.has(columna)) && !TEXTO_IGUAL[tabla]?.has(columna);
  if (!esNumero) return valor === null || valor === undefined ? '' : String(valor);
  if (vacio(valor)) return null; // dia, cotización y precios sí admiten null
  const n = Number(valor);
  if (!Number.isFinite(n)) return null;
  return ENTERAS.has(columna) ? Math.round(n) : n;
}

/** Una pestaña del backup (matriz con encabezado) a filas listas para Postgres. */
function filasParaPostgres(tabla, matriz) {
  if (!matriz || matriz.length < 2) return [];
  const encabezado = (matriz[0] || []).map((c) => String(c ?? '').trim());
  const filas = [];
  for (let i = 1; i < matriz.length; i++) {
    const cruda = matriz[i] || [];
    if (cruda.every(vacio)) continue;
    const fila = {};
    encabezado.forEach((columna, c) => {
      if (!columna) return;
      fila[columna] = convertirValor(tabla, columna, cruda[c]);
    });
    if (fila.id === null || fila.id === undefined) continue; // sin id no hay identidad
    filas.push(fila);
  }
  return filas;
}

/** Lo que no puede entrar en la base, dicho antes de intentarlo. */
function revisar(tabla, filas) {
  const problemas = [];
  const vistos = new Set();
  for (const f of filas) {
    if (vistos.has(f.id)) problemas.push(`id repetido: ${f.id}`);
    vistos.add(f.id);
    if (tabla === 'movimientos') {
      if (f.monto === null) problemas.push(`movimiento ${f.id} sin monto`);
      if (!['gasto', 'ingreso'].includes(f.tipo)) problemas.push(`movimiento ${f.id} con tipo "${f.tipo}"`);
      if (!(f.mes >= 1 && f.mes <= 12)) problemas.push(`movimiento ${f.id} con mes ${f.mes}`);
    }
    if (tabla === 'celdas' && f.monto === null) problemas.push(`celda ${f.id} sin monto`);
  }
  return problemas;
}

/** Los totales por mes, para comprobar que la migración no movió ni un peso. */
function totalesPorMes(porTabla) {
  const total = {};
  const sumar = (anio, mes, monto) => {
    const k = `${anio}-${String(mes).padStart(2, '0')}`;
    total[k] = (total[k] || 0) + (monto || 0);
  };
  (porTabla.celdas || []).forEach((c) => sumar(c.anio, c.mes, c.monto));
  (porTabla.movimientos || []).forEach((m) => {
    if (m.pagado) sumar(m.anio, m.mes, m.monto);
  });
  return total;
}

async function insertar(url, clave, tabla, filas) {
  const LOTE = 500; // Supabase acepta mucho más, pero así el progreso se ve
  for (let i = 0; i < filas.length; i += LOTE) {
    const parte = filas.slice(i, i + LOTE);
    const res = await fetch(`${url}/rest/v1/${tabla}`, {
      method: 'POST',
      headers: {
        apikey: clave,
        Authorization: `Bearer ${clave}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(parte),
    });
    if (!res.ok) {
      const detalle = await res.text();
      throw new Error(`${tabla}: ${res.status} ${detalle.slice(0, 400)}`);
    }
    process.stdout.write(`  ${tabla}: ${Math.min(i + LOTE, filas.length)}/${filas.length}\r`);
  }
  if (filas.length) console.log(`  ${tabla}: ${filas.length} fila(s) insertada(s)      `);
}

async function main() {
  const archivo = process.argv[2];
  const aplicar = process.argv.includes('--aplicar');
  if (!archivo) {
    console.error('Falta el backup. Uso: node tools/migrar-a-supabase.js <backup.json> [--aplicar]');
    process.exit(1);
  }

  const crudo = JSON.parse(fs.readFileSync(archivo, 'utf8'));
  const tablasDelBackup = crudo.tablas || crudo; // sirve igual un JSON con sólo las pestañas

  if (crudo.sinSubir) {
    console.log(`\n  OJO: este backup se bajó con ${crudo.sinSubir} cambio(s) sin subir al Sheet.`);
    console.log('  Esos cambios no están acá. Sincronizá y bajá un backup nuevo.\n');
  }

  const porTabla = {};
  const problemas = [];
  for (const [hoja, tabla] of Object.entries(TABLAS)) {
    const filas = filasParaPostgres(tabla, tablasDelBackup[hoja]);
    porTabla[tabla] = filas;
    problemas.push(...revisar(tabla, filas).map((p) => `${tabla}: ${p}`));
  }

  console.log(`\nBackup: ${archivo}`);
  if (crudo.bajado) console.log(`Bajado: ${new Date(crudo.bajado).toLocaleString('es-AR')}`);
  console.log('');
  for (const tabla of ORDEN) console.log(`  ${tabla.padEnd(20)} ${String(porTabla[tabla].length).padStart(5)} fila(s)`);

  const totales = totalesPorMes(porTabla);
  const meses = Object.keys(totales).sort();
  console.log(`\n  ${meses.length} mes(es) con movimiento · primero ${meses[0]} · último ${meses[meses.length - 1]}`);
  console.log(`  Suma de control: ${Math.round(Object.values(totales).reduce((a, b) => a + b, 0))}`);

  if (problemas.length) {
    console.log(`\n  ${problemas.length} problema(s) — la base los va a rechazar:`);
    problemas.slice(0, 20).forEach((p) => console.log(`    · ${p}`));
    if (problemas.length > 20) console.log(`    · y ${problemas.length - 20} más`);
    process.exit(1);
  }

  if (!aplicar) {
    console.log('\nNo se tocó nada. Repetí con --aplicar para insertarlo.\n');
    return;
  }

  const url = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const clave = process.env.SUPABASE_KEY;
  if (!url || !clave) {
    console.error('\nFaltan SUPABASE_URL y SUPABASE_KEY en el entorno.\n');
    process.exit(1);
  }

  console.log('\nInsertando…\n');
  for (const tabla of ORDEN) await insertar(url, clave, tabla, porTabla[tabla]);

  console.log('\nListo. Ahora corré db/despues-de-migrar.sql en el SQL Editor de Supabase');
  console.log('para que los id nuevos no choquen con los que acabás de importar.\n');
}

module.exports = { filasParaPostgres, convertirValor, totalesPorMes, revisar, TABLAS };

if (require.main === module) {
  main().catch((err) => {
    console.error(`\n${err.message}\n`);
    process.exit(1);
  });
}
