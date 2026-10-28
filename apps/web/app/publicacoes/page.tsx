import PublicationsView from './view';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ video?: string }>;
}) {
  const { video } = await searchParams;
  return (
    <PublicationsView
      initialVideo={video && /^[a-zA-Z0-9]+$/.test(video) ? video : undefined}
    />
  );
}
