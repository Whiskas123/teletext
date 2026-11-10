import { expect, it } from 'vitest';

import { screenTarget } from './dnd';

it('puts a dragged screen where it was dropped, closing up behind it', () => {
  expect(screenTarget(3, 1, 'before')).toBe(1); // up, to the front
  expect(screenTarget(1, 3, 'after')).toBe(3); // down, to the end
  expect(screenTarget(1, 3, 'before')).toBe(2); // down, above 3: 2 and 3 close up
  expect(screenTarget(5, 2, 'after')).toBe(3); // up, below 2
  expect(screenTarget(2, 2, 'after')).toBe(2); // onto itself: no move
  expect(screenTarget(2, 3, 'before')).toBe(2); // just below itself: no move
});
