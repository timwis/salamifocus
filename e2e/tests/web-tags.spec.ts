import { expect, test } from '@playwright/test';
import type { TagNode } from '@salamifocus/domain';
import { SimulatedDevice } from '../support/device.ts';
import { network } from '../support/network.ts';
import { server } from '../support/server.ts';
import { run, sidebarOutline, signIn, tagItem, tagSidebar } from '../support/web.ts';

test.afterEach(() => network.online());

function findByName(nodes: TagNode[], name: string): TagNode | undefined {
  for (const node of nodes) {
    if (node.name === name) return node;
    const found = findByName(node.children, name);
    if (found) return found;
  }
  return undefined;
}

test('tags are created, nested, reordered and renamed from the keyboard', async ({ page }) => {
  const phone = await SimulatedDevice.signIn();
  const anchor = `Anchor tag ${run}`;
  const { tagId } = await phone.createTag(anchor);
  await signIn(page);
  await page.goto(`/tags/${tagId}`);
  await page.keyboard.press('3');
  await expect(tagItem(page, anchor)).toBeFocused();
  const outline = () => sidebarOutline(page, tagSidebar(page));

  // N adds a tag after the current one.
  for (const name of ['@Computer', 'Shallow work', 'Low energy']) {
    await page.keyboard.press('n');
    await expect(page.getByLabel('New tag name')).toBeFocused();
    await page.keyboard.type(`${name} ${run}`);
    await page.keyboard.press('Enter');
    await expect(tagItem(page, `${name} ${run}`)).toBeFocused();
  }
  expect(await outline()).toEqual(['Anchor tag', '@Computer', 'Shallow work', 'Low energy']);

  // Alt+→ nests a tag under the one above it; Alt+↑ reorders among siblings.
  await page.keyboard.press('Alt+ArrowRight');
  await expect.poll(outline).toEqual(['Anchor tag', '@Computer', 'Shallow work', '  Low energy']);
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Alt+ArrowRight');
  await expect.poll(outline).toEqual(['Anchor tag', '@Computer', '  Shallow work', '    Low energy']);
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Alt+ArrowUp');
  await expect.poll(outline).toEqual(['@Computer', '  Shallow work', '    Low energy', 'Anchor tag']);

  // A new tag after an expanded one goes after its descendants, as its sibling.
  await page.keyboard.press('n');
  await page.keyboard.type(`@Phone ${run}`);
  await page.keyboard.press('Enter');
  await expect.poll(outline).toEqual(['@Computer', '  Shallow work', '    Low energy', '@Phone', 'Anchor tag']);

  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await page.getByLabel('Name', { exact: true }).fill(`Shallow ${run}`);
  await page.keyboard.press('Enter');
  await expect(tagItem(page, `Shallow ${run}`)).toBeFocused();

  // Only one tag is selected at a time.
  await page.keyboard.press('Shift+ArrowUp');
  await expect(tagSidebar(page).getByRole('treeitem', { selected: true })).toHaveText([`@Computer ${run}`]);

  await expect
    .poll(async () => {
      const computer = findByName(await server.tags(), `@Computer ${run}`);
      return computer && computer.children.map((c) => [c.name, c.children.map((g) => g.name)]);
    })
    .toEqual([[`Shallow ${run}`, [`Low energy ${run}`]]]);
});

test('tags are added to a task from its row with type-ahead, shown on the row, and removed', async ({ page }) => {
  const phone = await SimulatedDevice.signIn();
  const { tagId: people } = await phone.createTag(`People ${run}`, { position: 'a1' });
  await phone.createTag(`Dad ${run}`, { parentId: people });
  const { tagId: computer } = await phone.createTag(`@Laptop ${run}`, { position: 'a2' });
  const { tagId: shallow } = await phone.createTag(`Quick wins ${run}`, { parentId: computer });
  await phone.createTag(`Low battery ${run}`, { parentId: shallow });
  const { tagId: phoneTag } = await phone.createTag(`@Mobile ${run}`, { position: 'a3' });
  const { projectId } = await phone.createProject(`Parents ${run}`, { position: 'a7' });
  const { taskId } = await phone.createTask(projectId, `Ask Dad about AAA checkup ${run}`);
  await phone.tagTask(taskId, phoneTag);
  await signIn(page);
  await page.goto(`/projects/${projectId}`);
  const row = page.getByRole('list', { name: `Parents ${run}` }).getByRole('listitem');
  await expect(row).toContainText(`@Mobile ${run}`);

  await page.keyboard.press('2');
  await page.keyboard.press('Tab');
  await page.keyboard.press('ArrowDown');
  await expect(row).toBeFocused();

  // T opens the tags field; typing narrows the choices to matching tags, shown with their paths.
  await page.keyboard.press('t');
  await expect(page.getByRole('combobox', { name: 'Tags' })).toBeFocused();
  await page.keyboard.type('low ba');
  await expect(page.getByRole('option')).toHaveText([`@Laptop ${run} : Quick wins ${run} : Low battery ${run}`]);
  await page.keyboard.press('Enter');
  await page.keyboard.type(`dad ${run}`);
  await expect(page.getByRole('option', { selected: true })).toHaveText(`People ${run} : Dad ${run}`);
  await page.keyboard.press('Enter');
  // Backspace in the empty field takes off the last tag; Enter then saves and closes.
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Enter');
  await expect(row).toBeFocused();
  await expect(row.locator('.tag-chip')).toHaveText([`Dad ${run}`, `Low battery ${run}`]);

  // Escape abandons tag changes; Tab keeps them.
  await page.keyboard.press('t');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Escape');
  await expect(row).toBeFocused();
  await expect(row.locator('.tag-chip')).toHaveText([`Dad ${run}`, `Low battery ${run}`]);
  await page.keyboard.press('t');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Note')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(row.locator('.tag-chip')).toHaveText([`Dad ${run}`]);

  await expect.poll(async () => (await server.task(taskId))?.tags.map((t) => t.path.join(' : '))).toEqual([`People ${run} : Dad ${run}`]);
  const operations = (await server.history(taskId)).map((entry) => entry.operation);
  expect(operations.filter((op) => op.endsWith('tag_task'))).toEqual(['tag_task', 'tag_task', 'tag_task', 'untag_task', 'untag_task']);
});

test('selecting a tag shows its branch’s remaining tasks under full-path headings, once per matching tag', async ({ page }) => {
  const phone = await SimulatedDevice.signIn();
  const { tagId: people } = await phone.createTag(`Family ${run}`, { position: 'a4' });
  const { tagId: mum } = await phone.createTag(`Mum ${run}`, { parentId: people });
  const { tagId: desk } = await phone.createTag(`@Desk ${run}`, { position: 'a5' });
  const { tagId: light } = await phone.createTag(`Light work ${run}`, { parentId: desk });
  const { tagId: tired } = await phone.createTag(`Tired ${run}`, { parentId: light, position: 'a0' });
  const { tagId: buying } = await phone.createTag(`Buying ${run}`, { parentId: light, position: 'a1' });
  const { projectId } = await phone.createProject(`Odds and ends ${run}`, { position: 'a8', kind: 'single_actions' });
  const add = async (title: string, tagIds: string[]) => {
    const { taskId } = await phone.createTask(projectId, `${title} ${run}`);
    for (const tagId of tagIds) await phone.tagTask(taskId, tagId);
    return taskId;
  };
  await add('Order a water pick', [buying]);
  const both = await add('Clear the downloads folder', [light, tired]);
  await add('Ask Mum about Sunday', [mum, tired]);
  await signIn(page);
  await page.goto(`/tags/${light}`);
  const main = page.getByRole('main');
  const group = (path: string) => main.getByRole('list', { name: path, exact: true }).getByRole('listitem');

  await expect(main.getByRole('heading', { level: 3 })).toHaveText([
    `@Desk ${run} : Light work ${run}`,
    `@Desk ${run} : Light work ${run} : Tired ${run}`,
    `@Desk ${run} : Light work ${run} : Buying ${run}`,
  ]);
  const tiredGroup = group(`@Desk ${run} : Light work ${run} : Tired ${run}`);
  await expect(tiredGroup.locator('.task-title')).toHaveText([`Clear the downloads folder ${run}`, `Ask Mum about Sunday ${run}`]);
  // The row shows the task's project and all its tags, including ones outside the branch.
  await expect(tiredGroup.nth(1)).toContainText(`Odds and ends ${run}`);
  await expect(tiredGroup.nth(1).locator('.tag-chip')).toHaveText([`Mum ${run}`, `Tired ${run}`]);
  await expect(main).toContainText('3 tasks remaining');

  // Completing a task that appears twice removes both appearances, and focus stays in the outline.
  await page.keyboard.press('3');
  await page.keyboard.press('Tab');
  await page.keyboard.press('ArrowDown');
  await expect(group(`@Desk ${run} : Light work ${run}`).first()).toBeFocused();
  await page.keyboard.press('Space');
  await expect(main.getByRole('heading', { level: 3 })).toHaveText([
    `@Desk ${run} : Light work ${run} : Tired ${run}`,
    `@Desk ${run} : Light work ${run} : Buying ${run}`,
  ]);
  await expect(tiredGroup.locator('.task-title')).toHaveText([`Ask Mum about Sunday ${run}`]);
  await expect(page.locator(':focus')).toHaveAttribute('data-key', /.+/);
  await expect(main.locator(':focus')).toHaveCount(1);
  await expect.poll(async () => (await server.task(both))?.completedAt).toBeTruthy();

  // Selecting a narrower tag shows only its own tasks.
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('ArrowDown');
  await expect(tagItem(page, `Tired ${run}`)).toHaveAttribute('aria-selected', 'true');
  await expect(main.getByRole('heading', { level: 3 })).toHaveText([`@Desk ${run} : Light work ${run} : Tired ${run}`]);
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect(tagItem(page, `Mum ${run}`)).toHaveAttribute('aria-selected', 'true');
  await expect(main.getByRole('heading', { level: 3 })).toHaveText([`Family ${run} : Mum ${run}`]);
  expect(await server.tagged(desk)).toHaveLength(2);
});

test('with the mouse, a tag removed in the editor stays removed when another task is clicked', async ({ page }) => {
  const phone = await SimulatedDevice.signIn();
  const { tagId: home } = await phone.createTag(`@Home ${run}`, { position: 'a6' });
  const { tagId: quick } = await phone.createTag(`Quick ${run}`, { position: 'a7' });
  const { projectId } = await phone.createProject(`Chores ${run}`, { position: 'a9' });
  const { taskId } = await phone.createTask(projectId, `Water the plants ${run}`, 'a0');
  await phone.createTask(projectId, `Empty the bins ${run}`, 'a1');
  await phone.tagTask(taskId, home);
  await phone.tagTask(taskId, quick);
  await signIn(page);
  await page.goto(`/projects/${projectId}`);
  const row = page.getByRole('list', { name: `Chores ${run}` }).getByRole('listitem').filter({ hasText: `Water the plants ${run}` });

  await page.getByRole('button', { name: `Water the plants ${run}`, exact: true }).click();
  await page.getByRole('button', { name: `Remove Quick ${run}` }).click();
  // Focus stays in the editor, so it still notices when the user moves on.
  await expect(page.getByLabel('Title')).toBeFocused();
  // One click on another task opens its editor, even though closing this one moves that task up.
  await page.getByRole('button', { name: `Empty the bins ${run}`, exact: true }).click();
  await expect(page.getByLabel('Title')).toHaveValue(`Empty the bins ${run}`);
  await expect(page.getByLabel('Title')).toBeFocused();

  await expect(row.locator('.tag-chip')).toHaveText([`@Home ${run}`]);
  await expect.poll(async () => (await server.task(taskId))?.tags.map((t) => t.name)).toEqual([`@Home ${run}`]);
});

test('tasks added in the Tags perspective get the tag of their group, and wait in the Inbox for a project', async ({ page }) => {
  const phone = await SimulatedDevice.signIn();
  const { tagId: town } = await phone.createTag(`@Town ${run}`, { position: 'a8' });
  const { tagId: post } = await phone.createTag(`Post office ${run}`, { parentId: town });
  await signIn(page);
  await page.goto(`/tags/${town}`);
  const main = page.getByRole('main');

  // An empty branch still has a heading for the selected tag, so N works.
  await expect(main.getByRole('heading', { level: 3 })).toHaveText([`@Town ${run}`]);
  await page.keyboard.press('3');
  await page.keyboard.press('Tab');
  await page.keyboard.press('n');
  await page.keyboard.type(`Collect the dry cleaning ${run}`);
  await page.keyboard.press('Enter');
  await page.keyboard.type(`Buy bread ${run}`);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  const townTasks = main.getByRole('list', { name: `@Town ${run}`, exact: true }).locator('.task-title');
  await expect(townTasks).toHaveText([`Collect the dry cleaning ${run}`, `Buy bread ${run}`]);

  // A task added under a narrower tag's heading gets that tag.
  await page.goto(`/tags/${post}`);
  await page.getByRole('button', { name: 'New task' }).click();
  await page.getByLabel('New task title').fill(`Send the passport form ${run}`);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(main.getByRole('list', { name: `@Town ${run} : Post office ${run}`, exact: true })).toContainText(`Send the passport form ${run}`);
  await page.goto(`/tags/${town}`);
  await expect(main.getByRole('heading', { level: 3 })).toHaveText([`@Town ${run}`, `@Town ${run} : Post office ${run}`]);

  await expect.poll(async () => (await server.tagged(post)).flatMap((g) => g.tasks.map((t) => t.title))).toEqual([`Send the passport form ${run}`]);
  const inbox = (await server.inbox()).map((entry) => entry.title);
  expect(inbox).toEqual(expect.arrayContaining([`Collect the dry cleaning ${run}`, `Buy bread ${run}`, `Send the passport form ${run}`]));
});

test('in Tags, removing the selected tag while editing keeps the editor open until editing stops', async ({ page }) => {
  const phone = await SimulatedDevice.signIn();
  const { tagId: garden } = await phone.createTag(`Garden ${run}`, { position: 'a9' });
  const { projectId } = await phone.createProject(`Outdoors ${run}`, { position: 'aA' });
  const { taskId } = await phone.createTask(projectId, `Prune the roses ${run}`);
  await phone.tagTask(taskId, garden);
  await signIn(page);
  await page.goto(`/tags/${garden}`);
  const main = page.getByRole('main');
  await expect(main.locator('.task-title')).toHaveText([`Prune the roses ${run}`]);

  await page.keyboard.press('3');
  await page.keyboard.press('Tab');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('t');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Tab');
  // Give a premature write time to reach the outline: the editor must stay put.
  await page.waitForTimeout(500);
  await expect(page.getByLabel('Note')).toBeFocused();
  await page.keyboard.type('After flowering');
  await page.keyboard.press('ControlOrMeta+Enter');

  await expect(main.locator('.task-title')).toHaveCount(0);
  await expect
    .poll(async () => {
      const task = await server.task(taskId);
      return [task?.note, task?.tags.length];
    })
    .toEqual(['After flowering', 0]);
});

test('a tag created offline survives a reload and reaches the server on reconnection', async ({ page }) => {
  await signIn(page);
  await page.getByRole('navigation', { name: 'Perspectives' }).getByRole('link', { name: 'Tags' }).click();
  await expect(page).toHaveURL(/\/tags$/);

  await network.offline();
  await page.getByRole('button', { name: 'New tag' }).click();
  await page.getByLabel('New tag name').fill(`@Errand ${run} offline`);
  await page.keyboard.press('Enter');
  await expect(tagItem(page, `@Errand ${run} offline`)).toBeFocused();

  await page.reload();
  await expect(tagItem(page, `@Errand ${run} offline`)).toHaveAttribute('aria-selected', 'true');
  expect(findByName(await server.tags(), `@Errand ${run} offline`)).toBeUndefined();

  await network.online();
  await expect.poll(async () => findByName(await server.tags(), `@Errand ${run} offline`)?.name).toBe(`@Errand ${run} offline`);
});
