import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faDatabase, faFolderTree, faTimes } from '@fortawesome/free-solid-svg-icons';
import React, { useEffect, useRef, useState } from 'react';

export default function StorageAdministration({ store }) {
  const [allowed, setAllowed] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [open, setOpen] = useState(false);
  const [records, setRecords] = useState([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const dialog = useRef(null);
  useEffect(() => { let active = true; store.canManageStorage?.().then(value => { if (active) setAllowed(value); }).catch(() => {}); return () => { active = false; }; }, [store]);
  useEffect(() => {
    const reveal = event => {
      if (!allowed || event.repeat || !event.ctrlKey || !event.shiftKey || event.altKey || event.metaKey || event.key.toLowerCase() !== 't') return;
      event.preventDefault();
      setRevealed(true);
    };
    window.addEventListener('keydown', reveal);
    return () => window.removeEventListener('keydown', reveal);
  }, [allowed]);
  useEffect(() => {
    if (!open) return;
    const fit = () => {
      let height = window.innerHeight;
      try { if (window.parent !== window) height = Math.min(height, window.parent.innerHeight - Math.max(0, window.frameElement?.getBoundingClientRect().top || 0)); } catch { /* Cross-origin hosts retain the frame's viewport. */ }
      dialog.current?.style.setProperty('--storage-dialog-height', `${Math.max(180, height - 48)}px`);
    };
    fit();
    window.addEventListener('resize', fit);
    dialog.current?.showModal();
    setBusy(true); setMessage('');
    store.storageInventory().then(setRecords).catch(error => setMessage(error.message)).finally(() => setBusy(false));
    return () => window.removeEventListener('resize', fit);
  }, [open, store]);
  const organize = async () => {
    setBusy(true); setMessage('');
    try { setRecords(await store.organizeStorage()); setMessage('Storage organized. Saved data and permissions are preserved. Reload any other open copies of the app.'); }
    catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  };
  if (!allowed || !revealed) return null;
  return <>
    <button type="button" className="app-chrome-meta-icon" title="Storage administration" aria-label="Storage administration" onClick={() => setOpen(true)}><FontAwesomeIcon icon={faDatabase} /></button>
    {open && <dialog ref={dialog} className="sp-storage-admin" aria-labelledby="sp-storage-heading" onClose={() => setOpen(false)} onCancel={event => { if (busy) event.preventDefault(); }}>
      <header><h2 id="sp-storage-heading">Application storage</h2><button type="button" className="app-chrome-meta-icon" title={busy ? 'Working…' : 'Organize storage'} aria-label="Organize storage" disabled={busy || records.length !== 4} onClick={organize}><FontAwesomeIcon icon={faFolderTree} /></button><button type="button" className="app-chrome-meta-icon" title="Close storage administration" aria-label="Close storage administration" disabled={busy} onClick={() => dialog.current.close()}><FontAwesomeIcon icon={faTimes} /></button></header>
      <h3>Uncertalytics{store.prefix !== 'Uncertainty' ? ` · ${store.prefix}` : ''}</h3>
      <p>Manage this application's lists and document library. Organize storage to make all four containers visible in Site contents.</p>
      <table><thead><tr><th>Storage</th><th>Purpose</th><th>Visibility</th><th>Manage</th></tr></thead>
        <tbody>{records.map(record => <tr key={record.key}>
          <td>{record.displayTitle}<small>{record.Title !== record.displayTitle ? `Current name: ${record.Title}` : record.template === 101 ? 'Document library' : 'List'}</small></td>
          <td>{record.description}</td><td>{record.Hidden ? 'Hidden' : 'Visible'}</td>
          <td><a href={`${store.webUrl}/_layouts/15/listedit.aspx?List=${encodeURIComponent(record.Id)}`} target="_blank" rel="noreferrer">Settings</a></td>
        </tr>)}</tbody>
      </table>
      <p>Organizing updates names and descriptions and makes these containers visible in Site contents without adding sidebar links. It preserves their contents, URLs, identifiers, and permissions.</p>
      <p>Visibility does not grant access. Review access in each container's SharePoint settings.</p>
      {message && <p role="status">{message}</p>}
    </dialog>}
  </>;
}
