import { describe, it, expect } from 'vitest';
import type { Cursor } from '../src/shared/types.js';

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function decodeCursor(cursor: string): Cursor | undefined {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf-8');
    return JSON.parse(decoded) as Cursor;
  } catch {
    return undefined;
  }
}

describe('cursor encode/decode', () => {
  it('encodes and decodes correctly', () => {
    const cursor: Cursor = { ts: 1735689600, id: 'abc123' };
    const encoded = encodeCursor(cursor);
    const decoded = decodeCursor(encoded);

    expect(decoded).toEqual(cursor);
  });

  it('handles special characters in id', () => {
    const cursor: Cursor = { ts: 1735689600, id: 'abc_123-xyz' };
    const encoded = encodeCursor(cursor);
    const decoded = decodeCursor(encoded);

    expect(decoded).toEqual(cursor);
  });

  it('returns undefined for invalid base64', () => {
    expect(decodeCursor('not-valid-base64!!!')).toBeUndefined();
  });

  it('returns undefined for invalid JSON', () => {
    const invalid = Buffer.from('not json').toString('base64url');
    expect(decodeCursor(invalid)).toBeUndefined();
  });

  it('uses base64url encoding (URL safe)', () => {
    const cursor: Cursor = { ts: 1735689600, id: 'abc+123/xyz==' };
    const encoded = encodeCursor(cursor);

    expect(encoded).not.toContain('+');
    expect(encoded).not.toContain('/');
    expect(encoded).not.toContain('=');
  });
});