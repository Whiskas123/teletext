import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTeletext } from '../context/TeletextContext';
import { Viewer } from './Viewer/Viewer';
import { createEmptyPage } from '../types/teletext';
import type { TeletextPage } from '../types/teletext';

const VALID_PAGE_NUMBERS = new Set([100, 200, 300, 400, 500, 600, 700, 800, 900]);
const CYCLE_MS = 22;

/** Steps from `from` to `to` always incrementing by 1; 999 wraps to 100 */
function getSteps(from: number, to: number): number[] {
  if (from === to) return [from];
  const steps: number[] = [];
  let n = from;
  while (true) {
    steps.push(n);
    if (n === to) break;
    n = n >= 999 ? 100 : n + 1;
  }
  return steps;
}

export function ViewerPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { setPage, setMode } = useTeletext();
  const pageParam = searchParams.get('page');
  const targetPage = pageParam != null && /^\d+$/.test(pageParam)
    ? Math.min(900, Math.max(100, Math.round(parseInt(pageParam, 10) / 100) * 100))
    : 100;
  const valid = VALID_PAGE_NUMBERS.has(targetPage);

  const [displayPage, setDisplayPage] = useState(targetPage);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const previousTargetRef = useRef(targetPage);
  const animatingRef = useRef(false);
  const hasLoadedOnceRef = useRef(false);

  useEffect(() => {
    if (!valid) {
      navigate('/', { replace: true });
      return;
    }
    let cancelled = false;
    const steps = getSteps(previousTargetRef.current, targetPage);
    if (steps.length <= 1) {
      previousTargetRef.current = targetPage;
      setDisplayPage(targetPage);
      animatingRef.current = false;
      setLoading(true);
      fetch(`/api/pages/${targetPage}`)
        .then((r) => {
          if (!r.ok) throw new Error('Failed to load page');
          return r.json();
        })
        .then((data: TeletextPage) => {
          if (cancelled) return;
          setPage(Array.isArray(data) && data.length === 40 * 24 ? data : createEmptyPage());
          setMode('viewer');
          setError(null);
          hasLoadedOnceRef.current = true;
        })
        .catch((e) => {
          if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => { cancelled = true; };
    }

    animatingRef.current = true;
    setDisplayPage(steps[0]);
    let i = 0;
    const id = setInterval(() => {
      if (cancelled) return;
      i += 1;
      if (i >= steps.length) {
        clearInterval(id);
        animatingRef.current = false;
        previousTargetRef.current = targetPage;
        setDisplayPage(targetPage);
        setLoading(true);
        fetch(`/api/pages/${targetPage}`)
          .then((r) => {
            if (!r.ok) throw new Error('Failed to load page');
            return r.json();
          })
          .then((data: TeletextPage) => {
            if (cancelled) return;
            setPage(Array.isArray(data) && data.length === 40 * 24 ? data : createEmptyPage());
            setMode('viewer');
            setError(null);
            hasLoadedOnceRef.current = true;
          })
          .catch((e) => {
            if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
          })
          .finally(() => {
            if (!cancelled) setLoading(false);
          });
        return;
      }
      setDisplayPage(steps[i]);
    }, CYCLE_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [valid, targetPage, navigate, setPage, setMode]);

  const goToPage = (n: number) => {
    if (!VALID_PAGE_NUMBERS.has(n)) return;
    navigate(`/view?page=${n}`, { replace: false });
  };

  if (!valid) return null;
  if (loading && !hasLoadedOnceRef.current) return <div className="viewer"><p>Loading…</p></div>;
  if (error && hasLoadedOnceRef.current === false) return <div className="viewer"><p className="page-grid-error">{error}</p></div>;

  return <Viewer pageNumber={displayPage} onGoToPage={goToPage} />;
}
