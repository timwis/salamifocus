import { expect, test, type Page } from '@playwright/test';
import { SimulatedDevice } from '../support/device.ts';
import { network } from '../support/network.ts';
import { server } from '../support/server.ts';
import { run, signIn, status } from '../support/web.ts';

const inbox = (page: Page) => page.getByRole('list', { name: 'Inbox' });

async function rename(page: Page, from: string, to: string) {
  await inbox(page).getByRole('button', { name: from, exact: true }).click();
  await page.getByLabel('Title').fill(to);
  await page.getByLabel('Title').press('Enter');
}

test.afterEach(() => network.online());

test('a capture from the phone appears in the Inbox, and renaming it reaches the server', async ({ page }) => {
  const phone = await SimulatedDevice.signIn();
  await signIn(page);

  const captured = `call sam re boiler ${run}`;
  const { taskId } = await phone.capture(captured);
  await expect(inbox(page).getByRole('button', { name: captured, exact: true })).toBeVisible();

  const renamed = `Call Sam about the boiler service ${run}`;
  await rename(page, captured, renamed);

  await expect(inbox(page).getByRole('button', { name: renamed, exact: true })).toBeVisible();
  await expect.poll(async () => (await server.task(taskId))?.title).toBe(renamed);
  const task = await server.task(taskId);
  expect(task?.capture?.text).toBe(captured);
  const history = await server.history(taskId);
  expect(history.map((entry) => [entry.operation, entry.source])).toEqual([
    ['capture_text', 'android-simulated'],
    ['rename_task', 'web'],
  ]);
  await expect(status(page)).toContainText('All changes uploaded');
});

test('edits made offline survive a reload and converge with the phone on reconnection', async ({ page }) => {
  const phone = await SimulatedDevice.signIn();
  await signIn(page);
  const first = await phone.capture(`buy milk ${run}`);
  const second = await phone.capture(`book dentist ${run}`);
  await expect(inbox(page).getByRole('button', { name: `book dentist ${run}`, exact: true })).toBeVisible();

  await network.offline();
  await expect(status(page)).toContainText('Offline');
  await rename(page, `buy milk ${run}`, `Buy oat milk ${run}`);
  await expect(status(page)).toContainText('1 change waiting to upload');

  // The tab is closed and reopened while still offline.
  await page.reload();
  await expect(inbox(page).getByRole('button', { name: `Buy oat milk ${run}`, exact: true })).toBeVisible();
  await expect(status(page)).toContainText('1 change waiting to upload');

  // Meanwhile the phone, still online, rewords the other capture.
  await phone.rename(second.taskId, `Book dentist check-up ${run}`);
  expect((await server.task(first.taskId))?.title).toBe(`buy milk ${run}`);

  await network.online();
  await expect(status(page)).toContainText('All changes uploaded');
  await expect(inbox(page).getByRole('button', { name: `Book dentist check-up ${run}`, exact: true })).toBeVisible();
  await expect.poll(async () => (await server.task(first.taskId))?.title).toBe(`Buy oat milk ${run}`);
  expect(await server.history(first.taskId)).toHaveLength(2);
});

test('a blank title is refused without changing anything', async ({ page }) => {
  const phone = await SimulatedDevice.signIn();
  await signIn(page);
  const { taskId } = await phone.capture(`water plants ${run}`);

  await inbox(page).getByRole('button', { name: `water plants ${run}`, exact: true }).click();
  await page.getByLabel('Title').fill('   ');
  await page.getByLabel('Title').press('Enter');

  await expect(page.getByRole('alert')).toHaveText('A task needs a title.');
  await page.getByLabel('Title').press('Escape');
  await expect(inbox(page).getByRole('button', { name: `water plants ${run}`, exact: true })).toBeVisible();
  expect(await server.history(taskId)).toHaveLength(1);
});

test('captures are processed from the keyboard, leaving the Inbox only once they have a project and a tag', async ({ page }) => {
  const phone = await SimulatedDevice.signIn();
  // Not ending in the run's suffix, and placed before everything else, so other tests' sidebars can ignore them.
  const mine = `${run}-inbox`;
  const { tagId: errand } = await phone.createTag(`@Out and about ${mine}`, { position: 'Zz' });
  const { folderId } = await phone.createFolder(`Outdoors ${mine}`, { position: 'Zy' });
  const allotment = `Allotment ${mine}`;
  await phone.createProject(allotment, { folderId });
  const { projectId: misc } = await phone.createProject(`Odds and ends ${mine}`, { kind: 'single_actions', position: 'Zz' });
  const hedge = await phone.capture(`sort hedge ${run}`);
  const stamps = await phone.capture(`stamps ${run}`);
  const last = await phone.capture(`ring the vet ${run}`);
  await signIn(page);
  await page.keyboard.press('1');
  const row = (title: string) => inbox(page).getByRole('listitem').filter({ hasText: title });
  await expect(row(`sort hedge ${run}`)).toBeVisible();
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect(row(`sort hedge ${run}`)).toBeFocused();

  // Reword, then Tab to the project and choose it by typing part of its folder path.
  await page.keyboard.press('Enter');
  await expect(page.locator('.captured-as')).toHaveCount(0);
  await page.getByLabel('Title').fill(`Book a hedge trimmer ${run}`);
  await expect(page.locator('.captured-as')).toHaveText(`Captured as “sort hedge ${run}”`);
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Project', { exact: true })).toBeFocused();
  await page.keyboard.type(`outdoors ${mine}`);
  await expect(page.getByRole('listbox', { name: 'Matching projects' }).getByRole('option')).toHaveText([
    `Outdoors ${mine} : ${allotment}`,
    `New project “outdoors ${mine}”`,
  ]);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');

  // With only a project it stays, showing the project.
  const trimmer = row(`Book a hedge trimmer ${run}`);
  await expect(trimmer).toContainText(allotment);
  await expect(trimmer).toBeFocused();
  await expect.poll(async () => (await server.task(hedge.taskId))?.projectId).not.toBeNull();

  // Typing the name of the project it is already in finds that project.
  await page.keyboard.press('p');
  await page.keyboard.type(allotment);
  await expect(page.getByRole('listbox', { name: 'Matching projects' }).getByRole('option')).toHaveText([`Outdoors ${mine} : ${allotment}`]);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(trimmer).toBeFocused();

  // With only a tag it stays too.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('t');
  await page.keyboard.type(`out and about ${mine}`);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect(row(`stamps ${run}`).locator('.tag-chip')).toHaveText([`@Out and about ${mine}`]);
  await expect.poll(async () => (await server.task(stamps.taskId))?.tags.map((t) => t.id)).toEqual([errand]);

  // Giving it a single-action list as well processes it, and focus moves to the next item.
  await page.keyboard.press('p');
  await page.keyboard.type(`odds and ends ${mine}`);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Title')).toBeHidden();
  await expect(row(`stamps ${run}`)).toHaveCount(0);
  await expect(row(`ring the vet ${run}`)).toBeFocused();

  // So does tagging the task that already had a project.
  await page.keyboard.press('ArrowUp');
  await expect(trimmer).toBeFocused();
  await page.keyboard.press('t');
  await page.keyboard.type(`out and about ${mine}`);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Title')).toBeHidden();
  await expect(trimmer).toHaveCount(0);
  await expect(row(`ring the vet ${run}`)).toBeFocused();

  await expect.poll(async () => (await server.task(stamps.taskId))?.projectId).toBe(misc);
  await expect.poll(async () => (await server.task(hedge.taskId))?.tags.length).toBe(1);
  const processed = await server.task(hedge.taskId);
  expect([processed?.title, processed?.capture?.text]).toEqual([`Book a hedge trimmer ${run}`, `sort hedge ${run}`]);
  const inboxIds = (await server.inbox()).map((entry) => entry.id);
  expect(inboxIds).not.toContain(hedge.taskId);
  expect(inboxIds).not.toContain(stamps.taskId);
  expect(inboxIds).toContain(last.taskId);
  await expect(status(page)).toContainText('All changes uploaded');
});

test('a new project is created in a chosen folder without leaving the row', async ({ page }) => {
  const phone = await SimulatedDevice.signIn();
  const mine = `${run}-new-project`;
  const { tagId: workshop } = await phone.createTag(`@Workshop ${mine}`, { position: 'Zx' });
  const { folderId } = await phone.createFolder(`Sheds ${mine}`, { position: 'Zx' });
  const { taskId } = await phone.capture(`paint shed ${run}`);
  await signIn(page);
  await page.keyboard.press('1');
  const row = inbox(page).getByRole('listitem').filter({ hasText: `paint shed ${run}` });
  await expect(row).toBeVisible();
  await page.keyboard.press('End');
  await expect(row).toBeFocused();

  await page.keyboard.press('p');
  const name = `Repaint the shed ${mine}`;
  await page.keyboard.type(name);
  await expect(page.getByRole('listbox', { name: 'Matching projects' }).getByRole('option')).toHaveText([`New project “${name}”`]);
  await page.keyboard.press('Enter');

  // Escape goes back to the name rather than out of the editor; Enter asks for the folder again.
  await expect(page.getByLabel(`Folder for ${name}`)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Project', { exact: true })).toHaveValue(name);
  await page.keyboard.press('Enter');
  const folders = page.getByRole('listbox', { name: 'Folders' }).getByRole('option');
  await expect(folders.first()).toHaveText('No folder (top level)');

  // A folder name that matches nothing is reported, rather than quietly meaning no folder.
  await page.keyboard.type(`shedz ${mine}`);
  await expect(folders).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toHaveText(`There is no folder called “shedz ${mine}”.`);

  // Tab picks the folder, as Enter does, and moves on to the tags.
  await page.getByLabel(`Folder for ${name}`).fill(`sheds ${mine}`);
  await expect(folders).toHaveText([`Sheds ${mine}`]);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('combobox', { name: 'Tags' })).toBeFocused();
  await expect(page.locator('.task-editor .project-chip')).toHaveText(`${name}×`);

  await page.keyboard.type('workshop');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Title')).toBeHidden();
  await expect(row).toHaveCount(0);

  await expect.poll(async () => (await server.task(taskId))?.tags.map((t) => t.id)).toEqual([workshop]);
  const sheds = (await server.organisation()).find((node) => node.id === folderId);
  const created = sheds?.type === 'folder' ? sheds.children : [];
  expect(created.map((node) => [node.type, node.name])).toEqual([['project', name]]);
  expect((await server.task(taskId))?.projectId).toBe(created[0]?.id);
  await expect(status(page)).toContainText('All changes uploaded');
});

test('C captures to the Inbox from any perspective and puts focus back where it was', async ({ page }) => {
  const phone = await SimulatedDevice.signIn();
  const shed = `Shed ${run}-capture`;
  const { projectId } = await phone.createProject(shed, { position: 'Zw' });
  await signIn(page);
  await page.goto(`/projects/${projectId}`);
  await page.keyboard.press('2');
  const project = page.getByRole('tree', { name: 'Folders and projects' }).getByRole('treeitem', { name: shed, exact: true });
  await expect(project).toBeFocused();

  await page.keyboard.press('c');
  await expect(page.getByRole('dialog', { name: 'Capture to Inbox' })).toBeVisible();
  await page.keyboard.type(`  oil the hinges ${run} `);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Capture', exact: true })).toHaveValue('');
  await page.keyboard.type(`buy creosote ${run}`);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Capture to Inbox' })).toBeHidden();
  await expect(project).toBeFocused();

  // Escape abandons what was typed.
  await page.keyboard.press('c');
  await page.keyboard.type(`never mind ${run}`);
  await page.keyboard.press('Escape');
  await expect(project).toBeFocused();

  await page.keyboard.press('1');
  const titles = inbox(page).getByRole('listitem').getByRole('button', { name: new RegExp(`${run}$`) });
  await expect(inbox(page).getByRole('button', { name: `oil the hinges ${run}`, exact: true })).toBeVisible();
  await expect(inbox(page).getByRole('button', { name: `buy creosote ${run}`, exact: true })).toBeVisible();
  await expect(titles.filter({ hasText: 'never mind' })).toHaveCount(0);

  const uploaded = async () => (await server.inbox()).find((e) => e.title === `oil the hinges ${run}`)?.id;
  await expect.poll(uploaded).toBeTruthy();
  const id = (await uploaded())!;
  expect((await server.task(id))?.capture?.text).toBe(`  oil the hinges ${run} `);
  expect((await server.history(id)).map((h) => [h.operation, h.source])).toEqual([['capture_text', 'web']]);
  await expect(status(page)).toContainText('All changes uploaded');
});
