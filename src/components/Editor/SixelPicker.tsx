import { SIXEL_MAX, sixelBit } from '../../types/teletext';

interface SixelPickerProps {
  pattern: number;
  onChange: (pattern: number) => void;
  fg: string;
  className?: string;
}

/** 2×3 clickable grid to build a sixel pattern (0-63). */
export function SixelPicker({ pattern, onChange, fg, className = '' }: SixelPickerProps) {
  const p = pattern & 0x3f;
  const toggle = (i: number) => {
    onChange(p ^ (1 << i));
  };
  return (
    <div className={`sixel-picker teletext-fg-${fg} ${className}`} role="group" aria-label="Block pattern">
      <div className="sixel-picker-grid">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <button
            key={i}
            type="button"
            className={`sixel-picker-dot ${sixelBit(p, i) ? 'on' : ''}`}
            onClick={() => toggle(i)}
            aria-label={`Block ${i + 1} ${sixelBit(p, i) ? 'on' : 'off'}`}
          />
        ))}
      </div>
    </div>
  );
}

/** Preset patterns for quick selection (full, half, corners, etc.). */
export const SIXEL_PRESETS: { label: string; pattern: number }[] = [
  { label: 'Empty', pattern: 0 },
  { label: 'Full', pattern: SIXEL_MAX },
  { label: 'Left', pattern: 0b000111 },
  { label: 'Right', pattern: 0b111000 },
  { label: 'Top', pattern: 0b110000 },
  { label: 'Bottom', pattern: 0b000011 },
  { label: 'Top half', pattern: 0b111100 },
  { label: 'Bottom half', pattern: 0b001111 },
];
