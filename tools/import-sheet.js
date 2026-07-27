// Importa el sheet original (tools/source/sheet.md) a la base de datos.
// Uso: npm run import          -> importa si la base está vacía
//      npm run import -- --force  -> borra todo y vuelve a importar
const fs = require('node:fs');
const path = require('node:path');
const store = require('../db');

const MONTHS = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];

// El sheet reutiliza etiquetas de año (hay dos bloques "2022" y dos "2025"), así que
// el año real de cada bloque se fija acá según su contenido.
const BLOCKS = [
  { header: 2, year: 2022, end: 55 },
  { header: 88, year: 2023, end: 161 },
  { header: 164, year: 2026, end: 240 },
  { header: 490, year: 2024, end: 553 },
  { header: 554, year: 2025, end: 631 },
];

// Catálogo de categorías de gastos variables: son las que el sheet usaba como filas en
// 2022/2023 más la lista de referencia de la hoja 2024. Si el detalle de un gasto coincide
// con una de estas, se toma como categoría; si no, el texto queda como subcategoría.
const VARIABLE_CATEGORIES = [
  'ALIMENTO', 'ANDREA', 'AÑO NUEVO', 'CHEZ', 'COMBUSTIBLE', 'COMBUSTIBLE CLIO',
  'COMBUSTIBLE KANGOO', 'COMIDA', 'COMPRA', 'COTTI', 'CUMPLEAÑOS', 'DELIVERY', 'FARMACIA',
  'FERRETERIA', 'GASISTA', 'GNC', 'HORI', 'JARDINERO', 'KIOSCO', 'LEÑA', 'LIMPIEZA',
  'MANTENIMIEN', 'MATERIALES', 'MEDICO', 'MISIONES', 'NAVIDAD', 'OBRA GAS', 'OLA PHONE',
  'OSECAC', 'PACHE', 'PADEL', 'PELUQUERIA', 'PILETA', 'PLOMERO', 'QUINTA', 'SALIDA', 'SOLE',
  'SUPERMERK2', 'VETERINARIA', 'VIAJE BSAS', 'VTV',
];

const UNCATEGORIZED = 'VARIOS';

const CATEGORY_LOOKUP = new Map(VARIABLE_CATEGORIES.map((name) => [normalize(name), name]));

function normalize(text) {
  return String(text)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toUpperCase();
}

/** Separa el detalle del sheet en categoría + subcategoría. */
function splitDetail(detail) {
  const text = String(detail || '').trim();
  const match = CATEGORY_LOOKUP.get(normalize(text));
  if (match) return { category: match, subcategory: '' };
  return { category: UNCATEGORIZED, subcategory: text };
}

const VEHICLE = { header: 458, row: 459, servicesFrom: 462, servicesTo: 474 };
const QUINTA = { header: 361, from: 362, to: 369, totals: 373 };
const TODOS = { from: 379, to: 391 };

function readGrid() {
  const raw = fs.readFileSync(path.join(__dirname, 'source', 'sheet.md'), 'utf8');
  return raw.split('\n').map((line) => {
    const cells = line.split('|');
    if (cells.length > 1) {
      cells.shift();
      cells.pop();
    }
    return cells.map((c) => c.replace(/\\/g, '').trim());
  });
}

/** "$1.234", "-$39.548", "$1.334,83", "1234" -> número. Cualquier otra cosa -> null. */
function parseAmount(value) {
  if (!value) return null;
  const raw = value.replace(/\s/g, '');
  if (!/^-?\$?-?[\d.]*\d(,\d+)?$/.test(raw)) return null;
  const negative = raw.includes('-');
  const digits = raw.replace(/[-$]/g, '');
  const normalized = digits.replace(/\./g, '').replace(',', '.');
  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

function isTotalRow(name) {
  return /TOTAL$/i.test(name.trim());
}

function monthColumns(grid, headerLine) {
  const header = grid[headerLine] || [];
  const cols = [];
  for (const label of MONTHS) {
    const idx = header.findIndex((c) => c.toUpperCase() === label || (label === 'SEP' && c.toUpperCase() === 'SEPT'));
    cols.push(idx);
  }
  if (cols.some((c) => c < 0)) throw new Error(`No pude ubicar los meses en la fila ${headerLine}`);
  return cols;
}

/**
 * Resuelve a qué sección pertenece una etiqueta de la columna 2. Los títulos del sheet
 * ocupan dos filas ("GASTOS / FIJOS", "OTROS / GASTOS", "GASTOS / VARIABLES"), así que
 * miramos la fila anterior y la siguiente para no confundirlos.
 */
function sectionFor(label, nextLabel, prevLabel) {
  const l = label.toUpperCase();
  if (l === 'INGRESOS') return 'ingresos';
  if (l === 'AFIP') return 'afip';
  if (l === 'TARJETAS') return 'tarjetas';
  if (l === 'OTROS') return 'variables';
  if (l === 'GASTOS') {
    if ((prevLabel || '').toUpperCase() === 'OTROS') return null; // segunda línea de "OTROS GASTOS"
    const n = (nextLabel || '').toUpperCase();
    if (n === 'VARIABLES') return 'variables';
    return 'fijos';
  }
  if (l === 'MI GASTO' || l === 'GASTO' || l === 'RESTO') return 'ignore';
  return null;
}

function importYearBlock(grid, block, endLine, stats) {
  const cols = monthColumns(grid, block.header);
  const year = block.year;
  let section = null;
  const rows = [];

  for (let i = block.header + 1; i < endLine; i++) {
    const row = grid[i];
    if (!row || !row.length) continue;
    const label = row[2] || '';
    if (label) {
      const resolved = sectionFor(label, (grid[i + 1] || [])[2], (grid[i - 1] || [])[2]);
      if (resolved) section = resolved === 'ignore' ? null : resolved;
    }
    if (!section) continue;
    rows.push({ i, row, section });
  }

  // --- secciones con grilla mensual ---
  for (const { row, section } of rows) {
    if (section === 'variables') continue;
    const category = (row[3] || '').trim();
    if (!category || isTotalRow(category)) continue;
    store.ensureCategory({ year, section, name: category });
    cols.forEach((col, m) => {
      const amount = parseAmount(row[col]);
      if (amount === null) return;
      store.setCell({ year, section, category, month: m + 1, amount });
      stats.cells++;
    });
  }

  // --- gastos variables ---
  const varRows = rows.filter((r) => r.section === 'variables');
  if (varRows.length) {
    const gridStyle = varRows.some((r) => (r.row[3] || '').trim() && !isTotalRow(r.row[3]));
    if (gridStyle) {
      // 2022 / 2023: los gastos variables están por categoría y mes, como una grilla.
      for (const { row } of varRows) {
        const label = (row[3] || '').trim();
        if (isTotalRow(label)) continue;
        const { category, subcategory } = label ? splitDetail(label) : { category: UNCATEGORIZED, subcategory: '' };
        cols.forEach((col, m) => {
          const amount = parseAmount(row[col]);
          if (amount === null) return;
          store.addMovement({ year, month: m + 1, section: 'variables', category, subcategory, amount, paid: true });
          stats.variables++;
        });
      }
    } else {
      // 2024 en adelante: lista libre de importe + detalle por mes.
      const descCol = descriptionColumns(varRows, cols);
      cols.forEach((col, m) => {
        for (const { row } of varRows) {
          const amount = parseAmount(row[col]);
          if (amount === null) continue;
          const detail = descCol[m] >= 0 ? (row[descCol[m]] || '').trim() : '';
          const { category, subcategory } = splitDetail(detail);
          store.addMovement({ year, month: m + 1, section: 'variables', category, subcategory, amount, paid: true });
          stats.variables++;
        }
      });
    }
  }
}

/**
 * En el sheet el detalle de cada gasto variable va en la columna siguiente al importe,
 * pero en un par de meses quedó corrida una columna más. Elegimos la primera columna
 * a la derecha que tenga texto y ningún número.
 */
function descriptionColumns(varRows, cols) {
  const hasNumbers = (c) => varRows.some(({ row }) => parseAmount(row[c]) !== null);
  const hasText = (c) => varRows.some(({ row }) => (row[c] || '').trim() && parseAmount(row[c]) === null);
  return cols.map((col) => {
    for (const candidate of [col + 1, col + 2]) {
      if (hasText(candidate) && !hasNumbers(candidate)) return candidate;
    }
    return -1;
  });
}

function importVehicle(grid, stats) {
  const row = grid[VEHICLE.row];
  const vehicleId = store.insertRow('vehicles', {
    marca: row[0],
    modelo: row[1],
    anio: row[2],
    km: row[3],
    dominio: row[4],
    motor: row[5],
    chasis: row[6],
    precio_ars: parseAmount(row[7]),
    precio_usd: parseAmount(row[8]),
  });
  stats.vehicles++;

  let pos = 0;
  for (let i = VEHICLE.servicesFrom + 1; i <= VEHICLE.servicesTo; i++) {
    const r = grid[i];
    if (!r || (!r[0] && !r[1])) continue;
    if (/^TOTAL$/i.test((r[0] || '').trim())) continue;
    store.insertRow('services', {
      vehicle_id: vehicleId,
      km: r[0] || '',
      detalle: r[1] || '',
      mes: r[2] || '',
      precio_ars: parseAmount(r[3]),
      mano_obra_ars: parseAmount(r[4]),
      total_usd: parseAmount(r[5]),
      position: pos++,
    });
    stats.services++;
  }

  // Plan de mantenimiento y especificaciones (columnas 7-9 del mismo bloque)
  pos = 0;
  for (let i = VEHICLE.servicesFrom + 1; i <= VEHICLE.servicesTo; i++) {
    const r = grid[i];
    if (!r || !(r[7] || '').trim()) continue;
    store.insertRow('service_plan', {
      vehicle_id: vehicleId,
      item: r[7],
      detalle: r[8] || '',
      extra: r[9] || '',
      position: pos++,
    });
    stats.plan++;
  }
}

function importQuinta(grid, stats) {
  const header = grid[QUINTA.header];
  const rubroCols = [];
  for (let c = 0; c < header.length; c += 2) {
    const name = (header[c] || '').trim();
    if (/^TOTAL/i.test(name)) break; // después de "TOTAL USD" el sheet tiene otra tabla
    if (!name) continue;
    rubroCols.push({ col: c, name });
  }

  let pos = 0;
  for (const { col, name } of rubroCols) {
    for (let i = QUINTA.from; i <= QUINTA.to; i++) {
      const r = grid[i];
      if (!r) continue;
      const detalle = (r[col] || '').trim();
      if (!detalle) continue;
      store.insertRow('quinta_items', {
        rubro: name,
        detalle,
        monto_usd: parseAmount(r[col + 1]),
        position: pos++,
      });
      stats.quinta++;
    }
  }

  pos = 0;
  for (const [col, zona] of [[0, 'Churrasquera'], [4, 'Casa']]) {
    for (let i = TODOS.from; i <= TODOS.to; i++) {
      const r = grid[i];
      if (!r) continue;
      const texto = (r[col] || '').replace(/^-\s*/, '').trim();
      if (!texto) continue;
      store.insertRow('quinta_todos', { zona, texto, hecho: 0, position: pos++ });
      stats.todos++;
    }
  }
}

function main() {
  const force = process.argv.includes('--force');
  const existing = store.db.prepare('SELECT COUNT(*) AS n FROM cells').get().n;
  if (force) {
    const movements = store.db.prepare('SELECT COUNT(*) AS n FROM movements').get().n;
    console.log(`--force borra lo que hay (${existing} celdas, ${movements} movimientos) y reimporta desde el sheet.`);
  }
  if (existing && !force) {
    console.log(`La base ya tiene ${existing} celdas cargadas. Usá "npm run import -- --force" para rehacerla.`);
    return;
  }

  const grid = readGrid();
  const stats = { cells: 0, variables: 0, vehicles: 0, services: 0, plan: 0, quinta: 0, todos: 0 };

  store.transaction(() => {
    if (force) {
      for (const t of ['cells', 'categories', 'movements', 'subcategories', 'services', 'service_plan', 'vehicles', 'quinta_items', 'quinta_todos']) {
        store.db.exec(`DELETE FROM ${t}`);
      }
    }
    for (const block of BLOCKS) {
      importYearBlock(grid, block, Math.min(block.end, grid.length), stats);
    }
    importVehicle(grid, stats);
    importQuinta(grid, stats);
  });

  console.log('Importación lista:');
  console.log(`  celdas mensuales : ${stats.cells}`);
  console.log(`  gastos variables : ${stats.variables}`);
  console.log(`  vehículos        : ${stats.vehicles} (${stats.services} services, ${stats.plan} items de plan)`);
  console.log(`  quinta           : ${stats.quinta} items, ${stats.todos} pendientes`);
  console.log(`  base             : ${store.DB_PATH}`);
}

if (require.main === module) main();

module.exports = { parseAmount, readGrid, BLOCKS, monthColumns };
