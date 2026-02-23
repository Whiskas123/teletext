import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { TeletextGrid } from '../TeletextGrid/TeletextGrid';
import { createEmptyPage, type TeletextPage } from '../../types/teletext';

const PAGE_NUMBERS = [100, 200, 300, 400, 500, 600, 700, 800, 900];
const POLL_INTERVAL_MS = 3000;

function fetchPages(): Promise<Record<string, TeletextPage>> {
  return fetch('/api/pages').then((r) => {
    if (!r.ok) throw new Error('Failed to fetch pages');
    return r.json();
  });
}

export function PageGrid() {
  const [pages, setPages] = useState<Record<string, TeletextPage>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const versionsRef = useRef<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        const data = await fetchPages();
        if (cancelled) return;
        setPages((prev) => {
          const next = { ...prev };
          let changed = false;
          for (const num of PAGE_NUMBERS) {
            const key = String(num);
            const page = data[key];
            if (!page || !Array.isArray(page)) continue;
            const version = JSON.stringify(page);
            if (versionsRef.current[key] !== version) {
              versionsRef.current[key] = version;
              next[key] = page as TeletextPage;
              changed = true;
            }
          }
          return changed ? { ...next } : prev;
        });
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();
    const id = setInterval(run, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (loading && Object.keys(pages).length === 0) {
    return (
      <div className="page-grid-wrapper">
        <p className="page-grid-loading">Loading pages…</p>
      </div>
    );
  }

  if (error && Object.keys(pages).length === 0) {
    return (
      <div className="page-grid-wrapper">
        <p className="page-grid-error">{error}</p>
      </div>
    );
  }

  return (
    <div className="page-grid-wrapper">
      <h1 className="page-grid-title">TELETEXT</h1>
      <div className="page-grid">
        {PAGE_NUMBERS.map((num) => (
          <Link key={num} to={`/view?page=${num}`} className="page-grid-card">
            <span className="page-grid-card-number">{num}</span>
            <div className="page-grid-card-preview">
              <TeletextGrid
                page={pages[String(num)] ?? createEmptyPage()}
                pageNumber={num}
                readOnly
                compact
              />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
