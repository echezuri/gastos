// Control de la importación: recalcula los totales por mes desde la base y los compara
// con las filas "... TOTAL" que ya venían escritas en el sheet.
// Uso: node tools/verify-import.js
const store = require('../db');
const { readGrid, parseAmount, BLOCKS, monthColumns } = require('./import-sheet');

const MONTH_NAMES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function sheetTotals(grid, block) {
  const cols = monthColumns(grid, block.header);
  const totals = {};
  let section = null;
  for (let i = block.header + 1; i < block.end; i++) {
    const row = grid[i] || [];
    const label = (row[2] || '').toUpperCase();
    const prev = ((grid[i - 1] || [])[2] || '').toUpperCase();
    const next = ((grid[i + 1] || [])[2] || '').toUpperCase();
    if (label === 'INGRESOS') section = 'ingresos';
    else if (label === 'AFIP') section = 'afip';
    else if (label === 'TARJETAS') section = 'tarjetas';
    else if (label === 'OTROS') section = 'variables';
    else if (label === 'GASTOS' && prev !== 'OTROS') section = next === 'VARIABLES' ? 'variables' : 'fijos';
    else if (['MI GASTO', 'GASTO', 'RESTO'].includes(label)) section = null;

    const category = (row[3] || '').trim();
    if (!section || !/TOTAL$/i.test(category)) continue;
    totals[section] = cols.map((c) => parseAmount(row[c]));
  }

  // AFIP dejó de ser una sección: ahora es una categoría de gastos fijos, así que
  // del lado del sheet se comparan sumadas.
  if (totals.afip) {
    totals.fijos = (totals.fijos || Array(12).fill(null)).map((v, i) => {
      const afip = totals.afip[i];
      if (v === null && afip === null) return null;
      return (v || 0) + (afip || 0);
    });
    delete totals.afip;
  }
  return totals;
}

function dbTotals(year) {
  const rows = store.db
    .prepare('SELECT section, month, SUM(amount) AS total FROM cells WHERE year = ? GROUP BY section, month')
    .all(year);
  const out = {};
  for (const r of rows) {
    out[r.section] = out[r.section] || Array(12).fill(0);
    out[r.section][r.month - 1] = r.total;
  }
  const moves = store.db
    .prepare('SELECT section, month, SUM(amount) AS total FROM movements WHERE year = ? AND paid = 1 GROUP BY section, month')
    .all(year);
  for (const mv of moves) {
    // "ahorro" (dólares y saldos compartidos) salió de gastos variables en la
    // recategorización, pero para el sheet era parte de "otros gastos": se compara junto.
    const bucket = mv.section === 'ahorro' ? 'variables' : mv.section;
    out[bucket] = out[bucket] || Array(12).fill(0);
    out[bucket][mv.month - 1] = (out[bucket][mv.month - 1] || 0) + mv.total;
  }
  out.variables = out.variables || Array(12).fill(0);
  return out;
}

function main() {
  const grid = readGrid();
  let problems = 0;
  let checks = 0;

  for (const block of BLOCKS) {
    const expected = sheetTotals(grid, block);
    const actual = dbTotals(block.year);
    const lines = [];
    for (const section of Object.keys(expected)) {
      expected[section].forEach((exp, m) => {
        if (exp === null) return;
        const act = (actual[section] || [])[m] || 0;
        checks++;
        if (Math.abs(act - exp) > 1) {
          problems++;
          lines.push(
            `    ${section.padEnd(9)} ${MONTH_NAMES[m]}  sheet ${exp.toLocaleString('es-AR')}  app ${act.toLocaleString('es-AR')}  (dif ${(act - exp).toLocaleString('es-AR')})`
          );
        }
      });
    }
    // El gasto total del mes es el control que sobrevive a las reclasificaciones:
    // mover una categoría de una sección a otra no puede cambiar cuánto salió.
    const totalLines = [];
    for (let m = 0; m < 12; m++) {
      const esperado = ['fijos', 'tarjetas', 'variables']
        .map((s) => (expected[s] || [])[m])
        .filter((v) => v !== null && v !== undefined);
      if (esperado.length < 3) continue;
      const sheetTotal = esperado.reduce((a, b) => a + b, 0);
      const appTotal = ['fijos', 'tarjetas', 'variables'].reduce(
        (acc, s) => acc + ((actual[s] || [])[m] || 0),
        0
      );
      checks++;
      if (Math.abs(appTotal - sheetTotal) > 1) {
        problems++;
        totalLines.push(
          `    gasto del mes ${MONTH_NAMES[m]}  sheet ${sheetTotal.toLocaleString('es-AR')}  app ${appTotal.toLocaleString('es-AR')}`
        );
      }
    }

    const all = [...lines, ...totalLines];
    console.log(`${block.year}: ${all.length ? `${all.length} diferencia(s)` : 'todos los totales coinciden'}`);
    all.forEach((l) => console.log(l));
  }

  console.log(`\n${checks} totales verificados, ${problems} con diferencia.`);
  console.log(`
Diferencias esperadas:
  - 2023 dic y 2025 (fijos ago/nov/dic, tarjetas nov): la fórmula SUMA del sheet no llegaba
    a incluir filas agregadas después. El número correcto es el de la app.
  - 2026 fijos (ene a jun, -$275.000 en total): NATI pasó de gastos fijos a variables
    (Casa / Limpieza) porque se paga por visita. El gasto total del mes no cambió.`);
}

if (require.main === module) main();

