# Gastos

App de finanzas personales. La base de datos es un Google Sheet.

Todo en español (interfaz, código, commits). Sin dependencias: ni npm install, ni frameworks.
Node 22 trae el SQLite que usa la versión local.

## Regla de oro

**`apps-script/Codigo.gs` es la única implementación de la lógica.** Corre en tres lados:

| Modo | Cómo | Base de datos |
| --- | --- | --- |
| **PWA** (el que se usa) | `docs/` publicado en GitHub Pages | el Sheet, con copia local en el navegador |
| **Apps Script** | pegado dentro del Sheet | el Sheet |
| **Local** | `npm start` → localhost:4321 | `data/gastos.db` (SQLite) |

Si tocás la lógica, tocá `Codigo.gs` y regenerá. Nunca dupliques reglas en `public/app.js`:
ahí va sólo la interfaz.

`db.js` y `server.js` son la versión local (SQLite). Existen para desarrollar y para generar
los datos que van al Sheet; la lógica que vale es la de `Codigo.gs`.

## Comandos

```bash
npm start                  # servidor local, para desarrollar rápido
npm run build:pwa          # genera docs/ (lo que publica GitHub Pages)
npm run build:sheets       # genera apps-script/Index.html (versión dentro del Sheet)
node tools/servir-pwa.js   # sirve docs/ en localhost:4322, como GitHub Pages
```

Después de cambiar algo de `public/`, correr `build:pwa`, commitear y `git push`. GitHub Pages
se actualiza solo en un minuto.

## Pruebas

```bash
node tools/probar-apps-script.js   # 47 comprobaciones: la lógica del Sheet contra la base local
node tools/probar-importacion.js   # 15: arranca de una planilla vacía e importa
node tools/verify-import.js        # totales contra el sheet original
node tools/medir-llamadas.js       # idas y vueltas al servidor (que no crezcan)
```

`verify-import.js` **da 12 diferencias y está bien**: son las cinco fórmulas cortas del sheet
original, la de 2023 contada dos veces, y las seis de 2026 por NATI, que se movió a propósito
de fijos a variables. Están explicadas al pie de su salida y en el README.

Las pruebas corren el `Codigo.gs` real sobre una planilla simulada (`tools/planilla-simulada.js`).
No hace falta subir nada para probar.

## Lo que no se commitea

El repositorio es **público** (GitHub Pages gratis lo exige). Estos tienen datos financieros y
están en `.gitignore` — no los saques de ahí:

`data/` · `sheet-export/` · `apps-script/Datos.gs` · `tools/source/`

`docs/config.js` va con los IDs vacíos: se cargan desde la app y quedan en el dispositivo.

## Estructura

```
public/            interfaz: app.js, charts.js, styles.css, index.html
  almacen-local.js copia local de la planilla (la PWA trabaja contra esto)
  sheets-api.js    permiso de Google, bajada y subida
apps-script/Codigo.gs   LA lógica
docs/              generado por build:pwa — no editar a mano
tools/             importadores, migraciones y pruebas
```

## Cómo funciona la PWA

La app escribe siempre en la copia local (instantáneo) y anota cada cambio en una lista de
pendientes que se manda al Sheet por atrás. El chip de arriba a la derecha muestra el estado:
*Al día*, *3 sin subir*, *Sin conexión*, *Conectar*.

Por eso: **no editar el Sheet a mano mientras haya cambios sin subir**. La app calcula en qué
fila escribir con su copia local.

## Modelo de datos

Pestañas del Sheet: `Movimientos`, `Celdas`, `Categorias`, `Subcategorias`, `Auto`,
`AutoServices`, `AutoPlan`, `Quinta`, `QuintaPendientes`.

- **Celdas**: montos cargados a mano en la grilla (ahí está todo lo importado del sheet viejo).
- **Movimientos**: lo cargado por formulario, con categoría, subcategoría, descripción y si está
  pagado. Suman a la celda de su categoría y mes.
- Lo que muestra cada celda = `Celdas` + los `Movimientos` pagados de esa categoría y mes.
- Secciones: `ingresos`, `fijos`, `tarjetas`, `variables`, `ahorro`. **`ahorro` no suma al gasto**
  (dólares y saldos compartidos).

Las categorías que ofrece el formulario están en `CATEGORIAS_PARA_CARGAR`, en `public/app.js`.
La grilla puede tener más (las viejas, con historia), pero no aparecen para cargar.

## Pendientes conocidos

- Faltan reordenar varios gastos viejos: el usuario lo va a hacer a mano desde la app.
- No hay forma de borrar una subcategoría desde la interfaz.
- `Patente Cherokee` quedó fuera de la lista del formulario, con datos en la grilla.
- La peluquería quedó dentro de `Salud`; puede que corresponda a otra categoría.
- Los años 2022-2024 están todos en `Sin clasificar` a propósito: el sheet original marcaba la
  categoría con el color de la celda y eso no se puede recuperar.

## Al trabajar acá

- Verificá los cambios corriendo la app, no sólo leyendo el código. Hay tres modos: el que
  importa es la PWA.
- Si tocás totales o migrás datos, comprobá que los totales mensuales no cambien.
- Los comentarios explican **por qué**, no qué hace la línea.
