import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { loadScenarios, seed, type ExpectedPerspective, type Ids } from './behaviour.ts';
import { createHarness, type Harness } from './harness.ts';

let h: Harness;
before(async () => {
  h = await createHarness();
});
after(() => h.close());

/** What the server's queries say a perspective shows, in the fixtures' terms. */
async function shown(expected: ExpectedPerspective, ids: Ids): Promise<ExpectedPerspective['groups']> {
  const name = (uuid: string) => ids.name(uuid) ?? uuid;
  if (expected.perspective === 'projects') {
    const outline = await h.application.projects(expected.selection.map((id) => ids.uuid(id)));
    return outline.map(({ project, tasks }) => ({ id: name(project.id), tasks: tasks.map((t) => ({ id: name(t.id), depth: t.depth })) }));
  }
  const [tagId] = expected.selection;
  const outline = tagId ? await h.application.tagged(ids.uuid(tagId)) : [];
  return outline.map(({ tag, tasks }) => ({ id: name(tag.id), tasks: tasks.map((t) => ({ id: name(t.id), depth: 1 })) }));
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
          assert.deepEqual(await shown(perspective, ids), perspective.groups, `${perspective.perspective} with ${perspective.selection.join(', ')} selected`);
        }
      });
    }
  });
}
