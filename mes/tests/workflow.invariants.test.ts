import { describe, expect, it } from 'vitest';
import { canTransition } from '../src/core/taskLifecycle';

describe('MES task lifecycle invariants', () => {
  it('permits only READY -> RUNNING for START', () => {
    expect(canTransition('READY', 'RUNNING')).toBe(true);
    expect(canTransition('PLANNED', 'RUNNING')).toBe(false);
    expect(canTransition('COMPLETED', 'RUNNING')).toBe(false);
  });

  it('permits pause/resume only from active execution states', () => {
    expect(canTransition('RUNNING', 'PAUSED')).toBe(true);
    expect(canTransition('PAUSED', 'RUNNING')).toBe(true);
    expect(canTransition('READY', 'PAUSED')).toBe(false);
  });

  it('keeps completion terminal', () => {
    expect(canTransition('COMPLETED', 'PARTIALLY_COMPLETED')).toBe(false);
    expect(canTransition('COMPLETED', 'BLOCKED')).toBe(false);
    expect(canTransition('COMPLETED', 'RUNNING')).toBe(false);
  });
});
