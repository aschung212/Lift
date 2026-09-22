/**
 * ExercisePickerModal — the app's one "Choose Exercise" sheet (LIFT-1375),
 * quick-logged from the Workouts tab and backfilled from CalendarView.
 *
 * LIFT-1462 gave it the search field both sibling exercise lists already had.
 * There was no spec for this component at all until now, which is why the gap
 * survived: LIFT-1375's extraction pinned the *structural* one-implementation
 * invariant and each host's prop binding, and the host suites assert what they
 * pass IN (`picker.props('exercises')`), so nothing had ever mounted the sheet
 * and looked at what it renders.
 *
 * The properties worth holding onto beyond "typing filters rows": the filter
 * must not re-sort (the quick-log list is recency-ordered so the next exercise
 * to train is on top, and narrowing should keep that), the "+ New exercise"
 * row must survive a zero-match query (a search that finds nothing is exactly
 * when you want to create one — leaving only Cancel is the dead end LIFT-1375
 * closed), and the threshold gate must read the TOTAL, or the field would
 * vanish out from under a query that narrows the list below it.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { enableAutoUnmount, mount, VueWrapper } from '@vue/test-utils'
import type { Exercise } from '../../stores/workout'
import ExercisePickerModal from '../ExercisePickerModal.vue'
import { runComponentAxe } from '../../__tests__/axeHelper'

// Every mount here attaches to the document (axe wants a real attached tree)
// and renders a dialog carrying the same `titleId`. Left mounted they would
// stack duplicate ids in the page the next test's axe run scans.
enableAutoUnmount(afterEach)

function makeExercise(id: string, name: string, extra: Partial<Exercise> = {}): Exercise {
  return { id, name, tags: [], sets: [], ...extra }
}

/** Five exercises — the search threshold — in a deliberately unsorted order. */
const FIVE = [
  makeExercise('e1', 'Overhead Press'),
  makeExercise('e2', 'Bench Press'),
  makeExercise('e3', 'Deadlift'),
  makeExercise('e4', 'Barbell Row'),
  makeExercise('e5', 'Incline Press'),
]

function mountPicker(props: { exercises?: Exercise[]; open?: boolean } = {}): VueWrapper {
  return mount(ExercisePickerModal, {
    props: {
      open: props.open ?? true,
      exercises: props.exercises ?? FIVE,
    },
    attachTo: document.body,
    global: { stubs: { Teleport: true } },
  })
}

/** Exercise rows only — the "+ New exercise" row shares .wtExPickerName. */
function rowNames(wrapper: VueWrapper): string[] {
  return wrapper
    .findAll('.wtExPickerRow:not(.wtExPickerNew) .wtExPickerName')
    .map(n => n.text())
}

async function search(wrapper: VueWrapper, query: string) {
  await wrapper.find('.wtSearchInput').setValue(query)
}

describe('ExercisePickerModal', () => {
  it('lists every exercise plus the create row', () => {
    const wrapper = mountPicker()
    expect(rowNames(wrapper)).toEqual([
      'Overhead Press', 'Bench Press', 'Deadlift', 'Barbell Row', 'Incline Press',
    ])
    expect(wrapper.find('.wtExPickerNew').text()).toContain('+ New exercise')
  })

  describe('search (LIFT-1462)', () => {
    it('is hidden below the threshold', () => {
      const wrapper = mountPicker({ exercises: FIVE.slice(0, 4) })
      expect(wrapper.find('.wtSearchInput').exists()).toBe(false)
    })

    it('appears at the threshold — one exercise before the 300px list scrolls', () => {
      const wrapper = mountPicker()
      expect(wrapper.find('.wtSearchInput').exists()).toBe(true)
    })

    it('filters rows by name, case-insensitively', async () => {
      const wrapper = mountPicker()
      await search(wrapper, 'press')
      expect(rowNames(wrapper)).toEqual(['Overhead Press', 'Bench Press', 'Incline Press'])
    })

    it('keeps the order the host handed it, rather than re-sorting the matches', async () => {
      // The quick-log picker is recency-ordered (#936) so the exercise you are
      // most likely to log next is on top. Narrowing must not reshuffle that
      // into alphabetical or into store order.
      const wrapper = mountPicker()
      await search(wrapper, 'e')
      expect(rowNames(wrapper)).toEqual([
        'Overhead Press', 'Bench Press', 'Deadlift', 'Barbell Row', 'Incline Press',
      ])
    })

    it('matches names only, not tags', async () => {
      // Unlike the exercise LIST's search, which also matches tags: a picker row
      // renders its name and nothing else, so a tag hit would return rows with
      // no visible reason for matching and no chips to explain them.
      const wrapper = mountPicker({
        exercises: [
          ...FIVE.slice(0, 4),
          makeExercise('e5', 'Cable Fly', { tags: ['Push'] }),
        ],
      })
      await search(wrapper, 'push')
      expect(rowNames(wrapper)).toEqual([])
    })

    it('still offers "+ New exercise" when nothing matches', async () => {
      const wrapper = mountPicker()
      await search(wrapper, 'zercher')
      expect(rowNames(wrapper)).toEqual([])
      expect(wrapper.find('.wtExPickerEmpty').text()).toContain('No exercises match')
      expect(wrapper.find('.wtExPickerNew').exists()).toBe(true)

      await wrapper.find('.wtExPickerNew').trigger('click')
      expect(wrapper.emitted('create-new')).toHaveLength(1)
    })

    it('selects the right exercise from a filtered list', async () => {
      const wrapper = mountPicker()
      await search(wrapper, 'incline')
      await wrapper.find('.wtExPickerRow:not(.wtExPickerNew)').trigger('click')
      expect(wrapper.emitted('select')).toEqual([['e5']])
    })

    it('keeps the field mounted when a query narrows the list below the threshold', async () => {
      // The gate reads the total, not the match count — otherwise the field
      // would unmount mid-query and take the user's text with it.
      const wrapper = mountPicker()
      await search(wrapper, 'deadlift')
      expect(rowNames(wrapper)).toEqual(['Deadlift'])
      expect(wrapper.find('.wtSearchInput').exists()).toBe(true)
    })

    it('shows the result tally visually and announces it', async () => {
      const wrapper = mountPicker()
      expect(wrapper.find('.wtSearchCount').exists()).toBe(false)
      expect(wrapper.find('.srOnly[role="status"]').text()).toBe('')

      await search(wrapper, 'press')
      expect(wrapper.find('.wtSearchCount').text()).toBe('3 results')
      expect(wrapper.find('.srOnly[role="status"]').text()).toBe('3 results')

      await search(wrapper, 'deadlift')
      expect(wrapper.find('.wtSearchCount').text()).toBe('1 result')
      expect(wrapper.find('.srOnly[role="status"]').text()).toBe('1 result')
    })

    it('clears the query when the sheet is reopened', async () => {
      // The sheet is dismissed and reopened between sets and the component stays
      // mounted throughout, so a stale filter would hide the exercise the user
      // came back for.
      const wrapper = mountPicker()
      await search(wrapper, 'deadlift')
      expect(rowNames(wrapper)).toHaveLength(1)

      await wrapper.setProps({ open: false })
      await wrapper.setProps({ open: true })

      expect((wrapper.find('.wtSearchInput').element as HTMLInputElement).value).toBe('')
      expect(rowNames(wrapper)).toHaveLength(5)
    })

    it('does not steal focus — iOS shows a caret but withholds the keyboard', () => {
      const wrapper = mountPicker()
      expect(document.activeElement).not.toBe(wrapper.find('.wtSearchInput').element)
    })
  })

  it('has no axe violations with the search bar shown', async () => {
    const wrapper = mountPicker()
    await search(wrapper, 'press')
    expect(await runComponentAxe(wrapper.element)).toHaveNoViolations()
  })
})
