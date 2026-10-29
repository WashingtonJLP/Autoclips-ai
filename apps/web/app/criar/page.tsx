import CreateView from './view';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ producao?: string; fonte?: string; midia?: string }>;
}) {
  const { producao, fonte, midia } = await searchParams;
  return (
    <CreateView
      initialTask={
        producao && /^[a-zA-Z0-9]+$/.test(producao) ? producao : undefined
      }
      initialSource={fonte && /^[a-zA-Z0-9]+$/.test(fonte) ? fonte : undefined}
      initialAsset={midia && /^[a-zA-Z0-9]+$/.test(midia) ? midia : undefined}
    />
  );
}
