// The server reads the live document by the channel ids the hooks write it
// under, restated there because those modules pull in React. They must agree,
// or the daily backup would read empty channels and copy nothing.

import { expect, it } from 'vitest';

import { CHANNELS } from '../../api/_lib/liveDocument';
import { PAGES_CHANNEL } from './useEditPage';
import { TITLES_CHANNEL } from './useGuide';
import { PAGE_KINDS_CHANNEL } from './usePageKinds';
import { DESCRIPTIONS_CHANNEL } from './usePageText';

it('reads the channels by the same ids the hooks write them under', () => {
  expect(CHANNELS.pages).toBe(PAGES_CHANNEL);
  expect(CHANNELS.titles).toBe(TITLES_CHANNEL);
  expect(CHANNELS.kinds).toBe(PAGE_KINDS_CHANNEL);
  expect(CHANNELS.descriptions).toBe(DESCRIPTIONS_CHANNEL);
});
