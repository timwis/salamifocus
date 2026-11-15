import { expect, type Locator, type Page } from '@playwright/test';
import { password } from './env.ts';

/** A suffix that keeps this run's records apart from earlier runs against the same stack. */
export const run = Date.now().toString(36);

export async function signIn(page: Page) {
  await page.goto('/');
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible();
}

export const status = (page: Page) => page.getByRole('status');
export const sidebar = (page: Page) => page.getByRole('tree', { name: 'Folders and projects' });
export const treeItem = (page: Page, name: string) => sidebar(page).getByRole('treeitem', { name, exact: true });
export const tagSidebar = (page: Page) => page.getByRole('tree', { name: 'Tags' });
export const tagItem = (page: Page, name: string) => tagSidebar(page).getByRole('treeitem', { name, exact: true });

/** The names in a sidebar tree that belong to this run, top to bottom, with their nesting level. */
export async function sidebarOutline(page: Page, tree: Locator = sidebar(page)): Promise<string[]> {
  const items = await tree.getByRole('treeitem').all();
  const rows = await Promise.all(
    items.map(async (item) => ({ name: (await item.textContent()) ?? '', level: Number(await item.getAttribute('aria-level')) })),
  );
  return rows.filter((row) => row.name.endsWith(run)).map((row) => `${'  '.repeat(row.level - 1)}${row.name.replace(` ${run}`, '')}`);
}
