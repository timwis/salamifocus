import { expect, test, type Page } from '@playwright/test';
import { SimulatedDevice } from '../support/device.ts';
import { server } from '../support/server.ts';
import { run, signIn } from '../support/web.ts';

// Which tasks Agendas shows, and in what order, is checked by fixtures/agendas.json in
// web-behaviour.spec.ts. These cover choosing the People tag and working through agendas by keyboard.

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

const rows = (page: Page, title: string) => page.locator('[data-region="outline"] li.task-row').filter({ hasText: `${title} ${run}` });

test('Agendas groups remaining tasks by the people beneath the People tag chosen in Settings', async ({ page }) => {
  const phone = await SimulatedDevice.signIn();
  // Tag and project names don't end in the run's suffix, so they stay out of other tests' sidebar checks.
  const { projectId: report } = await phone.createProject(`Board meeting (${run})`);
  const { tagId: people } = await phone.createTag(`Folks (${run})`, { position: 'a8' });
  const { tagId: steve } = await phone.createTag(`Stefan (${run})`, { parentId: people });
  const { tagId: family } = await phone.createTag(`Kin (${run})`, { parentId: people, position: 'a1' });
  const { tagId: mum } = await phone.createTag(`Mother (${run})`, { parentId: family });
  const { tagId: priya } = await phone.createTag(`Pria (${run})`, { parentId: people, position: 'a2' });
  const { tagId: computer } = await phone.createTag(`@Laptop (${run})`, { position: 'a9' });
  const tasks: Record<string, string> = {};
  for (const [name, tagIds] of [
    ['Email Stefan for the document', [steve, computer]],
    ['Agree the budget with Stefan and Pria', [steve, priya]],
    ['Ask Mother for packing boxes', [mum]],
    ['Back up the laptop', [computer]],
  ] as const) {
    tasks[name] = (await phone.createTask(report, `${name} ${run}`)).taskId;
    for (const tagId of tagIds) await phone.tagTask(tasks[name]!, tagId);
  }

  await signIn(page);
  await page.keyboard.press('7');
  await expect(page.getByRole('heading', { name: 'Agendas', level: 2 })).toBeVisible();
  // Another test may have chosen a People tag already.
  await phone.designatePeopleTag(null);
  await expect(page.getByText('No People tag chosen.')).toBeVisible();

  await page.keyboard.press(',');
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByLabel('People tag').selectOption({ label: `Folks (${run})` });
  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();
  await expect.poll(async () => (await server.settings()).peopleTagId).toBe(people);

  // Headings are the path below People; a task with two people is under each, and other tags stay on the row.
  const groups = [
    ['Stefan', 'Email Stefan for the document', 'Agree the budget with Stefan and Pria'],
    ['Kin : Mother', 'Ask Mother for packing boxes'],
    ['Pria', 'Agree the budget with Stefan and Pria'],
  ];
  await expect.poll(() => shownGroups(page)).toEqual(groups);
  await expect(page.getByText('3 tasks remaining')).toBeVisible();
  await expect(rows(page, 'Email Stefan for the document').locator('.tag-chip')).toHaveText([`Stefan (${run})`, `@Laptop (${run})`]);

  // Deferring a task from another device keeps it on the agenda, which starts at Remaining; Available leaves it out.
  await phone.defer(tasks['Email Stefan for the document']!, '2099-01-01T00:00:00.000Z');
  await expect(rows(page, 'Email Stefan for the document')).toHaveAttribute('data-unavailable', 'deferred');
  await expect.poll(() => shownGroups(page)).toEqual(groups);
  await page.keyboard.press('v');
  await expect(page).toHaveURL(/\/agendas\?show=everything$/);
  await page.keyboard.press('Shift+V');
  await page.keyboard.press('Shift+V');
  await expect(page).toHaveURL(/\/agendas\?show=available$/);
  await expect.poll(() => shownGroups(page)).toEqual([
    ['Stefan', 'Agree the budget with Stefan and Pria'],
    ['Kin : Mother', 'Ask Mother for packing boxes'],
    ['Pria', 'Agree the budget with Stefan and Pria'],
  ]);
  await page.keyboard.press('v');
  await expect(page).toHaveURL(/\/agendas$/);

  // Completing a task with two people takes it off both agendas.
  await rows(page, 'Agree the budget with Stefan and Pria').first().click();
  await page.keyboard.press(' ');
  await expect.poll(() => shownGroups(page)).toEqual([
    ['Stefan', 'Email Stefan for the document'],
    ['Kin : Mother', 'Ask Mother for packing boxes'],
  ]);
  await expect.poll(async () => (await server.task(tasks['Agree the budget with Stefan and Pria']!))?.completedAt).not.toBeNull();
});
