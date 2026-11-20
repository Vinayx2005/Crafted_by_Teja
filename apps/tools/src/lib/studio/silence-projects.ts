// Saved Silence remover projects, kept in this browser (IndexedDB). Nothing is uploaded.
// "projects" holds the small record (settings, edits, the volume readings); "videos" holds the
// video file itself, kept apart so saving an edit never rewrites the big file.

import type { Override } from './silence';

export type Rec = {
  id: string;
  name: string;
  fileName: string;
  size: number;
  total: number; // seconds, once analysed
  removed: number; // seconds cut by the current edits
  threshold: number;
  minSilence: number;
  buffer: number;
  splits: number[];
  overrides: Override[];
  vol: Uint8Array | null; // volume readings, so a project opens without listening again
  hasVideo: boolean;
  updatedAt: number;
};

const open = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open('studio-silence', 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('projects', { keyPath: 'id' });
      r.result.createObjectStore('videos');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

async function run<T>(store: 'projects' | 'videos', mode: IDBTransactionMode, go: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    const rq = go(t.objectStore(store));
    t.oncomplete = () => { db.close(); resolve(rq.result); };
    t.onerror = t.onabort = () => { db.close(); reject(t.error); };
  });
}

export const listProjects = async () => (await run<Rec[]>('projects', 'readonly', (s) => s.getAll())).sort((a, b) => b.updatedAt - a.updatedAt);
export const putProject = (r: Rec) => run('projects', 'readwrite', (s) => s.put(r));
export const getVideo = async (id: string) => (await run<Blob | undefined>('videos', 'readonly', (s) => s.get(id))) ?? null;
export const saveVideo = (id: string, b: Blob) => run('videos', 'readwrite', (s) => s.put(b, id));
export const deleteProject = async (id: string) => {
  await run('projects', 'readwrite', (s) => s.delete(id));
  await run('videos', 'readwrite', (s) => s.delete(id));
};
