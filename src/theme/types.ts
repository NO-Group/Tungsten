/**
 * Theme model shared by the generated VS Code themes and the runtime theme service.
 *
 * `workbench` drives Tungsten's CSS custom properties, `editor`/`rules` are handed
 * straight to Monaco's `defineTheme`, and `terminal` is applied to xterm.js.
 */

export type ThemeKind = 'dark' | 'light' | 'hc-dark' | 'hc-light'
export type MonacoBase = 'vs' | 'vs-dark' | 'hc-black' | 'hc-light'

export type WorkbenchPalette = {
  background: string
  foreground: string
  border: string
  chrome: string
  chromeForeground: string
  activityBar: string
  activityBarForeground: string
  activityBarInactive: string
  activityBarBorder: string
  badge: string
  badgeForeground: string
  sidebar: string
  sidebarForeground: string
  sidebarTitle: string
  sectionHeader: string
  statusBar: string
  statusBarForeground: string
  statusBarRemote: string
  statusBarRemoteForeground: string
  tabActive: string
  tabActiveForeground: string
  tabInactive: string
  tabInactiveForeground: string
  tabBorder: string
  tabActiveBorderTop: string
  panel: string
  panelBorder: string
  listHover: string
  listActive: string
  listActiveForeground: string
  listInactive: string
  input: string
  inputForeground: string
  inputBorder: string
  button: string
  buttonForeground: string
  buttonHover: string
  widget: string
  widgetBorder: string
  widgetShadow: string
  focusBorder: string
  accent: string
  muted: string
  error: string
  warning: string
  info: string
  success: string
  added: string
  modified: string
  deleted: string
  terminalBackground: string
  terminalForeground: string
  scrollbar: string
  scrollbarHover: string
  selection: string
  menuBackground: string
  menuForeground: string
  menuSelection: string
}

export type TerminalPalette = {
  background: string
  foreground: string
  cursor: string
  selectionBackground: string
  black: string
  red: string
  green: string
  yellow: string
  blue: string
  magenta: string
  cyan: string
  white: string
  brightBlack: string
  brightRed: string
  brightGreen: string
  brightYellow: string
  brightBlue: string
  brightMagenta: string
  brightCyan: string
  brightWhite: string
}

export type TokenRule = {
  token: string
  foreground?: string
  background?: string
  fontStyle?: string
}

export type TungstenTheme = {
  id: string
  label: string
  kind: ThemeKind
  base: MonacoBase
  workbench: WorkbenchPalette
  terminal: TerminalPalette
  editor: Record<string, string>
  rules: TokenRule[]
  semanticHighlighting: boolean
}
