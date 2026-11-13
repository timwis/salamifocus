import { connect } from '../../server/src/db.ts';
import { createApplication } from '../../server/src/application/index.ts';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL must point at the database the app server under test uses.');

/** The server's own view of the data, through the application's queries. */
export const server = createApplication({ sql: connect(url, { max: 2 }) });
