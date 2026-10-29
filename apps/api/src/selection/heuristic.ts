import { createHash } from 'node:crypto';
import { SelectionConfig, Transcript, SelectedClip } from './contracts';
import { relevantSpeech, sentenceSegments } from './sentences';

export function heuristicSelection(
  transcript: Transcript,
  config: SelectionConfig,
) {
  const segments = sentenceSegments(transcript);
  const clips: SelectedClip[] = [];
  for (let i = 0; i < segments.length; i++) {
    const first = segments[i];
    let last = first;
    const parts = [first.text];
    for (
      let j = i + 1;
      j < segments.length && last.end - first.start < config.minDuration;
      j++
    ) {
      if (
        segments[j].end - first.start > config.maxDuration ||
        segments[j].start - last.end > 3
      )
        break;
      last = segments[j];
      parts.push(last.text);
    }
    const text = parts.join(' '),
      duration = last.end - first.start;
    if (
      duration < config.minDuration ||
      duration > config.maxDuration ||
      !relevantSpeech(text)
    )
      continue;
    if (
      /^(ele|ela|isso|aquilo|portanto|então|he|she|it|therefore)\b/i.test(text)
    )
      continue;
    const hook = /\?|como|por que|erro|segredo|how|why/i.test(text) ? 7 : 5;
    clips.push({
      id: createHash('sha256')
        .update(`${first.id}:${last.id}`)
        .digest('hex')
        .slice(0, 16),
      first: first.id,
      last: last.id,
      start: first.start,
      end: last.end,
      title: `Recorte: ${text.split(/\s+/).slice(0, 9).join(' ')}`.slice(
        0,
        100,
      ),
      description: text.slice(0, 600),
      reason:
        'Heurística local: frase completa, fala com palavras relevantes e duração permitida. Não houve avaliação semântica por IA.',
      scores: {
        hook,
        context: 5,
        clarity: 5,
        value: 5,
        humor: 0,
        emotion: 0,
        engagement: 0,
      },
      score: 5,
      classification: 'revisar',
      excerpt: text,
    });
  }
  return clips;
}
