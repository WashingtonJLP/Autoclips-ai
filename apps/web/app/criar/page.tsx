import CreateView from './view';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ producao?: string; fonte?: string }>;
}) {
  const { producao, fonte } = await searchParams;
  return (
    <CreateView
      initialTask={
        producao && /^[a-zA-Z0-9]+$/.test(producao) ? producao : undefined
      }
      initialSource={fonte && /^[a-zA-Z0-9]+$/.test(fonte) ? fonte : undefined}
    />
  );
}
