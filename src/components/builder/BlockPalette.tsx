/**
 * The block library, in the sidebar.
 *
 * Grouped the way the registry groups them, which means a plugin's blocks
 * appear here with no change to this file -- the sidebar is a projection of
 * the registry, not a hand-written list.
 */

import { useMemo, useState } from 'react'

import type { BlockRegistry } from '../../builder/blockSchema'

export type BlockPaletteProps = {
  registry: BlockRegistry
  /** Count of plugin-contributed blocks, shown so the SDK is visible. */
  pluginCount?: number
  disabled?: boolean
  onAdd: (type: string) => void
}

export function BlockPalette({ registry, pluginCount = 0, disabled, onAdd }: BlockPaletteProps) {
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()

  const groups = useMemo(() => registry.byCategory()
    .map((group) => ({
      ...group,
      blocks: group.blocks.filter((block) => (
        !needle
        || block.label.toLowerCase().includes(needle)
        || block.type.toLowerCase().includes(needle)
        || block.description.toLowerCase().includes(needle)
      )),
    }))
    .filter((group) => group.blocks.length), [needle, registry])

  return (
    <div className="block-palette">
      <div className="sidebar-title"><span>BUILDER BLOCKS</span></div>

      <input
        className="block-palette-filter"
        placeholder="Filter blocks"
        aria-label="Filter blocks"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      <div className="block-palette-groups">
        {groups.map((group) => (
          <section key={group.category}>
            <div className="section-heading">
              <span>{group.category.toUpperCase()}</span>
              <span className="count-pill">{group.blocks.length}</span>
            </div>
            {group.blocks.map((block) => (
              <button
                key={block.type}
                className="block-palette-item"
                disabled={disabled}
                title={block.description}
                onClick={() => onAdd(block.type)}
              >
                <span className="block-palette-label">{block.label}</span>
                <span className="block-palette-detail">{block.description}</span>
              </button>
            ))}
          </section>
        ))}

        {!groups.length && <div className="sidebar-empty compact"><span>No block matches “{query}”</span></div>}
      </div>

      <footer className="block-palette-footer">
        {registry.all().length} blocks
        {pluginCount > 0 && `, ${pluginCount} from plugins`}
      </footer>
    </div>
  )
}
