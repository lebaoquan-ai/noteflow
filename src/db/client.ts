import type { SqlEnginePort } from './engine_port.js';
import { BrowserSqlEngine } from './browser_sql_engine.js';

function createDefaultEngine(filename: string): SqlEnginePort {
  if (
    typeof process !== 'undefined' &&
    typeof process.getBuiltinModule === 'function'
  ) {
    const sqlite = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite');
    const fs = process.getBuiltinModule('node:fs') as typeof import('node:fs');
    const url = process.getBuiltinModule('node:url') as typeof import('node:url');
    const path = process.getBuiltinModule('node:path') as typeof import('node:path');

    const dir = path.dirname(url.fileURLToPath(import.meta.url));
    const schemaPath = path.join(dir, 'schema.sql');
    const db = new sqlite.DatabaseSync(filename);
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec(fs.readFileSync(schemaPath, 'utf-8'));
    return db as unknown as SqlEnginePort;
  }

  return new BrowserSqlEngine();
}

export class NoteFlowDatabase {
  public readonly raw: SqlEnginePort;
  private transactionDepth = 0;

  public constructor(engineOrFilename: SqlEnginePort | string = ':memory:') {
    if (typeof engineOrFilename === 'string') {
      this.raw = createDefaultEngine(engineOrFilename);
    } else {
      this.raw = engineOrFilename;
    }
  }

  public static createInMemory(): NoteFlowDatabase {
    return new NoteFlowDatabase(':memory:');
  }

  public static createBrowserInMemory(): NoteFlowDatabase {
    return new NoteFlowDatabase(new BrowserSqlEngine());
  }

  /**
   * Executes `fn` inside an atomic SQLite transaction (or SAVEPOINT if nested).
   */
  public transaction<T>(fn: () => T): T {
    const isOuter = this.transactionDepth === 0;
    const savepointName = `sp_${this.transactionDepth}`;
    this.transactionDepth++;

    if (isOuter) {
      this.raw.exec('BEGIN IMMEDIATE;');
    } else {
      this.raw.exec(`SAVEPOINT ${savepointName};`);
    }

    try {
      const result = fn();
      this.transactionDepth--;
      if (isOuter) {
        this.raw.exec('COMMIT;');
      } else {
        this.raw.exec(`RELEASE SAVEPOINT ${savepointName};`);
      }
      return result;
    } catch (err) {
      this.transactionDepth--;
      if (isOuter) {
        this.raw.exec('ROLLBACK;');
      } else {
        this.raw.exec(`ROLLBACK TO SAVEPOINT ${savepointName};`);
      }
      throw err;
    }
  }

  public close(): void {
    this.raw.close();
  }
}
