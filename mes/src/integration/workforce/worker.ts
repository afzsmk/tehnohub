import { AsyncWorkforceOutboxDispatcher } from './supabaseOutbox';

export interface WorkforceOutboxWorkerOptions {
  intervalMs?: number;
  sourceSiteExternalId: string;
  onError?: (error: unknown) => void;
}

export interface WorkforceOutboxWorker {
  start(): void;
  stop(): void;
}

export function createWorkforceOutboxWorker(
  dispatcher: AsyncWorkforceOutboxDispatcher,
  options: WorkforceOutboxWorkerOptions
): WorkforceOutboxWorker {
  const intervalMs = Math.max(1000, Math.floor(options.intervalMs ?? 10_000));
  let timer: ReturnType<typeof setInterval> | undefined;
  let running = false;

  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      await dispatcher.dispatchOnce(options.sourceSiteExternalId);
    } catch (error) {
      options.onError?.(error);
    } finally {
      running = false;
    }
  };

  return {
    start(): void {
      if (timer) return;
      void tick();
      timer = setInterval(() => { void tick(); }, intervalMs);
    },
    stop(): void {
      if (!timer) return;
      clearInterval(timer);
      timer = undefined;
    }
  };
}
