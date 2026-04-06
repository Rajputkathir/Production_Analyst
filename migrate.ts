import * as dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

import { Pool, type PoolClient, types } from 'pg';
import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js';

import { buildDatabaseUrlFromEnv } from './src/postgresConfig.ts';
import {
  MIGRATION_TABLE_ORDER,
  POSTGRES_INDEX_STATEMENTS,
  POSTGRES_SCHEMA_STATEMENTS,
} from './src/postgresSchema.ts';

type Row = Record<string, any>;
type FieldSpec = string | { target: string; sources: string[] };

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

types.setTypeParser(20, (value) => Number.parseInt(value, 10));
types.setTypeParser(1700, (value) => Number.parseFloat(value));

const sqlitePath = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : path.resolve(process.cwd(), 'production_analyst.db');
const shouldResetTarget = process.argv.includes('--reset');
const sslMode = (process.env.PGSSLMODE || '').toLowerCase();
const useSsl = process.env.PGSSL === 'true' || ['require', 'verify-ca', 'verify-full'].includes(sslMode);

const TABLE_FIELDS: Record<(typeof MIGRATION_TABLE_ORDER)[number], FieldSpec[]> = {
  users: [
    'id',
    'username',
    'full_name',
    'email',
    'password',
    'role',
    'team_id',
    'is_active',
    'needs_password_change',
    'created_at',
  ],
  teams: ['id', 'name', 'description', 'client_name', 'team_leader_id', 'parent_id', 'is_active', 'created_at'],
  settings: ['key', 'value'],
  role_permissions: ['role', 'module', 'can_view', 'can_create', 'can_edit', 'can_delete'],
  user_settings: ['user_id', 'theme'],
  notifications: ['id', 'user_id', 'title', 'message', 'type', 'reference_id', 'is_read', 'is_shown', 'created_at'],
  clients: ['id', 'name', 'team_id', 'is_active', 'created_at'],
  targets: ['id', 'team_id', 'user_id', 'target_value', 'period', 'effective_date', 'created_at'],
  production_entries: [
    'id',
    'team_id',
    'user_id',
    'client_name',
    'date',
    'production_value',
    'target_value',
    'quality',
    'quality_low',
    'quality_medium',
    'quality_high',
    'notes',
    'downtime',
    'downtime_reason',
    { target: 'sample_production', sources: ['sample_production', 'sample_name'] },
    'reporting_to',
    'is_locked',
    'created_by',
    'created_at',
  ],
};

function querySqliteRows(sqliteDb: SqlJsDatabase, sql: string, params: any[] = []) {
  const statement = sqliteDb.prepare(sql);

  try {
    if (params.length > 0) {
      statement.bind(params);
    }

    const rows: Row[] = [];
    while (statement.step()) {
      rows.push(statement.getAsObject() as Row);
    }
    return rows;
  } finally {
    statement.free();
  }
}

function sqliteTableExists(sqliteDb: SqlJsDatabase, tableName: string) {
  return querySqliteRows(
    sqliteDb,
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    [tableName]
  ).length > 0;
}

function getSqliteColumns(sqliteDb: SqlJsDatabase, tableName: string) {
  return new Set(querySqliteRows(sqliteDb, `PRAGMA table_info(${tableName})`).map((row) => String(row.name)));
}

function getSQLiteTableRows(sqliteDb: SqlJsDatabase, tableName: (typeof MIGRATION_TABLE_ORDER)[number]) {
  if (!sqliteTableExists(sqliteDb, tableName)) {
    return [];
  }

  const availableColumns = getSqliteColumns(sqliteDb, tableName);
  const selectExpressions: string[] = [];

  for (const field of TABLE_FIELDS[tableName]) {
    if (typeof field === 'string') {
      if (availableColumns.has(field)) {
        selectExpressions.push(field);
      }
      continue;
    }

    const sourceColumn = field.sources.find((candidate) => availableColumns.has(candidate));
    if (!sourceColumn) {
      continue;
    }

    selectExpressions.push(sourceColumn === field.target ? sourceColumn : `${sourceColumn} AS ${field.target}`);
  }

  if (selectExpressions.length === 0) {
    return [];
  }

  return querySqliteRows(sqliteDb, `SELECT ${selectExpressions.join(', ')} FROM ${tableName}`);
}

async function applyPostgresSchema(client: PoolClient) {
  for (const statement of POSTGRES_SCHEMA_STATEMENTS) {
    await client.query(statement);
  }

  for (const statement of POSTGRES_INDEX_STATEMENTS) {
    await client.query(statement);
  }
}

async function ensureTargetDatabaseReady(client: PoolClient) {
  const existing = await client.query('SELECT COUNT(*)::int AS count FROM users');
  const existingCount = Number(existing.rows[0]?.count || 0);

  if (existingCount === 0) {
    return;
  }

  if (!shouldResetTarget) {
    throw new Error(
      'PostgreSQL already contains data. Re-run with --reset to clear migrated tables before copying SQLite data.'
    );
  }

  await client.query(`TRUNCATE TABLE ${[...MIGRATION_TABLE_ORDER].reverse().join(', ')} CASCADE`);
}

async function insertRows(client: PoolClient, tableName: (typeof MIGRATION_TABLE_ORDER)[number], rows: Row[]) {
  if (rows.length === 0) {
    console.log(`Skipping ${tableName}: no rows found in SQLite.`);
    return;
  }

  for (const row of rows) {
    const columns = Object.keys(row).filter((column) => row[column] !== undefined);
    const values = columns.map((column) => row[column]);
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');

    await client.query(
      `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})`,
      values
    );
  }

  console.log(`Migrated ${rows.length} row(s) into ${tableName}.`);
}

async function main() {
  if (!fs.existsSync(sqlitePath)) {
    throw new Error(`SQLite database not found at ${sqlitePath}`);
  }

  const sqliteFile = fs.readFileSync(sqlitePath);
  if (sqliteFile.length === 0) {
    throw new Error(`SQLite database at ${sqlitePath} is empty.`);
  }

  const SQL = await initSqlJs({
    locateFile: (file) => path.resolve(process.cwd(), 'node_modules', 'sql.js', 'dist', file),
  });

  const sqliteDb = new SQL.Database(sqliteFile);
  const databaseUrl = buildDatabaseUrlFromEnv(process.env);
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: useSsl
      ? {
          rejectUnauthorized: process.env.PGSSL_REJECT_UNAUTHORIZED === 'true',
        }
      : undefined,
  });
  const client = await pool.connect();

  try {
    console.log(`Reading SQLite data from ${sqlitePath}`);
    console.log(`Writing PostgreSQL data to ${databaseUrl}`);

    await client.query('SELECT 1');
    console.log('Connected to PostgreSQL');

    await client.query('BEGIN');
    await client.query('SET CONSTRAINTS ALL DEFERRED');

    await applyPostgresSchema(client);
    await ensureTargetDatabaseReady(client);

    for (const tableName of MIGRATION_TABLE_ORDER) {
      const rows = getSQLiteTableRows(sqliteDb, tableName);
      await insertRows(client, tableName, rows);
    }

    await client.query('COMMIT');
    console.log('SQLite to PostgreSQL migration completed successfully.');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
    sqliteDb.close();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Migration failed:', error);
  process.exitCode = 1;
});
