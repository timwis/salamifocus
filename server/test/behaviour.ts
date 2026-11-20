import { readdirSync, readFileSync } from 'node:fs';
import { settingsId, type Unavailable, type Visibility } from '@salamifocus/domain';
import type { Sql } from '../src/db.ts';

// Loads the client-neutral behaviour fixtures (see fixtures/README.md) and
// seeds their records. Shared by the server tests and the web end-to-end tests.

type Row = Record<string, unknown> & { id: string };

export interface ExpectedPerspective {
  perspective: 'projects' | 'tags' | 'flagged' | 'personal' | 'work';
  /** Flagged has no sidebar, so nothing to select. */
  selection: string[];
  /** Absent means the perspective's default: Remaining, or Available for Flagged. */
  visibility?: Visibility;
  groups: { id: string; tasks: { id: string; depth: number }[] }[];
}

export interface Example {
  name: string;
  clock: string;
  records: Partial<Record<(typeof tables)[number], Row[]>> & { settings?: Record<string, string | null> };
  expect: { unavailable: Record<string, Unavailable[]>; perspectives: ExpectedPerspective[] };
}

export interface Scenario {
  scenario: string;
  file: string;
  examples: Example[];
}

// Parents before children, so references resolve as rows go in.
const tables = ['folders', 'projects', 'tags', 'tasks', 'task_tags'] as const;
const selfReferencing: Partial<Record<(typeof tables)[number], string>> = { folders: 'parent_id', tags: 'parent_id', tasks: 'parent_id' };

const directory = new URL('../../fixtures/', import.meta.url);

export function loadScenarios(): Scenario[] {
  return readdirSync(directory)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => ({ ...(JSON.parse(readFileSync(new URL(file, directory), 'utf8')) as Omit<Scenario, 'file'>), file }));
}

/** Fresh UUIDs for an example's short ids, both ways round. */
export class Ids {
  readonly #uuids = new Map<string, string>();
  readonly #names = new Map<string, string>();

  uuid(name: string): string {
    let uuid = this.#uuids.get(name);
    if (!uuid) {
      uuid = crypto.randomUUID();
      this.#uuids.set(name, uuid);
      this.#names.set(uuid, name);
    }
    return uuid;
  }

  name(uuid: string): string | undefined {
    return this.#names.get(uuid);
  }

  get all(): string[] {
    return [...this.#uuids.values()];
  }
}

/** Writes an example's records, each with a fresh id, and returns the ids given. */
export async function seed(sql: Sql, example: Example): Promise<Ids> {
  const ids = new Ids();
  const resolve = (row: Row) =>
    Object.fromEntries(
      Object.entries(row).map(([column, value]) => [column, (column === 'id' || column.endsWith('_id')) && typeof value === 'string' ? ids.uuid(value) : value]),
    );
  await sql.begin(async (tx) => {
    for (const table of tables) {
      const rows = (example.records[table] ?? []).map(resolve);
      const parent = selfReferencing[table];
      for (const row of rows) {
        // A row's parent may come later in the list, so self-references are filled in afterwards.
        const values = parent ? { ...row, [parent]: null } : row;
        await tx`INSERT INTO ${tx(table)} ${tx(values as Record<string, never>)}`;
      }
      if (parent) {
        for (const row of rows) if (row[parent]) await tx`UPDATE ${tx(table)} SET ${tx(parent)} = ${row[parent] as string} WHERE id = ${row.id as string}`;
      }
    }
    // Settings are a single row that already exists, so an example's settings change it.
    if (example.records.settings) await tx`UPDATE settings SET ${tx(resolve(example.records.settings as Row) as Record<string, never>)} WHERE id = ${settingsId}`;
  });
  return ids;
}

/** Deletes what `seed` wrote, for runs that share one database with other tests. */
export async function unseed(sql: Sql, ids: Ids): Promise<void> {
  const uuids = ids.all;
  await sql.begin(async (tx) => {
    await tx`UPDATE settings SET personal_folder_id = NULL, work_folder_id = NULL WHERE personal_folder_id IN ${tx(uuids)} OR work_folder_id IN ${tx(uuids)}`;
    for (const table of [...tables].reverse()) await tx`DELETE FROM ${tx(table)} WHERE id IN ${tx(uuids)}`;
  });
}
