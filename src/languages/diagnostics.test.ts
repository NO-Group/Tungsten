import { describe, expect, it } from 'vitest'

import { countDiagnostics, diagnosticsToMarkers, mergeDiagnostics, type Diagnostic } from './diagnostics'
import { MarkerSeverity } from '../markers/markerService'

const problem = (path: string, message: string, severity = 1, line = 1): Diagnostic =>
  ({ path, message, severity, line })

describe('mergeDiagnostics', () => {
  const current = [problem('src/a.ts', 'a is wrong'), problem('src/b.ts', 'b is wrong')]

  it('replaces one file without disturbing the others', () => {
    const merged = mergeDiagnostics(current, 'src/a.ts', [problem('src/a.ts', 'a is still wrong', 2)])
    expect(merged.map((item) => item.message)).toEqual(['a is still wrong', 'b is wrong'])
  })

  it('clears a file when its server publishes nothing', () => {
    expect(mergeDiagnostics(current, 'src/a.ts', [])).toEqual([problem('src/b.ts', 'b is wrong')])
  })

  it('keeps the file in place rather than moving it to the end', () => {
    const merged = mergeDiagnostics(current, 'src/a.ts', [
      problem('src/a.ts', 'first', 1, 3),
      problem('src/a.ts', 'second', 1, 9),
    ])
    expect(merged.map((item) => item.path)).toEqual(['src/a.ts', 'src/a.ts', 'src/b.ts'])
  })

  it('appends a file that had no problems before', () => {
    const merged = mergeDiagnostics(current, 'src/c.ts', [problem('src/c.ts', 'c is wrong')])
    expect(merged).toHaveLength(3)
    expect(merged[2].path).toBe('src/c.ts')
  })

  it('does nothing at all for a clean file that was already clean', () => {
    expect(mergeDiagnostics(current, 'src/c.ts', [])).toBe(current)
  })
})

describe('diagnosticsToMarkers', () => {
  it('maps LSP severities onto marker severities', () => {
    const markers = diagnosticsToMarkers([
      problem('src/a.ts', 'error', 1),
      problem('src/a.ts', 'warning', 2),
      problem('src/a.ts', 'info', 3),
      problem('src/a.ts', 'hint', 4),
    ])
    expect(markers.map((marker) => marker.severity)).toEqual([
      MarkerSeverity.Error, MarkerSeverity.Warning, MarkerSeverity.Info, MarkerSeverity.Hint,
    ])
  })

  it('treats an unknown severity as information rather than dropping it', () => {
    const [marker] = diagnosticsToMarkers([problem('src/a.ts', 'odd', 99)])
    expect(marker.severity).toBe(MarkerSeverity.Info)
  })

  it('keeps each file under its own resource', () => {
    const markers = diagnosticsToMarkers([problem('src/a.ts', 'a'), problem('src/b.ts', 'b')])
    expect(new Set(markers.map((marker) => marker.resource))).toEqual(new Set(['src/a.ts', 'src/b.ts']))
  })
})

describe('countDiagnostics', () => {
  it('counts errors, and everything else as a warning', () => {
    expect(countDiagnostics([
      problem('src/a.ts', 'error', 1),
      problem('src/a.ts', 'warning', 2),
      problem('src/a.ts', 'hint', 4),
    ])).toEqual({ errors: 1, warnings: 2 })
  })

  it('reads zero on a clean workspace', () => {
    expect(countDiagnostics([])).toEqual({ errors: 0, warnings: 0 })
  })
})
