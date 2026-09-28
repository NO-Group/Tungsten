/**
 * Configuration registry and layered resolution, modelled on VS Code's
 * configuration service.
 *
 * Settings are declared with a schema (type, default, description, enum), and
 * values resolve through the same precedence VS Code uses:
 *
 *   default  <  user  <  workspace  <  language-specific override
 *
 * Declaring the schema is what makes the settings UI, the settings JSON
 * editor, and validation all work from one source of truth.
 */

export type ConfigurationScope = 'application' | 'window' | 'resource' | 'language-overridable'

export interface ConfigurationPropertySchema {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'enum'
  default: unknown
  description: string
  /** Allowed values when `type` is `'enum'`. */
  enum?: string[]
  enumDescriptions?: string[]
  minimum?: number
  maximum?: number
  scope?: ConfigurationScope
  /** Grouping used by the settings UI. */
  category: string
  order?: number
  /** Marks a setting as needing a restart to take effect. */
  restartRequired?: boolean
  tags?: string[]
}

export type ConfigurationSchema = Record<string, ConfigurationPropertySchema>

export const configurationSchema: ConfigurationSchema = {
  // Editor
  'editor.fontSize': { type: 'number', default: 13, minimum: 6, maximum: 48, description: 'Controls the font size in pixels.', category: 'Editor', order: 1 },
  'editor.fontFamily': { type: 'string', default: "'JetBrains Mono', monospace", description: 'Controls the font family.', category: 'Editor', order: 2 },
  'editor.lineHeight': { type: 'number', default: 0, minimum: 0, maximum: 150, description: 'Line height. Use 0 to derive it from the font size.', category: 'Editor', order: 3 },
  'editor.tabSize': { type: 'number', default: 2, minimum: 1, maximum: 16, description: 'The number of spaces a tab is equal to.', category: 'Editor', order: 4 },
  'editor.insertSpaces': { type: 'boolean', default: true, description: 'Insert spaces when pressing Tab.', category: 'Editor', order: 5 },
  'editor.wordWrap': { type: 'enum', enum: ['off', 'on', 'wordWrapColumn', 'bounded'], default: 'off', description: 'Controls how lines should wrap.', category: 'Editor', order: 6 },
  'editor.minimap.enabled': { type: 'boolean', default: true, description: 'Controls whether the minimap is shown.', category: 'Editor', order: 7 },
  'editor.stickyScroll.enabled': { type: 'boolean', default: true, description: 'Shows the nested current scopes at the top of the editor.', category: 'Editor', order: 8 },
  'editor.renderWhitespace': { type: 'enum', enum: ['none', 'boundary', 'selection', 'trailing', 'all'], default: 'none', description: 'Controls how whitespace characters are rendered.', category: 'Editor', order: 9 },
  'editor.cursorBlinking': { type: 'enum', enum: ['blink', 'smooth', 'phase', 'expand', 'solid'], default: 'blink', description: 'Controls the cursor animation style.', category: 'Editor', order: 10 },
  'editor.cursorStyle': { type: 'enum', enum: ['line', 'block', 'underline', 'line-thin', 'block-outline', 'underline-thin'], default: 'line', description: 'Controls the cursor style.', category: 'Editor', order: 11 },
  'editor.bracketPairColorization.enabled': { type: 'boolean', default: true, description: 'Controls whether bracket pair colorization is enabled.', category: 'Editor', order: 12 },
  'editor.guides.bracketPairs': { type: 'boolean', default: false, description: 'Controls whether bracket pair guides are shown.', category: 'Editor', order: 13 },
  'editor.linkedEditing': { type: 'boolean', default: false, description: 'Rename the matching HTML/JSX tag while typing.', category: 'Editor', order: 14 },
  'editor.formatOnSave': { type: 'boolean', default: false, description: 'Format a file on save.', category: 'Editor', order: 15 },
  'editor.formatOnPaste': { type: 'boolean', default: false, description: 'Format pasted content.', category: 'Editor', order: 16 },
  'editor.tabCompletion': { type: 'enum', enum: ['off', 'on', 'onlySnippets'], default: 'on', description: 'Enables tab completions.', category: 'Editor', order: 17 },
  'editor.suggestOnTriggerCharacters': { type: 'boolean', default: true, description: 'Show suggestions automatically on trigger characters.', category: 'Editor', order: 18 },
  'editor.rulers': { type: 'array', default: [], description: 'Render vertical rulers after a certain number of monospace characters.', category: 'Editor', order: 19 },
  'editor.detectIndentation': { type: 'boolean', default: true, description: 'Detect tab size and indentation from file contents.', category: 'Editor', order: 20 },

  // Files
  'files.autoSave': { type: 'enum', enum: ['off', 'afterDelay', 'onFocusChange', 'onWindowChange'], default: 'off', description: 'Controls auto save of editors that have unsaved changes.', category: 'Files', order: 1 },
  'files.autoSaveDelay': { type: 'number', default: 1000, minimum: 100, maximum: 60000, description: 'Delay in milliseconds before an edited file is saved automatically.', category: 'Files', order: 2 },
  'files.trimTrailingWhitespace': { type: 'boolean', default: false, description: 'Trim trailing whitespace when saving a file.', category: 'Files', order: 3 },
  'files.insertFinalNewline': { type: 'boolean', default: false, description: 'Insert a final newline at the end of the file when saving.', category: 'Files', order: 4 },
  'files.eol': { type: 'enum', enum: ['\n', '\r\n', 'auto'], default: 'auto', description: 'The default end of line character.', category: 'Files', order: 5 },
  'files.exclude': { type: 'object', default: { '**/.git': true, '**/.DS_Store': true }, description: 'Files and folders to hide from the explorer.', category: 'Files', order: 6 },

  // Workbench
  'workbench.colorTheme': { type: 'string', default: 'dark-modern', description: 'Specifies the colour theme used in the workbench.', category: 'Workbench', order: 1 },
  'workbench.iconTheme': { type: 'string', default: 'seti', description: 'Specifies the file icon theme.', category: 'Workbench', order: 2 },
  'workbench.startupEditor': { type: 'enum', enum: ['none', 'welcomePage', 'readme', 'newUntitledFile'], default: 'welcomePage', description: 'Controls which editor is shown at startup.', category: 'Workbench', order: 3 },
  'workbench.editor.showTabs': { type: 'boolean', default: true, description: 'Controls whether opened editors should show in tabs.', category: 'Workbench', order: 4 },
  'workbench.editor.enablePreview': { type: 'boolean', default: true, description: 'Single-clicking a file opens it in preview mode.', category: 'Workbench', order: 5 },
  'workbench.editor.tabSizing': { type: 'enum', enum: ['fit', 'shrink', 'fixed'], default: 'fit', description: 'Controls the sizing of editor tabs.', category: 'Workbench', order: 6 },
  'workbench.list.smoothScrolling': { type: 'boolean', default: false, description: 'Controls whether lists and trees have smooth scrolling.', category: 'Workbench', order: 7 },
  'workbench.tree.indent': { type: 'number', default: 8, minimum: 4, maximum: 40, description: 'Indentation in pixels for tree items.', category: 'Workbench', order: 8 },
  'workbench.activityBar.visible': { type: 'boolean', default: true, description: 'Controls the visibility of the activity bar.', category: 'Workbench', order: 9 },
  'workbench.statusBar.visible': { type: 'boolean', default: true, description: 'Controls the visibility of the status bar.', category: 'Workbench', order: 10 },
  'workbench.sideBar.location': { type: 'enum', enum: ['left', 'right'], default: 'left', description: 'Controls the location of the primary side bar.', category: 'Workbench', order: 11 },

  // Terminal
  'terminal.integrated.fontSize': { type: 'number', default: 12, minimum: 6, maximum: 40, description: 'Controls the font size in pixels of the terminal.', category: 'Terminal', order: 1 },
  'terminal.integrated.fontFamily': { type: 'string', default: "'JetBrains Mono', monospace", description: 'Controls the font family of the terminal.', category: 'Terminal', order: 2 },
  'terminal.integrated.cursorBlinking': { type: 'boolean', default: true, description: 'Controls whether the terminal cursor blinks.', category: 'Terminal', order: 3 },
  'terminal.integrated.cursorStyle': { type: 'enum', enum: ['block', 'line', 'underline'], default: 'block', description: 'Controls the style of the terminal cursor.', category: 'Terminal', order: 4 },
  'terminal.integrated.scrollback': { type: 'number', default: 1000, minimum: 100, maximum: 100000, description: 'Controls the maximum number of lines the terminal keeps.', category: 'Terminal', order: 5 },
  'terminal.integrated.copyOnSelection': { type: 'boolean', default: false, description: 'Copy text to the clipboard on selection.', category: 'Terminal', order: 6 },

  // Search
  'search.exclude': { type: 'object', default: { '**/node_modules': true, '**/dist': true }, description: 'Files and folders to exclude from full-text searches.', category: 'Search', order: 1 },
  'search.useIgnoreFiles': { type: 'boolean', default: true, description: 'Respect .gitignore when searching.', category: 'Search', order: 2 },
  'search.smartCase': { type: 'boolean', default: false, description: 'Search case-insensitively unless the query contains an uppercase letter.', category: 'Search', order: 3 },
  'search.maxResults': { type: 'number', default: 20000, minimum: 1000, maximum: 100000, description: 'Maximum number of search results.', category: 'Search', order: 4 },

  // Git
  'git.enabled': { type: 'boolean', default: true, description: 'Whether git is enabled.', category: 'Git', order: 1 },
  'git.autofetch': { type: 'boolean', default: false, description: 'Periodically fetch from remotes.', category: 'Git', order: 2 },
  'git.confirmSync': { type: 'boolean', default: true, description: 'Confirm before synchronising git repositories.', category: 'Git', order: 3 },
  'git.enableSmartCommit': { type: 'boolean', default: false, description: 'Commit all changes when there are no staged changes.', category: 'Git', order: 4 },
  'git.decorations.enabled': { type: 'boolean', default: true, description: 'Show git status decorations in the explorer.', category: 'Git', order: 5 },

  // Accessibility
  'accessibility.reducedMotion': { type: 'boolean', default: false, description: 'Reduce animation throughout the workbench.', category: 'Accessibility', order: 1 },
  'accessibility.screenReaderOptimized': { type: 'boolean', default: false, description: 'Optimise the workbench for screen readers.', category: 'Accessibility', order: 2 },
  'accessibility.highContrast': { type: 'boolean', default: false, description: 'Increase contrast throughout the workbench.', category: 'Accessibility', order: 3 },

  // Telemetry
  'telemetry.telemetryLevel': { type: 'enum', enum: ['all', 'error', 'crash', 'off'], default: 'off', description: 'Controls what data is sent to the telemetry endpoint.', category: 'Telemetry', order: 1 },
  'telemetry.crashReports': { type: 'boolean', default: true, description: 'Allow packaged builds to write local crash diagnostics.', category: 'Telemetry', order: 2 },
}

export interface ConfigurationLayers {
  user?: Record<string, unknown>
  workspace?: Record<string, unknown>
  /** `[languageId][key]` overrides, from `"[typescript]": { ... }` blocks. */
  language?: Record<string, Record<string, unknown>>
}

/** Resolves one key through the precedence chain. */
export function resolveConfiguration<T = unknown>(
  key: string,
  layers: ConfigurationLayers,
  languageId?: string,
): T {
  const schema = configurationSchema[key]
  if (languageId && layers.language?.[languageId] && key in layers.language[languageId]) {
    return layers.language[languageId][key] as T
  }
  if (layers.workspace && key in layers.workspace) return layers.workspace[key] as T
  if (layers.user && key in layers.user) return layers.user[key] as T
  return schema?.default as T
}

/** Snapshot of every setting, fully resolved. */
export function resolveAll(layers: ConfigurationLayers, languageId?: string): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(configurationSchema)) {
    out[key] = resolveConfiguration(key, layers, languageId)
  }
  return out
}

export interface ValidationIssue {
  key: string
  message: string
}

/** Validates values against the schema; used by the settings JSON editor. */
export function validateConfiguration(values: Record<string, unknown>): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  for (const [key, value] of Object.entries(values)) {
    // Language override blocks carry their own nested settings.
    if (/^\[.+\]$/.test(key)) {
      if (value && typeof value === 'object') {
        issues.push(...validateConfiguration(value as Record<string, unknown>).map((issue) => ({
          ...issue,
          key: `${key}.${issue.key}`,
        })))
      }
      continue
    }
    const schema = configurationSchema[key]
    if (!schema) {
      issues.push({ key, message: `Unknown setting "${key}".` })
      continue
    }
    switch (schema.type) {
      case 'enum':
        if (!schema.enum?.includes(String(value))) {
          issues.push({ key, message: `Value must be one of: ${schema.enum?.join(', ')}.` })
        }
        break
      case 'number':
        if (typeof value !== 'number' || Number.isNaN(value)) {
          issues.push({ key, message: 'Value must be a number.' })
        } else {
          if (schema.minimum !== undefined && value < schema.minimum) {
            issues.push({ key, message: `Value must be at least ${schema.minimum}.` })
          }
          if (schema.maximum !== undefined && value > schema.maximum) {
            issues.push({ key, message: `Value must be at most ${schema.maximum}.` })
          }
        }
        break
      case 'boolean':
        if (typeof value !== 'boolean') issues.push({ key, message: 'Value must be true or false.' })
        break
      case 'string':
        if (typeof value !== 'string') issues.push({ key, message: 'Value must be a string.' })
        break
      case 'array':
        if (!Array.isArray(value)) issues.push({ key, message: 'Value must be an array.' })
        break
      case 'object':
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          issues.push({ key, message: 'Value must be an object.' })
        }
        break
      default:
        break
    }
  }
  return issues
}

/** Settings grouped by category, for the settings UI. */
export function configurationByCategory(): Array<{ category: string; keys: string[] }> {
  const groups = new Map<string, string[]>()
  for (const [key, schema] of Object.entries(configurationSchema)) {
    groups.set(schema.category, [...(groups.get(schema.category) ?? []), key])
  }
  return [...groups.entries()]
    .map(([category, keys]) => ({
      category,
      keys: keys.sort((a, b) => (configurationSchema[a].order ?? 0) - (configurationSchema[b].order ?? 0)),
    }))
    .sort((a, b) => a.category.localeCompare(b.category))
}

/** Matches settings against the settings-editor search box. */
export function searchConfiguration(query: string): string[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return Object.keys(configurationSchema)
  return Object.entries(configurationSchema)
    .filter(([key, schema]) => key.toLowerCase().includes(needle)
      || schema.description.toLowerCase().includes(needle)
      || schema.category.toLowerCase().includes(needle))
    .map(([key]) => key)
}

/** Serialises only non-default values, the way VS Code writes settings.json. */
export function toSettingsJson(values: Record<string, unknown>): string {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(values)) {
    const schema = configurationSchema[key]
    if (schema && JSON.stringify(schema.default) === JSON.stringify(value)) continue
    out[key] = value
  }
  return `${JSON.stringify(out, null, 2)}\n`
}
