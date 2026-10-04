// The kiosk: the exhibition screen locked up, driven by what a remote sends.

import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { useExhibitMode } from './useExhibitMode';

const press = (key: string) =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true }));
  });

describe('useExhibitMode, locked', () => {
  it('cannot be left, and answers the remote', () => {
    const onPageStep = vi.fn();
    const onPageSelect = vi.fn();
    const onPageEntry = vi.fn();
    const { result } = renderHook(
      () => useExhibitMode({ locked: true, onPageStep, onPageSelect, onPageEntry }),
      { wrapper: MemoryRouter },
    );

    expect(result.current.active).toBe(true);
    press('Escape');
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F', shiftKey: true }));
    });
    expect(result.current.active).toBe(true);

    press('ChannelUp');
    press('PageDown');
    expect(onPageStep.mock.calls).toEqual([[1], [-1]]);

    press('ColorF1Green');
    press('F4');
    expect(onPageSelect.mock.calls).toEqual([[200], [400]]);

    press('2');
    press('4');
    press('3');
    expect(onPageEntry).toHaveBeenCalledWith(243);
  });
});
