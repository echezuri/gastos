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

    /**
     * Se pone a escuchar una colección y avisa cuando llegó la primera tanda.
     *
     * Escuchar en vez de pedir y después escuchar ahorra un viaje entero: la primera
     * respuesta llega de la caché del teléfono, así que abrir la app de nuevo es
     * instantáneo, y el servidor manda lo que haya cambiado apenas puede.
     */
    seguir(coleccion) {
      return new Promise((listo, falla) => {
        let primera = true;
        const cortar = fb.onSnapshot(
          fb.collection(db, coleccion),
          (foto) => {
            let hubo = false;
            foto.docChanges().forEach((cambio) => {
              const id = Number(cambio.doc.id);
              if (cambio.type === 'removed') mapa(coleccion).delete(id);
              else mapa(coleccion).set(id, { ...cambio.doc.data(), id });
              hubo = true;
            });
            if (primera) {
              primera = false;
              listo();
              if (!hubo) return;
            }
            if (!hubo) return;
            delete proximo[coleccion]; // otro dispositivo pudo haber usado ids nuevos
            alCambiar();
          },
          (err) => {
            avisarFalla(err);
            if (primera) {
              primera = false;
              falla(err);
            }
          }
        );
        cortarEscuchas.push(cortar);
      });
    },

    /**
     * Arranca. Espera sólo lo que hace falta para dibujar la pantalla de Año; el auto y la
     * quinta siguen cargando por atrás mientras ya estás viendo tus gastos.
     */
    async iniciar(sdk, base, cuandoCambie) {
      fb = sdk;
      db = base;
      alCambiar = cuandoCambie || (() => {});
      this.dejarDeEscuchar();

      const ESENCIALES = ['categorias', 'celdas', 'movimientos', 'subcategorias'];
      await Promise.all(ESENCIALES.map((c) => this.seguir(c)));
      Promise.all(COLECCIONES.filter((c) => !ESENCIALES.includes(c)).map((c) => this.seguir(c))).catch(avisarFalla);
    },

    dejarDeEscuchar() {
      cortarEscuchas.forEach((cortar) => cortar());
      cortarEscuchas = [];
    },
  };
})();
