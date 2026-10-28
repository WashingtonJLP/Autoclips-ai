const paths: Record<string, string> = {
  overview: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  create: 'M12 5v14 M5 12h14',
  library: 'M4 4h16v16H4z M10 8l6 4-6 4z',
  publish: 'M4 12l16-8-5 16-4-6-7-2z M11 14l9-10',
  sources: 'M4 7h6l2 2h8v11H4z M4 7V4h6l2 3',
  settings:
    'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2',
  play: 'M8 5l11 7-11 7z',
  arrow: 'M5 12h14 M13 6l6 6-6 6',
  refresh: 'M20 8a8 8 0 1 0 0 8 M20 3v5h-5',
  check: 'M5 12l4 4L19 6',
  close: 'M6 6l12 12 M6 18L18 6',
  menu: 'M4 6h16 M4 12h16 M4 18h16',
  video: 'M3 5h13v14H3z M16 9l5-3v12l-5-3',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 7v5l3 2',
};
export default function Icon({
  name,
  size = 20,
}: {
  name: string;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] ?? paths.video} />
    </svg>
  );
}
