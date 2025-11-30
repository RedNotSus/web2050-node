import pg from 'pg';

const { Pool } = pg;

let pool;

export function initDB(config = {}) {
  if (config.pool) {
      pool = config.pool;
  } else {
      const poolConfig = {
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
      };

      if (process.env.DATABASE_URL) {
          poolConfig.connectionString = process.env.DATABASE_URL;
      }

      pool = new Pool(poolConfig);
  }
}

export async function setup() {
  try {
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
  } catch (err) {
    console.error('Failed to connect to database or create tables:', err.message);
    throw new Error('Database initialization failed. Please check your PostgreSQL connection settings.');
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

  const sql = `
    SELECT path, content
    FROM pages
    WHERE path ILIKE $1 ESCAPE '\\' OR content ILIKE $1 ESCAPE '\\'
    ORDER BY created_at DESC
  `;
  const escapedQuery = query.replace(/[%_\\]/g, '\\$&');
  const wild = `%${escapedQuery}%`;
  const res = await pool.query(sql, [wild]);
  return res.rows;
}

export async function getDomainPages(domainPrefix) {
    if (!pool) initDB();
    const sql = `SELECT path, content FROM pages WHERE path LIKE $1`;
    const wild = `${domainPrefix}/%`;
    const res = await pool.query(sql, [wild]);
    return res.rows;
}

export async function close() {
    if (pool) await pool.end();
}
