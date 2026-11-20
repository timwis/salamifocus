import { expect, test, type Page } from '@playwright/test';
import { SimulatedDevice } from '../support/device.ts';
import { server } from '../support/server.ts';
import { run, signIn } from '../support/web.ts';

async function openProject(page: Page, projectId: string) {
  await signIn(page);
  await page.goto(`/projects/${projectId}`);
  await page.keyboard.press('2');
  await page.keyboard.press('Tab');
}

const flag = (page: Page, title: string) => page.getByRole('button', { name: `Flag ${title}` });

test('F flags and unflags the current task, which keeps its flag while deferred, and the flag can be clicked', async ({ page }) => {
  const phone = await SimulatedDevice.signIn();
  const report = `Annual accounts (${run})`;
  const { projectId } = await phone.createProject(report, { position: 'a7t' });
  const compile = `Compile the report ${run}`;
  const email = `Email Steve ${run}`;
  const { taskId } = await phone.createTask(projectId, compile, 'a0');
  const { taskId: child } = await phone.createTask(projectId, email, 'a0', taskId);
  await openProject(page, projectId);
  const row = page.getByRole('listitem').filter({ hasText: compile });
  await expect(flag(page, compile)).toHaveAttribute('aria-pressed', 'false');

  await page.keyboard.press('ArrowDown');
  await expect(row).toBeFocused();
  await page.keyboard.press('f');
  await expect(flag(page, compile)).toHaveAttribute('aria-pressed', 'true');
  await expect(row).toBeFocused();
  await expect.poll(async () => (await server.task(taskId))?.flagged).toBe(true);
  // Not inherited by the task beneath it.
  await expect(flag(page, email)).toHaveAttribute('aria-pressed', 'false');
  expect((await server.task(child))?.flagged).toBe(false);

  // Deferring it from another device leaves the flag where it is.
  await phone.defer(taskId, '2099-01-01T00:00:00.000Z');
  await expect(row).toHaveAttribute('data-unavailable', 'blocked deferred');
  await expect(flag(page, compile)).toHaveAttribute('aria-pressed', 'true');

  await page.keyboard.press('f');
  await expect(flag(page, compile)).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => (await server.task(taskId))?.flagged).toBe(false);

  await flag(page, email).click();
  await expect(flag(page, email)).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await server.task(child))?.flagged).toBe(true);
  const operations = (await server.history(taskId)).map((e) => e.operation).filter((name) => name.includes('flag'));
  expect(operations).toEqual(['flag_task', 'unflag_task']);
});

/** The titles Flagged shows from this test, in order. Other tests' flagged tasks share the list. */
async function flaggedTitles(page: Page, suffix: string): Promise<string[]> {
  return page
    .getByRole('list', { name: 'Flagged' })
    .locator('.task-title')
    .evaluateAll((titles, suffix) => titles.map((t) => t.textContent ?? '').filter((t) => t.endsWith(suffix)).map((t) => t.replace(` ${suffix}`, '')), suffix);
}

const choice = (page: Page, name: string) => page.getByRole('radiogroup', { name: 'Show' }).getByRole('radio', { name });

test('Flagged lists available flagged tasks with their project and tags; deferring or blocking one hides it until it is available again', async ({ page }) => {
  const suffix = `${run}-flagged`;
  const phone = await SimulatedDevice.signIn();
  const report = `Team offsite (${suffix})`;
  const { projectId } = await phone.createProject(report, { position: 'a7u' });
  const { tagId } = await phone.createTag(`Office (${suffix})`, { position: 'a7u' });
  const { taskId: book } = await phone.createTask(projectId, `Book the room ${suffix}`, 'a0');
  const { taskId: chase } = await phone.createTask(projectId, `Chase finance ${suffix}`, 'a1');
  const { taskId: print } = await phone.createTask(projectId, `Print handouts ${suffix}`, 'a2');
  await phone.createTask(projectId, `Unflagged ${suffix}`, 'a3');
  for (const id of [book, chase, print]) await phone.flag(id);
  await phone.tagTask(book, tagId);

  await signIn(page);
  await page.keyboard.press('4');
  await expect(page.getByRole('heading', { name: 'Flagged', level: 2 })).toBeVisible();
  await expect(choice(page, 'Available')).toBeChecked();
  await expect.poll(() => flaggedTitles(page, suffix)).toEqual(['Book the room', 'Chase finance', 'Print handouts']);
  const bookRow = page.getByRole('listitem').filter({ hasText: `Book the room ${suffix}` });
  await expect(bookRow).toContainText(report);
  await expect(bookRow).toContainText(`Office (${suffix})`);
  await expect(flag(page, `Book the room ${suffix}`)).toHaveAttribute('aria-pressed', 'true');

  // Deferring one in its editor keeps it shown until editing stops; then it leaves, still flagged.
  const chaseRow = page.getByRole('listitem').filter({ hasText: `Chase finance ${suffix}` });
  // Clicking the row's details, not its title, makes it current without opening its editor.
  await chaseRow.locator('.task-meta').click();
  await expect(chaseRow).toBeFocused();
  await page.keyboard.press('Enter');
  for (let i = 0; i < 3; i++) await page.keyboard.press('Tab');
  await expect(page.getByLabel('Defer until')).toBeFocused();
  await page.keyboard.type('1 week');
  await page.keyboard.press('Tab');
  await expect.poll(async () => (await server.task(chase))?.deferUntil).not.toBeNull();
  // The row shows its editor in place of its title.
  await expect(page.locator(`[data-key="flagged/${chase}"]`)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect.poll(() => flaggedTitles(page, suffix)).toEqual(['Book the room', 'Print handouts']);
  expect((await server.task(chase))?.flagged).toBe(true);

  // A new prerequisite blocks one; completing it brings the task back.
  const { taskId: draft } = await phone.createTask(projectId, `Draft the handout ${suffix}`, 'a0', print);
  await expect.poll(() => flaggedTitles(page, suffix)).toEqual(['Book the room']);
  await page.keyboard.press('v');
  await expect(choice(page, 'Remaining')).toBeChecked();
  await expect.poll(() => flaggedTitles(page, suffix)).toEqual(['Book the room', 'Chase finance', 'Print handouts']);
  await page.keyboard.press('Shift+V');
  await phone.complete(draft);
  await expect.poll(() => flaggedTitles(page, suffix)).toEqual(['Book the room', 'Print handouts']);

  // F on a row takes its flag away: it leaves, and the row now in its place becomes current.
  await bookRow.locator('.task-meta').click();
  await expect(bookRow).toBeFocused();
  await page.keyboard.press('f');
  await expect.poll(() => flaggedTitles(page, suffix)).toEqual(['Print handouts']);
  await expect.poll(async () => (await server.task(book))?.flagged).toBe(false);
  await expect(page.getByRole('listitem').filter({ hasText: `Print handouts ${suffix}` })).toBeFocused();

  // The server's Flagged agrees.
  const flaggedByServer = (await server.flagged()).map((t) => t.title).filter((t) => t.endsWith(suffix));
  expect(flaggedByServer).toEqual([`Print handouts ${suffix}`]);
});
