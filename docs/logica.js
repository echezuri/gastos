// GENERADO por "npm run build:pwa" desde apps-script/Codigo.gs — no editar acá.
//
// Es la misma lógica que corre adentro del Google Sheet. En el navegador trabaja contra
// la copia local de la planilla (almacen-local.js), y por eso responde al instante.
'use strict';

/**
 * Gastos — toda la lógica de la app, en un solo lado.
 *
 * No sabe dónde están los datos. Habla con un almacén (ver más abajo) que le da filas por
 * colección y le acepta cambios por id; atrás hay Firestore, o un objeto en memoria cuando
 * corren las pruebas. Por eso lo mismo que ves en el teléfono es lo que se prueba acá.
 */

// AFIP dejó de ser una sección: ahora es una categoría de gastos fijos.
const SECCIONES = ['ingresos', 'fijos', 'tarjetas', 'variables', 'ahorro'];

// Las colecciones de la base. El almacén las carga y las escucha; acá sólo se nombran.
const TABLAS = [
  'categorias', 'celdas', 'movimientos', 'subcategorias',
  'autos', 'auto_services', 'auto_plan', 'quinta', 'quinta_pendientes',
];

const TIP_LIMITE = 8;

// ---------------------------------------------------------------- acceso a los datos

/**
 * De dónde salen las filas y a dónde van.
 *
 * Nada de acá abajo sabe qué hay atrás: sólo pide filas por colección y las cambia por id.
 * Quien arranca la app pone el almacén: "datos-firebase.js" contra Firestore en la app de
 * verdad, "tools/almacen-memoria.js" en las pruebas.
 *
 * Todo es sincrónico a propósito. La app trabaja contra una copia en memoria que se
 * mantiene al día sola, así la pantalla contesta en el acto y nunca queda a medio camino.
 */
function leer(coleccion) {
  return ALMACEN.filas(coleccion);
}

function insertar(coleccion, datos) {
  return ALMACEN.agregar(coleccion, datos);
}

/** Varias de una: las cuotas de una compra entran juntas. */
function insertarVarios(coleccion, lista) {
  return lista.map(function (datos) { return ALMACEN.agregar(coleccion, datos); });
}

function actualizar(coleccion, id, cambios) {
  return ALMACEN.cambiar(coleccion, id, cambios);
}

function borrar(coleccion, id) {
  return ALMACEN.quitar(coleccion, id);
}

function borrarDonde(coleccion, condicion) {
  const filas = leer(coleccion).filter(condicion);
  filas.forEach(function (f) { ALMACEN.quitar(coleccion, f.id); });
  return filas.length;
}


const numero = function (v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
};

const texto = function (v) { return v === null || v === undefined ? '' : String(v); };
const bool = function (v) { return v === true || v === 1 || v === '1' || v === 'true' || v === 'TRUE' || v === 'VERDADERO'; };

// ---------------------------------------------------------------- lectura del año

function categoriaVacia(nombre) {
  const meses = function () { return [null, null, null, null, null, null, null, null, null, null, null, null]; };
  return {
    name: nombre,
    months: meses(),
    base: meses(),
    moves: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    moved: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    pending: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    tips: [[], [], [], [], [], [], [], [], [], [], [], []],
    // Cuánto puso cada subcategoría en el año. Sale de los movimientos pagados: lo cargado
    // a mano en la grilla es un monto suelto por mes y no tiene subcategoría.
    subs: {},
  };
}

function lineaTip(mov) {
  const detalle = [mov.subcategoria, mov.descripcion].filter(function (t) { return t; }).join(' — ') || 'sin detalle';
  const monto = Number(mov.monto).toLocaleString('es-AR');
  const enDolares = texto(mov.moneda) === 'USD' && mov.monto_moneda
    ? ' [US$' + Number(mov.monto_moneda).toLocaleString('es-AR') + ' × $' + Number(mov.cotizacion).toLocaleString('es-AR') + ']'
    : '';
  return (mov.dia ? mov.dia + '. ' : '') + detalle + ': $' + monto + enDolares + (bool(mov.pagado) ? '' : ' (sin pagar)');
}

function armarAnio(anio) {
  anio = Number(anio);
  const secciones = {};
  SECCIONES.forEach(function (s) { secciones[s] = { categories: [] }; });
  const indice = {};

  const obtener = function (seccion, nombre) {
    const clave = seccion + '|' + nombre;
    if (!indice[clave]) {
      if (!secciones[seccion]) secciones[seccion] = { categories: [] };
      const cat = categoriaVacia(nombre);
      secciones[seccion].categories.push(cat);
      indice[clave] = cat;
    }
    return indice[clave];
  };

  leer('categorias')
    .filter(function (c) { return Number(c.anio) === anio; })
    .sort(function (a, b) { return (Number(a.orden) || 0) - (Number(b.orden) || 0); })
    .forEach(function (c) { obtener(texto(c.seccion), texto(c.nombre)); });

  leer('celdas')
    .filter(function (c) { return Number(c.anio) === anio; })
    .forEach(function (c) {
      const cat = obtener(texto(c.seccion), texto(c.categoria));
      cat.base[Number(c.mes) - 1] = numero(c.monto);
    });

  const pendientes = [];
  leer('movimientos')
    .filter(function (m) { return Number(m.anio) === anio; })
    .forEach(function (m) {
      const cat = obtener(texto(m.seccion), texto(m.categoria));
      const i = Number(m.mes) - 1;
      cat.moves[i]++;
      if (cat.tips[i].length < TIP_LIMITE) cat.tips[i].push(lineaTip(m));
      const monto = Number(m.monto) || 0;
      if (bool(m.pagado)) {
        cat.months[i] = (cat.months[i] || 0) + monto;
        cat.moved[i] += monto;
        const sub = texto(m.subcategoria).trim() || 'Sin subcategoría';
        cat.subs[sub] = (cat.subs[sub] || 0) + monto;
      } else {
        cat.pending[i] += monto;
        pendientes.push(movimientoApp(m));
      }
    });

  Object.keys(secciones).forEach(function (s) {
    secciones[s].categories.forEach(function (cat) {
      for (let i = 0; i < 12; i++) {
        const extra = cat.moves[i] - cat.tips[i].length;
        if (extra > 0) cat.tips[i].push('y ' + extra + ' más…');
        if (cat.base[i] === null && cat.months[i] === null) continue;
        cat.months[i] = (cat.base[i] || 0) + (cat.months[i] || 0);
      }
    });
  });

  return { year: anio, sections: secciones, pending: pendientes };
}

/** Traduce una fila de la planilla al formato que espera la app. */
function movimientoApp(m) {
  return {
    id: Number(m.id),
    year: Number(m.anio),
    month: Number(m.mes),
    day: numero(m.dia),
    kind: texto(m.tipo) || 'gasto',
    section: texto(m.seccion),
    category: texto(m.categoria),
    subcategory: texto(m.subcategoria),
    description: texto(m.descripcion),
    currency: texto(m.moneda) || 'ARS',
    amount_currency: numero(m.monto_moneda),
    rate: numero(m.cotizacion),
    amount: Number(m.monto) || 0,
    paid: bool(m.pagado) ? 1 : 0,
  };
}

function aniosCargados() {
  const anios = {};
  ['movimientos', 'celdas', 'categorias'].forEach(function (t) {
    leer(t).forEach(function (f) { if (f.anio) anios[Number(f.anio)] = true; });
  });
  const lista = Object.keys(anios).map(Number).sort();
  return lista.length ? lista : [new Date().getFullYear()];
}

// ---------------------------------------------------------------- revisión

/**
 * Para comparar nombres escritos de dos maneras: el sheet viejo usaba MAYÚSCULAS y sin
 * espacios ("PLATAFORMA5") donde la taxonomía nueva usa otra ("Plataforma 5"). Los espacios
 * se van, pero el resto de los signos no: "HAL" y "HAL +" son cosas distintas.
 */
function claveDeNombre(nombre) {
  return texto(nombre).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '');
}

/**
 * Lo que conviene mirar antes de sanear, junto en una sola respuesta. Sólo lee.
 *
 * La app trabaja de a un año por vez, así que sola no puede ver que "INTERNET" de 2022 y
 * "Internet" de 2025 son lo mismo. Esto mira todos los años de una.
 */
function revisarDatos() {
  const categorias = leer('categorias');
  const celdas = leer('celdas');
  const movimientos = leer('movimientos');

  // Una entrada por categoría (sin importar el año), con dónde y cuánto se usa.
  const usos = {};
  const deCategoria = function (seccion, nombre) {
    const clave = seccion + '|' + nombre;
    if (!usos[clave]) usos[clave] = { section: seccion, name: nombre, years: {}, celdas: 0, movs: 0, total: 0 };
    return usos[clave];
  };
  categorias.forEach(function (c) {
    deCategoria(texto(c.seccion), texto(c.nombre)).years[Number(c.anio)] = true;
  });
  celdas.forEach(function (c) {
    const u = deCategoria(texto(c.seccion), texto(c.categoria));
    u.years[Number(c.anio)] = true;
    if (numero(c.monto)) {
      u.celdas++;
      u.total += Number(c.monto);
    }
  });
  movimientos.forEach(function (m) {
    const u = deCategoria(texto(m.seccion), texto(m.categoria));
    u.years[Number(m.anio)] = true;
    u.movs++;
    if (bool(m.pagado)) u.total += Number(m.monto) || 0;
  });

  const lista = Object.keys(usos).map(function (k) {
    const u = usos[k];
    return {
      section: u.section, name: u.name, celdas: u.celdas, movs: u.movs, total: u.total,
      years: Object.keys(u.years).map(Number).sort(),
    };
  });

  // Nombres distintos para lo mismo. Se comparan entre secciones también: así aparece la
  // categoría que quedó cargada en dos lados.
  const porClave = {};
  lista.forEach(function (u) {
    const k = claveDeNombre(u.name);
    if (!porClave[k]) porClave[k] = [];
    porClave[k].push(u);
  });
  const parecidas = Object.keys(porClave)
    .filter(function (k) { return porClave[k].length > 1; })
    .map(function (k) { return { key: k, options: porClave[k] }; });

  // Categorías declaradas que no tienen ni una celda con monto ni un movimiento.
  const vacias = lista.filter(function (u) { return u.celdas === 0 && u.movs === 0; });

  // Subcategorías del catálogo colgando de una categoría que no existe: basura de la
  // importación, no las ve nadie desde el formulario.
  const existeCategoria = {};
  lista.forEach(function (u) { existeCategoria[u.section + '|' + u.name] = true; });
  const usadas = {};
  movimientos.forEach(function (m) {
    if (texto(m.subcategoria)) usadas[texto(m.seccion) + '|' + texto(m.categoria) + '|' + texto(m.subcategoria)] = true;
  });

  const huerfanas = [];
  const sinUso = [];
  leer('subcategorias').forEach(function (s) {
    const fila = { section: texto(s.seccion), category: texto(s.categoria), name: texto(s.nombre) };
    if (!existeCategoria[fila.section + '|' + fila.category]) huerfanas.push(fila);
    else if (!usadas[fila.section + '|' + fila.category + '|' + fila.name]) sinUso.push(fila);
  });

  // 2022-2024 están en "Sin clasificar" a propósito (el sheet viejo marcaba la categoría
  // con el color de la celda). Lo que vale la pena mirar es lo reciente.
  const sinClasificar = {};
  movimientos.forEach(function (m) {
    if (texto(m.categoria) !== 'Sin clasificar') return;
    const anio = Number(m.anio);
    sinClasificar[anio] = (sinClasificar[anio] || 0) + 1;
  });

  return {
    parecidas: parecidas,
    vacias: vacias,
    huerfanas: huerfanas,
    sinUso: sinUso,
    sinClasificar: Object.keys(sinClasificar).map(Number).sort().map(function (a) {
      return { year: a, movs: sinClasificar[a] };
    }),
  };
}

// ---------------------------------------------------------------- escritura

function asegurarCategoria(anio, seccion, nombre) {
  const existentes = leer('categorias').filter(function (c) {
    return Number(c.anio) === Number(anio) && texto(c.seccion) === seccion && texto(c.nombre) === nombre;
  });
  if (existentes.length) return;
  const orden = leer('categorias').filter(function (c) {
    return Number(c.anio) === Number(anio) && texto(c.seccion) === seccion;
  }).length;
  insertar('categorias', { anio: Number(anio), seccion: seccion, nombre: nombre, orden: orden });
}

function normalizarMovimiento(datos, actual) {
  const base = actual || {};
  const seccion = texto(datos.section !== undefined ? datos.section : base.seccion);
  if (SECCIONES.indexOf(seccion) < 0) throw new Error('Sección inválida: ' + seccion);
  const mes = Number(datos.month !== undefined ? datos.month : base.mes);
  if (!(mes >= 1 && mes <= 12)) throw new Error('Mes inválido');
  const categoria = texto(datos.category !== undefined ? datos.category : base.categoria).trim();
  if (!categoria) throw new Error('Falta la categoría');
  const dia = numero(datos.day !== undefined ? datos.day : base.dia);
  const pagado = datos.paid !== undefined ? bool(datos.paid) : bool(base.pagado);

  // Lo cargado en dólares se guarda convertido a pesos, con su importe y cotización.
  const moneda = texto(datos.currency !== undefined ? datos.currency : base.moneda).toUpperCase() === 'USD' ? 'USD' : 'ARS';
  let monto = Number(datos.amount !== undefined ? datos.amount : base.monto);
  let montoMoneda = '';
  let cotizacion = '';
  if (moneda === 'USD') {
    montoMoneda = Number(datos.amount_currency !== undefined ? datos.amount_currency : base.monto_moneda);
    cotizacion = Number(datos.rate !== undefined ? datos.rate : base.cotizacion);
    if (isNaN(montoMoneda)) throw new Error('Importe en dólares inválido');
    if (isNaN(cotizacion) || cotizacion <= 0) throw new Error('Falta la cotización del dólar');
    monto = Math.round(montoMoneda * cotizacion * 100) / 100;
  }
  if (isNaN(monto)) throw new Error('Importe inválido');

  return {
    moneda: moneda,
    monto_moneda: montoMoneda,
    cotizacion: cotizacion,
    anio: Number(datos.year !== undefined ? datos.year : base.anio),
    mes: mes,
    dia: dia === null ? '' : dia,
    tipo: texto(datos.kind !== undefined ? datos.kind : base.tipo) || (seccion === 'ingresos' ? 'ingreso' : 'gasto'),
    seccion: seccion,
    categoria: categoria,
    subcategoria: texto(datos.subcategory !== undefined ? datos.subcategory : base.subcategoria).trim(),
    descripcion: texto(datos.description !== undefined ? datos.description : base.descripcion).trim(),
    monto: monto,
    pagado: pagado,
  };
}

function etiquetaDeSerie(descripcion, suscripcion, cuotas, numero) {
  if (suscripcion) return (descripcion ? descripcion + ' ' : '') + '(suscripción)';
  if (cuotas > 1) return (descripcion ? descripcion + ' ' : '') + '(cuota ' + numero + '/' + cuotas + ')';
  return descripcion;
}

function guardarSubcategoria(seccion, categoria, nombre) {
  if (!nombre) return;
  const existe = leer('subcategorias').some(function (s) {
    return texto(s.seccion) === seccion && texto(s.categoria) === categoria && texto(s.nombre) === nombre;
  });
  if (!existe) insertar('subcategorias', { seccion: seccion, categoria: categoria, nombre: nombre });
}

function ponerCelda(anio, seccion, categoria, mes, monto) {
  asegurarCategoria(anio, seccion, categoria);
  const actual = leer('celdas').filter(function (c) {
    return Number(c.anio) === Number(anio) && texto(c.seccion) === seccion &&
      texto(c.categoria) === categoria && Number(c.mes) === Number(mes);
  })[0];
  if (monto === null || monto === undefined || monto === '') {
    if (actual) borrar('celdas', actual.id);
    return;
  }
  if (actual) actualizar('celdas', actual.id, { monto: Number(monto) });
  else insertar('celdas', { anio: Number(anio), seccion: seccion, categoria: categoria, mes: Number(mes), monto: Number(monto) });
}

// ---------------------------------------------------------------- saneamiento

/** Deja una sola fila de Categorias por año: la fusión y los renombres viejos dejan dos. */
function dedupCategorias(seccion, nombre) {
  const vistas = {};
  leer('categorias')
    .filter(function (c) { return texto(c.seccion) === seccion && texto(c.nombre) === nombre; })
    .forEach(function (c) {
      const anio = Number(c.anio);
      if (vistas[anio]) borrar('categorias', c.id);
      else vistas[anio] = true;
    });
}

/**
 * Mete una categoría dentro de otra, en todos los años de una vez.
 *
 * Renombrar de a un año no alcanza: "INTERNET" vivió en 2022-2023 y "Internet" en
 * 2023-2026, así que en 2023 conviven las dos y sus celdas del mismo mes hay que sumarlas
 * en una sola. Los totales del mes no cambian.
 */
function fusionarCategoria(seccion, desde, hacia) {
  if (!hacia) throw new Error('Falta el nombre de la categoría que queda');
  if (!desde) throw new Error('Falta la categoría a fusionar');
  if (desde === hacia) return { ok: true, celdas: 0, movimientos: 0 };

  const todas = leer('celdas').filter(function (c) { return texto(c.seccion) === seccion; });
  const quedan = {};
  todas.filter(function (c) { return texto(c.categoria) === hacia; })
    .forEach(function (c) { quedan[Number(c.anio) + '|' + Number(c.mes)] = { id: c.id, monto: numero(c.monto) || 0 }; });

  const sumar = [];
  const renombrar = [];
  const sobran = [];
  todas.filter(function (c) { return texto(c.categoria) === desde; })
    .forEach(function (c) {
      const clave = Number(c.anio) + '|' + Number(c.mes);
      const monto = numero(c.monto) || 0;
      if (quedan[clave]) {
        quedan[clave].monto += monto;
        sumar.push(quedan[clave]);
        sobran.push(c.id);
      } else {
        renombrar.push(c.id);
        quedan[clave] = { id: c.id, monto: monto };
      }
    });

  // Primero lo que cambia de valor, y recién al final los borrados: cada operación vuelve a
  // leer la pestaña, así que las filas que se corren no son problema.
  sumar.forEach(function (d) { actualizar('celdas', d.id, { monto: d.monto }); });
  renombrar.forEach(function (id) { actualizar('celdas', id, { categoria: hacia }); });

  const movimientos = leer('movimientos')
    .filter(function (mv) { return texto(mv.seccion) === seccion && texto(mv.categoria) === desde; });
  movimientos.forEach(function (mv) { actualizar('movimientos', mv.id, { categoria: hacia }); });

  const yaEstan = {};
  leer('subcategorias')
    .filter(function (s) { return texto(s.seccion) === seccion && texto(s.categoria) === hacia; })
    .forEach(function (s) { yaEstan[texto(s.nombre)] = true; });
  const subsDuplicadas = [];
  leer('subcategorias')
    .filter(function (s) { return texto(s.seccion) === seccion && texto(s.categoria) === desde; })
    .forEach(function (s) {
      if (yaEstan[texto(s.nombre)]) subsDuplicadas.push(s.id);
      else {
        actualizar('subcategorias', s.id, { categoria: hacia });
        yaEstan[texto(s.nombre)] = true;
      }
    });

  // La categoría que queda tiene que existir en todos los años en los que existía la otra
  const anios = {};
  leer('categorias')
    .filter(function (c) { return texto(c.seccion) === seccion && texto(c.nombre) === desde; })
    .forEach(function (c) { anios[Number(c.anio)] = true; });
  Object.keys(anios).forEach(function (a) { asegurarCategoria(Number(a), seccion, hacia); });

  sobran.forEach(function (id) { borrar('celdas', id); });
  subsDuplicadas.forEach(function (id) { borrar('subcategorias', id); });
  borrarDonde('categorias', function (c) {
    return texto(c.seccion) === seccion && texto(c.nombre) === desde;
  });
  dedupCategorias(seccion, hacia);

  return { ok: true, celdas: sumar.length + renombrar.length, movimientos: movimientos.length };
}

/** Pasa una categoría entera de sección, en todos los años. */
function moverCategoriaDeSeccion(seccion, nombre, aSeccion) {
  if (SECCIONES.indexOf(aSeccion) < 0) throw new Error('Sección inválida: ' + aSeccion);
  if (!nombre) throw new Error('Falta la categoría');
  if (seccion === aSeccion) return { ok: true, celdas: 0, movimientos: 0 };

  const celdas = leer('celdas').filter(function (c) {
    return texto(c.seccion) === seccion && texto(c.categoria) === nombre;
  });
  celdas.forEach(function (c) { actualizar('celdas', c.id, { seccion: aSeccion }); });

  // El tipo acompaña a la sección: lo que se va a ingresos deja de ser un gasto.
  const tipo = aSeccion === 'ingresos' ? 'ingreso' : 'gasto';
  const movimientos = leer('movimientos').filter(function (mv) {
    return texto(mv.seccion) === seccion && texto(mv.categoria) === nombre;
  });
  movimientos.forEach(function (mv) { actualizar('movimientos', mv.id, { seccion: aSeccion, tipo: tipo }); });

  leer('subcategorias')
    .filter(function (s) { return texto(s.seccion) === seccion && texto(s.categoria) === nombre; })
    .forEach(function (s) { actualizar('subcategorias', s.id, { seccion: aSeccion }); });

  const anios = {};
  leer('categorias')
    .filter(function (c) { return texto(c.seccion) === seccion && texto(c.nombre) === nombre; })
    .forEach(function (c) { anios[Number(c.anio)] = true; });
  Object.keys(anios).forEach(function (a) { asegurarCategoria(Number(a), aSeccion, nombre); });
  borrarDonde('categorias', function (c) {
    return texto(c.seccion) === seccion && texto(c.nombre) === nombre;
  });
  dedupCategorias(aSeccion, nombre);

  return { ok: true, celdas: celdas.length, movimientos: movimientos.length };
}

/**
 * Convierte celdas de la grilla en movimientos pagados, con subcategoría.
 *
 * Las celdas son un monto suelto por mes y no admiten subcategoría; los movimientos sí. Es
 * la única forma de que un ingreso cargado a mano pueda decir si fue sueldo o aguinaldo.
 * La celda que muestra la grilla es celda + movimientos pagados, así que el mes no cambia.
 *
 * `filas` deja poner una subcategoría distinta por mes; sin ella van todas con `subcategory`.
 */
function celdasAMovimientos(cuerpo) {
  const seccion = texto(cuerpo.section);
  const categoria = texto(cuerpo.category);
  const aSeccion = texto(cuerpo.toSection) || seccion;
  const aCategoria = texto(cuerpo.toCategory).trim() || categoria;
  const porDefecto = texto(cuerpo.subcategory).trim();
  if (SECCIONES.indexOf(aSeccion) < 0) throw new Error('Sección inválida: ' + aSeccion);

  const elegidas = {};
  const hayFiltro = Array.isArray(cuerpo.filas) && cuerpo.filas.length > 0;
  if (hayFiltro) {
    cuerpo.filas.forEach(function (f) {
      elegidas[Number(f.year) + '|' + Number(f.month)] = texto(f.subcategory).trim();
    });
  }

  const celdas = leer('celdas').filter(function (c) {
    if (texto(c.seccion) !== seccion || texto(c.categoria) !== categoria) return false;
    return !hayFiltro || elegidas[Number(c.anio) + '|' + Number(c.mes)] !== undefined;
  });
  if (!celdas.length) return { ok: true, movimientos: 0 };

  const nuevos = celdas.map(function (c) {
    const clave = Number(c.anio) + '|' + Number(c.mes);
    const sub = hayFiltro && elegidas[clave] ? elegidas[clave] : porDefecto;
    return {
      anio: Number(c.anio), mes: Number(c.mes), dia: '',
      tipo: aSeccion === 'ingresos' ? 'ingreso' : 'gasto',
      seccion: aSeccion, categoria: aCategoria, subcategoria: sub, descripcion: '',
      moneda: 'ARS', monto_moneda: '', cotizacion: '',
      monto: numero(c.monto) || 0, pagado: true,
    };
  });

  const anios = {};
  nuevos.forEach(function (n) { anios[n.anio] = true; });
  Object.keys(anios).forEach(function (a) { asegurarCategoria(Number(a), aSeccion, aCategoria); });
  nuevos.forEach(function (n) { guardarSubcategoria(aSeccion, aCategoria, n.subcategoria); });
  insertarVarios('movimientos', nuevos);
  celdas.forEach(function (c) { borrar('celdas', c.id); });

  return { ok: true, movimientos: nuevos.length };
}

// ---------------------------------------------------------------- la API que usa la app

/**
 * Un único punto de entrada, con las mismas rutas que tenía el servidor. Así la
 * interfaz es exactamente la misma en la PC y acá adentro.
 */
function llamarApi(metodo, ruta, cuerpo) {
  try {
    const cuerpoOk = cuerpo || {};
    const respuesta = despachar(metodo, ruta, cuerpoOk);
    // Las escrituras devuelven de una el estado actualizado de lo que estás mirando:
    // así la app no tiene que volver a preguntar y se ahorra otra ida y vuelta.
    if (metodo !== 'GET' && cuerpoOk.vista && respuesta && !respuesta.error) {
      respuesta.estado = estadoDeVista(cuerpoOk.vista);
    }
    return JSON.stringify(respuesta);
  } catch (err) {
    return JSON.stringify({ error: err.message || String(err) });
  }
}

/** Lo que la pantalla necesita para redibujarse: el año, los movimientos del mes y el catálogo. */
function estadoDeVista(vista) {
  const anio = Number(vista.year);
  const mes = Number(vista.month);
  const estado = { year: armarAnio(anio), years: aniosCargados() };
  if (mes >= 1 && mes <= 12) {
    estado.movements = despachar('GET', '/api/movements?year=' + anio + '&month=' + mes +
      (vista.section ? '&section=' + encodeURIComponent(vista.section) : '') +
      (vista.category ? '&category=' + encodeURIComponent(vista.category) : ''), {}).movements;
  }
  estado.catalog = despachar('GET', '/api/catalog', {});
  return estado;
}

function despachar(metodo, ruta, cuerpo) {
  const partes = ruta.split('?');
  const camino = partes[0];
  const params = {};
  if (partes[1]) {
    partes[1].split('&').forEach(function (p) {
      const kv = p.split('=');
      params[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || '');
    });
  }

  // Todo lo que hace falta para abrir la app, en una sola ida y vuelta
  if (metodo === 'GET' && camino === '/api/bootstrap') {
    return estadoDeVista({ year: Number(params.year) || new Date().getFullYear(), month: Number(params.month) || 1 });
  }

  if (metodo === 'GET' && camino === '/api/years') return { years: aniosCargados() };

  let m = camino.match(/^\/api\/year\/(\d{4})$/);
  if (m && metodo === 'GET') return armarAnio(m[1]);
  if (m && metodo === 'POST') {
    const desde = Number(cuerpo.copyFrom);
    const hasta = Number(m[1]);
    leer('categorias')
      .filter(function (c) { return Number(c.anio) === desde; })
      .forEach(function (c) { asegurarCategoria(hasta, texto(c.seccion), texto(c.nombre)); });
    return armarAnio(hasta);
  }

  if (camino === '/api/cell' && metodo === 'PUT') {
    ponerCelda(cuerpo.year, cuerpo.section, cuerpo.category, cuerpo.month, cuerpo.amount);
    return { ok: true };
  }

  // ---- saneamiento: las tres operaciones van sobre todos los años de una vez ----

  if (camino === '/api/category/merge' && metodo === 'POST') {
    return fusionarCategoria(texto(cuerpo.section), texto(cuerpo.from), texto(cuerpo.to).trim());
  }

  if (camino === '/api/category/move' && metodo === 'POST') {
    return moverCategoriaDeSeccion(texto(cuerpo.section), texto(cuerpo.name), texto(cuerpo.toSection));
  }

  if (camino === '/api/subcategory' && metodo === 'DELETE') {
    const borradas = borrarDonde('subcategorias', function (s) {
      return texto(s.seccion) === texto(cuerpo.section) &&
        texto(s.categoria) === texto(cuerpo.category) &&
        (cuerpo.name === undefined || texto(s.nombre) === texto(cuerpo.name));
    });
    return { ok: true, borradas: borradas };
  }

  if (camino === '/api/cells-to-movements' && metodo === 'POST') {
    return celdasAMovimientos(cuerpo);
  }

  if (camino === '/api/category') {
    const anio = Number(cuerpo.year);
    const seccion = texto(cuerpo.section);
    if (metodo === 'POST') {
      asegurarCategoria(anio, seccion, texto(cuerpo.name).trim());
      return { ok: true };
    }
    if (metodo === 'PATCH' && cuerpo.direction) {
      const lista = leer('categorias')
        .filter(function (c) { return Number(c.anio) === anio && texto(c.seccion) === seccion; })
        .sort(function (a, b) { return (Number(a.orden) || 0) - (Number(b.orden) || 0); });
      const i = lista.map(function (c) { return texto(c.nombre); }).indexOf(texto(cuerpo.name));
      const j = cuerpo.direction === 'up' ? i - 1 : i + 1;
      if (i >= 0 && j >= 0 && j < lista.length) {
        const tmp = lista[i];
        lista[i] = lista[j];
        lista[j] = tmp;
        lista.forEach(function (c, idx) { actualizar('categorias', c.id, { orden: idx }); });
      }
      return { ok: true };
    }
    if (metodo === 'PATCH') {
      const desde = texto(cuerpo.from);
      const hacia = texto(cuerpo.to).trim();
      if (!hacia || desde === hacia) return { ok: true };
      leer('categorias')
        .filter(function (c) { return Number(c.anio) === anio && texto(c.seccion) === seccion && texto(c.nombre) === desde; })
        .forEach(function (c) { actualizar('categorias', c.id, { nombre: hacia }); });
      leer('celdas')
        .filter(function (c) { return Number(c.anio) === anio && texto(c.seccion) === seccion && texto(c.categoria) === desde; })
        .forEach(function (c) { actualizar('celdas', c.id, { categoria: hacia }); });
      leer('movimientos')
        .filter(function (mv) { return Number(mv.anio) === anio && texto(mv.seccion) === seccion && texto(mv.categoria) === desde; })
        .forEach(function (mv) { actualizar('movimientos', mv.id, { categoria: hacia }); });
      leer('subcategorias')
        .filter(function (s) { return texto(s.seccion) === seccion && texto(s.categoria) === desde; })
        .forEach(function (s) { actualizar('subcategorias', s.id, { categoria: hacia }); });
      return { ok: true };
    }
    if (metodo === 'DELETE') {
      const nombre = texto(cuerpo.name);
      borrarDonde('celdas', function (c) {
        return Number(c.anio) === anio && texto(c.seccion) === seccion && texto(c.categoria) === nombre;
      });
      borrarDonde('movimientos', function (mv) {
        return Number(mv.anio) === anio && texto(mv.seccion) === seccion && texto(mv.categoria) === nombre;
      });
      borrarDonde('categorias', function (c) {
        return Number(c.anio) === anio && texto(c.seccion) === seccion && texto(c.nombre) === nombre;
      });
      return { ok: true };
    }
  }

  if (camino === '/api/movements' && metodo === 'GET') {
    const anio = Number(params.year);
    const mes = Number(params.month);
    let filas = leer('movimientos').filter(function (mv) {
      return Number(mv.anio) === anio && Number(mv.mes) === mes;
    });
    if (params.section && params.category) {
      filas = filas.filter(function (mv) {
        return texto(mv.seccion) === params.section && texto(mv.categoria) === params.category;
      });
    }
    filas.sort(function (a, b) { return (Number(a.dia) || 0) - (Number(b.dia) || 0) || Number(a.id) - Number(b.id); });
    return { movements: filas.map(movimientoApp) };
  }

  if (camino === '/api/movements' && metodo === 'POST') {
    const datos = normalizarMovimiento(cuerpo);
    // En cuotas se repite el importe los meses siguientes; una suscripción, hasta
    // diciembre. El mes rueda al año que viene cuando hace falta.
    const cuotas = Math.max(1, Math.min(Number(cuerpo.cuotas) || 1, 60));
    const suscripcion = cuerpo.suscripcion === true || cuerpo.suscripcion === 'true';
    const repeticiones = suscripcion ? Math.max(1, 13 - datos.mes) : cuotas;
    const cuotasAGuardar = [];
    for (let i = 0; i < repeticiones; i++) {
      const mesAbsoluto = datos.mes - 1 + i;
      const cuota = {};
      Object.keys(datos).forEach(function (k) { cuota[k] = datos[k]; });
      cuota.anio = datos.anio + Math.floor(mesAbsoluto / 12);
      cuota.mes = (mesAbsoluto % 12) + 1;
      cuota.descripcion = etiquetaDeSerie(datos.descripcion, suscripcion, cuotas, i + 1);
      asegurarCategoria(cuota.anio, cuota.seccion, cuota.categoria);
      cuotasAGuardar.push(cuota);
    }
    guardarSubcategoria(datos.seccion, datos.categoria, datos.subcategoria);
    const ids = insertarVarios('movimientos', cuotasAGuardar);
    return { id: ids.length === 1 ? ids[0] : ids };
  }

  m = camino.match(/^\/api\/movements\/(\d+)$/);
  if (m && metodo === 'PUT') {
    const actual = leer('movimientos').filter(function (mv) { return Number(mv.id) === Number(m[1]); })[0];
    if (!actual) throw new Error('No existe el movimiento');
    const datos = normalizarMovimiento(cuerpo, actual);
    asegurarCategoria(datos.anio, datos.seccion, datos.categoria);
    guardarSubcategoria(datos.seccion, datos.categoria, datos.subcategoria);
    actualizar('movimientos', m[1], datos);
    return { ok: true };
  }
  if (m && metodo === 'DELETE') {
    borrar('movimientos', m[1]);
    return { ok: true };
  }

  if (camino === '/api/catalog' && metodo === 'GET') {
    const catalogo = {};
    SECCIONES.forEach(function (s) { catalogo[s] = []; });
    leer('categorias').forEach(function (c) {
      const s = texto(c.seccion);
      if (!catalogo[s]) catalogo[s] = [];
      if (catalogo[s].indexOf(texto(c.nombre)) < 0) catalogo[s].push(texto(c.nombre));
    });
    Object.keys(catalogo).forEach(function (s) { catalogo[s].sort(); });
    return {
      catalog: catalogo,
      subcategories: leer('subcategorias').map(function (s) {
        return { section: texto(s.seccion), category: texto(s.categoria), name: texto(s.nombre) };
      }),
    };
  }

  if (camino === '/api/subcategories' && metodo === 'GET') {
    return {
      subcategories: leer('subcategorias').map(function (s) {
        return { section: texto(s.seccion), category: texto(s.categoria), name: texto(s.nombre) };
      }),
    };
  }

  if (camino === '/api/revision' && metodo === 'GET') return revisarDatos();

  if (camino === '/api/vehicles' && metodo === 'GET') {
    const services = leer('auto_services');
    const plan = leer('auto_plan');
    return {
      vehicles: leer('autos').map(function (v) {
        return {
          id: Number(v.id),
          marca: texto(v.marca), modelo: texto(v.modelo), anio: texto(v.anio), km: texto(v.km),
          dominio: texto(v.dominio), motor: texto(v.motor), chasis: texto(v.chasis),
          precio_ars: numero(v.precio_ars), precio_usd: numero(v.precio_usd),
          services: services.filter(function (s) { return Number(s.auto_id) === Number(v.id); })
            .sort(function (a, b) { return (Number(a.orden) || 0) - (Number(b.orden) || 0); })
            .map(function (s) {
              return {
                id: Number(s.id), vehicle_id: Number(s.auto_id), km: texto(s.km), detalle: texto(s.detalle),
                mes: texto(s.mes), precio_ars: numero(s.precio_ars), mano_obra_ars: numero(s.mano_obra_ars),
                total_usd: numero(s.total_usd), position: Number(s.orden) || 0,
              };
            }),
          plan: plan.filter(function (p) { return Number(p.auto_id) === Number(v.id); })
            .sort(function (a, b) { return (Number(a.orden) || 0) - (Number(b.orden) || 0); })
            .map(function (p) {
              return { id: Number(p.id), vehicle_id: Number(p.auto_id), item: texto(p.item), detalle: texto(p.detalle), extra: texto(p.extra), position: Number(p.orden) || 0 };
            }),
        };
      }),
    };
  }

  if (camino === '/api/quinta' && metodo === 'GET') {
    const items = leer('quinta').sort(function (a, b) { return (Number(a.orden) || 0) - (Number(b.orden) || 0); });
    const rubros = [];
    const porRubro = {};
    items.forEach(function (it) {
      const nombre = texto(it.rubro);
      if (!porRubro[nombre]) {
        porRubro[nombre] = { rubro: nombre, items: [] };
        rubros.push(porRubro[nombre]);
      }
      porRubro[nombre].items.push({ id: Number(it.id), rubro: nombre, detalle: texto(it.detalle), monto_usd: numero(it.monto_usd), position: Number(it.orden) || 0 });
    });
    return {
      rubros: rubros,
      todos: leer('quinta_pendientes')
        .sort(function (a, b) { return (Number(a.orden) || 0) - (Number(b.orden) || 0); })
        .map(function (t) {
          return { id: Number(t.id), zona: texto(t.zona), texto: texto(t.texto), hecho: bool(t.hecho) ? 1 : 0, position: Number(t.orden) || 0 };
        }),
    };
  }

  // Tablas simples del auto y la quinta
  const TABLA_DE_RUTA = {
    vehicles: 'autos',
    services: 'auto_services',
    service_plan: 'auto_plan',
    quinta_items: 'quinta',
    quinta_todos: 'quinta_pendientes',
  };
  const CAMPOS = {
    services: { vehicle_id: 'auto_id', position: 'orden' },
    service_plan: { vehicle_id: 'auto_id', position: 'orden' },
    quinta_items: { position: 'orden' },
    quinta_todos: { position: 'orden' },
  };

  m = camino.match(/^\/api\/rows\/(\w+)(?:\/(\d+))?$/);
  if (m && TABLA_DE_RUTA[m[1]]) {
    const tabla = TABLA_DE_RUTA[m[1]];
    const mapa = CAMPOS[m[1]] || {};
    const datos = {};
    Object.keys(cuerpo).forEach(function (k) { datos[mapa[k] || k] = cuerpo[k]; });
    if (metodo === 'POST') return { id: insertar(tabla, datos) };
    if (metodo === 'PUT') { actualizar(tabla, m[2], datos); return { ok: true }; }
    if (metodo === 'DELETE') {
      if (tabla === 'autos') {
        borrarDonde('auto_services', function (s) { return Number(s.auto_id) === Number(m[2]); });
        borrarDonde('auto_plan', function (p) { return Number(p.auto_id) === Number(m[2]); });
      }
      borrar(tabla, m[2]);
      return { ok: true };
    }
  }

  throw new Error('Ruta no encontrada: ' + metodo + ' ' + camino);
}

