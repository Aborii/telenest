/**
 * @file src/lib/client/session/memory-session-store.spec.ts
 *
 * PURPOSE
 * -------
 * Unit tests for the volatile in-memory session store.
 */

import { InMemorySessionStore } from './memory-session-store';

describe('InMemorySessionStore', () => {
  it('returns undefined when empty', () => {
    expect(new InMemorySessionStore().load()).toBeUndefined();
  });

  it('seeds from a non-empty initial value', () => {
    expect(new InMemorySessionStore('seed').load()).toBe('seed');
  });

  it('treats an empty initial value as no session', () => {
    expect(new InMemorySessionStore('').load()).toBeUndefined();
  });

  it('round-trips save → load', () => {
    const store = new InMemorySessionStore();
    store.save('abc');
    expect(store.load()).toBe('abc');
  });

  it('clears the stored value', () => {
    const store = new InMemorySessionStore('abc');
    store.clear();
    expect(store.load()).toBeUndefined();
  });
});
