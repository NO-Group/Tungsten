#!/usr/bin/env node
/**
 * Generates the Graphene VS Code colour theme from `tokens.json`.
 *
 * The output is a real VS Code theme contribution — the same format shipped by
 * `extensions/theme-defaults` upstream — so the forked workbench, the Monaco
 * editor inside it, and the integrated terminal all paint from one source.
 *
 * Every colour in the output is derived from a token. Nothing is hard-coded
 * here, so retuning the design language is a one-file change.
 *
 *   node fork/graphene/buildTheme.mjs [--out <dir>] [--check]
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const tokens = JSON.parse(readFileSync(resolve(here, 'tokens.json'), 'utf8'))

const { ramp, ink, accent, signal, syntax } = tokens

/* ------------------------------------------------------------------ *
 * Colour helpers
 * ------------------------------------------------------------------ */

const clamp = (value) => Math.max(0, Math.min(255, Math.round(value)))

function rgb(hex) {
  let h = hex.replace('#', '')
  if (h.length === 3) h = [...h].map((c) => c + c).join('')
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
}

/** Adds an alpha channel: `alpha('#c8f169', 0.25)` -> `#c8f16940`. */
function alpha(hex, value) {
  const a = clamp(value * 255).toString(16).padStart(2, '0')
  return `${hex.slice(0, 7)}${a}`.toLowerCase()
}

/** Linear blend, `amount` = how much of `a` survives. */
function mix(a, b, amount) {
  const [r1, g1, b1] = rgb(a)
  const [r2, g2, b2] = rgb(b)
  const f = (x, y) => clamp(x * amount + y * (1 - amount)).toString(16).padStart(2, '0')
  return `#${f(r1, r2)}${f(g1, g2)}${f(b1, b2)}`.toLowerCase()
}

/* ------------------------------------------------------------------ *
 * Workbench colours
 * ------------------------------------------------------------------ */

const selection = alpha(accent.base, 0.18)
const selectionInactive = alpha(accent.base, 0.1)
const lineHighlight = mix(ramp.base, ink.body, 0.94)

const colors = {
  /* -- base -------------------------------------------------------- */
  // The focus ring is the accent at full strength. It is the one affordance
  // a keyboard user depends on, so it does not get the dimmed stop — and it
  // has to agree with the `:focus-visible` rule in the workbench stylesheet,
  // or focus reads as two different colours depending on which widget has it.
  focusBorder: accent.base,
  foreground: ink.body,
  disabledForeground: ink.faint,
  descriptionForeground: ink.muted,
  errorForeground: signal.danger,
  'icon.foreground': ink.muted,
  'selection.background': selection,
  'widget.border': ramp.borderStrong,
  'widget.shadow': '#00000099',
  'sash.hoverBorder': accent.base,

  /* -- text -------------------------------------------------------- */
  'textLink.foreground': accent.base,
  'textLink.activeForeground': accent.bright,
  'textBlockQuote.background': ramp.raised,
  'textBlockQuote.border': accent.border,
  'textCodeBlock.background': ramp.void,
  'textPreformat.foreground': accent.bright,
  'textPreformat.background': alpha(accent.base, 0.1),
  'textSeparator.foreground': ramp.border,

  /* -- buttons ----------------------------------------------------- */
  'button.background': accent.base,
  'button.foreground': ink.inverse,
  'button.hoverBackground': accent.bright,
  'button.border': 'transparent',
  'button.secondaryBackground': ramp.overlay,
  'button.secondaryForeground': ink.body,
  'button.secondaryHoverBackground': ramp.hover,
  'checkbox.background': ramp.void,
  'checkbox.foreground': ink.body,
  'checkbox.border': ramp.borderStrong,

  /* -- dropdown ---------------------------------------------------- */
  'dropdown.background': ramp.raised,
  'dropdown.listBackground': ramp.raised,
  'dropdown.border': ramp.borderStrong,
  'dropdown.foreground': ink.body,

  /* -- input ------------------------------------------------------- */
  'input.background': ramp.void,
  'input.foreground': ink.body,
  'input.border': ramp.border,
  'input.placeholderForeground': ink.faint,
  'inputOption.activeBackground': alpha(accent.base, 0.24),
  'inputOption.activeBorder': accent.base,
  'inputOption.activeForeground': ink.strong,
  'inputValidation.errorBackground': mix(signal.danger, ramp.base, 0.2),
  'inputValidation.errorBorder': signal.danger,
  'inputValidation.warningBackground': mix(signal.warning, ramp.base, 0.2),
  'inputValidation.warningBorder': signal.warning,
  'inputValidation.infoBackground': mix(signal.info, ramp.base, 0.2),
  'inputValidation.infoBorder': signal.info,

  /* -- scrollbar --------------------------------------------------- */
  'scrollbar.shadow': '#00000066',
  'scrollbarSlider.background': alpha(ink.faint, 0.28),
  'scrollbarSlider.hoverBackground': alpha(ink.muted, 0.4),
  'scrollbarSlider.activeBackground': alpha(accent.base, 0.5),

  /* -- badge / progress -------------------------------------------- */
  'badge.background': accent.base,
  'badge.foreground': ink.inverse,
  'progressBar.background': accent.base,

  /* -- lists ------------------------------------------------------- */
  'list.activeSelectionBackground': ramp.selected,
  'list.activeSelectionForeground': ink.strong,
  'list.activeSelectionIconForeground': accent.base,
  'list.inactiveSelectionBackground': ramp.hover,
  'list.inactiveSelectionForeground': ink.body,
  'list.hoverBackground': ramp.hover,
  'list.hoverForeground': ink.body,
  'list.focusBackground': ramp.selected,
  'list.focusForeground': ink.strong,
  'list.focusOutline': accent.border,
  'list.highlightForeground': accent.base,
  'list.focusHighlightForeground': accent.bright,
  'list.dropBackground': alpha(accent.base, 0.12),
  'list.errorForeground': signal.danger,
  'list.warningForeground': signal.warning,
  'list.invalidItemForeground': ink.faint,
  'list.deemphasizedForeground': ink.faint,
  'listFilterWidget.background': ramp.raised,
  'listFilterWidget.outline': accent.base,
  'listFilterWidget.noMatchesOutline': signal.danger,
  'tree.indentGuidesStroke': ramp.border,
  'tree.inactiveIndentGuidesStroke': mix(ramp.border, ramp.base, 0.5),
  'tree.tableColumnsBorder': ramp.border,

  /* -- activity bar ------------------------------------------------ */
  'activityBar.background': ramp.chrome,
  'activityBar.foreground': accent.base,
  'activityBar.inactiveForeground': ink.faint,
  'activityBar.border': ramp.border,
  'activityBar.activeBorder': accent.base,
  'activityBar.activeBackground': alpha(accent.base, 0.08),
  'activityBar.activeFocusBorder': accent.bright,
  'activityBarBadge.background': accent.base,
  'activityBarBadge.foreground': ink.inverse,
  'activityBarTop.foreground': accent.base,
  'activityBarTop.inactiveForeground': ink.faint,
  'activityBarTop.activeBorder': accent.base,

  /* -- side bar ---------------------------------------------------- */
  'sideBar.background': ramp.sidebar,
  'sideBar.foreground': ink.body,
  'sideBar.border': ramp.border,
  'sideBar.dropBackground': alpha(accent.base, 0.1),
  'sideBarTitle.foreground': ink.muted,
  'sideBarSectionHeader.background': ramp.sidebar,
  'sideBarSectionHeader.foreground': ink.muted,
  'sideBarSectionHeader.border': ramp.border,
  'sideBarActivityBarTop.border': ramp.border,

  /* -- editor groups & tabs ---------------------------------------- */
  'editorGroup.border': ramp.border,
  'editorGroup.dropBackground': alpha(accent.base, 0.12),
  'editorGroupHeader.tabsBackground': ramp.chrome,
  'editorGroupHeader.tabsBorder': ramp.border,
  'editorGroupHeader.noTabsBackground': ramp.chrome,
  'editorGroup.emptyBackground': ramp.base,
  'tab.activeBackground': ramp.base,
  'tab.activeForeground': ink.strong,
  'tab.activeBorderTop': accent.base,
  'tab.activeBorder': ramp.base,
  'tab.inactiveBackground': ramp.chrome,
  'tab.inactiveForeground': ink.faint,
  'tab.hoverBackground': ramp.hover,
  'tab.hoverForeground': ink.body,
  'tab.border': ramp.border,
  'tab.unfocusedActiveBackground': ramp.chrome,
  'tab.unfocusedActiveForeground': ink.muted,
  'tab.unfocusedActiveBorderTop': mix(accent.base, ramp.chrome, 0.4),
  'tab.unfocusedInactiveBackground': ramp.chrome,
  'tab.unfocusedInactiveForeground': ink.faint,
  'tab.lastPinnedBorder': accent.border,
  'tab.dragAndDropBorder': accent.base,
  'editorPane.background': ramp.base,

  /* -- editor core ------------------------------------------------- */
  'editor.background': ramp.base,
  'editor.foreground': ink.body,
  'editorLineNumber.foreground': ink.faint,
  'editorLineNumber.activeForeground': accent.base,
  'editorLineNumber.dimmedForeground': mix(ink.faint, ramp.base, 0.5),
  'editorCursor.foreground': accent.base,
  'editorCursor.background': ramp.base,
  'editor.selectionBackground': selection,
  'editor.selectionForeground': ink.strong,
  'editor.inactiveSelectionBackground': selectionInactive,
  'editor.selectionHighlightBackground': alpha(accent.base, 0.12),
  'editor.selectionHighlightBorder': alpha(accent.base, 0.3),
  'editor.wordHighlightBackground': alpha(signal.info, 0.14),
  'editor.wordHighlightStrongBackground': alpha(accent.base, 0.16),
  'editor.findMatchBackground': alpha(accent.base, 0.34),
  'editor.findMatchHighlightBackground': alpha(accent.base, 0.18),
  'editor.findMatchBorder': accent.base,
  'editor.findRangeHighlightBackground': alpha(ink.faint, 0.14),
  'editor.hoverHighlightBackground': alpha(signal.info, 0.14),
  'editor.lineHighlightBackground': lineHighlight,
  'editor.lineHighlightBorder': 'transparent',
  'editor.rangeHighlightBackground': alpha(accent.base, 0.08),
  'editor.symbolHighlightBackground': alpha(accent.base, 0.16),
  'editorLink.activeForeground': accent.bright,
  'editorWhitespace.foreground': mix(ink.faint, ramp.base, 0.45),
  'editorIndentGuide.background1': ramp.border,
  'editorIndentGuide.activeBackground1': accent.border,
  'editorRuler.foreground': ramp.border,
  'editorCodeLens.foreground': ink.faint,
  'editorLightBulb.foreground': signal.warning,
  'editorLightBulbAutoFix.foreground': accent.base,
  'editorBracketMatch.background': alpha(accent.base, 0.16),
  'editorBracketMatch.border': accent.border,
  'editorUnicodeHighlight.border': signal.warning,

  /* -- bracket pair colourisation ---------------------------------- */
  'editorBracketHighlight.foreground1': accent.base,
  'editorBracketHighlight.foreground2': signal.info,
  'editorBracketHighlight.foreground3': syntax.type,
  'editorBracketHighlight.foreground4': signal.warning,
  'editorBracketHighlight.foreground5': syntax.regexp,
  'editorBracketHighlight.foreground6': ink.muted,
  'editorBracketHighlight.unexpectedBracket.foreground': signal.danger,

  /* -- overview ruler & errors ------------------------------------- */
  'editorOverviewRuler.border': ramp.border,
  'editorOverviewRuler.findMatchForeground': alpha(accent.base, 0.6),
  'editorOverviewRuler.errorForeground': signal.danger,
  'editorOverviewRuler.warningForeground': signal.warning,
  'editorOverviewRuler.infoForeground': signal.info,
  'editorOverviewRuler.addedForeground': signal.added,
  'editorOverviewRuler.modifiedForeground': signal.modified,
  'editorOverviewRuler.deletedForeground': signal.deleted,
  'editorError.foreground': signal.danger,
  'editorWarning.foreground': signal.warning,
  'editorInfo.foreground': signal.info,
  'editorHint.foreground': ink.muted,
  'editorGutter.background': ramp.base,
  'editorGutter.addedBackground': signal.added,
  'editorGutter.modifiedBackground': signal.modified,
  'editorGutter.deletedBackground': signal.deleted,
  'editorGutter.commentRangeForeground': ink.faint,

  /* -- diff -------------------------------------------------------- */
  'diffEditor.insertedTextBackground': alpha(signal.added, 0.16),
  'diffEditor.removedTextBackground': alpha(signal.deleted, 0.16),
  'diffEditor.insertedLineBackground': alpha(signal.added, 0.1),
  'diffEditor.removedLineBackground': alpha(signal.deleted, 0.1),
  'diffEditor.border': ramp.border,
  'diffEditor.diagonalFill': ramp.border,
  'diffEditorOverview.insertedForeground': alpha(signal.added, 0.6),
  'diffEditorOverview.removedForeground': alpha(signal.deleted, 0.6),

  /* -- widgets ----------------------------------------------------- */
  'editorWidget.background': ramp.raised,
  'editorWidget.foreground': ink.body,
  'editorWidget.border': ramp.borderStrong,
  'editorWidget.resizeBorder': accent.base,
  'editorSuggestWidget.background': ramp.raised,
  'editorSuggestWidget.border': ramp.borderStrong,
  'editorSuggestWidget.foreground': ink.body,
  'editorSuggestWidget.selectedBackground': ramp.selected,
  'editorSuggestWidget.selectedForeground': ink.strong,
  'editorSuggestWidget.highlightForeground': accent.base,
  'editorSuggestWidget.focusHighlightForeground': accent.bright,
  'editorHoverWidget.background': ramp.raised,
  'editorHoverWidget.foreground': ink.body,
  'editorHoverWidget.border': ramp.borderStrong,
  'editorHoverWidget.highlightForeground': accent.base,
  'editorGhostText.foreground': ink.faint,
  'debugExceptionWidget.background': mix(signal.danger, ramp.base, 0.2),
  'debugExceptionWidget.border': signal.danger,
  'editorMarkerNavigation.background': ramp.raised,
  'editorMarkerNavigationError.background': signal.danger,
  'editorMarkerNavigationWarning.background': signal.warning,
  'editorMarkerNavigationInfo.background': signal.info,

  /* -- peek view --------------------------------------------------- */
  'peekView.border': accent.border,
  'peekViewEditor.background': ramp.void,
  'peekViewEditor.matchHighlightBackground': alpha(accent.base, 0.24),
  'peekViewEditorGutter.background': ramp.void,
  'peekViewResult.background': ramp.raised,
  'peekViewResult.foreground': ink.body,
  'peekViewResult.selectionBackground': ramp.selected,
  'peekViewResult.selectionForeground': ink.strong,
  'peekViewResult.lineForeground': ink.muted,
  'peekViewResult.fileForeground': ink.strong,
  'peekViewResult.matchHighlightBackground': alpha(accent.base, 0.24),
  'peekViewTitle.background': ramp.raised,
  'peekViewTitleLabel.foreground': ink.strong,
  'peekViewTitleDescription.foreground': ink.muted,

  /* -- panel ------------------------------------------------------- */
  'panel.background': ramp.base,
  'panel.border': ramp.border,
  'panel.dropBorder': accent.base,
  'panelTitle.activeBorder': accent.base,
  'panelTitle.activeForeground': ink.strong,
  'panelTitle.inactiveForeground': ink.faint,
  'panelSection.border': ramp.border,
  'panelSectionHeader.background': ramp.chrome,
  'panelSectionHeader.foreground': ink.muted,
  'panelInput.border': ramp.border,

  /* -- status bar -------------------------------------------------- */
  'statusBar.background': ramp.chrome,
  'statusBar.foreground': ink.muted,
  'statusBar.border': ramp.border,
  'statusBar.debuggingBackground': accent.dim,
  'statusBar.debuggingForeground': ink.inverse,
  'statusBar.debuggingBorder': accent.base,
  'statusBar.noFolderBackground': ramp.chrome,
  'statusBar.noFolderForeground': ink.muted,
  'statusBar.noFolderBorder': ramp.border,
  'statusBarItem.activeBackground': alpha(accent.base, 0.2),
  'statusBarItem.hoverBackground': ramp.hover,
  'statusBarItem.hoverForeground': ink.strong,
  'statusBarItem.prominentBackground': alpha(accent.base, 0.2),
  'statusBarItem.prominentForeground': ink.strong,
  'statusBarItem.prominentHoverBackground': alpha(accent.base, 0.3),
  'statusBarItem.remoteBackground': accent.base,
  'statusBarItem.remoteForeground': ink.inverse,
  'statusBarItem.errorBackground': signal.danger,
  'statusBarItem.errorForeground': ink.strong,
  'statusBarItem.warningBackground': signal.warning,
  'statusBarItem.warningForeground': ink.inverse,
  'statusBarItem.compactHoverBackground': ramp.hover,
  'statusBarItem.focusBorder': accent.base,
  'statusBar.focusBorder': accent.base,

  /* -- title bar --------------------------------------------------- */
  'titleBar.activeBackground': ramp.chrome,
  'titleBar.activeForeground': ink.body,
  'titleBar.inactiveBackground': ramp.chrome,
  'titleBar.inactiveForeground': ink.faint,
  'titleBar.border': ramp.border,

  /* -- menus ------------------------------------------------------- */
  'menubar.selectionBackground': ramp.hover,
  'menubar.selectionForeground': ink.strong,
  'menubar.selectionBorder': 'transparent',
  'menu.background': ramp.raised,
  'menu.foreground': ink.body,
  'menu.selectionBackground': ramp.selected,
  'menu.selectionForeground': ink.strong,
  'menu.selectionBorder': 'transparent',
  'menu.separatorBackground': ramp.border,
  'menu.border': ramp.borderStrong,

  /* -- command centre / quick input -------------------------------- */
  'commandCenter.background': ramp.raised,
  'commandCenter.foreground': ink.muted,
  'commandCenter.border': ramp.border,
  'commandCenter.activeBackground': ramp.hover,
  'commandCenter.activeForeground': ink.strong,
  'commandCenter.activeBorder': accent.border,
  'quickInput.background': ramp.raised,
  'quickInput.foreground': ink.body,
  'quickInputTitle.background': ramp.overlay,
  'quickInputList.focusBackground': ramp.selected,
  'quickInputList.focusForeground': ink.strong,
  'quickInputList.focusIconForeground': accent.base,
  'pickerGroup.border': ramp.border,
  'pickerGroup.foreground': accent.base,
  'keybindingLabel.background': ramp.void,
  'keybindingLabel.foreground': ink.body,
  'keybindingLabel.border': ramp.borderStrong,
  'keybindingLabel.bottomBorder': ramp.border,
  'keybindingTable.headerBackground': ramp.chrome,
  'keybindingTable.rowsBackground': ramp.base,

  /* -- notifications ----------------------------------------------- */
  'notificationCenter.border': ramp.borderStrong,
  'notificationCenterHeader.background': ramp.overlay,
  'notificationCenterHeader.foreground': ink.muted,
  'notifications.background': ramp.raised,
  'notifications.foreground': ink.body,
  'notifications.border': ramp.border,
  'notificationToast.border': ramp.borderStrong,
  'notificationLink.foreground': accent.base,
  'notificationsErrorIcon.foreground': signal.danger,
  'notificationsWarningIcon.foreground': signal.warning,
  'notificationsInfoIcon.foreground': signal.info,

  /* -- banner / breadcrumbs ---------------------------------------- */
  'banner.background': ramp.overlay,
  'banner.foreground': ink.body,
  'banner.iconForeground': accent.base,
  'breadcrumb.foreground': ink.faint,
  'breadcrumb.focusForeground': ink.body,
  'breadcrumb.activeSelectionForeground': accent.base,
  'breadcrumb.background': ramp.base,
  'breadcrumbPicker.background': ramp.raised,

  /* -- terminal ---------------------------------------------------- */
  'terminal.background': ramp.void,
  'terminal.foreground': ink.body,
  'terminal.border': ramp.border,
  'terminalCursor.foreground': accent.base,
  'terminalCursor.background': ramp.void,
  'terminal.selectionBackground': selection,
  'terminal.inactiveSelectionBackground': selectionInactive,
  'terminal.findMatchBackground': alpha(accent.base, 0.34),
  'terminal.findMatchHighlightBackground': alpha(accent.base, 0.18),
  'terminal.ansiBlack': ramp.void,
  'terminal.ansiRed': signal.danger,
  'terminal.ansiGreen': signal.added,
  'terminal.ansiYellow': signal.warning,
  'terminal.ansiBlue': signal.info,
  'terminal.ansiMagenta': syntax.regexp,
  'terminal.ansiCyan': signal.info,
  'terminal.ansiWhite': ink.body,
  'terminal.ansiBrightBlack': ink.faint,
  'terminal.ansiBrightRed': mix(signal.danger, ink.strong, 0.8),
  'terminal.ansiBrightGreen': accent.base,
  'terminal.ansiBrightYellow': mix(signal.warning, ink.strong, 0.8),
  'terminal.ansiBrightBlue': mix(signal.info, ink.strong, 0.8),
  'terminal.ansiBrightMagenta': mix(syntax.regexp, ink.strong, 0.8),
  'terminal.ansiBrightCyan': mix(signal.info, ink.strong, 0.7),
  'terminal.ansiBrightWhite': ink.strong,
  'terminalCommandDecoration.successBackground': signal.added,
  'terminalCommandDecoration.errorBackground': signal.danger,
  'terminalCommandDecoration.defaultBackground': ink.faint,

  /* -- git decorations --------------------------------------------- */
  'gitDecoration.addedResourceForeground': signal.added,
  'gitDecoration.modifiedResourceForeground': signal.modified,
  'gitDecoration.deletedResourceForeground': signal.deleted,
  'gitDecoration.renamedResourceForeground': signal.info,
  'gitDecoration.untrackedResourceForeground': accent.dim,
  'gitDecoration.ignoredResourceForeground': ink.faint,
  'gitDecoration.conflictingResourceForeground': signal.warning,
  'gitDecoration.stageModifiedResourceForeground': signal.modified,
  'gitDecoration.stageDeletedResourceForeground': signal.deleted,
  'gitDecoration.submoduleResourceForeground': signal.info,

  /* -- source control ---------------------------------------------- */
  'scm.providerBorder': ramp.border,
  'scmGraph.historyItemRefColor': accent.base,
  'scmGraph.historyItemRemoteRefColor': signal.info,
  'scmGraph.historyItemBaseRefColor': syntax.regexp,

  /* -- debug ------------------------------------------------------- */
  'debugToolBar.background': ramp.raised,
  'debugToolBar.border': ramp.borderStrong,
  'debugIcon.breakpointForeground': signal.danger,
  'debugIcon.breakpointDisabledForeground': mix(signal.danger, ramp.base, 0.4),
  'debugIcon.breakpointUnverifiedForeground': ink.faint,
  'debugIcon.startForeground': accent.base,
  'debugIcon.pauseForeground': signal.warning,
  'debugIcon.stopForeground': signal.danger,
  'debugIcon.continueForeground': accent.base,
  'debugIcon.stepOverForeground': signal.info,
  'debugIcon.stepIntoForeground': signal.info,
  'debugIcon.stepOutForeground': signal.info,
  'debugIcon.restartForeground': accent.base,
  'debugIcon.disconnectForeground': signal.danger,
  'debugConsole.infoForeground': signal.info,
  'debugConsole.warningForeground': signal.warning,
  'debugConsole.errorForeground': signal.danger,
  'debugConsole.sourceForeground': ink.muted,
  'debugConsoleInputIcon.foreground': accent.base,
  'debugView.stateLabelBackground': ramp.overlay,
  'debugView.stateLabelForeground': ink.body,
  'debugView.valueChangedHighlight': alpha(accent.base, 0.3),
  'editor.stackFrameHighlightBackground': alpha(signal.warning, 0.16),
  'editor.focusedStackFrameHighlightBackground': alpha(accent.base, 0.18),

  /* -- testing ----------------------------------------------------- */
  'testing.iconPassed': signal.added,
  'testing.iconFailed': signal.danger,
  'testing.iconErrored': signal.danger,
  'testing.iconSkipped': ink.faint,
  'testing.iconQueued': signal.warning,
  'testing.iconUnset': ink.faint,
  'testing.runAction': accent.base,
  'testing.message.error.decorationForeground': signal.danger,
  'testing.message.info.decorationForeground': signal.info,

  /* -- problems / minimap ------------------------------------------ */
  'problemsErrorIcon.foreground': signal.danger,
  'problemsWarningIcon.foreground': signal.warning,
  'problemsInfoIcon.foreground': signal.info,
  'minimap.background': ramp.base,
  'minimap.findMatchHighlight': alpha(accent.base, 0.5),
  'minimap.selectionHighlight': alpha(accent.base, 0.35),
  'minimap.errorHighlight': signal.danger,
  'minimap.warningHighlight': signal.warning,
  'minimapSlider.background': alpha(ink.faint, 0.2),
  'minimapSlider.hoverBackground': alpha(ink.faint, 0.3),
  'minimapSlider.activeBackground': alpha(accent.base, 0.35),
  'minimapGutter.addedBackground': signal.added,
  'minimapGutter.modifiedBackground': signal.modified,
  'minimapGutter.deletedBackground': signal.deleted,

  /* -- settings ---------------------------------------------------- */
  'settings.headerForeground': ink.strong,
  'settings.modifiedItemIndicator': accent.base,
  'settings.dropdownBackground': ramp.raised,
  'settings.dropdownBorder': ramp.borderStrong,
  'settings.checkboxBackground': ramp.void,
  'settings.checkboxBorder': ramp.borderStrong,
  'settings.textInputBackground': ramp.void,
  'settings.textInputBorder': ramp.border,
  'settings.numberInputBackground': ramp.void,
  'settings.numberInputBorder': ramp.border,
  'settings.focusedRowBackground': ramp.hover,
  'settings.rowHoverBackground': ramp.hover,
  'settings.focusedRowBorder': accent.border,

  /* -- welcome / walkthrough --------------------------------------- */
  'welcomePage.background': ramp.base,
  'welcomePage.tileBackground': ramp.raised,
  'welcomePage.tileHoverBackground': ramp.hover,
  'welcomePage.tileBorder': ramp.border,
  'welcomePage.progress.background': ramp.void,
  'welcomePage.progress.foreground': accent.base,
  'walkThrough.embeddedEditorBackground': ramp.void,

  /* -- extensions -------------------------------------------------- */
  'extensionButton.prominentBackground': accent.base,
  'extensionButton.prominentForeground': ink.inverse,
  'extensionButton.prominentHoverBackground': accent.bright,
  'extensionBadge.remoteBackground': accent.base,
  'extensionBadge.remoteForeground': ink.inverse,
  'extensionIcon.starForeground': signal.warning,
  'extensionIcon.verifiedForeground': accent.base,
  'extensionIcon.preReleaseForeground': signal.info,

  /* -- charts ------------------------------------------------------ */
  'charts.foreground': ink.body,
  'charts.lines': ramp.border,
  'charts.red': signal.danger,
  'charts.blue': signal.info,
  'charts.yellow': signal.warning,
  'charts.orange': syntax.regexp,
  'charts.green': signal.added,
  'charts.purple': syntax.regexp,

  /* -- merge conflicts --------------------------------------------- */
  'merge.currentHeaderBackground': alpha(signal.added, 0.28),
  'merge.currentContentBackground': alpha(signal.added, 0.12),
  'merge.incomingHeaderBackground': alpha(signal.info, 0.28),
  'merge.incomingContentBackground': alpha(signal.info, 0.12),
  'merge.commonHeaderBackground': alpha(ink.faint, 0.2),
  'merge.commonContentBackground': alpha(ink.faint, 0.1),
  'merge.border': ramp.border,

  /* -- notebooks --------------------------------------------------- */
  'notebook.cellBorderColor': ramp.border,
  'notebook.cellHoverBackground': ramp.hover,
  'notebook.focusedCellBackground': alpha(accent.base, 0.05),
  'notebook.focusedCellBorder': accent.border,
  'notebook.cellStatusBarItemHoverBackground': ramp.hover,
  'notebook.outputContainerBackgroundColor': ramp.void,
  'notebook.selectedCellBackground': ramp.hover,
  'notebookStatusSuccessIcon.foreground': signal.added,
  'notebookStatusErrorIcon.foreground': signal.danger,
  'notebookStatusRunningIcon.foreground': signal.info,

  /* -- ports / remote ---------------------------------------------- */
  'ports.iconRunningProcessForeground': accent.base,
  'remoteHub.decorations.addedForegroundColor': signal.added,
  'remoteHub.decorations.modifiedForegroundColor': signal.modified,
  'remoteHub.decorations.deletedForegroundColor': signal.deleted,

  /* -- symbol icons ------------------------------------------------ */
  'symbolIcon.classForeground': syntax.class,
  'symbolIcon.functionForeground': syntax.function,
  'symbolIcon.methodForeground': syntax.method,
  'symbolIcon.variableForeground': syntax.variable,
  'symbolIcon.constantForeground': syntax.constant,
  'symbolIcon.interfaceForeground': syntax.type,
  'symbolIcon.enumeratorForeground': syntax.type,
  'symbolIcon.propertyForeground': syntax.property,
  'symbolIcon.keywordForeground': syntax.keyword,
  'symbolIcon.stringForeground': syntax.string,
  'symbolIcon.moduleForeground': ink.body,
  'symbolIcon.fieldForeground': syntax.property,
}

/* ------------------------------------------------------------------ *
 * TextMate token colours
 * ------------------------------------------------------------------ */

const tokenColors = [
  { name: 'Comment', scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: syntax.comment_, fontStyle: 'italic' } },
  { name: 'String', scope: ['string', 'string.quoted', 'punctuation.definition.string'], settings: { foreground: syntax.string } },
  { name: 'String template', scope: ['string.template', 'string.interpolated'], settings: { foreground: syntax.string } },
  { name: 'Escape', scope: ['constant.character.escape', 'constant.character'], settings: { foreground: syntax.escape } },
  { name: 'Regex', scope: ['string.regexp', 'constant.regexp'], settings: { foreground: syntax.regexp } },
  { name: 'Number', scope: ['constant.numeric'], settings: { foreground: syntax.number } },
  { name: 'Boolean and null', scope: ['constant.language'], settings: { foreground: syntax.constant } },
  { name: 'Keyword', scope: ['keyword', 'keyword.control', 'keyword.operator.new', 'keyword.operator.expression'], settings: { foreground: syntax.keyword } },
  { name: 'Storage', scope: ['storage', 'storage.type', 'storage.modifier'], settings: { foreground: syntax.storage } },
  { name: 'Operator', scope: ['keyword.operator', 'punctuation.separator', 'punctuation.terminator'], settings: { foreground: syntax.operator } },
  { name: 'Punctuation', scope: ['punctuation', 'meta.brace'], settings: { foreground: syntax.punctuation } },
  { name: 'Function', scope: ['entity.name.function', 'support.function', 'meta.function-call.generic'], settings: { foreground: syntax.function } },
  { name: 'Method', scope: ['entity.name.method', 'meta.method entity.name.function'], settings: { foreground: syntax.method } },
  { name: 'Class and type', scope: ['entity.name.type', 'entity.name.class', 'support.class', 'support.type'], settings: { foreground: syntax.class } },
  { name: 'Interface', scope: ['entity.name.type.interface', 'entity.other.inherited-class'], settings: { foreground: syntax.type } },
  { name: 'Variable', scope: ['variable', 'variable.other.readwrite', 'meta.definition.variable'], settings: { foreground: syntax.variable } },
  { name: 'Parameter', scope: ['variable.parameter', 'meta.parameter'], settings: { foreground: syntax.parameter } },
  { name: 'Property', scope: ['variable.other.property', 'support.variable.property', 'meta.object-literal.key'], settings: { foreground: syntax.property } },
  { name: 'Constant', scope: ['variable.other.constant', 'entity.name.constant'], settings: { foreground: syntax.constant } },
  { name: 'Tag', scope: ['entity.name.tag', 'punctuation.definition.tag'], settings: { foreground: syntax.tag } },
  { name: 'Attribute', scope: ['entity.other.attribute-name'], settings: { foreground: syntax.attribute } },
  { name: 'CSS selector', scope: ['entity.name.tag.css', 'entity.other.attribute-name.class.css', 'entity.other.attribute-name.id.css'], settings: { foreground: syntax.attribute } },
  { name: 'CSS property', scope: ['support.type.property-name.css'], settings: { foreground: syntax.property } },
  { name: 'JSON key', scope: ['support.type.property-name.json'], settings: { foreground: syntax.property } },
  { name: 'Markdown heading', scope: ['markup.heading', 'entity.name.section'], settings: { foreground: accent.base, fontStyle: 'bold' } },
  { name: 'Markdown bold', scope: ['markup.bold'], settings: { foreground: ink.strong, fontStyle: 'bold' } },
  { name: 'Markdown italic', scope: ['markup.italic'], settings: { foreground: ink.body, fontStyle: 'italic' } },
  { name: 'Markdown link', scope: ['markup.underline.link', 'string.other.link'], settings: { foreground: signal.info } },
  { name: 'Markdown code', scope: ['markup.inline.raw', 'markup.fenced_code'], settings: { foreground: syntax.string } },
  { name: 'Markdown list', scope: ['markup.list', 'punctuation.definition.list'], settings: { foreground: accent.dim } },
  { name: 'Markdown quote', scope: ['markup.quote'], settings: { foreground: ink.muted, fontStyle: 'italic' } },
  { name: 'Diff inserted', scope: ['markup.inserted'], settings: { foreground: signal.added } },
  { name: 'Diff deleted', scope: ['markup.deleted'], settings: { foreground: signal.deleted } },
  { name: 'Diff changed', scope: ['markup.changed'], settings: { foreground: signal.modified } },
  { name: 'Invalid', scope: ['invalid', 'invalid.illegal'], settings: { foreground: syntax.invalid } },
  { name: 'Deprecated', scope: ['invalid.deprecated'], settings: { foreground: syntax.deprecated, fontStyle: 'strikethrough' } },
  { name: 'Namespace', scope: ['entity.name.namespace', 'entity.name.scope-resolution'], settings: { foreground: syntax.type } },
  { name: 'Decorator', scope: ['meta.decorator', 'punctuation.decorator', 'entity.name.function.decorator'], settings: { foreground: syntax.storage } },
  { name: 'Self and this', scope: ['variable.language.this', 'variable.language.self', 'variable.language.super'], settings: { foreground: syntax.keyword, fontStyle: 'italic' } },
  { name: 'Shell built-in', scope: ['support.function.builtin.shell', 'entity.name.command'], settings: { foreground: syntax.function } },
  { name: 'YAML anchor', scope: ['entity.name.type.anchor.yaml', 'variable.other.alias.yaml'], settings: { foreground: syntax.constant } },
]

/* Semantic highlighting, which takes precedence over TextMate when a
 * language server supplies it. */
const semanticTokenColors = {
  namespace: syntax.type,
  class: syntax.class,
  interface: syntax.type,
  enum: syntax.type,
  enumMember: syntax.constant,
  typeParameter: syntax.type,
  type: syntax.type,
  struct: syntax.class,
  function: syntax.function,
  method: syntax.method,
  macro: syntax.storage,
  variable: syntax.variable,
  parameter: syntax.parameter,
  property: syntax.property,
  keyword: syntax.keyword,
  comment: { foreground: syntax.comment_, fontStyle: 'italic' },
  string: syntax.string,
  number: syntax.number,
  regexp: syntax.regexp,
  operator: syntax.operator,
  decorator: syntax.storage,
  'variable.readonly': syntax.constant,
  'variable.defaultLibrary': syntax.function,
  'function.defaultLibrary': syntax.function,
  'class.defaultLibrary': syntax.class,
  unresolvedReference: { foreground: syntax.invalid, fontStyle: 'underline' },
}

/* ------------------------------------------------------------------ *
 * Emit
 * ------------------------------------------------------------------ */

export function buildGrapheneTheme() {
  return {
    $schema: 'vscode://schemas/color-theme',
    name: 'Graphene Dark',
    type: 'dark',
    semanticHighlighting: true,
    colors,
    tokenColors,
    semanticTokenColors,
  }
}

/** Validation: every emitted colour must be a usable value. */
export function validateTheme(theme) {
  const issues = []
  const HEX = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/
  for (const [key, value] of Object.entries(theme.colors)) {
    if (value === 'transparent') continue
    if (typeof value !== 'string' || !HEX.test(value)) {
      issues.push(`colors.${key} is not a valid colour: ${JSON.stringify(value)}`)
    }
  }
  for (const rule of theme.tokenColors) {
    const fg = rule.settings?.foreground
    if (fg && !HEX.test(fg)) issues.push(`tokenColors["${rule.name}"] foreground invalid: ${fg}`)
    if (!rule.scope || rule.scope.length === 0) issues.push(`tokenColors["${rule.name}"] has no scope`)
  }
  for (const [key, value] of Object.entries(theme.semanticTokenColors)) {
    const fg = typeof value === 'string' ? value : value.foreground
    if (fg && !HEX.test(fg)) issues.push(`semanticTokenColors.${key} invalid: ${fg}`)
  }
  return issues
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
if (isMain) {
  const theme = buildGrapheneTheme()
  const issues = validateTheme(theme)
  if (issues.length > 0) {
    console.error('Graphene theme validation failed:')
    for (const issue of issues) console.error(`  - ${issue}`)
    process.exit(1)
  }

  const outIndex = process.argv.indexOf('--out')
  const outDir = outIndex > -1 ? process.argv[outIndex + 1] : resolve(here, 'dist')

  if (process.argv.includes('--check')) {
    console.log(`Graphene theme OK — ${Object.keys(theme.colors).length} colours, ${theme.tokenColors.length} token rules, ${Object.keys(theme.semanticTokenColors).length} semantic rules`)
    process.exit(0)
  }

  mkdirSync(outDir, { recursive: true })
  const file = resolve(outDir, 'graphene-dark.json')
  writeFileSync(file, `${JSON.stringify(theme, null, 2)}\n`)
  console.log(`wrote ${file}`)
  console.log(`  ${Object.keys(theme.colors).length} workbench colours`)
  console.log(`  ${theme.tokenColors.length} TextMate rules`)
  console.log(`  ${Object.keys(theme.semanticTokenColors).length} semantic rules`)
}
