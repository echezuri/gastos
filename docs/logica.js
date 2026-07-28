// GENERADO por "npm run build:pwa" desde apps-script/Codigo.gs — no editar acá.
//
// Es la misma lógica que corre adentro del Google Sheet. En el navegador trabaja contra
// la copia local de la planilla (almacen-local.js), y por eso responde al instante.
'use strict';

/**
 * Gastos — la planilla es la base de datos.
 *
 * Este archivo corre adentro del Google Sheet (Extensiones > Apps Script). No hay
 * servidor: Google publica la app y estas funciones leen y escriben las pestañas.
 *
 * Pestañas que usa (las crea solas si no están):
 *   Movimientos · Celdas · Categorias · Subcategorias
 *   Auto · AutoServices · AutoPlan · Quinta · QuintaPendientes
 *
 * Los bloques originales del sheet no se tocan.
 */

// AFIP dejó de ser una sección: ahora es una categoría de gastos fijos.
const SECCIONES = ['ingresos', 'fijos', 'tarjetas', 'variables', 'ahorro'];

const TABLAS = {
  Movimientos: ['id', 'anio', 'mes', 'dia', 'tipo', 'seccion', 'categoria', 'subcategoria', 'descripcion', 'moneda', 'monto_moneda', 'cotizacion', 'monto', 'pagado'],
  Celdas: ['id', 'anio', 'seccion', 'categoria', 'mes', 'monto'],
  Categorias: ['id', 'anio', 'seccion', 'nombre', 'orden'],
  Subcategorias: ['id', 'seccion', 'categoria', 'nombre'],
  Auto: ['id', 'marca', 'modelo', 'anio', 'km', 'dominio', 'motor', 'chasis', 'precio_ars', 'precio_usd'],
  AutoServices: ['id', 'auto_id', 'km', 'detalle', 'mes', 'precio_ars', 'mano_obra_ars', 'total_usd', 'orden'],
  AutoPlan: ['id', 'auto_id', 'item', 'detalle', 'extra', 'orden'],
  Quinta: ['id', 'rubro', 'detalle', 'monto_usd', 'orden'],
  QuintaPendientes: ['id', 'zona', 'texto', 'hecho', 'orden'],
};

const TIP_LIMITE = 8;

// ---------------------------------------------------------------- la app

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Gastos')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Atajo desde el menú de la planilla. */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Gastos')
    .addItem('Abrir la app', 'mostrarApp')
    .addToUi();
}

function mostrarApp() {
  const html = HtmlService.createTemplateFromFile('Index').evaluate().setWidth(1400).setHeight(900);
  SpreadsheetApp.getUi().showModalDialog(html, 'Gastos');
}

/**
 * Chequeo rápido de la planilla. Se corre desde el editor de Apps Script (botón Ejecutar)
 * y el resultado se ve en el registro de ejecución: dice qué pestañas encontró y cuántas
 * filas tiene cada una. Sirve para descartar que el problema sea la importación.
 */
function diagnostico() {
  const libro = SpreadsheetApp.getActive();
  const existentes = libro.getSheets().map(function (h) { return h.getName(); });
  Logger.log('Pestañas del documento: ' + existentes.join(', '));
  Object.keys(TABLAS).forEach(function (nombre) {
    if (existentes.indexOf(nombre) < 0) {
      Logger.log('FALTA la pestaña ' + nombre);
      return;
    }
    const filas = leer(nombre);
    const encabezados = libro.getSheetByName(nombre).getDataRange().getValues()[0] || [];
    const faltan = TABLAS[nombre].filter(function (c) { return encabezados.indexOf(c) < 0; });
    Logger.log(
      nombre + ': ' + filas.length + ' fila(s)' + (faltan.length ? '  — faltan columnas: ' + faltan.join(', ') : '')
    );
  });
  Logger.log('Años con datos: ' + aniosCargados().join(', '));
  return 'listo, mirá el registro de ejecución';
}

// ---------------------------------------------------------------- acceso a las pestañas

function hoja(nombre) {
  const libro = SpreadsheetApp.getActive();
  let h = libro.getSheetByName(nombre);
  if (!h) {
    h = libro.insertSheet(nombre);
    h.appendRow(TABLAS[nombre]);
    h.setFrozenRows(1);
  }
  return h;
}

/**
 * Cada pestaña se lee una sola vez por llamada. Leer una hoja cuesta caro y una misma
 * operación consulta varias veces las mismas tablas, así que se memorizan mientras dura
 * la llamada y se olvidan apenas se escribe algo.
 */
let MEMORIA = {};
let ENCABEZADOS = {};

function olvidar(nombre) {
  // El encabezado no cambia al escribir filas: sólo se olvida todo junto, al empezar
  // otra llamada.
  if (nombre) delete MEMORIA[nombre];
  else {
    MEMORIA = {};
    ENCABEZADOS = {};
  }
}

/** Devuelve las filas como objetos, más el número de fila real para poder editarlas. */
function leer(nombre) {
  if (MEMORIA[nombre]) return MEMORIA[nombre];
  const valores = hoja(nombre).getDataRange().getValues();
  const encabezados = (valores[0] || []).map(texto);
  while (encabezados.length && encabezados[encabezados.length - 1] === '') encabezados.pop();
  ENCABEZADOS[nombre] = encabezados;
  const filas = [];
  for (let i = 1; i < valores.length; i++) {
    if (valores[i].every(function (v) { return v === '' || v === null; })) continue;
    const obj = { _fila: i + 1 };
    for (let c = 0; c < encabezados.length; c++) obj[encabezados[c]] = valores[i][c];
    filas.push(obj);
  }
  MEMORIA[nombre] = filas;
  return filas;
}

/**
 * Los nombres de columna tal como están en la pestaña, no como los lista TABLAS.
 *
 * Las filas se leen por el encabezado del Sheet y se escriben por posición, así que si los
 * dos no coinciden cada dato cae en la columna equivocada y se pierde sin avisar. Manda el
 * encabezado real; las columnas que le falten se agregan al final una sola vez.
 */
function columnas(nombre) {
  leer(nombre); // deja ENCABEZADOS[nombre] al día
  const actuales = ENCABEZADOS[nombre];
  const faltan = TABLAS[nombre].filter(function (c) { return actuales.indexOf(c) < 0; });
  if (!faltan.length) return actuales;
  const completas = actuales.concat(faltan);
  hoja(nombre).getRange(1, 1, 1, completas.length).setValues([completas]);
  ENCABEZADOS[nombre] = completas;
  olvidar(nombre);
  return completas;
}

function proximoId(nombre) {
  const filas = leer(nombre);
  let max = 0;
  filas.forEach(function (f) { max = Math.max(max, Number(f.id) || 0); });
  return max + 1;
}

function filaDe(nombre, datos, id) {
  return columnas(nombre).map(function (col) {
    return col === 'id' ? id : datos[col] === undefined || datos[col] === null ? '' : datos[col];
  });
}

function insertar(nombre, datos) {
  return insertarVarios(nombre, [datos])[0];
}

/** Varias filas de una sola escritura: seis cuotas cuestan lo mismo que una. */
function insertarVarios(nombre, lista) {
  if (!lista.length) return [];
  const h = hoja(nombre);
  const cols = columnas(nombre); // antes de leer: puede completar el encabezado
  const filasActuales = leer(nombre);
  let id = proximoId(nombre);
  const ids = [];
  const matriz = lista.map(function (datos) {
    ids.push(id);
    const fila = filaDe(nombre, datos, id);
    id++;
    return fila;
  });
  const desde = filasActuales.length ? filasActuales[filasActuales.length - 1]._fila + 1 : 2;
  h.getRange(desde, 1, matriz.length, cols.length).setValues(matriz);
  olvidar(nombre);
  return ids;
}

function actualizar(nombre, id, cambios) {
  const cols = columnas(nombre); // antes de leer: puede completar el encabezado
  const filas = leer(nombre);
  const fila = filas.filter(function (f) { return Number(f.id) === Number(id); })[0];
  if (!fila) return false;
  const h = hoja(nombre);
  // Una sola escritura con la fila entera en vez de una por columna
  const actualizada = cols.map(function (col) {
    const valor = cambios[col] !== undefined ? cambios[col] : fila[col];
    return col === 'id' ? Number(fila.id) : valor === null || valor === undefined ? '' : valor;
  });
  h.getRange(fila._fila, 1, 1, cols.length).setValues([actualizada]);
  olvidar(nombre);
  return true;
}

function borrar(nombre, id) {
  const filas = leer(nombre);
  const fila = filas.filter(function (f) { return Number(f.id) === Number(id); })[0];
  if (!fila) return false;
  hoja(nombre).deleteRow(fila._fila);
  olvidar(nombre);
  return true;
}

function borrarDonde(nombre, condicion) {
  const filas = leer(nombre).filter(condicion);
  const h = hoja(nombre);
  // de abajo hacia arriba, para que no se corran los números de fila
  filas.sort(function (a, b) { return b._fila - a._fila; }).forEach(function (f) { h.deleteRow(f._fila); });
  if (filas.length) olvidar(nombre);
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

  leer('Categorias')
    .filter(function (c) { return Number(c.anio) === anio; })
    .sort(function (a, b) { return (Number(a.orden) || 0) - (Number(b.orden) || 0); })
    .forEach(function (c) { obtener(texto(c.seccion), texto(c.nombre)); });

  leer('Celdas')
    .filter(function (c) { return Number(c.anio) === anio; })
    .forEach(function (c) {
      const cat = obtener(texto(c.seccion), texto(c.categoria));
      cat.base[Number(c.mes) - 1] = numero(c.monto);
    });

  const pendientes = [];
  leer('Movimientos')
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
  ['Movimientos', 'Celdas', 'Categorias'].forEach(function (t) {
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
  const categorias = leer('Categorias');
  const celdas = leer('Celdas');
  const movimientos = leer('Movimientos');

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
  leer('Subcategorias').forEach(function (s) {
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
  const existentes = leer('Categorias').filter(function (c) {
    return Number(c.anio) === Number(anio) && texto(c.seccion) === seccion && texto(c.nombre) === nombre;
  });
  if (existentes.length) return;
  const orden = leer('Categorias').filter(function (c) {
    return Number(c.anio) === Number(anio) && texto(c.seccion) === seccion;
  }).length;
  insertar('Categorias', { anio: Number(anio), seccion: seccion, nombre: nombre, orden: orden });
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
  const existe = leer('Subcategorias').some(function (s) {
    return texto(s.seccion) === seccion && texto(s.categoria) === categoria && texto(s.nombre) === nombre;
  });
  if (!existe) insertar('Subcategorias', { seccion: seccion, categoria: categoria, nombre: nombre });
}

function ponerCelda(anio, seccion, categoria, mes, monto) {
  asegurarCategoria(anio, seccion, categoria);
  const actual = leer('Celdas').filter(function (c) {
    return Number(c.anio) === Number(anio) && texto(c.seccion) === seccion &&
      texto(c.categoria) === categoria && Number(c.mes) === Number(mes);
  })[0];
  if (monto === null || monto === undefined || monto === '') {
    if (actual) borrar('Celdas', actual.id);
    return;
  }
  if (actual) actualizar('Celdas', actual.id, { monto: Number(monto) });
  else insertar('Celdas', { anio: Number(anio), seccion: seccion, categoria: categoria, mes: Number(mes), monto: Number(monto) });
}

// ---------------------------------------------------------------- la API que usa la app

/**
 * Un único punto de entrada, con las mismas rutas que tenía el servidor. Así la
 * interfaz es exactamente la misma en la PC y acá adentro.
 */
function llamarApi(metodo, ruta, cuerpo) {
  const candado = LockService.getDocumentLock();
  candado.waitLock(20000);
  olvidar();
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
  } finally {
    candado.releaseLock();
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
    leer('Categorias')
      .filter(function (c) { return Number(c.anio) === desde; })
      .forEach(function (c) { asegurarCategoria(hasta, texto(c.seccion), texto(c.nombre)); });
    return armarAnio(hasta);
  }

  if (camino === '/api/cell' && metodo === 'PUT') {
    ponerCelda(cuerpo.year, cuerpo.section, cuerpo.category, cuerpo.month, cuerpo.amount);
    return { ok: true };
  }

  if (camino === '/api/category') {
    const anio = Number(cuerpo.year);
    const seccion = texto(cuerpo.section);
    if (metodo === 'POST') {
      asegurarCategoria(anio, seccion, texto(cuerpo.name).trim());
      return { ok: true };
    }
    if (metodo === 'PATCH' && cuerpo.direction) {
      const lista = leer('Categorias')
        .filter(function (c) { return Number(c.anio) === anio && texto(c.seccion) === seccion; })
        .sort(function (a, b) { return (Number(a.orden) || 0) - (Number(b.orden) || 0); });
      const i = lista.map(function (c) { return texto(c.nombre); }).indexOf(texto(cuerpo.name));
      const j = cuerpo.direction === 'up' ? i - 1 : i + 1;
      if (i >= 0 && j >= 0 && j < lista.length) {
        const tmp = lista[i];
        lista[i] = lista[j];
        lista[j] = tmp;
        lista.forEach(function (c, idx) { actualizar('Categorias', c.id, { orden: idx }); });
      }
      return { ok: true };
    }
    if (metodo === 'PATCH') {
      const desde = texto(cuerpo.from);
      const hacia = texto(cuerpo.to).trim();
      if (!hacia || desde === hacia) return { ok: true };
      leer('Categorias')
        .filter(function (c) { return Number(c.anio) === anio && texto(c.seccion) === seccion && texto(c.nombre) === desde; })
        .forEach(function (c) { actualizar('Categorias', c.id, { nombre: hacia }); });
      leer('Celdas')
        .filter(function (c) { return Number(c.anio) === anio && texto(c.seccion) === seccion && texto(c.categoria) === desde; })
        .forEach(function (c) { actualizar('Celdas', c.id, { categoria: hacia }); });
      leer('Movimientos')
        .filter(function (mv) { return Number(mv.anio) === anio && texto(mv.seccion) === seccion && texto(mv.categoria) === desde; })
        .forEach(function (mv) { actualizar('Movimientos', mv.id, { categoria: hacia }); });
      leer('Subcategorias')
        .filter(function (s) { return texto(s.seccion) === seccion && texto(s.categoria) === desde; })
        .forEach(function (s) { actualizar('Subcategorias', s.id, { categoria: hacia }); });
      return { ok: true };
    }
    if (metodo === 'DELETE') {
      const nombre = texto(cuerpo.name);
      borrarDonde('Celdas', function (c) {
        return Number(c.anio) === anio && texto(c.seccion) === seccion && texto(c.categoria) === nombre;
      });
      borrarDonde('Movimientos', function (mv) {
        return Number(mv.anio) === anio && texto(mv.seccion) === seccion && texto(mv.categoria) === nombre;
      });
      borrarDonde('Categorias', function (c) {
        return Number(c.anio) === anio && texto(c.seccion) === seccion && texto(c.nombre) === nombre;
      });
      return { ok: true };
    }
  }

  if (camino === '/api/movements' && metodo === 'GET') {
    const anio = Number(params.year);
    const mes = Number(params.month);
    let filas = leer('Movimientos').filter(function (mv) {
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
    const ids = insertarVarios('Movimientos', cuotasAGuardar);
    return { id: ids.length === 1 ? ids[0] : ids };
  }

  m = camino.match(/^\/api\/movements\/(\d+)$/);
  if (m && metodo === 'PUT') {
    const actual = leer('Movimientos').filter(function (mv) { return Number(mv.id) === Number(m[1]); })[0];
    if (!actual) throw new Error('No existe el movimiento');
    const datos = normalizarMovimiento(cuerpo, actual);
    asegurarCategoria(datos.anio, datos.seccion, datos.categoria);
    guardarSubcategoria(datos.seccion, datos.categoria, datos.subcategoria);
    actualizar('Movimientos', m[1], datos);
    return { ok: true };
  }
  if (m && metodo === 'DELETE') {
    borrar('Movimientos', m[1]);
    return { ok: true };
  }

  if (camino === '/api/catalog' && metodo === 'GET') {
    const catalogo = {};
    SECCIONES.forEach(function (s) { catalogo[s] = []; });
    leer('Categorias').forEach(function (c) {
      const s = texto(c.seccion);
      if (!catalogo[s]) catalogo[s] = [];
      if (catalogo[s].indexOf(texto(c.nombre)) < 0) catalogo[s].push(texto(c.nombre));
    });
    Object.keys(catalogo).forEach(function (s) { catalogo[s].sort(); });
    return {
      catalog: catalogo,
      subcategories: leer('Subcategorias').map(function (s) {
        return { section: texto(s.seccion), category: texto(s.categoria), name: texto(s.nombre) };
      }),
    };
  }

  if (camino === '/api/subcategories' && metodo === 'GET') {
    return {
      subcategories: leer('Subcategorias').map(function (s) {
        return { section: texto(s.seccion), category: texto(s.categoria), name: texto(s.nombre) };
      }),
    };
  }

  if (camino === '/api/revision' && metodo === 'GET') return revisarDatos();

  if (camino === '/api/vehicles' && metodo === 'GET') {
    const services = leer('AutoServices');
    const plan = leer('AutoPlan');
    return {
      vehicles: leer('Auto').map(function (v) {
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
    const items = leer('Quinta').sort(function (a, b) { return (Number(a.orden) || 0) - (Number(b.orden) || 0); });
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
      todos: leer('QuintaPendientes')
        .sort(function (a, b) { return (Number(a.orden) || 0) - (Number(b.orden) || 0); })
        .map(function (t) {
          return { id: Number(t.id), zona: texto(t.zona), texto: texto(t.texto), hecho: bool(t.hecho) ? 1 : 0, position: Number(t.orden) || 0 };
        }),
    };
  }

  // Tablas simples del auto y la quinta
  const TABLA_DE_RUTA = {
    vehicles: 'Auto',
    services: 'AutoServices',
    service_plan: 'AutoPlan',
    quinta_items: 'Quinta',
    quinta_todos: 'QuintaPendientes',
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
      if (tabla === 'Auto') {
        borrarDonde('AutoServices', function (s) { return Number(s.auto_id) === Number(m[2]); });
        borrarDonde('AutoPlan', function (p) { return Number(p.auto_id) === Number(m[2]); });
      }
      borrar(tabla, m[2]);
      return { ok: true };
    }
  }

  throw new Error('Ruta no encontrada: ' + metodo + ' ' + camino);
}

