// Corre el código de Apps Script acá, con una planilla simulada cargada desde los CSV
// que se importan al Sheet, y compara sus respuestas contra las de la app local.
// Es la única forma de comprobar el backend del Sheet sin subirlo.
//
// Uso: node tools/probar-apps-script.js
const fs = require('node:fs');
const path = require('node:path');
const store = require('../db');
const { crearPlanilla, cargarCodigo } = require('./planilla-simulada');

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
  for (const archivo of fs.readdirSync(dir)) {
    if (!archivo.endsWith('.csv')) continue;
    const nombre = archivo.replace('.csv', '');
    datos[nombre] = parsearCsv(fs.readFileSync(path.join(dir, archivo), 'utf8')).map((f) => f.map(convertir));
  }
  return datos;
}

const contexto = cargarCodigo(crearPlanilla(datosDeCsv()), ['Codigo.gs']);
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

// ---------------------------------------------------------------- encabezado desfasado

// Un Sheet creado antes de que existieran las columnas de dólares tiene el encabezado
// corto. Como las filas se leen por el encabezado real y se escriben por posición, sin
// esto el importe caía en la columna de al lado: los gastos entraban en $0 y sin pagar,
// y "Marcar pagado" moría con "Importe inválido".
console.log('\nUna pestaña con el encabezado viejo se completa sola\n');

const VIEJO = ['id', 'anio', 'mes', 'dia', 'tipo', 'seccion', 'categoria', 'subcategoria', 'descripcion', 'monto', 'pagado'];
const planillaVieja = crearPlanilla({ Movimientos: [VIEJO] });
const viejo = cargarCodigo(planillaVieja, ['Codigo.gs']);

const alta = viejo.llamar('POST', '/api/movements', {
  year: 2026, month: 7, day: 27, section: 'tarjetas', category: 'SANTANDER',
  description: 'Calefactor', amount: 150000, paid: true, cuotas: 2, currency: 'ARS',
});
comprobar('carga sin error', !alta.error, alta.error);
comprobar(
  'el encabezado ahora tiene las columnas que faltaban',
  ['moneda', 'monto_moneda', 'cotizacion'].every((c) => planillaVieja.datos.Movimientos[0].includes(c)),
  JSON.stringify(planillaVieja.datos.Movimientos[0])
);

const guardado = viejo.llamar('GET', '/api/movements?year=2026&month=7').movements[0];
comprobar('el importe no se pierde', guardado && guardado.amount === 150000, guardado && String(guardado.amount));
comprobar('queda pagado, como se cargó', guardado && guardado.paid === 1);
comprobar('no queda en la lista de sin pagar', viejo.llamar('GET', '/api/year/2026').pending.length === 0);

const impago = viejo.llamar('POST', '/api/movements', {
  year: 2026, month: 7, day: 27, section: 'variables', category: 'HAL',
  description: 'Pizza', amount: 9000, paid: false, currency: 'ARS',
});
comprobar('marcar pagado no rompe', !viejo.llamar('PUT', `/api/movements/${impago.id}`, { paid: true }).error);

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
const limpia = cargarCodigo(crearPlanilla({}), ['Codigo.gs']);
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

console.log(`\n${pruebas} comprobaciones, ${fallas} con problema.`);
process.exit(fallas ? 1 : 0);
