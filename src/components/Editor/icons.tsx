/**
 * Small inline icons for the editor sidebar's brush/action buttons.
 *
 * Hand-drawn rather than pulled from an icon library — there isn't one in
 * this project, and a handful of simple geometric shapes is cheaper than a
 * new dependency. All use `currentColor` so they pick up whatever color the
 * surrounding button already has (idle / hover / active), and `Block`/`Pixel`
 * deliberately echo the app's own 2×3 sixel motif rather than a generic
 * paintbrush glyph, so they read as "this app's brushes" at a glance.
 */

interface IconProps {
  className?: string;
}

const ICON_SIZE = 14;

export function IconTextCursor({ className }: IconProps) {
  return (
    <svg
      className={className}
      width={ICON_SIZE}
      height={ICON_SIZE}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M5 3h6M8 3v10M5 13h6" />
    </svg>
  );
}

export function IconBlock({ className }: IconProps) {
  return (
    <svg
      className={className}
      width={ICON_SIZE}
      height={ICON_SIZE}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <rect x="2" y="2" width="5" height="3.4" />
      <rect x="9" y="2" width="5" height="3.4" />
      <rect x="2" y="6.3" width="5" height="3.4" />
      <rect x="9" y="6.3" width="5" height="3.4" />
      <rect x="2" y="10.6" width="5" height="3.4" />
      <rect x="9" y="10.6" width="5" height="3.4" />
    </svg>
  );
}

export function IconPixel({ className }: IconProps) {
  return (
    <svg
      className={className}
      width={ICON_SIZE}
      height={ICON_SIZE}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <rect x="2" y="2" width="5" height="3.4" fill="currentColor" />
      <rect x="9" y="2" width="5" height="3.4" stroke="currentColor" strokeWidth="1" opacity="0.45" />
      <rect x="2" y="6.3" width="5" height="3.4" stroke="currentColor" strokeWidth="1" opacity="0.45" />
      <rect x="9" y="6.3" width="5" height="3.4" stroke="currentColor" strokeWidth="1" opacity="0.45" />
      <rect x="2" y="10.6" width="5" height="3.4" stroke="currentColor" strokeWidth="1" opacity="0.45" />
      <rect x="9" y="10.6" width="5" height="3.4" stroke="currentColor" strokeWidth="1" opacity="0.45" />
    </svg>
  );
}

export function IconBlink({ className }: IconProps) {
  return (
    <svg
      className={className}
      width={ICON_SIZE}
      height={ICON_SIZE}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M9 1 3 9h3.5L6 15l6-8H8.5L9 1Z" />
    </svg>
  );
}

export function IconDoubleHeight({ className }: IconProps) {
  return (
    <svg
      className={className}
      width={ICON_SIZE}
      height={ICON_SIZE}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <rect x="2" y="9" width="4" height="5" rx="0.5" />
      <rect x="9" y="2" width="4" height="12" rx="0.5" />
    </svg>
  );
}

export function IconExport({ className }: IconProps) {
  return (
    <svg
      className={className}
      width={ICON_SIZE}
      height={ICON_SIZE}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 2v7M5 6l3 3 3-3M3 13h10" />
    </svg>
  );
}

export function IconTrash({ className }: IconProps) {
  return (
    <svg
      className={className}
      width={ICON_SIZE}
      height={ICON_SIZE}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 4.5h10M6.25 4.5V2.5h3.5v2M4.75 4.5l.55 8.4a1 1 0 0 0 1 .93h3.4a1 1 0 0 0 1-.93l.55-8.4" />
      <path d="M6.75 7v4M9.25 7v4" />
    </svg>
  );
}

export function IconBack({ className }: IconProps) {
  return (
    <svg
      className={className}
      width={ICON_SIZE}
      height={ICON_SIZE}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10 3 5 8l5 5" />
    </svg>
  );
}
