import { expect, test, type Page } from '@playwright/test';
import { SimulatedDevice } from '../support/device.ts';
import { server } from '../support/server.ts';
import { run, signIn } from '../support/web.ts';

// Which tasks Actionable shows, and in what order, is checked by fixtures/actionable.json in
// web-behaviour.spec.ts. These cover choosing the folders and working through the list by keyboard.

/** The outline's groups as shown: each heading, then its task titles, without this run's suffix. */
async function shownGroups(page: Page): Promise<string[][]> {
  return page.locator('[data-region="outline"] section').evaluateAll(
    (sections, suffix) =>
      sections.map((section) => [
        section.querySelector('h3 > span')?.textContent ?? '',
        ...[...section.querySelectorAll('.task-title')].map((title) => title.textContent ?? ''),
      ].map((text) => text.replaceAll(` (${suffix})`, '').replaceAll(` ${suffix}`, ''))),
    run,
  );
}

const row = (page: Page, title: string) => page.locator('[data-region="outline"] li.task-row').filter({ hasText: `${title} ${run}` });

test('the folder each Actionable perspective shows is chosen in Settings, and its available tasks are grouped by tag', async ({ page }) => {
  const phone = await SimulatedDevice.signIn();
  // Folder, project and tag names don't end in the run's suffix, so they stay out of other tests' sidebar checks.
  const { folderId: personal } = await phone.createFolder(`Personal (${run})`, { position: 'a8' });
  const { folderId: home } = await phone.createFolder(`Home (${run})`, { parentId: personal });
  const { folderId: work } = await phone.createFolder(`Work (${run})`, { position: 'a9' });
  const { projectId: misc } = await phone.createProject(`Miscellaneous (${run})`, { folderId: personal, kind: 'single_actions' });
  const { projectId: house } = await phone.createProject(`Fix up the house (${run})`, { folderId: home });
  const { projectId: launch } = await phone.createProject(`Launch the website (${run})`, { folderId: work });
  const { tagId: computer } = await phone.createTag(`@Workbench (${run})`, { position: 'a8' });
  const { tagId: low } = await phone.createTag(`Sluggish (${run})`, { parentId: computer });
  const { tagId: shopping } = await phone.createTag(`Errand list (${run})`, { parentId: computer, position: 'a1' });
  const tasks: Record<string, string> = {};
  for (const [name, projectId, tagIds] of [
    ['Check the privacy policy', house, [low]],
    ['Book a weightlifting class', misc, [low]],
    ['Buy a water pick', misc, [shopping]],
    ['Fix the fence', house, []],
    ['Choose curtains', house, [shopping]],
    ['Proofread the copy', launch, [low]],
  ] as const) {
    tasks[name] = (await phone.createTask(projectId, `${name} ${run}`)).taskId;
    for (const tagId of tagIds) await phone.tagTask(tasks[name]!, tagId);
  }
  await phone.defer(tasks['Choose curtains']!, '2099-01-01T00:00:00.000Z');

  await signIn(page);
  await page.keyboard.press('4');
  await expect(page.getByRole('heading', { name: 'Personal', level: 2 })).toBeVisible();

  // Choose the folders in Settings; Escape closes it and focus goes back where it was.
  const focused = await page.evaluate(() => document.activeElement?.getAttribute('data-key'));
  await page.keyboard.press(',');
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await expect(settings.getByLabel('Personal folder')).toBeFocused();
  await settings.getByLabel('Personal folder').selectOption({ label: `Personal (${run})` });
  await settings.getByLabel('Work folder').selectOption({ label: `Work (${run})` });
  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();
  expect(await page.evaluate(() => document.activeElement?.getAttribute('data-key'))).toBe(focused);
  await expect.poll(async () => (await server.settings()).folders).toEqual({ personal, work });

  const lowHeading = `@Workbench : Sluggish`;
  const shoppingHeading = `@Workbench : Errand list`;
  await expect.poll(() => shownGroups(page)).toEqual([
    [lowHeading, 'Check the privacy policy', 'Book a weightlifting class'],
    [shoppingHeading, 'Buy a water pick'],
    ['Untagged', 'Fix the fence'],
  ]);
  await expect(page.getByText('4 available tasks in Personal')).toBeVisible();
  await expect(row(page, 'Book a weightlifting class').locator('.task-project')).toHaveText(`Miscellaneous (${run})`);

  await page.keyboard.press('5');
  await expect(page.getByRole('heading', { name: 'Work', level: 2 })).toBeVisible();
  await expect.poll(() => shownGroups(page)).toEqual([[lowHeading, 'Proofread the copy']]);

  // Completing the last task in a group removes the group, and the next task becomes current.
  await page.keyboard.press('4');
  await row(page, 'Buy a water pick').click();
  await expect(row(page, 'Buy a water pick')).toBeFocused();
  await page.keyboard.press(' ');
  await expect.poll(() => shownGroups(page)).toEqual([
    [lowHeading, 'Check the privacy policy', 'Book a weightlifting class'],
    ['Untagged', 'Fix the fence'],
  ]);
  await expect(row(page, 'Fix the fence')).toBeFocused();

  // A task that stops being available leaves; one that becomes available joins its group by itself.
  await phone.defer(tasks['Check the privacy policy']!, '2099-01-01T00:00:00.000Z');
  await phone.defer(tasks['Choose curtains']!, null);
  await expect.poll(() => shownGroups(page)).toEqual([
    [lowHeading, 'Book a weightlifting class'],
    [shoppingHeading, 'Choose curtains'],
    ['Untagged', 'Fix the fence'],
  ]);
  await expect(row(page, 'Fix the fence')).toBeFocused();
});
