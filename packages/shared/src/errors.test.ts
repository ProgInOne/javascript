import { describe, expect, it } from 'vitest';
import { apiError, apiErrorSchema } from './errors.ts';

describe('apiError', () => {
  it('builds a body that satisfies the wire schema', () => {
    const body = apiError('MAINTENANCE', '복원 중입니다.', { retryable: true });
    expect(apiErrorSchema.parse(body)).toEqual({
      error: { code: 'MAINTENANCE', message: '복원 중입니다.', retryable: true },
    });
  });

  it('defaults retryable to false and keeps details', () => {
    const body = apiError('NOT_FOUND', '없음', { details: { id: 'x' } });
    expect(body.error.retryable).toBe(false);
    expect(body.error.details).toEqual({ id: 'x' });
  });

  it('rejects unknown codes', () => {
    expect(() =>
      apiErrorSchema.parse({ error: { code: 'NOPE', message: '', retryable: false } }),
    ).toThrow();
  });
});
