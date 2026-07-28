// Comprueba la conversión del backup del Sheet a filas de Postgres.
//
// La planilla guarda todo como texto o como lo que Google haya adivinado: "VERDADERO",
// celdas vacías, números que en realidad son etiquetas. Postgres no perdona nada de eso,
// así que la traducción es donde se pierde o se rompe la información.
//
// Uso: node tools/probar-migracion.js
const { filasParaPostgres, convertirValor, totalesPorMes, revisar } = require('./migrar-a-supabase');

let pruebas = 0;
let fallas = 0;

function comprobar(nombre, condicion, detalle) {
  pruebas++;
  if (condicion) console.log(`  ok   ${nombre}`);
  else {
    fallas++;
    console.log(`  FALLA ${nombre}${detalle ? ` — ${detalle}` : ''}`);
  }
}

const COLS = ['id', 'anio', 'mes', 'dia', 'tipo', 'seccion', 'categoria', 'subcategoria', 'descripcion', 'moneda', 'monto_moneda', 'cotizacion', 'monto', 'pagado'];

console.log('Del Sheet a Postgres\n');

// --- lo pagado, escrito de todas las formas en que aparece en la planilla ---
const comoLoGuardaGoogle = [true, 1, '1', 'true', 'TRUE', 'VERDADERO'];
comprobar(
  'todas las formas de "pagado" dan true',
  comoLoGuardaGoogle.every((v) => convertirValor('movimientos', 'pagado', v) === true),
  JSON.stringify(comoLoGuardaGoogle.map((v) => convertirValor('movimientos', 'pagado', v)))
);
comprobar(
  'lo que no está pagado da false, nunca null',
  [false, 0, '', 'FALSO', null, undefined].every((v) => convertirValor('movimientos', 'pagado', v) === false)
);

// --- vacíos: la planilla usa '' donde Postgres quiere null ---
comprobar('un día vacío es null, no 0', convertirValor('movimientos', 'dia', '') === null);
comprobar('una cotización vacía es null', convertirValor('movimientos', 'cotizacion', '') === null);
// Las columnas de texto del esquema son "not null default ''": si les mandamos null,
// Postgres rechaza la fila entera y la migración se cae a la mitad.
comprobar('una descripción vacía va como texto vacío, no como null', convertirValor('movimientos', 'descripcion', '') === '');
comprobar(
  'ninguna columna de texto puede quedar en null',
  ['descripcion', 'subcategoria', 'seccion', 'categoria', 'moneda', 'tipo'].every(
    (c) => convertirValor('movimientos', c, '') === '' && convertirValor('movimientos', c, null) === ''
  )
);

// En autos "anio" y "km" son texto libre: "2014 / 2015" no es un número
comprobar('el año del auto se queda como texto', convertirValor('autos', 'anio', '2014 / 2015') === '2014 / 2015');
comprobar('y el año de un movimiento sí es número', convertirValor('movimientos', 'anio', '2026') === 2026);

// --- filas enteras ---
const matriz = [
  COLS,
  [1, 2026, 3, 15, 'gasto', 'variables', 'Casa', 'Luz', 'nota', 'ARS', '', '', 1000, 'VERDADERO'],
  [2, 2026, 4, '', 'ingreso', 'ingresos', 'HAL', 'Sueldo', '', 'USD', 100, 1500, 150000, 'FALSO'],
  ['', '', '', '', '', '', '', '', '', '', '', '', '', ''], // fila vacía, se saltea
  ['', 2026, 5, 1, 'gasto', 'variables', 'Casa', '', '', 'ARS', '', '', 50, true], // sin id, se saltea
];
const filas = filasParaPostgres('movimientos', matriz);
comprobar('saltea las filas vacías y las que no tienen id', filas.length === 2, String(filas.length));
comprobar('el pagado llega como booleano', filas[0].pagado === true && filas[1].pagado === false);
comprobar('el día vacío llega como null', filas[1].dia === null, JSON.stringify(filas[1].dia));
comprobar('los dólares conservan importe y cotización', filas[1].monto_moneda === 100 && filas[1].cotizacion === 1500);
comprobar('el monto en pesos es el que suma', filas[1].monto === 150000);
comprobar('no inventa columnas', Object.keys(filas[0]).every((k) => COLS.includes(k)));

// --- una pestaña sin datos no rompe ---
comprobar('una pestaña vacía da cero filas', filasParaPostgres('celdas', [['id', 'anio']]).length === 0);
comprobar('una pestaña que no existe tampoco', filasParaPostgres('celdas', undefined).length === 0);

// --- lo que Postgres va a rechazar, dicho antes ---
comprobar('avisa de un id repetido', revisar('movimientos', [{ id: 1 }, { id: 1 }]).some((p) => p.includes('repetido')));
comprobar(
  'avisa de un movimiento sin monto',
  revisar('movimientos', [{ id: 9, monto: null, tipo: 'gasto', mes: 3 }]).some((p) => p.includes('sin monto'))
);
comprobar(
  'avisa de un tipo que la base no acepta',
  revisar('movimientos', [{ id: 9, monto: 1, tipo: 'otro', mes: 3 }]).some((p) => p.includes('tipo'))
);
comprobar('no se queja de lo que está bien', revisar('movimientos', [{ id: 9, monto: 1, tipo: 'gasto', mes: 3 }]).length === 0);

// --- los totales por mes, que son el invariante de toda la migración ---
const totales = totalesPorMes({
  celdas: [{ anio: 2026, mes: 3, monto: 1000 }],
  movimientos: [
    { anio: 2026, mes: 3, monto: 500, pagado: true },
    { anio: 2026, mes: 3, monto: 999, pagado: false }, // sin pagar no suma
  ],
});
comprobar('la celda y el movimiento pagado se suman', totales['2026-03'] === 1500, JSON.stringify(totales));
comprobar('lo que no está pagado no suma', Object.values(totales).reduce((a, b) => a + b, 0) === 1500);

console.log(`\n${pruebas} comprobaciones, ${fallas} con problema.`);
process.exit(fallas ? 1 : 0);
