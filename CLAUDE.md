# Gastos

App de finanzas personales. La base de datos es **Firestore** (proyecto `gastos-dff39`).

Todo en español (interfaz, código, commits). Sin npm install ni frameworks: la única
dependencia de ejecución es el SDK de Firebase, que se carga desde su CDN.

> **Antes esto vivía en un Google Sheet.** Se mudó porque una planilla no tiene claves
> primarias ni avisa cuando cambia, y de ahí salieron los peores bugs: importes que caían en
> la columna de al lado, un dispositivo pisando registros del otro, colas de cambios que se
> trababan. El Sheet quedó congelado como respaldo histórico; la app ya no lo toca.

## Regla de oro

**`apps-script/Codigo.gs` es la única implementación de la lógica.** No sabe dónde están los
datos: le pide filas por colección a un almacén y las cambia por id.

| Quién pone el almacén | Atrás hay |
| --- | --- |
| `public/datos-firebase.js` | Firestore, con copia en memoria y avisos en vivo |
| `tools/almacen-memoria.js` | un objeto, para las pruebas |

Si tocás la lógica, tocá `Codigo.gs` y corré `build:pwa`. Nunca dupliques reglas en
`public/app.js`: ahí va sólo la interfaz.

`db.js` y `server.js` son una implementación aparte, sobre SQLite (`npm start`). Se quedan
porque `probar-apps-script.js` compara contra ellos: son la segunda opinión que confirma que
mover la base de datos no cambió ningún número.

## Comandos

```bash
npm test                   # las dos suites de abajo
npm run build:pwa          # genera docs/ (lo que publica GitHub Pages)
npm start                  # servidor local sobre SQLite, sólo para desarrollar
node tools/servir-pwa.js   # sirve docs/ en localhost:4322, como GitHub Pages
```

Después de cambiar algo de `public/` o de `Codigo.gs`, correr `build:pwa`, commitear y
`git push`. GitHub Pages se actualiza solo en un minuto.

## Pruebas

```bash
node tools/probar-apps-script.js  # 77: la lógica contra la base local, número por número
node tools/probar-migracion.js    # 34: del backup del Sheet a Firestore, sin perder nada
```

`probar-apps-script.js` es la que importa: corre el `Codigo.gs` real sobre un almacén en
memoria cargado con los CSV del sheet original, y compara cada total contra `db.js`. Si
mover o tocar la capa de datos cambiara un número, esa suite se pone roja.

## Firebase

- Reglas de seguridad: `db/reglas-firestore.txt`. Están atadas a un usuario concreto, no a
  "cualquiera que haya entrado": la clave de la app viaja en el código y el repo es público.
- Migrar desde un backup del Sheet: `tools/migrar-a-firebase.js`, y `verificar-firebase.js`
  para comprobar que llegó todo.
- Nueve colecciones: `categorias`, `celdas`, `movimientos`, `subcategorias`, `autos`,
  `auto_services`, `auto_plan`, `quinta`, `quinta_pendientes`.
- Los id son números y los asigna la app (uno más que el mayor), no Firestore: vienen del
  Sheet y toda la lógica los usa así.
- Los campos se llaman como las columnas del Sheet (`anio`, `mes`, `seccion`…) a propósito:
  así la lógica siguió funcionando sin reescribirse en la mudanza.

## Lo que no se commitea

El repositorio es **público** (GitHub Pages gratis lo exige). Estos tienen datos financieros
y están en `.gitignore` — no los saques de ahí:

`data/` · `sheet-export/` · `apps-script/Datos.gs` · `tools/source/`

`public/config.js` **sí va al repo**: los valores de Firebase identifican al proyecto pero no
dan permisos. Sin la cuenta autorizada no sirven para nada.

## Estructura

```
public/            interfaz: app.js, charts.js, styles.css, index.html
  datos-firebase.js  la copia en memoria, las escrituras y los avisos en vivo
  firebase.js        único módulo: carga el SDK y arranca la app
apps-script/Codigo.gs   LA lógica
docs/              generado por build:pwa — no editar a mano
db/                reglas de Firestore
tools/             migraciones y pruebas
```

## Cómo funciona la app

Entrás una vez por dispositivo (Firebase recuerda la sesión). Al entrar se bajan las nueve
colecciones enteras a memoria; desde ahí se arma cualquier vista, así que la pantalla
contesta en el acto.

Escribir va derecho a Firestore, sin cola ni reintentos: la copia en memoria se actualiza
primero y el documento sale por atrás. Como cada documento tiene id propio, no hay números
de fila que se corran.

**Firestore avisa solo cuando algo cambia**, en cualquier dispositivo. Lo que cargás en el
teléfono aparece en la computadora en el momento. No se redibuja si hay un diálogo abierto o
estás escribiendo en un campo: eso queda pendiente y se aplica al soltarlo.

Sin conexión la app no carga: fue una decisión, a cambio de no tener cola de pendientes.

## Modelo de datos

- **celdas**: montos cargados a mano en la grilla (ahí está todo lo importado del sheet viejo).
- **movimientos**: lo cargado por formulario, con categoría, subcategoría, descripción y si
  está pagado. Suman a la celda de su categoría y mes.
- Lo que muestra cada celda = `celdas` + los `movimientos` pagados de esa categoría y mes.
- Secciones: `ingresos`, `fijos`, `tarjetas`, `variables`, `ahorro`. **`ahorro` no suma al
  gasto** (dólares y saldos compartidos).

Las categorías que ofrece el formulario están en `CATEGORIAS_PARA_CARGAR`, en `public/app.js`.
La grilla puede tener más (las viejas, con historia), pero no aparecen para cargar.

## Pendientes conocidos

- Faltan reordenar varios gastos viejos: el usuario lo va a hacer a mano desde la app.
- `Patente Cherokee` quedó fuera de la lista del formulario, con datos en la grilla.
- La peluquería quedó dentro de `Salud`; puede que corresponda a otra categoría.
- Los años 2022-2024 están todos en `Sin clasificar` a propósito: el sheet original marcaba
  la categoría con el color de la celda y eso no se puede recuperar.
- La solapa *Revisión* lista lo que queda por sanear (nombres repetidos, subcategorías
  huérfanas) y trae los botones para hacerlo.

## Al trabajar acá

- Verificá los cambios corriendo la app, no sólo leyendo el código.
- Si tocás totales o migrás datos, comprobá que los totales mensuales no cambien.
- Los comentarios explican **por qué**, no qué hace la línea.
