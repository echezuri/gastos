'use strict';

/**
 * Copia local de la planilla.
 *
 * La app trabaja siempre contra esta copia: por eso dibuja al instante y anda sin señal.
 * Cada escritura queda además anotada en una lista de pendientes que después se manda al
 * Sheet de verdad. La lógica que la usa es la misma que corre adentro de Google
 * (`logica.js`, copia de `apps-script/Codigo.gs`): acá sólo le damos una planilla falsa
 * con los mismos métodos.
 */
const CLAVE_TABLAS = 'gastos-tablas';
const CLAVE_PENDIENTES = 'gastos-pendientes';
const CLAVE_FECHA = 'gastos-sincronizado';

const almacenLocal = (() => {
  let tablas = {};
  let pendientes = [];
  let anotando = true;

  function leerJson(clave, porDefecto) {
    try {
      const crudo = localStorage.getItem(clave);
      return crudo ? JSON.parse(crudo) : porDefecto;
    } catch {
      return porDefecto;
    }
  }

  function guardar() {
    try {
      localStorage.setItem(CLAVE_TABLAS, JSON.stringify(tablas));
      localStorage.setItem(CLAVE_PENDIENTES, JSON.stringify(pendientes));
    } catch {
      /* si no hay lugar, la app sigue andando en memoria */
    }
  }

  function anotar(operacion) {
    if (!anotando) return;
    pendientes.push(operacion);
  }

  /**
   * Con qué id se identifica la fila, y en qué columna vive ese id.
   *
   * Los pendientes de editar y borrar viajan con el id, no sólo con el número de fila: si
   * otro dispositivo borró algo antes de que esto llegue al Sheet, las filas de abajo se
   * corrieron y escribiríamos encima del movimiento equivocado. La fila 1 es el encabezado
   * y no tiene id: esa sí va por posición.
   */
  function identidad(nombre, fila) {
    if (fila <= 1) return null;
    const tabla = tablas[nombre] || [];
    const columnaId = (tabla[0] || []).indexOf('id');
    if (columnaId < 0) return null;
    const valor = (tabla[fila - 1] || [])[columnaId];
    if (valor === undefined || valor === null || valor === '') return null;
    return { id: valor, columnaId: columnaId + 1 };
  }

  /** Planilla falsa con los métodos que usa la lógica compartida. */
  function hacerHoja(nombre) {
    return {
      getName: () => nombre,
      getDataRange: () => ({
        getValues: () => (tablas[nombre].length ? tablas[nombre].map((f) => f.slice()) : [[]]),
      }),
      appendRow: (fila) => {
        tablas[nombre].push(fila.slice());
        anotar({ tipo: 'agregar', hoja: nombre, valores: [fila.slice()] });
      },
      getRange: (fila, col, alto, ancho) => ({
        setValue: (v) => {
          const quien = identidad(nombre, fila);
          const f = tablas[nombre][fila - 1];
          while (f.length < col) f.push('');
          f[col - 1] = v;
          anotar({ tipo: 'escribir', hoja: nombre, fila, columna: col, valores: [[v]], ...quien });
        },
        setValues: (valores) => {
          const esAgregado = fila - 1 >= tablas[nombre].length;
          const quien = esAgregado ? null : identidad(nombre, fila);
          valores.forEach((f, i) => {
            tablas[nombre][fila - 1 + i] = f.slice();
          });
          anotar(
            esAgregado
              ? { tipo: 'agregar', hoja: nombre, valores: valores.map((f) => f.slice()) }
              : { tipo: 'escribir', hoja: nombre, fila, columna: col, valores: valores.map((f) => f.slice()), ...quien }
          );
        },
      }),
      deleteRow: (fila) => {
        const quien = identidad(nombre, fila);
        tablas[nombre].splice(fila - 1, 1);
        anotar({ tipo: 'borrar', hoja: nombre, fila, ...quien });
      },
      setFrozenRows: () => {},
      clear: () => {
        tablas[nombre] = [];
        anotar({ tipo: 'vaciar', hoja: nombre });
      },
    };
  }

  const SpreadsheetAppFalso = {
    getActive: () => ({
      getSheets: () => Object.keys(tablas).map(hacerHoja),
      getSheetByName: (nombre) => (tablas[nombre] ? hacerHoja(nombre) : null),
      insertSheet: (nombre) => {
        tablas[nombre] = [];
        anotar({ tipo: 'crear', hoja: nombre });
        return hacerHoja(nombre);
      },
    }),
  };

  return {
    /** Instala la planilla falsa como global, para que la lógica compartida la use. */
    instalar() {
      tablas = leerJson(CLAVE_TABLAS, {});
      pendientes = leerJson(CLAVE_PENDIENTES, []);
      window.SpreadsheetApp = SpreadsheetAppFalso;
      window.LockService = { getDocumentLock: () => ({ waitLock() {}, releaseLock() {} }) };
      window.Logger = { log: () => {} };
      window.HtmlService = {};
    },

    hayDatos: () => Object.keys(tablas).length > 0,
    tablas: () => tablas,
    pendientes: () => pendientes,
    fechaSincronizado: () => leerJson(CLAVE_FECHA, null),

    /** Reemplaza la copia local con lo que vino del Sheet. No se anota como pendiente. */
    reemplazar(nuevas) {
      anotando = false;
      tablas = nuevas;
      anotando = true;
      localStorage.setItem(CLAVE_FECHA, JSON.stringify(new Date().toISOString()));
      guardar();
    },

    /** Marca como enviadas las primeras N operaciones pendientes. */
    confirmarEnviadas(cantidad) {
      pendientes.splice(0, cantidad);
      guardar();
    },

    guardar,
  };
})();
