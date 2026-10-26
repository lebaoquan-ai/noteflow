export interface SqlStatementPort {
  run(...params: unknown[]): void;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export interface SqlEnginePort {
  exec(sql: string): void;
  prepare(sql: string): SqlStatementPort;
  close(): void;
}
