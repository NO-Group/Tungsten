/**
 * Marker (problem) model, following `src/vs/platform/markers/common/markers.ts`.
 *
 * Markers are owned: each producer (a language server, the linter, the test
 * runner) replaces its own set without disturbing anyone else's, which is what
 * lets the Problems panel stay consistent while several tools report at once.
 */

export enum MarkerSeverity {
  Hint = 1,
  Info = 2,
  Warning = 4,
  Error = 8,
}

export interface Marker {
  owner: string
  resource: string
  severity: MarkerSeverity
  message: string
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
  code?: string
  source?: string
  relatedInformation?: Array<{ resource: string; message: string; startLineNumber: number; startColumn: number }>
  tags?: Array<'unnecessary' | 'deprecated'>
}

export type MarkerInput = Omit<Marker, 'owner' | 'resource'>

export interface MarkerStatistics {
  errors: number
  warnings: number
  infos: number
  hints: number
  unknowns: number
}

export function severityLabel(severity: MarkerSeverity): string {
  switch (severity) {
    case MarkerSeverity.Error: return 'Error'
    case MarkerSeverity.Warning: return 'Warning'
    case MarkerSeverity.Info: return 'Info'
    default: return 'Hint'
  }
}

/** Sort order used by the Problems panel: errors first, then by position. */
export function compareMarkers(a: Marker, b: Marker): number {
  if (a.resource !== b.resource) return a.resource.localeCompare(b.resource)
  if (a.severity !== b.severity) return b.severity - a.severity
  if (a.startLineNumber !== b.startLineNumber) return a.startLineNumber - b.startLineNumber
  return a.startColumn - b.startColumn
}

type Listener = (resources: string[]) => void

export class MarkerService {
  /** resource -> owner -> markers */
  private readonly byResource = new Map<string, Map<string, Marker[]>>()
  private readonly listeners = new Set<Listener>()

  /**
   * Replaces every marker `owner` has recorded for `resource`.
   * Passing an empty array clears that owner's markers.
   */
  changeOne(owner: string, resource: string, markers: MarkerInput[]) {
    const owners = this.byResource.get(resource) ?? new Map<string, Marker[]>()
    if (markers.length === 0) owners.delete(owner)
    else owners.set(owner, markers.map((marker) => ({ ...marker, owner, resource })))

    if (owners.size === 0) this.byResource.delete(resource)
    else this.byResource.set(resource, owners)

    this.emit([resource])
  }

  /** Replaces every marker `owner` has recorded, across all resources. */
  changeAll(owner: string, entries: Array<{ resource: string; markers: MarkerInput[] }>) {
    const touched = new Set<string>()
    for (const [resource, owners] of this.byResource) {
      if (owners.delete(owner)) {
        touched.add(resource)
        if (owners.size === 0) this.byResource.delete(resource)
      }
    }
    for (const entry of entries) {
      if (entry.markers.length === 0) continue
      const owners = this.byResource.get(entry.resource) ?? new Map<string, Marker[]>()
      owners.set(owner, entry.markers.map((marker) => ({ ...marker, owner, resource: entry.resource })))
      this.byResource.set(entry.resource, owners)
      touched.add(entry.resource)
    }
    this.emit([...touched])
  }

  remove(owner: string, resources: string[]) {
    for (const resource of resources) this.changeOne(owner, resource, [])
  }

  /** Reads markers, optionally filtered by resource, owner, or severity mask. */
  read(filter: { resource?: string; owner?: string; severities?: number; take?: number } = {}): Marker[] {
    const out: Marker[] = []
    const resources = filter.resource ? [filter.resource] : [...this.byResource.keys()]
    for (const resource of resources) {
      const owners = this.byResource.get(resource)
      if (!owners) continue
      for (const [owner, markers] of owners) {
        if (filter.owner && owner !== filter.owner) continue
        for (const marker of markers) {
          if (filter.severities !== undefined && (filter.severities & marker.severity) === 0) continue
          out.push(marker)
        }
      }
    }
    out.sort(compareMarkers)
    return filter.take !== undefined ? out.slice(0, filter.take) : out
  }

  statistics(): MarkerStatistics {
    const stats: MarkerStatistics = { errors: 0, warnings: 0, infos: 0, hints: 0, unknowns: 0 }
    for (const marker of this.read()) {
      switch (marker.severity) {
        case MarkerSeverity.Error: stats.errors += 1; break
        case MarkerSeverity.Warning: stats.warnings += 1; break
        case MarkerSeverity.Info: stats.infos += 1; break
        case MarkerSeverity.Hint: stats.hints += 1; break
        default: stats.unknowns += 1; break
      }
    }
    return stats
  }

  resources(): string[] {
    return [...this.byResource.keys()].sort()
  }

  onDidChange(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(resources: string[]) {
    if (resources.length === 0) return
    for (const listener of this.listeners) listener(resources)
  }
}

/**
 * Filters markers the way the Problems panel's filter box does: plain text
 * matches the message or the file, and `!pattern` excludes.
 */
export function filterMarkers(markers: Marker[], filter: string, severities?: number): Marker[] {
  const terms = filter.trim().split(/\s+/).filter(Boolean)
  return markers.filter((marker) => {
    if (severities !== undefined && (severities & marker.severity) === 0) return false
    for (const term of terms) {
      const negated = term.startsWith('!')
      const needle = (negated ? term.slice(1) : term).toLowerCase()
      if (!needle) continue
      const haystack = `${marker.message} ${marker.resource} ${marker.source ?? ''} ${marker.code ?? ''}`.toLowerCase()
      const hit = haystack.includes(needle)
      if (negated && hit) return false
      if (!negated && !hit) return false
    }
    return true
  })
}

/** Groups markers by resource for the tree the Problems panel renders. */
export function groupMarkersByResource(markers: Marker[]): Array<{ resource: string; markers: Marker[] }> {
  const groups = new Map<string, Marker[]>()
  for (const marker of markers) {
    groups.set(marker.resource, [...(groups.get(marker.resource) ?? []), marker])
  }
  return [...groups.entries()]
    .map(([resource, items]) => ({ resource, markers: items.sort(compareMarkers) }))
    .sort((a, b) => a.resource.localeCompare(b.resource))
}
