'use strict';

/**
 * Los datos, contra Firestore.
 *
 * La app trabaja siempre sobre una copia en memoria de las nueve colecciones. Eso permite
 * que `Codigo.gs` siga siendo sincrónico —pide filas y las tiene en el acto— y que la
 * pantalla conteste sin esperar a la red.
 *
 * Lo que cambia respecto de la época del Sheet es de dónde viene esa copia y cómo se
 * mantiene al día:
 *
 *   · escribir va derecho a Firestore, sin cola ni reintentos. Un documento tiene id
 *     propio, así que no hay números de fila que se corran ni nada que reordenar.
 *   · Firestore avisa solo cuando algo cambia, en cualquier dispositivo. No hay que
 *     preguntar cada tanto: llega el aviso y la pantalla se redibuja sola.
 *
 * El id de cada documento es un número, el mismo que traía del Sheet. Se guarda además
 * como campo `id` porque la lógica lo usa para todo.
 */
const datosFirebase = (() => {
  // Las colecciones que la app carga y escucha. Son las mismas que declara Codigo.gs.
  const COLECCIONES = [
    'categorias', 'celdas', 'movimientos', 'subcategorias',
    'autos', 'auto_services', 'auto_plan', 'quinta', 'quinta_pendientes',
  ];

  let fb = null; // lo que exporta el SDK, cargado por la página
  let db = null;
  const memoria = {}; // coleccion -> Map(id -> fila)
  const proximo = {}; // coleccion -> siguiente id libre
  let alCambiar = () => {};
  let cortarEscuchas = [];
  let errorDeEscritura = null;

  const mapa = (coleccion) => (memoria[coleccion] = memoria[coleccion] || new Map());

  /**
   * Los ids los asigna la app, no Firestore.
   *
   * Firestore daría identificadores al azar, pero los datos vienen del Sheet con ids
   * numéricos y toda la lógica los usa así. Se sigue la misma cuenta: uno más que el mayor.
   */
  function siguienteId(coleccion) {
    if (proximo[coleccion] === undefined) {
      let max = 0;
      for (const id of mapa(coleccion).keys()) max = Math.max(max, Number(id) || 0);
      proximo[coleccion] = max + 1;
    }
    return proximo[coleccion]++;
  }

  const almacen = {
    filas: (coleccion) => Array.from(mapa(coleccion).values()),

    agregar(coleccion, fila) {
      const id = siguienteId(coleccion);
      const conId = { ...fila, id };
      mapa(coleccion).set(id, conId); // primero en pantalla, después en la nube
      escribir(coleccion, id, conId);
      return id;
    },

    cambiar(coleccion, id, cambios) {
      const actual = mapa(coleccion).get(Number(id));
      if (!actual) return false;
      const nueva = { ...actual, ...cambios, id: actual.id };
      mapa(coleccion).set(Number(id), nueva);
      escribir(coleccion, Number(id), nueva);
      return true;
    },

    quitar(coleccion, id) {
      if (!mapa(coleccion).delete(Number(id))) return false;
      borrarDoc(coleccion, Number(id));
      return true;
    },
  };

  /** Las escrituras no bloquean la pantalla; si fallan, se avisa arriba. */
  function escribir(coleccion, id, fila) {
    fb.setDoc(fb.doc(db, coleccion, String(id)), limpiar(fila)).catch(avisarFalla);
  }

  function borrarDoc(coleccion, id) {
    fb.deleteDoc(fb.doc(db, coleccion, String(id))).catch(avisarFalla);
  }

  function avisarFalla(err) {
    errorDeEscritura = err.message || String(err);
    alCambiar();
  }

  /** Firestore no acepta undefined. Lo que no está, no va. */
  function limpiar(fila) {
    const salida = {};
    for (const [campo, valor] of Object.entries(fila)) {
      if (valor !== undefined) salida[campo] = valor;
    }
    return salida;
  }

  return {
    COLECCIONES,
    almacen,
    hayError: () => errorDeEscritura,
    olvidarError() {
      errorDeEscritura = null;
    },

    /** Arranca con el SDK ya cargado y una sesión abierta. */
    async iniciar(sdk, base, cuandoCambie) {
      fb = sdk;
      db = base;
      alCambiar = cuandoCambie || (() => {});

      // Todo de una: la app arma cualquier vista con las colecciones enteras, igual que
      // hacía con la planilla, y así no hay pantallas a medio cargar.
      await Promise.all(
        COLECCIONES.map(async (coleccion) => {
          const foto = await fb.getDocs(fb.collection(db, coleccion));
          const m = mapa(coleccion);
          foto.forEach((doc) => m.set(Number(doc.id), { ...doc.data(), id: Number(doc.id) }));
          delete proximo[coleccion];
        })
      );
    },

    /**
     * Se queda escuchando. Cada cambio —propio o de otro dispositivo— actualiza la copia
     * y avisa para redibujar.
     */
    escuchar() {
      this.dejarDeEscuchar();
      cortarEscuchas = COLECCIONES.map((coleccion) =>
        fb.onSnapshot(
          fb.collection(db, coleccion),
          (foto) => {
            let hubo = false;
            foto.docChanges().forEach((cambio) => {
              const id = Number(cambio.doc.id);
              if (cambio.type === 'removed') mapa(coleccion).delete(id);
              else mapa(coleccion).set(id, { ...cambio.doc.data(), id });
              hubo = true;
            });
            if (!hubo) return;
            delete proximo[coleccion]; // otro dispositivo pudo haber usado ids nuevos
            alCambiar();
          },
          avisarFalla
        )
      );
    },

    dejarDeEscuchar() {
      cortarEscuchas.forEach((cortar) => cortar());
      cortarEscuchas = [];
    },
  };
})();
