/**
 * Default keybindings, using VS Code's own key assignments and `when` clauses so
 * that muscle memory carries over.
 *
 * `mod` resolves to Cmd on macOS and Ctrl elsewhere, matching how VS Code ships
 * separate mac/win keybinding tables.
 */

import type { KeybindingRule } from './keybindings'

export const defaultKeybindings: KeybindingRule[] = [
  // Quick access and the command palette.
  { command: 'workbench.action.showCommands', key: 'mod+shift+p' },
  { command: 'workbench.action.showCommands', key: 'f1' },
  { command: 'workbench.action.quickOpen', key: 'mod+p' },
  { command: 'workbench.action.gotoSymbol', key: 'mod+shift+o' },
  { command: 'workbench.action.showAllSymbols', key: 'mod+t' },
  { command: 'workbench.action.gotoLine', key: 'mod+g' },

  // Files.
  { command: 'workbench.action.files.newUntitledFile', key: 'mod+n' },
  { command: 'workbench.action.files.openFolder', key: 'mod+o' },
  { command: 'workbench.action.files.save', key: 'mod+s' },
  { command: 'workbench.action.files.saveAll', key: 'mod+k s' },
  { command: 'workbench.action.closeActiveEditor', key: 'mod+w' },
  { command: 'workbench.action.reopenClosedEditor', key: 'mod+shift+t' },
  { command: 'workbench.action.nextEditor', key: 'mod+alt+right' },
  { command: 'workbench.action.previousEditor', key: 'mod+alt+left' },
  { command: 'workbench.action.files.revealActiveFileInExplorer', key: 'mod+k r' },
  { command: 'workbench.action.files.copyPathOfActiveFile', key: 'mod+k p' },

  // Editor groups and splits.
  { command: 'workbench.action.splitEditor', key: 'mod+\\' },
  { command: 'workbench.action.closeEditorsInGroup', key: 'mod+k w' },
  { command: 'workbench.action.focusFirstEditorGroup', key: 'mod+1' },
  { command: 'workbench.action.focusSecondEditorGroup', key: 'mod+2' },

  // Layout.
  { command: 'workbench.action.toggleSidebarVisibility', key: 'mod+b' },
  { command: 'workbench.action.togglePanel', key: 'mod+j' },
  { command: 'workbench.action.toggleZenMode', key: 'mod+k z' },
  { command: 'workbench.action.toggleFullScreen', key: 'f11' },
  { command: 'workbench.action.toggleActivityBarVisibility', key: 'mod+k b' },
  { command: 'workbench.action.toggleCenteredLayout', key: 'mod+k mod+c' },

  // Views.
  { command: 'workbench.view.explorer', key: 'mod+shift+e' },
  { command: 'workbench.view.search', key: 'mod+shift+f' },
  { command: 'workbench.view.scm', key: 'mod+shift+g' },
  { command: 'workbench.view.debug', key: 'mod+shift+d' },
  { command: 'workbench.view.extensions', key: 'mod+shift+x' },
  { command: 'workbench.view.testing', key: 'mod+shift+y' },
  { command: 'workbench.actions.view.problems', key: 'mod+shift+m' },
  { command: 'workbench.action.output.toggleOutput', key: 'mod+shift+u' },
  { command: 'workbench.debug.action.toggleRepl', key: 'mod+shift+c' },

  // Terminal.
  { command: 'workbench.action.terminal.toggleTerminal', key: 'mod+`' },
  { command: 'workbench.action.terminal.new', key: 'mod+shift+`' },
  { command: 'workbench.action.terminal.split', key: 'mod+shift+5' },
  { command: 'workbench.action.terminal.kill', key: 'mod+k mod+x', when: 'terminalFocus' },
  { command: 'workbench.action.terminal.focusNext', key: 'mod+pagedown', when: 'terminalFocus' },
  { command: 'workbench.action.terminal.focusPrevious', key: 'mod+pageup', when: 'terminalFocus' },
  { command: 'workbench.action.terminal.clear', key: 'mod+k', when: 'terminalFocus' },

  // Editing.
  { command: 'editor.action.formatDocument', key: 'alt+shift+f', when: 'editorFocus' },
  { command: 'editor.action.commentLine', key: 'mod+/', when: 'editorFocus' },
  { command: 'editor.action.blockComment', key: 'alt+shift+a', when: 'editorFocus' },
  { command: 'editor.action.rename', key: 'f2', when: 'editorFocus' },
  { command: 'editor.action.revealDefinition', key: 'f12', when: 'editorFocus' },
  { command: 'editor.action.goToReferences', key: 'shift+f12', when: 'editorFocus' },
  { command: 'editor.action.quickFix', key: 'mod+.', when: 'editorFocus' },
  { command: 'editor.action.triggerSuggest', key: 'mod+space', when: 'editorFocus' },
  { command: 'editor.action.startFindReplaceAction', key: 'mod+h', when: 'editorFocus' },
  { command: 'editor.action.copyLinesDownAction', key: 'alt+shift+down', when: 'editorFocus' },
  { command: 'editor.action.moveLinesDownAction', key: 'alt+down', when: 'editorFocus' },
  { command: 'editor.action.moveLinesUpAction', key: 'alt+up', when: 'editorFocus' },
  { command: 'editor.action.deleteLines', key: 'mod+shift+k', when: 'editorFocus' },
  { command: 'editor.action.insertCursorBelow', key: 'mod+alt+down', when: 'editorFocus' },
  { command: 'editor.action.insertCursorAbove', key: 'mod+alt+up', when: 'editorFocus' },
  { command: 'editor.action.addSelectionToNextFindMatch', key: 'mod+d', when: 'editorFocus' },
  { command: 'editor.action.selectHighlights', key: 'mod+shift+l', when: 'editorFocus' },
  { command: 'editor.action.smartSelect.expand', key: 'alt+shift+right', when: 'editorFocus' },
  { command: 'editor.action.smartSelect.shrink', key: 'alt+shift+left', when: 'editorFocus' },
  { command: 'editor.action.indentLines', key: 'mod+]', when: 'editorFocus' },
  { command: 'editor.action.outdentLines', key: 'mod+[', when: 'editorFocus' },
  { command: 'editor.fold', key: 'mod+shift+[', when: 'editorFocus' },
  { command: 'editor.unfold', key: 'mod+shift+]', when: 'editorFocus' },
  { command: 'editor.foldAll', key: 'mod+k mod+0', when: 'editorFocus' },
  { command: 'editor.unfoldAll', key: 'mod+k mod+j', when: 'editorFocus' },

  // Run and debug.
  { command: 'workbench.action.debug.start', key: 'f5', when: '!debugState' },
  { command: 'workbench.action.debug.stop', key: 'shift+f5', when: 'debugState' },
  { command: 'workbench.action.debug.continue', key: 'f5', when: 'debugState == stopped' },
  { command: 'workbench.action.debug.stepOver', key: 'f10', when: 'debugState' },
  { command: 'workbench.action.debug.stepInto', key: 'f11', when: 'debugState' },
  { command: 'workbench.action.debug.stepOut', key: 'shift+f11', when: 'debugState' },
  { command: 'workbench.action.debug.restart', key: 'mod+shift+f5', when: 'debugState' },
  { command: 'editor.debug.action.toggleBreakpoint', key: 'f9', when: 'editorFocus' },
  { command: 'workbench.action.tasks.runTask', key: 'mod+shift+b' },
  { command: 'workbench.action.tungsten.runProject', key: 'mod+enter' },

  // Source control.
  { command: 'tungsten.git.commitStaged', key: 'mod+k mod+enter' },
  { command: 'tungsten.git.refresh', key: 'mod+shift+r' },

  // Preferences.
  { command: 'workbench.action.openSettings', key: 'mod+,' },
  { command: 'workbench.action.openGlobalKeybindings', key: 'mod+k mod+s' },
  { command: 'workbench.action.selectTheme', key: 'mod+k mod+t' },
  { command: 'workbench.action.zoomIn', key: 'mod+=' },
  { command: 'workbench.action.zoomOut', key: 'mod+-' },
  { command: 'workbench.action.zoomReset', key: 'mod+numpad0' },
]

export default defaultKeybindings
