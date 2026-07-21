import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  clonePage,
  createEmptyPage,
  type TeletextPage,
} from '../types/teletext';

type Mode = 'editor' | 'viewer';

interface TeletextContextValue {
  page: TeletextPage;
  setPage: (page: TeletextPage | ((prev: TeletextPage) => TeletextPage)) => void;
  mode: Mode;
  setMode: (mode: Mode) => void;
  startEditingCopy: () => void;
}

const TeletextContext = createContext<TeletextContextValue | null>(null);

export function TeletextProvider({ children }: { children: ReactNode }) {
  const [{ page, mode }, setState] = useState(() => ({
    page: createEmptyPage(),
    mode: 'editor' as Mode,
  }));

  const setPage = useCallback(
    (updater: TeletextPage | ((prev: TeletextPage) => TeletextPage)) => {
      setState((prev) => ({
        ...prev,
        page: typeof updater === 'function' ? updater(prev.page) : updater,
      }));
    },
    []
  );

  const setMode = useCallback((next: Mode) => {
    setState((prev) => ({ ...prev, mode: next }));
  }, []);

  const startEditingCopy = useCallback(() => {
    setState((prev) => ({ ...prev, page: clonePage(prev.page), mode: 'editor' }));
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }, []);

  const value = useMemo<TeletextContextValue>(
    () => ({
      page,
      setPage,
      mode,
      setMode,
      startEditingCopy,
    }),
    [page, setPage, mode, setMode, startEditingCopy]
  );

  return (
    <TeletextContext.Provider value={value}>
      {children}
    </TeletextContext.Provider>
  );
}

export function useTeletext() {
  const ctx = useContext(TeletextContext);
  if (!ctx) {
    throw new Error('useTeletext must be used within TeletextProvider');
  }
  return ctx;
}

/**
 * Non-throwing variant of {@link useTeletext}. Returns the context value when a
 * {@link TeletextProvider} is present, or `null` otherwise. Used by components
 * (e.g. the refactored `Editor`) that can be driven either by the local
 * TeletextContext or by injected props (a collaborative hook) without requiring
 * a provider in the injected case.
 */
export function useTeletextOptional() {
  return useContext(TeletextContext);
}
