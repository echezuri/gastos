// Dos dispositivos contra el mismo Sheet, para comprobar que los cambios de uno no le caen
// encima a los registros del otro.
//
// El caso que importa: el teléfono borra una fila, todas las de abajo se corren un lugar, y
// la computadora —que todavía no bajó eso— manda una edición calculada con su copia vieja.
// Si la edición viajara con el número de fila, pisaría el movimiento equivocado.
//
// Uso: node tools/probar-sincronizacion.js
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

let pruebas = 0;
let fallas = 0;

function comprobar(nombre, condicion, detalle) {
  pruebas++;
  if (condicion) console.log(`  ok   ${nombre}`);
  else {
    fallas++;
    console.log(`  FALLA ${nombre}${detalle ? ` — ${detalle}` : ''}`);
  }
}

// ---------------------------------------------------------------- el Sheet de Google, falso

const LETRAS = (n) => {
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - r) / 26);
  }
  return s || 'A';
};
const numeroDeColumna = (letras) => [...letras].reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0);

/** Entiende lo poco de la API de Sheets que usa la app. */
function crearSheetFalso(tablas) {
  const datos = JSON.parse(JSON.stringify(tablas));
  const idsDeHoja = {};
  Object.keys(datos).forEach((n, i) => (idsDeHoja[n] = i + 1));
  let llamadas = 0;

  const parseRango = (rango) => {
    const [hojaCruda, a1 = ''] = decodeURIComponent(rango).split('!');
    const hoja = hojaCruda.replace(/^'|'$/g, '').replace(/''/g, "'");
    const m = a1.match(/^([A-Z]+)(\d*):([A-Z]+)(\d*)$/);
    if (!m) return { hoja, desdeCol: 1, desdeFila: 1 };
    return {
      hoja,
      desdeCol: numeroDeColumna(m[1]),
      desdeFila: m[2] ? Number(m[2]) : 1,
      hastaFila: m[4] ? Number(m[4]) : null,
    };
  };

  // Recorta las celdas vacías del final, como hace Google de verdad
  const recortar = (fila) => {
    const f = [...fila];
    while (f.length && (f[f.length - 1] === '' || f[f.length - 1] === null || f[f.length - 1] === undefined)) f.pop();
    return f;
  };

  async function fetchFalso(url, opciones = {}) {
    llamadas++;
    const cuerpo = opciones.body ? JSON.parse(opciones.body) : null;
    const ruta = url.replace(/^https:\/\/[^/]+\/v4\/spreadsheets\/[^/?:]+/, '');
    const responder = (obj) => ({ ok: true, status: 200, json: async () => obj });

    if (ruta.startsWith('?fields=sheets.properties')) {
      return responder({
        sheets: Object.keys(datos).map((t) => ({ properties: { title: t, sheetId: idsDeHoja[t] } })),
      });
    }

    if (ruta.startsWith('/values:batchGet')) {
      const rangos = [...ruta.matchAll(/ranges=([^&]+)/g)].map((m) => parseRango(m[1]));
      return responder({
        valueRanges: rangos.map((r) => ({ values: (datos[r.hoja] || []).map(recortar) })),
      });
    }

    if (ruta.includes(':append')) {
      const { hoja } = parseRango(ruta.match(/\/values\/([^:?]+)/)[1]);
      cuerpo.values.forEach((f) => datos[hoja].push([...f]));
      return responder({ updates: {} });
    }

    if (ruta.includes(':clear')) {
      const { hoja } = parseRango(ruta.match(/\/values\/([^:?]+)/)[1]);
      datos[hoja] = [];
      return responder({});
    }

    if (ruta.startsWith('/values/') && opciones.method === 'PUT') {
      const r = parseRango(ruta.match(/\/values\/([^:?]+)/)[1]);
      cuerpo.values.forEach((f, i) => {
        const fila = (datos[r.hoja][r.desdeFila - 1 + i] = datos[r.hoja][r.desdeFila - 1 + i] || []);
        f.forEach((v, j) => (fila[r.desdeCol - 1 + j] = v));
      });
      return responder({});
    }

    if (ruta.startsWith('/values/')) {
      // lectura de una columna sola: el mapa de ids
      const r = parseRango(ruta.match(/\/values\/([^:?]+)/)[1]);
      const columna = (datos[r.hoja] || []).map((f) => recortar([f[r.desdeCol - 1]]));
      return responder({ values: columna });
    }

    if (ruta.startsWith(':batchUpdate')) {
      const respuestas = cuerpo.requests.map((req) => {
        if (req.addSheet) {
          const t = req.addSheet.properties.title;
          datos[t] = [];
          idsDeHoja[t] = Object.keys(idsDeHoja).length + 1;
          return { addSheet: { properties: { title: t, sheetId: idsDeHoja[t] } } };
        }
        if (req.deleteDimension) {
          const { sheetId, startIndex, endIndex } = req.deleteDimension.range;
          const hoja = Object.keys(idsDeHoja).find((k) => idsDeHoja[k] === sheetId);
          datos[hoja].splice(startIndex, endIndex - startIndex);
          return {};
        }
        return {};
      });
      return responder({ replies: respuestas });
    }

    throw new Error('el Sheet falso no sabe responder: ' + ruta);
  }

  return { datos, fetch: fetchFalso, llamadas: () => llamadas };
}

// ---------------------------------------------------------------- un dispositivo

// `guardado` se puede reusar para simular que recargaste la página: el localStorage sigue,
// pero el estado en memoria de los módulos arranca de cero.
function crearDispositivo(sheetFalso, guardado = {}) {
  const almacenamiento = {
    getItem: (k) => (k in guardado ? guardado[k] : null),
    setItem: (k, v) => (guardado[k] = String(v)),
    removeItem: (k) => delete guardado[k],
  };

  const ctx = {
    localStorage: almacenamiento,
    fetch: sheetFalso.fetch,
    console,
    CONFIG_SHEETS: { spreadsheetId: 'PRUEBA', clientId: 'PRUEBA' },
    Date,
    URL,
    google: {
      accounts: {
        oauth2: {
          initTokenClient: (cfg) => ({
            requestAccessToken() {
              this.callback({ access_token: 'token-de-prueba', expires_in: 3600 });
            },
            callback: cfg.callback,
            error_callback: null,
          }),
          revoke: () => {},
        },
      },
    },
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);

  const cargar = (rel) => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'), ctx);
  cargar('public/almacen-local.js');
  cargar('public/sheets-api.js');

  vm.runInContext('almacenLocal.instalar();', ctx);
  cargar('apps-script/Codigo.gs');

  return {
    ctx,
    guardado,
    llamar: (metodo, ruta, cuerpo) => JSON.parse(vm.runInContext('llamarApi', ctx)(metodo, ruta, cuerpo || null)),
    almacen: vm.runInContext('almacenLocal', ctx),
    api: vm.runInContext('sheetsApi', ctx),
  };
}

/** Como cerrar y volver a abrir la app: se conserva lo guardado, no lo que había en memoria. */
const recargar = (disp, sheetFalso) => crearDispositivo(sheetFalso, disp.guardado);

async function bajar(disp) {
  const tablas = await disp.api.bajarTodo();
  disp.almacen.reemplazar(tablas);
}

async function subir(disp) {
  const pendientes = disp.almacen.pendientes();
  if (!pendientes.length) return { enviadas: 0, salteadas: 0 };
  const r = await disp.api.subir(pendientes.slice(), () => disp.almacen.confirmarEnviadas(1));
  disp.almacen.guardar();
  return r;
}

// ---------------------------------------------------------------- las pruebas

async function main() {
  const COLS = ['id', 'anio', 'mes', 'dia', 'tipo', 'seccion', 'categoria', 'subcategoria', 'descripcion', 'moneda', 'monto_moneda', 'cotizacion', 'monto', 'pagado'];
  const mov = (id, mes, sub, monto) => [id, 2026, mes, 1, 'gasto', 'variables', 'Casa', sub, '', 'ARS', '', '', monto, true];

  const partida = () => ({
    Movimientos: [COLS, mov(1, 1, 'uno', 100), mov(2, 2, 'dos', 200), mov(3, 3, 'tres', 300)],
    Celdas: [['id', 'anio', 'seccion', 'categoria', 'mes', 'monto']],
    Categorias: [['id', 'anio', 'seccion', 'nombre', 'orden'], [1, 2026, 'variables', 'Casa', 0]],
    Subcategorias: [['id', 'seccion', 'categoria', 'nombre']],
    Auto: [['id', 'marca', 'modelo', 'anio', 'km', 'dominio', 'motor', 'chasis', 'precio_ars', 'precio_usd']],
    AutoServices: [['id', 'auto_id', 'km', 'detalle', 'mes', 'precio_ars', 'mano_obra_ars', 'total_usd', 'orden']],
    AutoPlan: [['id', 'auto_id', 'item', 'detalle', 'extra', 'orden']],
    Quinta: [['id', 'rubro', 'detalle', 'monto_usd', 'orden']],
    QuintaPendientes: [['id', 'zona', 'texto', 'hecho', 'orden']],
  });

  console.log('Dos dispositivos sobre el mismo Sheet\n');

  // --- el caso peligroso: el teléfono borra el de arriba, la compu edita el de abajo ---
  let sheet = crearSheetFalso(partida());
  const telefono = crearDispositivo(sheet);
  const compu = crearDispositivo(sheet);
  await bajar(telefono);
  await bajar(compu);

  telefono.llamar('DELETE', '/api/movements/1'); // se va la fila 2 del Sheet
  await subir(telefono);

  // la compu todavía tiene la copia vieja: para ella el id 3 está en la fila 4
  compu.llamar('PUT', '/api/movements/3', { subcategory: 'editado' });
  const subida = await subir(compu);

  const filas = sheet.datos.Movimientos.slice(1);
  const porId = Object.fromEntries(filas.map((f) => [f[0], f]));
  comprobar('quedan los dos movimientos que tenían que quedar', filas.length === 2, JSON.stringify(filas.map((f) => f[0])));
  // Con el número de fila viejo la edición aterrizaba una fila más abajo: duplicaba un id y
  // se llevaba puesto al vecino. Es la señal más clara de que se corrompió.
  comprobar('ningún id quedó repetido', new Set(filas.map((f) => f[0])).size === filas.length, JSON.stringify(filas.map((f) => f[0])));
  comprobar('la edición cayó en el movimiento correcto', porId[3] && porId[3][7] === 'editado', JSON.stringify(porId[3]));
  comprobar('no pisó al de al lado', porId[2] && porId[2][7] === 'dos', JSON.stringify(porId[2]));
  comprobar('no quedaron importes cruzados', porId[2] && porId[2][12] === 200 && porId[3][12] === 300);
  comprobar('no salteó nada', subida.salteadas === 0, JSON.stringify(subida));

  // --- editar algo que el otro ya borró: se saltea, no rompe ---
  sheet = crearSheetFalso(partida());
  const a = crearDispositivo(sheet);
  const b = crearDispositivo(sheet);
  await bajar(a);
  await bajar(b);
  a.llamar('DELETE', '/api/movements/2');
  await subir(a);
  b.llamar('PUT', '/api/movements/2', { subcategory: 'tarde' });
  const tarde = await subir(b);
  comprobar('editar lo que ya no existe se saltea', tarde.salteadas === 1, JSON.stringify(tarde));
  comprobar('y no agrega basura al Sheet', sheet.datos.Movimientos.length === 3, String(sheet.datos.Movimientos.length));
  comprobar('no quedan pendientes trabados', b.almacen.pendientes().length === 0);

  // --- cargar en los dos lados sin bajar: no se pisan ---
  sheet = crearSheetFalso(partida());
  const c = crearDispositivo(sheet);
  const d = crearDispositivo(sheet);
  await bajar(c);
  await bajar(d);
  c.llamar('POST', '/api/movements', { year: 2026, month: 5, section: 'variables', category: 'Casa', subcategory: 'de C', amount: 500, paid: true, currency: 'ARS' });
  d.llamar('POST', '/api/movements', { year: 2026, month: 6, section: 'variables', category: 'Casa', subcategory: 'de D', amount: 600, paid: true, currency: 'ARS' });
  await subir(c);
  await subir(d);
  const subs = sheet.datos.Movimientos.slice(1).map((f) => f[7]);
  comprobar('las dos altas entran', subs.includes('de C') && subs.includes('de D'), subs.join(', '));
  comprobar('y no se perdió ninguna de las viejas', sheet.datos.Movimientos.length === 6, String(sheet.datos.Movimientos.length));

  // --- alta y edición en la misma tanda, sin conexión ---
  sheet = crearSheetFalso(partida());
  const e = crearDispositivo(sheet);
  await bajar(e);
  const nuevo = e.llamar('POST', '/api/movements', { year: 2026, month: 7, section: 'variables', category: 'Casa', subcategory: 'nuevo', amount: 700, paid: false, currency: 'ARS' });
  e.llamar('PUT', `/api/movements/${nuevo.id}`, { paid: true });
  const tanda = await subir(e);
  const recien = sheet.datos.Movimientos.slice(1).find((f) => f[7] === 'nuevo');
  comprobar('lo cargado y editado sin conexión sube entero', Boolean(recien), JSON.stringify(sheet.datos.Movimientos.slice(1).map((f) => f[7])));
  comprobar('y llega con la edición aplicada', recien && recien[13] === true, JSON.stringify(recien));
  comprobar('sin saltear nada', tanda.salteadas === 0, JSON.stringify(tanda));

  // --- borrar algo y recién después abrir la app: la cola no se puede trabar ---
  // El número interno de cada pestaña sólo se conocía al bajar, y la subida corre primero.
  // Con la página recién abierta, un borrado pendiente moría con "No encuentro la pestaña"
  // y todo lo que venía atrás —un gasto nuevo, por ejemplo— se quedaba sin subir.
  sheet = crearSheetFalso(partida());
  let f = crearDispositivo(sheet);
  await bajar(f);
  f.llamar('DELETE', '/api/movements/1');
  f.llamar('POST', '/api/movements', { year: 2026, month: 8, section: 'variables', category: 'Casa', subcategory: 'el gasto nuevo', amount: 800, paid: true, currency: 'ARS' });
  comprobar('quedan las dos operaciones sin subir', f.almacen.pendientes().length >= 2, String(f.almacen.pendientes().length));

  f.almacen.guardar(); // en la app esto lo hace apiLocal después de cada escritura
  f = recargar(f, sheet); // cerrás y volvés a abrir antes de que suba nada
  comprobar('la cola sobrevive a cerrar la app', f.almacen.pendientes().length >= 2, String(f.almacen.pendientes().length));
  let error = null;
  let resultado = null;
  try {
    resultado = await subir(f);
  } catch (err) {
    error = err.message;
  }
  comprobar('la subida no revienta con la app recién abierta', error === null, error);
  comprobar('el borrado se aplica igual', sheet.datos.Movimientos.slice(1).every((x) => x[0] !== 1), JSON.stringify(sheet.datos.Movimientos.slice(1).map((x) => x[0])));
  comprobar(
    'y el gasto de atrás llega al Sheet',
    sheet.datos.Movimientos.slice(1).some((x) => x[7] === 'el gasto nuevo'),
    JSON.stringify(sheet.datos.Movimientos.slice(1).map((x) => x[7]))
  );
  comprobar('no queda nada trabado en la cola', f.almacen.pendientes().length === 0, JSON.stringify(f.almacen.pendientes()));
  void resultado;

  // --- lo que baja el otro es lo que subió el primero ---
  await bajar(compu);
  const vistos = compu.llamar('GET', '/api/movements?year=2026&month=3').movements;
  comprobar('el otro dispositivo ve el cambio al bajar', vistos.length === 1 && vistos[0].subcategory === 'editado', JSON.stringify(vistos));

  console.log(`\n${pruebas} comprobaciones, ${fallas} con problema.`);
  process.exit(fallas ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
