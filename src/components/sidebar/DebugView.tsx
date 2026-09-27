/**
 * The Run and Debug view.
 *
 * Mirrors the Debug Adapter Protocol session model: threads, call stack,
 * scopes and variables, watches, and breakpoints. All of it is fed in; the
 * DAP transport itself lives in the workbench.
 */

import {
  BugPlay, ChevronDown, CircleStop, CornerDownRight, Cpu, Layers,
  Pause, Play, Plus, StepForward, Undo2, X,
} from 'lucide-react'
import { TipButton } from '../TipButton'
import { fileName } from '../../workspace'

export type DebugCommand = 'continue' | 'pause' | 'next' | 'stepIn' | 'stepOut'
export type DebugThread = { id: number; name: string }
export type DebugFrame = { id: number; name: string; line: number; source?: { path?: string; name?: string } }
export type DebugScope = { name: string; variablesReference: number }
export type DebugVariable = { name: string; value: string; type?: string; variablesReference?: number }
export type Breakpoint = { path: string; line: number; condition?: string }

/** Label, DAP command and icon for each stepping control. */
const stepControls = [
  ['Continue', 'continue', Play],
  ['Pause', 'pause', Pause],
  ['Step over', 'next', StepForward],
  ['Step into', 'stepIn', CornerDownRight],
  ['Step out', 'stepOut', Undo2],
] as const

/** DAP command names do not match the workbench command ids one to one. */
const commandIds: Record<DebugCommand, string> = {
  continue: 'continue',
  pause: 'pause',
  next: 'stepOver',
  stepIn: 'stepInto',
  stepOut: 'stepOut',
}

export type DebugViewProps = {
  running: boolean
  sessionId?: string
  output: string[]
  hasLaunchConfig: boolean
  threads: DebugThread[]
  frames: DebugFrame[]
  scopes: DebugScope[]
  variables: DebugVariable[]
  watches: string[]
  watchInput: string
  watchValues: Record<string, string>
  breakpoints: Breakpoint[]
  canAddBreakpoint: boolean
  /** Resolves a command id to its rendered keystroke, for the button titles. */
  shortcutFor: (commandId: string) => string
  onStart: () => void
  onStop: () => void
  onControl: (command: DebugCommand) => void
  onSelectThread: (id: number) => void
  onSelectFrame: (frame: DebugFrame) => void
  onWatchInputChange: (value: string) => void
  onAddWatch: () => void
  onRemoveWatch: (expression: string) => void
  onAddBreakpoint: () => void
  onEditBreakpointCondition: (path: string, line: number) => void
  onRemoveBreakpoint: (path: string, line: number) => void
  onRevealBreakpoint: (path: string, line: number) => void
}

export function DebugView({
  running, sessionId, output, hasLaunchConfig, threads, frames, scopes, variables,
  watches, watchInput, watchValues, breakpoints, canAddBreakpoint, shortcutFor,
  onStart, onStop, onControl, onSelectThread, onSelectFrame, onWatchInputChange,
  onAddWatch, onRemoveWatch, onAddBreakpoint, onEditBreakpointCondition,
  onRemoveBreakpoint, onRevealBreakpoint,
}: DebugViewProps) {
  const toggleSession = () => (running ? onStop() : onStart())

  return (
    <>
      <div className="sidebar-title">
        <span>RUN AND DEBUG</span>
        <TipButton label={running ? 'Stop debugging' : 'Start debugging'} onClick={toggleSession}>
          {running ? <CircleStop size={15} /> : <Play size={15} />}
        </TipButton>
      </div>

      <div className="debug-launch">
        <button className={running ? 'stop' : ''} onClick={toggleSession}>
          {running ? <CircleStop size={15} /> : <BugPlay size={15} />}
          {running ? 'Stop session' : 'Start debugging'}
          <kbd>F5</kbd>
        </button>
        <p>{hasLaunchConfig ? 'Using .tungsten/launch.json' : 'Add .tungsten/launch.json with your DAP adapter configuration.'}</p>
      </div>

      {running && sessionId && (
        <div className="debug-controls">
          {stepControls.map(([label, command, Icon]) => (
            <button
              key={command}
              title={`${label} (${shortcutFor(`workbench.action.debug.${commandIds[command]}`) || '—'})`}
              onClick={() => onControl(command)}
            >
              <Icon size={13} />
            </button>
          ))}
          <span>DAP SESSION</span>
        </div>
      )}

      {running && <>
        <div className="section-heading"><ChevronDown size={13} /><span>THREADS</span><span className="count-pill">{threads.length}</span></div>
        <div className="debug-data-list">
          {threads.map((thread) => (
            <button key={thread.id} onClick={() => onSelectThread(thread.id)}>
              <Cpu size={12} /><strong>{thread.name}</strong><small>#{thread.id}</small>
            </button>
          ))}
        </div>

        <div className="section-heading"><ChevronDown size={13} /><span>CALL STACK</span><span className="count-pill">{frames.length}</span></div>
        <div className="debug-data-list">
          {frames.map((frame) => (
            <button key={frame.id} onClick={() => onSelectFrame(frame)}>
              <Layers size={12} /><strong>{frame.name}</strong><small>{frame.source?.name || 'source'}:{frame.line}</small>
            </button>
          ))}
        </div>

        <div className="section-heading"><ChevronDown size={13} /><span>VARIABLES</span><span className="count-pill">{variables.length}</span></div>
        <div className="debug-variable-list">
          {scopes.map((scope) => <b key={scope.name}>{scope.name}</b>)}
          {variables.map((variable, index) => (
            <div key={`${variable.name}-${index}`}>
              <span>{variable.name}</span><code>{variable.value}</code><small>{variable.type}</small>
            </div>
          ))}
        </div>

        <div className="section-heading"><ChevronDown size={13} /><span>WATCH</span><span className="count-pill">{watches.length}</span></div>
        <div className="watch-input">
          <input
            value={watchInput}
            placeholder="Expression"
            onChange={(event) => onWatchInputChange(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter' && watchInput.trim()) onAddWatch() }}
          />
          <Plus size={12} />
        </div>
        <div className="debug-variable-list">
          {watches.map((expression) => (
            <div key={expression}>
              <span>{expression}</span>
              <code>{watchValues[expression] || 'not evaluated'}</code>
              <X size={11} onClick={() => onRemoveWatch(expression)} />
            </div>
          ))}
        </div>
      </>}

      <div className="section-heading">
        <ChevronDown size={13} /><span>BREAKPOINTS</span><span className="count-pill">{breakpoints.length}</span>
        <TipButton label="Add breakpoint at cursor" onClick={onAddBreakpoint} disabled={!canAddBreakpoint}><Plus size={13} /></TipButton>
      </div>
      <div className="breakpoint-list">
        {breakpoints.length ? breakpoints.map((point) => (
          <button
            key={`${point.path}:${point.line}`}
            title="Right-click to edit condition"
            onContextMenu={(event) => { event.preventDefault(); onEditBreakpointCondition(point.path, point.line) }}
            onClick={() => onRevealBreakpoint(point.path, point.line)}
          >
            <span className="breakpoint-dot" />
            <strong>{fileName(point.path)}</strong>
            <small>line {point.line}{point.condition ? ` · ${point.condition}` : ''}</small>
            <X size={12} onClick={(event) => { event.stopPropagation(); onRemoveBreakpoint(point.path, point.line) }} />
          </button>
        )) : <p>No breakpoints set</p>}
      </div>

      <div className="section-heading"><ChevronDown size={13} /><span>DEBUG OUTPUT</span></div>
      <div className="debug-sidebar-output">{output.slice(-8).map((line, index) => <p key={index}>{line}</p>)}</div>
    </>
  )
}

export default DebugView
