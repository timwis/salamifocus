import { expect, test, type Page } from '@playwright/test';
import { SimulatedDevice } from '../support/device.ts';
import { run, signIn, treeItem } from '../support/web.ts';

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
