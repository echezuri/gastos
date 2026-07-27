// Recategoriza los movimientos con la taxonomía nueva.
//
//   node tools/recategorizar.js            -> muestra el plan, no toca nada
//   node tools/recategorizar.js --aplicar  -> lo aplica (en una transacción)
//
// Reglas del acuerdo con el usuario:
//   - 2025 y 2026: categorías y subcategorías nuevas; el texto original queda como
//     descripción, así no se pierde nada.
//   - 2024 y anteriores: todo a "Sin clasificar". En 2022/2023 el sheet usaba colores
//     para marcar la categoría y las filas eran sólo la leyenda, así que el detalle de
//     esos años no es recuperable (los importes y los meses sí están bien).
//   - La compra de dólares y los saldos con Ampi salen de "gastos": son ahorro y
//     separación de gastos, no consumo.
const store = require('../db');

const DESDE = 2025;

// Reglas en orden: gana la primera que coincide con el detalle del movimiento.
// Las primeras resuelven los casos que, por las palabras que usan, caerían en la
// categoría equivocada más abajo ("Almacen Hamburguesas Sole" es el almacén, no
// una hamburguesería; la nafta de Córdoba es parte del viaje a la carrera).
const REGLAS = [
  [/almacen/i, 'variables', 'Supermercado y almacén', 'Almacén y chino'],
  [/chino/i, 'variables', 'Supermercado y almacén', 'Almacén y chino'],
  [/dosificador/i, 'variables', 'Compras', 'Hogar y bazar'],
  [/ampi/i, 'ahorro', 'Gastos compartidos', 'Saldos con Ampi'],
  [/cordoba/i, 'variables', 'Running', 'Viaje y traslado'],
  [/remeras algod/i, 'variables', 'Running', 'Equipamiento'],
  [/bandas elasticas|soporte bici/i, 'variables', 'Compras', 'Deporte'],
  [/^sole$/i, 'variables', 'Auto', 'Lavado'],
  [/pizza/i, 'variables', 'Comida afuera', 'Pizza y rotisería'],

  // Ahorro y separación de gastos: no son gasto
  [/compra usd|compra mep|^usd$|^mep$/i, 'ahorro', 'Ahorro en dólares', 'Compra de dólares'],

  // Running: inscripción, viaje, alojamiento, comida, equipamiento
  [/^nb 21k|vuelta municipio|maraton|carrera/i, 'variables', 'Running', 'Inscripción'],
  [/novablast/i, 'variables', 'Running', 'Equipamiento'],

  // Raceboard (el proyecto propio, que también genera ingresos)
  [/raceboard/i, 'variables', 'Raceboard', 'Dominio y hosting'],

  // Auto
  [/nafta|combustible/i, 'variables', 'Auto', 'Combustible'],
  [/gnc/i, 'variables', 'Auto', 'GNC'],
  [/vtv|carnet/i, 'variables', 'Auto', 'VTV y trámites'],
  [/lavado/i, 'variables', 'Auto', 'Lavado'],
  [/servive|service|frenos|repuesto/i, 'variables', 'Auto', 'Service y repuestos'],
  [/remis/i, 'variables', 'Auto', 'Remis'],

  // Mascotas
  [/drogo|old prince|dogui|^alimento$/i, 'variables', 'Mascotas', 'Alimento'],
  [/veterinaria/i, 'variables', 'Mascotas', 'Veterinaria'],

  // Casa
  [/nati/i, 'variables', 'Casa', 'Limpieza'],
  [/pileta|cloro|bomba/i, 'variables', 'Casa', 'Pileta'],
  [/plomero|electricista|gasista|mano de obra/i, 'variables', 'Casa', 'Mano de obra'],
  [/materiales|ferreteria|termica|disyuntor|pintureria/i, 'variables', 'Casa', 'Materiales y ferretería'],

  // Salud
  [/swiss medical|prepaga/i, 'variables', 'Salud', 'Prepaga'],
  [/farmacia|dermaglos|diclo/i, 'variables', 'Salud', 'Farmacia'],
  [/medico/i, 'variables', 'Salud', 'Médico'],

  [/peluqueria/i, 'variables', 'Cuidado personal', 'Peluquería'],

  // Comida afuera
  [/tico|casserisimo|ñoquis|noquis|cocinarte|rotiseria/i, 'variables', 'Comida afuera', 'Pizza y rotisería'],
  [/mostaza|burrito|food truck|hamburguesa|panqueque/i, 'variables', 'Comida afuera', 'Comida rápida'],
  [/asado|chori|picada/i, 'variables', 'Comida afuera', 'Asados y juntadas'],
  [/helado/i, 'variables', 'Comida afuera', 'Heladería'],

  // Supermercado y almacén
  [/super|chango|carrefour|t(e)?res estrellas|autoservicio|mas online/i, 'variables', 'Supermercado y almacén', 'Supermercado'],
  [/verdura|carniceria|canelones/i, 'variables', 'Supermercado y almacén', 'Carnicería y verdulería'],
  [/panaderia|^pan$/i, 'variables', 'Supermercado y almacén', 'Panadería'],
  [/leche|coca|nutrilon/i, 'variables', 'Supermercado y almacén', 'Almacén y chino'],
  [/kiosco|gomitas|golosina/i, 'variables', 'Supermercado y almacén', 'Kiosco'],

  // Compras
  [/garmin|celular|telefono|microsd/i, 'variables', 'Compras', 'Tecnología'],
  [/waflera|ventilador|dispenser|vaso|dosificador|hamaca|camara|pelota|pico/i, 'variables', 'Compras', 'Hogar y bazar'],
  [/^open$|zapatilla|^nb /i, 'variables', 'Compras', 'Deporte'],
  [/^full$|^ml full$|^ml /i, 'variables', 'Compras', 'Otros'],
];

// Renombres en gastos fijos (LUZ MONO y LUZ TRI quedan separadas: son dos medidores).
const RENOMBRES_FIJOS = [
  ['37SUR', 'Internet'],
  ['JARDIN', 'Jardín de infantes'],
  ['18AYB', 'Impuestos lotes 18A/18B'],
  ['MORATORIA (9)', 'Moratoria AFIP'],
  ['P5', 'Plataforma 5'],
  ['FX', 'Running FX'],
  ['SEGURO JEEP', 'Seguro auto'],
  ['PATENTE JEEP', 'Patente auto'],
  ['GYM', 'Gimnasio'],
  ['LUZ MONO', 'Luz monofásica'],
  ['LUZ TRI', 'Luz trifásica'],
  ['GAS', 'Gas'],
  ['JARDIN DE INFANTES', 'Jardín de infantes'],
];

const SIN_CLASIFICAR = 'Sin clasificar';

function clasificar(detalle) {
  for (const [regex, section, category, subcategory] of REGLAS) {
    if (regex.test(detalle)) return { section, category, subcategory };
  }
  return null;
}

/** Total mensual de todo lo que sale de plata: tiene que quedar igual antes y después. */
function totalesDeControl() {
  const rows = store.db
    .prepare(
      `SELECT year, month, SUM(amount) AS total FROM (
         SELECT year, month, amount FROM cells WHERE section IN ('afip','fijos','tarjetas','variables','ahorro')
         UNION ALL
         SELECT year, month, amount FROM movements WHERE section IN ('afip','fijos','tarjetas','variables','ahorro') AND paid = 1
       ) GROUP BY year, month ORDER BY year, month`
    )
    .all();
  return Object.fromEntries(rows.map((r) => [`${r.year}-${r.month}`, Math.round(r.total)]));
}

function main() {
  const aplicar = process.argv.includes('--aplicar');
  const antes = totalesDeControl();

  const movimientos = store.db.prepare('SELECT * FROM movements ORDER BY year, month, id').all();
  const plan = [];
  const sinRegla = [];

  for (const mov of movimientos) {
    if (mov.section !== 'variables' && mov.section !== 'ahorro') continue;
    const detalle = (mov.subcategory || mov.category || '').trim();

    if (mov.year < DESDE) {
      const limpiar = mov.year <= 2023; // en esos años el detalle venía de la leyenda de colores
      plan.push({
        mov,
        section: 'variables',
        category: SIN_CLASIFICAR,
        subcategory: limpiar ? '' : mov.subcategory,
        description: mov.description,
      });
      continue;
    }

    const regla = clasificar(detalle);
    if (!regla) sinRegla.push(`${mov.year}-${String(mov.month).padStart(2, '0')} ${detalle || '(sin detalle)'}`);
    plan.push({
      mov,
      section: regla ? regla.section : 'variables',
      category: regla ? regla.category : SIN_CLASIFICAR,
      subcategory: regla ? regla.subcategory : '',
      // el texto original pasa a ser la descripción: no se pierde nada
      description: mov.description || detalle,
    });
  }

  // La limpieza doméstica no es un gasto fijo: se paga por visita.
  const celdasNati = store.db
    .prepare("SELECT * FROM cells WHERE section = 'fijos' AND category = 'NATI' AND year >= ?")
    .all(DESDE);

  console.log(`Movimientos a recategorizar: ${plan.length}`);
  console.log(`Celdas de NATI que pasan a Casa / Limpieza: ${celdasNati.length}`);

  const resumen = {};
  for (const p of plan.filter((p) => p.mov.year >= DESDE)) {
    const clave = `${p.section === 'ahorro' ? '[no gasto] ' : ''}${p.category} / ${p.subcategory || '—'}`;
    resumen[clave] = resumen[clave] || { n: 0, total: 0 };
    resumen[clave].n++;
    resumen[clave].total += p.mov.amount;
  }
  console.log('\n=== 2025-2026 por categoría ===');
  for (const [clave, v] of Object.entries(resumen).sort((a, b) => b[1].total - a[1].total)) {
    console.log(`${clave.padEnd(46)} x${String(v.n).padStart(3)}  $${Math.round(v.total).toLocaleString('es-AR')}`);
  }

  if (sinRegla.length) {
    console.log(`\n=== Sin regla (van a "${SIN_CLASIFICAR}"): ${sinRegla.length} ===`);
    sinRegla.forEach((s) => console.log(`  ${s}`));
  }

  if (!aplicar) {
    console.log('\nEsto es sólo el plan. Para aplicarlo: node tools/recategorizar.js --aplicar');
    return;
  }

  store.transaction(() => {
    const update = store.db.prepare(
      'UPDATE movements SET section = ?, category = ?, subcategory = ?, description = ? WHERE id = ?'
    );
    for (const p of plan) {
      update.run(p.section, p.category, p.subcategory, p.description, p.mov.id);
      store.ensureCategory({ year: p.mov.year, section: p.section, name: p.category });
      if (p.subcategory) {
        store.db
          .prepare('INSERT INTO subcategories (section, category, name) VALUES (?, ?, ?) ON CONFLICT DO NOTHING')
          .run(p.section, p.category, p.subcategory);
      }
    }

    // NATI: de gasto fijo a movimiento de Casa / Limpieza
    for (const celda of celdasNati) {
      store.addMovement({
        year: celda.year,
        month: celda.month,
        section: 'variables',
        category: 'Casa',
        subcategory: 'Limpieza',
        description: 'Nati',
        amount: celda.amount,
        paid: true,
      });
      store.db.prepare('DELETE FROM cells WHERE id = ?').run(celda.id);
    }
    if (celdasNati.length) {
      store.db.prepare("DELETE FROM categories WHERE section = 'fijos' AND name = 'NATI' AND year >= ?").run(DESDE);
    }

    // Renombres de gastos fijos
    for (const [from, to] of RENOMBRES_FIJOS) {
      const años = store.db
        .prepare("SELECT DISTINCT year FROM categories WHERE section = 'fijos' AND name = ?")
        .all(from);
      for (const { year } of años) store.renameCategory({ year, section: 'fijos', from, to });
    }

    // Categorías que quedaron vacías (no tienen ni celdas ni movimientos)
    const huerfanas = store.db
      .prepare(
        `DELETE FROM categories WHERE NOT EXISTS (
           SELECT 1 FROM cells c WHERE c.year = categories.year AND c.section = categories.section AND c.category = categories.name
         ) AND NOT EXISTS (
           SELECT 1 FROM movements m WHERE m.year = categories.year AND m.section = categories.section AND m.category = categories.name
         )`
      )
      .run();
    console.log(`\nCategorías vacías eliminadas: ${huerfanas.changes}`);

    // Control: la plata que sale no puede haber cambiado
    const despues = totalesDeControl();
    const claves = new Set([...Object.keys(antes), ...Object.keys(despues)]);
    const rotos = [...claves].filter((k) => (antes[k] || 0) !== (despues[k] || 0));
    if (rotos.length) {
      throw new Error(
        `Los totales cambiaron en ${rotos.length} mes(es): ${rotos
          .slice(0, 5)
          .map((k) => `${k} ${antes[k] || 0} -> ${despues[k] || 0}`)
          .join(', ')}`
      );
    }
    console.log(`Control ok: los ${claves.size} totales mensuales quedaron intactos.`);
  });

  console.log('\nRecategorización aplicada.');
}

if (require.main === module) main();
