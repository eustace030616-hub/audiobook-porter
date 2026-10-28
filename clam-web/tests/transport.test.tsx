import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TransportButton } from '../src/components/TransportButton'

const { skip, jumpChapter } = vi.hoisted(() => ({ skip: vi.fn(), jumpChapter: vi.fn() }))
vi.mock('../src/player', () => ({ usePlayer: () => ({ skip, jumpChapter }) }))
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers() })
const button = () => render(<TransportButton direction={1} label="Forward">Next</TransportButton>).getByRole('button')

it('supports synthesized clicks from assistive technology', () => {
  fireEvent.click(button())
  expect(skip).toHaveBeenCalledExactlyOnceWith(15)
})

it('supports native keyboard activation and an explicit chapter shortcut', async () => {
  const user = userEvent.setup()
  button().focus()
  await user.keyboard('{Enter}')
  await user.keyboard(' ')
  expect(skip).toHaveBeenCalledTimes(2)
  await user.keyboard('{Shift>}{Enter}{/Shift}')
  expect(jumpChapter).toHaveBeenCalledExactlyOnceWith(1)
  expect(skip).toHaveBeenCalledTimes(2)
})

it('does not also seek after holding to skip a chapter', () => {
  vi.useFakeTimers()
  const control = button()
  fireEvent.pointerDown(control)
  vi.advanceTimersByTime(600)
  fireEvent.pointerUp(control)
  fireEvent.click(control)
  expect(jumpChapter).toHaveBeenCalledExactlyOnceWith(1)
  expect(skip).not.toHaveBeenCalled()
})
