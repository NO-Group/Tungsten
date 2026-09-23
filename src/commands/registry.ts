/**
 * Command registry, modelled on VS Code's `CommandsRegistry` + menu contributions.
 *
 * Every user-visible action in the workbench is registered here with a stable id,
 * a category and an optional `when` clause. The command palette, the menu bar,
 * the keybinding editor and extension contributions all read from this one place,
 * so a command only has to be declared once to appear everywhere with its
 * correct keyboard shortcut.
 */

import type { Context } from '../keybinding/contextkey'
import { parseWhenClause, type ContextKeyExpression } from '../keybinding/contextkey'

export type CommandCategory =
  | 'File' | 'Edit' | 'Selection' | 'View' | 'Go' | 'Run' | 'Terminal'
  | 'Git' | 'Test' | 'Debug' | 'Preferences' | 'Extensions' | 'Remote' | 'Help'

export type CommandHandler = (...args: unknown[]) => void | Promise<void>

export type CommandDescriptor = {
  id: string
  title: string
  category: CommandCategory
  /** Optional longer description shown as the palette's secondary line. */
  detail?: string
  /** When clause controlling palette visibility and keybinding dispatch. */
  when?: string
  /** Icon name resolved by the UI layer. */
  icon?: string
  /** Lower sorts first within a category. */
  order?: number
}

export type RegisteredCommand = CommandDescriptor & {
  handler: CommandHandler
  expression: ContextKeyExpression
}

/**
 * A registry instance. The workbench creates one per session and re-registers
 * handlers when React state changes, so handlers always close over fresh state.
 */
export class CommandRegistry {
  private readonly commands = new Map<string, RegisteredCommand>()
  private readonly listeners = new Set<() => void>()

  register(descriptor: CommandDescriptor, handler: CommandHandler): () => void {
    this.commands.set(descriptor.id, {
      ...descriptor,
      handler,
      expression: parseWhenClause(descriptor.when),
    })
    this.emit()
    return () => { this.commands.delete(descriptor.id); this.emit() }
  }

  /** Register many commands at once; returns a disposer for the whole batch. */
  registerAll(entries: Array<CommandDescriptor & { handler: CommandHandler }>): () => void {
    const disposers = entries.map(({ handler, ...descriptor }) => this.register(descriptor, handler))
    return () => disposers.forEach((dispose) => dispose())
  }

  get(id: string): RegisteredCommand | undefined {
    return this.commands.get(id)
  }

  has(id: string) {
    return this.commands.has(id)
  }

  all(): RegisteredCommand[] {
    return [...this.commands.values()]
  }

  /** Commands whose `when` clause currently passes — what the palette should list. */
  visible(context: Context): RegisteredCommand[] {
    return this.all().filter((command) => command.expression.evaluate(context))
  }

  /**
   * Execute a command by id. Returns false when the command is unknown or its
   * `when` clause fails, so callers can surface "command not available".
   */
  async execute(id: string, context: Context = {}, ...args: unknown[]): Promise<boolean> {
    const command = this.commands.get(id)
    if (!command || !command.expression.evaluate(context)) return false
    await command.handler(...args)
    return true
  }

  onDidChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit() {
    for (const listener of this.listeners) listener()
  }
}

/** Full palette label, e.g. `File: Save All` — exactly VS Code's format. */
export function commandLabel(command: CommandDescriptor) {
  return `${command.category}: ${command.title}`
}

export const commandRegistry = new CommandRegistry()
