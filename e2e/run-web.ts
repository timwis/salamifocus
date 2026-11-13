// Runs the web end-to-end tests against a fresh throwaway stack. Extra
// arguments go to Playwright, e.g. `pnpm test:e2e:web --headed`.
import { run, startStack } from './support/stack.ts';

const stack = await startStack();
process.on('SIGINT', () => void stack.stop().then(() => process.exit(130)));
const code = await run('pnpm', ['exec', 'playwright', 'test', ...process.argv.slice(2)], import.meta.dirname);
await stack.stop({ failed: code !== 0 });
process.exit(code);
