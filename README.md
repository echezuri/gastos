# Gastos

App local para guardar y leer los datos con la misma estructura del sheet: ingresos, AFIP,
gastos fijos, tarjetas y gastos variables mes a mes, más las hojas del auto y de la quinta.

Corre en tu PC, sin cuentas ni internet. Los datos viven en un solo archivo: `data/gastos.db`.

## Uso

```bash
npm start
```

Después abrí http://localhost:4321

No hay que instalar nada: usa el SQLite que ya viene adentro de Node (hace falta Node 22.5 o
posterior; tenés la 22.22).

## Cómo está organizado

Arriba hay dos niveles de navegación: las tres pantallas (Año / Auto / Quinta) y, debajo,
las solapas de esa pantalla. **Se ve una tabla por vez**, así ninguna pantalla es una tira
larga para scrollear. Cada solapa recuerda dónde estabas.

| Pantalla   | Solapas                                                                          |
| ---------- | -------------------------------------------------------------------------------- |
| **Año**    | Resumen · Ingresos · AFIP · Gastos fijos · Tarjetas · Gastos variables · Ahorro y compartidos · Movimientos · Sin pagar |
| **Auto**   | Vehículo · Services · Plan                                                        |
| **Quinta** | Obras y costos · Pendientes                                                       |

Arriba de todo, tres tarjetas con el año de un vistazo: ingresos, gasto y resto, cada una con
el valor del mes que estés mirando. Si hay algo sin pagar aparece una cuarta, en ámbar.

Las tablas se muestran enteras, sin barras de scroll propias: a lo ancho las columnas se
reparten el espacio disponible (lo que no entra se corta con puntos suspensivos y se ve
completo al hacer clic en la celda), y a lo alto crece la tabla y scrollea la página, con el
encabezado de columnas pegado abajo de la barra superior.

Cada solapa trae además sus propios números y **gráficos, siempre mensuales**, uno ancho (2/3)
y otro angosto (1/3):

| Solapa                | 2/3                              | 1/3                          |
| --------------------- | -------------------------------- | ---------------------------- |
| Resumen               | Ingresos y gasto mes a mes       | Resto por mes (verde/rojo)   |
| Secciones de la grilla| Total por mes                    | Acumulado del año            |
| Movimientos           | Movimientos por mes              | Cuántos por mes              |

En las dos de Movimientos podés hacer clic en una barra para saltar a ese mes.

Auto y Quinta no tienen eje mensual, así que muestran sólo números: kilómetros, valor, gastado
en services y promedio por service; total invertido, rubro más caro y avance de los pendientes.

En la pantalla de Año:

- El **Resumen** muestra Ingresos, Tarjetas, Gastos fijos, Gastos variables, Total, Resto y
  Ahorros. La columna `%` dice cuánto pesa cada fila sobre el total de ingresos del año
  (ingresos = 100%), y haciendo clic en el nombre de una fila vas a esa solapa. Ingresos,
  Total y Resto van un punto más grandes.
- **La columna del mes en curso queda destacada** en todas las tablas, cuando mirás el año
  actual.
- **Gastos variables** se ordena solo, de mayor a menor según el total del año.
- Los ingresos se muestran en verde; los gastos en rojo suave, y en rojo fuerte lo negativo.

- Cada celda se edita haciendo clic. Enter o Tab para confirmar; vacía borra el valor.
- Los totales (`Total`, `Gasto total`, `Resto`, columna `Año`) se calculan solos: no se cargan.
- `Gasto total` = AFIP + gastos fijos + tarjetas + gastos variables. `Resto` = ingresos − gasto.
- Las categorías se renombran escribiendo encima, se ordenan con ↑ ↓ y se borran con ✕.
- **+ año** crea el año siguiente copiando las categorías, sin montos.

## Categorías

Desde 2025 los gastos variables usan esta taxonomía. El detalle fino (el vehículo, la marca,
la persona, el comercio) va en la **descripción**, no en la categoría: así los totales quedan
limpios y el detalle se ve al pasar el mouse.

| Categoría | Subcategorías |
| --- | --- |
| Supermercado y almacén | Supermercado · Almacén y chino · Carnicería y verdulería · Panadería · Kiosco |
| Comida afuera | Pizza y rotisería · Comida rápida · Asados y juntadas · Heladería |
| Vehículos | Combustible · GNC · Service y repuestos · VTV y trámites · Lavado · Remis |
| Mascotas | Alimento · Veterinaria |
| Casa | Materiales y ferretería · Mano de obra · Limpieza · Pileta |
| Salud | Prepaga · Farmacia · Médico · Peluquería |
| Compras | Tecnología · Ropa y calzado · Hogar y bazar · Deporte · Otros |
| Running | Inscripción · Viaje y traslado · Alojamiento · Comida · Equipamiento |
| Proyectos | Dominio y hosting |
| Sin clasificar | — (los años viejos y lo que no tiene detalle) |

En **gastos fijos**: AFIP, Luz monofásica, Luz trifásica, Gas, Internet, FX Running,
Jardín Marco y Seguro Cherokee.

El formulario ofrece sólo esas categorías (la lista está en `CATEGORIAS_PARA_CARGAR`, en
`public/app.js`). La grilla puede tener más — las viejas, con datos históricos —, pero no
aparecen para cargar.

**Running** junta todo lo que implica una carrera: inscripción, viaje, alojamiento, comida y
equipamiento. Por eso la nafta y los consumos del viaje a Córdoba están ahí y no en Auto.

### Lo que no es gasto

La solapa **Ahorro y compartidos** registra plata que sale pero no se consume:

- **Ahorro en dólares** — compra de USD y MEP. Es un cambio de bolsillo, no un gasto.
- **Gastos compartidos** — saldos que se reparten con otra persona y vuelven.

No suman al `Gasto total` ni descuentan del `Resto`: aparecen en el resumen en una fila
aparte, en gris. En 2025 son $904.000 que antes inflaban el gasto.

## Cargar un gasto o un ingreso

El botón **+ Cargar** (o la tecla `n`) abre el formulario:

1. **Gasto / Ingreso** — arranca en Gasto; el botón cambia a Ingreso.
2. **Monto**.
3. **Categoría** — las del año primero y después las de otros años, marcadas con `·`; si elegís
   una de esas, se agrega sola a este año.
4. **Subcategoría** — opcional. El campo sugiere las que ya usaste en esa categoría, y si
   escribís una nueva queda guardada para la próxima.
5. **Descripción** — opcional. No ocupa una columna: se ve como globito de ayuda al pasar el
   mouse por encima del movimiento, y también en el globito de la celda de la grilla. Los que
   tienen descripción llevan la subcategoría subrayada de puntitos. Se edita después con el
   botón ✎ de cada fila.
6. **Pagado** — viene tildado. Destildalo para lo que cargás pero todavía no está confirmado.
7. **Fecha** — hoy por defecto; el mes es el que define en qué columna cae.

`Guardar y seguir` deja el formulario abierto para cargar varios seguidos.

### Pesos o dólares

Arriba del monto elegís la moneda. En dólares se pide la cotización (recuerda la última que
usaste) y te muestra a cuánto equivale mientras escribís. En la planilla se guarda el importe
**en pesos**, que es con lo que suman todos los totales, y además el importe original en
dólares y la cotización, que se ven en el globito del movimiento.

### Cuotas y suscripciones

Cargando un gasto de tarjeta podés poner **cuotas**: el mismo importe se repite esos meses,
rodando al año siguiente si hace falta, y cada movimiento queda marcado `(cuota 2/6)`. El
formulario te muestra el total antes de guardar.

**Suscripción** repite el importe todos los meses hasta diciembre y marca cada uno con
`(suscripción)`. Para cortarla, borrá los movimientos de los meses que no correspondan.

### Cómo se relaciona con la grilla

Cada movimiento **suma a la celda de su categoría y mes**. Una celda con movimientos deja de
ser editable y pasa a mostrar el total subrayado: al hacerle clic se abre abajo el panel de
**Movimientos** filtrado por esa celda, donde podés cambiar día, categoría, subcategoría,
importe y el tilde de pago, o borrar. Ahí también está el monto cargado a mano en la grilla,
por si esa celda mezcla las dos cosas (los montos importados del sheet son todos "a mano").

### Lo que está sin pagar

No suma a ningún total. Aparece con un punto ámbar en la celda y en un panel **Sin pagar**
arriba de todo, con el detalle y un botón para confirmarlo. Al tildarlo entra en los totales.

## Las tres formas de correrla

La misma interfaz y **la misma lógica** en los tres casos: `apps-script/Codigo.gs` es la
única implementación de las reglas y se usa tal cual adentro de Google, en el navegador y en
las pruebas.

| | Dónde vive la base | Velocidad | Requiere |
| --- | --- | --- | --- |
| **PWA** (`npm run build:pwa`) | el Google Sheet, con copia local | instantánea | publicar `pwa/` y una credencial de Google |
| **En el Sheet** (Apps Script) | las pestañas del Sheet | lenta: cada acción viaja a Google | nada, lo publica Google |
| **Local** (`npm start`) | `data/gastos.db` en tu PC | instantánea | tener la PC prendida |

## La PWA: la versión rápida

Es la app instalada en el teléfono o en la PC. Trabaja contra una **copia local** de la
planilla, así que abre y responde al instante, y sincroniza con el Sheet por atrás. Sin señal
funciona igual: los cambios se anotan y suben cuando vuelve.

El chip de arriba a la derecha dice cómo viene: *Al día*, *3 sin subir*, *Sincronizando…*,
*Sin conexión* o *Conectar*. Tocándolo fuerza una sincronización.

### 1. Crear la credencial de Google (una sola vez)

En [console.cloud.google.com](https://console.cloud.google.com):

1. Creá un proyecto (nombre libre).
2. *APIs y servicios → Biblioteca* → buscá **Google Sheets API** → **Habilitar**.
3. *Pantalla de consentimiento de OAuth* → tipo **Externo** → completá nombre y tu mail →
   en *Usuarios de prueba* agregá tu propia cuenta de Google.
4. *Credenciales → Crear credenciales → ID de cliente de OAuth* → tipo **Aplicación web**.
   En **Orígenes autorizados de JavaScript** poné la dirección donde va a vivir la app, sólo
   el dominio: `https://TU-USUARIO.github.io`. Para probar en tu PC agregá también
   `http://localhost:4322`.
5. Copiá el **ID de cliente** (termina en `.apps.googleusercontent.com`). No es secreto: sólo
   sirve desde los orígenes que autorizaste.

### 2. Publicar en GitHub Pages

```bash
npm run build:pwa
```

Deja todo en `pwa/`. Subí **el contenido de esa carpeta** a un repositorio y activá Pages
(*Settings → Pages → Deploy from a branch*). Si la publicás desde `/docs`, renombrá la carpeta;
si es desde la raíz, subí los archivos directamente. Las rutas son relativas, así que funciona
igual en una subcarpeta.

### 3. Conectarla

Abrí la dirección, poné el **ID de la planilla** (lo que va entre `/d/` y `/edit`, o pegá la
dirección entera) y el **ID de cliente**. Quedan guardados en el dispositivo; se cambian con
el engranaje ⚙.

La primera vez Google pide permiso con su ventana: el chip va a decir **Conectar**, tocalo y
aceptá. Después entra solo.

### 4. El ícono

Con la app abierta: Chrome → menú ⋮ → *Instalar aplicación*; Safari → compartir →
*Agregar a inicio*. El ícono abre directo el formulario de carga.

### Probarla antes de subirla

```bash
node tools/servir-pwa.js
```

Sirve `pwa/` en http://localhost:4322 igual que lo haría GitHub Pages.

### Lo que hay que tener en cuenta

- **No edites la planilla a mano mientras haya cambios sin subir.** La app calcula en qué fila
  escribir con su copia local; si movés filas en el medio, puede escribir donde no va. El chip
  te dice cuándo está *Al día*.
- **El permiso de Google dura una hora.** Se renueva solo mientras la sesión esté viva; si no,
  el chip pasa a *Conectar*.
- Si usás la PWA y la versión de Apps Script a la vez, las dos escriben en el mismo Sheet.
  Conviene usar una.

## Usarla desde el Google Sheet (Apps Script)

Esta versión no necesita publicar nada: el código corre adentro de la planilla y se entra con
tu cuenta de Google. A cambio es la más lenta, porque cada acción viaja hasta Google. Los
bloques originales del sheet quedan intactos; la app usa pestañas nuevas.

### Las pestañas que usa

| Pestaña | Qué guarda |
| --- | --- |
| `Movimientos` | lo cargado por formulario: fecha, categoría, subcategoría, descripción, importe, pagado |
| `Celdas` | los montos cargados a mano en la grilla |
| `Categorias` · `Subcategorias` | la taxonomía y su orden |
| `Auto` · `AutoServices` · `AutoPlan` | el vehículo, sus services y el plan |
| `Quinta` · `QuintaPendientes` | obras y pendientes |

### 1. Llevar los datos al Sheet

La forma corta, de un solo paso:

```bash
npm run datos:sheets
```

Genera `apps-script/Datos.gs` con todos los datos adentro. Lo pegás como un archivo más del
proyecto de Apps Script, elegís la función **importarTodo** en el selector de arriba y tocás
**Ejecutar**. Escribe las nueve pestañas de una sola vez.

`importarTodo()` **reemplaza** el contenido de esas nueve pestañas y no toca ninguna otra. O
sea que también sirve para volver al estado de la base local si algo se desordena.

<details>
<summary>La forma larga, con CSV</summary>

```bash
npm run export:sheets
```

Deja nueve CSV en `sheet-export/`. En el Sheet, por cada archivo:
**Archivo → Importar → Subir → elegir el CSV → "Insertar hojas nuevas"**.

Cada pestaña tiene que quedar con el nombre exacto del archivo (`Movimientos`, `Celdas`, …).
Si Google le agrega un sufijo, renombrala a mano.

</details>

### 2. Pegar el código

```bash
npm run build:sheets
```

Genera `apps-script/Index.html` a partir de la misma interfaz de `public/`, en un solo archivo.
Después, en el Sheet: **Extensiones → Apps Script**, y ahí:

- Pegá `apps-script/Codigo.gs` en el archivo `Código.gs` que viene creado.
- Agregá un archivo **HTML** llamado `Index` y pegá `apps-script/Index.html`.

Cada vez que cambies algo de la interfaz, corré `npm run build:sheets` y volvé a pegar el HTML.

### 3. Publicarla

En el editor de Apps Script: **Implementar → Nueva implementación → Aplicación web**, con
*Ejecutar como* **yo** y *Quién tiene acceso* **solo yo**. Autorizá los permisos y guardate la
URL que te da: esa es la app.

También queda un menú **Gastos → Abrir la app** dentro del Sheet, para usarla en la PC sin
salir de la planilla.

### 4. El ícono en el teléfono

Abrí la URL en el teléfono y agregala a la pantalla de inicio (Chrome: menú ⋮ →
*Agregar a pantalla principal*; Safari: compartir → *Agregar a inicio*).

### Por qué está armada para hacer pocas llamadas

En Apps Script lo caro no es leer la planilla: es cada ida y vuelta al servidor, que cuesta
cientos de milisegundos por sí sola. Por eso:

- **Abrir la app es una sola llamada** (`/api/bootstrap`): vuelve con los años, el año que
  mirás, los movimientos del mes y el catálogo, todo junto.
- **Escribir también es una sola llamada.** Cuando la app manda un `vista` en el cuerpo, la
  respuesta trae además el estado actualizado de lo que estás mirando, así no hay que volver a
  preguntar nada para redibujar.
- **Cada pestaña se lee una vez por llamada** y se olvida apenas se escribe algo.
- **Las cuotas se guardan de una sola escritura**, no una por mes.

Medido con `node tools/medir-llamadas.js`: abrir la app y cargar un gasto pasó de **8 llamadas
y 18 lecturas de pestaña a 2 llamadas y 9 lecturas**; seis cuotas pasaron de 7 escrituras a 2.

### Lo que cambia respecto de la versión local

- **Sigue siendo más lenta**: aunque ahora sea una sola llamada, esa llamada pasa por Google.
  La app local responde al instante porque la base está en tu disco.
- **No anda sin señal.** La carga offline que existe en la versión local no aplica acá: la app
  la sirve Google, así que sin conexión no abre.
- **El respaldo lo hace Google** con el historial de versiones del Sheet, así que el botón
  *Backup* no aparece.
- **Una sola fuente de verdad.** Si usás las dos versiones a la vez, las bases se separan sin
  avisar. Lo sano es elegir una; para volver del Sheet a local habría que reimportar.

### Cuando algo no anda

- **La app queda en "Cargando…"**: el JavaScript se cortó antes de dibujar. Desde la versión
  con el panel de fallas eso ya no debería pasar en silencio; si pasa, es que el navegador
  sigue sirviendo la versión vieja. Usá la URL `/dev` (*Implementar → Probar implementaciones*),
  que siempre corre el código actual, y recargá forzado.
- **Cambiaste el código y no ves la diferencia**: Apps Script sigue publicando la versión
  anterior hasta que creás una nueva en *Implementar → Administrar implementaciones → ✏️ →
  Versión: Nueva*.
- **Dudas sobre las pestañas**: corré la función `diagnostico()` desde el editor. Lista qué
  pestañas hay, cuántas filas tiene cada una, si falta alguna columna y qué años detecta.

### Probar el código del Sheet sin subirlo

```bash
node tools/probar-apps-script.js
```

Corre el Apps Script acá, con una planilla simulada cargada desde los mismos CSV, y compara
sus respuestas contra la base local: años, categorías, totales, pendientes, auto y quinta, más
altas, ediciones y bajas. Hoy pasa las 28 comprobaciones.

```bash
node tools/probar-importacion.js
```

Arranca de una planilla **vacía**: comprueba que la app abre igual sin ninguna pestaña cargada,
que `importarTodo()` llena las nueve, y que después los datos coinciden con la base local.
Hoy pasa las 15 comprobaciones.

```bash
node tools/medir-llamadas.js
```

Cuenta las idas y vueltas y las lecturas de pestaña que hacen abrir la app y cargar un gasto.
Es la forma de ver si un cambio la volvió más lenta.

## Datos

- Base: `data/gastos.db` (SQLite). Copiala y ya tenés todo.
- `npm run backup` deja un `.json` y un `.db` con fecha en `data/backups/`.
- El botón **Backup** de la app descarga el JSON completo.

## Importar de nuevo desde el sheet

El export del sheet original está en `tools/source/sheet.md`.

```bash
npm run import -- --force
```

Ojo: `--force` borra lo que haya cargado y vuelve a importar desde ese archivo.

Para controlar la importación:

```bash
node tools/verify-import.js
```

Recalcula los totales de cada mes y los compara con las filas `TOTAL` que traía el sheet.
Las diferencias que da son todas esperadas:

| Año  | Total del sheet    | Diferencia | Motivo                              |
| ---- | ------------------ | ---------- | ----------------------------------- |
| 2023 | Otros total dic    | +20.400    | la fórmula del sheet no sumaba AÑO NUEVO (14.000) ni 6.400 |
| 2025 | Gastos total ago   | +61.164    | no sumaba SEGURO JEEP               |
| 2025 | Gastos total nov   | +74.100    | no sumaba SEGURO JEEP + PATENTE JEEP |
| 2025 | Gastos total dic   | +80.530    | no sumaba SEGURO JEEP + PATENTE JEEP |
| 2025 | Tarjetas total nov | +322.000   | no sumaba MERCADOPAGO               |
| 2026 | Gastos fijos ene-jun | −275.000 | NATI pasó a variables (Casa / Limpieza): se paga por visita, no es un fijo |

En las cinco primeras el número correcto es el de la app. La última es una reclasificación
hecha a propósito, y el gasto total del mes no cambió.

## Detalles de la importación

- El sheet repetía etiquetas de año (dos bloques decían "2022" y dos "2025"). Los años reales
  se resolvieron cruzando los montos con la tabla de sueldos: quedaron 2022, 2023, 2024, 2025
  y 2026.
- Todo lo importado quedó como **pagado**.
- **2024 y años anteriores quedaron en "Sin clasificar" a propósito.** En los bloques de 2022
  y 2023 el sheet marcaba la categoría de cada gasto **con el color de la celda**, y las filas
  de la izquierda eran sólo la leyenda. La exportación no trae colores, así que ese desglose no
  es recuperable: los importes y los meses están bien, las categorías no lo estarían. De esos
  años sólo miramos los totales.

## Recategorizar

`tools/recategorizar.js` aplica la taxonomía de arriba a partir de 2025.

```bash
node tools/recategorizar.js
```

Sin argumentos sólo muestra el plan: cuántos movimientos caen en cada categoría y cuáles no
matchean ninguna regla. Con `--aplicar` lo ejecuta dentro de una transacción, y antes de
cerrarla comprueba que **el total mensual de plata que sale no haya cambiado**; si cambió,
aborta y no toca nada. El texto original de cada movimiento se conserva como descripción.

Las reglas están en `REGLAS`, ordenadas: gana la primera que coincide. Las de arriba de todo
resuelven los casos que caerían mal por las palabras que usan ("Almacén hamburguesas Sole" es
el almacén, no una hamburguesería; la nafta del viaje a Córdoba es parte de la carrera).
- Quedaron afuera, por ahora, las hojas de suscripciones USD/ARS, el detalle de pagos de
  Plataforma 5 y el histórico de facturas de luz.

## Estructura del proyecto

```
server.js          servidor HTTP + API JSON (sin dependencias)
db.js              esquema SQLite y acceso a datos
auth.js            clave de acceso y sesiones (sólo se activa con GASTOS_PASSWORD)
public/app.js      interfaz (HTML + CSS + JS a mano, sin framework)
public/charts.js   gráficos en SVG, también a mano
public/almacen-local.js  copia local de la planilla (la PWA trabaja contra esto)
public/sheets-api.js     conexión con Google Sheets: permiso, bajada y subida
public/sw.js       service worker: la app abre sin señal
apps-script/Codigo.gs    la lógica, única para los tres modos
pwa/               generada por build:pwa — lo que se sube a GitHub Pages
tools/import-sheet.js    importador del sheet
tools/verify-import.js   control de totales
tools/backup.js          copias de seguridad
data/gastos.db     tus datos
```

Las tres tablas que importan:

- `cells` — un monto por categoría y mes, cargado a mano en la grilla (acá está lo importado).
- `movements` — lo que cargás por formulario: fecha, categoría, subcategoría, importe y si está
  pagado. Suma a la celda de su categoría y mes.
- `subcategories` — las subcategorías que fuiste creando, por categoría.

Lo que muestra cada celda es `cells` + los `movements` pagados de esa categoría y mes.

Los colores de los gráficos (verde ingresos, rojo gastos, azul auto y quinta) están validados
para daltonismo y contraste contra las dos superficies de la app, clara y oscura. Por eso las
series siempre llevan leyenda y las tablas quedan al lado: el color nunca es el único dato.
