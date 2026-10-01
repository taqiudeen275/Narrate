import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { set } from 'idb-keyval';
import { useNarrate } from '../src/state/store';
import { storage } from '../src/state/persistence';

Object.assign(globalThis, { requestAnimationFrame: () => 0, cancelAnimationFrame() {} });

let failures = 0;
async function test(name: string, run: () => Promise<void>) {
  try { await run(); console.log(`ok ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error instanceof Error ? error.message : error}`); }
}

assert.equal(await useNarrate.getState().openBuffer('kept.txt', new TextEncoder().encode('A saved book stays in the library.').buffer), true);
const savedId = useNarrate.getState().activeDocId!;
const savedLibrary = useNarrate.getState().library;
async function hydratePreferences(preferences: unknown) {
  await set('narrate:v1:preferences', preferences);
  useNarrate.setState({ hydrated: false, library: [], generationJobs: [], doc: null, activeDocId: null, error: null });
  await useNarrate.getState().hydrate();
}

await test('an obsolete model preference cannot hide saved books', async () => {
  await hydratePreferences({ selectedModel: 'kokoro-removed', voiceId: 'af_nicole', speed: 1.25, generateMode: 'full' });
  const state = useNarrate.getState();
  assert.equal(state.library[0]?.id, savedId, 'valid library loads despite unknown model');
  assert.equal(state.error, null);
  assert.equal(state.selectedModel, 'kokoro-q8');
  assert.equal(state.engine.id, 'kokoro-q8');
  assert.equal(state.voiceId, 'af_nicole', 'valid preferences survive recovery of another field');
  assert.equal(state.speed, 1.25);
  assert.equal(state.generateMode, 'full');
  assert.equal(state.view, 'library');
  assert.equal(state.doc, null);
});

await test('malformed preference fields recover to usable defaults', async () => {
  await hydratePreferences({ selectedModel: {}, voiceId: 42, speed: 'fast', generateMode: 'unknown' });
  const state = useNarrate.getState();
  assert.equal(state.error, null);
  assert.equal(state.selectedModel, 'kokoro-q8');
  assert.equal(state.voiceId, 'af_bella');
  assert.equal(state.speed, 1);
  assert.equal(state.generateMode, 'stream');
  assert.deepEqual(state.library.map(entry => entry.id), savedLibrary.map(entry => entry.id));
});

await test('non-finite and out-of-range saved speeds never reach synthesis', async () => {
  for (const speed of [NaN, Infinity, -Infinity, 0, 0.49, 2.01]) {
    await hydratePreferences({ selectedModel: 'kokoro-q8', voiceId: 'af_bella', speed, generateMode: 'stream' });
    assert.equal(useNarrate.getState().speed, 1, `invalid speed ${speed} resets to default`);
  }
});

await test('valid model and boundary speeds are retained', async () => {
  for (const speed of [0.5, 2]) {
    await hydratePreferences({ selectedModel: 'kokoro-q4', voiceId: 'af_nicole', speed, generateMode: 'full' });
    const state = useNarrate.getState();
    assert.equal(state.selectedModel, 'kokoro-q4');
    assert.equal(state.engine.id, 'kokoro-q4');
    assert.equal(state.speed, speed);
    assert.equal(state.generateMode, 'full');
    assert.equal(state.view, 'library');
    assert.equal(state.doc, null);
  }
});

async function openSampleAndWait() {
  assert.equal(await useNarrate.getState().openSample(), true, 'sample open resolves after selection succeeds');
}

await test('the sample retains headings, quotes and list items when opened and persisted', async () => {
  await openSampleAndWait();
  const state = useNarrate.getState();
  const doc = state.doc!;
  assert.equal(doc.title, 'Reading With Your Ears');
  assert.equal(doc.sourceName, 'Narrate sample.md');
  assert.equal(doc.blocks[0].kind, 'heading');
  assert.equal(doc.blocks[0].level, 1);
  assert.ok(doc.blocks.some(block => block.kind === 'heading' && block.level === 2));
  assert.ok(doc.blocks.some(block => block.kind === 'quote'));
  assert.equal(doc.blocks.filter(block => block.kind === 'listItem').length, 8);
  const persisted = await storage.loadDocument(state.activeDocId!);
  assert.deepEqual(persisted?.blocks, doc.blocks, 'saved sample keeps reader structure');
  for (const block of doc.blocks) assert.ok(doc.plain.slice(block.start, block.end).length > 0);
});

await test('opening the sample again reuses its saved document', async () => {
  const sampleId = useNarrate.getState().activeDocId;
  const count = useNarrate.getState().library.length;
  await openSampleAndWait();
  assert.equal(useNarrate.getState().activeDocId, sampleId);
  assert.equal(useNarrate.getState().library.length, count);
});

console.log(`${failures ? `${failures} CHECK(S) FAILED` : 'ALL STATE RECOVERY CHECKS PASSED'}`);
process.exitCode = failures ? 1 : 0;
