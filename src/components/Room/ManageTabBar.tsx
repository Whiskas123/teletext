/**
 * The two tabs at the top of `/manage`.
 *
 * A real tablist rather than two buttons that look like one: roving tabindex, so
 * Tab reaches the tab strip once and then moves into the panel; arrows to move
 * between tabs; Home and End to reach either end. Activation follows focus,
 * which is the right choice here because switching panels is cheap and
 * reversible — there is nothing to confirm.
 *
 * ## The counts are part of the label
 *
 * "On Air" alone does not tell an operator whether there is anything to look at.
 * The counts go in the accessible name, not in a decoration beside it, so they
 * are announced with the tab rather than found afterwards. A count the screen
 * does not know yet is left out entirely — a confident `0` while playhtml is
 * still syncing reads as "nothing is on air", which is worse than saying
 * nothing.
 */

import { useCallback, useRef } from 'react';

import {
  TAB_KEYS,
  tabForKey,
  type TabKey,
  type TabNavKey,
} from '../../domain/manageTabs';

/** Counts for the On Air tab, or null while the live document is still syncing. */
export interface OnAirCounts {
  curated: number;
  playground: number;
}

export interface ManageTabBarProps {
  selected: TabKey;
  onSelect(tab: TabKey): void;
  onAirCounts: OnAirCounts | null;
  /** Captures matching the current filters, or null before the first answer. */
  captureTotal: number | null;
  /** Id of the rendered panel, for `aria-controls`. */
  panelId: string;
  tabId(tab: TabKey): string;
}

const NAV_KEYS: readonly string[] = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];

export function ManageTabBar({
  selected,
  onSelect,
  onAirCounts,
  captureTotal,
  panelId,
  tabId,
}: ManageTabBarProps) {
  const refs = useRef(new Map<TabKey, HTMLButtonElement | null>());

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        // The tab under focus is already selected — activation follows focus —
        // so there is nothing to do but stop the page scrolling.
        event.preventDefault();
        return;
      }
      if (!NAV_KEYS.includes(event.key)) return;

      event.preventDefault();
      const next = tabForKey(selected, event.key as TabNavKey);
      onSelect(next);
      refs.current.get(next)?.focus();
    },
    [selected, onSelect],
  );

  return (
    <div className="manage-tabs" role="tablist" aria-orientation="horizontal">
      {TAB_KEYS.map((tab) => {
        const isSelected = tab === selected;
        return (
          <button
            key={tab}
            type="button"
            role="tab"
            id={tabId(tab)}
            ref={(node) => {
              refs.current.set(tab, node);
            }}
            className={`manage-tab${isSelected ? ' manage-tab-selected' : ''}`}
            aria-selected={isSelected}
            // Only the rendered panel exists to point at; the other tab's panel
            // is not in the document, so a reference to it would dangle.
            aria-controls={isSelected ? panelId : undefined}
            // Roving tabindex: one stop for the whole strip.
            tabIndex={isSelected ? 0 : -1}
            onClick={() => onSelect(tab)}
            onKeyDown={handleKeyDown}
          >
            {tab === 'on-air' ? (
              <>
                <span className="manage-tab-name">On Air</span>
                {onAirCounts != null && (
                  <span className="manage-tab-count">
                    {onAirCounts.curated} in 100–699 · {onAirCounts.playground} in
                    700–999
                  </span>
                )}
              </>
            ) : (
              <>
                <span className="manage-tab-name">Archive</span>
                {captureTotal != null && (
                  <span className="manage-tab-count">
                    {captureTotal} captures match
                  </span>
                )}
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}
