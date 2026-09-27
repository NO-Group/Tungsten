/**
 * The Problems panel: diagnostics grouped by file.
 *
 * Markers come from the marker service, already filtered and grouped by the
 * workbench. This component only presents them and reports what the user
 * clicked, so the filtering rules stay in one place and stay testable.
 */

import { CircleAlert, CircleCheck, Filter } from 'lucide-react'

import { MarkerSeverity, type Marker, severityLabel } from '../../markers/markerService'
import { fileName } from '../../workspace'
import { FileGlyph } from '../FileGlyph'

export type ProblemGroup = {
  resource: string
  markers: Marker[]
}

export type ProblemsPanelProps = {
  /** Diagnostics grouped by file, already filtered. */
  groups: ProblemGroup[]
  /** Total unfiltered count, used to distinguish "none" from "none matching". */
  totalCount: number
  filter: string
  onFilterChange: (value: string) => void
  /** Bitmask of the MarkerSeverity values currently shown. */
  severities: number
  onToggleSeverity: (severity: number) => void
  /** Open a file and, when a marker is given, put the caret on it. */
  onReveal: (resource: string, line?: number, column?: number) => void
}

const SEVERITY_FILTERS = [
  ['Errors', MarkerSeverity.Error],
  ['Warnings', MarkerSeverity.Warning],
  ['Infos', MarkerSeverity.Info],
] as const

export function ProblemsPanel({
  groups,
  totalCount,
  filter,
  onFilterChange,
  severities,
  onToggleSeverity,
  onReveal,
}: ProblemsPanelProps) {
  return (
    <div className="problems-panel">
      <div className="problems-toolbar">
        <div className="problems-filter">
          <Filter size={12} />
          <input
            value={filter}
            onChange={(event) => onFilterChange(event.target.value)}
            placeholder="Filter (e.g. text, !exclude)"
            aria-label="Filter problems"
          />
        </div>
        <div className="problems-severities">
          {SEVERITY_FILTERS.map(([label, severity]) => {
            const on = (severities & severity) !== 0
            return (
              <button
                key={label}
                className={on ? 'active' : ''}
                aria-pressed={on}
                title={`Toggle ${label.toLowerCase()}`}
                onClick={() => onToggleSeverity(severity)}
              >{label}</button>
            )
          })}
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="empty-panel">
          <CircleCheck size={24} />
          <strong>{totalCount ? 'No matching problems' : 'No problems detected'}</strong>
          <span>{totalCount ? 'Adjust the filter to see more.' : 'Workspace validation passed.'}</span>
        </div>
      ) : (
        <div className="problems-list">
          {groups.map((group) => (
            <div className="problems-group" key={group.resource}>
              <button className="problems-group-head" onClick={() => onReveal(group.resource)}>
                <FileGlyph path={group.resource} />
                <strong>{fileName(group.resource)}</strong>
                <span className="problems-group-path">{group.resource}</span>
                <span className="count-pill">{group.markers.length}</span>
              </button>
              {group.markers.map((marker, index) => (
                <button
                  className="problems-row"
                  key={`${marker.resource}-${marker.startLineNumber}-${index}`}
                  onClick={() => onReveal(marker.resource, marker.startLineNumber, marker.startColumn)}
                >
                  <CircleAlert
                    size={13}
                    className={marker.severity === MarkerSeverity.Error ? 'error' : marker.severity === MarkerSeverity.Warning ? 'warning' : 'info'}
                  />
                  <span>{marker.message}</span>
                  <small>{severityLabel(marker.severity)} · {marker.startLineNumber}:{marker.startColumn}</small>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default ProblemsPanel
