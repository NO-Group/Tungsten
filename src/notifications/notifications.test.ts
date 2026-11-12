/**
 * The notification history.
 *
 * The bell used to be a drawing. These tests pin the behaviour that
 * makes it a feature instead: nothing is lost because a toast timed
 * out, the count clears when the list is opened, and an error is
 * never hidden behind nine notices.
 */

import { describe, expect, it } from 'vitest'

import {
  EMPTY_NOTIFICATIONS,
  HISTORY_LIMIT,
  addNotification,
  clearNotifications,
  describeBell,
  describeWhen,
  dismissNotification,
  highestUnread,
  markAllRead,
  unreadCount,
} from './notifications'

const T0 = Date.UTC(2026, 8, 23, 12, 0, 0)

function seed(messages: string[]) {
  return messages.reduce((state, message, index) => addNotification(state, { message, at: T0 + index * 1_000 }), EMPTY_NOTIFICATIONS)
}

describe('the notification history', () => {
  it('keeps what the toast threw away, newest first', () => {
    const state = seed(['Saved', 'Built the Android target', 'Pushed'])
    expect(state.entries.map((entry) => entry.message)).toEqual(['Pushed', 'Built the Android target', 'Saved'])
    expect(unreadCount(state)).toBe(3)
  })

  it('gives two messages in the same millisecond different ids', () => {
    let state = addNotification(EMPTY_NOTIFICATIONS, { message: 'one', at: T0 })
    state = addNotification(state, { message: 'two', at: T0 })
    expect(state.entries[0].id).not.toBe(state.entries[1].id)
  })

  it('clears the count when the list is opened', () => {
    const state = markAllRead(seed(['a', 'b']))
    expect(unreadCount(state)).toBe(0)
    expect(describeBell(state)).toBe('No unread notifications — 2 in the history')
  })

  it('returns the same object when there is nothing to mark', () => {
    const read = markAllRead(seed(['a']))
    expect(markAllRead(read)).toBe(read)
  })

  it('colours the bell by the worst thing waiting, not the newest', () => {
    let state = addNotification(EMPTY_NOTIFICATIONS, { message: 'build failed', severity: 'error', at: T0 })
    state = addNotification(state, { message: 'saved', at: T0 + 1 })
    expect(highestUnread(state)).toBe('error')

    // ...and nothing waiting means no colour at all.
    expect(highestUnread(markAllRead(state))).toBeUndefined()
  })

  it('prefers a warning to a notice', () => {
    let state = addNotification(EMPTY_NOTIFICATIONS, { message: 'notice', at: T0 })
    state = addNotification(state, { message: 'careful', severity: 'warning', at: T0 })
    expect(highestUnread(state)).toBe('warning')
  })

  it('forgets the oldest rather than growing without bound', () => {
    let state = EMPTY_NOTIFICATIONS
    for (let index = 0; index < HISTORY_LIMIT + 25; index += 1) {
      state = addNotification(state, { message: `m${index}`, at: T0 + index })
    }
    expect(state.entries).toHaveLength(HISTORY_LIMIT)
    expect(state.entries[0].message).toBe(`m${HISTORY_LIMIT + 24}`)
    expect(state.entries.at(-1)?.message).toBe('m25')
  })

  it('dismisses one and clears all', () => {
    const state = seed(['a', 'b', 'c'])
    const id = state.entries[1].id
    expect(dismissNotification(state, id).entries.map((entry) => entry.message)).toEqual(['c', 'a'])
    expect(clearNotifications(state).entries).toEqual([])
    // The sequence survives a clear, so ids never repeat.
    expect(clearNotifications(state).sequence).toBe(state.sequence)
  })

  it('says when, in units people use', () => {
    expect(describeWhen(T0, T0 + 3_000)).toBe('just now')
    expect(describeWhen(T0, T0 + 42_000)).toBe('42 seconds ago')
    expect(describeWhen(T0, T0 + 60_000)).toBe('1 minute ago')
    expect(describeWhen(T0, T0 + 20 * 60_000)).toBe('20 minutes ago')
    expect(describeWhen(T0, T0 + 3 * 3_600_000)).toBe('3 hours ago')
    expect(describeWhen(T0, T0 + 50 * 3_600_000)).toBe('2 days ago')
    // A clock that went backwards must not produce "-4 seconds ago".
    expect(describeWhen(T0, T0 - 5_000)).toBe('just now')
  })

  it('has something to say when nothing has happened', () => {
    expect(describeBell(EMPTY_NOTIFICATIONS)).toBe('No notifications yet')
    expect(describeBell(seed(['a']))).toBe('1 unread notification')
  })
})
