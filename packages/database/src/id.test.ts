import { describe, it, expect } from 'vitest';
import { generateId } from './id.js';

describe('generateId', () => {
  it('generates IDs that sort monotonically', () => {
    const ids: string[] = [];
    for (let i = 0; i < 1000; i++) {
      ids.push(generateId());
    }

    const sortedIds = [...ids].sort();
    
    // Check if the original array is exactly the same as the sorted array
    expect(ids).toEqual(sortedIds);
  });
});
