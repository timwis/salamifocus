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
