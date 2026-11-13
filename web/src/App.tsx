import { PowerSyncContext } from '@powersync/react';
import { useEffect, useState, type FormEvent } from 'react';
import { connect, db } from './powersync.ts';
import { signIn, useSessionToken } from './session.ts';
import { Shell } from './Shell.tsx';

export function App() {
  const token = useSessionToken();

  useEffect(() => {
    if (!token) return;
    void connect();
    return () => void db.disconnect();
  }, [token]);

  if (!token) return <SignIn />;
  return (
    <PowerSyncContext.Provider value={db}>
      <Shell />
    </PowerSyncContext.Provider>
  );
}

function SignIn() {
  const [password, setPassword] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setProblem(await signIn(password));
    setBusy(false);
  }

  return (
    <form className="sign-in" onSubmit={submit}>
      <h1>salamifocus</h1>
      <label>
        Password
        <input type="password" value={password} autoFocus onChange={(e) => setPassword(e.target.value)} />
      </label>
      <button type="submit" disabled={busy}>
        Sign in
      </button>
      {problem && <p role="alert">{problem}</p>}
    </form>
  );
}
