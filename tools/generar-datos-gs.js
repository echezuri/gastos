// Genera apps-script/Datos.gs: los datos embebidos + una función que llena las pestañas
// de una sola vez. Evita tener que importar nueve CSV a mano.
//
// Uso: npm run datos:sheets
const fs = require('node:fs');
const path = require('node:path');
const { tablas } = require('./tablas-para-sheets');

const destino = path.join(__dirname, '..', 'apps-script', 'Datos.gs');

const bloques = tablas().map(({ nombre, columnas, filas }) => {
  const matriz = [columnas, ...filas.map((f) => columnas.map((c) => (f[c] === undefined || f[c] === null ? '' : f[c])))];
  const lineas = matriz.map((fila) => '    ' + JSON.stringify(fila)).join(',\n');
  return `  ${nombre}: [\n${lineas}\n  ]`;
});

const contenido = `/**
 * Datos para cargar la planilla de una sola vez.
 *
 * Generado por "npm run datos:sheets" a partir de la base local. Para usarlo:
 * abrí este archivo en el editor de Apps Script, elegí la función "importarTodo"
 * en el selector de arriba y tocá Ejecutar. Escribe las nueve pestañas de cero.
 *
 * OJO: importarTodo() reemplaza el contenido de esas pestañas. No toca ninguna otra.
 */

const DATOS = {
${bloques.join(',\n')}
};

function importarTodo() {
  const libro = SpreadsheetApp.getActive();
  const resumen = [];
  Object.keys(DATOS).forEach(function (nombre) {
    const filas = DATOS[nombre];
    let h = libro.getSheetByName(nombre);
    if (!h) h = libro.insertSheet(nombre);
    h.clear();
    if (filas.length) {
      h.getRange(1, 1, filas.length, filas[0].length).setValues(filas);
      h.setFrozenRows(1);
    }
    resumen.push(nombre + ': ' + (filas.length - 1) + ' fila(s)');
  });
  const texto = 'Listo.\\n' + resumen.join('\\n');
  Logger.log(texto);
  return texto;
}
`;

fs.writeFileSync(destino, contenido, 'utf8');
const kb = (Buffer.byteLength(contenido) / 1024).toFixed(1);
console.log(`apps-script/Datos.gs generado (${kb} KB)`);
tablas().forEach((t) => console.log(`  ${t.nombre}: ${t.filas.length} fila(s)`));
