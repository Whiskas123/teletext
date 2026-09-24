// Reading the live document from the server: the room name playhtml derives,
// and refusing a document whose layout is not the one the site writes.
//
// Checked elsewhere: that the channel ids match the hooks' is in
// `src/collab/liveDocumentChannels.test.ts` (those modules need JSX, which the
// server's config does not compile); the connection itself is exercised
// against the live service by `bun run backup:read`, which writes nothing.

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { LiveDocumentError, readChannels, roomName } from './liveDocument';

/** A document laid out the way playhtml's React hooks store page data. */
function documentWith(channels: Record<string, Record<string, unknown>>): Y.Doc {
  const doc = new Y.Doc();
  const page = new Y.Map<unknown>();
  doc.getMap('play').set('__page__', page);
  for (const [id, value] of Object.entries(channels)) {
    const map = new Y.Map<unknown>();
    page.set(id, map);
    for (const [key, entry] of Object.entries(value)) map.set(key, entry);
  }
  return doc;
}

describe('where the live document is', () => {
  it('names the room as playhtml does: the host without www, then the room', () => {
    expect(roomName('teletext.joaobernardo.me')).toBe('teletext.joaobernardo.me-teletext-house');
    expect(roomName('www.example.com', 'r')).toBe('example.com-r');
  });
});

describe('reading the channels', () => {
  it('returns the page channels, and leaves everything else in the document alone', () => {
    const doc = documentWith({
      pages: { 100: { 0: { char: 'A' } } },
      titles: { 100: 'Index' },
      'page-kinds': { 100: 'category' },
      'chat:living-room': { 1: 'hello' },
    });
    const channels = readChannels(doc);
    expect(Object.keys(channels.pages)).toEqual(['100']);
    expect(channels.titles).toEqual({ 100: 'Index' });
    expect(channels.kinds).toEqual({ 100: 'category' });
    expect(channels.sources).toEqual({});
    expect(channels).not.toHaveProperty('chat:living-room');
  });

  it('refuses a document without the layout the site writes, rather than reading nothing', () => {
    const noPageMap = new Y.Doc();
    noPageMap.getMap('play').set('elsewhere', new Y.Map());
    expect(() => readChannels(noPageMap)).toThrow(LiveDocumentError);

    try {
      readChannels(documentWith({ titles: { 100: 'Index' } }));
      expect.unreachable();
    } catch (error) {
      expect((error as LiveDocumentError).reason).toBe('layout');
    }
  });
});
