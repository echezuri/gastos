// Carga el SDK de Firebase y arranca la app.
//
// Es el único archivo que se sirve como módulo: el SDK moderno sólo viene así. Todo lo
// que importa se pasa a `arrancarApp()`, que es JavaScript común, para que el resto de la
// app no tenga que saber nada de esto.
//
// Se toma sólo lo que se usa. Traer el paquete entero serían cientos de kilobytes que en
// el teléfono se notan.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  browserLocalPersistence,
  setPersistence,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const app = initializeApp(CONFIG_FIREBASE);
const auth = getAuth(app);

/**
 * Firestore guarda una copia en el dispositivo.
 *
 * Sin esto, abrir la app baja los mil y pico de documentos de cero cada vez y son varios
 * segundos mirando "Cargando". Con la copia, la primera respuesta es inmediata y el
 * servidor manda después sólo lo que cambió.
 *
 * El administrador de pestañas es para que dos pestañas abiertas compartan esa copia en
 * vez de pelearse por ella.
 */
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

// La sesión sobrevive a cerrar la app: entrás una vez por dispositivo y listo.
await setPersistence(auth, browserLocalPersistence);

window.arrancarApp(
  { signInWithEmailAndPassword, onAuthStateChanged, signOut, collection, doc, setDoc, deleteDoc, onSnapshot },
  auth,
  db
);
