import { useState } from 'react'
import SavedRecords from './SavedRecords'
import ExcelImport from './ExcelImport'
import ManualInputForm from './ManualInputForm'
import AcShuntImport from './AcShuntImport'

const TABS = [
  { id: 'saved', label: 'Saved Records' },
  { id: 'excel', label: 'Excel Import' },
  { id: 'manual', label: 'Manual Input' },
  { id: 'ac-shunt', label: 'AC-Shunt Pull' },
]

export default function DataSourcePanel({ onDataLoaded, currentData, recordsRevision }) {
  const [sourceTab, setSourceTab] = useState('saved')

  return (
    <div>
      <p className="roc-eyebrow" style={{ padding: '12px 12px 0 12px' }}>Data Source</p>
      <div className="roc-sourcetabs">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setSourceTab(t.id)}
            className={`roc-sourcetab${sourceTab === t.id ? ' is-active' : ''}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {sourceTab === 'saved'    && <SavedRecords onDataLoaded={onDataLoaded} recordsRevision={recordsRevision} />}
      {sourceTab === 'excel'    && <ExcelImport onDataLoaded={onDataLoaded} />}
      {sourceTab === 'manual'   && <ManualInputForm data={currentData} onChange={onDataLoaded} />}
      {sourceTab === 'ac-shunt' && <AcShuntImport onDataLoaded={onDataLoaded} />}
    </div>
  )
}
