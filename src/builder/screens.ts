/**
 * The screens an app has, and which one you are looking at.
 *
 * A canvas with one screen is a demo. An application is several, and a way
 * to get between them -- which is why this is a model rather than a tab
 * strip: the screen a block belongs to is part of the program, it is written
 * into the generated file, and it comes back out of it.
 *
 * The representation is deliberately thin. A screen is a name, the list is
 * ordered, and the first one is where the app starts. There is no id: the
 * name *is* the identity, because the name is what the code says
 * (`app.goTo("settings")`), and a model whose identity the generated file
 * cannot express would need a side-car to survive the round trip.
 *
 * One screen called "home" is the default, and it generates nothing at all.
 * A project that never asks for a second screen produces exactly the file it
 * produced before screens existed -- the feature costs nothing until it is
 * used, in bytes as well as in attention.
 */

/** Where an app starts when it has not said otherwise. */
export const HOME_SCREEN = 'home'

export type Screen = {
  /** Lowercase, no spaces: it is a string literal in the generated file. */
  name: string
}

export const DEFAULT_SCREENS: Screen[] = [{ name: HOME_SCREEN }]

/**
 * A name that can be written as a screen literal and typed by a person.
 *
 * Dashes are allowed because a screen name reads as a route -- `sign-up` is
 * what a URL would call it -- and nothing downstream has to turn it into an
 * identifier.
 */
export function isValidScreenName(name: string): boolean {
  return /^[a-z][a-z0-9-]*$/.test(name)
}

/** Makes a requested name legal and unique against the screens already there. */
export function uniqueScreenName(requested: string, taken: readonly Screen[]): string {
  const cleaned = requested.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '')
  const base = /^[a-z]/.test(cleaned) ? cleaned : `screen${cleaned ? `-${cleaned}` : ''}`
  const names = new Set(taken.map((screen) => screen.name))
  if (!names.has(base)) return base
  let index = 2
  while (names.has(`${base}-${index}`)) index += 1
  return `${base}-${index}`
}

export function screenNames(screens: readonly Screen[]): string[] {
  return screens.map((screen) => screen.name)
}

/** The screen an app starts on: the first one declared. */
export function homeScreen(screens: readonly Screen[]): string {
  return screens[0]?.name ?? HOME_SCREEN
}

/**
 * The screen a block belongs to.
 *
 * A block saved before screens existed -- or pasted from a project that had
 * none -- has no screen of its own and belongs to the first one. That
 * fallback is why the field is optional rather than defaulted on write: an
 * older saved canvas opens whole, with every block on the home screen,
 * instead of opening empty.
 */
export function screenOf(node: { screen?: string }, screens: readonly Screen[]): string {
  return node.screen ?? homeScreen(screens)
}

export function hasScreen(screens: readonly Screen[], name: string): boolean {
  return screens.some((screen) => screen.name === name)
}

/**
 * True when the screen list is the one that needs no declaration.
 *
 * The generator checks this and emits the pre-screens dialect when it holds.
 * It is a single rule in a single place so the two directions cannot drift:
 * the parser produces exactly this list from a file with no declaration.
 */
export function isDefaultScreens(screens: readonly Screen[]): boolean {
  return screens.length <= 1 && homeScreen(screens) === HOME_SCREEN
}

export function addScreen(screens: readonly Screen[], requested = 'screen'): Screen[] {
  return [...screens, { name: uniqueScreenName(requested, screens) }]
}

/** Renames a screen, and returns the old name so references can follow it. */
export function renameScreen(
  screens: readonly Screen[],
  index: number,
  requested: string,
): { screens: Screen[]; from: string; to: string } | undefined {
  const current = screens[index]
  if (!current) return undefined
  const cleaned = requested.trim().toLowerCase()
  if (!isValidScreenName(cleaned)) return undefined
  if (cleaned === current.name) return { screens: [...screens], from: current.name, to: cleaned }
  if (hasScreen(screens, cleaned)) return undefined
  return {
    screens: screens.map((screen, position) => (position === index ? { name: cleaned } : screen)),
    from: current.name,
    to: cleaned,
  }
}

/** The last screen cannot be removed: an app is at least one screen. */
export function removeScreen(screens: readonly Screen[], index: number): Screen[] {
  if (screens.length <= 1 || !screens[index]) return [...screens]
  return screens.filter((_, position) => position !== index)
}

/** Moves a screen in the order, which also chooses the one the app starts on. */
export function moveScreen(screens: readonly Screen[], index: number, to: number): Screen[] {
  if (!screens[index] || to < 0 || to >= screens.length || index === to) return [...screens]
  const next = [...screens]
  const [moved] = next.splice(index, 1)
  next.splice(to, 0, moved)
  return next
}

/**
 * The declaration line, or empty when the list is the default.
 *
 * Order is meaning here, not presentation: the first entry is where the app
 * starts, so reordering the tabs is a change to the program and shows up as
 * a change to this line.
 */
export function generateScreens(screens: readonly Screen[]): string {
  if (isDefaultScreens(screens)) return ''
  const names = screenNames(screens).map((name) => JSON.stringify(name)).join(', ')
  return `const screens = app.screens([${names}])`
}

/**
 * Reads the declaration back.
 *
 * Returns undefined when the line is not a screen declaration, so the parser
 * can carry on and try the next thing rather than failing on it.
 */
export function parseScreens(line: string): Screen[] | undefined {
  const match = /^const screens = app\.screens\(\[(.*)\]\)$/.exec(line.trim())
  if (!match) return undefined

  const screens: Screen[] = []
  for (const part of match[1].split(',')) {
    const text = part.trim()
    if (!/^"[a-z][a-z0-9-]*"$/.test(text)) continue
    const name = text.slice(1, -1)
    if (!hasScreen(screens, name)) screens.push({ name })
  }
  return screens.length ? screens : [...DEFAULT_SCREENS]
}

/** Every screen some block is on but the list does not declare. */
export function undeclaredScreens(
  nodes: ReadonlyArray<{ screen?: string }>,
  screens: readonly Screen[],
): string[] {
  const missing: string[] = []
  for (const node of nodes) {
    const name = screenOf(node, screens)
    if (hasScreen(screens, name) || missing.includes(name)) continue
    missing.push(name)
  }
  return missing
}
