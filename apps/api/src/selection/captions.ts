import { Transcript } from './contracts';

// Usa tempos ASR das palavras; não reparte a fala por tempos estimados.
export function captionSegments(transcript: Transcript) {
  return transcript.segments.flatMap((segment) => {
    const words = segment.words?.filter((word) => word.word.trim());
    if (!words?.length)
      return [{ start: segment.start, end: segment.end, text: segment.text }];
    const captions: { start: number; end: number; text: string }[] = [];
    let group: typeof words = [];
    const flush = () => {
      if (!group.length) return;
      if (group[group.length - 1].end <= group[0].start) return;
      captions.push({
        start: Math.max(segment.start, group[0].start),
        end: Math.min(segment.end, group[group.length - 1].end),
        text: group.map((word) => word.word.trim()).join(' '),
      });
      group = [];
    };
    for (const word of words) {
      const text = [...group, word].map((w) => w.word.trim()).join(' ');
      if (group.length && (text.length > 42 || word.end - group[0].start > 3))
        flush();
      group.push(word);
      if (/[.!?]$/.test(word.word.trim())) flush();
    }
    flush();
    if (group.length) {
      if (captions.length)
        captions[captions.length - 1].text +=
          ` ${group.map((word) => word.word.trim()).join(' ')}`;
      else
        return [{ start: segment.start, end: segment.end, text: segment.text }];
    }
    return captions;
  });
}
