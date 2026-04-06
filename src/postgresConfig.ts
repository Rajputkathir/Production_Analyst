const SSL_MODE_VALUES = new Set(['require', 'verify-ca', 'verify-full']);
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1']);

function parseDatabaseUrl(databaseUrl?: string) {
  if (!databaseUrl) return null;

  try {
    return new URL(databaseUrl);
  } catch {
    return null;
  }
}

function hasSslQuery(url: URL) {
  const ssl = (url.searchParams.get('ssl') || '').toLowerCase();
  const sslMode = (url.searchParams.get('sslmode') || '').toLowerCase();
  return ssl === 'true' || ssl === '1' || SSL_MODE_VALUES.has(sslMode);
}

function isLocalHostname(hostname: string) {
  return LOCAL_HOSTNAMES.has(hostname.toLowerCase());
}

export function applyPgEnvDefaults(env: NodeJS.ProcessEnv = process.env) {
  env.PGHOST ||= 'localhost';
  env.PGPORT ||= '5432';
  env.PGUSER ||= 'postgres';
  env.PGPASSWORD ||= '';
  env.PGDATABASE ||= 'production_analyst';
  env.PGSSL ||= 'false';
  env.PGSSL_REJECT_UNAUTHORIZED ||= 'false';
}

export function shouldUseSslFromEnv(env: NodeJS.ProcessEnv = process.env, databaseUrl = env.DATABASE_URL) {
  const sslMode = (env.PGSSLMODE || '').toLowerCase();
  if (env.PGSSL === 'true' || SSL_MODE_VALUES.has(sslMode)) {
    return true;
  }

  const url = parseDatabaseUrl(databaseUrl);
  if (!url) {
    return false;
  }

  if (hasSslQuery(url)) {
    return true;
  }

  const isHostedProduction = env.RENDER === 'true' || env.NODE_ENV === 'production';
  return isHostedProduction && !isLocalHostname(url.hostname);
}

export function normalizeDatabaseUrl(databaseUrl: string, env: NodeJS.ProcessEnv = process.env) {
  const url = parseDatabaseUrl(databaseUrl);
  if (!url) {
    return databaseUrl;
  }

  if (shouldUseSslFromEnv(env, databaseUrl) && !hasSslQuery(url)) {
    url.searchParams.set('sslmode', 'require');
  }

  return url.toString();
}

export function buildDatabaseUrlFromEnv(env: NodeJS.ProcessEnv = process.env) {
  if (typeof env.DATABASE_URL === 'string' && env.DATABASE_URL.trim()) {
    return normalizeDatabaseUrl(env.DATABASE_URL.trim(), env);
  }

  applyPgEnvDefaults(env);

  const url = new URL('postgresql://localhost');
  url.hostname = env.PGHOST || 'localhost';
  url.port = env.PGPORT || '5432';
  url.username = env.PGUSER || 'postgres';
  url.password = String(env.PGPASSWORD ?? '');
  url.pathname = `/${env.PGDATABASE || 'production_analyst'}`;

  return normalizeDatabaseUrl(url.toString(), env);
}

export function ensureDatabaseUrl(env: NodeJS.ProcessEnv = process.env) {
  env.DATABASE_URL = buildDatabaseUrlFromEnv(env);
  return env.DATABASE_URL;
}
