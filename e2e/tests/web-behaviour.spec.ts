import { expect, test, type Page } from '@playwright/test';
import { connect } from '../../server/src/db.ts';
import { loadScenarios, seed, unseed, type ExpectedPerspective, type Ids } from '../../server/test/behaviour.ts';
import { databaseUrl } from '../support/env.ts';
import { signIn } from '../support/web.ts';

// The shared behaviour fixtures (fixtures/README.md), checked through the real
// web client: records reach it by sync and it works out the rest locally.

const sql = connect(databaseUrl, { max: 1 });
test.afterAll(() => sql.end());

interface ShownRow {
  key: string;
  level: string | null;
  unavailable: string;
}

async function shownRows(page: Page) {
  return page.locator('[data-region="outline"] ul.tasks').evaluateAll((lists) =>
    lists.map((list) => ({
      group: (list as HTMLElement).dataset.group ?? '',
      rows: [...list.querySelectorAll<HTMLElement>('li.task-row')].map(
        (row): ShownRow => ({ key: row.dataset.key ?? '', level: row.getAttribute('aria-level'), unavailable: row.dataset.unavailable ?? '' }),
      ),
    })),
  );
}

/** What the outline shows, in the fixtures' terms, and the availability each row shows. */
async function shown(page: Page, ids: Ids) {
  const name = (uuid: string) => ids.name(uuid) ?? uuid;
  const lists = await shownRows(page);
  const unavailable: Record<string, string[]> = {};
  const groups: ExpectedPerspective['groups'] = lists.map(({ group, rows }) => ({
    id: name(group),
    tasks: rows.map((row) => {
      const id = name(row.key.slice(row.key.indexOf('/') + 1));
      unavailable[id] = row.unavailable.split(' ').filter(Boolean);
      return { id, depth: row.level === null ? 1 : Number(row.level) };
    }),
  }));
  return { groups, unavailable };
}

for (const { scenario, file, examples } of loadScenarios()) {
  test.describe(`${scenario} (fixtures/${file})`, () => {
    for (const example of examples) {
      test(example.name, async ({ page }) => {
        await page.clock.setFixedTime(new Date(example.clock));
        const ids = await seed(sql, example);
        try {
          await signIn(page);
          for (const perspective of example.expect.perspectives) {
            await page.goto(`/${perspective.perspective}/${perspective.selection.map((id) => ids.uuid(id)).join(',')}`);
            await expect.poll(async () => (await shown(page, ids)).groups).toEqual(perspective.groups);
            const { unavailable } = await shown(page, ids);
            for (const [task, reasons] of Object.entries(unavailable)) {
              expect(reasons, `availability of ${task}`).toEqual(example.expect.unavailable[task]);
            }
          }
        } finally {
          // The other end-to-end tests share this database, and its records would show in their sidebars.
          await unseed(sql, ids);
        }
      });
    }
  });
}
