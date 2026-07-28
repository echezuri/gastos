'use strict';

/**
 * Conexión con Firebase.
 *
 * Estos valores son públicos por diseño: identifican al proyecto, no dan permisos. Quien
 * los tenga no puede leer ni escribir nada, porque las reglas de Firestore exigen haber
 * entrado con la cuenta autorizada (ver db/reglas-firestore.txt).
 */
const CONFIG_FIREBASE = {
  apiKey: 'AIzaSyBxilzO6GHog08nofqMq6g-uYsyeI32YzY',
  authDomain: 'gastos-dff39.firebaseapp.com',
  projectId: 'gastos-dff39',
};
