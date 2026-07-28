// Almacén en memoria: lo que usan las pruebas en lugar de Firestore.
//
// Tiene que comportarse igual que el de verdad en lo único que la lógica ve: filas por
// colección, ids que no se repiten, y cambios por id. Si acá y allá se comportaran
// distinto, las pruebas dejarían de significar algo.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function crearAlmacen(datosIniciales = {}) {
  const datos = {};
  // Un contador por colección, no uno solo: en Firestore los id son propios de cada una,
  // y con un contador compartido el primer movimiento no empezaría en 1.
  const proximo = {};

  for (const [coleccion, filas] of Object.entries(datosIniciales)) {
    datos[coleccion] = filas.map((f) => ({ ...f }));
    proximo[coleccion] = filas.reduce((max, f) => Math.max(max, Number(f.id) || 0), 0) + 1;
  }

  const de = (coleccion) => (datos[coleccion] = datos[coleccion] || []);

  return {
    datos,

    // Copias: que nadie de afuera pueda cambiar una fila sin pasar por acá, como pasaría
    // si atrás hubiera una base de verdad.
    filas: (coleccion) => de(coleccion).map((f) => ({ ...f })),

    agregar(coleccion, fila) {
      const id = proximo[coleccion] || 1;
      proximo[coleccion] = id + 1;
      de(coleccion).push({ ...fila, id });
      return id;
    },

    cambiar(coleccion, id, cambios) {
      const fila = de(coleccion).find((f) => Number(f.id) === Number(id));
      if (!fila) return false;
      Object.assign(fila, cambios, { id: fila.id });
      return true;
    },

    quitar(coleccion, id) {
      const lista = de(coleccion);
      const i = lista.findIndex((f) => Number(f.id) === Number(id));
      if (i < 0) return false;
      lista.splice(i, 1);
      return true;
    },
  };
}

/** Carga la lógica compartida sobre un almacén, y devuelve con qué llamarla. */
function cargarLogica(almacen) {
  const contexto = { ALMACEN: almacen, console };
  vm.createContext(contexto);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Codigo.gs'), 'utf8'), contexto);
  contexto.llamar = (metodo, ruta, cuerpo) => JSON.parse(contexto.llamarApi(metodo, ruta, cuerpo || null));
  return contexto;
}

module.exports = { crearAlmacen, cargarLogica };
