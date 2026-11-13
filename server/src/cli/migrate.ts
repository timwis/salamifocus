import { connect, migrate } from '../db.ts';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL must be set.');
const sql = connect(url, { max: 1 });
const applied = await migrate(sql);
console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Already up to date.');
await sql.end();
