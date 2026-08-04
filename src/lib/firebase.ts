import * as admin from 'firebase-admin';

// Evitamos inicializar múltiples veces en desarrollo con Next.js Hot Reload
if (!admin.apps.length) {
  try {
    // Estas variables las obtendremos del Service Account JSON de Firebase
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

    if (projectId && clientEmail && privateKey) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId,
          clientEmail,
          privateKey,
        }),
      });
      console.log('Firebase Admin inicializado correctamente');
    } else {
      console.warn('⚠️ Faltan credenciales de Firebase en el entorno (.env). La sincronización fallará.');
    }
  } catch (error) {
    console.error('Error inicializando Firebase Admin:', error);
  }
}

export const dbFirestore = admin.apps.length ? admin.firestore() : null;
