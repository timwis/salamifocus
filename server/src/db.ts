import { readdir, readFile } from 'node:fs/promises';
import postgres from 'postgres';

export type Sql = postgres.Sql;
export type TransactionSql = postgres.TransactionSql;

const migrationsDir = new URL('../migrations/', import.meta.url);

export function connect(url: string, options: { max?: number } = {}): Sql {
  return postgres(url, {
    max: options.max ?? 10,
    onnotice: () => {},
    types: {
      // Keep timestamps as ISO strings end to end rather than JS Dates.
      timestamptz: {
        to: 1184,
        from: [1184],
        serialize: (value: string | Date) => (value instanceof Date ? value.toISOString() : value),
        parse: (value: string) => new Date(value).toISOString(),
      },
    },
  });
}

export async function migrate(sql: Sql): Promise<string[]> {
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
  const applied: string[] = [];
  for (const name of files) {
    await sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtext('schema_migrations'))`;
      const [done] = await tx`SELECT 1 FROM schema_migrations WHERE name = ${name}`;
      if (done) return;
      await tx.unsafe(await readFile(new URL(name, migrationsDir), 'utf8'));
      await tx`INSERT INTO schema_migrations (name) VALUES (${name})`;
      applied.push(name);
    });
  }
  return applied;
}
