import { act, renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';

import { useLineupSelection } from './useLineupSelection';

const order = [100, 101, 102, 103, 104, 105];
const plain = { shift: false, toggle: false };
const picked = (result: { current: ReturnType<typeof useLineupSelection> }) =>
  [...result.current.selected].sort((a, b) => a - b);

it('keeps picked rows when a row is clicked without a modifier, until cleared', () => {
  const { result } = renderHook(() => useLineupSelection());
  act(() => result.current.click(100, plain, order));
  act(() => result.current.click(101, plain, order));
  expect(picked(result)).toEqual([101]); // browsing: a click moves the selection

  act(() => result.current.clear());
  act(() => result.current.toggle(103)); // a checkbox starts picking
  act(() => result.current.click(105, plain, order));
  expect(picked(result)).toEqual([103, 105]);
  act(() => result.current.click(103, plain, order));
  expect(picked(result)).toEqual([105]);

  act(() => result.current.clear());
  act(() => result.current.click(102, plain, order));
  act(() => result.current.click(104, plain, order));
  expect(picked(result)).toEqual([104]); // cleared: browsing again
});

it('adds the stretch from the anchor to what is selected on a shift-checked box', () => {
  const { result } = renderHook(() => useLineupSelection());
  act(() => result.current.toggle(100));
  act(() => result.current.toggle(102));
  act(() => result.current.addRange(105, order));
  expect(picked(result)).toEqual([100, 102, 103, 104, 105]);
});
