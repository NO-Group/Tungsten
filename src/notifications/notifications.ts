/**
 * The notification history behind the bell.
 *
 * A toast that vanishes after two seconds is the only kind of message
 * Tungsten had, which means a message that arrives while you are
 * looking at the terminal never happened. The bell in the status bar
 * was a decoration over that hole.
 *
 * This is the hole filled: every `notify` goes through here, the toast
 * still shows the newest one, and the bell opens the list of the ones
 * you missed. Unread is a count, not a badge for its own sake — it
 * clears when you open the list, because a counter that never reaches
 * zero is one people stop reading.
 */

export type NotificationSeverity = 'info' | 'warning' | 'error'

export type Notification = {
  id: string
  message: string
  severity: NotificationSeverity
  /** Epoch milliseconds, so the list can say "4 minutes ago". */
  at: number
  read: boolean
  /** Where the message came from, when it is worth knowing: `Builder`, `Git`. */
  source?: string
}

export type NotificationState = {
  entries: Notification[]
  /** Monotonic, so two notifications in the same millisecond still differ. */
  sequence: number
}

/**
 * How many are kept.
 *
 * Enough to cover a working session, few enough that the list is read
 * rather than scrolled. Beyond this the oldest go, because a
 * notification nobody read in two hundred messages is not a record,
 * it is a leak.
 */
export const HISTORY_LIMIT = 200

export const EMPTY_NOTIFICATIONS: NotificationState = { entries: [], sequence: 0 }

export type NotifyInput = {
  message: string
  severity?: NotificationSeverity
  source?: string
  at?: number
}

/** Adds one, newest first, within the limit. */
export function addNotification(state: NotificationState, input: NotifyInput): NotificationState {
  const sequence = state.sequence + 1
  const entry: Notification = {
    id: `n${sequence}`,
    message: input.message,
    severity: input.severity ?? 'info',
    at: input.at ?? Date.now(),
    read: false,
    source: input.source,
  }
  return { entries: [entry, ...state.entries].slice(0, HISTORY_LIMIT), sequence }
}

export function markAllRead(state: NotificationState): NotificationState {
  if (state.entries.every((entry) => entry.read)) return state
  return { ...state, entries: state.entries.map((entry) => ({ ...entry, read: true })) }
}

export function dismissNotification(state: NotificationState, id: string): NotificationState {
  return { ...state, entries: state.entries.filter((entry) => entry.id !== id) }
}

export function clearNotifications(state: NotificationState): NotificationState {
  return { ...state, entries: [] }
}

export function unreadCount(state: NotificationState): number {
  return state.entries.filter((entry) => !entry.read).length
}

/**
 * The worst thing waiting, which is what the bell should colour itself
 * by. An unread error outranks nine unread notices.
 */
export function highestUnread(state: NotificationState): NotificationSeverity | undefined {
  let worst: NotificationSeverity | undefined
  for (const entry of state.entries) {
    if (entry.read) continue
    if (entry.severity === 'error') return 'error'
    if (entry.severity === 'warning') worst = 'warning'
    else if (!worst) worst = 'info'
  }
  return worst
}

/**
 * Relative time, in the units people actually say.
 *
 * Deliberately coarse: "3 minutes ago" is useful, "3 minutes and 12
 * seconds ago" is noise that re-renders every second.
 */
export function describeWhen(at: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000))
  if (seconds < 10) return 'just now'
  if (seconds < 60) return `${seconds} seconds ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

/** The bell's hover text: what is waiting, or that nothing is. */
export function describeBell(state: NotificationState): string {
  const unread = unreadCount(state)
  if (unread) return `${unread} unread notification${unread === 1 ? '' : 's'}`
  if (state.entries.length) return `No unread notifications — ${state.entries.length} in the history`
  return 'No notifications yet'
}
