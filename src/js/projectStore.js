// IndexedDB-backed autosave. localStorage is too small for image-heavy projects.
const DB_NAME = "torus-drawing-app";
const STORE = "autosave";
const KEY = "current";

function openDb() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error("IndexedDB unavailable"));
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open IndexedDB"));
  });
}

async function withStore(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      const request = fn(store);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
    });
  } finally {
    db.close();
  }
}

export async function saveAutosave(project) {
  await withStore("readwrite", store => store.put(project, KEY));
}

export async function loadAutosave() {
  return withStore("readonly", store => store.get(KEY));
}

export async function clearAutosave() {
  await withStore("readwrite", store => store.delete(KEY));
}
