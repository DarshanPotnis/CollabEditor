import { describe, expect, it } from 'vitest';
import { createProjectId } from '@collabcode/shared';
import { projectIdFromInput } from './join-input.js';

describe('projectIdFromInput', () => {
  it('accepts a bare project id', () => {
    const id = createProjectId();
    expect(projectIdFromInput(id)).toBe(id);
    expect(projectIdFromInput(`  ${id}  `)).toBe(id);
  });

  it.each([
    ['a workspace link', (id: string) => `https://collabcode.example/p/${id}`],
    ['a link with a query string', (id: string) => `https://collabcode.example/p/${id}?ref=chat`],
    ['a link with a hash', (id: string) => `https://collabcode.example/p/${id}#top`],
    ['a legacy room link', (id: string) => `https://collabcode.example/room/${id}`],
    ['a localhost link', (id: string) => `http://localhost:5173/p/${id}`],
  ])('pulls the id out of %s', (_label, build) => {
    const id = createProjectId();
    expect(projectIdFromInput(build(id))).toBe(id);
  });

  it.each([
    ['empty input', ''],
    ['whitespace', '   '],
    ['a sentence', 'come join my project'],
    ['an id that is too short', 'abc'],
    ['an uppercase id', 'ABCDEFGHIJKM'],
    ['a link with no id', 'https://collabcode.example/'],
    ['a traversal attempt', '../../etc/passwd'],
  ])('rejects %s', (_label, input) => {
    expect(projectIdFromInput(input)).toBeNull();
  });
});
