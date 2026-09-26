// Save/load: IndexedDB slots holding gzip-compressed JSON { state, world edits } + metadata/thumbnail.
import { gzipSync, gunzipSync, strToU8, strFromU8 } from 'fflate';
import type { GameState, WorldEditsSave } from '../core/types';
import type { SaveSlotInfo } from '../core/client';
import { SAVE_VERSION } from '../core/constants';

export interface SaveBlob {
  format: 'petrocraft-save';
  version: number;
  state: GameState;
  world: WorldEditsSave;
}

const DB_NAME = 'petrocraft';
const DB_VERSION = 1;
const DATA = 'saves';
const META = 'meta';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DATA)) db.createObjectStore(DATA);
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(db: IDBDatabase, stores: string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => IDBRequest<T> | void): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    const req = fn(t);
    t.oncomplete = () => resolve(req ? (req.result as T) : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export function encodeSave(blob: SaveBlob): Uint8Array {
  return gzipSync(strToU8(JSON.stringify(blob)), { level: 6 });
}

export function decodeSave(bytes: Uint8Array): SaveBlob {
  const json = strFromU8(gunzipSync(bytes));
  const blob = JSON.parse(json) as SaveBlob;
  if (blob.format !== 'petrocraft-save') throw new Error('Not a PetroCraft save file');
  return migrate(blob);
}

/** Upgrade older save formats in place. */
function migrate(blob: SaveBlob): SaveBlob {
  if (blob.version > SAVE_VERSION) throw new Error('Save was created by a newer version of PetroCraft');
  // v1 is current. Future migrations: if (blob.version < 2) {...}
  blob.version = SAVE_VERSION;
  return blob;
}

export class SaveManager {
  private dbp: Promise<IDBDatabase> | null = null;
  private db() {
    return (this.dbp ??= openDb());
  }

  async save(slot: string, blob: SaveBlob, thumbnail?: string): Promise<SaveSlotInfo> {
    const bytes = encodeSave(blob);
    const s = blob.state;
    const info: SaveSlotInfo = {
      slot, saveName: s.meta.saveName, companyName: s.meta.companyName, day: s.time.day, money: s.company.money,
      savedAt: Date.now(), playTimeSec: s.meta.playTimeSec, worldSize: s.meta.worldSize, difficulty: s.meta.difficulty, thumbnail,
    };
    const db = await this.db();
    await tx(db, [DATA, META], 'readwrite', (t) => {
      t.objectStore(DATA).put(bytes, slot);
      t.objectStore(META).put(info, slot);
    });
    return info;
  }

  async load(slot: string): Promise<SaveBlob> {
    const db = await this.db();
    const bytes = await tx<Uint8Array>(db, [DATA], 'readonly', (t) => t.objectStore(DATA).get(slot));
    if (!bytes) throw new Error(`Save "${slot}" not found`);
    return decodeSave(bytes);
  }

  async list(): Promise<SaveSlotInfo[]> {
    const db = await this.db();
    const all = (await tx<SaveSlotInfo[]>(db, [META], 'readonly', (t) => t.objectStore(META).getAll())) ?? [];
    return all.sort((a, b) => b.savedAt - a.savedAt);
  }

  async delete(slot: string): Promise<void> {
    const db = await this.db();
    await tx(db, [DATA, META], 'readwrite', (t) => {
      t.objectStore(DATA).delete(slot);
      t.objectStore(META).delete(slot);
    });
  }

  async exportFile(slot: string): Promise<Blob> {
    const db = await this.db();
    const bytes = await tx<Uint8Array>(db, [DATA], 'readonly', (t) => t.objectStore(DATA).get(slot));
    if (!bytes) throw new Error(`Save "${slot}" not found`);
    return new Blob([bytes as BlobPart], { type: 'application/octet-stream' });
  }

  async importFile(file: File): Promise<string> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const blob = decodeSave(bytes);
    const slot = `import-${Date.now().toString(36)}`;
    await this.save(slot, blob);
    return slot;
  }
}
