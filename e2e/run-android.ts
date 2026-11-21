// Runs the Android end-to-end tests on the connected emulator against a fresh
// throwaway stack, with a network switch between the emulator and the server
// so the tests can take the phone offline. Needs JDK 17.
import { join } from 'node:path';
import { allocatePorts } from './support/ports.ts';

// The ports must be chosen before anything reads them from env.ts.
await allocatePorts();
const { ports } = await import('./support/env.ts');
const { run, startProcess, startStack, waitFor } = await import('./support/stack.ts');

const host = 'http://10.0.2.2'; // The development machine, as the emulator sees it.
const stack = await startStack();
const networkSwitch = startProcess([
  'e2e/support/network-switch.ts',
  '--listen', String(ports.androidSwitch),
  '--control', String(ports.androidSwitchControl),
  '--target', `http://127.0.0.1:${ports.server}`,
]);
const stop = async (failed: boolean) => {
  networkSwitch.kill();
  await stack.stop({ failed });
};
process.on('SIGINT', () => void stop(false).then(() => process.exit(130)));
await waitFor(`http://127.0.0.1:${ports.androidSwitchControl}/`);

const argument = (name: string, value: string) => `-Pandroid.testInstrumentationRunnerArguments.${name}=${value}`;
const code = await run(
  './gradlew',
  [
    '--console=plain',
    'connectedDebugAndroidTest',
    argument('serverUrl', `${host}:${ports.androidSwitch}`),
    argument('directServerUrl', `${host}:${ports.server}`),
    argument('networkControl', `${host}:${ports.androidSwitchControl}`),
    ...process.argv.slice(2),
  ],
  join(import.meta.dirname, '../android'),
);
await stop(code !== 0);
process.exit(code);
