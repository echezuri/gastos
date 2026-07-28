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
  getFirestore,
  collection,
  doc,
  getDocs,
  setDoc,
  deleteDoc,
  onSnapshot,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const app = initializeApp(CONFIG_FIREBASE);
const auth = getAuth(app);
const db = getFirestore(app);

// La sesión sobrevive a cerrar la app: entrás una vez por dispositivo y listo.
await setPersistence(auth, browserLocalPersistence);

window.arrancarApp(
  { signInWithEmailAndPassword, onAuthStateChanged, signOut, collection, doc, getDocs, setDoc, deleteDoc, onSnapshot },
  auth,
  db
);
