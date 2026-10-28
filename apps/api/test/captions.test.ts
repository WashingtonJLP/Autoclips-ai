import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captionSegments } from '../src/selection/captions';
import {
  transcriptSchema,
  readSelectionConfig,
} from '../src/selection/contracts';
import { makeRequest } from '../src/selection/service';

test('legendas longas usam tempos reais das palavras e blocos legíveis', () => {
  const text =
    'Esta frase demonstra como uma legenda muito longa precisa acompanhar a fala em pequenos blocos legíveis sem cobrir todo o vídeo';
  const words = text
    .split(' ')
    .map((word, i) => ({ word, start: i * 0.4, end: i * 0.4 + 0.3 }));
  const transcript = transcriptSchema.parse({
    duration: 20,
    segments: [{ start: 0, end: words.at(-1)!.end, text, words }],
  });
  const captions = captionSegments(transcript);
  assert.ok(captions.length > 1);
  assert.equal(captions.map((c) => c.text).join(' '), text);
  captions.forEach((c) => {
    assert.ok(c.text.length <= 42 && c.end - c.start <= 3);
    assert.ok(words.some((w) => w.start === c.start));
    assert.ok(words.some((w) => w.end === c.end));
  });
  const request = makeRequest(
    transcript.segments.map((s, id) => ({ ...s, id })),
    readSelectionConfig({}),
  );
  assert.ok(
    !JSON.stringify(request.messages).includes('"words"'),
    'Palavras individuais continuam fora do prompt LLM',
  );
});
test('transcrição antiga sem palavras preserva tempos e timestamps inválidos falham', () => {
  const transcript = {
    duration: 5,
    segments: [{ start: 1, end: 4, text: 'Frase curta.' }],
  };
  assert.deepEqual(captionSegments(transcript), transcript.segments);
  assert.throws(() =>
    transcriptSchema.parse({
      ...transcript,
      segments: [
        {
          ...transcript.segments[0],
          words: [{ start: 0, end: 8, word: 'inválido' }],
        },
      ],
    }),
  );
});
test('palavras de duração zero não são descartadas nem geram legendas vazias', () => {
  const captions = captionSegments({
    duration: 3,
    segments: [
      {
        start: 0,
        end: 2,
        text: 'Esta fala termina aqui.',
        words: [
          { start: 0, end: 0, word: 'Esta' },
          { start: 0, end: 1, word: 'fala' },
          { start: 1, end: 2, word: 'termina' },
          { start: 2, end: 2, word: 'aqui.' },
        ],
      },
    ],
  });
  assert.equal(
    captions.map((c) => c.text).join(' '),
    'Esta fala termina aqui.',
  );
  assert.ok(captions.every((c) => c.end > c.start));
});
