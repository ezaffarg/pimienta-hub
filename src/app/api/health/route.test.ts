import { describe, expect, it, vi } from 'vitest';
import { GET } from './route';

describe('health route', () => {
  it('returns a public deterministic response without exposing runtime data', async () => {
    const response = GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('does not call external services', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    GET();

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
