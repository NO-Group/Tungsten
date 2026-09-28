/**
 * The Shell Dictionary view.
 *
 * Two states in one panel: a searchable list of every command Tungsten knows
 * about, and the manual page for the one you picked. The page takes the whole
 * panel rather than squeezing beside the list, because a synopsis and a flag
 * table need the width.
 *
 * Everything here is presentation. The dictionary is handed in already merged
 * with the workspace's own entries, and running an example is the caller's
 * job -- the view only says which command line was asked for.
 */

import { useMemo, useState } from 'react'
import {
  ArrowLeft, BookOpen, CircleAlert, FilePlus2, Play, Search, Terminal, TriangleAlert,
} from 'lucide-react'

import type { CommandEntry, CommandGroup } from '../../shell/commandModel'
import type { Dictionary } from '../../shell/commandDictionary'
import { TipButton } from '../TipButton'

export type DictionaryViewProps = {
  dictionary: Dictionary
  /** How many entries the workspace contributed, for the footer. */
  contributed: number
  /** Files under `dictionary/` that could not be read. */
  problems: string[]
  /** Send a command line to the terminal and show it running. */
  onRun: (command: string) => void
  /** Write the example contribution file into the workspace. */
  onDocumentCommand: () => void
}

/** The list, with the query and group filter above it. */
function ResultList({
  dictionary, query, group, onQueryChange, onGroupChange, onSelect,
}: {
  dictionary: Dictionary
  query: string
  group: CommandGroup | 'All'
  onQueryChange: (value: string) => void
  onGroupChange: (value: CommandGroup | 'All') => void
  onSelect: (entry: CommandEntry) => void
}) {
  const results = useMemo(() => dictionary.search(query, { group, limit: 300 }), [dictionary, query, group])
  const counts = useMemo(() => dictionary.counts(), [dictionary])

  return (
    <>
      <div className="dictionary-search">
        <Search size={13} />
        <input
          value={query}
          spellCheck={false}
          autoComplete="off"
          placeholder={`Search ${dictionary.entries.length} commands, or describe the job`}
          aria-label="Search commands"
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </div>

      <div className="dictionary-groups">
        <button
          className={group === 'All' ? 'active' : ''}
          aria-pressed={group === 'All'}
          onClick={() => onGroupChange('All')}
        >
          All <span>{dictionary.entries.length}</span>
        </button>
        {counts.map((row) => (
          <button
            key={row.group}
            className={group === row.group ? 'active' : ''}
            aria-pressed={group === row.group}
            onClick={() => onGroupChange(row.group)}
          >
            {row.group} <span>{row.count}</span>
          </button>
        ))}
      </div>

      <div className="dictionary-list">
        {results.length === 0 && (
          <p className="dictionary-empty">
            Nothing matches “{query}”.
            {dictionary.suggest(query).length > 0 && ` Did you mean ${dictionary.suggest(query).join(', ')}?`}
          </p>
        )}
        {results.map((entry) => (
          <button key={entry.name} className="dictionary-item" onClick={() => onSelect(entry)}>
            <span className="dictionary-name">
              {entry.name}
              {entry.danger && <TriangleAlert size={11} className="dictionary-danger-glyph" />}
            </span>
            <span className="dictionary-summary">{entry.summary}</span>
          </button>
        ))}
      </div>
    </>
  )
}

/** The manual page for one command. */
function ManualPage({
  entry, dictionary, onBack, onSelect, onRun,
}: {
  entry: CommandEntry
  dictionary: Dictionary
  onBack: () => void
  onSelect: (entry: CommandEntry) => void
  onRun: (command: string) => void
}) {
  return (
    <div className="dictionary-page">
      <div className="dictionary-page-head">
        <TipButton label="Back to the list" onClick={onBack}><ArrowLeft size={14} /></TipButton>
        <h3>{entry.name}</h3>
        <span className="dictionary-badge">{entry.group}</span>
      </div>

      <p className="dictionary-page-summary">{entry.summary}</p>
      <code className="dictionary-synopsis">{entry.synopsis}</code>

      {entry.danger && (
        <p className="dictionary-warning">
          <TriangleAlert size={12} /> {entry.danger}
        </p>
      )}

      {entry.description && <p className="dictionary-description">{entry.description}</p>}

      {entry.options && entry.options.length > 0 && (
        <section>
          <h4>Options</h4>
          <dl className="dictionary-options">
            {entry.options.map((option) => (
              <div key={option.flag}>
                <dt>{option.flag}</dt>
                <dd>{option.summary}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {entry.examples && entry.examples.length > 0 && (
        <section>
          <h4>Examples</h4>
          {entry.examples.map((example) => (
            <div key={example.command} className="dictionary-example">
              <code>{example.command}</code>
              <p>{example.summary}</p>
              <button onClick={() => onRun(example.command)}>
                <Play size={10} /> Run in terminal
              </button>
            </div>
          ))}
        </section>
      )}

      <section>
        <h4>Read it in the terminal</h4>
        <div className="dictionary-actions">
          <button onClick={() => onRun(`man ${entry.name}`)}><Terminal size={11} /> man {entry.name}</button>
          <button onClick={() => onRun(`explain ${entry.synopsis.split(' ')[0]}`)}>
            <Terminal size={11} /> explain
          </button>
        </div>
      </section>

      {entry.seeAlso && entry.seeAlso.length > 0 && (
        <section>
          <h4>See also</h4>
          <div className="dictionary-see-also">
            {entry.seeAlso.map((name) => {
              const other = dictionary.lookup(name)
              return (
                <button key={name} disabled={!other} onClick={() => other && onSelect(other)}>{name}</button>
              )
            })}
          </div>
        </section>
      )}

      <p className="dictionary-provenance">
        {entry.builtin ? 'Shell builtin' : entry.from ? `From ${entry.from}` : 'External command'}
        {entry.source ? ` · contributed by ${entry.source}` : ''}
      </p>
    </div>
  )
}

export function DictionaryView({
  dictionary, contributed, problems, onRun, onDocumentCommand,
}: DictionaryViewProps) {
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState<CommandGroup | 'All'>('All')
  const [selected, setSelected] = useState<string | null>(null)

  const entry = selected ? dictionary.lookup(selected) : undefined

  return (
    <>
      <div className="sidebar-title">
        <span>SHELL DICTIONARY</span>
        <TipButton label="Document a command for this workspace" onClick={onDocumentCommand}>
          <FilePlus2 size={14} />
        </TipButton>
      </div>

      {entry ? (
        <ManualPage
          entry={entry}
          dictionary={dictionary}
          onBack={() => setSelected(null)}
          onSelect={(next) => setSelected(next.name)}
          onRun={onRun}
        />
      ) : (
        <ResultList
          dictionary={dictionary}
          query={query}
          group={group}
          onQueryChange={setQuery}
          onGroupChange={setGroup}
          onSelect={(next) => setSelected(next.name)}
        />
      )}

      {problems.length > 0 && (
        <div className="dictionary-problems">
          {problems.map((problem) => (
            <p key={problem}><CircleAlert size={11} /> {problem}</p>
          ))}
        </div>
      )}

      <div className="dictionary-footer">
        <BookOpen size={11} />
        <span>
          {dictionary.entries.length} commands
          {contributed > 0 ? ` · ${contributed} from this workspace` : ''}
        </span>
      </div>
    </>
  )
}

export default DictionaryView
