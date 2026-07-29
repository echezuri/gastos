'use strict';

const MONTHS = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];

const SECTIONS = [
  { key: 'ingresos', title: 'Ingresos', hint: 'lo que entra', kind: 'ingreso' },
  { key: 'tarjetas', title: 'Tarjetas', hint: 'resúmenes del mes', kind: 'gasto' },
  { key: 'fijos', title: 'Gastos fijos', hint: 'servicios, cuotas y AFIP', kind: 'gasto' },
  { key: 'variables', title: 'Gastos variables', hint: 'el día a día', kind: 'gasto', ordenarPorMonto: true },
  { key: 'ahorro', title: 'Ahorros', hint: 'sale plata, pero no es gasto', kind: 'gasto', noEsGasto: true },
];

/**
 * Lo que ofrece el formulario para cargar. La grilla puede tener más categorías (las
 * viejas, con datos históricos), pero para cargar sólo aparecen las que están en uso.
 * Las secciones que no figuran acá ofrecen las categorías del año.
 */
const CATEGORIAS_PARA_CARGAR = {
  fijos: ['AFIP', 'Luz monofásica', 'Luz trifásica', 'Gas', 'Internet', 'FX Running', 'Jardín Marco', 'Seguro Cherokee'],
  variables: ['Salud', 'Comida afuera', 'Supermercado y almacén', 'Running', 'Mascotas', 'Vehículos', 'Compras', 'Casa', 'Proyectos'],
};

const HOY = new Date();
/** Índice del mes en curso, sólo si estás mirando el año en curso. */
function mesEnCurso() {
  return state.year === HOY.getFullYear() ? HOY.getMonth() : -1;
}

// Lo que suma al "Gasto total": todo menos ingresos y menos lo que no es consumo.
const SECCIONES_DE_GASTO = SECTIONS.filter((s) => s.kind === 'gasto' && !s.noEsGasto).map((s) => s.key);

const SECTION_TITLE = Object.fromEntries(SECTIONS.map((s) => [s.key, s.title]));
// Orden en que aparecen las categorías en el formulario, de lo más usado a lo menos.
const FORM_ORDER = { gasto: ['variables', 'fijos', 'tarjetas', 'afip', 'ahorro'], ingreso: ['ingresos'] };

/**
 * El almacenamiento del navegador no siempre está disponible: adentro del iframe del
 * Google Sheet puede estar bloqueado y hasta tirar excepción al leerlo. Nunca puede
 * romper la app: si no se puede usar, se sigue sin recordar preferencias.
 */
const almacen = {
  leer(clave, porDefecto = null) {
    try {
      const valor = localStorage.getItem(clave);
      return valor === null ? porDefecto : valor;
    } catch {
      return porDefecto;
    }
  },
  escribir(clave, valor) {
    try {
      localStorage.setItem(clave, valor);
    } catch {
      /* sin memoria entre visitas, pero la app funciona igual */
    }
  },
};

/** Cualquier falla se muestra en pantalla: quedarse en "Cargando…" no dice nada. */
function mostrarFalla(mensaje, detalle, titulo = 'No pude cargar los datos') {
  const app = document.getElementById('app');
  if (!app) return;
  const texto = String(mensaje === null || mensaje === undefined ? '' : mensaje).trim();
  app.replaceChildren(
    el('div', { class: 'falla' }, [
      el('h2', { text: titulo }),
      el('p', { text: texto || 'Error desconocido (mirá la consola del navegador)' }),
      detalle ? el('pre', { text: String(detalle).slice(0, 600) }) : null,
    ])
  );
}

window.addEventListener('error', (e) => mostrarFalla(e.message, e.error && e.error.stack));
window.addEventListener('unhandledrejection', (e) =>
  mostrarFalla((e.reason && e.reason.message) || e.reason, e.reason && e.reason.stack)
);

const state = {
  view: 'anio',
  // Una solapa activa por vista: así ninguna pantalla es una tira larga de tablas.
  tabs: {
    anio: almacen.leer('solapa-anio', 'resumen'),
    auto: almacen.leer('solapa-auto', 'datos'),
    quinta: almacen.leer('solapa-quinta', 'obras'),
  },
  years: [],
  year: null,
  data: null,
  catalog: {},
  subcategories: [],
  vehicles: null,
  quinta: null,
  month: new Date().getMonth() + 1,
  filter: null, // { section, category } cuando mirás el detalle de una celda
  revision: null, // el informe de saneamiento; se pide sólo al abrir la solapa
  desglose: null, // { section, name } de la categoría abierta en el ranking del resumen
};

// ---------------------------------------------------------------- utilidades

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child);
  }
  return node;
}

const nf = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });

function money(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '';
  const rounded = Math.round(n * 100) / 100;
  return `${rounded < 0 ? '-' : ''}$${nf.format(Math.abs(rounded))}`;
}

/** Acepta "1.234.567", "1234,56", "$1.234" y devuelve número o null. */
function parseNumber(text) {
  const raw = String(text ?? '').replace(/[\s$]/g, '');
  if (!raw) return null;
  let normalized = raw;
  if (raw.includes(',')) normalized = raw.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(raw)) normalized = raw.replace(/\./g, '');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function toast(message, isError = false) {
  const node = document.getElementById('toast');
  node.textContent = message;
  node.className = isError ? 'toast error' : 'toast';
  node.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    node.hidden = true;
  }, isError ? 4000 : 1600);
}

/**
 * La app corre en dos lados:
 *   - 'pwa': lo que usás. La lógica corre en el navegador contra Firestore.
 *   - 'servidor': `npm start`, contra la base local en SQLite. Sólo para desarrollar.
 */
const MODO = typeof datosFirebase !== 'undefined' ? 'pwa' : 'servidor';

/**
 * Todo se resuelve en el acto contra la copia en memoria.
 *
 * Lo que se escribe sale para Firestore por atrás, pero la pantalla no lo espera: el
 * documento ya tiene id y la copia local ya está al día.
 */
function apiLocal(method, url, body) {
  const respuesta = JSON.parse(llamarApi(method, url, body || null));
  if (respuesta && respuesta.error) throw new Error(respuesta.error);
  return respuesta;
}

async function api(method, url, body) {
  if (MODO === 'pwa') return apiLocal(method, url, body);
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    mostrarLogin();
    throw new Error('Sesión vencida');
  }
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

// ---------------------------------------------------------------- cola offline

/**
 * Lo que cargás sin conexión queda guardado en el teléfono y se sube solo cuando
 * vuelve la señal. Es la razón de ser del ícono en el escritorio: poder anotar el
 * gasto en el momento, en el super o en la estación de servicio.
 */
const COLA = 'gastos-pendientes-de-subir';

function leerCola() {
  try {
    return JSON.parse(almacen.leer(COLA, '[]'));
  } catch {
    return [];
  }
}

function guardarCola(lista) {
  almacen.escribir(COLA, JSON.stringify(lista));
  pintarAvisoCola();
}

function encolar(movimiento) {
  const lista = leerCola();
  lista.push({ ...movimiento, guardadoEn: new Date().toISOString() });
  guardarCola(lista);
}

async function sincronizarCola({ silencioso = true } = {}) {
  const lista = leerCola();
  if (!lista.length) return 0;
  if (!navigator.onLine) return 0;
  const quedan = [];
  let subidos = 0;
  for (const movimiento of lista) {
    try {
      const { guardadoEn, ...datos } = movimiento;
      await api('POST', '/api/movements', datos);
      subidos++;
    } catch (err) {
      if (err.message === 'Sesión vencida') return subidos; // la cola se conserva
      quedan.push(movimiento);
    }
  }
  guardarCola(quedan);
  if (subidos && !silencioso) toast(`${subidos} movimiento(s) sincronizado(s)`);
  if (subidos && state.data) await refreshAll();
  return subidos;
}

function pintarAvisoCola() {
  const pendientes = leerCola().length;
  let aviso = document.getElementById('aviso-cola');
  if (!pendientes) {
    aviso?.remove();
    return;
  }
  if (!aviso) {
    aviso = el('button', {
      id: 'aviso-cola',
      class: 'aviso-cola',
      onclick: () => sincronizarCola({ silencioso: false }),
    });
    document.body.append(aviso);
  }
  aviso.textContent = `${pendientes} sin subir · tocá para reintentar`;
}

function sum(list) {
  return list.reduce((acc, n) => acc + (Number(n) || 0), 0);
}

function amountCell(value, extraClass = '') {
  const n = Number(value) || 0;
  const cls = n < 0 ? 'neg' : n === 0 ? 'zero' : '';
  return el('td', { class: `num ${cls} ${extraClass}`.trim(), text: n === 0 ? '–' : money(n) });
}

/** Marca la columna del mes en curso, para ubicarse de un vistazo. */
const claseMes = (indice) => (indice === mesEnCurso() ? 'mes-actual' : '');

const categoriesOf = (section) => state.data.sections[section]?.categories || [];

// ---------------------------------------------------------------- grilla

function sectionTotals(section) {
  const cats = categoriesOf(section);
  return MONTHS.map((_, m) => sum(cats.map((c) => c.months[m])));
}

function renderSummary() {
  const totals = Object.fromEntries(SECTIONS.map((s) => [s.key, sectionTotals(s.key)]));
  const gasto = MONTHS.map((_, m) => sum(SECCIONES_DE_GASTO.map((key) => totals[key][m])));
  const resto = MONTHS.map((_, m) => totals.ingresos[m] - gasto[m]);
  const hayAhorro = sum(totals.ahorro) !== 0;

  const rows = [
    { label: 'Ingresos', values: totals.ingresos, tab: 'ingresos', tone: 'income', key: true },
    { label: 'Tarjetas', values: totals.tarjetas, tab: 'tarjetas' },
    { label: 'Gastos fijos', values: totals.fijos, tab: 'fijos' },
    { label: 'Gastos variables', values: totals.variables, tab: 'variables' },
    { label: 'Total', values: gasto, strong: true, key: true },
    { label: 'Resto', values: resto, strong: true, key: true },
    { label: 'Ahorros', values: totals.ahorro, tab: 'ahorro', tone: 'aparte' },
  ];

  const ingresosAnio = sum(totals.ingresos);
  const share = (value) =>
    ingresosAnio ? `${((value / ingresosAnio) * 100).toFixed(1).replace('.', ',')}%` : '–';

  const table = el('table', { class: 'summary' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { class: 'col-label', text: 'Resumen' }),
        ...MONTHS.map((m, i) => el('th', { class: claseMes(i), text: m })),
        el('th', { class: 'year-col', text: 'Año' }),
        el('th', { class: 'pct-col', title: 'Sobre el total de ingresos del año', text: '%' }),
      ]),
    ]),
    el(
      'tbody',
      {},
      rows.map((row) =>
        el('tr', { class: `${row.strong ? 'strong ' : ''}${row.key ? 'is-key ' : ''}row-${row.tone || 'expense'}` }, [
          el('td', { class: 'col-label' }, [
            row.tab
              ? el('button', {
                  class: 'row-link',
                  text: row.label,
                  title: `Ver ${row.label}`,
                  onclick: () => setTab(row.tab, 'anio'),
                })
              : el('span', { class: 'row-link is-static', text: row.label }),
          ]),
          ...row.values.map((v, i) => amountCell(v, claseMes(i))),
          amountCell(sum(row.values), 'year-col'),
          el('td', { class: 'num pct-col', text: share(sum(row.values)) }),
        ])
      )
    ),
  ]);

  const charts = el('div', { class: 'chart-grid' }, [
    chartColumns({
      labels: MONTHS,
      series: [
        { name: 'Ingresos', color: CHART_COLORS.income, values: totals.ingresos },
        { name: 'Gasto', color: CHART_COLORS.expense, values: gasto },
      ],
      width: 940,
      title: `Ingresos y gasto mes a mes · ${state.year}`,
      note: 'la etiqueta marca el mes más alto de cada serie',
    }),
    chartColumns({
      labels: MONTHS,
      series: [{ name: 'Resto', color: CHART_COLORS.income, values: resto }],
      width: 460,
      height: 210,
      colorFor: (v) => (v < 0 ? CHART_COLORS.expense : CHART_COLORS.income),
      title: 'Resto por mes',
      note: 'ingresos − gasto',
    }),
    // Lo que antes estaba repartido en cada sección, junto y comparable
    chartColumns({
      labels: MONTHS,
      series: SECTIONS.filter((s) => s.key !== 'ingresos' && s.key !== 'ahorro').map((s, i) => ({
        name: s.title,
        color: TONOS_SECCION[i % TONOS_SECCION.length],
        values: totals[s.key],
      })),
      width: 940,
      height: 210,
      title: 'Gasto por sección',
      note: 'fijos, tarjetas y variables mes a mes',
    }),
    hayAhorro
      ? chartColumns({
          labels: MONTHS,
          series: [{ name: 'Ahorros', color: CHART_COLORS.neutral, values: totals.ahorro }],
          width: 460,
          height: 210,
          title: 'Ahorros por mes',
          note: 'no suman al gasto',
        })
      : null,
  ]);

  return el('section', { class: 'panel' }, [
    el('div', { class: 'panel-head' }, [
      el('h2', { text: `Resumen ${state.year}` }),
      el('span', { class: 'hint', text: 'gasto = AFIP + fijos + tarjetas + variables' }),
      el('span', { class: 'spacer' }),
      el('span', { class: 'hint', text: 'clic en el nombre de la fila para ir a esa sección' }),
    ]),
    el('div', { class: 'scroll-x' }, [table]),
    charts,
    renderDesglose(),
  ]);
}

// Un tono por sección de gasto, para poder compararlas en un mismo gráfico.
const TONOS_SECCION = ['var(--chart-expense)', 'var(--chart-neutral)', 'var(--chart-warm)'];

/**
 * Ranking de gasto por categoría y, al elegir una, por subcategoría.
 *
 * El desglose fino sale de los movimientos: lo que está cargado a mano en la grilla es un
 * monto suelto por mes y no tiene subcategoría, así que aparece como "Sin subcategoría".
 */
function renderDesglose() {
  const categorias = SECCIONES_DE_GASTO.flatMap((key) =>
    categoriesOf(key).map((c) => ({ section: key, name: c.name, total: sum(c.months), subs: c.subs || {} }))
  )
    .filter((c) => c.total !== 0)
    .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));

  if (!categorias.length) return null;

  const elegida = categorias.findIndex(
    (c) => state.desglose && c.section === state.desglose.section && c.name === state.desglose.name
  );

  const graficos = [
    chartBars({
      items: categorias.map((c) => ({ label: c.name, value: c.total })),
      width: 470,
      title: `Gasto por categoría · ${state.year}`,
      note: 'clic para abrir sus subcategorías',
      selected: elegida >= 0 ? elegida : null,
      onSelect: (i, item) => {
        const igual = state.desglose && state.desglose.name === item.label;
        state.desglose = igual ? null : { section: categorias[i].section, name: categorias[i].name };
        renderYear();
      },
    }),
  ];

  const foco = elegida >= 0 ? categorias[elegida] : null;
  if (foco) {
    const subs = Object.keys(foco.subs)
      .map((name) => ({ label: name, value: foco.subs[name] }))
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    // Lo que no salió de un movimiento no está en subs: se muestra como el resto de la celda
    const enMovimientos = subs.reduce((t, s) => t + s.value, 0);
    const enGrilla = foco.total - enMovimientos;
    if (Math.round(enGrilla) !== 0) subs.push({ label: 'Cargado en la grilla', value: enGrilla });

    graficos.push(
      chartBars({
        items: subs.sort((a, b) => Math.abs(b.value) - Math.abs(a.value)),
        width: 470,
        title: `${foco.name} por subcategoría`,
        note: subs.length ? 'clic de nuevo en la categoría para cerrar' : 'esta categoría no tiene subcategorías',
      })
    );
  }

  return el('div', { class: 'chart-grid' }, graficos);
}

function findCategory(section, name) {
  return categoriesOf(section).find((c) => c.name === name);
}

/** Celda editable: escribe el monto cargado a mano en la grilla. */
function cellInput(section, category, monthIndex, value) {
  const input = el('input', {
    class: 'cell-input' + (value === null || value === undefined ? ' is-empty' : ''),
    type: 'text',
    inputmode: 'decimal',
    value: value === null || value === undefined ? '' : money(value),
    dataset: { section, category, month: String(monthIndex + 1) },
  });

  input.addEventListener('focus', () => {
    const cat = findCategory(section, category);
    if (!cat) return; // la grilla cambió abajo del input: no lo tocamos
    const raw = cat.base[monthIndex];
    input.value = raw === null || raw === undefined ? '' : String(raw);
    input.classList.remove('is-empty');
    input.select();
  });

  input.addEventListener('blur', async () => {
    // Un input que ya salió del DOM (por un re-render) no puede guardar nada: si no,
    // un cambio de solapa mientras editás termina borrando la celda.
    const cat = findCategory(section, category);
    if (!input.isConnected || !cat) return;
    const parsed = parseNumber(input.value);
    const previous = cat.base[monthIndex];
    if (parsed === previous) {
      input.value = previous === null || previous === undefined ? '' : money(previous);
      input.classList.toggle('is-empty', previous === null || previous === undefined);
      return;
    }
    try {
      await apiMutar('PUT', '/api/cell', {
        year: state.year,
        section,
        category,
        month: monthIndex + 1,
        amount: parsed,
      });
      await loadYear(state.year);
    } catch (err) {
      toast(err.message, true);
      input.value = previous === null || previous === undefined ? '' : money(previous);
    }
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      input.blur();
    }
  });

  return input;
}

/** Celda con movimientos: muestra el total y abre el detalle. */
function cellDetail(section, category, monthIndex, cat) {
  const total = cat.months[monthIndex];
  const pending = cat.pending[monthIndex];
  const header = `${cat.moves[monthIndex]} movimiento(s)${pending ? ` · ${money(pending)} sin pagar` : ''}`;
  const button = el(
    'button',
    {
      class: 'cell-detail' + (Number(total) < 0 ? ' neg' : ''),
      title: [header, ...(cat.tips?.[monthIndex] || [])].join('\n'),
      onclick: async () => {
        state.month = monthIndex + 1;
        state.filter = { section, category };
        state.tabs.anio = 'movimientos';
        almacen.escribir('solapa-anio', 'movimientos');
        await refreshMovements();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      },
    },
    [
      el('span', { text: total ? money(total) : '–' }),
      pending ? el('span', { class: 'pending-dot', text: '•' }) : null,
    ]
  );
  return button;
}

function renderSection({ key, title, hint, ordenarPorMonto }) {
  // En gastos variables interesa ver primero lo que más pesa en el año.
  const categories = ordenarPorMonto
    ? [...categoriesOf(key)].sort((a, b) => sum(b.months) - sum(a.months))
    : categoriesOf(key);

  const body = el(
    'tbody',
    {},
    categories.map((cat) =>
      el('tr', {}, [
        el('td', { class: 'col-label' }, [
          el('div', { class: 'label-cell' }, [
            categoryNameInput(key, cat.name),
            el('div', { class: 'row-actions' }, [
              ordenarPorMonto
                ? null
                : el('button', { class: 'icon-btn', title: 'Subir', text: '↑', onclick: () => moveCategory(key, cat.name, 'up') }),
              ordenarPorMonto
                ? null
                : el('button', { class: 'icon-btn', title: 'Bajar', text: '↓', onclick: () => moveCategory(key, cat.name, 'down') }),
              el('button', { class: 'icon-btn', title: 'Mover a otra sección', text: '⇄', onclick: () => moveCategoryToSection(key, cat.name) }),
              el('button', { class: 'icon-btn', title: 'Pasar los montos de la grilla a movimientos', text: '⇣', onclick: () => cellsToMovements(key, cat.name) }),
              el('button', { class: 'icon-btn danger', title: 'Borrar categoría', text: '✕', onclick: () => removeCategory(key, cat.name) }),
            ]),
          ]),
        ]),
        ...MONTHS.map((_, m) =>
          el('td', { class: claseMes(m) }, [
            cat.moves[m] > 0 ? cellDetail(key, cat.name, m, cat) : cellInput(key, cat.name, m, cat.months[m]),
          ])
        ),
        amountCell(sum(cat.months), 'year-col'),
      ])
    )
  );

  const totals = sectionTotals(key);

  const addInput = el('input', { class: 'add-input', type: 'text', placeholder: '+ nueva categoría' });
  addInput.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' || !addInput.value.trim()) return;
    try {
      await apiMutar('POST', '/api/category', { year: state.year, section: key, name: addInput.value.trim() });
    } catch (err) {
      toast(err.message, true);
    }
  });

  return el('section', { class: 'panel' }, [
    el('div', { class: 'panel-head' }, [el('h2', { text: title }), el('span', { class: 'hint', text: hint })]),
    sectionInsights(key, title),
    el('div', { class: 'scroll-x' }, [
      el('table', {}, [
        el('thead', {}, [
          el('tr', {}, [
            el('th', { class: 'col-label', text: 'Categoría' }),
            ...MONTHS.map((m, i) => el('th', { class: claseMes(i), text: m })),
            el('th', { class: 'year-col', text: 'Año' }),
          ]),
        ]),
        body,
        el('tfoot', {}, [
          el('tr', {}, [
            el('td', { class: 'col-label', text: 'Total' }),
            ...totals.map((t, i) => amountCell(t, claseMes(i))),
            amountCell(sum(totals), 'year-col'),
          ]),
          el('tr', { class: 'add-row' }, [el('td', { colspan: String(MONTHS.length + 2) }, [addInput])]),
        ]),
      ]),
    ]),
  ]);
}

/** Los números de una sección. Los gráficos están todos en Resumen. */
function sectionInsights(key, title) {
  const cats = categoriesOf(key);
  const totals = sectionTotals(key);
  const yearTotal = sum(totals);
  const withData = totals.filter((t) => t !== 0);
  const peak = totals.indexOf(Math.max(...totals));

  const ranking = cats
    .map((c) => ({ label: c.name, value: sum(c.months) }))
    .filter((r) => r.value !== 0)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));

  const stats = statRow([
    { label: 'Total del año', value: money(yearTotal) },
    {
      label: 'Promedio mensual',
      value: money(withData.length ? Math.round(yearTotal / withData.length) : 0),
      sub: `${withData.length} mes(es) con datos`,
    },
    yearTotal ? { label: 'Mes más alto', value: MONTHS[peak], sub: money(totals[peak]) } : null,
    ranking.length ? { label: 'Categoría más alta', value: ranking[0].label, sub: money(ranking[0].value) } : null,
  ]);

  // Los gráficos viven todos en Resumen: acá quedan los números, que son los que se miran
  // sin levantar la vista de la tabla.
  return stats;
}

function categoryNameInput(section, name) {
  const input = el('input', { class: 'label-input', type: 'text', value: name });
  input.addEventListener('blur', async () => {
    const to = input.value.trim();
    if (!to || to === name) {
      input.value = name;
      return;
    }
    try {
      await apiMutar('PATCH', '/api/category', { year: state.year, section, from: name, to });
    } catch (err) {
      toast(err.message, true);
      input.value = name;
    }
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
  });
  return input;
}

async function moveCategory(section, name, direction) {
  try {
    await apiMutar('PATCH', '/api/category', { year: state.year, section, name, direction });
  } catch (err) {
    toast(err.message, true);
  }
}

/**
 * Un modal chico para lo que no se resuelve con un confirm(): elegir una sección, repartir
 * subcategorías. Devuelve lo que arme `leer()`, o null si cancelaste.
 */
function dialogo({ titulo, hint, contenido, aceptar = 'Aplicar', leer = () => true }) {
  return new Promise((resolve) => {
    const dlg = el('dialog', { class: 'dialogo' }, [
      el('form', { method: 'dialog' }, [
        el('h2', { class: 'dialogo-titulo', text: titulo }),
        hint ? el('p', { class: 'dialogo-hint', text: hint }) : null,
        el('div', { class: 'dialogo-cuerpo' }, contenido),
        el('div', { class: 'dialogo-pie' }, [
          el('button', { class: 'btn btn-ghost', type: 'button', text: 'Cancelar', onclick: () => { dlg.close(); resolve(null); } }),
          el('button', { class: 'btn btn-accent', type: 'button', text: aceptar, onclick: () => { const v = leer(); dlg.close(); resolve(v); } }),
        ]),
      ]),
    ]);
    dlg.addEventListener('close', () => dlg.remove());
    dlg.addEventListener('cancel', () => resolve(null));
    document.body.append(dlg);
    dlg.showModal();
  });
}

async function moveCategoryToSection(section, name) {
  const opciones = SECTIONS.filter((s) => s.key !== section);
  const select = el('select', { class: 'field-input' }, opciones.map((s) => el('option', { value: s.key, text: s.title })));
  const elegida = await dialogo({
    titulo: `Mover "${name}"`,
    hint: 'Se lleva sus celdas y movimientos, de todos los años. Los totales de cada sección cambian.',
    contenido: [el('label', { class: 'field' }, [el('span', { text: 'A la sección' }), select])],
    aceptar: 'Mover',
    leer: () => select.value,
  });
  if (!elegida) return;
  try {
    await apiMutar('POST', '/api/category/move', { section, name, toSection: elegida });
    toast('Movida');
  } catch (err) {
    toast(err.message, true);
  }
}

/** Pasa las celdas de una categoría a movimientos, con una subcategoría por mes. */
async function cellsToMovements(section, category) {
  const cat = findCategory(section, category);
  const meses = MONTHS.map((_, i) => i).filter((i) => cat && cat.base[i] !== null && cat.base[i] !== 0);
  if (!meses.length) {
    toast('Esta categoría no tiene montos cargados a mano en este año', true);
    return;
  }
  const porDefecto = el('input', { class: 'field-input', type: 'text', placeholder: 'Sueldo' });
  const campos = meses.map((i) =>
    el('label', { class: 'field field-fila' }, [
      el('span', { text: `${MONTHS[i]} · ${money(cat.base[i])}` }),
      el('input', { class: 'field-input', type: 'text', dataset: { mes: String(i + 1) }, placeholder: 'igual que arriba' }),
    ])
  );
  const plan = await dialogo({
    titulo: `Pasar "${category}" a movimientos`,
    hint: `${state.year}: ${meses.length} mes(es). El total de cada mes no cambia; lo que gana es que ahora podés etiquetar cada uno.`,
    contenido: [
      el('label', { class: 'field' }, [el('span', { text: 'Subcategoría para todos' }), porDefecto]),
      ...campos,
    ],
    aceptar: 'Convertir',
    leer: () => ({
      subcategory: porDefecto.value.trim(),
      filas: campos.map((f) => {
        const input = f.querySelector('input');
        return { year: state.year, month: Number(input.dataset.mes), subcategory: input.value.trim() };
      }),
    }),
  });
  if (!plan) return;
  if (!plan.subcategory && plan.filas.every((f) => !f.subcategory)) {
    toast('Poné al menos una subcategoría', true);
    return;
  }
  try {
    const r = await apiMutar('POST', '/api/cells-to-movements', { section, category, ...plan });
    toast(`${r.movimientos} movimiento(s)`);
  } catch (err) {
    toast(err.message, true);
  }
}

async function removeCategory(section, name) {
  const cat = findCategory(section, name);
  const moves = cat ? sum(cat.moves) : 0;
  const extra = moves ? ` y sus ${moves} movimiento(s)` : '';
  if (!confirm(`¿Borrar "${name}"${extra} de ${state.year}?`)) return;
  try {
    await apiMutar('DELETE', '/api/category', { year: state.year, section, name });
  } catch (err) {
    toast(err.message, true);
  }
}

// ---------------------------------------------------------------- pendientes

function renderPending() {
  const pending = state.data.pending;
  if (!pending.length) return null;

  const rows = pending.map((mov) =>
    el('tr', { title: mov.description || '' }, [
      el('td', { class: 'col-label' }, [
        el('span', { class: 'plain-label', text: `${MONTHS[mov.month - 1]}${mov.day ? ` ${mov.day}` : ''}` }),
      ]),
      el('td', { style: 'text-align:left' }, [el('span', { class: 'plain-label', text: mov.category })]),
      el('td', { style: 'text-align:left' }, [
        el('span', { class: 'plain-label' + (mov.description ? ' has-note' : ''), text: mov.subcategory || '—' }),
      ]),
      amountCell(mov.amount),
      el('td', { class: 'num' }, [
        el('button', {
          class: 'btn btn-small',
          text: 'Marcar pagado',
          onclick: async () => {
            await apiMutar('PUT', `/api/movements/${mov.id}`, { paid: true });
            toast('Pagado');
          },
        }),
        el('button', {
          class: 'icon-btn danger',
          text: '✕',
          title: 'Borrar',
          onclick: async () => {
            await apiMutar('DELETE', `/api/movements/${mov.id}`);
          },
        }),
      ]),
    ])
  );

  return el('section', { class: 'panel panel-pending' }, [
    el('div', { class: 'panel-head' }, [
      el('h2', { text: 'Sin pagar' }),
      el('span', { class: 'hint', text: `${pending.length} movimiento(s) · ${money(sum(pending.map((p) => p.amount)))} · no suman a los totales` }),
    ]),
    el('div', { class: 'scroll-x' }, [el('table', {}, [el('tbody', {}, rows)])]),
  ]);
}

// ---------------------------------------------------------------- revisión

/**
 * Qué hay para sanear, mirando todos los años juntos. Sólo mira: no cambia nada.
 *
 * El resto de la app trabaja de a un año, así que sola no puede ver que "INTERNET" de 2022
 * y "Internet" de 2025 son la misma cosa. El informe lo arma la lógica compartida.
 */
let pidiendoRevision = false;

async function cargarRevision() {
  if (pidiendoRevision) return;
  pidiendoRevision = true;
  try {
    state.revision = await api('GET', '/api/revision');
    renderYear();
  } catch (err) {
    toast(err.message, true);
  } finally {
    pidiendoRevision = false;
  }
}

/** Mete todas las variantes de un grupo adentro de la que elegiste. */
async function fusionarGrupo(grupo, gana) {
  const pierden = grupo.options.filter((o) => o !== gana);
  const otras = pierden.map((o) => `"${o.name}"`).join(' y ');
  if (!confirm(`¿Fusionar ${otras} adentro de "${gana.name}"?\n\nSe llevan sus celdas y movimientos de todos los años. Los totales de cada mes no cambian.`)) return;
  try {
    for (const o of pierden) {
      // Si quedó en otra sección, primero se acomoda: la fusión trabaja adentro de una sola
      if (o.section !== gana.section) {
        await api('POST', '/api/category/move', { section: o.section, name: o.name, toSection: gana.section });
      }
      await api('POST', '/api/category/merge', { section: gana.section, from: o.name, to: gana.name });
    }
    await refreshAll();
    toast(`Quedó "${gana.name}"`);
  } catch (err) {
    toast(err.message, true);
  }
}

async function borrarSubcategorias(section, category, name) {
  const que = name ? `la subcategoría "${name}"` : `las ${'subcategorías'} de "${category}"`;
  if (!confirm(`¿Borrar ${que}?\n\nSólo se va del catálogo: los movimientos no se tocan.`)) return;
  try {
    const r = await apiMutar('DELETE', '/api/subcategory', { section, category, name });
    toast(`${r.borradas} borrada(s)`);
  } catch (err) {
    toast(err.message, true);
  }
}

/** Un campo que renombra al salir, y vuelve atrás si el nombre no se pudo aplicar. */
function campoRenombrar(valor, alGuardar, ancho = '100%') {
  const input = el('input', { class: 'label-input', type: 'text', value: valor, style: `width:${ancho}` });
  input.addEventListener('blur', async () => {
    const nuevo = input.value.trim();
    if (!nuevo || nuevo === valor) {
      input.value = valor;
      return;
    }
    try {
      await alGuardar(nuevo);
      toast('Renombrado');
    } catch (err) {
      input.value = valor;
      toast(err.message, true);
    }
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
  });
  return input;
}

/** Mete una categoría dentro de otra: los gastos se mudan y la vieja desaparece. */
async function mudarCategoria(cat, catalogo) {
  const destinos = catalogo.filter((c) => !(c.section === cat.section && c.name === cat.name));
  const select = el(
    'select',
    { class: 'field-input' },
    destinos.map((c) => el('option', { value: `${c.section}|${c.name}`, text: `${SECTION_TITLE[c.section] || c.section} · ${c.name}` }))
  );
  const elegido = await dialogo({
    titulo: `Eliminar "${cat.name}"`,
    hint: `Sus ${cat.celdas + cat.movs} registro(s) se mudan a la categoría que elijas y después desaparece. Los totales de cada mes no cambian.`,
    contenido: [el('label', { class: 'field' }, [el('span', { text: 'Mover todo a' }), select])],
    aceptar: 'Mover y eliminar',
    leer: () => select.value,
  });
  if (!elegido) return;
  const [seccion, nombre] = elegido.split('|');
  try {
    if (seccion !== cat.section) {
      await api('POST', '/api/category/move', { section: cat.section, name: cat.name, toSection: seccion });
    }
    await api('POST', '/api/category/merge', { section: seccion, from: cat.name, to: nombre });
    await refrescarPantalla();
    toast(`Quedó "${nombre}"`);
  } catch (err) {
    toast(err.message, true);
  }
}

/**
 * El catálogo entero: toda categoría con sus subcategorías y cuánto se usa cada una.
 *
 * Es la pantalla para ordenar los nombres. Renombrar se escribe encima; eliminar siempre
 * pregunta a dónde se mudan los gastos, así no hay forma de perder plata sin querer.
 */
function renderCatalogo(catalogo) {
  if (!catalogo || !catalogo.length) return null;

  const filas = [];
  for (const cat of catalogo) {
    const usos = cat.celdas + cat.movs;
    filas.push(
      el('tr', { class: 'grupo-primero' }, [
        el('td', { class: 'col-label' }, [el('span', { class: 'plain-label', text: SECTION_TITLE[cat.section] || cat.section })]),
        el('td', { style: 'text-align:left' }, [
          campoRenombrar(cat.name, (nuevo) => api('POST', '/api/category/merge', { section: cat.section, from: cat.name, to: nuevo })),
        ]),
        el('td', { class: 'num', text: `${usos} uso(s)` }),
        amountCell(cat.total),
        el('td', { class: 'num actions-cell' }, [
          el('button', { class: 'icon-btn', title: 'Mover a otra sección', text: '⇄', onclick: () => moveCategoryToSection(cat.section, cat.name) }),
          usos
            ? el('button', { class: 'btn btn-small', text: 'Eliminar…', title: 'Mudar sus gastos a otra categoría y eliminarla', onclick: () => mudarCategoria(cat, catalogo) })
            : el('button', {
                class: 'icon-btn danger',
                text: '✕',
                title: 'Eliminar (está vacía)',
                onclick: async () => {
                  for (const anio of cat.years) await api('DELETE', '/api/category', { year: anio, section: cat.section, name: cat.name });
                  await refrescarPantalla();
                  toast('Eliminada');
                },
              }),
        ]),
      ])
    );

    for (const sub of cat.subs) {
      filas.push(
        el('tr', { class: 'fila-sub' }, [
          el('td', { class: 'col-label' }),
          el('td', { style: 'text-align:left' }, [
            el('span', { class: 'sub-marca', text: '└' }),
            sub.name === '—'
              ? el('span', { class: 'plain-label', text: 'sin subcategoría' })
              : campoRenombrar(sub.name, (nuevo) =>
                  api('PATCH', '/api/subcategory', { section: cat.section, category: cat.name, from: sub.name, to: nuevo })
                ),
          ]),
          el('td', { class: 'num', text: sub.movs ? `${sub.movs} mov.` : 'sin uso' }),
          amountCell(sub.total),
          el('td', { class: 'num actions-cell' }, [
            sub.name === '—'
              ? null
              : el('button', {
                  class: 'icon-btn danger',
                  text: '✕',
                  title: sub.movs ? 'Sale del catálogo; los movimientos conservan el texto' : 'Borrar del catálogo',
                  onclick: () => borrarSubcategorias(cat.section, cat.name, sub.name),
                }),
          ]),
        ])
      );
    }
  }

  return el('section', { class: 'panel' }, [
    el('div', { class: 'panel-head' }, [
      el('h2', { text: 'Categorías y subcategorías' }),
      el('span', { class: 'hint', text: `${catalogo.length} categorías · escribí encima para renombrar` }),
    ]),
    el('div', { class: 'scroll-x' }, [el('table', {}, [el('tbody', {}, filas)])]),
  ]);
}

function bloqueRevision(titulo, pista, filas, { tono = '' } = {}) {
  if (!filas.length) return null;
  return el('section', { class: `panel ${tono}`.trim() }, [
    el('div', { class: 'panel-head' }, [
      el('h2', { text: titulo }),
      el('span', { class: 'hint', text: pista }),
    ]),
    el('div', { class: 'scroll-x' }, [el('table', {}, [el('tbody', {}, filas)])]),
  ]);
}

function renderRevision() {
  if (!state.revision) {
    cargarRevision();
    return el('section', { class: 'panel' }, [
      el('div', { class: 'panel-head' }, [el('h2', { text: 'Revisión' }), el('span', { class: 'hint', text: 'Mirando todos los años…' })]),
    ]);
  }

  const { catalogo, parecidas, huerfanas, sinUso, vacias, sinClasificar } = state.revision;
  const bloques = [renderCatalogo(catalogo)];

  // Un grupo por nombre repetido, con una fila por variante: así se ve de un vistazo cuál
  // conviene conservar (la que tiene más años y más movimientos).
  bloques.push(
    bloqueRevision(
      'Nombres repetidos',
      `${parecidas.length} grupo(s) · el mismo concepto escrito de dos maneras`,
      parecidas.flatMap((grupo) =>
        grupo.options.map((o, i) =>
          el('tr', { class: i === 0 ? 'grupo-primero' : '' }, [
            el('td', { class: 'col-label' }, [el('span', { class: 'plain-label', text: i === 0 ? o.section : '' })]),
            el('td', { style: 'text-align:left' }, [el('span', { class: 'plain-label', text: o.name })]),
            el('td', { style: 'text-align:left' }, [el('span', { class: 'plain-label', text: o.years.join(', ') })]),
            el('td', { class: 'num', text: `${o.celdas + o.movs} uso(s)` }),
            amountCell(o.total),
            el('td', { class: 'num' }, [
              // Fusionar el resto del grupo adentro de esta: se elige la que queda, no la
              // que se va, que es como uno lo piensa.
              grupo.options.length > 1
                ? el('button', {
                    class: 'btn btn-small',
                    text: 'Dejar sólo esta',
                    title: `Fusionar ${grupo.options.filter((x) => x !== o).map((x) => `"${x.name}"`).join(' y ')} adentro de "${o.name}"`,
                    onclick: () => fusionarGrupo(grupo, o),
                  })
                : null,
            ]),
          ])
        )
      )
    )
  );

  // Agrupadas por la categoría que no existe: son 100 y pico y todas dicen lo mismo.
  const porCategoria = {};
  huerfanas.forEach((h) => {
    const k = `${h.section}|${h.category}`;
    (porCategoria[k] = porCategoria[k] || []).push(h.name);
  });
  bloques.push(
    bloqueRevision(
      'Subcategorías huérfanas',
      `${huerfanas.length} · cuelgan de una categoría que no existe, no las ve nadie`,
      Object.keys(porCategoria).map((k) => {
        const nombres = porCategoria[k];
        return el('tr', { title: nombres.join(' · ') }, [
          el('td', { class: 'col-label' }, [el('span', { class: 'plain-label', text: k.split('|')[0] })]),
          el('td', { style: 'text-align:left' }, [el('span', { class: 'plain-label', text: k.split('|')[1] })]),
          el('td', { style: 'text-align:left' }, [
            el('span', { class: 'plain-label has-note', text: nombres.slice(0, 4).join(', ') + (nombres.length > 4 ? '…' : '') }),
          ]),
          el('td', { class: 'num', text: `${nombres.length}` }),
          el('td', { class: 'num' }, [
            el('button', {
              class: 'btn btn-small',
              text: 'Borrar todas',
              onclick: () => borrarSubcategorias(k.split('|')[0], k.split('|')[1]),
            }),
          ]),
        ]);
      })
    )
  );

  bloques.push(
    bloqueRevision(
      'Subcategorías sin uso',
      `${sinUso.length} · están en el catálogo pero ningún movimiento las usa`,
      sinUso.map((s) =>
        el('tr', {}, [
          el('td', { class: 'col-label' }, [el('span', { class: 'plain-label', text: s.section })]),
          el('td', { style: 'text-align:left' }, [el('span', { class: 'plain-label', text: s.category })]),
          el('td', { style: 'text-align:left' }, [el('span', { class: 'plain-label', text: s.name })]),
          el('td', { class: 'num' }, [
            el('button', { class: 'btn btn-small', text: 'Borrar', onclick: () => borrarSubcategorias(s.section, s.category, s.name) }),
          ]),
        ])
      )
    )
  );

  bloques.push(
    bloqueRevision(
      'Categorías vacías',
      `${vacias.length} · declaradas, sin una sola celda ni movimiento`,
      vacias.map((v) =>
        el('tr', {}, [
          el('td', { class: 'col-label' }, [el('span', { class: 'plain-label', text: v.section })]),
          el('td', { style: 'text-align:left' }, [el('span', { class: 'plain-label', text: v.name })]),
          el('td', { style: 'text-align:left' }, [el('span', { class: 'plain-label', text: v.years.join(', ') })]),
          el('td', { class: 'num' }, [
            // No tiene nada adentro: se puede borrar sin preguntar por los movimientos
            el('button', {
              class: 'btn btn-small',
              text: 'Borrar',
              onclick: async () => {
                try {
                  for (const anio of v.years) {
                    await api('DELETE', '/api/category', { year: anio, section: v.section, name: v.name });
                  }
                  await refreshAll();
                  toast('Borrada');
                } catch (err) {
                  toast(err.message, true);
                }
              },
            }),
          ]),
        ])
      )
    )
  );

  // 2022-2024 está así a propósito: el sheet viejo marcaba la categoría con el color de la
  // celda y eso no se recuperó. Lo reciente sí se puede acomodar a mano.
  bloques.push(
    bloqueRevision(
      'Sin clasificar',
      'los años viejos están así a propósito; lo reciente se puede acomodar',
      sinClasificar.map((s) =>
        el('tr', {}, [
          el('td', { class: 'col-label' }, [el('span', { class: 'plain-label', text: String(s.year) })]),
          el('td', { style: 'text-align:left' }, [
            el('span', { class: 'plain-label', text: s.year >= 2025 ? 'se puede acomodar a mano' : 'no se puede recuperar (venía por color de celda)' }),
          ]),
          el('td', { class: 'num', text: `${s.movs} movimiento(s)` }),
        ])
      )
    )
  );

  const hay = bloques.filter(Boolean);
  if (!hay.length) {
    return el('section', { class: 'panel' }, [
      el('div', { class: 'panel-head' }, [
        el('h2', { text: 'Revisión' }),
        el('span', { class: 'hint', text: 'No encontré nada para revisar.' }),
      ]),
    ]);
  }
  return el('div', {}, hay);
}

// ---------------------------------------------------------------- movimientos del mes

let movementsCache = { key: null, list: [] };

async function loadMovements() {
  const params = new URLSearchParams({ year: String(state.year), month: String(state.month) });
  if (state.filter) {
    params.set('section', state.filter.section);
    params.set('category', state.filter.category);
  }
  const key = params.toString();
  const { movements } = await api('GET', `/api/movements?${key}`);
  movementsCache = { key, list: movements };
  return movements;
}

function renderMovements() {
  const month = state.month;
  const filter = state.filter;

  const chips = MONTHS.map((label, i) =>
    el(
      'button',
      {
        class: 'month-chip' + (i + 1 === month ? ' is-active' : ''),
        onclick: async () => {
          state.month = i + 1;
          await refreshMovements();
        },
      },
      [el('span', { text: label })]
    )
  );

  const list = movementsCache.list;

  const rows = list.map((mov) => {
    const day = el('input', { class: 'day-input', type: 'text', inputmode: 'numeric', value: mov.day ?? '', placeholder: '–' });
    day.addEventListener('blur', () => saveMovement(mov, { day: parseNumber(day.value) }));

    const category = el('select', { class: 'row-select' }, categoryOptions(mov.kind, `${mov.section}|${mov.category}`));
    category.addEventListener('change', () => {
      const [section, cat] = category.value.split('|');
      saveMovement(mov, { section, category: cat });
    });

    const sub = el('input', {
      class: 'desc-input',
      type: 'text',
      value: mov.subcategory,
      placeholder: 'subcategoría',
    });
    sub.addEventListener('blur', () => saveMovement(mov, { subcategory: sub.value.trim() }));

    // La descripción es una columna más: antes estaba escondida detrás de un ✎ y sólo se
    // veía pasando el mouse, que en el teléfono no existe.
    const note = el('input', {
      class: 'desc-input',
      type: 'text',
      value: mov.description,
      placeholder: '—',
      title: mov.description || '',
    });
    note.addEventListener('blur', () => {
      if (note.value.trim() === mov.description) return;
      saveMovement(mov, { description: note.value.trim() });
    });

    const amount = el('input', { class: 'cell-input', type: 'text', inputmode: 'decimal', value: money(mov.amount) });
    amount.addEventListener('focus', () => {
      amount.value = String(mov.amount);
      amount.select();
    });
    amount.addEventListener('blur', () => {
      const parsed = parseNumber(amount.value);
      if (parsed === null) {
        amount.value = money(mov.amount);
        return;
      }
      saveMovement(mov, { amount: parsed });
    });

    const paid = el('input', { type: 'checkbox', checked: mov.paid ? true : false, title: 'Pagado' });
    paid.addEventListener('change', () => saveMovement(mov, { paid: paid.checked }));

    for (const input of [day, sub, note, amount]) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') input.blur();
      });
    }

    return el('tr', { class: mov.paid ? '' : 'is-pending' }, [
      el('td', {}, [day]),
      el('td', { style: 'text-align:left' }, [category]),
      el('td', { style: 'text-align:left' }, [sub]),
      el('td', { style: 'text-align:left' }, [note]),
      el('td', {}, [amount]),
      el('td', { class: 'num' }, [paid]),
      el('td', { class: 'num actions-cell' }, [
        el('button', {
          class: 'icon-btn danger',
          text: '✕',
          title: 'Borrar',
          onclick: async () => {
            await apiMutar('DELETE', `/api/movements/${mov.id}`);
          },
        }),
      ]),
    ]);
  });

  const head = [
    el('h2', { text: 'Movimientos' }),
    el('span', { class: 'hint', text: filter ? '' : 'lo cargado por formulario' }),
  ];
  if (filter) {
    head.push(
      el('button', {
        class: 'filter-chip',
        text: `${SECTION_TITLE[filter.section]} · ${filter.category} ✕`,
        title: 'Quitar el filtro',
        onclick: async () => {
          state.filter = null;
          await refreshMovements();
        },
      })
    );
  }
  head.push(el('span', { class: 'spacer' }));
  head.push(
    el('button', {
      class: 'btn btn-accent',
      text: '+ Cargar',
      onclick: () => openForm('gasto'),
    })
  );

  const base = filter ? findCategory(filter.section, filter.category)?.base[month - 1] : null;
  const baseRow = filter
    ? el('div', { class: 'base-row' }, [
        el('span', { class: 'hint', text: 'Monto cargado a mano en la grilla:' }),
        (() => {
          const input = el('input', { class: 'add-input', type: 'text', inputmode: 'decimal', value: base === null || base === undefined ? '' : money(base), style: 'width:140px' });
          input.addEventListener('focus', () => {
            input.value = base === null || base === undefined ? '' : String(base);
            input.select();
          });
          input.addEventListener('blur', async () => {
            const parsed = parseNumber(input.value);
            if (parsed === base) return;
            await apiMutar('PUT', '/api/cell', {
              year: state.year,
              section: filter.section,
              category: filter.category,
              month,
              amount: parsed,
            });
          });
          input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') input.blur();
          });
          return input;
        })(),
        el('span', { class: 'hint', text: '(los movimientos de abajo se suman a este monto)' }),
      ])
    : null;

  const total = sum(list.filter((m) => m.paid).map((m) => m.amount));
  const pendingTotal = sum(list.filter((m) => !m.paid).map((m) => m.amount));

  return el('section', { class: 'panel', id: 'movimientos' }, [
    el('div', { class: 'panel-head' }, head),
    el('div', { class: 'months' }, chips),
    baseRow,
    movementInsights(list, month),
    list.length
      ? el('div', { class: 'scroll-x' }, [
          el('table', { class: 'mov-table' }, [
            el('thead', {}, [
              el('tr', {}, [
                el('th', { text: 'Día' }),
                el('th', { style: 'text-align:left', text: 'Categoría' }),
                el('th', { style: 'text-align:left', text: 'Subcategoría' }),
                el('th', { style: 'text-align:left', text: 'Descripción' }),
                el('th', { text: 'Importe' }),
                el('th', { text: 'Pago' }),
                el('th', { text: '' }),
              ]),
            ]),
            el('tbody', {}, rows),
            el('tfoot', {}, [
              el('tr', {}, [
                el('td', { class: 'col-label', text: 'Total' }),
                el('td', {}),
                el('td', { style: 'text-align:left' }, [
                  pendingTotal ? el('span', { class: 'hint', text: `+ ${money(pendingTotal)} sin pagar` }) : null,
                ]),
                el('td', {}),
                amountCell(total),
                el('td', {}),
                el('td', {}),
              ]),
            ]),
          ]),
        ])
      : el('p', { class: 'empty', text: filter ? 'Esta celda no tiene movimientos en el mes.' : 'Todavía no cargaste movimientos en este mes.' }),
  ]);
}

/** Los números del mes que estás mirando en Movimientos. */
function movementInsights(list, month) {
  if (!list.length) return null;
  const paid = list.filter((m) => m.paid);
  const total = sum(paid.map((m) => m.amount));
  const pending = list.filter((m) => !m.paid);
  const biggest = [...list].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))[0];

  // Los gráficos viven todos en Resumen: acá quedan los números del mes que estás mirando.
  return statRow([
    { label: `Total ${MONTHS[month - 1]}`, value: money(total), sub: `${paid.length} movimiento(s)` },
    { label: 'Promedio', value: money(paid.length ? Math.round(total / paid.length) : 0) },
    biggest ? { label: 'El más grande', value: money(biggest.amount), sub: biggest.subcategory || biggest.category } : null,
    pending.length
      ? { label: 'Sin pagar', value: money(sum(pending.map((m) => m.amount))), sub: `${pending.length} movimiento(s)`, tone: 'pending' }
      : null,
  ]);
}

async function saveMovement(mov, patch) {
  try {
    await apiMutar('PUT', `/api/movements/${mov.id}`, patch);
    Object.assign(mov, patch);
  } catch (err) {
    toast(err.message, true);
  }
}

// ---------------------------------------------------------------- formulario

/**
 * Opciones del selector de categoría: primero las que el año ya usa (en el orden de la
 * grilla) y después las de otros años, que se crean solas al guardar el movimiento.
 */
function categoryOptions(kind, selectedValue) {
  const groups = [];
  for (const section of FORM_ORDER[kind] || FORM_ORDER.gasto) {
    const own = categoriesOf(section).map((c) => c.name);
    // Si la sección tiene una lista de categorías en uso, se ofrece sólo esa: las viejas
    // siguen existiendo en la grilla pero no ensucian el formulario.
    const activas = CATEGORIAS_PARA_CARGAR[section];
    const names = activas
      ? activas.slice()
      : [...own, ...(state.catalog[section] || []).filter((name) => !own.includes(name))];
    if (!names.length) continue;
    groups.push(
      el(
        'optgroup',
        { label: SECTION_TITLE[section] },
        names.map((name) =>
          el('option', {
            value: `${section}|${name}`,
            text: own.includes(name) ? name : `${name} ·`,
            selected: `${section}|${name}` === selectedValue,
          })
        )
      )
    );
  }
  return groups;
}

function subcategoriesFor(section, category) {
  return state.subcategories
    .filter((s) => s.section === section && s.category === category)
    .map((s) => s.name);
}

const form = {
  kind: 'gasto',
  moneda: 'ARS',
  dialog: null,
};

/** Abre o cierra la parte de abajo del formulario (subcategoría, cuotas, dólares…). */
function mostrarMasOpciones(abrir) {
  const extras = form.dialog.querySelector('#form-extras');
  const boton = form.dialog.querySelector('#form-mas');
  extras.hidden = !abrir;
  boton.textContent = abrir ? 'Menos opciones' : 'Más opciones';
  boton.classList.toggle('is-open', abrir);
  if (abrir) form.dialog.querySelector('#f-sub').focus();
}

function buildForm() {
  const amount = el('input', { id: 'f-amount', class: 'field-input', type: 'text', inputmode: 'decimal', placeholder: '0', autocomplete: 'off' });
  const category = el('select', { id: 'f-category', class: 'field-input' });
  const subcategory = el('input', { id: 'f-sub', class: 'field-input', type: 'text', list: 'f-sub-list', placeholder: 'opcional — escribí una nueva para crearla', autocomplete: 'off' });
  const subList = el('datalist', { id: 'f-sub-list' });
  const description = el('input', { id: 'f-desc', class: 'field-input', type: 'text', placeholder: 'opcional — se ve al pasar el mouse por encima', autocomplete: 'off' });
  const paid = el('input', { id: 'f-paid', type: 'checkbox', checked: true });

  // --- moneda, cuotas y suscripción ---
  const monedaBotones = ['ARS', 'USD'].map((moneda) =>
    el('button', {
      type: 'button',
      class: 'moneda-btn' + (moneda === 'ARS' ? ' is-active' : ''),
      dataset: { moneda },
      text: moneda === 'ARS' ? '$ pesos' : 'US$ dólares',
      onclick: () => setFormMoneda(moneda),
    })
  );
  const cotizacion = el('input', { id: 'f-rate', class: 'field-input', type: 'text', inputmode: 'decimal', placeholder: 'cotización' });
  const cuotas = el('input', { id: 'f-cuotas', class: 'field-input', type: 'number', min: '1', max: '60', value: '1' });
  const suscripcion = el('input', { id: 'f-susc', type: 'checkbox' });
  const resumenSerie = el('small', { id: 'f-serie-info', class: 'field-hint' });

  const actualizarSerie = () => {
    const n = Number(cuotas.value) || 1;
    const esSusc = suscripcion.checked;
    cuotas.disabled = esSusc;
    const monto = parseNumber(form.dialog.querySelector('#f-amount').value);
    if (esSusc) {
      resumenSerie.textContent = 'Se repite todos los meses hasta diciembre.';
    } else if (n > 1) {
      const total = monto ? ` · total ${money(monto * n)}` : '';
      resumenSerie.textContent = `${n} meses seguidos con ese importe${total}.`;
    } else {
      resumenSerie.textContent = '';
    }
  };
  cuotas.addEventListener('input', actualizarSerie);
  suscripcion.addEventListener('change', actualizarSerie);
  amount.addEventListener('input', actualizarSerie);
  const date = el('input', { id: 'f-date', class: 'field-input', type: 'date' });

  const kindButtons = ['gasto', 'ingreso'].map((kind) =>
    el('button', {
      type: 'button',
      class: 'kind-btn' + (kind === form.kind ? ' is-active' : ''),
      dataset: { kind },
      text: kind === 'gasto' ? 'Gasto' : 'Ingreso',
      onclick: () => setFormKind(kind),
    })
  );

  category.addEventListener('change', refreshSubcategoryList);

  // Lo que se usa en casi todas las cargas queda a la vista; el resto se abre solo si lo
  // pedís. Casi siempre alcanza con monto, categoría y fecha.
  const extras = el('div', { class: 'form-extras', id: 'form-extras', hidden: true }, [
    el('div', { class: 'moneda-toggle' }, monedaBotones),
    el('label', { class: 'field', id: 'campo-cotizacion', hidden: true }, [
      el('span', { text: 'Cotización del dólar' }),
      cotizacion,
      el('small', { class: 'field-hint', id: 'f-rate-info' }),
    ]),
    el('label', { class: 'field' }, [el('span', { text: 'Subcategoría' }), subcategory, subList]),
    el('label', { class: 'field' }, [el('span', { text: 'Descripción' }), description]),
    el('div', { class: 'field field-row', id: 'campo-serie' }, [
      el('label', { class: 'check cuotas-field' }, [el('span', { text: 'Cuotas' }), cuotas]),
      el('label', { class: 'check' }, [suscripcion, el('span', { text: 'Suscripción' })]),
    ]),
    resumenSerie,
  ]);

  const verMas = el('button', {
    type: 'button',
    class: 'btn btn-ghost form-mas',
    id: 'form-mas',
    text: 'Más opciones',
    onclick: () => mostrarMasOpciones(extras.hidden),
  });

  const formEl = el('form', { method: 'dialog', onsubmit: (e) => submitForm(e, false) }, [
    el('div', { class: 'kind-toggle' }, kindButtons),
    el('label', { class: 'field' }, [el('span', { text: 'Monto' }), amount]),
    el('label', { class: 'field' }, [
      el('span', { text: 'Categoría' }),
      category,
      el('small', { class: 'field-hint', text: 'las marcadas con · son de otros años; se agregan a este al guardar' }),
    ]),
    el('div', { class: 'field field-row' }, [
      el('label', { class: 'check' }, [paid, el('span', { text: 'Pagado' })]),
      el('label', { class: 'check date-field' }, [el('span', { text: 'Fecha' }), date]),
    ]),
    verMas,
    extras,
    el('footer', { class: 'form-actions' }, [
      el('button', { type: 'button', class: 'btn btn-ghost', text: 'Cancelar', onclick: () => form.dialog.close() }),
      el('span', { class: 'spacer' }),
      el('button', { type: 'button', class: 'btn', text: 'Guardar y seguir', onclick: (e) => submitForm(e, true) }),
      el('button', { type: 'submit', class: 'btn btn-accent', text: 'Guardar' }),
    ]),
  ]);

  const dialog = el('dialog', { class: 'form-dialog' }, [
    el('h2', { class: 'form-title', text: 'Cargar movimiento' }),
    formEl,
  ]);
  document.body.append(dialog);
  form.dialog = dialog;
  cotizacion.addEventListener('input', actualizarEquivalente);
  amount.addEventListener('input', actualizarEquivalente);
  return dialog;
}

function setFormMoneda(moneda) {
  form.moneda = moneda;
  for (const btn of form.dialog.querySelectorAll('.moneda-btn')) {
    btn.classList.toggle('is-active', btn.dataset.moneda === moneda);
  }
  const campo = form.dialog.querySelector('#campo-cotizacion');
  campo.hidden = moneda !== 'USD';
  if (moneda === 'USD') {
    const guardada = almacen.leer('ultima-cotizacion', '');
    const input = form.dialog.querySelector('#f-rate');
    if (!input.value) input.value = guardada;
    actualizarEquivalente();
  }
}

/** Muestra a cuántos pesos equivale lo que estás cargando en dólares. */
function actualizarEquivalente() {
  const info = form.dialog.querySelector('#f-rate-info');
  const usd = parseNumber(form.dialog.querySelector('#f-amount').value);
  const cotiz = parseNumber(form.dialog.querySelector('#f-rate').value);
  info.textContent = usd && cotiz ? `US$${nf.format(usd)} = ${money(usd * cotiz)}` : '';
}

function setFormKind(kind) {
  form.kind = kind;
  for (const btn of form.dialog.querySelectorAll('.kind-btn')) {
    btn.classList.toggle('is-active', btn.dataset.kind === kind);
  }
  form.dialog.classList.toggle('is-income', kind === 'ingreso');
  const category = form.dialog.querySelector('#f-category');
  const remembered = almacen.leer(`ultima-categoria-${kind}`);
  category.replaceChildren(...categoryOptions(kind, remembered));
  if (!category.value && category.options.length) category.selectedIndex = 0;
  refreshSubcategoryList();
}

function refreshSubcategoryList() {
  const category = form.dialog.querySelector('#f-category');
  const list = form.dialog.querySelector('#f-sub-list');
  const [section, name] = (category.value || '|').split('|');
  list.replaceChildren(...subcategoriesFor(section, name).map((s) => el('option', { value: s })));
}

function openForm(kind = 'gasto') {
  if (!form.dialog) buildForm();
  setFormKind(kind);
  const dialog = form.dialog;
  const today = new Date();
  const sameYear = today.getFullYear() === state.year;
  const month = sameYear ? today.getMonth() + 1 : state.month;
  const day = sameYear ? today.getDate() : 1;
  dialog.querySelector('#f-date').value = `${state.year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  dialog.querySelector('#f-amount').value = '';
  dialog.querySelector('#f-sub').value = '';
  dialog.querySelector('#f-desc').value = '';
  dialog.querySelector('#f-paid').checked = true;
  dialog.querySelector('#f-cuotas').value = '1';
  dialog.querySelector('#f-cuotas').disabled = false;
  dialog.querySelector('#f-susc').checked = false;
  dialog.querySelector('#f-serie-info').textContent = '';
  setFormMoneda('ARS');
  mostrarMasOpciones(false); // cada carga arranca simple
  dialog.showModal();
  dialog.querySelector('#f-amount').focus();
}

async function submitForm(event, keepOpen) {
  event.preventDefault();
  const dialog = form.dialog;
  const amount = parseNumber(dialog.querySelector('#f-amount').value);
  const categoryValue = dialog.querySelector('#f-category').value;
  if (amount === null) {
    toast('Poné un monto', true);
    dialog.querySelector('#f-amount').focus();
    return;
  }
  if (!categoryValue) {
    toast('Elegí una categoría', true);
    return;
  }
  const [section, category] = categoryValue.split('|');
  const dateValue = dialog.querySelector('#f-date').value;
  const [y, m, d] = dateValue ? dateValue.split('-').map(Number) : [state.year, state.month, null];

  const enDolares = form.moneda === 'USD';
  const cotizacion = parseNumber(dialog.querySelector('#f-rate').value);
  if (enDolares && !cotizacion) {
    toast('Poné a cuánto tomaste el dólar', true);
    dialog.querySelector('#f-rate').focus();
    return;
  }

  const cuotas = Number(dialog.querySelector('#f-cuotas').value) || 1;
  const suscripcion = dialog.querySelector('#f-susc').checked;

  const movimiento = {
    year: y,
    month: m,
    day: d,
    kind: form.kind,
    section,
    category,
    subcategory: dialog.querySelector('#f-sub').value.trim(),
    description: dialog.querySelector('#f-desc').value.trim(),
    currency: enDolares ? 'USD' : 'ARS',
    amount_currency: enDolares ? amount : null,
    rate: enDolares ? cotizacion : null,
    amount,
    paid: dialog.querySelector('#f-paid').checked,
    cuotas,
    suscripcion,
  };

  // Sin conexión no se pierde: queda en la cola del teléfono y sube después.
  // Sólo aplica contra el servidor local: adentro del Sheet la app no abre sin señal, y
  // como PWA se escribe en la copia local, que ya es a prueba de falta de conexión.
  if (MODO === 'servidor' && !navigator.onLine) {
    encolar(movimiento);
    almacen.escribir(`ultima-categoria-${form.kind}`, categoryValue);
    toast(`Guardado sin conexión: ${money(amount)}. Se sube cuando vuelva la señal.`);
    if (keepOpen) {
      dialog.querySelector('#f-amount').value = '';
      dialog.querySelector('#f-sub').value = '';
      dialog.querySelector('#f-desc').value = '';
      dialog.querySelector('#f-amount').focus();
    } else {
      dialog.close();
    }
    return;
  }

  try {
    // Se guarda y se redibuja con lo que devuelve esa misma llamada
    state.filter = null;
    state.tabs.anio = 'movimientos';
    almacen.escribir('solapa-anio', 'movimientos');
    if (state.years.includes(y)) state.year = y;
    state.month = m;
    await apiMutar('POST', '/api/movements', movimiento);
    almacen.escribir(`ultima-categoria-${form.kind}`, categoryValue);
    if (enDolares) almacen.escribir('ultima-cotizacion', String(cotizacion));
    const cuantos = suscripcion ? 13 - m : cuotas;
    const importe = enDolares ? `US$${nf.format(amount)}` : money(amount);
    toast(
      cuantos > 1
        ? `${importe} × ${cuantos} meses guardado`
        : `${form.kind === 'gasto' ? 'Gasto' : 'Ingreso'} de ${importe} guardado`
    );

    document.getElementById('year-select').value = String(state.year);

    if (keepOpen) {
      dialog.querySelector('#f-amount').value = '';
      dialog.querySelector('#f-sub').value = '';
      dialog.querySelector('#f-desc').value = '';
      refreshSubcategoryList();
      dialog.querySelector('#f-amount').focus();
    } else {
      dialog.close();
    }
  } catch (err) {
    // Si el servidor no contesta (se cayó la conexión entre medio), no se pierde
    if (MODO === 'servidor' && err instanceof TypeError) {
      encolar(movimiento);
      toast(`Sin conexión: quedó guardado para subir (${money(amount)})`);
      dialog.close();
      return;
    }
    toast(err.message, true);
  }
}

// ---------------------------------------------------------------- sincronización con el Sheet

// ---------------------------------------------------------------- estado de la conexión

const estado = { entrando: false, cargando: false };

/**
 * El cartelito de arriba a la derecha. Con Firestore casi siempre está en silencio: sólo
 * habla cuando algo no se pudo guardar o cuando te quedaste sin señal.
 */
function pintarEstado() {
  if (MODO !== 'pwa') return;
  let chip = document.getElementById('sincro');
  if (!chip) {
    chip = el('button', { id: 'sincro', class: 'sincro', onclick: () => reintentar() });
    document.querySelector('.topbar-right').prepend(chip);
  }
  const falla = datosFirebase.hayError();
  if (falla) {
    chip.textContent = 'No se guardó';
    chip.className = 'sincro is-error';
    chip.title = `${falla}\n\nTocá para reintentar.`;
  } else if (!navigator.onLine) {
    chip.textContent = 'Sin conexión';
    chip.className = 'sincro is-sin-conexion';
    chip.title = 'Los cambios se guardan cuando vuelva la señal.';
  } else {
    chip.textContent = 'Al día';
    chip.className = 'sincro is-listo';
    chip.title = 'Todo guardado. Lo que cargues en otro dispositivo aparece acá solo.';
  }
}

/** Vuelve a bajar todo y redibuja. Es la salida cuando algo quedó raro. */
async function reintentar() {
  if (estado.cargando) return;
  estado.cargando = true;
  try {
    datosFirebase.olvidarError();
    await datosFirebase.iniciar(FB.sdk, FB.db, refrescarPantalla);
    await refrescarPantalla();
  } catch (err) {
    toast(err.message, true);
  } finally {
    estado.cargando = false;
    pintarEstado();
  }
}

/**
 * Redibuja con lo que hay en memoria. La llama Firestore cada vez que algo cambia, sea
 * cosa tuya o de otro dispositivo.
 *
 * No redibuja si estás escribiendo en un campo o con un diálogo abierto: te comería lo
 * que estás tipeando. El cambio ya está guardado igual; se ve al cerrar.
 */
let redibujoPendiente = false;

async function refrescarPantalla() {
  pintarEstado();
  if (!state.data) return;
  const foco = document.activeElement;
  const escribiendo = foco && ['INPUT', 'SELECT', 'TEXTAREA'].includes(foco.tagName);
  if (document.querySelector('dialog[open]') || escribiendo) {
    redibujoPendiente = true;
    return;
  }
  redibujoPendiente = false;
  state.revision = null;
  state.data = await api('GET', `/api/year/${state.year}`);
  const { years } = await api('GET', '/api/years');
  state.years = years;
  fillYearSelect();
  await loadMovements();
  state.vehicles = null;
  state.quinta = null;
  if (state.view === 'anio') renderYear();
  else if (state.view === 'auto') await loadAuto();
  else await loadQuinta();
}

/** Lo que quedó sin dibujar mientras escribías, apenas soltás el campo. */
function atenderRedibujoPendiente() {
  if (redibujoPendiente) refrescarPantalla();
}

// ---------------------------------------------------------------- backup

/**
 * Guarda todo en un archivo, tal como está en memoria. Con la base en la nube ya no es la
 * red de seguridad que era, pero sirve para llevarse los números a otro lado.
 */
function bajarBackup() {
  const tablas = {};
  for (const coleccion of datosFirebase.COLECCIONES) tablas[coleccion] = datosFirebase.almacen.filas(coleccion);
  const total = Object.values(tablas).reduce((n, f) => n + f.length, 0);
  if (!total) throw new Error('Todavía no hay datos para guardar');

  const nombre = `gastos-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`;
  const url = URL.createObjectURL(
    new Blob([JSON.stringify({ bajado: new Date().toISOString(), tablas }, null, 2)], { type: 'application/json' })
  );
  const a = el('a', { href: url, download: nombre });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return `${nombre} · ${total} registros`;
}

// ---------------------------------------------------------------- entrar

/**
 * La pantalla de entrada.
 *
 * La clave de Firebase viaja en el código y el repositorio es público, así que sola no
 * sirve para nada: las reglas exigen esta cuenta. Sin entrar no se ve ni un número.
 */
function mostrarEntrada(mensaje) {
  if (document.getElementById('entrada')) return;
  const email = el('input', { class: 'field-input', type: 'email', autocomplete: 'username', placeholder: 'tu@mail.com' });
  const clave = el('input', { class: 'field-input', type: 'password', autocomplete: 'current-password', placeholder: 'Clave' });
  const error = el('p', { class: 'login-error', text: mensaje || '' });
  const boton = el('button', { class: 'btn btn-accent login-btn', text: 'Entrar' });

  const entrar = async () => {
    error.textContent = '';
    boton.disabled = true;
    boton.textContent = 'Entrando…';
    try {
      await FB.sdk.signInWithEmailAndPassword(FB.auth, email.value.trim(), clave.value);
      // Lo que sigue lo dispara el aviso de sesión iniciada
    } catch (err) {
      error.textContent = /password|credential|invalid/i.test(err.message)
        ? 'Mail o clave incorrectos.'
        : err.message;
      boton.disabled = false;
      boton.textContent = 'Entrar';
      clave.select();
    }
  };

  boton.addEventListener('click', entrar);
  for (const campo of [email, clave]) {
    campo.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') entrar();
    });
  }

  document.body.append(
    el('div', { id: 'entrada', class: 'login' }, [
      el('div', { class: 'login-caja' }, [
        el('div', { class: 'brand-mark', text: '$' }),
        el('h1', { class: 'login-titulo', text: 'Gastos' }),
        el('label', { class: 'field' }, [el('span', { text: 'Mail' }), email]),
        el('label', { class: 'field' }, [el('span', { text: 'Clave' }), clave]),
        boton,
        error,
      ]),
    ])
  );
  email.focus();
}

function mostrarConfiguracion() {
  const aviso = el('small', { class: 'field-hint' });
  document.body.append(
    el('div', { id: 'config', class: 'login' }, [
      el('div', { class: 'login-caja config-caja' }, [
        el('div', { class: 'brand-mark', text: '$' }),
        el('h1', { class: 'login-titulo', text: 'Configuración' }),
        el('p', { class: 'dialogo-hint', text: `Conectado a ${CONFIG_FIREBASE.projectId} como ${FB.auth.currentUser?.email || '—'}.` }),
        el('button', {
          class: 'btn btn-ghost login-btn',
          text: '💾 Bajar un backup',
          onclick: () => {
            try {
              aviso.textContent = `Listo: ${bajarBackup()}`;
            } catch (err) {
              aviso.textContent = err.message;
            }
          },
        }),
        aviso,
        el('button', {
          class: 'btn btn-ghost login-btn',
          text: 'Cerrar sesión',
          onclick: async () => {
            datosFirebase.dejarDeEscuchar();
            await FB.sdk.signOut(FB.auth);
            location.reload();
          },
        }),
        el('button', {
          class: 'btn btn-ghost login-btn',
          text: 'Cerrar',
          onclick: () => document.getElementById('config').remove(),
        }),
      ]),
    ])
  );
}

function mostrarLogin(mensaje) {
  if (document.getElementById('login')) return;
  const clave = el('input', { id: 'clave', class: 'field-input', type: 'password', autocomplete: 'current-password', placeholder: 'Clave' });
  const error = el('p', { class: 'login-error', text: mensaje || '' });

  const entrar = async () => {
    error.textContent = '';
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clave: clave.value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        error.textContent = data.error || 'No pude entrar';
        clave.select();
        return;
      }
      document.getElementById('login').remove();
      await init();
      await sincronizarCola({ silencioso: false });
    } catch {
      error.textContent = 'No hay conexión con el servidor';
    }
  };

  clave.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') entrar();
  });

  const caja = el('div', { id: 'login', class: 'login' }, [
    el('div', { class: 'login-caja' }, [
      el('div', { class: 'brand-mark', text: '$' }),
      el('h1', { class: 'login-titulo', text: 'Gastos' }),
      clave,
      el('button', { class: 'btn btn-accent login-btn', text: 'Entrar', onclick: entrar }),
      error,
    ]),
  ]);
  document.body.append(caja);
  clave.focus();
}

// ---------------------------------------------------------------- render año

/** Tarjetas de arriba: el año de un vistazo, sin tener que bajar a las tablas. */
function renderKpis() {
  const totals = Object.fromEntries(SECTIONS.map((s) => [s.key, sectionTotals(s.key)]));
  const gasto = MONTHS.map((_, m) => sum(SECCIONES_DE_GASTO.map((key) => totals[key][m])));
  const resto = MONTHS.map((_, m) => totals.ingresos[m] - gasto[m]);
  const m = state.month - 1;
  const pending = state.data.pending;

  const tile = (label, values, cls = '') =>
    el('div', { class: `kpi ${cls}`.trim() }, [
      el('span', { class: 'kpi-label', text: label }),
      el('strong', { class: 'kpi-value', text: money(sum(values)) }),
      el('span', { class: 'kpi-sub', text: `${MONTHS[m]}: ${money(values[m])}` }),
    ]);

  const tiles = [
    tile('Ingresos', totals.ingresos),
    tile('Gasto', gasto),
    tile('Resto', resto, sum(resto) < 0 ? 'is-neg' : 'is-pos'),
  ];

  if (pending.length) {
    tiles.push(
      el(
        'button',
        {
          class: 'kpi kpi-button is-pending',
          title: 'Ver lo que está sin pagar',
          onclick: () => setTab('pendientes', 'anio'),
        },
        [
          el('span', { class: 'kpi-label', text: 'Sin pagar' }),
          el('strong', { class: 'kpi-value', text: money(sum(pending.map((p) => p.amount))) }),
          el('span', { class: 'kpi-sub', text: `${pending.length} movimiento(s)` }),
        ]
      )
    );
  }

  return el('div', { class: 'kpis' }, tiles);
}

/** Solapas de cada vista. Se arman en el momento porque algunas dependen de los datos. */
const TABS = {
  anio: () => {
    if (!state.data) return [];
    const tabs = [
      { key: 'resumen', label: 'Resumen' },
      ...SECTIONS.map((s) => ({ key: s.key, label: s.title })),
      { key: 'movimientos', label: 'Movimientos' },
    ];
    if (state.data.pending.length) {
      tabs.push({ key: 'pendientes', label: 'Sin pagar', badge: state.data.pending.length });
    }
    tabs.push({ key: 'revision', label: 'Revisión' });
    return tabs;
  },
  auto: () => [
    { key: 'datos', label: 'Vehículo' },
    { key: 'services', label: 'Services' },
    { key: 'plan', label: 'Plan' },
  ],
  quinta: () => [
    { key: 'obras', label: 'Obras y costos' },
    { key: 'pendientes', label: 'Pendientes' },
  ],
};

/** La barra superior es fija: el encabezado de las tablas se apoya justo abajo. */
/**
 * Cuánto mide la barra de arriba. La cabecera de las tablas se pega justo debajo.
 *
 * Se vigila en vez de medirse en momentos elegidos: la barra cambia de alto sola —el chip
 * de estado y el engranaje aparecen después, y en el teléfono las solapas se van a otro
 * renglón—. Con una medida vieja la cabecera se clava a media pantalla en vez de arriba.
 */
let vigilanteDeLaBarra = null;

function measureTopbar() {
  const topbar = document.querySelector('.topbar');
  if (!topbar) return;
  const poner = () =>
    document.documentElement.style.setProperty('--topbar-h', `${Math.round(topbar.getBoundingClientRect().height)}px`);
  poner();
  if (!vigilanteDeLaBarra && typeof ResizeObserver !== 'undefined') {
    vigilanteDeLaBarra = new ResizeObserver(poner);
    vigilanteDeLaBarra.observe(topbar);
  }
}

function renderSubtabs() {
  const bar = document.getElementById('subtabs');
  const tabs = TABS[state.view] ? TABS[state.view]() : [];
  if (!tabs.length) {
    bar.replaceChildren();
    bar.hidden = true;
    requestAnimationFrame(measureTopbar);
    return;
  }
  bar.hidden = false;
  requestAnimationFrame(measureTopbar);
  bar.replaceChildren(
    ...tabs.map((tab) =>
      el(
        'button',
        {
          class: 'subtab' + (tab.key === state.tabs[state.view] ? ' is-active' : ''),
          onclick: () => setTab(tab.key),
        },
        [
          el('span', { text: tab.label }),
          tab.badge ? el('span', { class: 'badge', text: String(tab.badge) }) : null,
        ]
      )
    )
  );
}

/**
 * Deslizar el dedo a los costados cambia de solapa, como en cualquier app del teléfono.
 *
 * Sólo cuenta si el gesto fue claramente horizontal: si no, se lleva puesto el scroll de
 * la página y el de las tablas anchas, que también se mueven con el dedo.
 */
function activarSwipe() {
  const MINIMO = 60; // px de recorrido para que cuente
  let x0 = null;
  let y0 = null;
  let dentroDeTabla = false;

  document.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length !== 1) {
        x0 = null;
        return;
      }
      const t = e.touches[0];
      x0 = t.clientX;
      y0 = t.clientY;
      // Una tabla que scrollea a lo ancho se queda con el gesto
      const scroller = e.target.closest?.('.scroll-x, .months, .dialogo-cuerpo');
      dentroDeTabla = Boolean(scroller && scroller.scrollWidth > scroller.clientWidth + 4);
    },
    { passive: true }
  );

  document.addEventListener(
    'touchend',
    (e) => {
      if (x0 === null || dentroDeTabla || document.querySelector('dialog[open]')) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - x0;
      const dy = t.clientY - y0;
      x0 = null;
      if (Math.abs(dx) < MINIMO || Math.abs(dx) < Math.abs(dy) * 1.6) return;

      const solapas = (TABS[state.view] ? TABS[state.view]() : []).map((s) => s.key);
      const i = solapas.indexOf(state.tabs[state.view]);
      const j = i + (dx < 0 ? 1 : -1);
      if (i < 0 || j < 0 || j >= solapas.length) return;
      setTab(solapas[j]);
    },
    { passive: true }
  );
}

function setTab(tab, view = state.view) {
  state.tabs[view] = tab;
  almacen.escribir(`solapa-${view}`, tab);
  if (view !== state.view) return;
  if (view === 'anio') renderYear();
  else if (view === 'auto') renderAuto();
  else renderQuinta();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function activePanel() {
  const tab = state.tabs.anio;
  if (tab === 'resumen') return renderSummary();
  if (tab === 'movimientos') return renderMovements();
  if (tab === 'pendientes') return renderPending() || renderSummary();
  if (tab === 'revision') return renderRevision();
  const section = SECTIONS.find((s) => s.key === tab);
  return section ? renderSection(section) : renderSummary();
}

function renderYear() {
  const app = document.getElementById('app');
  const focused = document.activeElement;
  const focusKey =
    focused && focused.dataset && focused.dataset.section
      ? `${focused.dataset.section}|${focused.dataset.category}|${focused.dataset.month}`
      : null;

  if (state.tabs.anio === 'pendientes' && !state.data.pending.length) state.tabs.anio = 'resumen';
  renderSubtabs();
  app.replaceChildren(renderKpis(), activePanel());

  if (focusKey) {
    const [section, category, month] = focusKey.split('|');
    const target = app.querySelector(
      `input[data-section="${CSS.escape(section)}"][data-category="${CSS.escape(category)}"][data-month="${month}"]`
    );
    if (target) target.focus();
  }

  ubicarGrilla();
}

/**
 * Deja la grilla mostrando el mes en curso, pegado a la columna de categoría.
 *
 * En el teléfono no entran los doce meses, así que la app abre en el que te importa en vez
 * de en enero. Después respeta hasta dónde desplazaste vos: redibujar por un cambio de otro
 * dispositivo no te devuelve al principio.
 */
let scrollDeLaGrilla = null;

function ubicarGrilla() {
  for (const caja of document.querySelectorAll('#app .scroll-x')) {
    if (caja.scrollWidth <= caja.clientWidth) continue; // en pantalla grande entra todo
    const mes = caja.querySelector('th.mes-actual');
    const etiqueta = caja.querySelector('th.col-label');
    if (!mes) continue;
    if (scrollDeLaGrilla !== null) caja.scrollLeft = scrollDeLaGrilla;
    else {
      // Por diferencia de posiciones reales y no por offsetLeft: la columna de categoría
      // está fija encima de la tabla, así que hay que dejarla justo del otro lado o el mes
      // queda debajo de ella.
      const borde = etiqueta ? etiqueta.getBoundingClientRect().right : caja.getBoundingClientRect().left;
      caja.scrollLeft += mes.getBoundingClientRect().left - borde;
    }
    caja.addEventListener('scroll', () => {
      scrollDeLaGrilla = caja.scrollLeft;
    });
  }
}

async function refreshMovements() {
  await loadMovements();
  renderYear();
}

async function refreshAll() {
  state.revision = null;
  state.data = await api('GET', `/api/year/${state.year}`);
  await loadMovements();
  renderYear();
}

/** Toma el estado que vino junto con la respuesta de una escritura. */
function aplicarEstado(estado) {
  if (!estado) return false;
  state.revision = null; // cualquier escritura lo deja viejo: se vuelve a pedir al abrirlo
  if (estado.year) state.data = estado.year;
  if (estado.years) {
    state.years = estado.years;
    const select = document.getElementById('year-select');
    if (select && select.options.length !== estado.years.length) fillYearSelect();
  }
  if (estado.movements) movementsCache = { key: `${state.year}-${state.month}`, list: estado.movements };
  if (estado.catalog) {
    state.catalog = estado.catalog.catalog;
    state.subcategories = estado.catalog.subcategories;
  }
  renderYear();
  return true;
}

/**
 * Escribe y redibuja con lo que devuelve la misma llamada. Contra el Sheet cada ida y
 * vuelta cuesta casi un segundo, así que pedir el estado de nuevo se nota.
 */
async function apiMutar(method, url, body) {
  const vista = { year: state.year, month: state.month };
  if (state.filter) {
    vista.section = state.filter.section;
    vista.category = state.filter.category;
  }
  const respuesta = await api(method, url, { ...(body || {}), vista });
  if (!aplicarEstado(respuesta && respuesta.estado)) await refreshAll();
  return respuesta;
}

// ---------------------------------------------------------------- auto

function textField(label, value, onSave, opts = {}) {
  const input = el('input', { type: 'text', value: value ?? '', placeholder: opts.placeholder || '' });
  input.addEventListener('blur', async () => {
    if ((value ?? '') === input.value) return;
    try {
      await onSave(input.value);
      toast('Guardado');
    } catch (err) {
      toast(err.message, true);
      input.value = value ?? '';
    }
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
  });
  return el('div', { class: 'card-field' }, [el('label', { text: label }), input]);
}

function editableCell(value, onSave, { align = 'right', format = null } = {}) {
  const shown = format ? format(value) : value ?? '';
  const input = el('input', {
    class: align === 'right' ? 'cell-input' : 'desc-input',
    type: 'text',
    value: shown,
  });
  input.addEventListener('focus', () => {
    input.value = value ?? '';
    input.select();
  });
  input.addEventListener('blur', async () => {
    const raw = input.value;
    const next = format ? parseNumber(raw) : raw;
    if ((next ?? '') === (value ?? '')) {
      input.value = shown;
      return;
    }
    try {
      await onSave(next);
    } catch (err) {
      toast(err.message, true);
      input.value = shown;
    }
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
  });
  return el('td', {}, [input]);
}

function renderAuto() {
  const app = document.getElementById('app');
  const tab = state.tabs.auto;
  const panels = { datos: [], services: [], plan: [] };
  const push = (key, node) => panels[key].push(node);

  for (const vehicle of state.vehicles) {
    const saveVehicle = (field, parse) => async (value) => {
      const next = parse ? parse(value) : value;
      await api('PUT', `/api/rows/vehicles/${vehicle.id}`, { [field]: next });
      vehicle[field] = next;
    };

    const gastoArs = sum(vehicle.services.map((s) => (s.precio_ars || 0) + (s.mano_obra_ars || 0)));
    const gastoUsd = sum(vehicle.services.map((s) => s.total_usd));

    push(
      'datos',
      el('section', { class: 'panel' }, [
        el('div', { class: 'panel-head' }, [
          el('h2', { text: `${vehicle.marca} ${vehicle.modelo}`.trim() || 'Vehículo' }),
          el('span', { class: 'hint', text: 'datos del vehículo' }),
        ]),
        statRow([
          { label: 'Kilómetros', value: vehicle.km || '–' },
          { label: 'Valor', value: vehicle.precio_usd ? `US$${nf.format(vehicle.precio_usd)}` : '–' },
          { label: 'Gastado en services', value: money(gastoArs), sub: `US$${nf.format(gastoUsd)}` },
          {
            label: 'Promedio por service',
            value: money(vehicle.services.length ? Math.round(gastoArs / vehicle.services.length) : 0),
            sub: `${vehicle.services.length} registros`,
          },
        ]),
        el('div', { class: 'cards' }, [
          textField('Marca', vehicle.marca, saveVehicle('marca')),
          textField('Modelo', vehicle.modelo, saveVehicle('modelo')),
          textField('Año', vehicle.anio, saveVehicle('anio')),
          textField('KM', vehicle.km, saveVehicle('km')),
          textField('Dominio', vehicle.dominio, saveVehicle('dominio')),
          textField('Motor', vehicle.motor, saveVehicle('motor')),
          textField('Chasis', vehicle.chasis, saveVehicle('chasis')),
          textField('Precio $', vehicle.precio_ars, saveVehicle('precio_ars', parseNumber)),
          textField('Precio US$', vehicle.precio_usd, saveVehicle('precio_usd', parseNumber)),
        ]),
      ])
    );

    const rows = vehicle.services.map((s) => {
      const save = (field) => async (value) => {
        await api('PUT', `/api/rows/services/${s.id}`, { [field]: value });
        s[field] = value;
        renderAuto();
      };
      return el('tr', {}, [
        editableCell(s.km, save('km')),
        editableCell(s.detalle, save('detalle'), { align: 'left' }),
        editableCell(s.mes, save('mes'), { align: 'left' }),
        editableCell(s.precio_ars, save('precio_ars'), { format: money }),
        editableCell(s.mano_obra_ars, save('mano_obra_ars'), { format: money }),
        editableCell(s.total_usd, save('total_usd'), { format: (v) => (v ? `US$${nf.format(v)}` : '') }),
        el('td', { class: 'num' }, [
          el('button', {
            class: 'icon-btn danger',
            text: '✕',
            title: 'Borrar',
            onclick: async () => {
              await api('DELETE', `/api/rows/services/${s.id}`);
              await loadAuto();
            },
          }),
        ]),
      ]);
    });

    const totals = ['precio_ars', 'mano_obra_ars', 'total_usd'].map((f) => sum(vehicle.services.map((s) => s[f])));

    push(
      'services',
      el('section', { class: 'panel' }, [
        el('div', { class: 'panel-head' }, [
          el('h2', { text: 'Services y arreglos' }),
          el('span', { class: 'hint', text: `${vehicle.services.length} registros` }),
        ]),
        el('div', { class: 'scroll-x' }, [
          el('table', {}, [
            el('thead', {}, [
              el('tr', {}, [
                el('th', { text: 'KM' }),
                el('th', { style: 'text-align:left', text: 'Detalle' }),
                el('th', { style: 'text-align:left', text: 'Mes' }),
                el('th', { text: 'Precio' }),
                el('th', { text: 'Mano de obra' }),
                el('th', { text: 'Total US$' }),
                el('th', { text: '' }),
              ]),
            ]),
            el('tbody', {}, rows),
            el('tfoot', {}, [
              el('tr', {}, [
                el('td', { class: 'col-label', text: 'Total' }),
                el('td', {}),
                el('td', {}),
                amountCell(totals[0]),
                amountCell(totals[1]),
                el('td', { class: 'num', text: `US$${nf.format(totals[2])}` }),
                el('td', {}),
              ]),
              el('tr', { class: 'add-row' }, [
                el('td', { colspan: '7' }, [
                  el('button', {
                    class: 'btn',
                    text: '+ service',
                    onclick: async () => {
                      await api('POST', '/api/rows/services', {
                        vehicle_id: vehicle.id,
                        km: '',
                        detalle: '',
                        mes: '',
                        position: vehicle.services.length,
                      });
                      await loadAuto();
                    },
                  }),
                ]),
              ]),
            ]),
          ]),
        ]),
      ])
    );

    if (vehicle.plan.length) {
      push(
        'plan',
        el('section', { class: 'panel' }, [
          el('div', { class: 'panel-head' }, [
            el('h2', { text: 'Plan y especificaciones' }),
            el('span', { class: 'hint', text: 'cada cuánto y con qué' }),
          ]),
          el('div', { class: 'scroll-x' }, [
            el('table', {}, [
              el('thead', {}, [
                el('tr', {}, [
                  el('th', { class: 'col-label', text: 'Item' }),
                  el('th', { style: 'text-align:left', text: 'Detalle' }),
                  el('th', { style: 'text-align:left', text: 'Extra' }),
                  el('th', { text: '' }),
                ]),
              ]),
              el(
                'tbody',
                {},
                vehicle.plan.map((p) => {
                  const save = (field) => async (value) => {
                    await api('PUT', `/api/rows/service_plan/${p.id}`, { [field]: value });
                    p[field] = value;
                  };
                  return el('tr', {}, [
                    editableCell(p.item, save('item'), { align: 'left' }),
                    editableCell(p.detalle, save('detalle'), { align: 'left' }),
                    editableCell(p.extra, save('extra'), { align: 'left' }),
                    el('td', { class: 'num' }, [
                      el('button', {
                        class: 'icon-btn danger',
                        text: '✕',
                        onclick: async () => {
                          await api('DELETE', `/api/rows/service_plan/${p.id}`);
                          await loadAuto();
                        },
                      }),
                    ]),
                  ]);
                })
              ),
              el('tfoot', {}, [
                el('tr', { class: 'add-row' }, [
                  el('td', { colspan: '4' }, [
                    el('button', {
                      class: 'btn',
                      text: '+ item',
                      onclick: async () => {
                        await api('POST', '/api/rows/service_plan', {
                          vehicle_id: vehicle.id,
                          item: 'Nuevo',
                          position: vehicle.plan.length,
                        });
                        await loadAuto();
                      },
                    }),
                  ]),
                ]),
              ]),
            ]),
          ]),
        ])
      );
    }
  }

  push(
    'datos',
    el('section', { class: 'panel' }, [
      el('div', { class: 'panel-head' }, [
        el('span', { class: 'hint', text: '¿Otro vehículo?' }),
        el('span', { class: 'spacer' }),
        el('button', {
          class: 'btn',
          text: '+ vehículo',
          onclick: async () => {
            await api('POST', '/api/rows/vehicles', { marca: 'Nuevo', modelo: '' });
            await loadAuto();
          },
        }),
      ]),
    ])
  );

  renderSubtabs();
  const shown = panels[tab] || panels.datos;
  app.replaceChildren(
    ...(shown.length ? shown : [el('p', { class: 'empty', text: 'Nada cargado todavía.' })])
  );
}

// ---------------------------------------------------------------- quinta

function renderQuinta() {
  const app = document.getElementById('app');
  const { rubros, todos } = state.quinta;

  const total = sum(rubros.flatMap((r) => r.items.map((i) => i.monto_usd)));

  const rubroNodes = rubros.map((rubro) => {
    const subtotal = sum(rubro.items.map((i) => i.monto_usd));
    const items = rubro.items.map((item) => {
      const detalle = el('input', { type: 'text', value: item.detalle });
      detalle.addEventListener('blur', async () => {
        if (detalle.value === item.detalle) return;
        await api('PUT', `/api/rows/quinta_items/${item.id}`, { detalle: detalle.value });
        item.detalle = detalle.value;
      });
      const monto = el('input', { class: 'amount', type: 'text', inputmode: 'decimal', value: item.monto_usd ?? '' });
      monto.addEventListener('blur', async () => {
        const next = parseNumber(monto.value);
        if (next === item.monto_usd) return;
        await api('PUT', `/api/rows/quinta_items/${item.id}`, { monto_usd: next });
        item.monto_usd = next;
        renderQuinta();
      });
      return el('li', {}, [
        detalle,
        monto,
        el('button', {
          class: 'icon-btn danger',
          text: '✕',
          onclick: async () => {
            await api('DELETE', `/api/rows/quinta_items/${item.id}`);
            await loadQuinta();
          },
        }),
      ]);
    });

    return el('div', { class: 'rubro' }, [
      el('h3', {}, [el('span', { text: rubro.rubro }), el('span', { text: `US$${nf.format(subtotal)}` })]),
      el('ul', {}, items),
      el('button', {
        class: 'icon-btn',
        text: '+ item',
        onclick: async () => {
          await api('POST', '/api/rows/quinta_items', { rubro: rubro.rubro, detalle: '', position: 999 });
          await loadQuinta();
        },
      }),
    ]);
  });

  const newRubro = el('input', { class: 'add-input', type: 'text', placeholder: '+ nuevo rubro' });
  newRubro.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' || !newRubro.value.trim()) return;
    await api('POST', '/api/rows/quinta_items', { rubro: newRubro.value.trim(), detalle: '', position: 999 });
    await loadQuinta();
  });

  const zonas = [...new Set(todos.map((t) => t.zona))];
  const todoNodes = zonas.map((zona) =>
    el('div', { class: 'todo-zone' }, [
      el('h3', { text: zona }),
      ...todos
        .filter((t) => t.zona === zona)
        .map((todo) => {
          const check = el('input', { type: 'checkbox', checked: todo.hecho ? true : false });
          const texto = el('input', { type: 'text', value: todo.texto });
          const row = el('div', { class: `todo${todo.hecho ? ' done' : ''}` }, [
            check,
            texto,
            el('button', {
              class: 'icon-btn danger',
              text: '✕',
              onclick: async () => {
                await api('DELETE', `/api/rows/quinta_todos/${todo.id}`);
                await loadQuinta();
              },
            }),
          ]);
          check.addEventListener('change', async () => {
            await api('PUT', `/api/rows/quinta_todos/${todo.id}`, { hecho: check.checked ? 1 : 0 });
            todo.hecho = check.checked ? 1 : 0;
            row.classList.toggle('done', check.checked);
          });
          texto.addEventListener('blur', async () => {
            if (texto.value === todo.texto) return;
            await api('PUT', `/api/rows/quinta_todos/${todo.id}`, { texto: texto.value });
            todo.texto = texto.value;
          });
          return row;
        }),
      el('button', {
        class: 'icon-btn',
        text: '+ pendiente',
        onclick: async () => {
          await api('POST', '/api/rows/quinta_todos', { zona, texto: 'Nuevo pendiente', position: 999 });
          await loadQuinta();
        },
      }),
    ])
  );

  const porRubro = rubros
    .map((r) => ({ label: r.rubro, value: sum(r.items.map((i) => i.monto_usd)), note: `${r.items.length} items` }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);
  const items = sum(rubros.map((r) => r.items.length));

  const obras = el('section', { class: 'panel' }, [
    el('div', { class: 'panel-head' }, [
      el('h2', { text: 'Obras y costos' }),
      el('span', { class: 'hint', text: 'montos en dólares' }),
      el('span', { class: 'spacer' }),
      el('span', { class: 'hint', text: `Total US$${nf.format(total)}` }),
    ]),
    statRow([
      { label: 'Total invertido', value: `US$${nf.format(total)}`, sub: `${items} items en ${rubros.length} rubros` },
      porRubro.length
        ? {
            label: 'Rubro más caro',
            value: porRubro[0].label,
            sub: `US$${nf.format(porRubro[0].value)} · ${Math.round((porRubro[0].value / total) * 100)}% del total`,
          }
        : null,
      porRubro.length
        ? { label: 'Promedio por rubro', value: `US$${nf.format(Math.round(total / porRubro.length))}` }
        : null,
    ]),
    el('div', { class: 'rubro-grid scroll-x' }, rubroNodes),
    el('div', { class: 'add-row', style: 'padding:10px 14px' }, [newRubro]),
  ]);

  const hechos = todos.filter((t) => t.hecho).length;
  const pendientes = el('section', { class: 'panel' }, [
    el('div', { class: 'panel-head' }, [
      el('h2', { text: 'Pendientes' }),
      el('span', { class: 'hint', text: `${todos.length - hechos} sin hacer de ${todos.length}` }),
    ]),
    el('div', { class: 'insights' }, [
      progressBar({ done: hechos, total: todos.length, label: `${hechos} de ${todos.length} tareas hechas` }),
    ]),
    el('div', { class: 'todos scroll-x' }, todoNodes),
  ]);

  renderSubtabs();
  app.replaceChildren(state.tabs.quinta === 'pendientes' ? pendientes : obras);
}

// ---------------------------------------------------------------- carga

async function loadYear(year) {
  state.data = await api('GET', `/api/year/${year}`);
  state.year = year;
  await loadMovements();
  if (state.view === 'anio') renderYear();
}

async function loadCatalog() {
  const { catalog, subcategories } = await api('GET', '/api/catalog');
  state.catalog = catalog;
  state.subcategories = subcategories;
}

async function loadAuto() {
  const { vehicles } = await api('GET', '/api/vehicles');
  state.vehicles = vehicles;
  if (state.view === 'auto') renderAuto();
}

async function loadQuinta() {
  state.quinta = await api('GET', '/api/quinta');
  if (state.view === 'quinta') renderQuinta();
}

async function setView(view) {
  state.view = view;
  for (const tab of document.querySelectorAll('.tab')) {
    tab.classList.toggle('is-active', tab.dataset.view === view);
  }
  const yearOnly = view === 'anio';
  document.querySelector('.year-picker').style.visibility = yearOnly ? 'visible' : 'hidden';
  document.getElementById('new-year').style.visibility = yearOnly ? 'visible' : 'hidden';
  document.getElementById('add-movement').style.visibility = yearOnly ? 'visible' : 'hidden';
  document.getElementById('fab-cargar').hidden = !yearOnly;

  renderSubtabs();
  if (view === 'anio') {
    if (!state.data) await loadYear(state.year);
    else renderYear();
  } else if (view === 'auto') {
    if (!state.vehicles) await loadAuto();
    else renderAuto();
  } else {
    if (!state.quinta) await loadQuinta();
    else renderQuinta();
  }
}

function fillYearSelect() {
  const select = document.getElementById('year-select');
  select.replaceChildren(
    ...state.years.map((y) => el('option', { value: String(y), text: String(y), selected: y === state.year }))
  );
}

async function init() {
  // En el Sheet el respaldo lo hace Google con su historial de versiones
  // El link de backup es del servidor local; en la PWA el backup sale del engranaje
  if (MODO === 'pwa') document.querySelector('a[href="/api/backup"]')?.remove();

  // Una sola llamada trae todo lo que hace falta para dibujar la pantalla.
  const current = new Date().getFullYear();
  const inicio = await api('GET', `/api/bootstrap?year=${current}&month=${state.month}`);
  state.years = inicio.years;
  state.year = inicio.years.includes(current) ? current : inicio.years[inicio.years.length - 1];
  state.data = inicio.year;
  state.catalog = inicio.catalog.catalog;
  state.subcategories = inicio.catalog.subcategories;
  movementsCache = { key: `${state.year}-${state.month}`, list: inicio.movements || [] };
  fillYearSelect();

  // Si no hay datos del año en curso, el que se muestra es otro: hay que pedirlo.
  if (state.year !== current) {
    state.data = await api('GET', `/api/year/${state.year}`);
    await loadMovements();
  }

  document.getElementById('year-select').addEventListener('change', async (e) => {
    state.filter = null;
    await loadYear(Number(e.target.value));
  });

  document.getElementById('tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (tab) setView(tab.dataset.view);
  });

  document.getElementById('add-movement').addEventListener('click', () => openForm('gasto'));
  document.getElementById('fab-cargar').addEventListener('click', () => openForm('gasto'));
  activarSwipe();

  document.getElementById('new-year').addEventListener('click', async () => {
    const last = Math.max(...state.years);
    const next = last + 1;
    if (!confirm(`¿Crear ${next} copiando las categorías de ${last}?`)) return;
    await api('POST', `/api/year/${next}`, { copyFrom: last });
    const { years: updated } = await api('GET', '/api/years');
    state.years = updated;
    state.year = next;
    fillYearSelect();
    await loadYear(next);
    toast(`${next} listo`);
  });

  // Atajo: "n" abre el formulario (salvo que estés escribiendo en un campo).
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'n' || e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (state.view !== 'anio') return;
    e.preventDefault();
    openForm('gasto');
  });

  window.addEventListener('resize', measureTopbar);
  measureTopbar();

  await setView('anio');
}

/** Dibuja la interfaz una vez que hay datos en memoria. */
async function arrancarInterfaz() {
  await init();
  pintarEstado();
}

/**
 * Arranque de la app de verdad. Lo llama firebase.js cuando el SDK terminó de cargar.
 *
 * Firebase recuerda la sesión, así que la pantalla de entrada aparece una sola vez por
 * dispositivo. El resto de las veces entra derecho.
 */
window.arrancarApp = async function (sdk, auth, db) {
  window.FB = { sdk, auth, db };
  // De acá saca las filas la lógica compartida (logica.js). Sin esto no puede leer nada.
  window.ALMACEN = datosFirebase.almacen;

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

  document.getElementById('add-movement')?.insertAdjacentElement(
    'beforebegin',
    el('button', { class: 'btn btn-ghost', title: 'Configuración', text: '⚙', onclick: () => mostrarConfiguracion() })
  );

  // Lo que quedó sin dibujar mientras escribías, apenas soltás el campo
  document.addEventListener('focusout', () => setTimeout(atenderRedibujoPendiente, 0));
  window.addEventListener('online', pintarEstado);
  window.addEventListener('offline', pintarEstado);

  sdk.onAuthStateChanged(auth, async (usuario) => {
    if (!usuario) {
      document.getElementById('app').textContent = '';
      mostrarEntrada();
      return;
    }
    document.getElementById('entrada')?.remove();
    document.getElementById('app').textContent = 'Cargando tus datos…';
    try {
      await datosFirebase.iniciar(sdk, db, refrescarPantalla);
      await arrancarInterfaz();
      if (new URLSearchParams(location.search).get('cargar')) openForm('gasto');
    } catch (err) {
      mostrarFalla(err.message, err.stack, 'No pude leer tus datos');
    }
  });
};

/** Modo servidor local (npm start): sin Firebase, contra SQLite. */
async function arrancarServidor() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  window.addEventListener('online', () => sincronizarCola({ silencioso: false }));
  pintarAvisoCola();

  let sesion = { pideClave: false, autenticado: true };
  try {
    sesion = await (await fetch('/api/session')).json();
  } catch {
    // sin servidor: igual dejamos usar la app para cargar a la cola
  }
  if (sesion.pideClave && !sesion.autenticado) {
    mostrarLogin();
    return;
  }
  await init();
  await sincronizarCola();
  if (new URLSearchParams(location.search).get('cargar')) openForm('gasto');
}

if (MODO === 'servidor') arrancarServidor().catch((err) => mostrarFalla(err.message, err.stack));
