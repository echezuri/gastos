// Utilidad de diagnóstico: imprime celdas con índice de columna para un rango de filas
// del export markdown del sheet. Uso: node tools/inspect.js <desde> <hasta>
const fs = require('node:fs');
const path = require('node:path');

const raw = fs.readFileSync(path.join(__dirname, 'source', 'sheet.md'), 'utf8');
const rows = raw.split('\n').map((line) => {
  const cells = line.split('|');
  if (cells.length > 1) {
    cells.shift();
    cells.pop();
  }
  return cells.map((c) => c.trim());
});

const from = Number(process.argv[2] || 0);
const to = Number(process.argv[3] || from + 20);

for (let i = from; i <= to && i < rows.length; i++) {
  const cells = rows[i]
    .map((c, idx) => (c && c !== ':-:' ? `[${idx}]${c}` : null))
    .filter(Boolean);
  if (cells.length) console.log(`${i}: ${cells.join('  ')}`);
}
