// Ajustes de estructura pedidos después de la primera recategorización:
//   - AFIP deja de ser una sección y pasa a ser una categoría de gastos fijos
//   - nombres nuevos: Auto -> Vehículos, Raceboard -> Proyectos, etc.
//   - Cuidado personal se une a Salud (era un solo movimiento, la peluquería)
//
//   node tools/ajustar-categorias.js            -> muestra el plan
//   node tools/ajustar-categorias.js --aplicar  -> lo aplica
const store = require('../db');

const RENOMBRES = [
  { seccion: 'fijos', de: 'Running FX', a: 'FX Running' },
  { seccion: 'fijos', de: 'Jardín de infantes', a: 'Jardín Marco' },
  { seccion: 'fijos', de: 'Seguro auto', a: 'Seguro Cherokee' },
  { seccion: 'fijos', de: 'Patente auto', a: 'Patente Cherokee' },
  { seccion: 'variables', de: 'Auto', a: 'Vehículos' },
  { seccion: 'variables', de: 'Raceboard', a: 'Proyectos' },
  { seccion: 'variables', de: 'Cuidado personal', a: 'Salud' },
];

function totalesDeControl() {
  const filas = store.db
    .prepare(
      `SELECT year, month, SUM(amount) AS total FROM (
         SELECT year, month, amount FROM cells
         UNION ALL SELECT year, month, amount FROM movements WHERE paid = 1
       ) GROUP BY year, month ORDER BY year, month`
    )
    .all();
  return Object.fromEntries(filas.map((f) => [`${f.year}-${f.month}`, Math.round(f.total)]));
}

function main() {
  const aplicar = process.argv.includes('--aplicar');
  const antes = totalesDeControl();

  const afip = store.db.prepare("SELECT * FROM cells WHERE section = 'afip'").all();
  const porMes = {};
  for (const c of afip) {
    const clave = `${c.year}-${c.month}`;
    porMes[clave] = (porMes[clave] || 0) + c.amount;
  }
  console.log(`AFIP: ${afip.length} celdas de ${Object.keys(porMes).length} meses pasan a Gastos fijos / AFIP`);
  console.log(`  (se suma monotributo + autónomo en una sola fila por mes)`);

  for (const r of RENOMBRES) {
    const n = store.db
      .prepare('SELECT COUNT(*) AS n FROM categories WHERE section = ? AND name = ?')
      .get(r.seccion, r.de).n;
    if (n) console.log(`${r.seccion}: "${r.de}" -> "${r.a}" (${n} año/s)`);
  }

  if (!aplicar) {
    console.log('\nEsto es el plan. Para aplicarlo: node tools/ajustar-categorias.js --aplicar');
    return;
  }

  store.transaction(() => {
    // AFIP: de sección propia a categoría de fijos, sumando las dos filas por mes
    for (const [clave, monto] of Object.entries(porMes)) {
      const [year, month] = clave.split('-').map(Number);
      store.setCell({ year, section: 'fijos', category: 'AFIP', month, amount: monto });
    }
    store.db.prepare("DELETE FROM cells WHERE section = 'afip'").run();
    store.db.prepare("DELETE FROM categories WHERE section = 'afip'").run();
    store.db.prepare("UPDATE movements SET section = 'fijos', category = 'AFIP' WHERE section = 'afip'").run();

    for (const r of RENOMBRES) {
      const años = store.db
        .prepare('SELECT DISTINCT year FROM categories WHERE section = ? AND name = ?')
        .all(r.seccion, r.de);
      for (const { year } of años) {
        store.renameCategory({ year, section: r.seccion, from: r.de, to: r.a });
      }
    }

    // Deja el orden de las categorías alfabético dentro de cada sección y año
    const secciones = store.db.prepare('SELECT DISTINCT year, section FROM categories').all();
    for (const { year, section } of secciones) {
      const nombres = store.db
        .prepare('SELECT name FROM categories WHERE year = ? AND section = ? ORDER BY position, id')
        .all(year, section)
        .map((c) => c.name);
      nombres.forEach((nombre, i) => {
        store.db
          .prepare('UPDATE categories SET position = ? WHERE year = ? AND section = ? AND name = ?')
          .run(i, year, section, nombre);
      });
    }

    const despues = totalesDeControl();
    const claves = new Set([...Object.keys(antes), ...Object.keys(despues)]);
    const rotos = [...claves].filter((k) => (antes[k] || 0) !== (despues[k] || 0));
    if (rotos.length) {
      throw new Error(`Los totales cambiaron en ${rotos.length} mes(es): ${rotos.slice(0, 5).join(', ')}`);
    }
    console.log(`\nControl ok: los ${claves.size} totales mensuales quedaron intactos.`);
  });

  console.log('Ajustes aplicados.');
}

if (require.main === module) main();
