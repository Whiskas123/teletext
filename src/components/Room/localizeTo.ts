/**
 * Putting the current language's prefix back onto a destination.
 *
 * Shared by {@link Link} and {@link useLocalizedNavigate}, and in its own file
 * because those two live in separate ones: a module that exports a component
 * may export nothing else, or React Fast Refresh stops working for it.
 *
 * Only an absolute path is localised. An object destination (`search`, `state`)
 * and a relative path both pass through: relative navigation already resolves
 * against the current URL, prefix included, so prefixing again would double it.
 */

import type { To } from 'react-router-dom';

import { localizePath } from '../../domain/routes';
import type { Language } from '../../domain/landing';

export function localize(to: To, language: Language): To {
  return typeof to === 'string' && to.startsWith('/')
    ? localizePath(to, language)
    : to;
}
