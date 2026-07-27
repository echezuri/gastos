// Copia de seguridad: guarda un JSON con todo y una copia del archivo .db
// Uso: npm run backup
const fs = require('node:fs');
const path = require('node:path');
const store = require('../db');

const dir = path.join(__dirname, '..', 'data', 'backups');
fs.mkdirSync(dir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const jsonPath = path.join(dir, `gastos-${stamp}.json`);
const dbPath = path.join(dir, `gastos-${stamp}.db`);

fs.writeFileSync(jsonPath, JSON.stringify(store.exportAll(), null, 2), 'utf8');
store.db.exec(`VACUUM INTO '${dbPath.replace(/\\/g, '/').replace(/'/g, "''")}'`);

console.log(`Backup listo:\n  ${jsonPath}\n  ${dbPath}`);
