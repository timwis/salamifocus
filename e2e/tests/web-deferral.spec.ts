import { expect, test, type Page } from '@playwright/test';
import { SimulatedDevice } from '../support/device.ts';
import { network } from '../support/network.ts';
import { server } from '../support/server.ts';
import { run, signIn } from '../support/web.ts';

// Dates are typed and shown in the user's own time zone; London is UTC in November.
test.use({ timezoneId: 'Europe/London' });
test.afterEach(() => network.online());

const monday = new Date('2026-11-16T09:00:00.000Z');

async function openProject(page: Page, projectId: string) {
  await signIn(page);
  await page.goto(`/projects/${projectId}`);
  await page.keyboard.press('2');
  await page.keyboard.press('Tab');
}

/** Moves the page's clock on to a time, firing the timers due on the way. */
async function advanceTo(page: Page, time: string) {
  await page.clock.fastForward(Date.parse(time) - (await page.evaluate(() => Date.now())));
}

/** Opens the current row's editor and tabs from the title, past project and tags, to Defer until. */
async function tabToDefer(page: Page) {
  await page.keyboard.press('Enter');
  for (let i = 0; i < 3; i++) await page.keyboard.press('Tab');
  await expect(page.getByLabel('Defer until')).toBeFocused();
}

test('a prerequisite deferred by a week keeps blocking its parent, and comes back with the app left open', async ({ page }) => {
  await page.clock.install({ time: monday });
  const phone = await SimulatedDevice.signIn();
  const report = `Board report (${run})`;
  const { projectId } = await phone.createProject(report, { position: 'a7' });
  const { taskId: compile } = await phone.createTask(projectId, `Compile the report ${run}`, 'a0');
  const { taskId: email } = await phone.createTask(projectId, `Email Steve to request the document ${run}`, 'a0', compile);
  await openProject(page, projectId);
  const rows = page.getByRole('list', { name: report }).getByRole('listitem');
  const parent = rows.filter({ hasText: `Compile the report ${run}` });
  const child = rows.filter({ hasText: `Email Steve to request the document ${run}` });
  await expect(child).toHaveAttribute('aria-level', '2');

  // The email is sent but the document has not arrived: defer the task to the chase date.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(child).toBeFocused();
  await tabToDefer(page);
  await page.keyboard.type('1 week');
  // The resolved date shows before it is committed.
  await expect(page.getByLabel('Defer until')).toHaveAccessibleDescription('Mon 23 Nov 2026');
  await page.keyboard.press('Enter');

  await expect(child).toContainText('Deferred until Mon 23 Nov');
  await expect(child).toHaveAttribute('data-unavailable', 'deferred');
  await expect(parent).toHaveAttribute('data-unavailable', 'blocked');
  await expect(child).toBeFocused();
  await expect.poll(async () => (await server.task(email))?.deferUntil).toBe('2026-11-23T00:00:00.000Z');
  expect((await server.task(email))?.completedAt).toBeNull();

  // The clock reaches the defer date with the app still open, and nothing syncs.
  await advanceTo(page, '2026-11-22T23:59:00.000Z');
  await expect(child).toHaveAttribute('data-unavailable', 'deferred');
  await network.offline();
  await page.clock.fastForward('01:00');
  await expect(child).not.toHaveAttribute('data-unavailable');
  await expect(child).toContainText('Deferred until Mon 23 Nov');
  await expect(parent).toHaveAttribute('data-unavailable', 'blocked');
  await network.online();

  // The document arrives: completing the child makes the parent available, still unfinished.
  await page.keyboard.press('Space');
  await expect(rows).toHaveCount(1);
  await expect(parent).not.toHaveAttribute('data-unavailable');
  await expect.poll(async () => (await server.task(compile))?.unavailable).toEqual([]);
});

test('a deferred task becomes available when the app is reopened offline after its date', async ({ page }) => {
  await page.clock.install({ time: monday });
  const phone = await SimulatedDevice.signIn();
  const garden = `Garden (${run})`;
  const { projectId } = await phone.createProject(garden, { position: 'a7V' });
  const { taskId } = await phone.createTask(projectId, `Plant the bulbs ${run}`, 'a0');
  await phone.defer(taskId, '2026-11-20T00:00:00.000Z');
  await openProject(page, projectId);
  const row = page.getByRole('list', { name: garden }).getByRole('listitem');
  await expect(row).toHaveAttribute('data-unavailable', 'deferred');
  await expect(row).toContainText('Deferred until Fri 20 Nov');

  await network.offline();
  await page.clock.setSystemTime(new Date('2026-11-20T08:00:00.000Z'));
  await page.reload();
  await expect(row).toContainText(`Plant the bulbs ${run}`);
  await expect(row).not.toHaveAttribute('data-unavailable');
});

test('a defer date that is not a date is refused in place, and an emptied one is cleared', async ({ page }) => {
  await page.clock.install({ time: monday });
  const phone = await SimulatedDevice.signIn();
  const paperwork = `Paperwork (${run})`;
  const { projectId } = await phone.createProject(paperwork, { position: 'a7k' });
  const { taskId } = await phone.createTask(projectId, `Chase the insurer ${run}`, 'a0');
  await phone.defer(taskId, '2026-12-01T00:00:00.000Z');
  await openProject(page, projectId);
  const row = page.getByRole('list', { name: paperwork }).getByRole('listitem');
  await expect(row).toContainText('Deferred until Tue 1 Dec');

  await page.keyboard.press('ArrowDown');
  await tabToDefer(page);
  const field = page.getByLabel('Defer until');
  await expect(field).toHaveValue('Tue 1 Dec 2026');
  await field.fill('whenever');
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expect(field).toHaveAccessibleDescription('Not a date');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(field).toBeFocused();

  // Escape abandons the change and keeps the date.
  await page.keyboard.press('Escape');
  await expect(row).toContainText('Deferred until Tue 1 Dec');

  // Short forms work, and leaving the field shows the date in full.
  await tabToDefer(page);
  await field.fill('3d');
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Note')).toBeFocused();
  await expect(field).toHaveValue('Thu 19 Nov 2026');
  await page.keyboard.press('Shift+Tab');
  await field.fill('');
  await expect(field).toHaveAccessibleDescription('No date');
  await page.keyboard.press('Enter');
  await expect(row).not.toContainText('Deferred');
  await expect(row).not.toHaveAttribute('data-unavailable');
  await expect.poll(async () => (await server.task(taskId))?.deferUntil).toBeNull();
  const changes = (await server.history(taskId)).filter((e) => e.operation === 'defer_task').map((e) => e.changes[0]?.after);
  expect(changes).toEqual([{ defer_until: '2026-12-01T00:00:00.000Z' }, { defer_until: '2026-11-19T00:00:00.000Z' }, { defer_until: null }]);
});
