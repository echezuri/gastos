// Corre la lógica de la app contra un almacén en memoria cargado desde los CSV del sheet
// original, y compara sus respuestas con las de la base local (SQLite).
//
// Es lo que garantiza que mover la base de datos no cambió ni un número.
//
// Uso: node tools/probar-apps-script.js
const fs = require('node:fs');
const path = require('node:path');
const store = require('../db');
const { crearAlmacen, cargarLogica } = require('./almacen-memoria');

// ---------------------------------------------------------------- planilla simulada

function parsearCsv(texto) {
  const filas = [];
  let fila = [];
  let campo = '';
  let entreComillas = false;
  const limpio = texto.replace(/^﻿/, '');
  for (let i = 0; i < limpio.length; i++) {
    const c = limpio[i];
    if (entreComillas) {
      if (c === '"' && limpio[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (c === '"') entreComillas = false;
      else campo += c;
    } else if (c === '"') entreComillas = true;
    else if (c === ',') {
      fila.push(campo);
      campo = '';
    } else if (c === '\n') {
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = '';
    } else if (c !== '\r') campo += c;
  }
  if (campo !== '' || fila.length) {
    fila.push(campo);
    filas.push(fila);
  }
  return filas;
}

function convertir(valor) {
  if (valor === '') return '';
  if (valor === 'TRUE') return true;
  if (valor === 'FALSE') return false;
  if (/^-?\d+(\.\d+)?$/.test(valor)) return Number(valor);
  return valor;
}

function datosDeCsv() {
  const datos = {};
  const dir = path.join(__dirname, '..', 'sheet-export');
  // Los CSV siguen teniendo los nombres de pestaña del Sheet viejo; las colecciones son
  // los mismos en minúscula.
  const COLECCION = {
    Movimientos: 'movimientos', Celdas: 'celdas', Categorias: 'categorias',
    Subcategorias: 'subcategorias', Auto: 'autos', AutoServices: 'auto_services',
    AutoPlan: 'auto_plan', Quinta: 'quinta', QuintaPendientes: 'quinta_pendientes',
  };
  for (const archivo of fs.readdirSync(dir)) {
    if (!archivo.endsWith('.csv')) continue;
    const coleccion = COLECCION[archivo.replace('.csv', '')];
    if (!coleccion) continue;
    const matriz = parsearCsv(fs.readFileSync(path.join(dir, archivo), 'utf8')).map((f) => f.map(convertir));
    const encabezado = (matriz[0] || []).map((c) => String(c ?? '').trim());
    datos[coleccion] = matriz.slice(1)
      .filter((f) => f.some((v) => v !== '' && v !== null && v !== undefined))
      .map((f) => Object.fromEntries(encabezado.map((c, i) => [c, f[i]])))
      .filter((f) => f.id !== '' && f.id !== undefined);
  }
  return datos;
}

const contexto = cargarLogica(crearAlmacen(datosDeCsv()));
const llamar = contexto.llamar;

// ---------------------------------------------------------------- comparaciones

let fallas = 0;
let pruebas = 0;

function comprobar(nombre, condicion, detalle) {
  pruebas++;
  if (condicion) {
    console.log(`  ok   ${nombre}`);
  } else {
    fallas++;
    console.log(`  FALLA ${nombre}${detalle ? ` — ${detalle}` : ''}`);
  }
}

function iguales(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

console.log('Lectura: la planilla tiene que devolver lo mismo que la base local\n');

const anios = llamar('GET', '/api/years').years;
comprobar('años cargados', iguales(anios, store.listYears()), `${anios} vs ${store.listYears()}`);

for (const anio of [2022, 2024, 2025, 2026]) {
  const desdeSheet = llamar('GET', `/api/year/${anio}`);
  const desdeBase = JSON.parse(JSON.stringify(store.getYear(anio)));
  // el orden de las secciones puede variar; comparamos sección por sección
  let ok = true;
  const detalles = [];
  for (const seccion of Object.keys(desdeBase.sections)) {
    const a = desdeBase.sections[seccion].categories;
    const b = (desdeSheet.sections[seccion] || { categories: [] }).categories;
    if (a.length !== b.length) {
      ok = false;
      detalles.push(`${seccion}: ${a.length} categorías vs ${b.length}`);
      continue;
    }
    for (const cat of a) {
      const otra = b.find((c) => c.name === cat.name);
      if (!otra || !iguales(cat.months, otra.months) || !iguales(cat.base, otra.base)) {
        ok = false;
        detalles.push(`${seccion}/${cat.name}`);
      }
    }
  }
  comprobar(`año ${anio}: totales y categorías`, ok, detalles.slice(0, 3).join(', '));
  comprobar(`año ${anio}: pendientes`, desdeSheet.pending.length === desdeBase.pending.length);
}

const movsSheet = llamar('GET', '/api/movements?year=2026&month=7').movements;
const movsBase = store.getMovements({ year: 2026, month: 7 });
comprobar('movimientos de julio 2026', movsSheet.length === movsBase.length, `${movsSheet.length} vs ${movsBase.length}`);
comprobar(
  'importes de julio 2026',
  movsSheet.reduce((a, m) => a + m.amount, 0) === movsBase.reduce((a, m) => a + m.amount, 0)
);

const catalogo = llamar('GET', '/api/catalog');
comprobar('catálogo de variables', catalogo.catalog.variables.length === store.listCatalog().variables.length);
comprobar('subcategorías', catalogo.subcategories.length === store.listSubcategories().length);

const autos = llamar('GET', '/api/vehicles').vehicles;
const autosBase = store.getVehicles();
comprobar('auto', autos.length === autosBase.length && autos[0].services.length === autosBase[0].services.length);
comprobar(
  'total de services',
  Math.round(autos[0].services.reduce((a, s) => a + (s.precio_ars || 0), 0)) ===
    Math.round(autosBase[0].services.reduce((a, s) => a + (s.precio_ars || 0), 0))
);

const quinta = llamar('GET', '/api/quinta');
const quintaBase = store.getQuinta();
comprobar('quinta: rubros', quinta.rubros.length === quintaBase.rubros.length);
comprobar('quinta: pendientes', quinta.todos.length === quintaBase.todos.length);

console.log('\nEscritura: cargar, editar y borrar contra la planilla\n');

const antes = llamar('GET', '/api/year/2026').sections.variables.categories.find((c) => c.name === 'Comida afuera');
const totalAntes = antes ? antes.months[6] : 0;

const nuevo = llamar('POST', '/api/movements', {
  year: 2026,
  month: 7,
  day: 15,
  kind: 'gasto',
  section: 'variables',
  category: 'Comida afuera',
  subcategory: 'Pizza y rotisería',
  description: 'prueba automática',
  amount: 12345,
  paid: true,
});
comprobar('alta de movimiento', Number(nuevo.id) > 0);

let cat = llamar('GET', '/api/year/2026').sections.variables.categories.find((c) => c.name === 'Comida afuera');
comprobar('suma a la celda del mes', cat.months[6] === totalAntes + 12345, `${cat.months[6]} vs ${totalAntes + 12345}`);

llamar('PUT', `/api/movements/${nuevo.id}`, { amount: 500, paid: false });
cat = llamar('GET', '/api/year/2026').sections.variables.categories.find((c) => c.name === 'Comida afuera');
comprobar('sin pagar no suma', cat.months[6] === totalAntes, `${cat.months[6]} vs ${totalAntes}`);
comprobar('sin pagar aparece como pendiente', cat.pending[6] === 500);

llamar('DELETE', `/api/movements/${nuevo.id}`);
cat = llamar('GET', '/api/year/2026').sections.variables.categories.find((c) => c.name === 'Comida afuera');
comprobar('baja de movimiento', cat.months[6] === totalAntes && cat.pending[6] === 0);

llamar('PUT', '/api/cell', { year: 2026, section: 'fijos', category: 'Gas', month: 9, amount: 31500 });
let gas = llamar('GET', '/api/year/2026').sections.fijos.categories.find((c) => c.name === 'Gas');
comprobar('editar una celda', gas.base[8] === 31500);
llamar('PUT', '/api/cell', { year: 2026, section: 'fijos', category: 'Gas', month: 9, amount: 30000 });
gas = llamar('GET', '/api/year/2026').sections.fijos.categories.find((c) => c.name === 'Gas');
comprobar('volver a dejarla como estaba', gas.base[8] === 30000);

llamar('POST', '/api/category', { year: 2026, section: 'variables', name: 'PRUEBA' });
comprobar(
  'alta de categoría',
  llamar('GET', '/api/year/2026').sections.variables.categories.some((c) => c.name === 'PRUEBA')
);
llamar('PATCH', '/api/category', { year: 2026, section: 'variables', from: 'PRUEBA', to: 'PRUEBA 2' });
comprobar(
  'renombrar categoría',
  llamar('GET', '/api/year/2026').sections.variables.categories.some((c) => c.name === 'PRUEBA 2')
);
llamar('DELETE', '/api/category', { year: 2026, section: 'variables', name: 'PRUEBA 2' });
comprobar(
  'borrar categoría',
  !llamar('GET', '/api/year/2026').sections.variables.categories.some((c) => c.name.startsWith('PRUEBA'))
);

const error = llamar('POST', '/api/movements', { year: 2026, month: 99, section: 'variables', category: 'X', amount: 1 });
comprobar('rechaza datos inválidos', Boolean(error.error), JSON.stringify(error));

console.log('\nUna sola llamada: bootstrap y estado devuelto al escribir\n');

const inicio = llamar('GET', '/api/bootstrap?year=2026&month=7');
comprobar('bootstrap trae los años', JSON.stringify(inicio.years) === JSON.stringify(store.listYears()));
comprobar('bootstrap trae el año', Boolean(inicio.year && inicio.year.sections.variables));
comprobar('bootstrap trae los movimientos del mes', Array.isArray(inicio.movements));
comprobar('bootstrap trae el catálogo', Boolean(inicio.catalog && inicio.catalog.catalog && inicio.catalog.subcategories));
comprobar(
  'bootstrap coincide con pedirlo por separado',
  JSON.stringify(inicio.year) === JSON.stringify(llamar('GET', '/api/year/2026'))
);

const conEstado = llamar('POST', '/api/movements', {
  year: 2026, month: 7, kind: 'gasto', section: 'variables', category: 'Comida afuera',
  subcategory: 'Estado', amount: 4321, paid: true, vista: { year: 2026, month: 7 },
});
comprobar('al escribir vuelve el estado', Boolean(conEstado.estado && conEstado.estado.year));
const catEstado = conEstado.estado.year.sections.variables.categories.find((c) => c.name === 'Comida afuera');
const catAparte = llamar('GET', '/api/year/2026').sections.variables.categories.find((c) => c.name === 'Comida afuera');
comprobar('el estado ya trae el gasto recién cargado', catEstado.months[6] === catAparte.months[6]);
comprobar('el estado trae los movimientos del mes', conEstado.estado.movements.some((m) => m.id === Number(conEstado.id)));
llamar('DELETE', `/api/movements/${conEstado.id}`);

console.log('\nCuotas, suscripción y dólares\n');

const base = { kind: 'gasto', section: 'tarjetas', category: 'SANTANDER', paid: true };

// 6 cuotas desde noviembre: 2 en 2026 y 4 en 2027
llamar('POST', '/api/movements', { ...base, year: 2026, month: 11, amount: 50000, subcategory: 'Heladera', cuotas: 6 });
const nov = llamar('GET', '/api/movements?year=2026&month=11').movements.filter((m) => m.subcategory === 'Heladera');
const dic = llamar('GET', '/api/movements?year=2026&month=12').movements.filter((m) => m.subcategory === 'Heladera');
const ene27 = llamar('GET', '/api/movements?year=2027&month=1').movements.filter((m) => m.subcategory === 'Heladera');
comprobar('6 cuotas: una por mes', nov.length === 1 && dic.length === 1 && ene27.length === 1);
comprobar('la cuota repite el importe', nov[0] && nov[0].amount === 50000 && ene27[0] && ene27[0].amount === 50000);
comprobar('numera las cuotas', nov[0] && nov[0].description.indexOf('(cuota 1/6)') >= 0, nov[0] && nov[0].description);
comprobar('rueda al año siguiente', ene27[0] && ene27[0].description.indexOf('(cuota 3/6)') >= 0, ene27[0] && ene27[0].description);
const abr27 = llamar('GET', '/api/movements?year=2027&month=4').movements.filter((m) => m.subcategory === 'Heladera');
comprobar('termina en la cuota 6', abr27.length === 1 && abr27[0].description.indexOf('(cuota 6/6)') >= 0);

// suscripción desde octubre: octubre a diciembre
llamar('POST', '/api/movements', { ...base, year: 2026, month: 10, amount: 12000, subcategory: 'Spotify', suscripcion: true });
const meses = [10, 11, 12].map((mes) =>
  llamar('GET', `/api/movements?year=2026&month=${mes}`).movements.filter((m) => m.subcategory === 'Spotify').length
);
comprobar('suscripción: hasta diciembre', JSON.stringify(meses) === '[1,1,1]', JSON.stringify(meses));
const sept = llamar('GET', '/api/movements?year=2026&month=9').movements.filter((m) => m.subcategory === 'Spotify');
comprobar('suscripción: no toca meses anteriores', sept.length === 0);

// en dólares
llamar('POST', '/api/movements', {
  ...base, year: 2026, month: 8, subcategory: 'Google', currency: 'USD', amount_currency: 12, rate: 1500, amount: 12,
});
const usd = llamar('GET', '/api/movements?year=2026&month=8').movements.filter((m) => m.subcategory === 'Google')[0];
comprobar('dólares: guarda el importe en pesos', usd && usd.amount === 18000, usd && String(usd.amount));
comprobar('dólares: conserva el original y la cotización', usd && usd.amount_currency === 12 && usd.rate === 1500);
const sinCotizacion = llamar('POST', '/api/movements', { ...base, year: 2026, month: 8, currency: 'USD', amount_currency: 5 });
comprobar('dólares: exige cotización', Boolean(sinCotizacion.error));

// limpieza
['Heladera', 'Spotify', 'Google'].forEach((sub) => {
  [2026, 2027].forEach((anio) => {
    for (let mes = 1; mes <= 12; mes++) {
      llamar('GET', `/api/movements?year=${anio}&month=${mes}`)
        .movements.filter((m) => m.subcategory === sub)
        .forEach((m) => llamar('DELETE', `/api/movements/${m.id}`));
    }
  });
});
const quedan = [2026, 2027].some((anio) =>
  Array.from({ length: 12 }, (_, i) => i + 1).some((mes) =>
    llamar('GET', `/api/movements?year=${anio}&month=${mes}`).movements.some((m) =>
      ['Heladera', 'Spotify', 'Google'].includes(m.subcategory)
    )
  )
);
comprobar('limpieza de las pruebas', !quedan);

// ---------------------------------------------------------------- revisión

console.log('\nEl informe de revisión encuentra lo que hay para sanear\n');

const rev = llamar('GET', '/api/revision');
const grupo = (nombre) => rev.parecidas.find((g) => g.options.some((o) => o.name === nombre));

comprobar('junta INTERNET con Internet', Boolean(grupo('INTERNET')) && grupo('INTERNET').options.length === 2);
comprobar('junta PLATAFORMA5 con Plataforma 5', Boolean(grupo('PLATAFORMA5')));
comprobar('junta HAL+ con HAL +', Boolean(grupo('HAL+')));
// "HAL" y "HAL +" son dos ingresos distintos: sólo se ignoran los espacios, no los signos
comprobar('no confunde HAL con HAL +', !grupo('HAL+').options.some((o) => o.name === 'HAL'));
comprobar('no confunde LUZ con LUZ QUINTA', !grupo('LUZ'));
comprobar(
  'cada variante trae sus años y cuánto se usa',
  grupo('INTERNET').options.every((o) => o.years.length > 0 && o.celdas + o.movs > 0)
);

const huerfanasDe = [...new Set(rev.huerfanas.map((h) => `${h.section}/${h.category}`))];
comprobar('encuentra las subcategorías de categorías que no existen', rev.huerfanas.length > 100, String(rev.huerfanas.length));
comprobar('y son las de VARIOS y KIOSCO', huerfanasDe.every((c) => c === 'variables/VARIOS' || c === 'variables/KIOSCO'), huerfanasDe.join(', '));
comprobar('cuenta Sin clasificar por año', rev.sinClasificar.length === 5 && rev.sinClasificar[0].year === 2022);
comprobar('no inventa categorías vacías', rev.vacias.length === 0, JSON.stringify(rev.vacias));

// Una planilla limpia no tiene que dar nada
const limpia = cargarLogica(crearAlmacen({}));
limpia.llamar('POST', '/api/movements', {
  year: 2026, month: 3, section: 'variables', category: 'Casa', subcategory: 'Luz',
  amount: 1000, paid: true, currency: 'ARS',
});
const revLimpia = limpia.llamar('GET', '/api/revision');
comprobar(
  'una planilla sana no reporta nada',
  revLimpia.parecidas.length === 0 && revLimpia.huerfanas.length === 0 &&
    revLimpia.sinUso.length === 0 && revLimpia.vacias.length === 0,
  JSON.stringify(revLimpia)
);

// ---------------------------------------------------------------- saneamiento

console.log('\nFusionar, mover de sección y pasar celdas a movimientos\n');

// Planilla propia: estas operaciones tocan todos los años y no conviene mezclarlas con
// las pruebas de arriba.
function planillaDeSaneamiento() {
  const ctx = cargarLogica(crearAlmacen({}));
  const celda = (year, section, category, month, amount) =>
    ctx.llamar('PUT', '/api/cell', { year, section, category, month, amount });
  // "INTERNET" y "Internet" conviven en 2023, y en marzo las dos tienen monto
  celda(2022, 'fijos', 'INTERNET', 3, 1000);
  celda(2023, 'fijos', 'INTERNET', 3, 2000);
  celda(2023, 'fijos', 'Internet', 3, 500);
  celda(2023, 'fijos', 'Internet', 4, 700);
  celda(2024, 'fijos', 'Internet', 3, 900);
  return ctx;
}

/** Lo que muestra la grilla, mes a mes, sumando todas las categorías de la sección. */
function totalesDeSeccion(ctx, anio, seccion) {
  const cats = ctx.llamar('GET', `/api/year/${anio}`).sections[seccion].categories;
  return Array.from({ length: 12 }, (_, i) => cats.reduce((t, c) => t + (c.months[i] || 0), 0));
}

let san = planillaDeSaneamiento();
const fijos2023Antes = totalesDeSeccion(san, 2023, 'fijos');
const fusion = san.llamar('POST', '/api/category/merge', { section: 'fijos', from: 'INTERNET', to: 'Internet' });

comprobar('la fusión no da error', !fusion.error, fusion.error);
comprobar(
  'los totales del mes no cambian',
  JSON.stringify(totalesDeSeccion(san, 2023, 'fijos')) === JSON.stringify(fijos2023Antes),
  JSON.stringify(totalesDeSeccion(san, 2023, 'fijos'))
);
const catsFijos = (anio) => san.llamar('GET', `/api/year/${anio}`).sections.fijos.categories.map((c) => c.name);
comprobar('ya no queda la categoría vieja', !catsFijos(2023).includes('INTERNET'), catsFijos(2023).join(', '));
comprobar('y no quedó duplicada la que gana', catsFijos(2023).filter((n) => n === 'Internet').length === 1);
comprobar('se lleva los años que sólo tenía la vieja', catsFijos(2022).includes('Internet'), catsFijos(2022).join(', '));
const marzo2023 = san.llamar('GET', '/api/year/2023').sections.fijos.categories.find((c) => c.name === 'Internet');
comprobar('las celdas del mismo mes se suman', marzo2023.months[2] === 2500, String(marzo2023.months[2]));

// mover de sección
san = planillaDeSaneamiento();
san.llamar('POST', '/api/movements', {
  year: 2023, month: 5, section: 'fijos', category: 'Internet', amount: 300, paid: true, currency: 'ARS',
});
const movida = san.llamar('POST', '/api/category/move', { section: 'fijos', name: 'Internet', toSection: 'ahorro' });
comprobar('mover de sección no da error', !movida.error, movida.error);
const anio2023 = san.llamar('GET', '/api/year/2023');
comprobar('la categoría ya no está en la sección vieja', !anio2023.sections.fijos.categories.some((c) => c.name === 'Internet'));
comprobar('y aparece en la nueva', anio2023.sections.ahorro.categories.some((c) => c.name === 'Internet'));
comprobar(
  'los movimientos se mueven con ella',
  san.llamar('GET', '/api/movements?year=2023&month=5').movements.every((m) => m.section === 'ahorro' && m.kind === 'gasto')
);
// Se movió sólo "Internet" (500 en marzo); "INTERNET" (2000) sigue en fijos: entre las dos
// secciones tiene que seguir estando todo.
comprobar(
  'no se pierde ningún monto al cambiar de sección',
  totalesDeSeccion(san, 2023, 'ahorro')[2] === 500 && totalesDeSeccion(san, 2023, 'fijos')[2] === 2000,
  `ahorro ${totalesDeSeccion(san, 2023, 'ahorro')[2]} · fijos ${totalesDeSeccion(san, 2023, 'fijos')[2]}`
);

// celdas a movimientos
san = planillaDeSaneamiento();
const antesConvertir = totalesDeSeccion(san, 2023, 'fijos');
const convertidas = san.llamar('POST', '/api/cells-to-movements', {
  section: 'fijos', category: 'Internet', subcategory: 'Abono',
  filas: [{ year: 2023, month: 3, subcategory: 'Abono' }, { year: 2023, month: 4, subcategory: 'Instalación' }],
});
comprobar('convierte sólo las celdas elegidas', convertidas.movimientos === 2, JSON.stringify(convertidas));
comprobar(
  'la grilla muestra lo mismo que antes',
  JSON.stringify(totalesDeSeccion(san, 2023, 'fijos')) === JSON.stringify(antesConvertir),
  JSON.stringify(totalesDeSeccion(san, 2023, 'fijos'))
);
const convertidos = san.llamar('GET', '/api/movements?year=2023&month=4').movements;
comprobar('cada mes se lleva su subcategoría', convertidos.length === 1 && convertidos[0].subcategory === 'Instalación', JSON.stringify(convertidos));
comprobar('quedan pagados, si no no sumarían', convertidos[0].paid === 1);
comprobar('2024 quedó intacto', san.llamar('GET', '/api/year/2024').sections.fijos.categories[0].months[2] === 900);

// borrar subcategoría
comprobar(
  'borra una subcategoría suelta',
  san.llamar('DELETE', '/api/subcategory', { section: 'fijos', category: 'Internet', name: 'Abono' }).borradas === 1
);
comprobar(
  'y todas las de una categoría de una vez',
  san.llamar('DELETE', '/api/subcategory', { section: 'fijos', category: 'Internet' }).borradas === 1
);
comprobar('no quedan subcategorías de esa categoría', !san.llamar('GET', '/api/subcategories').subcategories.some((s) => s.category === 'Internet'));

console.log(`\n${pruebas} comprobaciones, ${fallas} con problema.`);
process.exit(fallas ? 1 : 0);
