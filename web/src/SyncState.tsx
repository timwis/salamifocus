import { useQuery, useStatus } from '@powersync/react';
import { useEffect, useState } from 'react';

export function SyncState() {
  const status = useStatus();
  const { data } = useQuery<{ pending: number }>('SELECT count(DISTINCT tx_id) AS pending FROM ps_crud');
  const pending = data[0]?.pending ?? 0;
  const persisted = usePersistedStorage();

  return (
    <p role="status" className="sync-state">
      <span data-connected={status.connected}>{status.connected ? 'Online' : 'Offline'}</span>
      {' · '}
      <span>{pending === 0 ? 'All changes uploaded' : `${pending} ${pending === 1 ? 'change' : 'changes'} waiting to upload`}</span>
      {persisted === false && <span className="warning"> · This browser may clear its copy of your data</span>}
    </p>
  );
}

function usePersistedStorage(): boolean | null {
  const [persisted, setPersisted] = useState<boolean | null>(null);
  useEffect(() => {
    void navigator.storage
      ?.persist?.()
      .then(setPersisted)
      .catch(() => setPersisted(false));
  }, []);
  return persisted;
}
