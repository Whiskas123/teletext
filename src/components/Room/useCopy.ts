/**
 * useCopy — the words, in the language this visitor chose.
 *
 * A one-line wrapper over {@link useCurrentLanguage} and {@link COPY}, which is the
 * point: components ask for `copy.chat.send` and never for a language, so none
 * of them has to know that a preference exists or where it is kept.
 *
 * The choice is made once, on the front page, and remembered in `localStorage`.
 * There is no switch on the other screens — a language toggle on a television
 * cabinet would be a control the television never had, and by the time you are
 * watching you have already answered the question. Every screen simply opens in
 * whatever was chosen, and changing it means going back to the front page.
 */

import { COPY, type Copy } from '../../domain/copy';
import { useCurrentLanguage } from './languageContext';

export function useCopy(): Copy {
  const language = useCurrentLanguage();
  return COPY[language];
}

export default useCopy;
