import type { TransactionSql } from '../db.ts';
import { Rejection } from './rejection.ts';

const tables = {
  task: 'tasks',
  capture: 'captures',
  folder: 'folders',
  project: 'projects',
  tag: 'tags',
  task_tag: 'task_tags',
} as const;

export type Entity = keyof typeof tables;

type Row = Record<string, string | number | boolean | null>;

interface PendingChange {
  entity: Entity;
  entityId: string;
  kind: 'create' | 'update' | 'delete';
  before: Row | null;
  after: Row | null;
}

/**
 * The only way operations change state. Each create, update or delete is written
 * and its before and after values are collected, so no mutation can happen
 * without a change record.
 */
export class Mutations {
  readonly now: string;
  readonly #tx: TransactionSql;
  readonly #changes: PendingChange[] = [];

  constructor(tx: TransactionSql, now: string) {
    this.#tx = tx;
    this.now = now;
  }

  get changes(): readonly PendingChange[] {
    return this.#changes;
  }

  async exists(entity: Entity, id: string): Promise<boolean> {
    const rows = await this.#tx`SELECT 1 FROM ${this.#tx(tables[entity])} WHERE id = ${id}`;
    return rows.length > 0;
  }

  /** Every row of an entity. Meant for small tables such as folders. */
  async list(entity: Entity): Promise<Row[]> {
    return this.#tx<Row[]>`SELECT * FROM ${this.#tx(tables[entity])}`;
  }

  /** The current row, locked until the operation finishes so concurrent operations see each other's effects. */
  async read(entity: Entity, id: string): Promise<Row | null> {
    const [row] = await this.#tx<Row[]>`SELECT * FROM ${this.#tx(tables[entity])} WHERE id = ${id} FOR UPDATE`;
    return row ?? null;
  }

  /** The id of the link putting a tag on a task, or null if the task does not have it. */
  async taskTagId(taskId: string, tagId: string): Promise<string | null> {
    const [row] = await this.#tx<{ id: string }[]>`SELECT id FROM task_tags WHERE task_id = ${taskId} AND tag_id = ${tagId}`;
    return row?.id ?? null;
  }

  /** Serialises operations that must see each other's effects, such as moves that could form a cycle. */
  async lock(name: string): Promise<void> {
    await this.#tx`SELECT pg_advisory_xact_lock(hashtextextended(${`lock:${name}`}, 0))`;
  }

  async create(entity: Entity, id: string, values: Row): Promise<void> {
    const row = { id, ...values };
    await this.#tx`INSERT INTO ${this.#tx(tables[entity])} ${this.#tx(row)}`;
    this.#changes.push({ entity, entityId: id, kind: 'create', before: null, after: values });
  }

  async update(entity: Entity, id: string, patch: Row): Promise<void> {
    const columns = Object.keys(patch);
    const [current] = await this.#tx<Row[]>`
      SELECT ${this.#tx(columns)} FROM ${this.#tx(tables[entity])} WHERE id = ${id} FOR UPDATE`;
    if (!current) throw new Rejection('not_found', `That ${entity} no longer exists.`);

    const changed = columns.filter((column) => current[column] !== patch[column]);
    if (changed.length === 0) return;

    const before: Row = {};
    const after: Row = {};
    for (const column of changed) {
      before[column] = current[column] ?? null;
      after[column] = patch[column] ?? null;
    }
    await this.#tx`UPDATE ${this.#tx(tables[entity])} SET ${this.#tx(after)} WHERE id = ${id}`;
    this.#changes.push({ entity, entityId: id, kind: 'update', before, after });
  }

  /** Deletes a row if it is there, keeping what it held. Only link rows (a tag on a task) are deleted. */
  async delete(entity: Entity, id: string): Promise<void> {
    const [current] = await this.#tx<Row[]>`DELETE FROM ${this.#tx(tables[entity])} WHERE id = ${id} RETURNING *`;
    if (!current) return;
    const { id: _id, ...before } = current;
    this.#changes.push({ entity, entityId: id, kind: 'delete', before, after: null });
  }
}
