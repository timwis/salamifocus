import { expect, test, type Page } from '@playwright/test';
import { SimulatedDevice } from '../support/device.ts';
import { server } from '../support/server.ts';
import { run, signIn } from '../support/web.ts';

// Days are the device's; London is UTC in November.
test.use({ timezoneId: 'Europe/London' });

const monday = new Date('2026-11-16T09:00:00.000Z');

/** The rows under one of Forecast's headings, such as "Today: Due". */
const under = (page: Page, heading: string) => page.getByRole('list', { name: heading, exact: true }).getByRole('listitem');

async function openForecast(page: Page) {
  await signIn(page);
  await page.keyboard.press('7');
  await expect(page.getByRole('heading', { name: 'Forecast', level: 2 })).toBeVisible();
}

test('Forecast splits each day into Due and Deferred, shows the placing date as a time, and highlights what is overdue', async ({ page }) => {
  await page.clock.install({ time: monday });
  const phone = await SimulatedDevice.signIn();
  const { projectId } = await phone.createProject(`Board pack (${run})`, { position: 'a7f' });
  const { taskId: invoice } = await phone.createTask(projectId, `Send the invoice ${run}`, 'a0');
  await phone.setDue(invoice, '2026-11-13T17:00:00.000Z');
  const { taskId: room } = await phone.createTask(projectId, `Book the meeting room ${run}`, 'a1');
  await phone.setDue(room, '2026-11-16T17:00:00.000Z');
  const { taskId: speech } = await phone.createTask(projectId, `Draft the speech ${run}`, 'a2');
  await phone.defer(speech, '2026-11-18T09:30:00.000Z');
  await phone.setDue(speech, '2026-12-04T17:00:00.000Z');
  await openForecast(page);

  const overdue = under(page, 'Past: Due').filter({ hasText: `Send the invoice ${run}` });
  await expect(overdue.getByText('Due Fri 13 Nov')).toHaveClass(/overdue/);
  await expect(overdue).toContainText(`Board pack (${run})`);
  const dueToday = under(page, 'Today: Due').filter({ hasText: `Book the meeting room ${run}` });
  await expect(dueToday.getByText('Due 17:00')).not.toHaveClass(/overdue/);

  // A deferral and a deadline on different days: once under each, muted while still deferred.
  const deferred = under(page, 'Wed 18 Nov: Deferred').filter({ hasText: `Draft the speech ${run}` });
  await expect(deferred).toContainText('Deferred until 09:30');
  await expect(deferred).toContainText('Due Fri 4 Dec');
  await expect(deferred).toHaveAttribute('data-unavailable', 'deferred');
  await expect(under(page, 'Future: Due').filter({ hasText: `Draft the speech ${run}` })).toContainText('Deferred until Wed 18 Nov 09:30');

  // Left open past 17:00, today's deadline is overdue too; at midnight it moves to Past and Tomorrow becomes Today.
  await page.clock.fastForward('08:01:00');
  await expect(dueToday.getByText('Due 17:00')).toHaveClass(/overdue/);
  await page.clock.fastForward('07:00:00');
  await expect(under(page, 'Past: Due').filter({ hasText: `Book the meeting room ${run}` })).toContainText('Due Mon 16 Nov');
  await expect(page.getByRole('heading', { name: 'Tomorrow', level: 3 })).toBeVisible();
  await expect(under(page, 'Tomorrow: Deferred').filter({ hasText: `Draft the speech ${run}` })).toContainText('Deferred until 09:30');
});

test('From Forecast the keyboard flags, reschedules, re-projects, retags and completes a task, which moves to its new day', async ({ page }) => {
  await page.clock.install({ time: monday });
  const phone = await SimulatedDevice.signIn();
  const { projectId } = await phone.createProject(`Office move (${run})`, { position: 'a7g' });
  const admin = `Admin (${run})`;
  const { projectId: adminId } = await phone.createProject(admin, { position: 'a7h' });
  const { tagId } = await phone.createTag(`Errands (${run})`, { position: 'a7g' });
  const { taskId } = await phone.createTask(projectId, `Book the van ${run}`, 'a0');
  await phone.setDue(taskId, '2026-11-16T17:00:00.000Z');
  await openForecast(page);

  const today = under(page, 'Today: Due').filter({ hasText: `Book the van ${run}` });
  await today.locator('.task-meta').click();
  await expect(today).toBeFocused();

  await page.keyboard.press('f');
  await expect(today.getByRole('button', { name: `Flag Book the van ${run}` })).toHaveAttribute('aria-pressed', 'true');

  // While it is being edited the task keeps its place; it moves once editing stops, and focus goes with it.
  await page.keyboard.press('Enter');
  for (let i = 0; i < 4; i++) await page.keyboard.press('Tab');
  await expect(page.getByLabel('Due', { exact: true })).toBeFocused();
  await page.getByLabel('Due', { exact: true }).fill('thu');
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Note')).toBeFocused();
  await expect(page.getByRole('list', { name: 'Today: Due', exact: true }).locator(`[data-key$="/${taskId}"]`)).toHaveCount(1);
  await page.keyboard.press('Escape');
  const thursday = under(page, 'Thu 19 Nov: Due').filter({ hasText: `Book the van ${run}` });
  await expect(thursday).toBeFocused();
  await expect(thursday).toContainText('Due 17:00');
  await expect(page.getByRole('list', { name: 'Today: Due', exact: true }).filter({ hasText: `Book the van ${run}` })).toHaveCount(0);

  await page.keyboard.press('p');
  await page.keyboard.type(admin);
  await expect(page.getByRole('listbox', { name: 'Matching projects' }).getByRole('option').first()).toHaveText(admin);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect(thursday).toContainText(admin);

  await page.keyboard.press('t');
  await page.keyboard.type(`errands (${run})`);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect(thursday.locator('.tag-chip')).toHaveText([`Errands (${run})`]);
  await expect(thursday).toBeFocused();

  await page.keyboard.press('Space');
  await expect(page.getByText(`Book the van ${run}`)).toHaveCount(0);
  await expect
    .poll(() => server.task(taskId))
    .toMatchObject({ dueAt: '2026-11-19T17:00:00.000Z', projectId: adminId, flagged: true, tags: [{ id: tagId }], completedAt: expect.any(String) });
});

test('a task being edited at midnight keeps its place until editing stops, then moves on with the day', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-16T23:59:00.000Z') });
  const phone = await SimulatedDevice.signIn();
  const { projectId } = await phone.createProject(`Late shift (${run})`, { position: 'a7i' });
  const { taskId } = await phone.createTask(projectId, `Lock the office ${run}`, 'a0');
  await phone.setDue(taskId, '2026-11-16T17:00:00.000Z');
  await openForecast(page);

  const today = under(page, 'Today: Due').filter({ hasText: `Lock the office ${run}` });
  await today.locator('.task-meta').click();
  await page.keyboard.press('Enter');
  for (let i = 0; i < 5; i++) await page.keyboard.press('Tab');
  await expect(page.getByLabel('Note')).toBeFocused();
  await page.keyboard.type('Check the back door');

  await page.clock.fastForward('01:30');
  await expect(page.getByLabel('Note')).toBeFocused();
  await expect(page.getByLabel('Note')).toHaveValue('Check the back door');
  await expect(page.getByRole('list', { name: 'Today: Due', exact: true }).locator(`[data-key$="/${taskId}"]`)).toHaveCount(1);

  await page.keyboard.press('ControlOrMeta+Enter');
  const past = under(page, 'Past: Due').filter({ hasText: `Lock the office ${run}` });
  await expect(past).toBeFocused();
  await expect(past).toContainText('Due Mon 16 Nov');
  await expect.poll(async () => (await server.task(taskId))?.note).toBe('Check the back door');
});
