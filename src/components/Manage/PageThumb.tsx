/**
 * A page as a small picture, drawn only once it scrolls into view.
 *
 * The list can hold several hundred pages, and a canvas each is only cheap
 * when most of them are never drawn. Where `IntersectionObserver` is missing
 * (jsdom, very old browsers) the thumbnail draws straight away rather than
 * never.
 */

import { useEffect, useRef, useState } from 'react';

import type { TeletextPage } from '../../types/teletext';
import { TeletextThumbnail } from '../TeletextGrid/TeletextThumbnail';

export interface PageThumbProps {
  page: TeletextPage | null;
  pageNumber: number;
  subpage?: number;
  subpageCount?: number;
  scale?: number;
  className?: string;
  alt?: string;
}

export function PageThumb({
  page,
  pageNumber,
  subpage = 1,
  subpageCount = 1,
  scale = 0.25,
  className,
  alt,
}: PageThumbProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === 'undefined');

  useEffect(() => {
    if (seen || ref.current == null) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [seen]);

  return (
    <div ref={ref} className={`mg-thumb${className ? ` ${className}` : ''}`}>
      {page == null ? (
        <span className="mg-thumb-empty" aria-label={alt}>
          empty
        </span>
      ) : seen ? (
        <TeletextThumbnail
          page={page}
          pageNumber={pageNumber}
          subpage={subpage}
          subpageCount={subpageCount}
          scale={scale}
          alt={alt}
        />
      ) : null}
    </div>
  );
}
