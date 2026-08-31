import { describe, expect, it } from 'vitest';
import { config } from './proxy';

describe('proxy matcher', () => {
  it('keeps technical machine routes outside Clerk middleware', () => {
    expect(matches('/api/health')).toBe(false);
    expect(matches('/api/internal/maintenance/incremental-events')).toBe(false);
  });

  it('continues matching protected and ordinary API routes', () => {
    expect(matches('/dashboard/overview')).toBe(true);
    expect(matches('/api/products')).toBe(true);
  });
});

function matches(path: string): boolean {
  return config.matcher.some((pattern) => new RegExp(`^${pattern}$`).test(path));
}
