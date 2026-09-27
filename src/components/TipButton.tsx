/**
 * An icon-only button that always carries an accessible name.
 *
 * Icon buttons are the default control in Tungsten's chrome, and an unlabelled
 * one is invisible to a screen reader. Taking `label` as a required prop makes
 * that impossible to forget.
 */

import type React from 'react'

export function TipButton({
  label,
  children,
  className = '',
  onClick,
  active = false,
  disabled = false,
}: {
  label: string
  children: React.ReactNode
  className?: string
  onClick?: () => void
  active?: boolean
  disabled?: boolean
}) {
  return (
    <button
      className={`icon-button ${active ? 'active' : ''} ${className}`}
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  )
}

export default TipButton
