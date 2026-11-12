/**
 * The notification centre.
 *
 * Opened from the bell in the status bar, which until now was a
 * drawing of a bell. It lists what was said while you were looking
 * somewhere else, newest first, with the severity on the left and the
 * time on the right — and a way to get rid of them, because a list
 * that only grows is a list people stop opening.
 */

import { CircleAlert, CircleCheck, Trash2, TriangleAlert, X } from 'lucide-react'

import { Modal } from '../Modal'
import { describeWhen, type Notification } from '../../notifications/notifications'

export type NotificationCentreProps = {
  entries: Notification[]
  /**
   * The clock the relative times are measured against, read when the
   * dialog was opened. Passed in rather than read here: the clock is
   * impure, and "3 minutes ago" must not change because a sibling
   * re-rendered.
   */
  now: number
  onDismiss: (id: string) => void
  onClear: () => void
  onClose: () => void
}

const ICON = {
  info: CircleCheck,
  warning: TriangleAlert,
  error: CircleAlert,
} as const

export function NotificationCentre({ entries, now, onDismiss, onClear, onClose }: NotificationCentreProps) {

  return (
    <Modal label="Notifications" className="notification-centre" onClose={onClose}>
      <header>
        <strong>Notifications</strong>
        <span>{entries.length ? `${entries.length} in the history` : ''}</span>
        <button onClick={onClear} disabled={!entries.length} title="Clear the history">
          <Trash2 size={13} /> Clear
        </button>
        <button onClick={onClose} aria-label="Close notifications"><X size={14} /></button>
      </header>

      {!entries.length && (
        <p className="notification-empty">
          Nothing yet. Saves, builds, Git operations and anything the AI refuses will land here, and stay until you
          clear them.
        </p>
      )}

      <ul>
        {entries.map((entry) => {
          const Icon = ICON[entry.severity]
          return (
            <li key={entry.id} className={`notification ${entry.severity} ${entry.read ? '' : 'unread'}`}>
              <Icon size={13} />
              <div>
                <p>{entry.message}</p>
                <span>{entry.source ? `${entry.source} · ` : ''}{describeWhen(entry.at, now)}</span>
              </div>
              <button onClick={() => onDismiss(entry.id)} aria-label={`Dismiss: ${entry.message}`}><X size={12} /></button>
            </li>
          )
        })}
      </ul>
    </Modal>
  )
}

export default NotificationCentre
