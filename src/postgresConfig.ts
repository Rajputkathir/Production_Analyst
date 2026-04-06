export function applyPgEnvDefaults(env: NodeJS.ProcessEnv = process.env) {
  env.PGHOST ||= 'localhost';
  env.PGPORT ||= '5432';
  env.PGUSER ||= 'postgres';
  env.PGPASSWORD ||= '';
  env.PGDATABASE ||= 'production_analyst';
  env.PGSSL ||= 'false';
  env.PGSSL_REJECT_UNAUTHORIZED ||= 'false';
}

export function buildDatabaseUrlFromEnv(env: NodeJS.ProcessEnv = process.env) {
  if (typeof env.DATABASE_URL === 'string' && env.DATABASE_URL.trim()) {
    return env.DATABASE_URL.trim();
  }

  applyPgEnvDefaults(env);

  const url = new URL('postgresql://localhost');
  url.hostname = env.PGHOST || 'localhost';
  url.port = env.PGPORT || '5432';
  url.username = env.PGUSER || 'postgres';
  url.password = String(env.PGPASSWORD ?? '');
  url.pathname = `/${env.PGDATABASE || 'production_analyst'}`;

  return url.toString();
}

export function ensureDatabaseUrl(env: NodeJS.ProcessEnv = process.env) {
  env.DATABASE_URL = buildDatabaseUrlFromEnv(env);
  return env.DATABASE_URL;
}
