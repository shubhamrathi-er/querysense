export type DatabaseEngine =
  | 'mysql'
  | 'mariadb'
  | 'postgres'
  | 'redshift'
  | 'sqlserver';

export interface Connection {
  id: string;
  name: string;
  engine: DatabaseEngine;
  host: string;
  port: number;
  databaseName: string;
  username: string;
  sslEnabled: boolean;
  sshEnabled: boolean;
  sshHost: string | null;
  sshPort: number | null;
  sshUsername: string | null;
  status: 'PENDING' | 'ACTIVE' | 'ERROR' | 'DISCONNECTED';
  lastTestedAt: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
  _count?: { schemaMetadata: number };
}

/** SSH tunnel fields sent to the API when creating/testing a connection. */
export interface SshConnectionInput {
  sshEnabled?: boolean;
  sshHost?: string;
  sshPort?: number;
  sshUsername?: string;
  sshPassword?: string;
  sshPrivateKey?: string;
  sshPassphrase?: string;
}

export interface SchemaTable {
  id: string;
  tableName: string;
  tableComment: string | null;
  aiDescription: string | null;
  businessDescription?: string | null;
  rowCount: number | null;
  isView: boolean;
  moduleId?: string | null;
  columns: SchemaColumn[];
}

export interface SchemaColumn {
  id: string;
  columnName: string;
  dataType: string;
  isNullable: boolean;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  referencesTable: string | null;
  referencesColumn: string | null;
  columnComment?: string | null;
  aiDescription?: string | null;
  sampleValues?: string[] | null;
}

export interface TestConnectionResult {
  success: boolean;
  message: string;
  latencyMs: number;
}

export type AuditSeverity = 'high' | 'medium' | 'low' | 'info';

export interface AuditFinding {
  id: string;
  severity: AuditSeverity;
  category: string;
  title: string;
  table?: string;
  column?: string;
  detail: string;
  recommendation: string;
  fixSql?: string;
  aiGenerated?: boolean;
}

export interface AuditReport {
  score: number;
  generatedAt: string;
  summary: {
    tables: number;
    columns: number;
    high: number;
    medium: number;
    low: number;
    info: number;
  };
  findings: AuditFinding[];
}

export interface SchemaModule {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  ordinal: number;
}

export interface ConnectionWithSchema extends Connection {
  schemaMetadata: SchemaTable[];
  modules: SchemaModule[];
}