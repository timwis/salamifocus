import { operationMetadata, OperationName } from '@salamifocus/domain';
import { password, serverUrl } from './env.ts';

/**
 * Another signed-in client, such as the phone, talking to the real app server
 * exactly as a PowerSync upload queue does.
 */
export class SimulatedDevice {
  private readonly token: string;

  private constructor(token: string) {
    this.token = token;
  }

  static async signIn(client = 'android-simulated'): Promise<SimulatedDevice> {
    const response = await fetch(`${serverUrl}/api/auth/sign-in`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password, client }),
    });
    if (!response.ok) throw new Error(`Sign-in failed: ${response.status}`);
    return new SimulatedDevice(((await response.json()) as { token: string }).token);
  }

  async capture(text: string): Promise<{ taskId: string }> {
    const taskId = crypto.randomUUID();
    const metadata = operationMetadata(OperationName.captureText);
    const capturedAt = new Date().toISOString();
    await this.upload([
      { op: 'PUT', table: 'tasks', id: taskId, data: { title: text.trim(), created_at: capturedAt }, metadata },
      { op: 'PUT', table: 'captures', id: crypto.randomUUID(), data: { task_id: taskId, text, captured_at: capturedAt }, metadata },
    ]);
    return { taskId };
  }

  async rename(taskId: string, title: string): Promise<void> {
    await this.upload([
      { op: 'PATCH', table: 'tasks', id: taskId, data: { title }, metadata: operationMetadata(OperationName.renameTask) },
    ]);
  }

  async createFolder(name: string, options: { parentId?: string; position?: string } = {}): Promise<{ folderId: string }> {
    const folderId = crypto.randomUUID();
    await this.upload([
      {
        op: 'PUT',
        table: 'folders',
        id: folderId,
        data: { name, parent_id: options.parentId ?? null, position: options.position ?? 'a0' },
        metadata: operationMetadata(OperationName.createFolder),
      },
    ]);
    return { folderId };
  }

  async createProject(
    name: string,
    options: { folderId?: string; position?: string; kind?: 'project' | 'single_actions' } = {},
  ): Promise<{ projectId: string }> {
    const projectId = crypto.randomUUID();
    await this.upload([
      {
        op: 'PUT',
        table: 'projects',
        id: projectId,
        data: { name, kind: options.kind ?? 'project', folder_id: options.folderId ?? null, position: options.position ?? 'a0' },
        metadata: operationMetadata(OperationName.createProject),
      },
    ]);
    return { projectId };
  }

  async createTask(projectId: string, title: string, position = 'a0'): Promise<{ taskId: string }> {
    const taskId = crypto.randomUUID();
    await this.upload([
      {
        op: 'PUT',
        table: 'tasks',
        id: taskId,
        data: { title, project_id: projectId, position, created_at: new Date().toISOString() },
        metadata: operationMetadata(OperationName.createTask),
      },
    ]);
    return { taskId };
  }

  async complete(taskId: string): Promise<void> {
    await this.upload([
      {
        op: 'PATCH',
        table: 'tasks',
        id: taskId,
        data: { completed_at: new Date().toISOString() },
        metadata: operationMetadata(OperationName.completeTask),
      },
    ]);
  }

  async createTag(name: string, options: { parentId?: string; position?: string } = {}): Promise<{ tagId: string }> {
    const tagId = crypto.randomUUID();
    await this.upload([
      {
        op: 'PUT',
        table: 'tags',
        id: tagId,
        data: { name, parent_id: options.parentId ?? null, position: options.position ?? 'a0' },
        metadata: operationMetadata(OperationName.createTag),
      },
    ]);
    return { tagId };
  }

  private async upload(entries: unknown[]): Promise<void> {
    const response = await fetch(`${serverUrl}/api/sync/upload`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token}` },
      body: JSON.stringify({ entries }),
    });
    const body = (await response.json()) as { results: { outcome: string }[] };
    if (!response.ok || body.results.some((r) => r.outcome !== 'applied')) {
      throw new Error(`Upload was not applied: ${JSON.stringify(body)}`);
    }
  }
}
