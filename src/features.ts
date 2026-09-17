/**
 * What a build of this site ships.
 *
 * Everything else in `src/` describes one archive; this file describes one
 * *deployment* of it. A feature named here can be taken off the set without the
 * code for it being taken out of the repository — which is the difference
 * between "not shown at the moment" and "gone", and only the first of those is
 * worth an environment variable.
 *
 * ## Why build time and not runtime
 *
 * Vite inlines `import.meta.env.VITE_*` into the bundle when it builds it, so a
 * flag read here is a constant by the time a visitor has it: nothing is fetched,
 * nothing is decided on the client, and there is no moment where the set is
 * drawn one way and then re-drawn the other. The cost is that changing a flag
 * means a redeploy, which for a switch that gets thrown twice a year is the
 * right trade.
 *
 * VITE_ means *public*: the value is readable by anyone who opens the bundle.
 * That is fine for a switch and never fine for a secret — see the note at the
 * top of `.env.example`, and the smoke test in `migration.smoke.test.ts` that
 * holds it.
 *
 * ## A switch here has to be asked for
 *
 * Nothing in this file is on by default. A flag guards the kind of feature that
 * should appear because somebody decided it should, on the deployment where they
 * decided it — so an unset variable, an empty one, a misspelt one, or a hosting
 * dashboard that quietly dropped the value all land on the same answer, which is
 * the site as it is published today. The reverse — a feature that appears unless
 * something turns it off — fails the wrong way: every accident shows it.
 */

/**
 * Read one switch, which is off until it is asked for.
 *
 * Only an explicit yes counts: `on`, `true`, `1` and `yes`, in any case and with
 * whatever whitespace a hosting dashboard's text field kept. Everything else —
 * unset, empty, `off`, or a typo nobody noticed — is no.
 */
export function flagOn(raw: string | undefined): boolean {
  const value = (raw ?? '').trim().toLowerCase();
  return value === 'on' || value === 'true' || value === '1' || value === 'yes';
}

/**
 * Whether this build has MIX: the key that holes the page's black cells through
 * to a live picture, and the camera behind it. See `domain/signal.ts`.
 *
 * Off unless the build sets `VITE_MIX=on`, and off means absent rather than
 * inert — the key is not drawn on the panel or on the handset, and nothing is
 * left on the glass to explain a control that isn't there. A television with no
 * second input simply has no MIX key, which is what most of them were.
 *
 * Off is the default because MIX is the one thing here that asks the visitor for
 * something. A browser permission prompt is a big thing to put in front of
 * somebody who came to read old teletext, and where this is shown — an
 * exhibition machine, a projector, a screen in a room full of people — can make
 * it anything from a delight to an intrusion. So it is shown only where somebody
 * has said it should be, and the published site does not ask.
 */
export const MIX_ENABLED = flagOn(import.meta.env.VITE_MIX);
