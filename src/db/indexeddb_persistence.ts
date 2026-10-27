import {
  BrowserSqlSnapshotSchema,
  type BrowserSqlEngine,
  type BrowserSqlSnapshot,
} from './browser_sql_engine.js';

export interface VaultKvBackend {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

const DEFAULT_DB_NAME = 'noteflow_vault_v1';
const DEFAULT_STORE_NAME = 'snapshots';
const PRIMARY_SNAPSHOT_KEY = 'primary_canvas_snapshot';

export class InMemoryVaultBackend implements VaultKvBackend {
  private readonly store = new Map<string, unknown>();

  public async get(key: string): Promise<unknown> {
    const raw = this.store.get(key);
    return raw !== undefined ? JSON.parse(JSON.stringify(raw)) : undefined;
  }

  public async set(key: string, value: unknown): Promise<void> {
    this.store.set(key, JSON.parse(JSON.stringify(value)));
  }

  public async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

export class BrowserIndexedDbBackend implements VaultKvBackend {
  private dbPromise: Promise<IDBDatabase> | null = null;

  public constructor(
    private readonly dbName: string = DEFAULT_DB_NAME,
    private readonly storeName: string = DEFAULT_STORE_NAME
  ) {}

  private openDb(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('indexedDB is not available in this environment'));
        return;
      }
      const req = indexedDB.open(this.dbName, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () =>
        reject(req.error ?? new Error('Failed to open IndexedDB'));
    });
    return this.dbPromise;
  }

  public async get(key: string): Promise<unknown> {
    const db = await this.openDb();
    return new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readonly');
      const store = tx.objectStore(this.storeName);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () =>
        reject(req.error ?? new Error('IndexedDB get failed'));
    });
  }

  public async set(key: string, value: unknown): Promise<void> {
    const db = await this.openDb();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      const req = store.put(value, key);
      req.onsuccess = () => resolve();
      req.onerror = () =>
        reject(req.error ?? new Error('IndexedDB put failed'));
    });
  }

  public async delete(key: string): Promise<void> {
    const db = await this.openDb();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      const req = store.delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () =>
        reject(req.error ?? new Error('IndexedDB delete failed'));
    });
  }
}

export class IndexedDbVaultStorage {
  private readonly backend: VaultKvBackend;
  private readonly debounceMs: number;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSavedCount = 0;

  public constructor(options?: {
    backend?: VaultKvBackend;
    debounceMs?: number;
  }) {
    this.backend =
      options?.backend ??
      (typeof indexedDB !== 'undefined'
        ? new BrowserIndexedDbBackend()
        : new InMemoryVaultBackend());
    this.debounceMs = options?.debounceMs ?? 250;
  }

  public get saveCount(): number {
    return this.lastSavedCount;
  }

  public bindEngine(engine: BrowserSqlEngine): void {
    engine.onMutation = () => {
      this.scheduleSave(engine);
    };
  }

  public scheduleSave(engine: BrowserSqlEngine): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.saveImmediate(engine);
    }, this.debounceMs);
  }

  public async saveImmediate(engine: BrowserSqlEngine): Promise<void> {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    const snapshot = engine.exportSnapshot();
    await this.backend.set(PRIMARY_SNAPSHOT_KEY, snapshot);
    this.lastSavedCount++;
  }

  public async loadSnapshot(): Promise<BrowserSqlSnapshot | null> {
    const raw = await this.backend.get(PRIMARY_SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed = BrowserSqlSnapshotSchema.safeParse(raw);
    if (!parsed.success) {
      return null;
    }
    return parsed.data;
  }

  public async hydrateEngine(engine: BrowserSqlEngine): Promise<boolean> {
    const snapshot = await this.loadSnapshot();
    if (!snapshot) return false;
    engine.importSnapshot(snapshot);
    return true;
  }

  public async clearVault(): Promise<void> {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    await this.backend.delete(PRIMARY_SNAPSHOT_KEY);
  }
}
