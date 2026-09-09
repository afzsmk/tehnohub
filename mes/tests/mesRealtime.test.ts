import { afterEach, describe, expect, it, vi } from 'vitest';
import { MES_REALTIME_TABLES, subscribeMesRealtime } from '../src/integration/mesRealtime';

type Handler = () => void;

function fakeRealtimeClient() {
  const handlers = new Map<string, Handler>();
  const channel = {
    on: (_event: string, filter: { table: string }, callback: Handler) => {
      handlers.set(filter.table, callback);
      return channel;
    },
    subscribe: vi.fn()
  };
  return {
    client: {
      channel: vi.fn(() => channel),
      removeChannel: vi.fn(async () => 'ok')
    } as never,
    handlers,
    channel
  };
}

describe('MES realtime subscription', () => {
  afterEach(() => vi.useRealTimers());

  it('subscribes to all operational tables by default', () => {
    const fake = fakeRealtimeClient();
    const unsubscribe = subscribeMesRealtime(fake.client, { onChange: vi.fn() });

    expect([...fake.handlers.keys()]).toEqual([...MES_REALTIME_TABLES]);
    expect(fake.channel.subscribe).toHaveBeenCalledOnce();
    unsubscribe();
    expect(fake.client.removeChannel).toHaveBeenCalledOnce();
  });

  it('debounces bursts and reports the latest changed table', async () => {
    vi.useFakeTimers();
    const fake = fakeRealtimeClient();
    const onChange = vi.fn();
    const unsubscribe = subscribeMesRealtime(fake.client, { tables: ['production_tasks', 'production_results'], onChange, debounceMs: 200 });

    fake.handlers.get('production_tasks')?.();
    fake.handlers.get('production_results')?.();
    await vi.advanceTimersByTimeAsync(199);
    expect(onChange).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('production_results');
    unsubscribe();
  });

  it('cancels pending notifications on unsubscribe', async () => {
    vi.useFakeTimers();
    const fake = fakeRealtimeClient();
    const onChange = vi.fn();
    const unsubscribe = subscribeMesRealtime(fake.client, { tables: ['production_tasks'], onChange, debounceMs: 200 });

    fake.handlers.get('production_tasks')?.();
    unsubscribe();
    await vi.advanceTimersByTimeAsync(250);

    expect(onChange).not.toHaveBeenCalled();
  });
});
