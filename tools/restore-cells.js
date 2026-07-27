// Repone celdas puntuales tomando el valor del sheet original.
// Uso: node tools/restore-cells.js "2026 fijos LUZ TRI 9 250000" ["..."]
// Sin argumentos no hace nada: es una herramienta de rescate, no de importación.
const store = require('../db');

const entries = process.argv.slice(2);
if (!entries.length) {
  console.log('Nada para reponer. Pasá entradas como "2026 fijos GAS 9 30000".');
  process.exit(0);
}

store.transaction(() => {
  for (const entry of entries) {
    const parts = entry.trim().split(/\s+/);
    const [year, section] = parts;
    const amount = Number(parts[parts.length - 1]);
    const month = Number(parts[parts.length - 2]);
    const category = parts.slice(2, parts.length - 2).join(' ');
    store.setCell({ year: Number(year), section, category, month, amount });
    console.log(`${year} ${section} ${category} mes ${month} = ${amount}`);
  }
});
