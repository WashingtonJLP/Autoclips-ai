export class WorkerBusyError extends Error {
  constructor(readonly retryAfterMs = 5000) {
    super(
      'Outra etapa está em execução. Aguardando o worker, sem repetir o download.',
    );
  }
}
