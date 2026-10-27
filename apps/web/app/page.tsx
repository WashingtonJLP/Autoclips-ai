export default async function Home() {
  let connected = false;
  try {
    const response = await fetch(
      `${process.env.API_URL ?? 'http://127.0.0.1:3003'}/health`,
      { cache: 'no-store', signal: AbortSignal.timeout(2500) },
    );
    connected = response.ok;
  } catch {
    /* O dashboard continua acessível sem a API. */
  }
  return (
    <main className="mx-auto max-w-6xl px-8 py-16">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-8">
        <strong className="text-xl tracking-wide">
          AUTOCLIPS <span className="text-emerald-400">AI</span>
        </strong>
        <span className="rounded-full bg-amber-950 px-4 py-2 text-sm text-amber-200">
          Publicação em simulação
        </span>
      </header>
      <p className="mt-16 text-sm uppercase tracking-widest text-emerald-400">
        Estúdio de produção
      </p>
      <h1 className="mt-4 max-w-3xl text-5xl font-semibold leading-tight">
        Transforme conteúdo autorizado em novos momentos.
      </h1>
      <p className="mt-6 max-w-2xl text-lg text-slate-400">
        Transcrição, cortes verticais e legendas em um fluxo local. Cada
        produção começa pela verificação dos direitos de uso.
      </p>
      <section
        aria-label="Serviços"
        className="mt-12 grid gap-5 md:grid-cols-3"
      >
        {[
          ['API principal', connected ? 'Conectada' : 'Indisponível'],
          ['Processamento', 'CPU · INT8 · sequencial'],
          ['Direitos de uso', 'Revisão obrigatória'],
        ].map(([title, value]) => (
          <article
            key={title}
            className="rounded-2xl border border-slate-800 bg-slate-900 p-6"
          >
            <h2 className="text-sm text-slate-400">{title}</h2>
            <p className="mt-4 text-lg">{value}</p>
          </article>
        ))}
      </section>
      <section className="mt-12 rounded-2xl border border-slate-800 p-8">
        <h2 className="text-xl">Seu fluxo de produção</h2>
        <ol className="mt-6 grid gap-6 text-slate-300 md:grid-cols-4">
          {[
            'Cadastrar fonte e evidências',
            'Transcrever mídia local',
            'Selecionar e gerar cortes',
            'Revisar antes de publicar',
          ].map((step, index) => (
            <li key={step}>
              <span className="mb-3 block text-emerald-400">0{index + 1}</span>
              {step}
            </li>
          ))}
        </ol>
      </section>
      <p className="mt-8 text-sm text-slate-500">
        CC BY e CC0 exigem verificação de origem. A licença não garante
        monetização nas plataformas.
      </p>
    </main>
  );
}
