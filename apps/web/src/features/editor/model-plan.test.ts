import { describe, expect, it } from 'vitest';
import { planModels } from './model-plan.js';

const map = (entries: Record<string, string>): Map<string, string> =>
  new Map(Object.entries(entries));

describe('planModels', () => {
  it('creates newly opened files and disposes closed ones', () => {
    expect(planModels(map({ a: 'file:///a' }), map({ b: 'file:///b' }))).toEqual({
      dispose: ['a'],
      create: ['b'],
    });
  });

  it('recreates a file whose URI changed and leaves unchanged ones alone', () => {
    expect(
      planModels(
        map({ a: 'file:///a.js', b: 'file:///b.js' }),
        map({ a: 'file:///c.js', b: 'file:///b.js' }),
      ),
    ).toEqual({ dispose: ['a'], create: ['a'] });
  });

  it('handles two files swapping paths', () => {
    expect(
      planModels(map({ a: 'file:///x', b: 'file:///y' }), map({ a: 'file:///y', b: 'file:///x' })),
    ).toEqual({ dispose: ['a', 'b'], create: ['a', 'b'] });
  });

  it('does nothing when nothing changed', () => {
    expect(planModels(map({ a: 'k' }), map({ a: 'k' }))).toEqual({ dispose: [], create: [] });
  });
});
