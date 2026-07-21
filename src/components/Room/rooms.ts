/**
 * The fixed set of rooms available in the app.
 *
 * For now users cannot create their own rooms — they pick one of these six
 * "house" rooms from the landing page. Each `id` is a valid Room_ID (letters,
 * digits, and hyphens only) and doubles as the playhtml room namespace, so
 * everyone who enters the same room shares its synchronized state.
 */
export interface RoomDefinition {
  /** Room_ID / playhtml namespace (kebab-case, valid Room_ID charset). */
  id: string;
  /** Human-readable room name shown on the landing grid. */
  label: string;
}

/** The six fixed rooms, in display order. */
export const ROOMS: readonly RoomDefinition[] = [
  { id: 'living-room', label: 'Living Room' },
  { id: 'bedroom-1', label: 'Bedroom 1' },
  { id: 'bedroom-2', label: 'Bedroom 2' },
  { id: 'kitchen', label: 'Kitchen' },
  { id: 'garage', label: 'Garage' },
  { id: 'dining-room', label: 'Dining Room' },
] as const;
