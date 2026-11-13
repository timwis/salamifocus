import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { captureRequest, createHarness, owner, renameRequest, type Harness } from './harness.ts';

let h: Harness;
before(async () => {
  h = await createHarness();
});
after(() => h.close());

describe('capturing text', () => {
  it('puts the capture in the Inbox under the id the client gave it', async () => {
    const capture = captureRequest('  Buy oat milk\n');
    const result = await h.application.execute(capture);

    assert.deepEqual(result, { opId: capture.opId, outcome: 'applied', duplicate: false });
    const inbox = await h.application.inbox();
    assert.deepEqual(
      inbox.find((entry) => entry.id === capture.taskId),
      { id: capture.taskId, title: 'Buy oat milk', createdAt: '2026-11-13T08:30:00.000Z' },
    );
  });

  it('lists the Inbox in the order things were captured', async () => {
    const later = captureRequest('Second', { capturedAt: '2026-11-13T10:00:00.000Z' });
    const earlier = captureRequest('First', { capturedAt: '2026-11-13T09:59:00.000Z' });
    await h.application.execute(later);
    await h.application.execute(earlier);

    const titles = (await h.application.inbox()).map((entry) => entry.title);
    assert.ok(titles.indexOf('First') < titles.indexOf('Second'));
  });

  it('refuses an empty capture and records why', async () => {
    const capture = captureRequest('   ');
    const result = await h.application.execute(capture);

    assert.equal(result.outcome, 'rejected');
    assert.equal(await h.application.task(capture.taskId), null);
    const record = await h.application.operation(capture.opId);
    assert.equal(record?.rejectionCode, 'empty_capture');
  });

  it('refuses a capture that reuses an existing id', async () => {
    const first = captureRequest('Original');
    await h.application.execute(first);
    const clash = captureRequest('Impostor', { taskId: first.taskId });

    const result = await h.application.execute(clash);

    assert.equal(result.outcome, 'rejected');
    assert.equal((await h.application.task(first.taskId))?.title, 'Original');
  });
});

describe('renaming a task', () => {
  it('changes the title but keeps the original capture text', async () => {
    const capture = captureRequest('call sam re: boiler??');
    await h.application.execute(capture);

    const rename = renameRequest(capture.taskId, 'Call Sam about the boiler service');
    assert.equal((await h.application.execute(rename)).outcome, 'applied');

    const task = await h.application.task(capture.taskId);
    assert.equal(task?.title, 'Call Sam about the boiler service');
    assert.equal(task?.capture?.text, 'call sam re: boiler??');
  });

  it('records each change with its before and after values, actor and operation', async () => {
    const capture = captureRequest('Book dentist');
    await h.application.execute(capture);
    h.clock.advance(60_000);
    const rename = renameRequest(capture.taskId, 'Book dentist check-up');
    await h.application.execute(rename);

    const history = await h.application.history(capture.taskId);

    assert.deepEqual(
      history.map(({ opId, operation, actor, source }) => ({ opId, operation, actor, source })),
      [
        { opId: capture.opId, operation: 'capture_text', actor: owner, source: 'test' },
        { opId: rename.opId, operation: 'rename_task', actor: owner, source: 'test' },
      ],
    );
    assert.deepEqual(
      history[0]?.changes.map(({ entity, kind, before }) => ({ entity, kind, before })),
      [
        { entity: 'task', kind: 'create', before: null },
        { entity: 'capture', kind: 'create', before: null },
      ],
    );
    assert.deepEqual(history[1]?.changes, [
      {
        entity: 'task',
        entityId: capture.taskId,
        kind: 'update',
        before: { title: 'Book dentist' },
        after: { title: 'Book dentist check-up' },
      },
    ]);
  });

  it('refuses a blank title, leaves the task alone, and keeps what was submitted', async () => {
    const capture = captureRequest('Water plants');
    await h.application.execute(capture);
    const rename = renameRequest(capture.taskId, '  ');

    const result = await h.application.execute(rename);

    assert.equal(result.outcome, 'rejected');
    assert.equal((await h.application.task(capture.taskId))?.title, 'Water plants');
    assert.equal((await h.application.history(capture.taskId)).length, 1);
    const record = await h.application.operation(rename.opId);
    assert.deepEqual(record?.submitted, { taskId: capture.taskId, title: '  ' });
  });

  it('refuses to rename a task that does not exist', async () => {
    const result = await h.application.execute(renameRequest(crypto.randomUUID(), 'Ghost'));
    assert.equal(result.outcome, 'rejected');
    assert.equal(result.outcome === 'rejected' && result.code, 'not_found');
  });

  it('records no change when the title is the same', async () => {
    const capture = captureRequest('Same');
    await h.application.execute(capture);

    assert.equal((await h.application.execute(renameRequest(capture.taskId, 'Same '))).outcome, 'applied');
    assert.equal((await h.application.history(capture.taskId)).length, 1);
  });
});

describe('retried operations', () => {
  it('apply once however many times they are delivered', async () => {
    const capture = captureRequest('Renew passport');
    await h.application.execute(capture);
    const rename = renameRequest(capture.taskId, 'Renew passport before March');

    const results = await Promise.all([1, 2, 3].map(() => h.application.execute(rename)));
    const retried = await h.application.execute(capture);

    assert.deepEqual(results.map((r) => r.duplicate).sort(), [false, true, true]);
    assert.ok(results.every((r) => r.outcome === 'applied'));
    assert.deepEqual(retried, { opId: capture.opId, outcome: 'applied', duplicate: true });
    assert.equal((await h.application.history(capture.taskId)).length, 2);
    assert.equal((await h.application.operation(rename.opId))?.deliveries, 3);
  });

  it('report the original rejection again rather than reapplying', async () => {
    const capture = captureRequest('Fix bike');
    await h.application.execute(capture);
    const rename = renameRequest(capture.taskId, '');
    await h.application.execute(rename);

    const retry = await h.application.execute(rename);

    assert.equal(retry.outcome, 'rejected');
    assert.equal(retry.duplicate, true);
  });
});

describe('unknown operations', () => {
  it('are recorded as rejected', async () => {
    const opId = crypto.randomUUID();
    const result = await h.application.execute({ opId, name: 'delete_everything', actor: owner, args: {} });
    assert.equal(result.outcome, 'rejected');
    assert.equal((await h.application.operation(opId))?.rejectionCode, 'unknown_operation');
  });
});
