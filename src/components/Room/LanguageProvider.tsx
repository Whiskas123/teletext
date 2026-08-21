/**
 * States the language of everything below it. See `languageContext.ts` for why
 * reading the language is context rather than a router hook; this is the half
 * that has to be a component, and lives apart from the hook because a module
 * exporting a component may export nothing else without breaking Fast Refresh.
 */

import type { ReactNode } from 'react';

import type { Language } from '../../domain/landing';
import { LanguageContext } from './languageContext';

export function LanguageProvider({
  language,
  children,
}: {
  language: Language;
  children: ReactNode;
}) {
  return <LanguageContext value={language}>{children}</LanguageContext>;
}
