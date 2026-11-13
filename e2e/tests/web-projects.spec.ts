import { expect, test, type Page } from '@playwright/test';
import type { OrganisationNode } from '@salamifocus/domain';
import { SimulatedDevice } from '../support/device.ts';
import { network } from '../support/network.ts';
import { server } from '../support/server.ts';
import { run, sidebar, sidebarOutline, signIn, status, treeItem } from '../support/web.ts';

test.afterEach(() => network.online());

/** Opens Projects with one item selected, then puts keyboard focus on it as the "2" shortcut does. */
async function openProjectsAt(page: Page, id: string, name: string) {
  await page.goto(`/#/projects/${id}`);
  await expect(treeItem(page, name)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('2');
  await expect(treeItem(page, name)).toBeFocused();
}

async function typeName(page: Page, label: string, name: string) {
  await expect(page.getByLabel(label)).toBeFocused();
  await page.keyboard.type(name);
  await page.keyboard.press('Enter');
  await expect(treeItem(page, name)).toBeFocused();
}

function findByName(nodes: OrganisationNode[], name: string): OrganisationNode | undefined {
  for (const node of nodes) {
    if (node.name === name) return node;
    const found = node.type === 'folder' ? findByName(node.children, name) : undefined;
    if (found) return found;
  }
  return undefined;
}

test('folders, projects and single-action lists are created, nested, reordered and renamed from the keyboard', async ({ page }) => {
  const phone = await SimulatedDevice.signIn();
  const anchor = `Anchor ${run}`;
  const { projectId } = await phone.createProject(anchor);
  await signIn(page);
  await openProjectsAt(page, projectId, anchor);

  await page.keyboard.press('f');
  await typeName(page, 'New folder name', `Personal ${run}`);
  // A new item goes inside the focused folder.
  await page.keyboard.press('n');
  await typeName(page, 'New project name', `Passport renewed ${run}`);
  // ...and next to a focused project.
  await page.keyboard.press('s');
  await typeName(page, 'New single-action list name', `Miscellaneous ${run}`);
  await page.keyboard.press('f');
  await typeName(page, 'New folder name', `Parents ${run}`);
  expect(await sidebarOutline(page)).toEqual(['Anchor', 'Personal', '  Passport renewed', '  Miscellaneous', '  Parents']);

  // Reorder, then move into the folder above and back out again.
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Alt+ArrowUp');
  await expect.poll(() => sidebarOutline(page)).toEqual(['Anchor', 'Personal', '  Miscellaneous', '  Passport renewed', '  Parents']);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Alt+ArrowDown');
  await expect.poll(() => sidebarOutline(page)).toEqual(['Anchor', 'Personal', '  Miscellaneous', '  Parents', '  Passport renewed']);
  await page.keyboard.press('Alt+ArrowRight');
  await expect.poll(() => sidebarOutline(page)).toEqual(['Anchor', 'Personal', '  Miscellaneous', '  Parents', '    Passport renewed']);
  await expect(treeItem(page, `Passport renewed ${run}`)).toBeFocused();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect.poll(() => sidebarOutline(page)).toEqual(['Anchor', 'Personal', '  Miscellaneous', '  Parents', '  Passport renewed']);

  await page.keyboard.press('Enter');
  await page.getByLabel('Name', { exact: true }).fill(`Passport renewed before March ${run}`);
  await page.keyboard.press('Enter');
  await expect(treeItem(page, `Passport renewed before March ${run}`)).toBeFocused();

  await expect(status(page)).toContainText('All changes uploaded');
  const personal = findByName(await server.organisation(), `Personal ${run}`);
  expect(personal?.type === 'folder' && personal.children.map((c) => [c.name, c.type === 'project' ? c.kind : 'folder'])).toEqual([
    [`Miscellaneous ${run}`, 'single_actions'],
    [`Parents ${run}`, 'folder'],
    [`Passport renewed before March ${run}`, 'project'],
  ]);
});

test('selecting several projects or a folder shows each of their projects', async ({ page }) => {
  const phone = await SimulatedDevice.signIn();
  const { folderId } = await phone.createFolder(`Home ${run}`, { position: 'a1' });
  await phone.createProject(`Garden ${run}`, { folderId, position: 'a0' });
  const { projectId } = await phone.createProject(`Boiler ${run}`, { folderId, position: 'a1' });
  await signIn(page);
  await openProjectsAt(page, projectId, `Boiler ${run}`);
  const main = page.getByRole('main');

  await expect(main.getByRole('heading', { level: 3 })).toHaveText([`Boiler ${run}`]);
  await page.keyboard.press('Shift+ArrowUp');
  await expect(main).toContainText('2 projects selected');
  await expect(main.getByRole('heading', { level: 3 })).toHaveText([`Garden ${run}`, `Boiler ${run}`]);

  await page.keyboard.press('ArrowUp');
  await expect(treeItem(page, `Home ${run}`)).toHaveAttribute('aria-selected', 'true');
  await expect(main.getByRole('heading', { level: 3 })).toHaveText([`Garden ${run}`, `Boiler ${run}`]);

  // Shift+Tab leaves the sidebar for the perspective navigation.
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('navigation', { name: 'Perspectives' }).getByRole('link', { name: 'Projects' })).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible();
  await expect(sidebar(page)).toBeHidden();
});

test('a project created offline survives a reload and reaches the server on reconnection', async ({ page }) => {
  const phone = await SimulatedDevice.signIn();
  const { folderId } = await phone.createFolder(`Errands ${run}`, { position: 'a2' });
  await signIn(page);
  await openProjectsAt(page, folderId, `Errands ${run}`);

  await network.offline();
  await expect(status(page)).toContainText('Offline');
  await page.keyboard.press('n');
  await typeName(page, 'New project name', `Return library books ${run}`);
  await expect(status(page)).toContainText('1 change waiting to upload');

  await page.reload();
  await expect(treeItem(page, `Return library books ${run}`)).toBeVisible();
  expect(findByName(await server.organisation(), `Return library books ${run}`)).toBeUndefined();

  await network.online();
  await expect(status(page)).toContainText('All changes uploaded');
  const errands = findByName(await server.organisation(), `Errands ${run}`);
  expect(errands?.type === 'folder' && errands.children.map((c) => c.name)).toEqual([`Return library books ${run}`]);
});
