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
    })
    readonly window: Window & typeof globalThis
    serialize(): string
  }
}
