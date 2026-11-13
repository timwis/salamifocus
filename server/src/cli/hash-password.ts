import { createInterface } from 'node:readline/promises';
import { hashPassword } from '../auth/password.ts';

// Prints a hash for OWNER_PASSWORD_HASH. Reads the password from stdin so it
// never appears in shell history or the process list.
const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: false });
process.stderr.write('Password: ');
let password = '';
for await (const line of rl) {
  password = line;
  break;
}
rl.close();
if (!password) {
  console.error('No password given.');
  process.exit(1);
}
console.log(await hashPassword(password));
