'use client';
import { useEffect, useRef, useState } from 'react';
import Icon from './glyph';
const cache = new Map<string, string>();
let queue = Promise.resolve();
function frame(url: string, signal: AbortSignal): Promise<string | null> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve(null);
    const video = document.createElement('video');
    let finished = false;
    const finish = (value: string | null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      video.removeAttribute('src');
      video.load();
      resolve(value);
    };
    const abort = () => finish(null),
      timer = setTimeout(abort, 10000);
    signal.addEventListener('abort', abort, { once: true });
    video.muted = true;
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      video.currentTime = Math.min(0.5, video.duration / 2);
    };
    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 216;
        canvas.height = 384;
        canvas.getContext('2d')?.drawImage(video, 0, 0, 216, 384);
        finish(canvas.toDataURL('image/jpeg', 0.65));
      } catch {
        finish(null);
      }
    };
    video.onerror = abort;
    video.src = url;
  });
}
export default function Thumbnail({
  id,
  label,
  onClick,
}: {
  id: string;
  label: string;
  onClick: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null),
    [poster, setPoster] = useState<string | undefined>();
  useEffect(() => {
    if (cache.has(id)) {
      setPoster(cache.get(id));
      return;
    }
    const controller = new AbortController();
    const load = () => {
      queue = queue.then(async () => {
        const value = await frame(
          `/api/backend/jobs/${id}/artifacts/video`,
          controller.signal,
        );
        if (value && !controller.signal.aborted) {
          if (cache.size >= 100) cache.delete(cache.keys().next().value!);
          cache.set(id, value);
          setPoster(value);
        }
      });
    };
    if (!('IntersectionObserver' in window)) {
      load();
      return () => controller.abort();
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        observer.disconnect();
        load();
      }
    });
    if (ref.current) observer.observe(ref.current);
    return () => {
      observer.disconnect();
      controller.abort();
    };
  }, [id]);
  return (
    <button
      ref={ref}
      className="thumbnail"
      aria-label={`Assistir ${label}`}
      onClick={onClick}
      style={poster ? { backgroundImage: `url(${poster})` } : undefined}
    >
      <span className="thumbnail-format">9:16</span>
      <span className="play-button">
        <Icon name="play" size={24} />
      </span>
      <span className="thumbnail-caption">Assistir prévia</span>
    </button>
  );
}
