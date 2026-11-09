/**
 * What the three native emitters agree about expressions.
 *
 * Each language spells a comparison differently, so the rendering lives
 * with the target. What does *not* differ is which operators exist, which
 * of them are allowed, and what to do with an operator nobody recognises --
 * and that was the part three copies would get subtly out of step.
 */

import type { IrCall, IrValue } from '../compile'

/** The comparisons a Compare block may produce. */
export const COMPARISONS = ['===', '!==', '<', '<=', '>', '>='] as const

/** The arithmetic a Math block may produce. */
export const ARITHMETIC = ['+', '-', '*', '/', '%'] as const

/**
 * The operator a call carries, restricted to a known list.
 *
 * The operator is a literal choice rather than an expression -- the block
 * marks the port as a property -- so a generated comparison can never be
 * steered into something that is not one. Anything unexpected becomes the
 * fallback rather than reaching a target's source file.
 */
export function operatorOf(call: IrCall, allowed: readonly string[], fallback: string): string {
  const input: IrValue | undefined = call.inputs.operator
  if (!input || input.kind !== 'literal') return fallback
  const raw = String(input.value)
  return allowed.includes(raw) ? raw : fallback
}

/**
 * Whether a comparison is an equality test.
 *
 * Equality is compared as text and ordering as numbers, in all three
 * languages: the values coming out of a dynamic field map have no static
 * type, and `"3" < "20"` being true is the kind of bug that takes an hour
 * to find in generated code.
 */
export function isEquality(operator: string): boolean {
  return operator === '===' || operator === '!=='
}

/**
 * Whether a value is already a string in the target language.
 *
 * Used to keep the generated source readable: wrapping a literal, a field
 * read or the current screen name in a conversion is noise, and noise in
 * generated code is what makes people stop reading it.
 */
export function isTextual(value: IrValue | undefined): boolean {
  if (!value) return false
  if (value.kind === 'literal') return typeof value.value === 'string'
  if (value.kind !== 'call') return false
  return value.type === 'ui.value' || value.type === 'nav.current' || value.type === 'data.text'
}
