import { useEffect, useRef, useState } from "react";
import { fetchCustomers, importCustomers } from "../api";

export default function CustomerLookup({ onSelect }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [searchError, setSearchError] = useState("");
  const [message, setMessage] = useState("");
  const [showResults, setShowResults] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef(null);
  const importingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      fetchCustomers({ q: query, page })
        .then(data => { if (!cancelled) { setResult(data); setSearchError(""); } })
        .catch(() => { if (!cancelled) { setResult(null); setSearchError("Customer directory is unavailable. You can still enter customer details below."); } })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, page, revision]);

  async function upload(files) {
    if (importingRef.current) return;
    if (files.length !== 1 || !files[0].name.toLowerCase().endsWith(".xlsx")) {
      setError("Choose one .xlsx Lab Address List workbook.");
      return;
    }
    if (files[0].size > 10 * 1024 * 1024) {
      setError("Workbook must be smaller than 10 MB.");
      return;
    }
    importingRef.current = true;
    setImporting(true);
    setError("");
    setMessage("");
    try {
      const imported = await importCustomers(files[0]);
      setMessage(`Directory updated: ${imported.imported.toLocaleString()} customers. ${imported.missing_addresses.toLocaleString()} have no address.${imported.duplicates_skipped ? ` ${imported.duplicates_skipped} duplicate rows skipped.` : ""}`);
      setPage(1);
      setRevision(value => value + 1);
    } catch (requestError) {
      setError(requestError?.response?.data?.error || "Import failed. Please retry or refresh the directory to check its status.");
    } finally {
      importingRef.current = false;
      setImporting(false);
    }
  }

  return (
    <div className="roc-customer-lookup">
      <label className="roc-field">
        <span className="roc-label">Look up customer</span>
        <input className="roc-input" type="search" value={query} placeholder="Name, activity code, sub custodian, or address"
          disabled={importing} onFocus={() => setShowResults(true)}
          onChange={event => { setQuery(event.target.value); setPage(1); setShowResults(true); }} />
      </label>
      <div className="roc-customer-actions">
        <button type="button" className="roc-btn-link" onClick={() => setShowResults(value => !value)} aria-expanded={showResults} aria-controls="roc-customer-results">
          {showResults ? "Hide customers" : "Browse customers"}
        </button>
        <button type="button" className="roc-btn-link" disabled={importing || loading} onClick={() => setRevision(value => value + 1)}>Refresh directory</button>
      </div>
      {searchError && <p className="roc-banner roc-banner-danger" role="alert">{searchError}</p>}
      {error && <p className="roc-banner roc-banner-danger" role="alert">{error}</p>}
      {message && <p className="roc-banner roc-banner-muted" role="status">{message}</p>}
      {showResults && <div id="roc-customer-results" aria-busy={loading || importing}>
        {loading ? <p className="roc-subtitle" role="status">Searching customers…</p> : result && <>
          <p className="roc-subtitle" role="status">{result.total.toLocaleString()} matches · Page {result.page} of {result.pages}</p>
          <div className="roc-customer-results">
            {result.customers.map(customer => <button type="button" className="roc-list-item" key={customer.id} disabled={importing}
              onClick={() => {
                onSelect(customer);
                setShowResults(false);
                setMessage(customer.address ? "Customer selected. You can edit the activity and address below." : "Customer selected without an address. Enter the address below before generating the report.");
              }}>
              <strong>{customer.lab_name || customer.activity || customer.sub_custodian}</strong>
              <span className="roc-subtitle">Activity code: {customer.activity || "—"} · Sub custodian: {customer.sub_custodian || "—"} · {customer.syscom || "No SYSCOM"}</span>
              <span className="roc-subtitle">{customer.address || "Address not provided"}</span>
            </button>)}
          </div>
          {result.total === 0 && <p className="roc-subtitle">No customers match. Try a shorter name or a customer code.</p>}
          <div className="roc-customer-actions">
            <button type="button" className="roc-btn" disabled={result.page <= 1 || importing} onClick={() => setPage(result.page - 1)}>Previous</button>
            <button type="button" className="roc-btn" disabled={result.page >= result.pages || importing} onClick={() => setPage(result.page + 1)}>Next</button>
          </div>
        </>}
      </div>}
      {result?.directory && <p className="roc-subtitle">{result.directory.row_count.toLocaleString()} customers · {result.directory.source_name}<br />Updated {new Date(result.directory.updated_at).toLocaleString()}</p>}
      <details className="roc-customer-import">
        <summary>Update customer directory</summary>
        <p className="roc-subtitle">Drop the latest Lab Address List (.xlsx) to replace the lookup directory. Saved reports keep their customer details.</p>
        <p className="roc-subtitle">Columns: Activity, Sub Custodian, Lab Name, Lab Address, SYSCOM.</p>
        <input ref={fileRef} type="file" accept=".xlsx" hidden disabled={importing}
          onChange={event => { upload(Array.from(event.target.files || [])); event.target.value = ""; }} />
        <button type="button" className={`roc-customer-drop${dragging ? " is-dragging" : ""}`} disabled={importing}
          onClick={() => fileRef.current?.click()}
          onDragOver={event => { event.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={event => { event.preventDefault(); setDragging(false); upload(Array.from(event.dataTransfer.files)); }}>
          {importing ? "Updating directory…" : "Drop Excel here or choose a file"}
        </button>
      </details>
    </div>
  );
}
