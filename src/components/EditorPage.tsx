import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTeletext } from '../context/TeletextContext';
import { Editor } from './Editor/Editor';
import { createEmptyPage } from '../types/teletext';
import type { TeletextPage } from '../types/teletext';

const VALID_PAGE_NUMBERS = new Set([100, 200, 300, 400, 500, 600, 700, 800, 900]);
const SAVE_INTERVAL_MS = 3000;

export function EditorPage() {
  const { pageNumber: param } = useParams<{ pageNumber: string }>();
  const navigate = useNavigate();
  const { page, setPage, setMode } = useTeletext();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const lastSavedJsonRef = useRef<string>('');
  const pageRef = useRef(page);
  pageRef.current = page;

  const pageNumber = param != null ? parseInt(param, 10) : null;
  const valid = pageNumber != null && Number.isInteger(pageNumber) && VALID_PAGE_NUMBERS.has(pageNumber);

  const save = useCallback(async () => {
    if (pageNumber == null) return;
    const body = JSON.stringify(pageRef.current);
    const url = `/api/pages/${pageNumber}`;
    console.log('[EditorPage] PUT save', { pageNumber, url, bodyLength: body.length });
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    console.log('[EditorPage] PUT response', { status: res.status, ok: res.ok, statusText: res.statusText });
    if (!res.ok) {
      const text = await res.text();
      console.log('[EditorPage] PUT error body', text);
      let errMsg = res.statusText;
      try {
        const d = JSON.parse(text) as { error?: string };
        if (d?.error) errMsg = d.error;
      } catch {
        if (text) errMsg = text.slice(0, 100);
      }
      throw new Error(errMsg);
    }
    lastSavedJsonRef.current = body;
    setSaveError(null);
    console.log('[EditorPage] PUT save ok');
  }, [pageNumber]);

  const handleBackToGrid = useCallback(async () => {
    try {
      await save();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed');
      return;
    }
    navigate('/');
  }, [save, navigate]);

  useEffect(() => {
    if (!valid) {
      navigate('/', { replace: true });
      return;
    }
    let cancelled = false;
    fetch(`/api/pages/${pageNumber}`)
      .then((r) => {
        if (!r.ok) throw new Error('Failed to load page');
        return r.json();
      })
      .then((data: TeletextPage) => {
        if (cancelled) return;
        const loaded = Array.isArray(data) && data.length === 40 * 24 ? data : createEmptyPage();
        setPage(loaded);
        setMode('editor');
        setError(null);
        lastSavedJsonRef.current = JSON.stringify(loaded);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [valid, pageNumber, navigate, setPage, setMode]);

  useEffect(() => {
    if (!valid || pageNumber == null || loading) return;

    const id = setInterval(() => {
      const currentJson = JSON.stringify(pageRef.current);
      if (currentJson === lastSavedJsonRef.current) return;
      save().catch((e) => {
        setSaveError(e instanceof Error ? e.message : 'Save failed');
      });
    }, SAVE_INTERVAL_MS);

    return () => clearInterval(id);
  }, [valid, pageNumber, loading, save]);

  if (!valid) return null;
  if (loading) return <div className="editor-layout"><p style={{ padding: '1rem' }}>Loading…</p></div>;
  if (error) return <div className="editor-layout"><p className="page-grid-error" style={{ padding: '1rem' }}>{error}</p></div>;

  return (
    <>
      {saveError != null && (
        <div className="editor-save-error" role="alert">
          Save failed: {saveError}
        </div>
      )}
      <Editor pageNumber={pageNumber!} onBackToGrid={handleBackToGrid} />
    </>
  );
}
