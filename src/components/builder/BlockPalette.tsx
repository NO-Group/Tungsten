/**
 * The block library, in the sidebar.
 *
 * Grouped the way the registry groups them, which means a plugin's blocks
 * appear here with no change to this file -- the sidebar is a projection of
 * the registry, not a hand-written list.
 */

import { useMemo, useState } from 'react'

import type { BlockRegistry } from '../../builder/blockSchema'
import { BLOCK_DRAG_TYPE } from '../../builder/canvasLayout'
import { recipes } from '../../builder/recipes'

export type BlockPaletteProps = {
  registry: BlockRegistry
  /** Count of plugin-contributed blocks, shown so the SDK is visible. */
  pluginCount?: number
  /** Manifests that failed to load, named so they can be fixed. */
  pluginProblems?: Array<{ path: string; message: string }>
  disabled?: boolean
  onAdd: (type: string) => void
  /** Drops a whole feature onto the canvas, wired and ready to run. */
  onAddRecipe?: (id: string) => void
  onAddExamplePlugin?: () => void
}

export function BlockPalette(props: BlockPaletteProps) {
  const {
    registry, pluginCount = 0, pluginProblems = [], disabled, onAdd, onAddRecipe, onAddExamplePlugin,
  } = props
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

      <p className="block-palette-help">Drag a block onto the canvas, or click to place it.</p>

      <input
        className="block-palette-filter"
        placeholder="Filter blocks"
        aria-label="Filter blocks"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      <div className="block-palette-groups">
        {/*
          Recipes come first because they are the fastest way to a running
          app: one click for the nine blocks a sign-in form would take.
        */}
        {Boolean(onAddRecipe) && !needle && (
          <section>
            <div className="section-heading">
              <span>START FROM</span>
              <span className="count-pill">{recipes.length}</span>
            </div>
            {recipes.map((recipe) => (
              <button
                key={recipe.id}
                className="block-palette-item recipe"
                disabled={disabled}
                title={recipe.summary}
                onClick={() => onAddRecipe?.(recipe.id)}
              >
                <span className="block-palette-label">{recipe.name}</span>
                <span className="block-palette-detail">{recipe.summary}</span>
              </button>
            ))}
          </section>
        )}

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
                title={`${block.description} — drag onto the canvas, or click to place it`}
                // Dragging is the point; the click is kept because it is
                // faster when you just want the block somewhere.
                draggable={!disabled}
                onDragStart={(event) => {
                  event.dataTransfer.setData(BLOCK_DRAG_TYPE, block.type)
                  event.dataTransfer.effectAllowed = 'copy'
                }}
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

      {Boolean(pluginProblems.length) && (
        <ul className="block-palette-problems">
          {pluginProblems.map((problem) => (
            <li key={problem.path}><strong>{problem.path}</strong> {problem.message}</li>
          ))}
        </ul>
      )}

      <footer className="block-palette-footer">
        <span>
          {registry.all().length} blocks
          {pluginCount > 0 && `, ${pluginCount} from plugins`}
        </span>
        {onAddExamplePlugin && (
          <button onClick={onAddExamplePlugin} title={`Writes an example manifest into ${'plugins/'}`}>
            Add plugin
          </button>
        )}
      </footer>
    </div>
  )
}
