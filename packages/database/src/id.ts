import { uuidv7 } from 'uuidv7';

/**
 * Generates a temporally-sortable UUID v7.
 * All models must use this function for primary keys explicitly on creation.
 */
export function generateId(): string {
  return uuidv7();
}
