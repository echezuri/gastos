// Arma las tablas que van al Sheet, con los nombres y columnas que espera el Apps Script.
// Lo usan tanto el exportador a CSV como el generador de Datos.gs.
const store = require('../db');

const q = (sql) => store.db.prepare(sql).all();

function tablas() {
  return [
    {
      nombre: 'Movimientos',
      columnas: ['id', 'anio', 'mes', 'dia', 'tipo', 'seccion', 'categoria', 'subcategoria', 'descripcion', 'moneda', 'monto_moneda', 'cotizacion', 'monto', 'pagado'],
      filas: q('SELECT * FROM movements ORDER BY year, month, id').map((m) => ({
        id: m.id,
        anio: m.year,
        mes: m.month,
        dia: m.day ?? '',
        tipo: m.kind,
        seccion: m.section,
        categoria: m.category,
        subcategoria: m.subcategory,
        descripcion: m.description,
        moneda: m.currency || 'ARS',
        monto_moneda: m.amount_currency ?? '',
        cotizacion: m.rate ?? '',
        monto: m.amount,
        pagado: Boolean(m.paid),
      })),
    },
    {
      nombre: 'Celdas',
      columnas: ['id', 'anio', 'seccion', 'categoria', 'mes', 'monto'],
      filas: q('SELECT * FROM cells ORDER BY year, section, category, month').map((c) => ({
        id: c.id,
        anio: c.year,
        seccion: c.section,
        categoria: c.category,
        mes: c.month,
        monto: c.amount,
      })),
    },
    {
      nombre: 'Categorias',
      columnas: ['id', 'anio', 'seccion', 'nombre', 'orden'],
      filas: q('SELECT * FROM categories ORDER BY year, section, position, id').map((c) => ({
        id: c.id,
        anio: c.year,
        seccion: c.section,
        nombre: c.name,
        orden: c.position,
      })),
    },
    {
      nombre: 'Subcategorias',
      columnas: ['id', 'seccion', 'categoria', 'nombre'],
      filas: q('SELECT * FROM subcategories ORDER BY id').map((s) => ({
        id: s.id,
        seccion: s.section,
        categoria: s.category,
        nombre: s.name,
      })),
    },
    {
      nombre: 'Auto',
      columnas: ['id', 'marca', 'modelo', 'anio', 'km', 'dominio', 'motor', 'chasis', 'precio_ars', 'precio_usd'],
      filas: q('SELECT * FROM vehicles ORDER BY id'),
    },
    {
      nombre: 'AutoServices',
      columnas: ['id', 'auto_id', 'km', 'detalle', 'mes', 'precio_ars', 'mano_obra_ars', 'total_usd', 'orden'],
      filas: q('SELECT * FROM services ORDER BY position, id').map((s) => ({ ...s, auto_id: s.vehicle_id, orden: s.position })),
    },
    {
      nombre: 'AutoPlan',
      columnas: ['id', 'auto_id', 'item', 'detalle', 'extra', 'orden'],
      filas: q('SELECT * FROM service_plan ORDER BY position, id').map((p) => ({ ...p, auto_id: p.vehicle_id, orden: p.position })),
    },
    {
      nombre: 'Quinta',
      columnas: ['id', 'rubro', 'detalle', 'monto_usd', 'orden'],
      filas: q('SELECT * FROM quinta_items ORDER BY position, id').map((i) => ({ ...i, orden: i.position })),
    },
    {
      nombre: 'QuintaPendientes',
      columnas: ['id', 'zona', 'texto', 'hecho', 'orden'],
      filas: q('SELECT * FROM quinta_todos ORDER BY position, id').map((t) => ({
        id: t.id,
        zona: t.zona,
        texto: t.texto,
        hecho: Boolean(t.hecho),
        orden: t.position,
      })),
    },
  ];
}

module.exports = { tablas };
