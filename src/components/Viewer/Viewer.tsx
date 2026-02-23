import { useRef, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTeletext } from '../../context/TeletextContext';
import { TeletextGrid } from '../TeletextGrid/TeletextGrid';
import { exportPageAsPng } from '../../utils/exportPng';

const VALID_PAGE = (n: number) => Number.isInteger(n) && n >= 100 && n <= 999;

interface ViewerProps {
  /** Page number shown in header (may be animating) */
  pageNumber: number;
  /** Navigate to another page (triggers cycling animation) */
  onGoToPage?: (page: number) => void;
}

export function Viewer({ pageNumber, onGoToPage }: ViewerProps) {
  const { page } = useTeletext();
  const navigate = useNavigate();
  const [editingPage, setEditingPage] = useState(false);
  const [pageInput, setPageInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingPage) inputRef.current?.focus();
  }, [editingPage]);

  const openPageInput = () => {
    setPageInput('');
    setEditingPage(true);
  };

  const submitPageInput = () => {
    if (!onGoToPage) return;
    const n = parseInt(pageInput, 10);
    if (VALID_PAGE(n)) {
      const rounded = Math.round(n / 100) * 100;
      onGoToPage(rounded);
    }
    setEditingPage(false);
    setPageInput('');
  };

  const handlePageInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value.replace(/\D/g, '').slice(0, 3);
    setPageInput(v);
    if (v.length === 3) {
      const n = parseInt(v, 10);
      if (VALID_PAGE(n)) {
        const rounded = Math.round(n / 100) * 100;
        onGoToPage?.(rounded);
        setEditingPage(false);
        setPageInput('');
      }
    }
  };

  const handlePageInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') submitPageInput();
    if (e.key === 'Escape') {
      setEditingPage(false);
      setPageInput('');
    }
  };

  return (
    <div className="viewer">
      <h1 className="viewer-title">TELETEXT</h1>
      <div className="teletext-screen-wrapper">
        {editingPage && (
          <input
            ref={inputRef}
            type="text"
            inputMode="numeric"
            className="teletext-page-number-input"
            placeholder="___"
            value={pageInput}
            onChange={handlePageInputChange}
            onBlur={submitPageInput}
            onKeyDown={handlePageInputKeyDown}
            aria-label="Page number"
          />
        )}
        <TeletextGrid
          page={page}
          pageNumber={pageNumber}
          readOnly
          onIndexPageSelect={onGoToPage}
          onPageNumberClick={onGoToPage ? openPageInput : undefined}
        />
      </div>
      <div className="viewer-actions">
        <button type="button" onClick={() => navigate('/')}>
          Back to grid
        </button>
        <button type="button" onClick={() => navigate(`/edit/${pageNumber}`)}>
          Edit
        </button>
        <button type="button" onClick={() => exportPageAsPng(page)}>
          Export PNG
        </button>
      </div>
    </div>
  );
}
