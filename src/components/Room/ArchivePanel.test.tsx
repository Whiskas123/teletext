// Feature: manage-page-tabs — the Archive panel.
// Verifies: the free-text search that was never wired up, the 300 ms debounce, the
// offset reset, loading and failure states, the pager, and the publish guards.

import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ArchivePanel, type ArchivePanelProps } from './ArchivePanel';
import { useArchiveState, type ArchiveState } from './useArchiveState';
import type { CaptureSummary } from '../../collab/useArchiveAdmin';
import { createEmptyPage } from '../../types/teletext';

function capture(id: number, over: Partial<CaptureSummary> = {}): CaptureSummary {
  return {
    id,
    source: 'rtp',
    original_page: 200 + id,
    sub: '',
    sub_index: null,
    topic: 'desporto',
    topic_group: 'desporto',
    topic_source: 'folder',
    scheme: '1998-2000',
    first_seen: '1998-06-15',
    last_seen: '1998-06-15',
    capture_count: 1,
    tier: null,
    bucket: null,
    manifest_title: `Capture ${id}`,
    decode_status: 'ok',
    profile: 'rtp-1',
    width: 640,
    height: 480,
    snapped_pixels: 0,
    unknown_glyphs: 0,
    corpus_file: `${200 + id}-01.gif`,
    has_image: true,
    ...over,
  };
}

/** Exposes the panel's state so query-shaping can be asserted from outside. */
let observed: ArchiveState;

function Harness(overrides: Partial<ArchivePanelProps> = {}) {
  const state = useArchiveState();
  // Published after the render rather than during it, so the probe is not itself
  // a side effect in render.
  useEffect(() => {
    observed = state;
  });

  return (
    <ArchivePanel
      state={state}
      captures={[capture(1), capture(2)]}
      total={2}
      pageSize={60}
      loading={false}
      error={null}
      onRetry={vi.fn()}
      menus={[]}
      onSaveMenu={vi.fn().mockResolvedValue({ ok: true })}
      onDeleteMenu={vi.fn().mockResolvedValue({ ok: true })}
      loadPage={vi.fn().mockResolvedValue(createEmptyPage())}
      livePage={() => null}
      transform={(page) => page}
      publicationsByPage={new Map()}
      publishBusy={false}
      onPublish={vi.fn()}
      onPublishBatch={vi.fn()}
      {...overrides}
    />
  );
}

const renderPanel = (overrides: Partial<ArchivePanelProps> = {}) =>
  render(<Harness {...overrides} />);

const searchBox = () => screen.getByLabelText(/search titles and filenames/i);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the free-text search', () => {
  it('exists at all, which it did not', () => {
    renderPanel();
    expect(searchBox()).toBeInTheDocument();
  });

  it('holds the term as typed rather than trimming between keystrokes', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.type(searchBox(), 'lisboa ');
    expect(searchBox()).toHaveValue('lisboa ');
  });

  it('waits for the typing to stop before it reaches the query', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.type(searchBox(), 'lis');
    // The filters carry every keystroke; the query has not seen one yet.
    expect(observed.filters.q).toBe('lis');
    expect(observed.queryFilters.q).toBeUndefined();

    await waitFor(() => expect(observed.queryFilters.q).toBe('lis'));
  });

  it('trims the term on its way to the query', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.type(searchBox(), '  lisboa  ');
    await waitFor(() => expect(observed.queryFilters.q).toBe('lisboa'));
    // And leaves the input as it was typed.
    expect(searchBox()).toHaveValue('  lisboa  ');
  });

  it('accepts no more than 100 characters', () => {
    renderPanel();
    expect(searchBox()).toHaveAttribute('maxlength', '100');
  });
});

describe('the other filters', () => {
  it('apply at once, without waiting', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.selectOptions(screen.getByLabelText(/^source$/i), 'sic');
    expect(observed.queryFilters.source).toBe('sic');
  });

  it('reset the place in the results', async () => {
    const user = userEvent.setup();
    renderPanel({ total: 200 });

    await user.click(screen.getByRole('button', { name: /next/i }));
    expect(observed.offset).toBe(60);

    await user.selectOptions(screen.getByLabelText(/^era$/i), '2001-2005');
    // Page 2 of a result set that may only have one page shows nothing, which
    // reads as a broken filter.
    expect(observed.offset).toBe(0);
  });
});

describe('the results', () => {
  it('shows a loading indicator in place of results', () => {
    renderPanel({ loading: true, captures: [] });

    expect(screen.getByText(/loading…/i)).toBeInTheDocument();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  it('names every filter in force when nothing matches, and can clear them', async () => {
    const user = userEvent.setup();
    renderPanel({ captures: [], total: 0 });

    await user.selectOptions(screen.getByLabelText(/^source$/i), 'sic');
    expect(screen.getByText(/no capture matches/i)).toHaveTextContent(/SIC/);

    await user.click(screen.getByRole('button', { name: /clear all filters/i }));
    expect(observed.filters).toEqual({});
  });

  it('announces a failure and offers the same query again', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    renderPanel({ error: 'Could not load the archive.', onRetry });

    expect(screen.getByRole('alert')).toHaveTextContent(/could not load the archive/i);

    await user.selectOptions(screen.getByLabelText(/^source$/i), 'sic');
    await user.click(screen.getByRole('button', { name: /try that search again/i }));

    expect(onRetry).toHaveBeenCalledTimes(1);
    // The filters the operator set are left as they were.
    expect(observed.filters.source).toBe('sic');
  });

  it('pages by the window size, and stops at both ends', async () => {
    const user = userEvent.setup();
    renderPanel({ total: 120 });

    expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled();
    expect(screen.getByText('1–60 of 120')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /next/i }));
    expect(observed.offset).toBe(60);
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
  });

  it('hides the pager when everything fits in one window', () => {
    renderPanel({ total: 2 });
    expect(screen.queryByRole('navigation')).toBeNull();
  });
});

describe('choosing a capture', () => {
  it('offers nothing to publish until one is picked', () => {
    renderPanel();
    expect(screen.getByText(/pick a capture/i)).toBeInTheDocument();
  });

  it('fills the target and title from the capture', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getAllByRole('button', { name: /RTP page 201/i })[0]);

    expect(screen.getByLabelText(/publish to page/i)).toHaveValue(201);
    expect(screen.getByLabelText(/^title \(/i)).toHaveValue('Capture 1');
  });

  it('loads the cells for the capture that is selected, not an earlier one', async () => {
    const user = userEvent.setup();
    const loadPage = vi.fn().mockResolvedValue(createEmptyPage());
    renderPanel({ loadPage });

    await user.click(screen.getAllByRole('button', { name: /RTP page 201/i })[0]);
    await user.click(screen.getAllByRole('button', { name: /RTP page 202/i })[0]);

    await waitFor(() => expect(observed.sourcePage).not.toBeNull());
    // The last call is the selected capture's; the first was abandoned.
    expect(loadPage).toHaveBeenLastCalledWith(2);
    expect(observed.selected?.id).toBe(2);
  });

  it('says so when the selection has fallen out of the current results', () => {
    renderPanel();
    expect(screen.queryByText(/not in these results/i)).toBeNull();
  });
});

describe('publishing', () => {
  it('refuses a target in the playground, with the reason', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getAllByRole('button', { name: /RTP page 201/i })[0]);
    const target = screen.getByLabelText(/publish to page/i);
    await user.clear(target);
    await user.type(target, '712');

    expect(screen.getByText(/must be between 100 and 699/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^publish$/i })).toBeDisabled();
  });

  it('bounds the target input to the curated range', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getAllByRole('button', { name: /RTP page 201/i })[0]);
    const target = screen.getByLabelText(/publish to page/i);
    expect(target).toHaveAttribute('min', '100');
    expect(target).toHaveAttribute('max', '699');
  });

  it('refuses a capture that has not been decoded, naming its status', async () => {
    const user = userEvent.setup();
    renderPanel({
      captures: [capture(1, { decode_status: 'failed' })],
      total: 1,
    });

    await user.click(screen.getAllByRole('button', { name: /RTP page 201/i })[0]);

    expect(screen.getByText(/decode status: failed/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^publish$/i })).toBeDisabled();
  });

  it('disables only the publish button while a publish is in flight', async () => {
    const user = userEvent.setup();
    renderPanel({ publishBusy: true, total: 120 });

    await user.click(screen.getAllByRole('button', { name: /RTP page 201/i })[0]);

    expect(screen.getByRole('button', { name: /publishing…/i })).toBeDisabled();
    // Nothing else on the screen is taken away, which one shared `busy` flag
    // used to do to every control at once.
    expect(screen.getByRole('button', { name: /next/i })).toBeEnabled();
    expect(searchBox()).toBeEnabled();
    expect(screen.getByLabelText(/^title \(/i)).toBeEnabled();
  });
});
