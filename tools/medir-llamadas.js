// Cuenta las idas y vueltas al servidor y las lecturas de pestañas que hacen las dos
// operaciones que más se sienten: abrir la app y cargar un gasto.
//
// En Apps Script cada llamada cuesta cientos de milisegundos de ida y vuelta, así que
// bajar la cantidad de llamadas es lo que se nota.
//
// Uso: node tools/medir-llamadas.js
const fs = require('node:fs');
const path = require('node:path');
const { crearPlanilla, cargarCodigo } = require('./planilla-simulada');

function parsearCsv(texto) {
  const filas = [];
  let fila = [];
  let campo = '';
  let comillas = false;
  const limpio = texto.replace(/^﻿/, '');
  for (let i = 0; i < limpio.length; i++) {
    const c = limpio[i];
    if (comillas) {
      if (c === '"' && limpio[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (c === '"') comillas = false;
      else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === ',') {
      fila.push(campo);
      campo = '';
    } else if (c === '\n') {
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = '';
    } else if (c !== '\r') campo += c;
  }
  if (campo !== '' || fila.length) {
    fila.push(campo);
    filas.push(fila);
  }
  return filas;
}

const convertir = (v) => (v === '' ? '' : v === 'TRUE' ? true : v === 'FALSE' ? false : /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v);

function datosDeCsv() {
  const dir = path.join(__dirname, '..', 'sheet-export');
  const datos = {};
  for (const archivo of fs.readdirSync(dir)) {
    if (!archivo.endsWith('.csv')) continue;
    datos[archivo.replace('.csv', '')] = parsearCsv(fs.readFileSync(path.join(dir, archivo), 'utf8')).map((f) => f.map(convertir));
  }
  return datos;
}

const planilla = crearPlanilla(datosDeCsv());

// Instrumentamos la planilla para contar cuántas veces se lee cada pestaña
let lecturas = 0;
let escrituras = 0;
const original = planilla.api.getActive;
planilla.api.getActive = () => {
  const libro = original();
  const getSheetByName = libro.getSheetByName;
  libro.getSheetByName = (nombre) => {
    const h = getSheetByName(nombre);
    if (!h) return h;
    const getDataRange = h.getDataRange;
    h.getDataRange = () => {
      lecturas++;
      return getDataRange();
    };
    const appendRow = h.appendRow;
    h.appendRow = (f) => {
      escrituras++;
      return appendRow(f);
    };
    const getRange = h.getRange;
    h.getRange = (...args) => {
      const r = getRange(...args);
      const setValue = r.setValue;
      const setValues = r.setValues;
      r.setValue = (v) => {
        escrituras++;
        return setValue(v);
      };
      r.setValues = (v) => {
        escrituras++;
        return setValues(v);
      };
      return r;
    };
    return h;
  };
  return libro;
};

const ctx = cargarCodigo(planilla, ['Codigo.gs']);

function medir(nombre, pasos) {
  lecturas = 0;
  escrituras = 0;
  let llamadas = 0;
  for (const paso of pasos) {
    llamadas++;
    ctx.llamar(paso[0], paso[1], paso[2]);
  }
  console.log(
    `${nombre.padEnd(28)} ${String(llamadas).padStart(2)} llamada(s) · ${String(lecturas).padStart(3)} lectura(s) de pestaña · ${escrituras} escritura(s)`
  );
  return { llamadas, lecturas, escrituras };
}

const anio = 2026;
const mes = 7;
const vista = { year: anio, month: mes };
const gasto = {
  year: anio, month: mes, day: 15, kind: 'gasto', section: 'variables',
  category: 'Comida afuera', subcategory: 'Medición', amount: 1000, paid: true,
};

console.log('Antes (una llamada por cada cosa que necesitaba la pantalla):\n');

const abrirAntes = medir('abrir la app', [
  ['GET', '/api/years'],
  ['GET', '/api/catalog'],
  ['GET', `/api/year/${anio}`],
  ['GET', `/api/movements?year=${anio}&month=${mes}`],
]);

const cargarAntes = medir('cargar un gasto', [
  ['POST', '/api/movements', gasto],
  ['GET', '/api/catalog'],
  ['GET', `/api/year/${anio}`],
  ['GET', `/api/movements?year=${anio}&month=${mes}`],
]);

console.log('\nAhora (una sola llamada, que ya vuelve con todo):\n');

const abrirAhora = medir('abrir la app', [['GET', `/api/bootstrap?year=${anio}&month=${mes}`]]);
const cargarAhora = medir('cargar un gasto', [['POST', '/api/movements', { ...gasto, vista }]]);
const cuotasAhora = medir('cargar 6 cuotas', [
  ['POST', '/api/movements', { ...gasto, subcategory: 'Medición cuotas', cuotas: 6, vista }],
]);

const antes = abrirAntes.llamadas + cargarAntes.llamadas;
const ahora = abrirAhora.llamadas + cargarAhora.llamadas;
const lecturasAntes = abrirAntes.lecturas + cargarAntes.lecturas;
const lecturasAhora = abrirAhora.lecturas + cargarAhora.lecturas;

console.log(`\nAbrir + cargar un gasto: ${antes} llamadas -> ${ahora}`);
console.log(`Lecturas de pestaña:     ${lecturasAntes} -> ${lecturasAhora}`);
console.log(`Cargar 6 cuotas:         ${cuotasAhora.escrituras} escritura(s) en vez de una por cuota`);
