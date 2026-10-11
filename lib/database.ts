import { Pool } from "@neondatabase/serverless";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function query(text: string, params?: unknown[]) {
  const client = await pool.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

export async function initDb() {
  await query(`
    CREATE TABLE IF NOT EXISTS simulation_history (
      id SERIAL PRIMARY KEY,
      building_name VARCHAR(255) NOT NULL,
      scenario VARCHAR(50) NOT NULL,
      radius INT NOT NULL,
      affected_count INT NOT NULL,
      summary TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `);
}