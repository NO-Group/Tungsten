/**
 * Just enough of jsdom to type the preview tests.
 *
 * The package ships no types and `@types/jsdom` would be a dependency added
 * for one test file; this declares the two things those tests touch.
 */
declare module 'jsdom' {
  export class JSDOM {
    constructor(html?: string, options?: {
      runScripts?: 'dangerously' | 'outside-only'
      pretendToBeVisual?: boolean
      url?: string
      /** Runs before the document is parsed: the hook the fetch stub uses. */
      beforeParse?: (window: Window & typeof globalThis) => void
    })
    readonly window: Window & typeof globalThis
    serialize(): string
  }
}
