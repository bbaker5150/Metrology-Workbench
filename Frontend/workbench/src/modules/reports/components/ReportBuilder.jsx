import { useState } from 'react'
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor,
  useSensor, useSensors, DragOverlay,
} from '@dnd-kit/core'
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates,
  useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

const SECTION_ICONS = {
  letterhead: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
    </svg>
  ),
  instrument: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/><path d="M19.07 4.93l-1.41 1.41M4.93 4.93l1.41 1.41M4.93 19.07l1.41-1.41M19.07 19.07l-1.41-1.41M12 2v2M12 20v2M2 12h2M20 12h2"/>
    </svg>
  ),
  environment: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"/>
    </svg>
  ),
  footer: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
    </svg>
  ),
  tables: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
    </svg>
  ),
  inline_results: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
    </svg>
  ),
  statements: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  ),
  signatures: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
    </svg>
  ),
}

SECTION_ICONS.title = SECTION_ICONS.letterhead
SECTION_ICONS.customer = SECTION_ICONS.signatures
SECTION_ICONS.statements_rest = SECTION_ICONS.statements

const DragHandle = (props) => (
  <div
    {...props}
    style={{ cursor: 'grab', color: 'var(--text-color-subtle)', userSelect: 'none', padding: '0 4px' }}
    title="Drag to reorder"
  >
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="9" cy="5" r="1.5"/><circle cx="15" cy="5" r="1.5"/>
      <circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/>
      <circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="19" r="1.5"/>
    </svg>
  </div>
)

function SectionRow({ section, index, onToggle, isDragOverlay = false }) {
  return (
    <div
      className="roc-list-item"
      style={{
        display: 'flex', alignItems: 'center', gap: 10, cursor: 'default',
        ...(isDragOverlay
          ? { borderColor: 'var(--primary-color)', backgroundColor: 'var(--primary-color-soft)', boxShadow: 'var(--shadow-lg)' }
          : section.visible ? {} : { opacity: 0.5 }),
      }}
    >
      <span style={{ width: 18, fontSize: '0.625rem', fontFamily: "'Roboto Mono', monospace", color: 'var(--text-color-subtle)' }}>
        {String(index + 1).padStart(2, '0')}
      </span>

      <span style={{ color: section.visible ? 'var(--primary-color)' : 'var(--text-color-subtle)' }}>
        {SECTION_ICONS[section.id]}
      </span>

      <span style={{
        flex: 1, fontSize: '0.8125rem', fontWeight: 500,
        color: section.visible ? 'var(--text-color)' : 'var(--text-color-muted)',
        textDecoration: section.visible ? 'none' : 'line-through',
      }}>
        {section.label}
      </span>

      {!isDragOverlay && (
        <button
          onClick={() => onToggle(section.id)}
          title={section.visible ? 'Hide section' : 'Show section'}
          style={{
            position: 'relative', width: 34, height: 19, borderRadius: 999, border: 'none', cursor: 'pointer',
            flexShrink: 0, overflow: 'hidden', padding: 0,
            backgroundColor: section.visible ? 'var(--primary-color)' : 'var(--border-color-strong)',
            transition: 'background-color 0.15s ease',
          }}
        >
          <span style={{
            position: 'absolute', top: 2, left: section.visible ? 17 : 2, width: 15, height: 15, borderRadius: '50%',
            backgroundColor: '#ffffff', boxShadow: '0 1px 2px rgba(0,0,0,0.3)', transition: 'left 0.15s ease',
          }} />
        </button>
      )}
    </div>
  )
}

function SortableItem({ section, index, onToggle }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: section.id })

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0 : 1,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <DragHandle {...attributes} {...listeners} />
        <div style={{ flex: 1 }}>
          <SectionRow section={section} index={index} onToggle={onToggle} />
        </div>
      </div>
    </div>
  )
}

export default function ReportBuilder({ sections, onChange }) {
  const [activeId, setActiveId] = useState(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleDragStart  = ({ active }) => setActiveId(active.id)
  const handleDragCancel = () => setActiveId(null)
  const handleDragEnd    = ({ active, over }) => {
    setActiveId(null)
    if (over && active.id !== over.id) {
      const oldIndex = sections.findIndex(s => s.id === active.id)
      const newIndex = sections.findIndex(s => s.id === over.id)
      onChange(arrayMove(sections, oldIndex, newIndex))
    }
  }

  const toggleSection = (id) => onChange(sections.map(s => s.id === id ? { ...s, visible: !s.visible } : s))
  const enableAll  = () => onChange(sections.map(s => ({ ...s, visible: true })))
  const disableAll = () => onChange(sections.map(s => ({ ...s, visible: false })))
  const visible = sections.filter(s => s.visible).length
  const activeSection = sections.find(s => s.id === activeId)

  return (
    <div className="roc-section-body">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <p className="roc-title">Report Sections</p>
          <p className="roc-subtitle">{visible} of {sections.length} sections visible</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.6875rem' }}>
          <button onClick={enableAll} className="roc-btn-link">All</button>
          <span style={{ color: 'var(--border-color)' }}>|</span>
          <button onClick={disableAll} className="roc-btn-link" style={{ color: 'var(--text-color-muted)' }}>None</button>
        </div>
      </div>

      <p className="roc-subtitle" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        Drag rows to reorder • Toggle to show/hide in PDF
      </p>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <SortableContext items={sections.map(s => s.id)} strategy={verticalListSortingStrategy}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {sections.map((section, index) => (
              <SortableItem key={section.id} section={section} index={index} onToggle={toggleSection} />
            ))}
          </div>
        </SortableContext>

        <DragOverlay dropAnimation={null}>
          {activeSection && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <DragHandle />
              <div style={{ flex: 1 }}>
                <SectionRow
                  section={activeSection}
                  index={sections.findIndex(s => s.id === activeId)}
                  onToggle={() => {}}
                  isDragOverlay
                />
              </div>
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </div>
  )
}
