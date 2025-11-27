import pg from 'pg';

const { Pool } = pg;

// Default config uses env vars: PGHOST, PGUSER, PGDATABASE, PGPASSWORD, PGPORT
// or DATABASE_URL
let pool;

export function initDB(config = {}) {
  // If config is provided (e.g. for testing with pg-mem), use it.
  // Otherwise default to standard env vars.
  if (config.pool) {
      pool = config.pool;
  } else {
      pool = new Pool({
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
      });
  }
}

export async function setup() {
  if (!pool) initDB();
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS pages (
        path TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
  } finally {
    client.release();
  }
}

export async function getPage(path) {
  if (!pool) initDB();
  const res = await pool.query('SELECT * FROM pages WHERE path = $1', [path]);
  return res.rows[0];
}

export async function savePage(path, content) {
  if (!pool) initDB();
  // Upsert logic
  const query = `
    INSERT INTO pages (path, content, created_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (path)
    DO UPDATE SET content = EXCLUDED.content, created_at = NOW()
    RETURNING *;
  `;
  const res = await pool.query(query, [path, content]);
  return res.rows[0];
}

export async function deletePage(path) {
  if (!pool) initDB();
  await pool.query('DELETE FROM pages WHERE path = $1', [path]);
}

export async function searchPages(query) {
  if (!pool) initDB();

  if (!query) {
      const res = await pool.query('SELECT path FROM pages ORDER BY created_at DESC');
      return res.rows.map(r => r.path);
  }

  // Simple ILIKE search
  const sql = `
    SELECT path, content
    FROM pages
    WHERE path ILIKE $1 OR content ILIKE $1
    ORDER BY created_at DESC
  `;
  const wild = `%${query}%`;
  const res = await pool.query(sql, [wild]);
  return res.rows;
}

export async function getDomainPages(domainPrefix) {
    if (!pool) initDB();
    // Assuming domainPrefix is like "example.com"
    // We want "example.com/%" (anything inside) OR "example.com" (the root file if normalized)
    // But since we normalize "example.com" -> "example.com/index.html", checking prefix "example.com/" is safer
    // to avoid "example.comedy/..." matching "example.com"

    // However, user might pass "google.com".
    // We should search for path LIKE 'google.com/%'

    const sql = `SELECT path, content FROM pages WHERE path LIKE $1`;
    const wild = `${domainPrefix}/%`;
    const res = await pool.query(sql, [wild]);
    return res.rows;
}

export async function close() {
    if (pool) await pool.end();
}
