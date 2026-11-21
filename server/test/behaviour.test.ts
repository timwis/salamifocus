import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { untaggedId, type TagNode } from '@salamifocus/domain';
import { loadScenarios, ownForecast, seed, type Example, type ExpectedPerspective, type Ids } from './behaviour.ts';
import { createHarness, type Harness } from './harness.ts';

let h: Harness;
before(async () => {
  h = await createHarness();
});
after(() => h.close());

/** What the server's queries say a perspective shows, in the fixtures' terms. */
async function shown(expected: ExpectedPerspective, ids: Ids, example: Example): Promise<Pick<ExpectedPerspective, 'groups' | 'sidebar' | 'sections'>> {
  const name = (uuid: string) => ids.name(uuid) ?? uuid;
  const entries = (nodes: TagNode[], depth: number): { id: string; depth: number }[] =>
    nodes.flatMap((node) => [{ id: name(node.id), depth }, ...entries(node.children, depth + 1)]);
  if (expected.perspective === 'forecast') {
    if (!example.timeZone) throw new Error('A Forecast example needs a time zone.');
    const sections = await h.application.forecast(example.timeZone);
    return ownForecast(
      sections.map(({ id, due, deferred }) => ({ id, due: due.map((t) => t.id), deferred: deferred.map((t) => t.id) })),
      ids,
    );
  }
  if (expected.perspective === 'personal' || expected.perspective === 'work') {
    const [selected = null] = expected.selection;
    const { groups, sidebar } = await h.application.actionable(expected.perspective, selected === null || selected === untaggedId ? selected : ids.uuid(selected));
    return {
      groups: groups.map(({ tag, tasks }) => ({ id: tag ? name(tag.id) : untaggedId, tasks: tasks.map((t) => ({ id: name(t.id), depth: 1 })) })),
      sidebar: [...entries(sidebar.tags, 1), ...(sidebar.untagged ? [{ id: untaggedId, depth: 1 }] : [])],
    };
  }
  if (expected.perspective === 'projects') {
    const outline = await h.application.projects(
      expected.selection.map((id) => ids.uuid(id)),
      expected.visibility,
    );
    return { groups: outline.map(({ project, tasks }) => ({ id: name(project.id), tasks: tasks.map((t) => ({ id: name(t.id), depth: t.depth })) })) };
  }
  if (expected.perspective === 'agendas') {
    const [selected] = expected.selection;
    const { groups, sidebar } = await h.application.agendas(expected.visibility, selected ? ids.uuid(selected) : null);
    return {
      groups: groups.map(({ tag, tasks }) => ({ id: name(tag.id), tasks: tasks.map((t) => ({ id: name(t.id), depth: 1 })) })),
      sidebar: entries(sidebar, 1),
    };
  }
  if (expected.perspective === 'flagged') {
    // Every flagged task in the database is listed, so those other examples seeded are left out.
    const tasks = (await h.application.flagged(expected.visibility)).filter((t) => ids.name(t.id) !== undefined);
    return { groups: [{ id: 'flagged', tasks: tasks.map((t) => ({ id: name(t.id), depth: 1 })) }] };
  }
  const [tagId] = expected.selection;
  const outline = tagId ? await h.application.tagged(ids.uuid(tagId), expected.visibility) : [];
  return { groups: outline.map(({ tag, tasks }) => ({ id: name(tag.id), tasks: tasks.map((t) => ({ id: name(t.id), depth: 1 })) })) };
}

for (const { scenario, file, examples } of loadScenarios()) {
  describe(`${scenario} (fixtures/${file})`, () => {
    for (const example of examples) {
      it(example.name, async () => {
        h.clock.set(new Date(example.clock));
        const ids = await seed(h.sql, example);

        for (const [task, reasons] of Object.entries(example.expect.unavailable)) {
          assert.deepEqual((await h.application.task(ids.uuid(task)))?.unavailable, reasons, `availability of ${task}`);
        }
        for (const perspective of example.expect.perspectives) {
          const { groups, sidebar, sections } = await shown(perspective, ids, example);
          const described = `${perspective.perspective} with ${perspective.selection.join(', ')} selected, showing ${perspective.visibility ?? 'the default'}`;
          assert.deepEqual(groups, perspective.groups, described);
          if (perspective.sidebar) assert.deepEqual(sidebar, perspective.sidebar, `sidebar of ${described}`);
          if (perspective.sections) assert.deepEqual(sections, perspective.sections, `headings of ${described}`);
        }
      });
    }
  });
}
