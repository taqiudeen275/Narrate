/** Static UI regressions; run with npx tsx scripts/verify-app.ts. No browser needed. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mock } from 'node:test';
import type { useNarrate as NarrateStore } from '../src/state/store';

const require = createRequire(import.meta.url);
const previousCssLoader = require.extensions['.css'];
require.extensions['.css'] = () => undefined;

type Snapshot = ReturnType<typeof NarrateStore.getState>;
let snapshot: Snapshot | undefined;
const vanilla = require('zustand/vanilla') as typeof import('zustand/vanilla');
const createStore = vanilla.createStore;
// Zustand deliberately uses getInitialState for SSR. Substitute only that
// public snapshot callback, keeping the real store and every UI component.
const fixture = mock.method(vanilla, 'createStore', (...args: Parameters<typeof createStore>) => {
  const store = createStore(...args);
  const initial = store.getInitialState;
  return { ...store, getInitialState: () => snapshot ?? initial() };
});

try {
  const React = require('react') as typeof import('react');
  const { renderToStaticMarkup } = require('react-dom/server') as typeof import('react-dom/server');
  const { useNarrate } = require('../src/state/store.ts') as typeof import('../src/state/store');
  const App = require('../src/App.tsx').default;
  const { indexDocument } = require('../src/core/types.ts') as typeof import('../src/core/types');
  const base = useNarrate.getState();
  const render = (patch?: Partial<Snapshot>) => {
    snapshot = patch ? { ...base, ...patch } : undefined;
    return renderToStaticMarkup(React.createElement(App));
  };
  const documentControls = ['aria-label="Playback"', 'aria-label="Document view"', 'aria-label="Generation mode"'];
  const withoutDocumentControls = (html: string) => {
    for (const control of documentControls) assert.equal(html.includes(control), false, `${control} must stay contextual`);
  };
  const withDocumentControls = (html: string) => {
    for (const control of documentControls) assert.equal(html.includes(control), true, `${control} must appear for an open document`);
    assert.match(html, />Stream<\/button>/);
    assert.match(html, />Render all<\/button>/);
  };

  assert.equal(base.view, 'library');
  assert.equal(base.doc, null, 'startup must not automatically open a sample');
  const startup = render();
  assert.match(startup, /Opening your Library/);
  assert.equal(startup.includes('type="file"'), false, 'imports wait until local hydration completes');
  withoutDocumentControls(startup);

  const library = render({ hydrated: true });
  assert.match(library, /Your Library/);
  assert.match(library, /Make yourself a Library/);
  assert.match(library, /type="file"[^>]*aria-label="Add a document"/);
  assert.equal(library.includes('Opening your Library'), false);
  assert.match(library, /disabled=""[^>]*aria-label="Listen — open a document from Library first"/);
  withoutDocumentControls(library);

  for (const view of ['player', 'reader'] as const) {
    const unselected = render({ hydrated: true, view });
    assert.match(unselected, /Your Library/, `${view} without a selected document falls back to Library`);
    withoutDocumentControls(unselected);
  }

  const plain = 'The selected document stays contextual.';
  const doc = indexDocument(plain, [{ kind: 'paragraph', start: 0, end: plain.length }], 'Context fixture');
  const selected: Partial<Snapshot> = { hydrated: true, doc, activeDocId: 'fixture-document' };
  for (const view of ['player', 'reader'] as const) {
    const document = render({ ...selected, view });
    withDocumentControls(document);
    assert.match(document, /Context fixture/);
    assert.equal(document.includes('Make yourself a Library'), false);
  }
  for (const view of ['library', 'settings'] as const) {
    withoutDocumentControls(render({ ...selected, view }));
  }

  console.log('App UI checks passed: startup hydration, empty Library/imports, missing-document fallback, and contextual Listen/Read controls.');
} finally {
  fixture.mock.restore();
  if (previousCssLoader) require.extensions['.css'] = previousCssLoader;
  else delete require.extensions['.css'];
}
