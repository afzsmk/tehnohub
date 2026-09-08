import { describe, expect, it } from 'vitest';
import { canTransitionStatus } from '../src/core/taskLifecycle';

describe('MES task lifecycle invariants', () => {
  it('permits only READY -> RUNNING for START', () => {
    expect(canTransitionStatus('READY', 'RUNNING')).toBe(true);
    expect(canTransitionStatus('PLANNED', 'RUNNING')).toBe(false);
    expect(canTransitionStatus('COMPLETED', 'RUNNING')).toBe(false);
  });

  it('permits pause/resume only from active execution states', () => {
    expect(canTransitionStatus('RUNNING', 'PAUSED')).toBe(true);
    expect(canTransitionStatus('PAUSED', 'RUNNING')).toBe(true);
    expect(canTransitionStatus('READY', 'PAUSED')).toBe(false);
  });

  it('keeps completion terminal', () => {
    expect(canTransitionStatus('COMPLETED', 'PARTIALLY_COMPLETED')).toBe(false);
    expect(canTransitionStatus('COMPLETED', 'BLOCKED')).toBe(false);
    expect(canTransitionStatus('COMPLETED', 'RUNNING')).toBe(false);
  });
});
