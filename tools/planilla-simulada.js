// Planilla de Google simulada, para poder correr y probar el Apps Script sin subirlo.
// Implementa sólo lo que usa Codigo.gs: leer, agregar, editar y borrar filas.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function crearPlanilla(datosIniciales = {}) {
  const datos = JSON.parse(JSON.stringify(datosIniciales));

  const hacerHoja = (nombre) => ({
    getName: () => nombre,
    getDataRange: () => ({
      getValues: () => (datos[nombre].length ? datos[nombre].map((f) => [...f]) : [[]]),
    }),
    appendRow: (fila) => datos[nombre].push([...fila]),
    getRange: (fila, col, alto, ancho) => ({
      setValue: (v) => {
        while (datos[nombre][fila - 1].length < col) datos[nombre][fila - 1].push('');
        datos[nombre][fila - 1][col - 1] = v;
      },
      setValues: (valores) => {
        valores.forEach((f, i) => {
          datos[nombre][fila - 1 + i] = [...f];
        });
      },
    }),
    deleteRow: (fila) => datos[nombre].splice(fila - 1, 1),
    setFrozenRows: () => {},
    clear: () => {
      datos[nombre] = [];
    },
  });

  const api = {
    getActive: () => ({
      getSheets: () => Object.keys(datos).map(hacerHoja),
      getSheetByName: (nombre) => (datos[nombre] ? hacerHoja(nombre) : null),
      insertSheet: (nombre) => {
        datos[nombre] = [];
        return hacerHoja(nombre);
      },
    }),
  };

  return { datos, api };
}

/** Ejecuta los archivos .gs indicados sobre esa planilla y devuelve el contexto. */
function cargarCodigo(planilla, archivos) {
  const registro = [];
  const contexto = {
    SpreadsheetApp: planilla.api,
    LockService: { getDocumentLock: () => ({ waitLock() {}, releaseLock() {} }) },
    HtmlService: {},
    Logger: { log: (m) => registro.push(String(m)) },
    console,
    registro,
  };
  vm.createContext(contexto);
  for (const archivo of archivos) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script', archivo), 'utf8'), contexto);
  }
  contexto.llamar = (metodo, ruta, cuerpo) => JSON.parse(contexto.llamarApi(metodo, ruta, cuerpo || null));
  return contexto;
}

module.exports = { crearPlanilla, cargarCodigo };
