import { expect, test, type Page } from '@playwright/test';
import { SimulatedDevice } from '../support/device.ts';
import { server } from '../support/server.ts';
import { run, signIn } from '../support/web.ts';

async function openProject(page: Page, projectId: string) {
  await signIn(page);
  await page.goto(`/projects/${projectId}`);
  await page.keyboard.press('2');
  await page.keyboard.press('Tab');
}

const flag = (page: Page, title: string) => page.getByRole('button', { name: `Flag ${title}` });

test('F flags and unflags the current task, which keeps its flag while deferred, and the flag can be clicked', async ({ page }) => {
  const phone = await SimulatedDevice.signIn();
  const report = `Quarterly report (${run})`;
  const { projectId } = await phone.createProject(report, { position: 'a7t' });
  const compile = `Compile the report ${run}`;
  const email = `Email Steve ${run}`;
  const { taskId } = await phone.createTask(projectId, compile, 'a0');
  const { taskId: child } = await phone.createTask(projectId, email, 'a0', taskId);
  await openProject(page, projectId);
  const row = page.getByRole('listitem').filter({ hasText: compile });
  await expect(flag(page, compile)).toHaveAttribute('aria-pressed', 'false');

  await page.keyboard.press('ArrowDown');
  await expect(row).toBeFocused();
  await page.keyboard.press('f');
  await expect(flag(page, compile)).toHaveAttribute('aria-pressed', 'true');
  await expect(row).toBeFocused();
  await expect.poll(async () => (await server.task(taskId))?.flagged).toBe(true);
  // Not inherited by the task beneath it.
  await expect(flag(page, email)).toHaveAttribute('aria-pressed', 'false');
  expect((await server.task(child))?.flagged).toBe(false);

  // Deferring it from another device leaves the flag where it is.
  await phone.defer(taskId, '2099-01-01T00:00:00.000Z');
  await expect(row).toHaveAttribute('data-unavailable', 'blocked deferred');
  await expect(flag(page, compile)).toHaveAttribute('aria-pressed', 'true');

  await page.keyboard.press('f');
  await expect(flag(page, compile)).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => (await server.task(taskId))?.flagged).toBe(false);

  await flag(page, email).click();
  await expect(flag(page, email)).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await server.task(child))?.flagged).toBe(true);
  const operations = (await server.history(taskId)).map((e) => e.operation).filter((name) => name.includes('flag'));
  expect(operations).toEqual(['flag_task', 'unflag_task']);
});
