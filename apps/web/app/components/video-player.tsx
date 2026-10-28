'use client';
export default function VideoPlayer({
  id,
  title,
}: {
  id: string;
  title: string;
}) {
  return (
    <video
      className="portrait-player"
      controls
      autoPlay
      playsInline
      preload="metadata"
      aria-label={title}
      src={`/api/backend/jobs/${id}/artifacts/video`}
    />
  );
}
