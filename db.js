// Acceso a datos. SQLite embebido en Node (node:sqlite), sin dependencias externas.
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = process.env.GASTOS_DB || path.join(DATA_DIR, 'gastos.db');

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// Secciones de la grilla mensual: una fila por categoría, doce columnas.
// "ahorro" es plata que sale pero no es consumo (dólares, saldos compartidos): se
// registra igual pero no suma al gasto.
// AFIP dejó de ser una sección aparte: es una categoría más de gastos fijos.
const GRID_SECTIONS = ['ingresos', 'fijos', 'tarjetas', 'variables', 'ahorro'];
const INCOME_SECTIONS = ['ingresos'];
const SECTION_KIND = (section) => (INCOME_SECTIONS.includes(section) ? 'ingreso' : 'gasto');

db.exec(`
CREATE TABLE IF NOT EXISTS categories (
  id       INTEGER PRIMARY KEY,
  year     INTEGER NOT NULL,
  section  TEXT    NOT NULL,
  name     TEXT    NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  UNIQUE (year, section, name)
);

-- Montos cargados directo en la grilla (histórico importado y ajustes a mano).
CREATE TABLE IF NOT EXISTS cells (
  id       INTEGER PRIMARY KEY,
  year     INTEGER NOT NULL,
  section  TEXT    NOT NULL,
  category TEXT    NOT NULL,
  month    INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  amount   REAL    NOT NULL,
  UNIQUE (year, section, category, month)
);

-- Movimientos cargados por formulario: suman a la celda de su categoría y mes.
CREATE TABLE IF NOT EXISTS movements (
  id          INTEGER PRIMARY KEY,
  year        INTEGER NOT NULL,
  month       INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  day         INTEGER,
  kind        TEXT    NOT NULL CHECK (kind IN ('gasto', 'ingreso')),
  section     TEXT    NOT NULL,
  category    TEXT    NOT NULL,
  subcategory TEXT    NOT NULL DEFAULT '',
  description TEXT    NOT NULL DEFAULT '',
  -- Lo cargado en dólares se guarda convertido en "amount" (que es siempre pesos)
  -- y además con su importe y cotización originales.
  currency        TEXT NOT NULL DEFAULT 'ARS',
  amount_currency REAL,
  rate            REAL,
  amount      REAL    NOT NULL,
  paid        INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS subcategories (
  id       INTEGER PRIMARY KEY,
  section  TEXT NOT NULL,
  category TEXT NOT NULL,
  name     TEXT NOT NULL,
  UNIQUE (section, category, name)
);

CREATE TABLE IF NOT EXISTS vehicles (
  id         INTEGER PRIMARY KEY,
  marca      TEXT NOT NULL DEFAULT '',
  modelo     TEXT NOT NULL DEFAULT '',
  anio       TEXT NOT NULL DEFAULT '',
  km         TEXT NOT NULL DEFAULT '',
  dominio    TEXT NOT NULL DEFAULT '',
  motor      TEXT NOT NULL DEFAULT '',
  chasis     TEXT NOT NULL DEFAULT '',
  precio_ars REAL,
  precio_usd REAL
);

CREATE TABLE IF NOT EXISTS services (
  id            INTEGER PRIMARY KEY,
  vehicle_id    INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  km            TEXT NOT NULL DEFAULT '',
  detalle       TEXT NOT NULL DEFAULT '',
  mes           TEXT NOT NULL DEFAULT '',
  precio_ars    REAL,
  mano_obra_ars REAL,
  total_usd     REAL,
  position      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS service_plan (
  id         INTEGER PRIMARY KEY,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  item       TEXT NOT NULL DEFAULT '',
  detalle    TEXT NOT NULL DEFAULT '',
  extra      TEXT NOT NULL DEFAULT '',
  position   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS quinta_items (
  id        INTEGER PRIMARY KEY,
  rubro     TEXT NOT NULL,
  detalle   TEXT NOT NULL DEFAULT '',
  monto_usd REAL,
  position  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS quinta_todos (
  id       INTEGER PRIMARY KEY,
  zona     TEXT NOT NULL,
  texto    TEXT NOT NULL,
  hecho    INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_cells_year     ON cells (year);
CREATE INDEX IF NOT EXISTS idx_movements_year ON movements (year, month);
CREATE INDEX IF NOT EXISTS idx_movements_cell ON movements (year, section, category, month);
`);

// Columnas agregadas después de la primera versión: se suman si la base es vieja.
for (const [table, column, definition] of [
  ['movements', 'description', "TEXT NOT NULL DEFAULT ''"],
  ['movements', 'currency', "TEXT NOT NULL DEFAULT 'ARS'"],
  ['movements', 'amount_currency', 'REAL'],
  ['movements', 'rate', 'REAL'],
]) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (columns.length && !columns.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    console.log(`Agregada la columna ${table}.${column}.`);
  }
}

// Rescate de la tabla vieja de gastos variables (versión anterior de la app).
(function migrateLegacyVariables() {
  const exists = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'variables'")
    .get();
  if (!exists) return;
  const pending = db.prepare('SELECT * FROM variables').all();
  if (!pending.length) {
    db.exec('DROP TABLE variables');
    return;
  }
  const insert = db.prepare(`
    INSERT INTO movements (year, month, day, kind, section, category, subcategory, amount, paid, created_at)
    VALUES (?, ?, NULL, 'gasto', 'variables', ?, ?, ?, 1, ?)
  `);
  const now = new Date().toISOString();
  db.exec('BEGIN');
  try {
    for (const row of pending) {
      insert.run(row.year, row.month, 'VARIOS', row.description || '', row.amount, now);
    }
    db.exec('DROP TABLE variables');
    db.exec('COMMIT');
    console.log(`Migrados ${pending.length} gastos variables al nuevo formato de movimientos.`);
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
})();

const q = {
  years: db.prepare(`
    SELECT year FROM (
      SELECT year FROM categories UNION SELECT year FROM cells UNION SELECT year FROM movements
    ) ORDER BY year
  `),
  categories: db.prepare(
    'SELECT section, name, position FROM categories WHERE year = ? ORDER BY section, position, id'
  ),
  cells: db.prepare('SELECT section, category, month, amount FROM cells WHERE year = ?'),
  movementsOfYear: db.prepare('SELECT * FROM movements WHERE year = ? ORDER BY month, day, id'),
  movementsOfCell: db.prepare(`
    SELECT * FROM movements
    WHERE year = ? AND section = ? AND category = ? AND month = ?
    ORDER BY day, id
  `),
  movementsOfMonth: db.prepare('SELECT * FROM movements WHERE year = ? AND month = ? ORDER BY day, id'),
  movementById: db.prepare('SELECT * FROM movements WHERE id = ?'),
  insertMovement: db.prepare(`
    INSERT INTO movements (year, month, day, kind, section, category, subcategory, description,
                           currency, amount_currency, rate, amount, paid, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  updateMovement: db.prepare(`
    UPDATE movements
    SET year = ?, month = ?, day = ?, kind = ?, section = ?, category = ?, subcategory = ?,
        description = ?, currency = ?, amount_currency = ?, rate = ?, amount = ?, paid = ?
    WHERE id = ?
  `),
  deleteMovement: db.prepare('DELETE FROM movements WHERE id = ?'),
  deleteMovementsOfCategory: db.prepare(
    'DELETE FROM movements WHERE year = ? AND section = ? AND category = ?'
  ),
  renameMovements: db.prepare(
    'UPDATE movements SET category = ? WHERE year = ? AND section = ? AND category = ?'
  ),
  upsertCell: db.prepare(`
    INSERT INTO cells (year, section, category, month, amount) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (year, section, category, month) DO UPDATE SET amount = excluded.amount
  `),
  deleteCell: db.prepare(
    'DELETE FROM cells WHERE year = ? AND section = ? AND category = ? AND month = ?'
  ),
  insertCategory: db.prepare(`
    INSERT INTO categories (year, section, name, position) VALUES (?, ?, ?, ?)
    ON CONFLICT (year, section, name) DO NOTHING
  `),
  maxCategoryPos: db.prepare(
    'SELECT COALESCE(MAX(position), -1) AS pos FROM categories WHERE year = ? AND section = ?'
  ),
  renameCategory: db.prepare(
    'UPDATE categories SET name = ? WHERE year = ? AND section = ? AND name = ?'
  ),
  renameCells: db.prepare(
    'UPDATE cells SET category = ? WHERE year = ? AND section = ? AND category = ?'
  ),
  deleteCategory: db.prepare('DELETE FROM categories WHERE year = ? AND section = ? AND name = ?'),
  deleteCategoryCells: db.prepare(
    'DELETE FROM cells WHERE year = ? AND section = ? AND category = ?'
  ),
  setCategoryPos: db.prepare(
    'UPDATE categories SET position = ? WHERE year = ? AND section = ? AND name = ?'
  ),
  allCategories: db.prepare('SELECT DISTINCT section, name FROM categories ORDER BY section, name'),
  subcategories: db.prepare('SELECT section, category, name FROM subcategories ORDER BY name'),
  insertSubcategory: db.prepare(`
    INSERT INTO subcategories (section, category, name) VALUES (?, ?, ?)
    ON CONFLICT (section, category, name) DO NOTHING
  `),
  renameSubcategories: db.prepare(
    'UPDATE subcategories SET category = ? WHERE section = ? AND category = ?'
  ),
  deleteSubcategories: db.prepare('DELETE FROM subcategories WHERE section = ? AND category = ?'),
  vehicles: db.prepare('SELECT * FROM vehicles ORDER BY id'),
  servicesOf: db.prepare('SELECT * FROM services WHERE vehicle_id = ? ORDER BY position, id'),
  planOf: db.prepare('SELECT * FROM service_plan WHERE vehicle_id = ? ORDER BY position, id'),
  quintaItems: db.prepare('SELECT * FROM quinta_items ORDER BY position, id'),
  quintaTodos: db.prepare('SELECT * FROM quinta_todos ORDER BY position, id'),
};

// ---------- lectura ----------

function listYears() {
  const years = q.years.all().map((r) => Number(r.year));
  return years.length ? years : [new Date().getFullYear()];
}

// Cuántos movimientos entran en el globito de ayuda de una celda antes de resumir.
const TIP_LIMIT = 8;

function emptyCategory(name) {
  return {
    name,
    months: Array(12).fill(null), // base + movimientos pagados (lo que se muestra)
    base: Array(12).fill(null), // cargado a mano en la grilla
    moves: Array(12).fill(0), // cantidad de movimientos
    moved: Array(12).fill(0), // suma de los movimientos pagados
    pending: Array(12).fill(0), // suma de lo no pagado
    tips: Array.from({ length: 12 }, () => []), // detalle para el tooltip
  };
}

/** Línea del tooltip: "Chino — pagué con débito: $45.900 (sin pagar)". */
function tipLine(mov) {
  const label = [mov.subcategory, mov.description].filter(Boolean).join(' — ') || 'sin detalle';
  const amount = mov.amount.toLocaleString('es-AR', { maximumFractionDigits: 2 });
  const enDolares =
    mov.currency === 'USD' && mov.amount_currency
      ? ` [US$${mov.amount_currency.toLocaleString('es-AR')} × $${Number(mov.rate).toLocaleString('es-AR')}]`
      : '';
  return `${mov.day ? `${mov.day}. ` : ''}${label}: $${amount}${enDolares}${mov.paid ? '' : ' (sin pagar)'}`;
}

/** Devuelve el año completo: secciones, grilla, movimientos y pendientes. */
function getYear(year) {
  const sections = {};
  for (const s of GRID_SECTIONS) sections[s] = { categories: [] };

  const index = new Map();
  const get = (section, name) => {
    const key = `${section} ${name}`;
    if (!index.has(key)) {
      if (!sections[section]) sections[section] = { categories: [] };
      const cat = emptyCategory(name);
      sections[section].categories.push(cat);
      index.set(key, cat);
    }
    return index.get(key);
  };

  for (const row of q.categories.all(year)) get(row.section, row.name);

  for (const cell of q.cells.all(year)) {
    const cat = get(cell.section, cell.category);
    cat.base[cell.month - 1] = cell.amount;
  }

  const pendingList = [];
  for (const mov of q.movementsOfYear.all(year)) {
    const cat = get(mov.section, mov.category);
    const m = mov.month - 1;
    cat.moves[m]++;
    if (cat.tips[m].length < TIP_LIMIT) cat.tips[m].push(tipLine(mov));
    if (mov.paid) {
      cat.months[m] = (cat.months[m] ?? 0) + mov.amount;
      cat.moved[m] += mov.amount;
    } else {
      cat.pending[m] += mov.amount;
      pendingList.push(mov);
    }
  }

  for (const section of Object.values(sections)) {
    for (const cat of section.categories) {
      for (let m = 0; m < 12; m++) {
        const extra = cat.moves[m] - cat.tips[m].length;
        if (extra > 0) cat.tips[m].push(`y ${extra} más…`);
      }
    }
  }

  for (const section of Object.values(sections)) {
    for (const cat of section.categories) {
      for (let m = 0; m < 12; m++) {
        if (cat.base[m] === null && cat.months[m] === null) continue;
        cat.months[m] = (cat.base[m] ?? 0) + (cat.months[m] ?? 0);
      }
    }
  }

  return { year, sections, pending: pendingList };
}

function getMovements({ year, month, section, category }) {
  if (section && category) return q.movementsOfCell.all(year, section, category, month);
  return q.movementsOfMonth.all(year, month);
}

function listSubcategories() {
  return q.subcategories.all();
}

/** Todas las categorías conocidas, de cualquier año: el formulario ofrece estas. */
function listCatalog() {
  const catalog = Object.fromEntries(GRID_SECTIONS.map((s) => [s, []]));
  for (const row of q.allCategories.all()) {
    if (!catalog[row.section]) catalog[row.section] = [];
    catalog[row.section].push(row.name);
  }
  return catalog;
}

function getVehicles() {
  return q.vehicles.all().map((v) => ({
    ...v,
    services: q.servicesOf.all(v.id),
    plan: q.planOf.all(v.id),
  }));
}

function getQuinta() {
  const items = q.quintaItems.all();
  const rubros = [];
  const byRubro = new Map();
  for (const it of items) {
    if (!byRubro.has(it.rubro)) {
      const r = { rubro: it.rubro, items: [] };
      byRubro.set(it.rubro, r);
      rubros.push(r);
    }
    byRubro.get(it.rubro).items.push(it);
  }
  return { rubros, todos: q.quintaTodos.all() };
}

// ---------- escritura ----------

function setCell({ year, section, category, month, amount }) {
  ensureCategory({ year, section, name: category });
  if (amount === null || amount === undefined || amount === '') {
    q.deleteCell.run(year, section, category, month);
  } else {
    q.upsertCell.run(year, section, category, month, Number(amount));
  }
}

function ensureCategory({ year, section, name }) {
  const pos = q.maxCategoryPos.get(year, section).pos + 1;
  q.insertCategory.run(year, section, name, pos);
}

function renameCategory({ year, section, from, to }) {
  if (from === to) return;
  q.insertCategory.run(year, section, to, q.maxCategoryPos.get(year, section).pos + 1);
  q.deleteCategory.run(year, section, to);
  q.renameCategory.run(to, year, section, from);
  q.renameCells.run(to, year, section, from);
  q.renameMovements.run(to, year, section, from);
  q.renameSubcategories.run(to, section, from);
}

function deleteCategory({ year, section, name }) {
  q.deleteCategoryCells.run(year, section, name);
  q.deleteMovementsOfCategory.run(year, section, name);
  q.deleteCategory.run(year, section, name);
  const stillUsed = db
    .prepare('SELECT 1 FROM categories WHERE section = ? AND name = ? LIMIT 1')
    .get(section, name);
  if (!stillUsed) q.deleteSubcategories.run(section, name);
}

function moveCategory({ year, section, name, direction }) {
  const list = q.categories
    .all(year)
    .filter((c) => c.section === section)
    .map((c) => c.name);
  const i = list.indexOf(name);
  const j = direction === 'up' ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  list.forEach((n, idx) => q.setCategoryPos.run(idx, year, section, n));
}

function normalizeMovement(data) {
  const section = String(data.section || '');
  if (!GRID_SECTIONS.includes(section)) throw new Error('sección inválida');
  const year = Number(data.year);
  const month = Number(data.month);
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new Error('mes inválido');
  const category = String(data.category || '').trim();
  if (!category) throw new Error('falta la categoría');
  const day = data.day === null || data.day === undefined || data.day === '' ? null : Number(data.day);

  // En dólares se guarda el importe original y la cotización, y "amount" queda en pesos.
  const currency = String(data.currency || 'ARS').toUpperCase() === 'USD' ? 'USD' : 'ARS';
  let amount = Number(data.amount);
  let amountCurrency = null;
  let rate = null;
  if (currency === 'USD') {
    amountCurrency = Number(data.amount_currency ?? data.amount);
    rate = Number(data.rate);
    if (!Number.isFinite(amountCurrency)) throw new Error('importe en dólares inválido');
    if (!Number.isFinite(rate) || rate <= 0) throw new Error('falta la cotización del dólar');
    amount = Math.round(amountCurrency * rate * 100) / 100;
  }
  if (!Number.isFinite(amount)) throw new Error('importe inválido');

  return {
    year,
    month,
    day: Number.isInteger(day) && day >= 1 && day <= 31 ? day : null,
    kind: data.kind === 'ingreso' ? 'ingreso' : SECTION_KIND(section),
    section,
    category,
    subcategory: String(data.subcategory || '').trim(),
    description: String(data.description || '').trim(),
    currency,
    amount_currency: amountCurrency,
    rate,
    amount,
    paid: data.paid === false || data.paid === 0 ? 0 : 1,
  };
}

function insertMovement(m) {
  ensureCategory({ year: m.year, section: m.section, name: m.category });
  if (m.subcategory) q.insertSubcategory.run(m.section, m.category, m.subcategory);
  const info = q.insertMovement.run(
    m.year, m.month, m.day, m.kind, m.section, m.category, m.subcategory, m.description,
    m.currency, m.amount_currency, m.rate, m.amount, m.paid, new Date().toISOString()
  );
  return Number(info.lastInsertRowid);
}

/**
 * Un gasto puede generar varios movimientos: en cuotas se repite el importe los meses
 * siguientes, y una suscripción se repite hasta fin de año. El mes rueda al año que viene
 * cuando hace falta.
 */
function addMovement(data) {
  const m = normalizeMovement(data);
  const cuotas = Math.max(1, Math.min(Number(data.cuotas) || 1, 60));
  const suscripcion = data.suscripcion === true || data.suscripcion === 'true';
  const repeticiones = suscripcion ? Math.max(1, 13 - m.month) : cuotas;

  const ids = [];
  for (let i = 0; i < repeticiones; i++) {
    const mesAbsoluto = m.month - 1 + i;
    const cuota = {
      ...m,
      year: m.year + Math.floor(mesAbsoluto / 12),
      month: (mesAbsoluto % 12) + 1,
      description: etiquetaDeSerie(m.description, { suscripcion, cuotas, numero: i + 1 }),
    };
    ids.push(insertMovement(cuota));
  }
  return ids.length === 1 ? ids[0] : ids;
}

function etiquetaDeSerie(descripcion, { suscripcion, cuotas, numero }) {
  if (suscripcion) return [descripcion, '(suscripción)'].filter(Boolean).join(' ');
  if (cuotas > 1) return [descripcion, `(cuota ${numero}/${cuotas})`].filter(Boolean).join(' ');
  return descripcion;
}

function updateMovement(id, data) {
  const current = q.movementById.get(id);
  if (!current) throw new Error('no existe el movimiento');
  const m = normalizeMovement({ ...current, ...data });
  ensureCategory({ year: m.year, section: m.section, name: m.category });
  if (m.subcategory) q.insertSubcategory.run(m.section, m.category, m.subcategory);
  q.updateMovement.run(
    m.year, m.month, m.day, m.kind, m.section, m.category, m.subcategory, m.description,
    m.currency, m.amount_currency, m.rate, m.amount, m.paid, id
  );
}

function deleteMovement(id) {
  q.deleteMovement.run(id);
}

function addSubcategory({ section, category, name }) {
  const clean = String(name || '').trim();
  if (!clean) throw new Error('falta el nombre');
  q.insertSubcategory.run(section, category, clean);
  return clean;
}

/** Copia las categorías de un año al siguiente (sin montos), para arrancar un año nuevo. */
function cloneYearCategories(fromYear, toYear) {
  for (const c of q.categories.all(fromYear)) {
    q.insertCategory.run(toYear, c.section, c.name, c.position);
  }
}

// CRUD genérico y acotado para las tablas simples (auto / quinta)
const EDITABLE = {
  vehicles: ['marca', 'modelo', 'anio', 'km', 'dominio', 'motor', 'chasis', 'precio_ars', 'precio_usd'],
  services: ['vehicle_id', 'km', 'detalle', 'mes', 'precio_ars', 'mano_obra_ars', 'total_usd', 'position'],
  service_plan: ['vehicle_id', 'item', 'detalle', 'extra', 'position'],
  quinta_items: ['rubro', 'detalle', 'monto_usd', 'position'],
  quinta_todos: ['zona', 'texto', 'hecho', 'position'],
};

function insertRow(table, data) {
  const cols = EDITABLE[table].filter((c) => data[c] !== undefined);
  if (!cols.length) throw new Error('sin campos');
  const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
  const info = db.prepare(sql).run(...cols.map((c) => data[c]));
  return Number(info.lastInsertRowid);
}

function updateRow(table, id, data) {
  const cols = EDITABLE[table].filter((c) => data[c] !== undefined);
  if (!cols.length) return;
  const sql = `UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`;
  db.prepare(sql).run(...cols.map((c) => data[c]), id);
}

function deleteRow(table, id) {
  if (!EDITABLE[table]) throw new Error('tabla no editable');
  db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
}

function exportAll() {
  const dump = { exportedAt: new Date().toISOString(), tables: {} };
  const tables = [
    'categories',
    'cells',
    'movements',
    'subcategories',
    'vehicles',
    'services',
    'service_plan',
    'quinta_items',
    'quinta_todos',
  ];
  for (const t of tables) dump.tables[t] = db.prepare(`SELECT * FROM ${t}`).all();
  return dump;
}

function transaction(fn) {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = {
  db,
  DB_PATH,
  GRID_SECTIONS,
  SECTION_KIND,
  listYears,
  getYear,
  getMovements,
  listSubcategories,
  listCatalog,
  getVehicles,
  getQuinta,
  setCell,
  ensureCategory,
  renameCategory,
  deleteCategory,
  moveCategory,
  addMovement,
  updateMovement,
  deleteMovement,
  addSubcategory,
  cloneYearCategories,
  insertRow,
  updateRow,
  deleteRow,
  exportAll,
  transaction,
};
