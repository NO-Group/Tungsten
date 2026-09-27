/**
 * The Testing and Tasks view.
 *
 * Shows the detected frameworks, the runnable test profiles and project
 * tasks, every individual test discovered in the workspace with its last
 * result, and whether coverage has been loaded.
 */

import {
  BugPlay, ChevronDown, CircleAlert, CircleCheck, FlaskConical,
  ListChecks, Play, RefreshCw, ShieldCheck,
} from 'lucide-react'
import { TipButton } from '../TipButton'

export type DiscoveredTest = { id: string; name: string; path: string; line: number; command: string }
export type TestResult = {
  status: 'running' | 'passed' | 'failed'
  durationMs?: number
  output?: string
  failures?: string[]
  snapshots?: string[]
}
export type ProjectTask = { label: string; command: string }

export type TestingViewProps = {
  frameworks: string[]
  testProfiles: ProjectTask[]
  tasks: ProjectTask[]
  discovered: DiscoveredTest[]
  results: Record<string, TestResult>
  activeResult: string | null
  coverageFileCount: number
  onRefresh: () => void
  onRunTask: (command: string) => void
  onOpenTest: (test: DiscoveredTest) => void
  onRunTest: (id: string) => void
  onDebugTest: (test: DiscoveredTest) => void
}

/** The status glyph beside a discovered test. */
function ResultIcon({ status }: { status?: TestResult['status'] }) {
  if (status === 'failed') return <CircleAlert size={11} />
  if (status === 'running') return <RefreshCw size={11} className="spin" />
  return <CircleCheck size={11} />
}

export function TestingView({
  frameworks, testProfiles, tasks, discovered, results, activeResult,
  coverageFileCount, onRefresh, onRunTask, onOpenTest, onRunTest, onDebugTest,
}: TestingViewProps) {
  const detail = activeResult ? results[activeResult] : undefined

  return (
    <>
      <div className="sidebar-title">
        <span>TESTING &amp; TASKS</span>
        <TipButton label="Refresh tests and coverage" onClick={onRefresh}><RefreshCw size={14} /></TipButton>
      </div>

      <div className="framework-tags">
        {frameworks.length ? frameworks.map((framework) => <span key={framework}>{framework}</span>) : <span>No framework detected</span>}
      </div>

      <div className="section-heading"><ChevronDown size={13} /><span>TEST PROFILES</span><span className="count-pill">{testProfiles.length}</span></div>
      <div className="task-list">
        {testProfiles.length ? testProfiles.map((task) => (
          <button key={task.label} onClick={() => onRunTask(task.command)}>
            <FlaskConical size={14} /><span><strong>{task.label}</strong><small>{task.command}</small></span><Play size={12} />
          </button>
        )) : <div className="sidebar-empty compact"><FlaskConical size={22} /><span>No test runner detected</span></div>}
      </div>

      <div className="section-heading"><ChevronDown size={13} /><span>DISCOVERED TESTS</span><span className="count-pill">{discovered.length}</span></div>
      <div className="test-case-list">
        {/* Capped: a large monorepo can discover thousands, and the list is a
            navigation aid rather than a report. */}
        {discovered.slice(0, 300).map((test) => {
          const result = results[test.id]
          return (
            <div key={test.id} className={result?.status || ''}>
              <button title="Open test" onClick={() => onOpenTest(test)}>
                <ResultIcon status={result?.status} />
                <span>
                  <strong>{test.name}</strong>
                  <small>{test.path}:{test.line}{result?.durationMs !== undefined ? ` · ${result.durationMs} ms` : ''}</small>
                </span>
              </button>
              <button title="Run this test" onClick={() => onRunTest(test.id)}><Play size={11} /></button>
              <button title="Debug this test" onClick={() => onDebugTest(test)}><BugPlay size={11} /></button>
            </div>
          )
        })}
      </div>

      {detail && (
        <div className={`test-result-detail ${detail.status}`}>
          <strong>{detail.status.toUpperCase()}</strong>
          {detail.failures?.map((line, index) => <code key={`failure-${index}`}>{line}</code>)}
          {detail.snapshots?.map((line, index) => <code key={`snapshot-${index}`}>Snapshot · {line}</code>)}
          {detail.output && <pre>{detail.output}</pre>}
        </div>
      )}

      <div className="coverage-summary">
        <ShieldCheck size={13} />
        <span>{coverageFileCount ? `Coverage loaded for ${coverageFileCount} files` : 'Run coverage to enable editor overlays'}</span>
      </div>

      <div className="section-heading"><ChevronDown size={13} /><span>PROJECT TASKS</span><span className="count-pill">{tasks.length}</span></div>
      <div className="task-list">
        {tasks.map((task) => (
          <button key={`${task.label}-${task.command}`} onClick={() => onRunTask(task.command)}>
            <ListChecks size={14} /><span><strong>{task.label}</strong><small>{task.command}</small></span><Play size={12} />
          </button>
        ))}
      </div>
    </>
  )
}

export default TestingView
