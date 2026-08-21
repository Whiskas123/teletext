/**
 * `useNavigate`, keeping the language the visitor is reading in.
 *
 * The counterpart to {@link Link} for the places that navigate in a handler
 * rather than through an anchor — choosing a page from the directory, or
 * landing on the first free playground page. Without it, any of those would
 * drop `/en` and switch the visitor's language mid-visit.
 */

import { useCallback } from 'react';
import { useNavigate, type NavigateOptions } from 'react-router-dom';

import { localize } from './localizeTo';
import { useCurrentLanguage } from './languageContext';

export function useLocalizedNavigate() {
  const language = useCurrentLanguage();
  const navigate = useNavigate();

  // Rest args rather than a named optional one, so the call arrives at
  // `navigate` with exactly the arity it was given. Passing an explicit
  // `undefined` second argument is not the same call, and it is the kind of
  // difference that shows up only in a mock's recorded arguments.
  return useCallback(
    (to: string, ...rest: [NavigateOptions?]) => {
      navigate(localize(to, language) as string, ...rest);
    },
    [language, navigate],
  );
}
