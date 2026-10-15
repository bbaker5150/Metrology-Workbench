import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBolt, faTimes } from '@fortawesome/free-solid-svg-icons';
import { UNCERTAINTY_API } from '../../constants/constants';
import { buildAcShuntBudget } from '../../utils/acShuntBudget';
import { sharedAcShuntInstruments } from '../../utils/acShuntLibrary';
import './AcShuntImportTool.css';

const EMPTY_INSTRUMENTS = [];
export default function AcShuntImportTool({ onImport, instruments = EMPTY_INSTRUMENTS }) {
  const [open,setOpen] = useState(false);
  const [query,setQuery] = useState('');
  const [listing,setListing] = useState(null);
  const [selected,setSelected] = useState('');
  const [snapshot,setSnapshot] = useState(null);
  const [rocK,setRocK] = useState('2');
  const [selections,setSelections] = useState({});
  const [error,setError] = useState('');
  const [loading,setLoading] = useState(false);
  const [saving,setSaving] = useState(false);
  const dialog = useRef(null);
  const trigger = useRef(null);
  useEffect(() => {
    if (!open) return;
    dialog.current?.showModal();
    return () => { dialog.current?.close(); };
  },[open]);
  const close = () => { if (!saving) {setOpen(false); trigger.current?.focus();} };
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true); setError(''); setListing(null);
    const timer = setTimeout(() => {
      (async () => {
        try {
          let page = 1, pages = 1, sessions = [];
          do {
            const {data} = await axios.get(`${UNCERTAINTY_API}/ac-shunt/sessions/`, {params:{q:query,page,page_size:100},signal:controller.signal});
            if (controller.signal.aborted) return;
            sessions = [...sessions, ...(data.sessions || [])];
            setListing({...data,sessions});
            if (!data.available) {setError('The AC-shunt database is unavailable.');break;}
            pages = data.pages || 1;
            page++;
          } while(page <= pages);
        } catch(e) {
          if(!controller.signal.aborted) setError(e.response?.data?.detail || 'Could not load AC-shunt sessions.');
        } finally {if(!controller.signal.aborted)setLoading(false);}
      })();
    },200);
    return () => {clearTimeout(timer);controller.abort();};
  },[open,query]);
  useEffect(() => {
    if (!open || !selected) return;
    const controller = new AbortController();
    setSnapshot(null); setError('');
    axios.get(`${UNCERTAINTY_API}/ac-shunt/sessions/${selected}/`,{signal:controller.signal})
      .then(({data})=>{if(!controller.signal.aborted)setSnapshot(data);})
      .catch(e=>{if(!controller.signal.aborted)setError(e.response?.data?.detail || 'Could not read the selected session.');});
    return ()=>controller.abort();
  },[open,selected]);
  const preview = useMemo(()=>{
    if (!snapshot) return null;
    try {return buildAcShuntBudget(snapshot,{rocK:Number(rocK),instruments,selections});}
    catch(e){return {error:e.message};}
  },[snapshot,rocK,instruments,selections]);
  const generate = async () => {
    if (!preview?.session || saving) return;
    setSaving(true); setError('');
    try {await onImport(preview.session);setOpen(false);trigger.current?.focus();}
    catch(e){setError(e.message || 'The budget could not be saved.');}
    finally {setSaving(false);}
  };
  return <>
    <button ref={trigger} type="button" className={`app-chrome-meta-icon${open?' is-active':''}`}
      title="Import AC/DC shunt session" aria-label="Import AC/DC shunt session" aria-haspopup="dialog"
      aria-expanded={open} onClick={()=>setOpen(true)}><FontAwesomeIcon icon={faBolt}/></button>
    {open && <dialog ref={dialog} className="ac-shunt-import" aria-labelledby="ac-shunt-import-title"
      onCancel={e=>{e.preventDefault();close();}} onClick={e=>{if(e.target===dialog.current)close();}}>
      <header><div><span className="ac-shunt-import-eyebrow">AC / DC</span><h2 id="ac-shunt-import-title">Build from a shunt session</h2></div>
        <button aria-label="Close AC/DC importer" onClick={close} disabled={saving}><FontAwesomeIcon icon={faTimes}/></button></header>
      <p>Create a new Electrical budget from saved Type A results and measurement points. Matching shared instruments supply the specifications and error ranges.</p>
      <input autoFocus type="search" aria-label="Search AC-shunt sessions" placeholder="Search session, model or serial…" value={query}
        disabled={saving} onChange={e=>{setQuery(e.target.value);setSelected('');setSnapshot(null);}}/>
      <div className="ac-shunt-import-sessions" aria-label="AC-shunt sessions" aria-busy={loading}>
        {loading && <p role="status">Loading sessions…</p>}
        {!loading && listing?.sessions?.length===0 && <p>No matching sessions.</p>}
        {listing?.sessions?.map(s=><button key={s.id} disabled={saving} className={String(selected)===String(s.id)?'selected':''}
          onClick={()=>{setSnapshot(null);setSelections({});setSelected(s.id);}} aria-pressed={String(selected)===String(s.id)}>
          <strong>{s.session_name}</strong><span>{s.test_instrument_model || 'Unknown model'} · {s.test_instrument_serial || 'No serial'}<time>{s.created_at?.slice(0,10)}</time></span></button>)}
      </div>
      {selected && !snapshot && !error && <p role="status">Reading measurements and certificates…</p>}
      {preview?.session && <section className="ac-shunt-import-preview" aria-label="Import preview">
        <strong>{preview.topology} · {preview.session.testPoints.length} points · {preview.session.tmdes.length} reference instruments</strong>
        <p role="status">Risk calculated for {preview.riskCalculated} of {preview.session.testPoints.length} points (TUR, PFA and PFR).</p>
        <p>{preview.reusedInstruments} of {preview.bindings.length} instruments reused from the shared library.</p>
        <details open={preview.reusedInstruments < preview.bindings.length}><summary>Instrument matches</summary>
          {preview.bindings.map(role=><label key={role.key}>{role.label} · {role.serial || role.model || 'Unspecified'}
            <select aria-label={`Shared instrument for ${role.label}`} disabled={saving} value={role.definition?.id || ''}
              onChange={event=>setSelections(previous=>({...previous,[role.key]:event.target.value}))}>
              <option value="">Generate for initial setup</option>
              {sharedAcShuntInstruments(instruments).map(item=><option key={item.id} value={item.id}>{[item.manufacturer,item.model,item.description].filter(Boolean).join(' · ')}</option>)}
            </select></label>)}
          <p>Unmatched instruments are generated for initial setup. Share their completed definitions to reuse them on later imports.</p>
        </details>
        {preview.needsCertificates && <label>Certificate coverage factor (k)<input type="number" min="0.01" step="any" value={rocK} disabled={saving} onChange={e=>setRocK(e.target.value)}/></label>}
        <p>{preview.topology==='Y5020' ? 'Y5020 UUT: Navy ±100 ppm of reading, with no bias.' : 'A40B UUT: shared limits, or manufacturer current accuracy for initial setup.'} Budget errors follow the matching instrument ranges.</p>
        <details><summary>Specification conditions and source notes</summary><p>{preview.session.notes}</p></details>
        {!!preview.warnings.length && <details open><summary>{preview.warnings.length} items to review</summary><ul>{preview.warnings.map(w=><li key={w}>{w}</li>)}</ul></details>}
      </section>}
      {/* Keep the k control available after invalid input. */}
      {preview?.error && <label>Certificate coverage factor (k)<input aria-label="Certificate coverage factor (k)" type="number" value={rocK} onChange={e=>setRocK(e.target.value)}/></label>}
      {(error || preview?.error) && <p role="alert">{error || preview.error}</p>}
      <footer><span>Creates a new saved budget</span><button className="ac-shunt-import-create" disabled={!preview?.session || saving} onClick={generate}>{saving?'Saving…':'Create budget'}</button></footer>
    </dialog>}
  </>;
}
