import { connect } from '../../server/src/db.ts';
import { createApplication } from '../../server/src/application/index.ts';
import { databaseUrl } from './env.ts';

/** The server's own view of the data, through the application's queries. */
export const server = createApplication({ sql: connect(databaseUrl, { max: 2 }) });
