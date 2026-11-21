import { useQuery } from '@powersync/react';
import { FolderScope, folderScopes, settingsId, tagPathSeparator } from '@salamifocus/domain';
import { useEffect, useRef } from 'react';
import { useFolders } from '../projects/data.tsx';
import { useTags } from '../tags/data.tsx';
import { designateFolder, designatePeopleTag } from '../writes.ts';

interface SettingsRow {
  personal_folder_id: string | null;
  work_folder_id: string | null;
  people_tag_id: string | null;
}

export interface Settings {
  /** The folder designated for each Actionable perspective. */
  folders: Record<FolderScope, string | null>;
  /** The tag whose descendants are people, for Agendas. */
  peopleTagId: string | null;
}

/** The user's settings, or null until they have synced. */
export function useSettings(): Settings | null {
  const { data } = useQuery<SettingsRow>('SELECT personal_folder_id, work_folder_id, people_tag_id FROM settings WHERE id = ?', [settingsId]);
  const [row] = data;
  return row ? { folders: { personal: row.personal_folder_id, work: row.work_folder_id }, peopleTagId: row.people_tag_id } : null;
}

/** The folder designated for each Actionable perspective, or null until the settings have synced. */
export function useDesignatedFolders(): Record<FolderScope, string | null> | null {
  return useSettings()?.folders ?? null;
}

export const scopeNames: Record<FolderScope, string> = { [FolderScope.personal]: 'Personal', [FolderScope.work]: 'Work' };

/**
 * Chooses the folder each Actionable perspective shows, and the People tag
 * for Agendas. A choice is saved as soon as it is made; Escape or Done closes
 * the dialog and focus goes back where it was.
 */
export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const folders = useFolders();
  const tags = useTags().placed;
  const settings = useSettings();

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);

  // The choices are disabled until the settings have loaded, so focus goes to the first once they have.
  const loaded = settings !== null;
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
      {folderScopes.map((scope) => (
        <Choice
          key={scope}
          label={`${scopeNames[scope]} folder`}
          chosen={settings?.folders[scope] ?? null}
          loaded={loaded}
          options={folders.map(({ folder, path }) => ({ id: folder.id, name: path.join(tagPathSeparator) }))}
          choose={(folderId) => designateFolder(scope, folderId)}
        />
      ))}
      <p className="hint">Actionable — Personal and Actionable — Work show the available tasks in these folders and every folder and project inside them.</p>
      <Choice
        label="People tag"
        chosen={settings?.peopleTagId ?? null}
        loaded={loaded}
        options={tags.map(({ tag, path }) => ({ id: tag.id, name: path.join(tagPathSeparator) }))}
        choose={designatePeopleTag}
      />
      <p className="hint">Each tag beneath the People tag is a person. Agendas shows their tasks, grouped by person.</p>
      <button type="button" onClick={() => dialog.current?.close()}>
        Done
      </button>
    </dialog>
  );
}

function Choice({
  label,
  chosen,
  loaded,
  options,
  choose,
}: {
  label: string;
  chosen: string | null;
  loaded: boolean;
  options: { id: string; name: string }[];
  choose: (id: string | null) => Promise<void>;
}) {
  return (
    <label>
      {label}
      <select value={chosen ?? ''} disabled={!loaded} onChange={(event) => void choose(event.target.value || null)}>
        <option value="">None</option>
        {options.map(({ id, name }) => (
          <option key={id} value={id}>
            {name}
          </option>
        ))}
        {/* The chosen one may not have synced yet; without an option for it, the select would claim None. */}
        {chosen !== null && !options.some(({ id }) => id === chosen) && <option value={chosen}>Loading…</option>}
      </select>
    </label>
  );
}
