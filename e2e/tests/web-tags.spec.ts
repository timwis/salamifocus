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
