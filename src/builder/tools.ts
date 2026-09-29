/**
 * The canvas tools.
 *
 * CorelDRAW's left rail works because the pointer means exactly one thing
 * at a time, and you always know which: the tool is the mode. This is the
 * same idea, kept small -- three tools that actually behave differently,
 * rather than a rail of icons that all do the same drag.
 *
 * The temporary override matters as much as the tools. Holding space pans
 * whatever tool is active, because reaching for the rail to move the view
 * and reaching back again is the thing that makes a canvas tiring.
 */

export type ToolId = 'pick' | 'pan' | 'marquee'

export type Tool = {
  id: ToolId
  label: string
  /** One line, for the tooltip. */
  hint: string
  /** The single key that selects it, CorelDRAW-style. */
  shortcut: string
  cursor: string
}

export const TOOLS: Tool[] = [
  {
    id: 'pick',
    label: 'Pick',
    hint: 'Select, move and wire blocks. Drag on empty canvas to marquee.',
    shortcut: 'v',
    cursor: 'default',
  },
  {
    id: 'pan',
    label: 'Pan',
    hint: 'Drag to move the view. Hold space with any tool to do the same.',
    shortcut: 'h',
    cursor: 'grab',
  },
  {
    id: 'marquee',
    label: 'Marquee',
    hint: 'Drag a box to select, even when it starts over a block.',
    shortcut: 'm',
    cursor: 'crosshair',
  },
]

export const DEFAULT_TOOL: ToolId = 'pick'

export function toolById(id: ToolId): Tool {
  return TOOLS.find((tool) => tool.id === id) ?? TOOLS[0]
}

/** The tool a single keypress selects, if any. */
export function toolForKey(key: string): ToolId | undefined {
  return TOOLS.find((tool) => tool.shortcut === key.toLowerCase())?.id
}

/**
 * What the pointer will actually do, once the temporary overrides are
 * taken into account.
 *
 * Space pans. Middle-drag pans, because it does everywhere else. And in
 * pick mode a drag that starts on bare canvas is a marquee -- which is why
 * the marquee tool exists separately: it marquees even when the drag
 * starts on top of a block.
 */
export function effectiveTool(
  tool: ToolId,
  modifiers: { space?: boolean; middleButton?: boolean } = {},
): ToolId {
  if (modifiers.space || modifiers.middleButton) return 'pan'
  return tool
}

/** The cursor for the surface, given the tool and what is happening. */
export function cursorFor(tool: ToolId, state: { panning?: boolean } = {}): string {
  if (state.panning) return 'grabbing'
  return toolById(tool).cursor
}
