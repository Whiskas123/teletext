/**
 * Tests for the in-flight action registry.
 *
 * What this replaces is one `busy` boolean shared by the whole screen, so the
 * tests are mostly about independence: an action on one page must not disable
 * another page, and a publish must not disable either.
 */

import { describe, expect, it } from 'vitest';

import {
  EMPTY_REGISTRY,
  actionKey,
  beginAction,
  inFlightView,
  isRunning,
  settleAction,
  type ActionScope,
  type PageActionName,
} from './inFlight';

const page = (pageNumber: number, action: PageActionName): ActionScope => ({
  kind: 'page',
  pageNumber,
  action,
});

const publish: ActionScope = { kind: 'publish' };

describe('actionKey', () => {
  it('distinguishes pages and actions, and names publish on its own', () => {
    expect(actionKey(page(412, 'delete'))).toBe('page:412:delete');
    expect(actionKey(page(413, 'delete'))).not.toBe(actionKey(page(412, 'delete')));
    expect(actionKey(page(412, 'unpublish'))).not.toBe(actionKey(page(412, 'delete')));
    expect(actionKey(publish)).toBe('publish');
  });
});

describe('beginAction', () => {
  it('admits an action against a free page', () => {
    const { registry, admitted } = beginAction(EMPTY_REGISTRY, page(412, 'delete'), 0);
    expect(admitted).toBe(true);
    expect(isRunning(registry, page(412, 'delete'))).toBe(true);
  });

  it('refuses a second action against the same page, whatever it is', () => {
    const first = beginAction(EMPTY_REGISTRY, page(412, 'delete'), 0);
    const second = beginAction(first.registry, page(412, 'save-text'), 1);

    expect(second.admitted).toBe(false);
    // Unchanged, so there is nothing for the caller to undo.
    expect(second.registry).toBe(first.registry);
    expect(isRunning(second.registry, page(412, 'save-text'))).toBe(false);
  });

  it('admits an action against a different page', () => {
    const first = beginAction(EMPTY_REGISTRY, page(412, 'delete'), 0);
    const second = beginAction(first.registry, page(512, 'delete'), 1);

    expect(second.admitted).toBe(true);
    expect(isRunning(second.registry, page(412, 'delete'))).toBe(true);
    expect(isRunning(second.registry, page(512, 'delete'))).toBe(true);
  });

  it('admits a publish alongside a page action, and refuses a second publish', () => {
    const withPage = beginAction(EMPTY_REGISTRY, page(412, 'delete'), 0);
    const withPublish = beginAction(withPage.registry, publish, 1);
    expect(withPublish.admitted).toBe(true);

    const again = beginAction(withPublish.registry, publish, 2);
    expect(again.admitted).toBe(false);
  });

  it('leaves the registry it was given alone', () => {
    const { registry } = beginAction(EMPTY_REGISTRY, page(412, 'delete'), 0);
    expect(registry).not.toBe(EMPTY_REGISTRY);
    expect(EMPTY_REGISTRY.size).toBe(0);
  });
});

describe('settleAction', () => {
  it('frees the page for another action', () => {
    const started = beginAction(EMPTY_REGISTRY, page(412, 'delete'), 0);
    const settled = settleAction(started.registry, page(412, 'delete'));

    expect(isRunning(settled, page(412, 'delete'))).toBe(false);
    expect(beginAction(settled, page(412, 'save-text'), 1).admitted).toBe(true);
  });

  it('is a no-op for something that is not running', () => {
    expect(settleAction(EMPTY_REGISTRY, page(412, 'delete'))).toBe(EMPTY_REGISTRY);
  });

  it('leaves every other action running', () => {
    const a = beginAction(EMPTY_REGISTRY, page(412, 'delete'), 0);
    const b = beginAction(a.registry, page(512, 'unpublish'), 1);
    const c = beginAction(b.registry, publish, 2);

    const settled = settleAction(c.registry, page(412, 'delete'));
    expect(isRunning(settled, page(512, 'unpublish'))).toBe(true);
    expect(isRunning(settled, publish)).toBe(true);
  });
});

describe('inFlightView', () => {
  it('reports the action running against a page, and nothing for the others', () => {
    const { registry } = beginAction(EMPTY_REGISTRY, page(412, 'nudge-higher'), 0);
    const view = inFlightView(registry);

    expect(view.pageBusy(412)).toBe('nudge-higher');
    expect(view.pageBusy(413)).toBeNull();
  });

  it('keeps publish independent of every page', () => {
    const { registry } = beginAction(EMPTY_REGISTRY, publish, 0);
    const view = inFlightView(registry);

    expect(view.publishBusy).toBe(true);
    expect(view.pageBusy(412)).toBeNull();
  });

  it('reports no publish while only page actions run', () => {
    const { registry } = beginAction(EMPTY_REGISTRY, page(412, 'delete'), 0);
    expect(inFlightView(registry).publishBusy).toBe(false);
  });
});
