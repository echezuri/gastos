// Del backup que baja la app (⚙ → Bajar backup) a filas limpias.
//
// El backup es exactamente lo que tenía la planilla: matrices con encabezado, donde todo
// puede venir como texto, como "VERDADERO", o vacío. Acá se traduce una sola vez, y el
// resultado sirve para cualquier destino.
//
// Los nombres de campo son los mismos que tenían las pestañas del Sheet (anio, mes,
// seccion…) a propósito: así la lógica de la app sigue leyendo las mismas claves.

// Pestaña del Sheet -> colección
const COLECCIONES = {
  Categorias: 'categorias',
  Celdas: 'celdas',
  Movimientos: 'movimientos',
  Subcategorias: 'subcategorias',
  Auto: 'autos',
  AutoServices: 'auto_services',
  AutoPlan: 'auto_plan',
  Quinta: 'quinta',
  QuintaPendientes: 'quinta_pendientes',
};

const BOOLEANAS = new Set(['pagado', 'hecho']);
const ENTERAS = new Set(['id', 'anio', 'mes', 'dia', 'orden', 'auto_id']);
const NUMERICAS = new Set(['monto', 'monto_moneda', 'cotizacion', 'monto_usd', 'precio_ars', 'precio_usd', 'mano_obra_ars', 'total_usd']);
// En autos, "anio" y "km" son texto libre ("2014 / 2015"), no números
const TEXTO_IGUAL = { autos: new Set(['anio', 'km']) };

const vacio = (v) => v === '' || v === null || v === undefined;

function convertirValor(coleccion, campo, valor) {
  if (BOOLEANAS.has(campo)) {
    return valor === true || valor === 1 || valor === '1' || valor === 'true' || valor === 'TRUE' || valor === 'VERDADERO';
  }
  // El texto vacío se queda en '', nunca en null: la lógica de la app espera cadenas y
  // así un campo que falta y uno vacío son la misma cosa.
  const esNumero = (ENTERAS.has(campo) || NUMERICAS.has(campo)) && !TEXTO_IGUAL[coleccion]?.has(campo);
  if (!esNumero) return valor === null || valor === undefined ? '' : String(valor);
  if (vacio(valor)) return null; // dia, cotización y precios sí pueden no estar
  const n = Number(valor);
  if (!Number.isFinite(n)) return null;
  return ENTERAS.has(campo) ? Math.round(n) : n;
}

/** Una pestaña del backup (matriz con encabezado) a filas. */
function filasDeLaPestana(coleccion, matriz) {
  if (!matriz || matriz.length < 2) return [];
  const encabezado = (matriz[0] || []).map((c) => String(c ?? '').trim());
  const filas = [];
  for (let i = 1; i < matriz.length; i++) {
    const cruda = matriz[i] || [];
    if (cruda.every(vacio)) continue;
    const fila = {};
    encabezado.forEach((campo, c) => {
      if (!campo) return;
      fila[campo] = convertirValor(coleccion, campo, cruda[c]);
    });
    if (fila.id === null || fila.id === undefined || fila.id === '') continue; // sin id no hay identidad
    filas.push(fila);
  }
  return filas;
}

/** Todas las colecciones de un backup, listas para subir. */
function filasDelBackup(crudo) {
  const pestanas = crudo.tablas || crudo;
  const porColeccion = {};
  for (const [pestana, coleccion] of Object.entries(COLECCIONES)) {
    porColeccion[coleccion] = filasDeLaPestana(coleccion, pestanas[pestana]);
  }
  return porColeccion;
}

/** Lo que no va a entrar, dicho antes de intentarlo. */
function revisar(coleccion, filas) {
  const problemas = [];
  const vistos = new Set();
  for (const f of filas) {
    if (vistos.has(f.id)) problemas.push(`id repetido: ${f.id}`);
    vistos.add(f.id);
    if (coleccion === 'movimientos') {
      if (f.monto === null) problemas.push(`movimiento ${f.id} sin monto`);
      if (!['gasto', 'ingreso'].includes(f.tipo)) problemas.push(`movimiento ${f.id} con tipo "${f.tipo}"`);
      if (!(f.mes >= 1 && f.mes <= 12)) problemas.push(`movimiento ${f.id} con mes ${f.mes}`);
    }
    if (coleccion === 'celdas' && f.monto === null) problemas.push(`celda ${f.id} sin monto`);
  }
  return problemas;
}

/** Los totales por mes: el invariante que tiene que sobrevivir a la migración. */
function totalesPorMes(porColeccion) {
  const total = {};
  const sumar = (anio, mes, monto) => {
    const k = `${anio}-${String(mes).padStart(2, '0')}`;
    total[k] = (total[k] || 0) + (monto || 0);
  };
  (porColeccion.celdas || []).forEach((c) => sumar(c.anio, c.mes, c.monto));
  (porColeccion.movimientos || []).forEach((m) => {
    if (m.pagado) sumar(m.anio, m.mes, m.monto);
  });
  return total;
}

module.exports = {
  COLECCIONES, ENTERAS, NUMERICAS,
  convertirValor, filasDeLaPestana, filasDelBackup, revisar, totalesPorMes,
};
