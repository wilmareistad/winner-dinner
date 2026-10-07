// Connection settings for the dev database, built from .env.local.
// Uses the session pooler because the direct host is IPv6 only.
const DEFAULT_HOST = "aws-1-eu-west-1.pooler.supabase.com";

export function projectRef() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
  return new URL(url).hostname.split(".")[0];
}

export function dbConfig() {
  const password = process.env.SUPABASE_DB_PASSWORD;
  if (!password) throw new Error("SUPABASE_DB_PASSWORD is not set (see .env.example)");
  return {
    host: process.env.SUPABASE_DB_HOST || DEFAULT_HOST,
    port: 5432,
    user: `postgres.${projectRef()}`,
    database: "postgres",
    password,
    ssl: { rejectUnauthorized: false },
  };
}

export function dbUrl() {
  const c = dbConfig();
  return `postgresql://${encodeURIComponent(c.user)}:${encodeURIComponent(c.password)}@${c.host}:${c.port}/${c.database}`;
}
