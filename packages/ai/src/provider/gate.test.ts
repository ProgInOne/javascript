import { describe, expect, it } from 'vitest';
import { AIError } from '../errors.ts';
import { TurnGate } from './gate.ts';

describe('TurnGate', () => {
  it('limits concurrency and lets interactive waiters overtake background ones', async () => {
    const gate = new TurnGate(1);
    const order: string[] = [];
    const first = await gate.acquire('interactive');
    const bg = gate.acquire('background').then((r) => {
      order.push('background');
      return r;
    });
    const positions: number[] = [];
    const fg = gate
      .acquire('interactive', undefined, (p) => positions.push(p))
      .then((r) => {
        order.push('interactive');
        return r;
      });
    expect(gate.queued).toBe(2);
    expect(positions[0]).toBe(1);
    first();
    (await fg)();
    (await bg)();
    expect(order).toEqual(['interactive', 'background']);
    expect(gate.running).toBe(0);
  });

  it('removes an aborted waiter with AI_CANCELLED', async () => {
    const gate = new TurnGate(1);
    const release = await gate.acquire('interactive');
    const controller = new AbortController();
    const waiting = gate.acquire('interactive', controller.signal);
    controller.abort();
    await expect(waiting).rejects.toBeInstanceOf(AIError);
    expect(gate.queued).toBe(0);
    release();
  });
});
