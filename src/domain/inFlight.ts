/**
 * Which actions are running, so one of them cannot freeze the screen.
 *
 * The manage screen had a single `busy` boolean for everything it could do. A
 * publish in flight disabled the nudge arrows, the reorder buttons, unpublish
 * and delete on every card, and vice versa — so a slow request made the whole
 * screen look broken, and an operator waiting on page 204 could not touch page
 * 512 in the meantime.
 *
 * A registry keyed by *what the action targets* replaces it. A page action
 * disables that page's controls; a publish disables the publish button. Nothing
 * else.
 *
 * ## One action per page, not one per control
 *
 * `beginAction` admits at most one action per page number, even though entries
 * are keyed by page *and* action. That is deliberate: while a page is being
 * deleted, its whole card is disabled, so there is no second control to press —
 * and if there were, starting a rename against a page that is halfway deleted
 * is not a race worth allowing. The finer key is kept so the card can say
 * *which* action is running rather than just that something is.
 *
 * Pure and framework-free; the registry is a value the shell holds in state and
 * replaces, never mutates.
 */

/** One operation an operator can start against a page on air. */
export type PageActionName =
  | 'nudge-lower'
  | 'nudge-higher'
  | 'move-to'
  | 'unpublish'
  | 'delete'
  | 'save-text'
  | 'set-role'
  | 'add-subpage'
  | 'remove-subpage'
  | 'absorb-page'
  | 'showcase';

/** What an in-flight action targets. */
export type ActionScope =
  | { kind: 'page'; pageNumber: number; action: PageActionName }
  | { kind: 'publish' };

/** The registry's key for a scope. */
export type ActionKey = string;

/** One running action. */
export interface InFlightEntry {
  scope: ActionScope;
  startedAt: number;
}

export type InFlightRegistry = ReadonlyMap<ActionKey, InFlightEntry>;

/** Nothing running. */
export const EMPTY_REGISTRY: InFlightRegistry = new Map();

/** A stable key for a scope: `page:412:delete`, or `publish`. */
export function actionKey(scope: ActionScope): ActionKey {
  return scope.kind === 'publish'
    ? 'publish'
    : `page:${scope.pageNumber}:${scope.action}`;
}

/** Whether any action is running against `pageNumber`. */
function pageEntry(
  registry: InFlightRegistry,
  pageNumber: number,
): InFlightEntry | null {
  for (const entry of registry.values()) {
    if (entry.scope.kind === 'page' && entry.scope.pageNumber === pageNumber) {
      return entry;
    }
  }
  return null;
}

/**
 * Admit an action, or refuse it because its target is already busy.
 *
 * Returns the registry unchanged when refused, so the caller can compare
 * identity or read `admitted` — either way there is nothing to undo.
 */
export function beginAction(
  registry: InFlightRegistry,
  scope: ActionScope,
  now: number,
): { registry: InFlightRegistry; admitted: boolean } {
  const key = actionKey(scope);
  if (registry.has(key)) return { registry, admitted: false };
  if (scope.kind === 'page' && pageEntry(registry, scope.pageNumber) != null) {
    return { registry, admitted: false };
  }

  const next = new Map(registry);
  next.set(key, { scope, startedAt: now });
  return { registry: next, admitted: true };
}

/** Remove an action, whether it succeeded, failed or threw. */
export function settleAction(
  registry: InFlightRegistry,
  scope: ActionScope,
): InFlightRegistry {
  const key = actionKey(scope);
  if (!registry.has(key)) return registry;
  const next = new Map(registry);
  next.delete(key);
  return next;
}

/** Whether the entry this scope names is still the one that was started. */
export function isRunning(registry: InFlightRegistry, scope: ActionScope): boolean {
  return registry.has(actionKey(scope));
}

/** The read-only questions the panels are allowed to ask. */
export interface InFlightView {
  /** The action running against a page, or `null` when it is free. */
  pageBusy(pageNumber: number): PageActionName | null;
  /** Whether a publish is in flight. */
  publishBusy: boolean;
}

export function inFlightView(registry: InFlightRegistry): InFlightView {
  return {
    pageBusy: (pageNumber) => {
      const entry = pageEntry(registry, pageNumber);
      return entry?.scope.kind === 'page' ? entry.scope.action : null;
    },
    publishBusy: registry.has('publish'),
  };
}
