import { Transcript, Segment } from './contracts';

const endsSentence = (text: string) =>
  !/\b(?:Sr|Sra|Dr|Dra|Prof|Mr|Mrs|Ms)\.$/i.test(text.trim()) &&
  /[.!?…。！？]["'”’)]*$/.test(text.trim());
const noise = (text: string) =>
  /^\s*(?:\[[^\]]*\]|\([^)]*\))\s*$/.test(text) &&
  /music|música|applause|aplausos|silence|silêncio|inaudible|risos|laughter/i.test(
    text,
  );

// A pontuação só define limites quando há timestamps de palavra. Sem palavras,
// agrupa segmentos originais completos: nunca interpola tempos por tamanho do texto.
export function sentenceSegments(transcript: Transcript): Segment[] {
  const units: Omit<Segment, 'id'>[] = [];
  let pending: Omit<Segment, 'id'> | undefined;
  const append = (part: Omit<Segment, 'id'>) => {
    if (noise(part.text)) return;
    if (!pending) pending = { ...part };
    else
      pending = {
        start: pending.start,
        end: part.end,
        text: `${pending.text} ${part.text}`,
        ...(pending.words && part.words
          ? { words: [...pending.words, ...part.words] }
          : {}),
      };
    if (endsSentence(part.text)) {
      units.push(pending);
      pending = undefined;
    }
  };
  for (const segment of transcript.segments) {
    if (noise(segment.text)) continue;
    if (!segment.words?.length) {
      append(segment);
      continue;
    }
    for (const word of segment.words) {
      if (word.end < word.start || !word.word.trim()) continue;
      append({
        start: word.start,
        end: word.end,
        text: word.word.trim(),
        words: [word],
      });
    }
  }
  // Uma cauda sem pontuação não é anunciada como frase completa.
  return units
    .filter((unit) => unit.end > unit.start)
    .map((unit, id) => ({ ...unit, id }));
}
export function relevantSpeech(text: string) {
  return !noise(text) && (text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0) >= 4;
}
