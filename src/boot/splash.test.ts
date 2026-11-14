/**
 * @vitest-environment jsdom
 *
 * The boot screen: the timing rules, and the markup it depends on.
 *
 * Two classes of failure are worth catching here. The controller lying --
 * ticking a step that has not happened, or vanishing before it can be read
 * -- and the markup drifting from the controller or from the design tokens,
 * which would not fail anything else in the suite.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  BOOT_STEPS, FADE_MS, MAX_VISIBLE_MS, MIN_VISIBLE_MS, REDUCED_VISIBLE_MS, createSplash,
} from './splash'
import tokens from '../theme/tokens.json'

// Resolved from the working directory rather than from `import.meta.url`:
// under jsdom that URL is an http one, and `readFileSync` will not take it.
const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8')

/** The boot markup, lifted out of index.html so the test uses the real thing. */
function mountRealMarkup() {
  const body = /<div id="boot"[\s\S]*?<\/div>\s*<!--/.exec(html)
  document.body.innerHTML = (body ? body[0].replace(/<!--$/, '') : '')
}

/**
 * The inline watchdog from index.html, run for real.
 *
 * Extracted rather than reimplemented: the whole value of that script is
 * that it is the one in the page, and a copy of it here would pass while
 * the shipped one was broken.
 */
function runWatchdog() {
  const source = /<script data-boot-watchdog>([\s\S]*?)<\/script>/.exec(html)?.[1]
  if (!source) throw new Error('index.html has no boot watchdog')
  new Function(source).call(window)
}

const failure = () => document.querySelector('#boot .failed')?.textContent ?? ''

/** A clock the test drives by hand. */
function harness(options: { reducedMotion?: boolean } = {}) {
  let clock = 1000
  const queue: Array<{ at: number; run: () => void }> = []
  const splash = createSplash({
    now: () => clock,
    schedule: (run, delay) => { queue.push({ at: clock + delay, run }) },
    reducedMotion: options.reducedMotion,
  })
  /**
   * Moves the clock and drains everything now due -- including callbacks
   * scheduled by the ones it just ran, which is how the fade-then-remove
   * pair actually behaves.
   */
  const advance = (ms: number) => {
    clock += ms
    for (;;) {
      const next = queue.find((entry) => entry.at <= clock)
      if (!next) return
      queue.splice(queue.indexOf(next), 1)
      next.run()
    }
  }
  return { splash, advance }
}

const boot = () => document.getElementById('boot')
const item = (step: string) => document.querySelector<HTMLElement>(`[data-step="${step}"]`)
const fillWidth = () => document.querySelector<HTMLElement>('[data-boot-fill]')?.style.width ?? ''

beforeEach(() => { mountRealMarkup() })

describe('the boot screen markup', () => {
  it('is in the document before any script runs', () => {
    // Everything the screen needs to animate is inline in the head and body:
    // no stylesheet link, no bundle, nothing to wait for.
    expect(html.indexOf('<div id="boot"')).toBeLessThan(html.indexOf('src="/src/main.tsx"'))
    expect(html).toContain('<style>')
    expect(html).not.toMatch(/<link[^>]+rel="stylesheet"/)
  })

  it('lists exactly the steps the controller knows about, in order', () => {
    const inMarkup = [...html.matchAll(/data-step="([a-z]+)"/g)].map((match) => match[1])
    expect(inMarkup).toEqual([...BOOT_STEPS])
  })

  it('keeps the bootstrap the production smoke test looks for', () => {
    expect(html).toContain('<title>Tungsten IDE</title>')
    expect(html).toContain('id="root"')
  })

  it('paints in Graphene, and cannot drift from the tokens', () => {
    const used = new Set((html.match(/#[0-9a-fA-F]{6,8}/g) ?? []).map((hex) => hex.toLowerCase()))
    const known = new Set(JSON.stringify(tokens).toLowerCase().match(/#[0-9a-fA-F]{6,8}/g) ?? [])
    // Two derived values are allowed: a white sheen and a lightened accent
    // for the arc, both written as the accent or ink with an alpha.
    const allowed = new Set([...known, '#f0f3ef2e', '#c8f16960', '#c8f16980', '#eaffb0'])
    expect([...used].filter((hex) => !allowed.has(hex))).toEqual([])
    expect(used.has(tokens.accent.base.toLowerCase())).toBe(true)
  })

  it('does not hold the user longer than its own animation', () => {
    // The floor exists so a fast start does not flash something
    // illegible. It is not a stage wait: once the intro has resolved,
    // every extra millisecond is the product wasting the user's time on
    // every single load.
    const delays = [...html.matchAll(/animation(?:-delay)?:[^;}"]*?([\d.]+)m?s[^;}"]*/g)]
    const latest = [...html.matchAll(/animation: boot-(?:light|letter|fade) ([\d.]+)m?s[^;]*?([\d.]+)s/g)]
      .map(([, duration, delay]) => Number(duration) * (duration.includes('.') ? 1000 : 1) + Number(delay) * 1000)
    expect(delays.length).toBeGreaterThan(0)
    expect(Math.max(...latest)).toBeLessThanOrEqual(MIN_VISIBLE_MS)
    // …and the floor is close to it, rather than padded well past it.
    expect(MIN_VISIBLE_MS).toBeLessThanOrEqual(1200)
  })

  it('fades for exactly as long as the stylesheet says it does', () => {
    // The node is removed on a timer, so a shorter CSS transition leaves
    // a dead layer over the workbench and a longer one cuts the fade off.
    const transition = /#boot \{[\s\S]*?transition: opacity (\d+)ms/.exec(html)?.[1]
    expect(Number(transition)).toBe(FADE_MS)
  })

  it('does not blur a full-screen layer while the workbench mounts', () => {
    // The one frame the product is judged on is the frame React mounts;
    // a filter on a viewport-sized element is the surest way to drop it.
    const rule = /#boot\.done \{[\s\S]*?\}/.exec(html)?.[0] ?? ''
    expect(rule).not.toContain('filter:')
  })

  it('shows one milestone at a time rather than a six-row checklist', () => {
    // The steps are stacked and crossfaded. If they ever go back to being
    // laid out in flow, six lines will flicker past in under a second.
    const rule = /#boot \.steps li \{[\s\S]*?\}/.exec(html)?.[0] ?? ''
    expect(rule).toContain('position: absolute')
    expect(rule).toContain('opacity: 0')
  })

  it('asks for less movement when the machine does', () => {
    expect(html).toContain('prefers-reduced-motion: reduce')
  })

  it('announces itself to a screen reader', () => {
    expect(boot()?.getAttribute('role')).toBe('status')
    expect(boot()?.getAttribute('aria-live')).toBe('polite')
  })
})

describe('the boot watchdog', () => {
  // The screen's own failsafe lives in the bundle, so it covers a slow
  // start and a crashed render -- and covers nothing when the bundle is
  // what failed. That is the case that leaves a boot screen up for ever,
  // and the only code that can speak to it is inline in the page.
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('is a classic script, because a module cannot report a module failing', () => {
    const tag = /<script data-boot-watchdog[^>]*>/.exec(html)?.[0] ?? ''
    expect(tag).not.toContain('type="module"')
    expect(html.indexOf('data-boot-watchdog')).toBeLessThan(html.indexOf('src="/src/main.tsx"'))
  })

  it('says so when the bundle never loaded, rather than spinning for ever', () => {
    runWatchdog()
    expect(failure()).toBe('')

    vi.advanceTimersByTime(9000)
    expect(failure()).toContain('did not start')
    // And offers the two things that actually help.
    const buttons = [...document.querySelectorAll('#boot .failed-actions button')]
    expect(buttons.map((button) => button.textContent))
      .toEqual(['Try again', 'Clear cached app data'])
  })

  it('names the file that 404d, and does not wait to say it', () => {
    runWatchdog()
    const script = document.createElement('script')
    script.src = 'https://tungsten.example/src/main.tsx'
    document.body.append(script)
    script.dispatchEvent(new Event('error', { bubbles: false }))

    // A missing bundle is final: nothing else is coming, so there is
    // nothing to wait for.
    expect(failure()).toContain('https://tungsten.example/src/main.tsx')
    expect(document.querySelector('#boot .failed-help')?.textContent)
      .toContain('publishing the build output')
  })

  it('stands down the moment the real controller attaches', () => {
    runWatchdog()
    harness()
    vi.advanceTimersByTime(60_000)
    // A slow start is not a failed one, and two things talking over each
    // other on the same screen is worse than either.
    expect(failure()).toBe('')
    expect(boot()?.getAttribute('data-controller')).toBe('on')
  })

  it('says nothing at all once the screen has been taken away', () => {
    runWatchdog()
    document.getElementById('boot')?.remove()
    vi.advanceTimersByTime(60_000)
    expect(document.querySelector('.failed')).toBeNull()
  })
})

describe('the boot screen controller', () => {
  it('starts the first step and shows some progress at once', () => {
    harness()
    expect(item('chrome')?.className).toContain('active')
    expect(fillWidth()).toBe('4%')
  })

  it('ticks a step off and starts the next', () => {
    const { splash } = harness()
    splash.step('workbench')
    expect(item('workbench')?.className).toContain('done')
    expect(item('grammars')?.className).toContain('active')
    expect(item('chrome')?.className).toContain('done')
  })

  it('shows the detail a step reports', () => {
    const { splash } = harness()
    splash.step('shell', '592')
    expect(item('shell')?.querySelector('.detail')?.textContent).toBe('592')
  })

  it('never lets a later step leave an earlier one spinning', () => {
    const { splash } = harness()
    splash.step('workspace')
    for (const step of BOOT_STEPS) {
      expect(item(step)?.className).toContain('done')
      expect(item(step)?.className).not.toContain('active')
    }
  })

  it('advances the bar as steps land', () => {
    const { splash } = harness()
    splash.step('workbench')
    const early = Number.parseInt(fillWidth(), 10)
    splash.step('blocks')
    expect(Number.parseInt(fillWidth(), 10)).toBeGreaterThan(early)
  })

  it('stays on screen for the minimum, even when start-up was instant', () => {
    const { splash, advance } = harness()
    splash.finish()
    advance(MIN_VISIBLE_MS - 100)
    expect(boot()?.className).not.toContain('done')

    advance(200)
    expect(boot()?.className).toContain('done')
    expect(fillWidth()).toBe('100%')
  })

  it('leaves as soon as it is asked to, when start-up was slow', () => {
    const { splash, advance } = harness()
    advance(MIN_VISIBLE_MS + 500)
    splash.finish()
    expect(boot()?.className).toContain('done')
  })

  it('takes itself out of the document once it has faded', () => {
    const { splash, advance } = harness()
    splash.finish()
    advance(MIN_VISIBLE_MS)
    expect(boot()).not.toBeNull()
    advance(FADE_MS)
    expect(boot()).toBeNull()
    expect(splash.gone).toBe(true)
  })

  it('gets out of the way quickly when less motion was asked for', () => {
    const { splash, advance } = harness({ reducedMotion: true })
    splash.finish()
    advance(REDUCED_VISIBLE_MS)
    expect(boot()?.className).toContain('done')
  })

  it('leaves on its own if start-up never finishes', () => {
    const { advance } = harness()
    // No finish() at all: a chunk failed to load, or an effect threw.
    advance(MAX_VISIBLE_MS)
    expect(boot()?.className).toContain('done')
    advance(FADE_MS)
    expect(boot()).toBeNull()
  })

  it('does not reappear or double-remove when finish arrives late', () => {
    const { splash, advance } = harness()
    advance(MAX_VISIBLE_MS)
    advance(FADE_MS)
    expect(() => splash.finish()).not.toThrow()
    expect(boot()).toBeNull()
  })

  it('ignores a step after it has gone', () => {
    const { splash, advance } = harness()
    splash.finish()
    advance(MIN_VISIBLE_MS + FADE_MS)
    expect(() => splash.step('shell')).not.toThrow()
  })

  it('does nothing at all when the markup is absent', () => {
    document.body.innerHTML = ''
    const splash = createSplash({ now: () => 0, schedule: vi.fn() })
    expect(splash.gone).toBe(true)
    expect(() => { splash.step('chrome'); splash.finish() }).not.toThrow()
  })
})
