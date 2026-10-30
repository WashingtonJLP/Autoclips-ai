import LibraryView from './view';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ aba?: string; video?: string }>;
}) {
  const { aba, video } = await searchParams;
  return (
    <LibraryView
      initialTab={aba === 'videos' || aba === 'cortes' ? 'cortes' : 'producoes'}
      initialVideo={video && /^[a-zA-Z0-9]+$/.test(video) ? video : undefined}
    />
  );
}
