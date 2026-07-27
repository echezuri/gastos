// Prueba el camino completo arrancando de una planilla VACÍA:
//   1. que la app no se cuelgue ni explote sin ninguna pestaña cargada
//   2. que importarTodo() llene las nueve pestañas
//   3. que después los datos coincidan con la base local
//
// Uso: node tools/probar-importacion.js
const store = require('../db');
const { crearPlanilla, cargarCodigo } = require('./planilla-simulada');

let fallas = 0;
let pruebas = 0;

function comprobar(nombre, condicion, detalle) {
  pruebas++;
  if (condicion) console.log(`  ok   ${nombre}`);
  else {
    fallas++;
    console.log(`  FALLA ${nombre}${detalle ? ` — ${detalle}` : ''}`);
  }
}

console.log('Planilla vacía: la app tiene que abrir igual, sin datos\n');

const vacia = crearPlanilla({});
const ctx = cargarCodigo(vacia, ['Codigo.gs', 'Datos.gs']);

let respuesta;
try {
  respuesta = ctx.llamar('GET', '/api/years');
  comprobar('pide los años sin explotar', !respuesta.error, JSON.stringify(respuesta));
  comprobar('devuelve el año actual', respuesta.years && respuesta.years.length === 1);
} catch (err) {
  comprobar('pide los años sin explotar', false, err.message);
}

const anioVacio = ctx.llamar('GET', `/api/year/${new Date().getFullYear()}`);
comprobar('el año vacío se arma bien', !anioVacio.error && anioVacio.sections && anioVacio.sections.variables.categories.length === 0);
comprobar('crea las pestañas que faltaban', Object.keys(vacia.datos).length >= 3, Object.keys(vacia.datos).join(', '));

const catalogoVacio = ctx.llamar('GET', '/api/catalog');
comprobar('el catálogo vacío no rompe', !catalogoVacio.error && Array.isArray(catalogoVacio.subcategories));

console.log('\nImportación de un toque\n');

const salida = ctx.importarTodo();
comprobar('importarTodo corre', typeof salida === 'string' && salida.indexOf('Listo') === 0, salida);

const filas = (nombre) => (vacia.datos[nombre] || []).length - 1;
comprobar('Movimientos', filas('Movimientos') === store.db.prepare('SELECT COUNT(*) n FROM movements').get().n, `${filas('Movimientos')}`);
comprobar('Celdas', filas('Celdas') === store.db.prepare('SELECT COUNT(*) n FROM cells').get().n, `${filas('Celdas')}`);
comprobar('Categorias', filas('Categorias') === store.db.prepare('SELECT COUNT(*) n FROM categories').get().n);
comprobar('Quinta', filas('Quinta') === store.db.prepare('SELECT COUNT(*) n FROM quinta_items').get().n);

console.log('\nDespués de importar, los datos tienen que coincidir con la base local\n');

comprobar('años', JSON.stringify(ctx.llamar('GET', '/api/years').years) === JSON.stringify(store.listYears()));

for (const anio of [2025, 2026]) {
  const desdeSheet = ctx.llamar('GET', `/api/year/${anio}`);
  const desdeBase = JSON.parse(JSON.stringify(store.getYear(anio)));
  let ok = true;
  const detalles = [];
  for (const seccion of Object.keys(desdeBase.sections)) {
    const a = desdeBase.sections[seccion].categories;
    const b = (desdeSheet.sections[seccion] || { categories: [] }).categories;
    if (a.length !== b.length) {
      ok = false;
      detalles.push(`${seccion}: ${a.length} vs ${b.length}`);
      continue;
    }
    for (const cat of a) {
      const otra = b.find((c) => c.name === cat.name);
      if (!otra || JSON.stringify(cat.months) !== JSON.stringify(otra.months)) {
        ok = false;
        detalles.push(`${seccion}/${cat.name}`);
      }
    }
  }
  comprobar(`año ${anio}`, ok, detalles.slice(0, 3).join(', '));
}

const nuevo = ctx.llamar('POST', '/api/movements', {
  year: 2026, month: 7, day: 20, kind: 'gasto', section: 'variables',
  category: 'Comida afuera', subcategory: 'Pizza y rotisería', description: 'prueba', amount: 999, paid: true,
});
comprobar('cargar un gasto después de importar', Number(nuevo.id) > 0);
const despues = ctx.llamar('GET', '/api/movements?year=2026&month=7').movements;
comprobar('aparece en la lista del mes', despues.some((m) => m.amount === 999 && m.description === 'prueba'));

console.log(`\n${pruebas} comprobaciones, ${fallas} con problema.`);
process.exit(fallas ? 1 : 0);
