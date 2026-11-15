import { expect, test, type Page } from '@playwright/test';
import type { OrganisationNode } from '@salamifocus/domain';
import { SimulatedDevice } from '../support/device.ts';
import { network } from '../support/network.ts';
import { server } from '../support/server.ts';
import { run, sidebar, sidebarOutline, signIn, status, treeItem } from '../support/web.ts';

test.afterEach(() => network.online());

/** Opens Projects with one item selected, then puts keyboard focus on it as the "2" shortcut does. */
async function openProjectsAt(page: Page, id: string, name: string) {
  await page.goto(`/projects/${id}`);
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

  await expect
    .poll(async () => {
      const personal = findByName(await server.organisation(), `Personal ${run}`);
      return personal?.type === 'folder' && personal.children.map((c) => [c.name, c.type === 'project' ? c.kind : 'folder']);
    })
    .toEqual([
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

test('tasks are added to a project, retitled and reordered from the keyboard, and stay out of the Inbox', async ({ page }) => {
  const phone = await SimulatedDevice.signIn();
  const kitchen = `Kitchen ${run}`;
  const { projectId } = await phone.createProject(kitchen, { position: 'a3' });
  await signIn(page);
  await openProjectsAt(page, projectId, kitchen);
  const tasks = page.getByRole('list', { name: kitchen }).getByRole('listitem');
  const task = (title: string) => tasks.filter({ hasText: title });

  // Tab moves from the sidebar to the outline, starting on the project's heading.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('heading', { name: kitchen, level: 3 })).toBeFocused();

  // N adds a task; Enter saves it and starts the next; Escape stops.
  await page.keyboard.press('n');
  await page.keyboard.type(`Choose a colour ${run}`);
  await page.keyboard.press('Enter');
  await page.keyboard.type(`Buy dust sheets ${run}`);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(tasks).toHaveText([`Choose a colour ${run}`, `Buy dust sheets ${run}`]);
  await expect(task(`Buy dust sheets ${run}`)).toBeFocused();

  // A task added from a row goes straight after it.
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('n');
  await page.keyboard.type(`Measure the walls ${run}`);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(tasks).toHaveText([`Choose a colour ${run}`, `Measure the walls ${run}`, `Buy dust sheets ${run}`]);

  await expect(task(`Measure the walls ${run}`)).toBeFocused();
  await page.keyboard.press('Enter');
  await page.getByLabel('Title').fill(`Measure the walls and ceiling ${run}`);
  await page.keyboard.press('Enter');
  await expect(task(`Measure the walls and ceiling ${run}`)).toBeFocused();

  // Alt+↑ moves the task up within its project, and no further than the top.
  await page.keyboard.press('Alt+ArrowUp');
  await expect(tasks).toHaveText([`Measure the walls and ceiling ${run}`, `Choose a colour ${run}`, `Buy dust sheets ${run}`]);
  await expect(task(`Measure the walls and ceiling ${run}`)).toBeFocused();
  await page.keyboard.press('Alt+ArrowUp');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Alt+ArrowUp');
  await expect(tasks).toHaveText([`Measure the walls and ceiling ${run}`, `Buy dust sheets ${run}`, `Choose a colour ${run}`]);

  const titles = [`Measure the walls and ceiling ${run}`, `Buy dust sheets ${run}`, `Choose a colour ${run}`];
  await expect.poll(async () => (await server.projects([projectId]))[0]?.tasks.map((t) => t.title)).toEqual(titles);

  await page.keyboard.press('1');
  await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible();
  for (const title of titles) await expect(page.getByRole('main')).not.toContainText(title);
});

test('a task’s title and note are edited together; Tab keeps a change and Escape abandons one', async ({ page }) => {
  const phone = await SimulatedDevice.signIn();
  const car = `Car ${run}`;
  const { projectId } = await phone.createProject(car, { position: 'a4' });
  const { taskId } = await phone.createTask(projectId, `renew insurance ${run}`);
  await signIn(page);
  await openProjectsAt(page, projectId, car);
  const row = page.getByRole('list', { name: car }).getByRole('listitem');
  await expect(row).toHaveText([`renew insurance ${run}`]);

  await page.keyboard.press('Tab');
  await page.keyboard.press('ArrowDown');
  await expect(row).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Title')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Note')).toBeFocused();
  await page.keyboard.type('Policy 12-345');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Quote due in March');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(row).toBeFocused();
  await expect(row.getByRole('img', { name: 'Has a note' })).toBeVisible();
  await expect.poll(async () => (await server.task(taskId))?.note).toBe('Policy 12-345\nQuote due in March');

  // Tab keeps the new title; Escape then abandons only the note being typed.
  await page.keyboard.press('Enter');
  await page.getByLabel('Title').fill(`Renew car insurance ${run}`);
  await page.keyboard.press('Tab');
  await page.keyboard.type(' (never mind)');
  await page.keyboard.press('Escape');
  await expect(row).toBeFocused();
  await expect(row).toContainText(`Renew car insurance ${run}`);

  await expect
    .poll(async () => {
      const task = await server.task(taskId);
      return [task?.title, task?.note];
    })
    .toEqual([`Renew car insurance ${run}`, 'Policy 12-345\nQuote due in March']);
  expect((await server.history(taskId)).map((entry) => entry.operation)).toEqual(['create_task', 'edit_task_note', 'rename_task']);
});

test('Space completes a task, focus moves to the next row, and an emptied single-action list stays usable', async ({ page }) => {
  const phone = await SimulatedDevice.signIn();
  const errands = `Errands list ${run}`;
  const { projectId } = await phone.createProject(errands, { position: 'a5', kind: 'single_actions' });
  const { taskId: first } = await phone.createTask(projectId, `Post the parcel ${run}`, 'a0');
  await phone.createTask(projectId, `Collect prescription ${run}`, 'a1');
  await phone.createTask(projectId, `Return library books ${run}`, 'a2');
  await signIn(page);
  await openProjectsAt(page, projectId, errands);
  const tasks = page.getByRole('list', { name: errands }).getByRole('listitem');
  const heading = page.getByRole('heading', { name: errands, level: 3 });
  await expect(tasks).toHaveCount(3);

  await page.keyboard.press('Tab');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Space');
  await expect(tasks).toHaveText([`Collect prescription ${run}`, `Return library books ${run}`]);
  await expect(tasks.first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Space');
  await expect(tasks).toHaveText([`Collect prescription ${run}`]);
  await expect(tasks.first()).toBeFocused();
  await page.keyboard.press('Space');
  await expect(tasks).toHaveCount(0);
  await expect(heading).toBeFocused();

  // The empty list is still there and still takes new tasks.
  await expect(treeItem(page, errands)).toBeVisible();
  await page.keyboard.press('n');
  await page.keyboard.type(`Buy stamps ${run}`);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(tasks).toHaveText([`Buy stamps ${run}`]);

  await expect.poll(async () => (await server.projects([projectId]))[0]?.tasks.map((t) => t.title)).toEqual([`Buy stamps ${run}`]);
  expect((await server.task(first))?.completedAt).toBeTruthy();
});

test('the mouse works too: clicking a perspective or empty space leaves the keys working, and buttons add things', async ({ page }) => {
  const phone = await SimulatedDevice.signIn();
  const { folderId } = await phone.createFolder(`Garage ${run}`, { position: 'a6' });
  await signIn(page);

  // Clicking Projects puts focus in the sidebar, so N works straight away.
  await page.getByRole('navigation', { name: 'Perspectives' }).getByRole('link', { name: 'Projects' }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.locator(':focus')).toHaveAttribute('role', 'treeitem');
  await treeItem(page, `Garage ${run}`).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${folderId}$`));
  const box = (await sidebar(page).boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height - 5);
  await expect(treeItem(page, `Garage ${run}`)).toBeFocused();
  await page.keyboard.press('n');
  await typeName(page, 'New project name', `Bike serviced ${run}`);

  // The sidebar's buttons add next to the current item, as the keys do.
  await page.getByRole('button', { name: 'New single-action list' }).click();
  await typeName(page, 'New single-action list name', `Garage odds and ends ${run}`);
  expect(await sidebarOutline(page)).toEqual(expect.arrayContaining(['Garage', '  Bike serviced', '  Garage odds and ends']));

  // New task adds to the selected project; clicking empty space then keeps the outline's keys working.
  await page.getByRole('button', { name: 'New task' }).click();
  await page.getByLabel('New task title').fill(`Buy a bin ${run}`);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  const tasks = page.getByRole('list', { name: `Garage odds and ends ${run}` }).getByRole('listitem');
  await expect(tasks).toHaveText([`Buy a bin ${run}`]);
  await page.getByText('1 task, 1 project selected').click();
  await expect(tasks.first()).toBeFocused();
  await page.keyboard.press('Space');
  await expect(tasks).toHaveCount(0);
  await expect(page.getByText('No tasks yet.')).toBeVisible();

  // A path reloads to the same place.
  await page.reload();
  await expect(treeItem(page, `Garage odds and ends ${run}`)).toHaveAttribute('aria-selected', 'true');
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
