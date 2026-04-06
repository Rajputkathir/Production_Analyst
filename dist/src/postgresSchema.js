export const POSTGRES_SCHEMA_STATEMENTS = [
    `
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      full_name TEXT NOT NULL,
      email TEXT,
      password TEXT NOT NULL,
      role TEXT NOT NULL,
      team_id TEXT,
      is_active INTEGER DEFAULT 1,
      needs_password_change INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `,
    `
    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      client_name TEXT,
      team_leader_id TEXT,
      parent_id TEXT REFERENCES teams(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
      is_active INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `,
    `
    CREATE TABLE IF NOT EXISTS targets (
      id TEXT PRIMARY KEY,
      team_id TEXT,
      user_id TEXT,
      target_value INTEGER NOT NULL,
      period TEXT NOT NULL,
      effective_date TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `,
    `
    CREATE TABLE IF NOT EXISTS production_entries (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      client_name TEXT,
      date TEXT NOT NULL,
      production_value INTEGER NOT NULL,
      target_value INTEGER NOT NULL,
      quality TEXT,
      quality_low DOUBLE PRECISION DEFAULT 0,
      quality_medium DOUBLE PRECISION DEFAULT 0,
      quality_high DOUBLE PRECISION DEFAULT 0,
      notes TEXT,
      downtime DOUBLE PRECISION DEFAULT 0,
      downtime_reason TEXT,
      sample_production TEXT,
      reporting_to TEXT,
      is_locked INTEGER DEFAULT 0,
      created_by TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `,
    `
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `,
    `
    CREATE TABLE IF NOT EXISTS role_permissions (
      role TEXT NOT NULL,
      module TEXT NOT NULL,
      can_view INTEGER DEFAULT 0,
      can_create INTEGER DEFAULT 0,
      can_edit INTEGER DEFAULT 0,
      can_delete INTEGER DEFAULT 0,
      PRIMARY KEY (role, module)
    )
  `,
    `
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
      theme TEXT DEFAULT 'light'
    )
  `,
    `
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      type TEXT,
      reference_id TEXT,
      is_read INTEGER DEFAULT 0,
      is_shown INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `,
    `
    CREATE TABLE IF NOT EXISTS clients (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      team_id TEXT REFERENCES teams(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
      is_active INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(name, team_id)
    )
  `,
];
export const POSTGRES_OPTIONAL_COLUMNS = [
    { table: 'users', column: 'needs_password_change', definition: 'INTEGER DEFAULT 0' },
    { table: 'teams', column: 'parent_id', definition: 'TEXT' },
    { table: 'teams', column: 'team_leader_id', definition: 'TEXT' },
    { table: 'clients', column: 'team_id', definition: 'TEXT' },
    { table: 'notifications', column: 'type', definition: 'TEXT' },
    { table: 'notifications', column: 'reference_id', definition: 'TEXT' },
    { table: 'notifications', column: 'is_shown', definition: 'INTEGER DEFAULT 0' },
    { table: 'production_entries', column: 'reporting_to', definition: 'TEXT' },
    { table: 'production_entries', column: 'is_locked', definition: 'INTEGER DEFAULT 0' },
    { table: 'production_entries', column: 'created_by', definition: 'TEXT' },
    { table: 'production_entries', column: 'quality', definition: 'TEXT' },
    { table: 'production_entries', column: 'downtime', definition: 'DOUBLE PRECISION DEFAULT 0' },
    { table: 'production_entries', column: 'downtime_reason', definition: 'TEXT' },
    { table: 'production_entries', column: 'quality_low', definition: 'DOUBLE PRECISION DEFAULT 0' },
    { table: 'production_entries', column: 'quality_medium', definition: 'DOUBLE PRECISION DEFAULT 0' },
    { table: 'production_entries', column: 'quality_high', definition: 'DOUBLE PRECISION DEFAULT 0' },
    { table: 'production_entries', column: 'sample_production', definition: 'TEXT' },
    { table: 'user_settings', column: 'theme', definition: `TEXT DEFAULT 'light'` },
];
export const POSTGRES_INDEX_STATEMENTS = [
    'DROP INDEX IF EXISTS idx_targets_team_date',
    `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_targets_team_user_date
    ON targets (COALESCE(team_id, ''), COALESCE(user_id, ''), effective_date)
  `,
    'CREATE INDEX IF NOT EXISTS idx_prod_user ON production_entries(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_prod_team ON production_entries(team_id)',
    'CREATE INDEX IF NOT EXISTS idx_prod_date ON production_entries(date)',
    'CREATE INDEX IF NOT EXISTS idx_prod_created_by ON production_entries(created_by)',
    'CREATE INDEX IF NOT EXISTS idx_users_team ON users(team_id)',
    'CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, is_read)',
    'CREATE INDEX IF NOT EXISTS idx_notifications_user_shown ON notifications(user_id, is_shown)',
];
export const MIGRATION_TABLE_ORDER = [
    'users',
    'teams',
    'settings',
    'role_permissions',
    'user_settings',
    'notifications',
    'clients',
    'targets',
    'production_entries',
];
