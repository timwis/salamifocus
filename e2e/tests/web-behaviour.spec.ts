import { expect, test, type Page } from '@playwright/test';
import { untaggedId } from '@salamifocus/domain';
import { connect } from '../../server/src/db.ts';
import { loadScenarios, ownForecast, seed, unseed, type ExpectedPerspective, type Ids } from '../../server/test/behaviour.ts';
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

/** The sidebar's entries, in the fixtures' terms. */
async function shownSidebar(page: Page, ids: Ids) {
  const items = await page
    .locator('[data-region="sidebar"] [role="treeitem"]')
    .evaluateAll((rows) => rows.map((row) => ({ key: (row as HTMLElement).dataset.key ?? '', level: Number(row.getAttribute('aria-level')) })));
  return items.map(({ key, level }) => ({ id: ids.name(key) ?? key, depth: level }));
}

/** What the outline shows, in the fixtures' terms, and the availability each row shows. */
async function shown(page: Page, ids: Ids, onlySeeded = false) {
  const name = (uuid: string) => ids.name(uuid) ?? uuid;
  const lists = await shownRows(page);
  const unavailable: Record<string, string[]> = {};
  const groups: ExpectedPerspective['groups'] = lists.map(({ group, rows }) => ({
    id: name(group),
    tasks: rows.flatMap((row) => {
      const uuid = row.key.slice(row.key.lastIndexOf('/') + 1);
      if (onlySeeded && ids.name(uuid) === undefined) return [];
      const id = name(uuid);
      unavailable[id] = row.unavailable.split(' ').filter(Boolean);
      return [{ id, depth: row.level === null ? 1 : Number(row.level) }];
    }),
  }));
  return { groups, unavailable };
}

/** Forecast's headings and what each holds, in the fixtures' terms, with only the example's own tasks. */
async function shownForecast(page: Page, ids: Ids) {
  const sections = await page.locator('[data-region="outline"] [data-section]').evaluateAll((elements) =>
    elements.map((section) => {
      const tasks = (kind: string) =>
        [...section.querySelectorAll<HTMLElement>(`ul.tasks[data-group$="/${kind}"] li.task-row`)].map((row) => {
          const key = row.dataset.key ?? '';
          return key.slice(key.lastIndexOf('/') + 1);
        });
      return { id: (section as HTMLElement).dataset.section ?? '', due: tasks('due'), deferred: tasks('deferred') };
    }),
  );
  return ownForecast(sections, ids);
}

for (const { scenario, file, examples } of loadScenarios()) {
  test.describe(`${scenario} (fixtures/${file})`, () => {
    for (const example of examples) {
      test.describe(() => {
        // The device's time zone, where an example depends on it.
        if (example.timeZone) test.use({ timezoneId: example.timeZone });
        test(example.name, async ({ page }) => {
          await page.clock.setFixedTime(new Date(example.clock));
          const ids = await seed(sql, example);
          try {
            await signIn(page);
            for (const perspective of example.expect.perspectives) {
              const show = perspective.visibility ? `?show=${perspective.visibility}` : '';
              await page.goto(`/${perspective.perspective}/${perspective.selection.map((id) => (id === untaggedId ? id : ids.uuid(id))).join(',')}${show}`);
              // Flagged and Forecast list every flagged or dated task, and other tests share this database, so only the example's own are compared.
              const onlySeeded = perspective.perspective === 'flagged' || perspective.perspective === 'forecast';
              if (perspective.perspective === 'forecast') {
                const { sections, groups } = perspective;
                await expect.poll(() => shownForecast(page, ids)).toEqual({ sections, groups });
              } else await expect.poll(async () => (await shown(page, ids, onlySeeded)).groups).toEqual(perspective.groups);
              if (perspective.sidebar) await expect.poll(() => shownSidebar(page, ids)).toEqual(perspective.sidebar);
              const { unavailable } = await shown(page, ids, onlySeeded);
              // Only the listed tasks are checked, and only where this perspective shows them.
              for (const [task, reasons] of Object.entries(example.expect.unavailable)) {
                if (task in unavailable) expect(unavailable[task], `availability of ${task}`).toEqual(reasons);
              }
            }
          } finally {
            // The other end-to-end tests share this database, and its records would show in their sidebars.
            await unseed(sql, ids);
          }
        });
      });
    }
  });
}
