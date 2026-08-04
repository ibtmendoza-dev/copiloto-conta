import { openDB } from 'idb';

const DB_NAME = 'copiloto-offline-db';
const STORE_NAME = 'movements';

export async function initDB() {
  return openDB(DB_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        // Usamos un ID autoincremental local para la cola
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    },
  });
}

export async function savePendingMovement(payload: { inputOriginal: string, imageBase64?: string, clientMessageId?: string }) {
  const db = await initDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  await store.add({
    ...payload,
    timestamp: new Date().toISOString()
  });
  await tx.done;
}

export async function getPendingMovements() {
  const db = await initDB();
  return db.getAll(STORE_NAME);
}

export async function deletePendingMovement(id: number) {
  const db = await initDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  await tx.objectStore(STORE_NAME).delete(id);
  await tx.done;
}
