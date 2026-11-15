import { expect, test, type Page } from '@playwright/test';
import { SimulatedDevice } from '../support/device.ts';
import { server } from '../support/server.ts';
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

async function serverOutline(projectId: string): Promise<string[]> {
  const [outline] = await server.projects([projectId]);
  return (outline?.tasks ?? []).map((t) => `${'  '.repeat(t.depth - 1)}${t.title.replace(` ${run}`, '')}`);
}

test('tasks are indented beneath others as prerequisites and outdented again, taking their children with them', async ({ page }) => {
  const phone = await SimulatedDevice.signIn();
  // Not ending in the run's suffix, so it stays out of other tests' sidebar checks.
  const report = `Quarterly report (${run})`;
  const { projectId } = await phone.createProject(report, { position: 'a8' });
  for (const [title, position] of [['Compile the report', 'a0'], ['Email Steve to request the document', 'a1'], ['Find Steve’s address', 'a2'], ['Draft the summary', 'a3']]) {
    await phone.createTask(projectId, `${title} ${run}`, position);
  }
  await signIn(page);
  await page.goto(`/projects/${projectId}`);
  await expect(treeItem(page, report)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('2');
  await page.keyboard.press('Tab');
  await expect.poll(() => shownOutline(page, report)).toHaveLength(4);

  // Heading, then the second task: indent it beneath the first.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Alt+ArrowRight');
  await expect
    .poll(() => shownOutline(page, report))
    .toEqual(['Compile the report', '  Email Steve to request the document', 'Find Steve’s address', 'Draft the summary']);

  // Indenting the next one makes it a sibling of the first child, then a child of that child.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Alt+ArrowRight');
  await expect
    .poll(() => shownOutline(page, report))
    .toEqual(['Compile the report', '  Email Steve to request the document', '  Find Steve’s address', 'Draft the summary']);
  await page.keyboard.press('Alt+ArrowRight');
  await expect
    .poll(() => shownOutline(page, report))
    .toEqual(['Compile the report', '  Email Steve to request the document', '    Find Steve’s address', 'Draft the summary']);
  await expect(page.getByRole('listitem').filter({ hasText: `Find Steve’s address ${run}` })).toBeFocused();

  // Outdenting and reordering a parent move its children with it.
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Alt+ArrowLeft');
  await expect
    .poll(() => shownOutline(page, report))
    .toEqual(['Compile the report', 'Email Steve to request the document', '  Find Steve’s address', 'Draft the summary']);
  await page.keyboard.press('Alt+ArrowUp');
  await expect
    .poll(() => shownOutline(page, report))
    .toEqual(['Email Steve to request the document', '  Find Steve’s address', 'Compile the report', 'Draft the summary']);

  // A new task goes beneath the same parent as the current row.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('n');
  await page.keyboard.type(`Look up Steve’s phone number ${run}`);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  const expected = ['Email Steve to request the document', '  Find Steve’s address', '  Look up Steve’s phone number', 'Compile the report', 'Draft the summary'];
  await expect.poll(() => shownOutline(page, report)).toEqual(expected);
  await expect.poll(() => serverOutline(projectId)).toEqual(expected);

  // Indenting the first task, or outdenting a top-level one, does nothing.
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Alt+ArrowRight');
  await page.keyboard.press('Alt+ArrowLeft');
  await page.reload();
  await expect.poll(() => shownOutline(page, report)).toEqual(expected);
});

test('a parent shows as blocked until its last prerequisite is completed, and then still needs completing', async ({ page }) => {
  const phone = await SimulatedDevice.signIn();
  const report = `Report due (${run})`;
  const { projectId } = await phone.createProject(report, { position: 'a9' });
  const { taskId: compile } = await phone.createTask(projectId, `Compile the report ${run}`, 'a0');
  await phone.createTask(projectId, `Email Steve to request the document ${run}`, 'a0', compile);
  await signIn(page);
  await page.goto(`/projects/${projectId}`);
  await page.keyboard.press('2');
  await page.keyboard.press('Tab');
  const rows = page.getByRole('list', { name: report }).getByRole('listitem');
  const parent = rows.filter({ hasText: `Compile the report ${run}` });
  const child = rows.filter({ hasText: `Email Steve to request the document ${run}` });
  await expect(parent).toContainText('Blocked');
  await expect(child).not.toContainText('Blocked');

  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(child).toBeFocused();
  await page.keyboard.press('Space');
  await expect(rows).toHaveCount(1);
  await expect(parent).not.toContainText('Blocked');
  await expect(parent).toBeFocused();
  await expect.poll(async () => (await server.task(compile))?.unavailable).toEqual([]);
  expect((await server.task(compile))?.completedAt).toBeNull();
});

test('moving a task to another project takes its prerequisites with it', async ({ page }) => {
  const phone = await SimulatedDevice.signIn();
  const office = `Office move (${run})`;
  const home = `Home office (${run})`;
  const { projectId: from } = await phone.createProject(office, { position: 'a8V' });
  const { projectId: to } = await phone.createProject(home, { position: 'a9V' });
  const { taskId: desk } = await phone.createTask(from, `Set up the desk ${run}`, 'a0');
  const { taskId: chair } = await phone.createTask(from, `Order a chair ${run}`, 'a0', desk);
  await phone.createTask(from, `Measure the room ${run}`, 'a0', chair);
  await phone.createTask(from, `Book the van ${run}`, 'a1');
  await signIn(page);
  await page.goto(`/projects/${from},${to}`);
  await page.keyboard.press('2');
  await page.keyboard.press('Tab');
  await expect.poll(() => shownOutline(page, office)).toEqual(['Set up the desk', '  Order a chair', '    Measure the room', 'Book the van']);

  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('p');
  await page.keyboard.type(home);
  await expect(page.getByRole('listbox', { name: 'Matching projects' }).getByRole('option').first()).toHaveText(home);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');

  const moved = ['Set up the desk', '  Order a chair', '    Measure the room'];
  await expect.poll(() => shownOutline(page, office)).toEqual(['Book the van']);
  await expect.poll(() => shownOutline(page, home)).toEqual(moved);
  await expect.poll(() => serverOutline(to)).toEqual(moved);
  expect(await serverOutline(from)).toEqual(['Book the van']);
});
