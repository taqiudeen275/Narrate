/**
 * The sample available from Library when the reader chooses to try Narrate.
 *
 * The fastest way to hear whether a voice suits you is to hear it say something
 * you already know the shape of.
 *
 * The content is written for the ear. Short paragraphs, concrete sentences,
 * numbers written the way they should be said.
 */

import { parseMarkdown } from '../core/parse';
import type { Doc } from '../core/types';

const SAMPLE = `# Reading With Your Ears

A book is a sequence of decisions about pace. A comma is a small breath. A
paragraph break is a longer one. A chapter heading is a change of room.

When a machine reads to you, it has to make every one of those decisions
without asking. It has to know that a colon introduces a list, that a number
like 1974 is a year and not a quantity, and that the second paragraph of a
scene should not sound identical to the first.

## Why the words have to be timed

Listening without the text is one thing. Listening with it is another, because
the eye and the ear arrive at the same sentence by different routes.

> The eye can skim. The ear cannot. Every syllable arrives at full strength,
> and the only way through a long sentence is straight through the middle of it.

This is why a narrator that sounds slightly wrong is so tiring. The problem is
never one odd word. It is that a listener who is also watching the text cannot
predict what comes next, and prediction is most of what makes reading feel
effortless.

## What this app tries to do

Three things, in order.

1. **Say the words.** Render the document to audio, sentence by sentence,
   with a measured pause between them.
2. **Keep the words.** Hold every word at the exact moment it is spoken, so
   the highlight is a fact rather than an estimate.
3. **Let you touch the words.** Click any word to start there. Step forward a
   sentence or a paragraph. Because the text and the audio are the same
   object, seeking is instant and exact.

## The honest part

Nobody has demonstrated reliable human-level narration from a model that also
runs on a laptop CPU. Those are two different problems, and the models that
solve the first are large enough to need a graphics card.

So the target here is not *indistinguishable from an actor*. It is *clean,
warm, and never mechanical* — which is a lower bar, but one you can actually
hit, and one you can listen to for four hours.

## A short passage to try

The lighthouse keeper counted the ships. Not because anyone had asked him to.
He had counted them for nineteen years, and he knew the number the way he knew
the number of steps to the top of his own stair.

On the night the fog came in thick enough to taste, he counted eleven. He went
on counting long after the list was empty, because the counting was the thing
he knew how to do, and the fog was asking for something else entirely.

## Numbers, names, and the things that break

Good narration handles the boring cases without announcing them.

- Years read as years: 1974, not one thousand nine hundred and seventy four.
- Measurements with their units: 4.2 kilometres, 30 degrees.
- The names that do not follow any rule at all: Brannagh, O'Shaughnessy.
- Acronyms spelled out once, then abbreviated.
- Addresses and lists, where every item is the same shape.

Press play and watch the column of cells in the transport bar. That is the
character being spoken right now, in braille. You can feel where you are in
the book without looking up from the page.
`;

let cached: Doc | null = null;

/** Keep the formatted source reusable without sharing mutable audio timing. */
export function SAMPLE_DOC(): Doc {
  if (!cached) cached = { ...parseMarkdown(SAMPLE, 'Reading With Your Ears'), sourceName: 'Narrate sample.md' };
  return structuredClone(cached);
}
