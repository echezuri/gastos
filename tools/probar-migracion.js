// Comprueba el camino del backup del Sheet a Firestore.
//
// Son dos traducciones seguidas y en las dos se pierde información si uno se descuida:
// la planilla guarda todo como texto o como lo que Google haya adivinado, y Firestore no
// adivina nada: cada valor viaja etiquetado con su tipo.
//
// Uso: node tools/probar-migracion.js
const { convertirValor, filasDeLaPestana, filasDelBackup, revisar, totalesPorMes } = require('./backup-a-filas');
const { valorFirestore, documentoFirestore } = require('./migrar-a-firebase');

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

console.log('Del Sheet a las filas\n');

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

// --- vacíos ---
comprobar('un día vacío es null, no 0', convertirValor('movimientos', 'dia', '') === null);
comprobar('una cotización vacía es null', convertirValor('movimientos', 'cotizacion', '') === null);
// La lógica de la app trata el texto con texto(): un campo que falta y uno vacío tienen
// que ser la misma cosa, si no aparecen "null" escritos en la pantalla.
comprobar('una descripción vacía va como texto vacío', convertirValor('movimientos', 'descripcion', '') === '');
comprobar(
  'ningún campo de texto queda en null',
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
  ['', '', '', '', '', '', '', '', '', '', '', '', '', ''], // fila vacía
  ['', 2026, 5, 1, 'gasto', 'variables', 'Casa', '', '', 'ARS', '', '', 50, true], // sin id
];
const filas = filasDeLaPestana('movimientos', matriz);
comprobar('saltea las filas vacías y las que no tienen id', filas.length === 2, String(filas.length));
comprobar('el pagado llega como booleano', filas[0].pagado === true && filas[1].pagado === false);
comprobar('el día vacío llega como null', filas[1].dia === null);
comprobar('los dólares conservan importe y cotización', filas[1].monto_moneda === 100 && filas[1].cotizacion === 1500);
comprobar('el monto en pesos es el que suma', filas[1].monto === 150000);
comprobar('no inventa campos', Object.keys(filas[0]).every((k) => COLS.includes(k)));
comprobar('una pestaña vacía da cero filas', filasDeLaPestana('celdas', [['id', 'anio']]).length === 0);
comprobar('una pestaña que no existe tampoco', filasDeLaPestana('celdas', undefined).length === 0);

// --- el backup entero ---
const backup = filasDelBackup({ tablas: { Movimientos: matriz, Celdas: [['id', 'anio', 'monto']] } });
comprobar('arma todas las colecciones, aunque el backup no las traiga', Object.keys(backup).length === 9, Object.keys(backup).join(', '));
comprobar('y las que faltan quedan vacías, no rotas', backup.quinta.length === 0 && backup.movimientos.length === 2);

console.log('\nDe las filas a Firestore\n');

// Firestore no adivina el tipo: si algo viaja mal etiquetado, se guarda mal y no avisa.
comprobar('un entero viaja como texto, que es lo que exige la API', JSON.stringify(valorFirestore('anio', 2026)) === '{"integerValue":"2026"}', JSON.stringify(valorFirestore('anio', 2026)));
comprobar('la plata viaja siempre como decimal', JSON.stringify(valorFirestore('monto', 1000)) === '{"doubleValue":1000}', JSON.stringify(valorFirestore('monto', 1000)));
comprobar('…incluso cuando es redonda, para que el campo no cambie de tipo según la fila', valorFirestore('monto', 1000).integerValue === undefined);
comprobar('un decimal se conserva', JSON.stringify(valorFirestore('monto', 1000.5)) === '{"doubleValue":1000.5}');
comprobar('el booleano viaja como booleano', JSON.stringify(valorFirestore('pagado', false)) === '{"booleanValue":false}');
comprobar('el null viaja como null y no como el texto "null"', JSON.stringify(valorFirestore('dia', null)) === '{"nullValue":null}');
comprobar('el texto vacío se conserva', JSON.stringify(valorFirestore('descripcion', '')) === '{"stringValue":""}');

const doc = documentoFirestore(filas[1]);
comprobar('el documento lleva todos los campos de la fila', Object.keys(doc.fields).length === COLS.length, String(Object.keys(doc.fields).length));
comprobar('con el id como entero', doc.fields.id.integerValue === '2');
comprobar('y el importe en dólares como decimal', doc.fields.monto_moneda.doubleValue === 100);

console.log('\nLo que no puede entrar, dicho antes\n');

comprobar('avisa de un id repetido', revisar('movimientos', [{ id: 1 }, { id: 1 }]).some((p) => p.includes('repetido')));
comprobar('avisa de un movimiento sin monto', revisar('movimientos', [{ id: 9, monto: null, tipo: 'gasto', mes: 3 }]).some((p) => p.includes('sin monto')));
comprobar('avisa de un tipo que la app no entiende', revisar('movimientos', [{ id: 9, monto: 1, tipo: 'otro', mes: 3 }]).some((p) => p.includes('tipo')));
comprobar('no se queja de lo que está bien', revisar('movimientos', [{ id: 9, monto: 1, tipo: 'gasto', mes: 3 }]).length === 0);

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
