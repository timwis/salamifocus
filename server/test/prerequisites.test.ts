import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { OperationName } from '@salamifocus/domain';
import { createHarness, request, type Harness } from './harness.ts';

let h: Harness;
before(async () => {
  h = await createHarness();
});
after(() => h.close());

async function perform(name: string, args: Record<string, unknown>) {
  const result = await h.application.execute(request(name, args));
  return result.outcome === 'applied' ? 'applied' : result.code;
}

async function project(name: string) {
  const projectId = crypto.randomUUID();
  assert.equal(await perform(OperationName.createProject, { projectId, name, kind: 'project', folderId: null, position: 'a0' }), 'applied');
  return projectId;
}

async function addTask(projectId: string, title: string, position: string, parentId: string | null = null) {
  const taskId = crypto.randomUUID();
  assert.equal(await perform(OperationName.createTask, { taskId, projectId, parentId, title, position, createdAt: '2026-11-13T10:00:00.000Z' }), 'applied');
  return taskId;
}

const nest = (taskId: string, parentId: string | null, position: string) => perform(OperationName.nestTask, { taskId, parentId, position });

/** A project's outline, children indented beneath their parents. */
const outline = async (projectId: string) =>
  (await h.application.projects([projectId]))[0]?.tasks.map((t) => `${'  '.repeat(t.depth - 1)}${t.title}`);

describe('nested prerequisites', () => {
  it('nests a task beneath another, to any depth, and back out again', async () => {
    const id = await project('Quarterly report');
    const compile = await addTask(id, 'Compile the report', 'a0');
    const email = await addTask(id, 'Email Steve to request the document', 'a1');
    const address = await addTask(id, 'Find Steve’s address', 'a2');

    assert.equal(await nest(email, compile, 'a0'), 'applied');
    assert.equal(await nest(address, email, 'a0'), 'applied');
    assert.deepEqual(await outline(id), ['Compile the report', '  Email Steve to request the document', '    Find Steve’s address']);
    assert.equal((await h.application.task(address))?.parentId, email);

    // Outdenting a task takes its own children with it.
    assert.equal(await nest(email, null, 'a1'), 'applied');
    assert.deepEqual(await outline(id), ['Compile the report', 'Email Steve to request the document', '  Find Steve’s address']);
  });

  it('adds a task straight beneath a parent', async () => {
    const id = await project('Holiday booked');
    const book = await addTask(id, 'Book the flights', 'a0');
    await addTask(id, 'Check passport dates', 'a0', book);

    assert.deepEqual(await outline(id), ['Book the flights', '  Check passport dates']);
  });

  it('refuses to put a task beneath itself or one of its own descendants', async () => {
    const id = await project('Shed cleared');
    const clear = await addTask(id, 'Clear the shed', 'a0');
    const sort = await addTask(id, 'Sort the tools', 'a0', clear);
    const box = await addTask(id, 'Find a box', 'a0', sort);

    assert.equal(await nest(clear, clear, 'a0'), 'would_nest_in_itself');
    assert.equal(await nest(clear, box, 'a0'), 'would_nest_in_itself');
    assert.deepEqual(await outline(id), ['Clear the shed', '  Sort the tools', '    Find a box']);
  });

  it('keeps the hierarchy acyclic when two devices nest tasks beneath each other at once', async () => {
    const id = await project('Garage tidied');
    const a = await addTask(id, 'Sweep the floor', 'a0');
    const b = await addTask(id, 'Move the bikes', 'a1');

    const outcomes = await Promise.all([nest(a, b, 'a0'), nest(b, a, 'a0')]);

    assert.deepEqual(outcomes.sort(), ['applied', 'would_nest_in_itself']);
    assert.equal((await outline(id))?.length, 2);
  });

  it('only nests tasks within one project', async () => {
    const first = await project('Kitchen');
    const second = await project('Garden');
    const paint = await addTask(first, 'Paint the walls', 'a0');
    const mow = await addTask(second, 'Mow the lawn', 'a0');
    const inboxTask = crypto.randomUUID();
    assert.equal(await perform(OperationName.createTask, { taskId: inboxTask, projectId: null, title: 'Call the plumber' }), 'applied');

    assert.equal(await nest(mow, paint, 'a0'), 'different_project');
    assert.equal(await nest(inboxTask, paint, 'a0'), 'different_project');
    assert.equal(await nest(paint, crypto.randomUUID(), 'a0'), 'not_found');
    const child = { taskId: crypto.randomUUID(), projectId: second, parentId: paint, title: 'Buy brushes', position: 'a0' };
    assert.equal(await perform(OperationName.createTask, child), 'different_project');
  });

  it('refuses to put a task beneath a completed one, as when another device completed it first', async () => {
    const id = await project('Loft insulated');
    const measure = await addTask(id, 'Measure the loft', 'a0');
    const order = await addTask(id, 'Order the insulation', 'a1');
    assert.equal(await perform(OperationName.completeTask, { taskId: measure, completedAt: '2026-11-13T11:00:00.000Z' }), 'applied');

    assert.equal(await nest(order, measure, 'a0'), 'parent_completed');
    const child = { taskId: crypto.randomUUID(), projectId: id, parentId: measure, title: 'Check the joists', position: 'a0' };
    assert.equal(await perform(OperationName.createTask, child), 'parent_completed');
  });

  it('takes a task’s children with it to another project, and takes a moved child out of its parent', async () => {
    const office = await project('Office move');
    const home = await project('Home office');
    const desk = await addTask(office, 'Set up the desk', 'a0');
    const chair = await addTask(office, 'Order a chair', 'a0', desk);
    await addTask(office, 'Measure the room', 'a0', chair);
    const lamp = await addTask(office, 'Buy a lamp', 'a1', desk);
    const move = (taskId: string, projectId: string | null, position: string | null) => perform(OperationName.moveTask, { taskId, projectId, position });

    assert.equal(await move(desk, home, 'a0'), 'applied');
    assert.deepEqual(await outline(home), ['Set up the desk', '  Order a chair', '    Measure the room', '  Buy a lamp']);
    assert.deepEqual(await outline(office), []);

    assert.equal(await move(lamp, office, 'a0'), 'applied');
    assert.equal((await h.application.task(lamp))?.parentId, null);
    assert.deepEqual(await outline(home), ['Set up the desk', '  Order a chair', '    Measure the room']);

    // Out of any project, into the Inbox, and back: the children follow, still beneath it.
    assert.equal(await move(desk, null, null), 'applied');
    assert.deepEqual(await outline(home), []);
    assert.equal(await move(desk, office, 'a1'), 'applied');
    assert.deepEqual(await outline(office), ['Buy a lamp', 'Set up the desk', '  Order a chair', '    Measure the room']);
  });

  it('records nesting in the task’s history', async () => {
    const id = await project('Car serviced');
    const book = await addTask(id, 'Book the service', 'a0');
    const find = await addTask(id, 'Find the logbook', 'a1');

    await nest(find, book, 'a0');

    const last = (await h.application.history(find)).at(-1);
    assert.equal(last?.operation, OperationName.nestTask);
    assert.deepEqual(last?.changes[0]?.after, { parent_id: book, position: 'a0' });
  });
});
