/** Small presentational primitives used across every page. */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronRight, X, Loader2 } from 'lucide-react'

/* ------------------------------- Badge ------------------------------- */

export function Badge({
  tone = 'neutral',
  children
}: {
  tone?: 'success' | 'warning' | 'danger' | 'info' | 'accent' | 'neutral'
  children: ReactNode
}): React.JSX.Element {
  return <span className={`badge badge-${tone}`}>{children}</span>
}

export function Chip({ children }: { children: ReactNode }): React.JSX.Element {
  return <span className="chip">{children}</span>
}

/* ------------------------------ Switch ------------------------------- */

export function Toggle({
  title,
  description,
  checked,
  onChange,
  disabled
}: {
  title: string
  description?: string
  checked: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
}): React.JSX.Element {
  return (
    <div
      className="toggle"
      role="switch"
      aria-checked={checked}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      onClick={() => !disabled && onChange(!checked)}
      onKeyDown={(e) => {
        if (disabled) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onChange(!checked)
        }
      }}
      style={disabled ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
    >
      <div className="toggle-text">
        <div className="toggle-title">{title}</div>
        {description && <div className="toggle-desc">{description}</div>}
      </div>
      <div className={`switch${checked ? ' on' : ''}`} />
    </div>
  )
}

/* --------------------------- Segmented control ----------------------- */

export function Segmented<T extends string>({
  value,
  options,
  onChange
}: {
  value: T
  options: { value: T; label: string; disabled?: boolean }[]
  onChange: (value: T) => void
}): React.JSX.Element {
  return (
    <div className="segmented" role="tablist">
      {options.map((option) => (
        <button
          key={option.value}
          role="tab"
          aria-selected={option.value === value}
          disabled={option.disabled}
          className={`segmented-item${option.value === value ? ' active' : ''}`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/* ------------------------------- Field ------------------------------- */

export function Field({
  label,
  hint,
  action,
  children
}: {
  label: string
  hint?: string
  action?: ReactNode
  children: ReactNode
}): React.JSX.Element {
  return (
    <div className="field">
      <label className="field-label">
        <span>{label}</span>
        {action}
      </label>
      {children}
      {hint && <div className="field-hint">{hint}</div>}
    </div>
  )
}

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
  group?: string
}

export function Select({
  value,
  options,
  onChange,
  disabled,
  id
}: {
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  disabled?: boolean
  id?: string
}): React.JSX.Element {
  const groups = options.reduce<Record<string, SelectOption[]>>((acc, option) => {
    const key = option.group ?? ''
    ;(acc[key] ??= []).push(option)
    return acc
  }, {})
  const groupNames = Object.keys(groups)

  return (
    <select
      id={id}
      className="select"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    >
      {groupNames.length === 1 && groupNames[0] === ''
        ? options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))
        : groupNames.map((name) =>
            name === '' ? (
              groups[name].map((option) => (
                <option key={option.value} value={option.value} disabled={option.disabled}>
                  {option.label}
                </option>
              ))
            ) : (
              <optgroup key={name} label={name}>
                {groups[name].map((option) => (
                  <option key={option.value} value={option.value} disabled={option.disabled}>
                    {option.label}
                  </option>
                ))}
              </optgroup>
            )
          )}
    </select>
  )
}

/* ---------------------------- Disclosure ----------------------------- */

export function Disclosure({
  title,
  icon,
  defaultOpen = false,
  children
}: {
  title: string
  icon?: ReactNode
  defaultOpen?: boolean
  children: ReactNode
}): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="disclosure">
      <button className="disclosure-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <ChevronRight size={14} className={`disclosure-chevron${open ? ' open' : ''}`} />
        {icon}
        <span>{title}</span>
      </button>
      {open && <div className="disclosure-body">{children}</div>}
    </div>
  )
}

/* ------------------------------ Progress ----------------------------- */

export function Progress({
  percent,
  tone,
  large,
  animated
}: {
  percent: number
  tone?: 'success' | 'danger'
  large?: boolean
  animated?: boolean
}): React.JSX.Element {
  const clamped = Math.max(0, Math.min(100, percent))
  return (
    <div className={`progress${large ? ' progress-lg' : ''}`}>
      <div
        className={`progress-bar${tone ? ` ${tone}` : ''}${animated ? ' animated' : ''}`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  )
}

/* ------------------------------- Modal ------------------------------- */

export function Modal({
  title,
  onClose,
  children,
  footer,
  large
}: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  large?: boolean
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className={`modal${large ? ' lg' : ''}`} ref={ref} role="dialog" aria-modal="true">
        <div className="modal-header">
          <div className="modal-title">{title}</div>
          <button className="btn-icon" onClick={onClose} aria-label="Close">
            <X size={17} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  )
}

/* ---------------------------- Empty state ---------------------------- */

export function EmptyState({
  icon,
  title,
  text,
  action
}: {
  icon: ReactNode
  title: string
  text?: string
  action?: ReactNode
}): React.JSX.Element {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <div className="empty-title">{title}</div>
      {text && <div className="empty-text">{text}</div>}
      {action && <div className="mt-16">{action}</div>}
    </div>
  )
}

/* ------------------------------ Spinner ------------------------------ */

export function Spinner({ size = 16 }: { size?: number }): React.JSX.Element {
  return <Loader2 size={size} className="spin" />
}

/* --------------------------- Property table -------------------------- */

export function PropTable({
  rows
}: {
  rows: [string, ReactNode][]
}): React.JSX.Element {
  return (
    <div className="prop-table">
      {rows.map(([key, value], index) => (
        <div key={`${key}-${index}`} style={{ display: 'contents' }}>
          <div className="prop-key">{key}</div>
          <div className="prop-val">{value}</div>
        </div>
      ))}
    </div>
  )
}

/* ------------------------------- Stat -------------------------------- */

export function Stat({
  label,
  value,
  sub,
  icon
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  icon?: ReactNode
}): React.JSX.Element {
  return (
    <div className="stat-card">
      <div className="stat-label">
        {icon}
        {label}
      </div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  )
}
