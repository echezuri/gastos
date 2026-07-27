'use strict';

/**
 * Habla con la planilla de verdad: entra con tu cuenta de Google, baja las pestañas y
 * sube los cambios que quedaron pendientes.
 *
 * Nada de esto bloquea la pantalla: la app dibuja con la copia local y esto pasa por atrás.
 */
const sheetsApi = (() => {
  const BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
  const ALCANCE = 'https://www.googleapis.com/auth/spreadsheets';
  const PESTANAS = [
    'Movimientos', 'Celdas', 'Categorias', 'Subcategorias',
    'Auto', 'AutoServices', 'AutoPlan', 'Quinta', 'QuintaPendientes',
  ];

  let token = null;
  let venceEn = 0;
  let clienteToken = null;
  let idsDeHoja = {};

  const config = {
    leer() {
      let guardada = {};
      try {
        guardada = JSON.parse(localStorage.getItem('gastos-config') || '{}');
      } catch {
        guardada = {};
      }
      const porDefecto = typeof CONFIG_SHEETS === 'undefined' ? {} : CONFIG_SHEETS;
      return {
        spreadsheetId: guardada.spreadsheetId || porDefecto.spreadsheetId || '',
        clientId: guardada.clientId || porDefecto.clientId || '',
      };
    },
    escribir(valores) {
      localStorage.setItem('gastos-config', JSON.stringify(valores));
    },
    completa() {
      const c = config.leer();
      return Boolean(c.spreadsheetId && c.clientId);
    },
  };

  /** Pide el permiso a Google. En silencio si ya diste el consentimiento antes. */
  function autorizar({ silencioso = true } = {}) {
    return new Promise((resolve, reject) => {
      if (token && Date.now() < venceEn - 60_000) return resolve(token);
      if (typeof google === 'undefined' || !google.accounts) {
        return reject(new Error('Todavía no cargó la librería de Google'));
      }
      const { clientId } = config.leer();
      if (!clientId) return reject(new Error('Falta el ID de cliente de Google'));

      if (!clienteToken) {
        clienteToken = google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: ALCANCE,
          callback: () => {},
        });
      }
      clienteToken.callback = (respuesta) => {
        if (respuesta.error) return reject(new Error(respuesta.error_description || respuesta.error));
        token = respuesta.access_token;
        venceEn = Date.now() + Number(respuesta.expires_in || 3600) * 1000;
        resolve(token);
      };
      clienteToken.error_callback = (err) => reject(new Error(err.type || 'no se pudo entrar'));
      clienteToken.requestAccessToken({ prompt: silencioso ? '' : 'consent' });
    });
  }

  function desconectar() {
    if (token && typeof google !== 'undefined' && google.accounts) {
      google.accounts.oauth2.revoke(token, () => {});
    }
    token = null;
    venceEn = 0;
  }

  const conectado = () => Boolean(token && Date.now() < venceEn);

  async function pedir(ruta, opciones = {}, reintento = false) {
    const acceso = await autorizar();
    const { spreadsheetId } = config.leer();
    const respuesta = await fetch(`${BASE}/${spreadsheetId}${ruta}`, {
      ...opciones,
      headers: {
        Authorization: `Bearer ${acceso}`,
        'Content-Type': 'application/json',
        ...(opciones.headers || {}),
      },
    });
    if (respuesta.status === 401 && !reintento) {
      token = null; // el permiso venció: se pide de nuevo y se reintenta una vez
      return pedir(ruta, opciones, true);
    }
    if (!respuesta.ok) {
      const detalle = await respuesta.json().catch(() => ({}));
      throw new Error(detalle.error?.message || `Google respondió ${respuesta.status}`);
    }
    return respuesta.json();
  }

  const rango = (hoja, a1 = 'A:Z') => `'${hoja.replace(/'/g, "''")}'!${a1}`;

  function columnaEnLetras(indice) {
    let n = indice;
    let letras = '';
    while (n > 0) {
      const resto = (n - 1) % 26;
      letras = String.fromCharCode(65 + resto) + letras;
      n = Math.floor((n - resto) / 26);
    }
    return letras || 'A';
  }

  /** Baja todas las pestañas de una sola llamada. */
  async function bajarTodo() {
    const meta = await pedir('?fields=sheets.properties(title,sheetId)');
    idsDeHoja = {};
    const existentes = [];
    for (const hoja of meta.sheets || []) {
      idsDeHoja[hoja.properties.title] = hoja.properties.sheetId;
      if (PESTANAS.includes(hoja.properties.title)) existentes.push(hoja.properties.title);
    }
    if (!existentes.length) return {};

    const consulta = existentes.map((h) => `ranges=${encodeURIComponent(rango(h))}`).join('&');
    const datos = await pedir(`/values:batchGet?${consulta}&valueRenderOption=UNFORMATTED_VALUE`);

    const tablas = {};
    (datos.valueRanges || []).forEach((r, i) => {
      tablas[existentes[i]] = (r.values || []).map((fila) => fila.slice());
    });
    return tablas;
  }

  /** Manda al Sheet las operaciones que quedaron anotadas, en orden. */
  async function subir(pendientes, alConfirmar) {
    let enviadas = 0;
    for (const op of pendientes) {
      if (op.tipo === 'crear') {
        const r = await pedir(':batchUpdate', {
          method: 'POST',
          body: JSON.stringify({ requests: [{ addSheet: { properties: { title: op.hoja } } }] }),
        });
        const props = r.replies?.[0]?.addSheet?.properties;
        if (props) idsDeHoja[props.title] = props.sheetId;
      } else if (op.tipo === 'agregar') {
        await pedir(
          `/values/${encodeURIComponent(rango(op.hoja, 'A:A'))}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
          { method: 'POST', body: JSON.stringify({ values: op.valores }) }
        );
      } else if (op.tipo === 'escribir') {
        const alto = op.valores.length;
        const ancho = op.valores[0].length;
        const desde = `${columnaEnLetras(op.columna)}${op.fila}`;
        const hasta = `${columnaEnLetras(op.columna + ancho - 1)}${op.fila + alto - 1}`;
        await pedir(
          `/values/${encodeURIComponent(rango(op.hoja, `${desde}:${hasta}`))}?valueInputOption=RAW`,
          { method: 'PUT', body: JSON.stringify({ values: op.valores }) }
        );
      } else if (op.tipo === 'borrar') {
        const id = idsDeHoja[op.hoja];
        if (id === undefined) throw new Error(`No encuentro la pestaña ${op.hoja}`);
        await pedir(':batchUpdate', {
          method: 'POST',
          body: JSON.stringify({
            requests: [
              { deleteDimension: { range: { sheetId: id, dimension: 'ROWS', startIndex: op.fila - 1, endIndex: op.fila } } },
            ],
          }),
        });
      } else if (op.tipo === 'vaciar') {
        await pedir(`/values/${encodeURIComponent(rango(op.hoja))}:clear`, { method: 'POST', body: '{}' });
      }
      enviadas++;
      if (alConfirmar) alConfirmar(enviadas);
    }
    return enviadas;
  }

  return { config, autorizar, desconectar, conectado, bajarTodo, subir, PESTANAS };
})();
