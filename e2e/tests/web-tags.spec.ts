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
