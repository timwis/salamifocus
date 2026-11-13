import { expect, test, type Page } from '@playwright/test';
import { SimulatedDevice } from '../support/device.ts';
import { password } from '../support/env.ts';
import { network } from '../support/network.ts';
import { server } from '../support/server.ts';

const run = Date.now().toString(36);

async function signIn(page: Page) {
  await page.goto('/');
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible();
}

const inbox = (page: Page) => page.getByRole('list', { name: 'Inbox' });
const status = (page: Page) => page.getByRole('status');

async function rename(page: Page, from: string, to: string) {
  await inbox(page).getByRole('button', { name: from, exact: true }).click();
  await page.getByLabel('Title').fill(to);
  await page.getByLabel('Title').press('Enter');
}

test.afterEach(() => network.online());

test('a capture from the phone appears in the Inbox, and renaming it reaches the server', async ({ page }) => {
  const phone = await SimulatedDevice.signIn();
  await signIn(page);

  const captured = `call sam re boiler ${run}`;
  const { taskId } = await phone.capture(captured);
  await expect(inbox(page).getByRole('button', { name: captured })).toBeVisible();

  const renamed = `Call Sam about the boiler service ${run}`;
  await rename(page, captured, renamed);

  await expect(inbox(page).getByRole('button', { name: renamed })).toBeVisible();
  await expect.poll(async () => (await server.task(taskId))?.title).toBe(renamed);
  const task = await server.task(taskId);
  expect(task?.capture?.text).toBe(captured);
  const history = await server.history(taskId);
  expect(history.map((entry) => [entry.operation, entry.source])).toEqual([
    ['capture_text', 'android-simulated'],
    ['rename_task', 'web'],
  ]);
  await expect(status(page)).toContainText('All changes uploaded');
});

test('edits made offline survive a reload and converge with the phone on reconnection', async ({ page }) => {
  const phone = await SimulatedDevice.signIn();
  await signIn(page);
  const first = await phone.capture(`buy milk ${run}`);
  const second = await phone.capture(`book dentist ${run}`);
  await expect(inbox(page).getByRole('button', { name: `book dentist ${run}` })).toBeVisible();

  await network.offline();
  await expect(status(page)).toContainText('Offline');
  await rename(page, `buy milk ${run}`, `Buy oat milk ${run}`);
  await expect(status(page)).toContainText('1 change waiting to upload');

  // The tab is closed and reopened while still offline.
  await page.reload();
  await expect(inbox(page).getByRole('button', { name: `Buy oat milk ${run}` })).toBeVisible();
  await expect(status(page)).toContainText('1 change waiting to upload');

  // Meanwhile the phone, still online, rewords the other capture.
  await phone.rename(second.taskId, `Book dentist check-up ${run}`);
  expect((await server.task(first.taskId))?.title).toBe(`buy milk ${run}`);

  await network.online();
  await expect(status(page)).toContainText('All changes uploaded');
  await expect(inbox(page).getByRole('button', { name: `Book dentist check-up ${run}` })).toBeVisible();
  await expect.poll(async () => (await server.task(first.taskId))?.title).toBe(`Buy oat milk ${run}`);
  expect(await server.history(first.taskId)).toHaveLength(2);
});

test('a blank title is refused without changing anything', async ({ page }) => {
  const phone = await SimulatedDevice.signIn();
  await signIn(page);
  const { taskId } = await phone.capture(`water plants ${run}`);

  await inbox(page).getByRole('button', { name: `water plants ${run}` }).click();
  await page.getByLabel('Title').fill('   ');
  await page.getByLabel('Title').press('Enter');

  await expect(page.getByRole('alert')).toHaveText('A task needs a title.');
  await page.getByLabel('Title').press('Escape');
  await expect(inbox(page).getByRole('button', { name: `water plants ${run}` })).toBeVisible();
  expect(await server.history(taskId)).toHaveLength(1);
});
