/**
 * The boot screen's controller.
 *
 * The screen itself is in `index.html` so it paints on the first frame,
 * before this file -- or any other -- has been fetched. What is left for
 * JavaScript is the honest part: ticking off milestones as they genuinely
 * happen, and taking the screen away afterwards.
 *
 * Two rules it exists to enforce:
 *
 *  - A step is marked done when the thing it names has actually happened.
 *    A progress bar that animates on a timer while the app is still
 *    fetching is a lie told with a spinner, and it is the reason nobody
 *    trusts progress bars.
 *  - The screen stays up for a minimum time. Not to pad the wait -- to stop
 *    a fast start flashing something illegible on screen for 80ms, which
 *    reads as a glitch rather than as a product.
 */

/** The milestones, in the order they occur. Must match the markup. */
export const BOOT_STEPS = ['chrome', 'workbench', 'grammars', 'shell', 'blocks', 'workspace'] as const

export type BootStep = (typeof BOOT_STEPS)[number]

/** How long the screen stays up at the very least. */
export const MIN_VISIBLE_MS = 3200
/** …and how long when the machine has asked for less motion. */
export const REDUCED_VISIBLE_MS = 700
/** Matches the CSS transition, so the node is removed once it has faded. */
export const FADE_MS = 560
/**
 * The failsafe.
 *
 * The screen covers the whole window. If start-up throws somewhere that
 * never reaches `finish` -- a failed chunk, a thrown effect -- a beautiful
 * boot screen becomes a beautiful wall. After this long it leaves anyway
 * and lets the user see whatever state the app did reach.
 */
export const MAX_VISIBLE_MS = 12000

export type SplashOptions = {
  document?: Document
  now?: () => number
  /** Injected so the timing rules can be tested without waiting for them. */
  schedule?: (callback: () => void, delay: number) => void
  reducedMotion?: boolean
}

export type Splash = {
  /** Marks a milestone reached, with an optional detail like a count. */
  step: (step: BootStep, detail?: string) => void
  /** Everything is up; fade out once the minimum time has elapsed. */
  finish: () => void
  /** True once the screen has been removed. */
  readonly gone: boolean
}

/** A no-op splash, for when the markup is not there (tests, embeddings). */
const ABSENT: Splash = { step: () => undefined, finish: () => undefined, gone: true }

export function createSplash(options: SplashOptions = {}): Splash {
  const {
    document: doc = typeof document === 'undefined' ? undefined : document,
    now = () => Date.now(),
    schedule = (callback, delay) => { setTimeout(callback, delay) },
  } = options

  const root = doc?.getElementById('boot')
  if (!doc || !root) return ABSENT

  const reduced = options.reducedMotion
    ?? Boolean(doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches)
  const minimum = reduced ? REDUCED_VISIBLE_MS : MIN_VISIBLE_MS

  const fill = root.querySelector<HTMLElement>('[data-boot-fill]')
  const items = new Map<string, HTMLElement>()
  for (const item of root.querySelectorAll<HTMLElement>('[data-step]')) {
    items.set(item.dataset.step ?? '', item)
  }

  const started = now()
  let reached = 0
  let gone = false

  // The first step is under way as soon as this module runs: the stylesheet
  // and the fonts it names are what got us this far.
  items.get(BOOT_STEPS[0])?.classList.add('active')

  const paint = () => {
    if (!fill) return
    // Never quite full until the end, because the last thing to happen is
    // the workbench actually appearing.
    const ratio = reached / (BOOT_STEPS.length + 1)
    fill.style.width = `${Math.max(4, Math.round(ratio * 100))}%`
  }

  const step: Splash['step'] = (name, detail) => {
    const index = BOOT_STEPS.indexOf(name)
    if (index < 0 || gone) return

    // Anything before this one is done too: a later milestone proves the
    // earlier ones, and a step left spinning behind a finished one looks
    // like something hung.
    BOOT_STEPS.slice(0, index + 1).forEach((earlier) => {
      const item = items.get(earlier)
      item?.classList.remove('active')
      item?.classList.add('done')
    })

    if (detail) {
      const item = items.get(name)
      if (item && !item.querySelector('.detail')) {
        const note = doc.createElement('span')
        note.className = 'detail'
        note.textContent = detail
        item.append(note)
      }
    }

    items.get(BOOT_STEPS[index + 1])?.classList.add('active')
    reached = Math.max(reached, index + 1)
    paint()
  }

  const remove = () => {
    if (gone) return
    gone = true
    reached = BOOT_STEPS.length + 1
    paint()
    for (const item of items.values()) { item.classList.remove('active'); item.classList.add('done') }
    root.classList.add('done')
    schedule(() => root.remove(), FADE_MS)
  }

  const finish = () => {
    if (gone) return
    const elapsed = now() - started
    if (elapsed >= minimum) remove()
    else schedule(remove, minimum - elapsed)
  }

  schedule(() => {
    if (!gone) remove()
  }, MAX_VISIBLE_MS)

  paint()
  return { step, finish, get gone() { return gone } }
}
