// Vuelca la base actual a CSV, uno por pestaña, con los nombres y columnas que espera
// el Apps Script. Se importan al Sheet con Archivo > Importar > Insertar hojas nuevas.
//
// Uso: npm run export:sheets
const fs = require('node:fs');
const path = require('node:path');
const { tablas } = require('./tablas-para-sheets');

const destino = path.join(__dirname, '..', 'sheet-export');
fs.mkdirSync(destino, { recursive: true });

const csv = (valor) => {
  if (valor === null || valor === undefined) return '';
  const texto = String(valor);
  return /[",\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
};

function escribir(nombre, columnas, filas) {
  const lineas = [columnas.join(',')];
  for (const fila of filas) lineas.push(columnas.map((c) => csv(fila[c])).join(','));
  // BOM para que Google respete los acentos al importar
  fs.writeFileSync(path.join(destino, `${nombre}.csv`), '﻿' + lineas.join('\n'), 'utf8');
  console.log(`${nombre}.csv — ${filas.length} fila(s)`);
}

for (const { nombre, columnas, filas } of tablas()) {
  escribir(
    nombre,
    columnas,
    filas.map((f) => {
      const salida = {};
      for (const c of columnas) salida[c] = typeof f[c] === 'boolean' ? (f[c] ? 'TRUE' : 'FALSE') : f[c];
      return salida;
    })
  );
}

console.log(`\nListo. Los CSV están en ${destino}`);