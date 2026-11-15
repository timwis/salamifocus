import { expect, test, type Page } from '@playwright/test';
import { SimulatedDevice } from '../support/device.ts';
import { server } from '../support/server.ts';
import { run, sidebar, signIn, treeItem } from '../support/web.ts';

/** A project's rows as shown, children indented beneath their parents, without this run's suffix. */
async function shownOutline(page: Page, project: string): Promise<string[]> {
  const rows = await page.getByRole('list', { name: project }).getByRole('listitem').all();
  return Promise.all(
    rows.map(async (row) => {
      const level = Number(await row.getAttribute('aria-level'));
      const title = (await row.locator('.task-title').textContent()) ?? '';
      return `${'  '.repeat(level - 1)}${title.replace(` ${run}`, '')}`;
    }),
  );
}

const choice = (page: Page, name: string) => page.getByRole('radiogroup', { name: 'Show' }).getByRole('radio', { name });

test('Projects shows remaining tasks until V or Shift+V chooses another visibility, which a reload keeps', async ({ page }) => {
  const phone = await SimulatedDevice.signIn();
  // Not ending in the run's suffix, so it stays out of other tests' sidebar checks.
  const shed = `Build the garden shed (${run})`;
  const { projectId } = await phone.createProject(shed, { position: 'a8' });
  await phone.createTask(projectId, `Draw up the plans ${run}`, 'a0');
  const { taskId: order } = await phone.createTask(projectId, `Order the timber ${run}`, 'a1');
  await phone.createTask(projectId, `Get a quote ${run}`, 'a0', order);
  const { taskId: paint } = await phone.createTask(projectId, `Paint the shed ${run}`, 'a2');
  await phone.defer(paint, '2099-01-01T00:00:00.000Z');

  await signIn(page);
  await page.goto(`/projects/${projectId}`);
  await expect(treeItem(page, shed)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('2');
  const remaining = ['Draw up the plans', 'Order the timber', '  Get a quote', 'Paint the shed'];
  await expect.poll(() => shownOutline(page, shed)).toEqual(remaining);
  await expect(choice(page, 'Remaining')).toBeChecked();

  // From the outline, Shift+V goes back to Available: the blocked and deferred tasks leave, and the
  // prerequisite stays where its parent was.
  await page.keyboard.press('Tab');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('listitem').filter({ hasText: `Draw up the plans ${run}` })).toBeFocused();
  await page.keyboard.press('Shift+V');
  await expect(choice(page, 'Available')).toBeChecked();
  await expect.poll(() => shownOutline(page, shed)).toEqual(['Draw up the plans', 'Get a quote']);
  await expect(page.getByRole('listitem').filter({ hasText: `Draw up the plans ${run}` })).toBeFocused();
  await expect(page).toHaveURL(/\?show=available$/);

  await page.reload();
  await expect(choice(page, 'Available')).toBeChecked();
  await expect.poll(() => shownOutline(page, shed)).toEqual(['Draw up the plans', 'Get a quote']);

  // Another perspective has its own visibility, and coming back keeps this one.
  await page.keyboard.press('3');
  await expect(choice(page, 'Remaining')).toBeChecked();
  await page.keyboard.press('2');
  await expect(choice(page, 'Available')).toBeChecked();

  // From the sidebar too, V moves on to Remaining.
  await expect(treeItem(page, shed)).toBeFocused();
  await page.keyboard.press('v');
  await expect(choice(page, 'Remaining')).toBeChecked();
  await expect.poll(() => shownOutline(page, shed)).toEqual(remaining);
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`));
});

test('Everything shows completed tasks with when they were completed, and Space marks one unfinished again', async ({ page }) => {
  const phone = await SimulatedDevice.signIn();
  const garage = `Tidy the garage (${run})`;
  const { projectId } = await phone.createProject(garage, { position: 'a8' });
  const { taskId: sweep } = await phone.createTask(projectId, `Sweep the floor ${run}`, 'a0');
  await phone.createTask(projectId, `Fix the door ${run}`, 'a1');
  await phone.complete(sweep);

  await signIn(page);
  await page.goto(`/projects/${projectId}`);
  await expect(treeItem(page, garage)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('2');
  await expect.poll(() => shownOutline(page, garage)).toEqual(['Fix the door']);

  await page.keyboard.press('v');
  await expect(choice(page, 'Everything')).toBeChecked();
  await expect.poll(() => shownOutline(page, garage)).toEqual(['Sweep the floor', 'Fix the door']);
  const swept = page.getByRole('listitem').filter({ hasText: `Sweep the floor ${run}` });
  await expect(swept).toHaveAttribute('data-unavailable', 'completed');
  await expect(swept).toContainText(/Completed \w{3} \d{1,2} \w{3}( \d{4})? \d\d:\d\d/);

  // Space reopens a completed task, which stays in place, and completes an unfinished one, which stays too.
  await page.keyboard.press('Tab');
  await page.keyboard.press('ArrowDown');
  await expect(swept).toBeFocused();
  await page.keyboard.press(' ');
  await expect(swept).not.toHaveAttribute('data-unavailable');
  await expect.poll(async () => (await server.task(sweep))?.completedAt).toBeNull();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press(' ');
  const door = page.getByRole('listitem').filter({ hasText: `Fix the door ${run}` });
  await expect(door).toHaveAttribute('data-unavailable', 'completed');
  await expect(door).toBeFocused();
  await expect(page.getByRole('button', { name: `Mark Fix the door ${run} unfinished` })).toBeVisible();

  // V wraps round to Available, where the reopened task is back and the completed one has gone.
  await page.keyboard.press('v');
  await expect(choice(page, 'Available')).toBeChecked();
  await expect.poll(() => shownOutline(page, garage)).toEqual(['Sweep the floor']);
});

test('P pauses a project from the sidebar: it stays selectable and marked, and its tasks leave Available until it is resumed', async ({ page }) => {
  const phone = await SimulatedDevice.signIn();
  const move = `Move house (${run})`;
  const { projectId } = await phone.createProject(move, { position: 'a8' });
  const { taskId } = await phone.createTask(projectId, `Order boxes ${run}`, 'a0');
  const { tagId } = await phone.createTag(`Errands (${run})`, { position: 'a8' });
  await phone.tagTask(taskId, tagId);
  const item = sidebar(page).locator(`[data-key="${projectId}"]`);
  const boxes = page.getByRole('listitem').filter({ hasText: `Order boxes ${run}` });
  const status = async () => (await server.projects([projectId]))[0]?.project.status;

  await signIn(page);
  await page.goto(`/projects/${projectId}?show=available`);
  await expect(item).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('2');
  await expect(item).toBeFocused();
  await expect.poll(() => shownOutline(page, move)).toEqual(['Order boxes']);

  await page.keyboard.press('p');
  await expect(item).toHaveAttribute('data-badge', 'Paused');
  await expect(item).toContainText('Paused');
  await expect(item).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: move })).toContainText('Paused');
  await expect.poll(() => shownOutline(page, move)).toEqual([]);
  await expect.poll(status).toBe('paused');

  // Remaining still shows its tasks, marked as unavailable because the project is paused.
  await page.keyboard.press('v');
  await expect.poll(() => shownOutline(page, move)).toEqual(['Order boxes']);
  await expect(boxes).toHaveAttribute('data-unavailable', 'paused');

  // Elsewhere, its tasks say why.
  await page.goto(`/tags/${tagId}`);
  await expect(boxes).toContainText('Project paused');

  // The sidebar button resumes it, as P would.
  await page.goto(`/projects/${projectId}?show=available`);
  await page.keyboard.press('2');
  await expect(item).toBeFocused();
  await page.getByRole('button', { name: `Resume ${move}` }).click();
  await expect(item).not.toHaveAttribute('data-badge');
  await expect.poll(() => shownOutline(page, move)).toEqual(['Order boxes']);
  await expect(page.getByRole('button', { name: `Pause ${move}` })).toBeVisible();
  await expect.poll(status).toBe('active');
});
