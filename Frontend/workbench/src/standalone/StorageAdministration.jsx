import React, { useEffect, useRef, useState } from 'react';

export default function StorageAdministration({ store }) {
  const [allowed, setAllowed] = useState(false);
  const [open, setOpen] = useState(false);
  const [records, setRecords] = useState([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const dialog = useRef(null);
  useEffect(() => { let active = true; store.canManageStorage?.().then(value => { if (active) setAllowed(value); }).catch(() => {}); return () => { active = false; }; }, [store]);
  useEffect(() => {
    if (!open) return;
    dialog.current?.showModal();
    setBusy(true); setMessage('');
    store.storageInventory().then(setRecords).catch(error => setMessage(error.message)).finally(() => setBusy(false));
  }, [open, store]);
  const organize = async () => {
    setBusy(true); setMessage('');
    try { setRecords(await store.organizeStorage()); setMessage('Storage organized. Saved data and permissions are preserved. Reload any other open copies of the app.'); }
    catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  };
  if (!allowed) return null;
  return <>
    <button className="sp-storage-launch" onClick={() => setOpen(true)}>Storage administration</button>
    {open && <dialog ref={dialog} className="sp-storage-admin" aria-labelledby="sp-storage-heading" onClose={() => setOpen(false)} onCancel={event => { if (busy) event.preventDefault(); }}>
      <header><h2 id="sp-storage-heading">Application storage</h2><button aria-label="Close storage administration" disabled={busy} onClick={() => dialog.current.close()}>×</button></header>
      <h3>Uncertalytics{store.prefix !== 'Uncertainty' ? ` · ${store.prefix}` : ''}</h3>
      <p>Manage this application's lists and document library. Hidden storage remains available through these links.</p>
      <table><thead><tr><th>Storage</th><th>Purpose</th><th>Visibility</th><th>Manage</th></tr></thead>
        <tbody>{records.map(record => <tr key={record.key}>
          <td>{record.displayTitle}<small>{record.Title !== record.displayTitle ? `Current name: ${record.Title}` : record.template === 101 ? 'Document library' : 'List'}</small></td>
          <td>{record.description}</td><td>{record.Hidden ? 'Hidden' : 'Visible'}</td>
          <td><a href={`${store.webUrl}/_layouts/15/listedit.aspx?List=${encodeURIComponent(record.Id)}`} target="_blank" rel="noreferrer">Settings</a></td>
        </tr>)}</tbody>
      </table>
      <p>Organizing updates names and descriptions and hides these containers from normal navigation. It preserves their contents, URLs, identifiers, and permissions.</p>
      <p>Hiding storage does not restrict access. Review access in each container's SharePoint settings.</p>
      {message && <p role="status">{message}</p>}
      <footer><button disabled={busy || records.length !== 4} onClick={organize}>{busy ? 'Working…' : 'Organize storage'}</button></footer>
    </dialog>}
  </>;
}
