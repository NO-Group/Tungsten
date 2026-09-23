import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MarkerService,
  MarkerSeverity,
  compareMarkers,
  filterMarkers,
  groupMarkersByResource,
  severityLabel,
  type MarkerInput,
} from './markerService'

const marker = (overrides: Partial<MarkerInput> = {}): MarkerInput => ({
  severity: MarkerSeverity.Error,
  message: 'Something went wrong',
  startLineNumber: 1,
  startColumn: 1,
  endLineNumber: 1,
  endColumn: 10,
  ...overrides,
})

describe('marker service', () => {
  let service: MarkerService

  beforeEach(() => {
    service = new MarkerService()
  })

  it('records and reads markers', () => {
    service.changeOne('ts', 'a.ts', [marker()])
    expect(service.read()).toHaveLength(1)
    expect(service.read()[0].resource).toBe('a.ts')
    expect(service.read()[0].owner).toBe('ts')
  })

  it('replaces only the markers belonging to one owner', () => {
    // Two tools reporting on the same file must not clobber each other.
    service.changeOne('ts', 'a.ts', [marker({ message: 'type error' })])
    service.changeOne('eslint', 'a.ts', [marker({ message: 'lint error' })])
    expect(service.read()).toHaveLength(2)

    service.changeOne('ts', 'a.ts', [])
    const remaining = service.read()
    expect(remaining).toHaveLength(1)
    expect(remaining[0].message).toBe('lint error')
  })

  it('drops a resource once every owner has cleared it', () => {
    service.changeOne('ts', 'a.ts', [marker()])
    service.changeOne('ts', 'a.ts', [])
    expect(service.resources()).toEqual([])
  })

  it('replaces an owner across every resource at once', () => {
    service.changeOne('ts', 'a.ts', [marker()])
    service.changeOne('ts', 'b.ts', [marker()])
    service.changeAll('ts', [{ resource: 'c.ts', markers: [marker()] }])
    expect(service.resources()).toEqual(['c.ts'])
  })

  it('filters by owner', () => {
    service.changeOne('ts', 'a.ts', [marker()])
    service.changeOne('eslint', 'a.ts', [marker()])
    expect(service.read({ owner: 'eslint' })).toHaveLength(1)
  })

  it('filters by resource', () => {
    service.changeOne('ts', 'a.ts', [marker()])
    service.changeOne('ts', 'b.ts', [marker()])
    expect(service.read({ resource: 'b.ts' })).toHaveLength(1)
  })

  it('filters by a severity mask', () => {
    service.changeOne('ts', 'a.ts', [
      marker({ severity: MarkerSeverity.Error }),
      marker({ severity: MarkerSeverity.Warning }),
      marker({ severity: MarkerSeverity.Info }),
    ])
    expect(service.read({ severities: MarkerSeverity.Error })).toHaveLength(1)
    expect(service.read({ severities: MarkerSeverity.Error | MarkerSeverity.Warning })).toHaveLength(2)
  })

  it('limits results with take', () => {
    service.changeOne('ts', 'a.ts', [marker(), marker(), marker()])
    expect(service.read({ take: 2 })).toHaveLength(2)
  })

  it('counts markers by severity', () => {
    service.changeOne('ts', 'a.ts', [
      marker({ severity: MarkerSeverity.Error }),
      marker({ severity: MarkerSeverity.Error }),
      marker({ severity: MarkerSeverity.Warning }),
      marker({ severity: MarkerSeverity.Hint }),
    ])
    const stats = service.statistics()
    expect(stats.errors).toBe(2)
    expect(stats.warnings).toBe(1)
    expect(stats.hints).toBe(1)
    expect(stats.infos).toBe(0)
  })

  it('notifies listeners with the affected resources', () => {
    const listener = vi.fn()
    service.onDidChange(listener)
    service.changeOne('ts', 'a.ts', [marker()])
    expect(listener).toHaveBeenCalledWith(['a.ts'])
  })

  it('stops notifying after the listener is disposed', () => {
    const listener = vi.fn()
    const dispose = service.onDidChange(listener)
    dispose()
    service.changeOne('ts', 'a.ts', [marker()])
    expect(listener).not.toHaveBeenCalled()
  })

  it('sorts errors above warnings, then by position', () => {
    service.changeOne('ts', 'a.ts', [
      marker({ severity: MarkerSeverity.Warning, startLineNumber: 1 }),
      marker({ severity: MarkerSeverity.Error, startLineNumber: 5 }),
      marker({ severity: MarkerSeverity.Error, startLineNumber: 2 }),
    ])
    const read = service.read()
    expect(read.map((item) => [item.severity, item.startLineNumber])).toEqual([
      [MarkerSeverity.Error, 2],
      [MarkerSeverity.Error, 5],
      [MarkerSeverity.Warning, 1],
    ])
  })

  it('removes markers for named resources', () => {
    service.changeOne('ts', 'a.ts', [marker()])
    service.changeOne('ts', 'b.ts', [marker()])
    service.remove('ts', ['a.ts'])
    expect(service.resources()).toEqual(['b.ts'])
  })
})

describe('marker helpers', () => {
  it('labels each severity', () => {
    expect(severityLabel(MarkerSeverity.Error)).toBe('Error')
    expect(severityLabel(MarkerSeverity.Warning)).toBe('Warning')
    expect(severityLabel(MarkerSeverity.Info)).toBe('Info')
    expect(severityLabel(MarkerSeverity.Hint)).toBe('Hint')
  })

  it('orders markers across resources by path', () => {
    const a = { ...marker(), owner: 'x', resource: 'a.ts' }
    const b = { ...marker(), owner: 'x', resource: 'b.ts' }
    expect(compareMarkers(a, b)).toBeLessThan(0)
  })

  const markers = [
    { ...marker({ message: 'unused variable' }), owner: 'ts', resource: 'src/a.ts' },
    { ...marker({ message: 'missing semicolon', severity: MarkerSeverity.Warning }), owner: 'eslint', resource: 'src/b.ts' },
    { ...marker({ message: 'type mismatch' }), owner: 'ts', resource: 'test/c.ts' },
  ]

  it('filters markers by free text against message and path', () => {
    expect(filterMarkers(markers, 'unused')).toHaveLength(1)
    expect(filterMarkers(markers, 'src/')).toHaveLength(2)
  })

  it('supports negated filter terms', () => {
    expect(filterMarkers(markers, '!src/')).toHaveLength(1)
  })

  it('combines a text filter with a severity mask', () => {
    expect(filterMarkers(markers, '', MarkerSeverity.Warning)).toHaveLength(1)
    expect(filterMarkers(markers, 'semicolon', MarkerSeverity.Error)).toHaveLength(0)
  })

  it('returns everything for an empty filter', () => {
    expect(filterMarkers(markers, '')).toHaveLength(3)
    expect(filterMarkers(markers, '   ')).toHaveLength(3)
  })

  it('groups markers by resource for the problems tree', () => {
    const groups = groupMarkersByResource(markers)
    expect(groups.map((group) => group.resource)).toEqual(['src/a.ts', 'src/b.ts', 'test/c.ts'])
    expect(groups[0].markers).toHaveLength(1)
  })
})
