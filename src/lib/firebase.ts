import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

if (!getApps().length) {
  try {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

    if (projectId && clientEmail && privateKey) {
      initializeApp({
        credential: cert({
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

export const dbFirestore = getApps().length ? getFirestore() : null;
