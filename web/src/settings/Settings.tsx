import { useQuery } from '@powersync/react';
import { FolderScope, folderScopes, settingsId, tagPathSeparator } from '@salamifocus/domain';
import { useEffect, useRef } from 'react';
import { useFolders } from '../projects/data.tsx';
import { designateFolder } from '../writes.ts';

interface SettingsRow {
  personal_folder_id: string | null;
  work_folder_id: string | null;
}

/** The folder designated for each Actionable perspective, or null until the settings have synced. */
export function useDesignatedFolders(): Record<FolderScope, string | null> | null {
  const { data } = useQuery<SettingsRow>('SELECT personal_folder_id, work_folder_id FROM settings WHERE id = ?', [settingsId]);
  const [row] = data;
  return row ? { personal: row.personal_folder_id, work: row.work_folder_id } : null;
}

export const scopeNames: Record<FolderScope, string> = { [FolderScope.personal]: 'Personal', [FolderScope.work]: 'Work' };

/**
 * Chooses the folder each Actionable perspective shows. A choice is saved as
 * soon as it is made; Escape or Done closes the dialog and focus goes back
 * where it was.
 */
export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const folders = useFolders();
  const designated = useDesignatedFolders();

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);

  // The choices are disabled until the settings have loaded, so focus goes to the first once they have.
  const loaded = designated !== null;
  useEffect(() => {
    if (loaded) dialog.current?.querySelector('select')?.focus();
  }, [loaded]);

  return (
    <dialog
      ref={dialog}
      className="settings"
      aria-labelledby="settings-heading"
      onClose={onClose}
      // Keys pressed here (digits choosing an option, say) are not commands for the rest of the app.
      onKeyDown={(event) => event.stopPropagation()}
    >
      <h2 id="settings-heading">Settings</h2>
      {folderScopes.map((scope) => {
        const chosen = designated?.[scope] ?? null;
        return (
          <label key={scope}>
            {scopeNames[scope]} folder
            <select
              value={chosen ?? ''}
              disabled={designated === null}
              onChange={(event) => void designateFolder(scope, event.target.value || null)}
            >
              <option value="">None</option>
              {folders.map(({ folder, path }) => (
                <option key={folder.id} value={folder.id}>
                  {path.join(tagPathSeparator)}
                </option>
              ))}
              {/* The chosen folder may not have synced yet; without an option for it, the select would claim None. */}
              {chosen !== null && !folders.some(({ folder }) => folder.id === chosen) && <option value={chosen}>Loading…</option>}
            </select>
          </label>
        );
      })}
      <p className="hint">Actionable — Personal and Actionable — Work show the available tasks in these folders and every folder and project inside them.</p>
      <button type="button" onClick={() => dialog.current?.close()}>
        Done
      </button>
    </dialog>
  );
}
