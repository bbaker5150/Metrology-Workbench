import React, { useCallback, useEffect, useState } from 'react';
import { listTitle, CONTAINERS } from './sharepoint/spStore';

/**
 * Blocks the tool until its SharePoint containers exist.
 *
 * Without this the app mounts, every request 404s, and the user sees an empty
 * session list with no indication that anything is wrong — which looks
 * identical to "no sessions yet". Checking up front turns a silent misconfig
 * into a single actionable button.
 */
export default function StorageGate({ store, children }) {
  const [state, setState] = useState({ phase: 'checking' });

  const check = useCallback(async () => {
    setState({ phase: 'checking' });
    try {
      // SharePoint is the login provider for this static build. Resolve the
      // current Microsoft 365 user before mounting any session data so an
      // unauthenticated page can never fall through as an apparently empty
      // workspace.
      await store.currentUser();
      const missing = [];
      for (const container of CONTAINERS) {
        const title = listTitle(store.prefix, container.key);
        // eslint-disable-next-line no-await-in-loop
        if (!(await store.listExists(title))) missing.push(title);
      }
      setState(missing.length ? { phase: 'needs-setup', missing } : { phase: 'ready' });
    } catch (error) {
      setState({ phase: 'error', message: error.message });
    }
  }, [store]);

  useEffect(() => {
    check();
  }, [check]);

  const provision = useCallback(async () => {
    setState({ phase: 'provisioning' });
    try {
      const result = await store.provision();
      setState({ phase: 'ready', justProvisioned: !result.alreadyProvisioned });
    } catch (error) {
      setState({ phase: 'error', message: error.message });
    }
  }, [store]);

  if (state.phase === 'ready') return children;

  return (
    <div className="sp-gate" role="status" aria-live="polite">
      <div className="sp-gate-card">
        <h1>Uncertainty Budget</h1>

        {state.phase === 'checking' && <p>Checking SharePoint storage…</p>}

        {state.phase === 'provisioning' && <p>Creating lists…</p>}

        {state.phase === 'needs-setup' && (
          <>
            <p>
              This site is not set up yet. The tool needs {state.missing.length} SharePoint
              {state.missing.length === 1 ? ' container' : ' containers'} to store sessions,
              instruments, and equations:
            </p>
            <ul>
              {state.missing.map((title) => (
                <li key={title}>
                  <code>{title}</code>
                </li>
              ))}
            </ul>
            <button type="button" className="sp-gate-button" onClick={provision}>
              Create them now
            </button>
            <p className="sp-gate-note">
              You need Edit or Full Control on this site. Nothing existing is modified — setup only
              adds what is missing, and is safe to run again.
            </p>
          </>
        )}

        {state.phase === 'error' && (
          <>
            <p className="sp-gate-error">{state.message}</p>
            <button type="button" className="sp-gate-button" onClick={check}>
              Try again
            </button>
          </>
        )}
      </div>
    </div>
  );
}
