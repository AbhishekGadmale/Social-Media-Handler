import { describe, it, expect } from 'vitest';
import { PostStatus } from '@prisma/client';
import {
  canTransitionPublication,
  assertPublicationTransition,
  InvalidPublicationStateTransitionError,
  isTerminalPublicationState,
  isRetryablePublicationState
} from '../state-machine.js';

describe('Publishing State Machine', () => {
  describe('canTransitionPublication', () => {
    it('allows DRAFT -> SCHEDULED', () => {
      expect(canTransitionPublication(PostStatus.DRAFT, PostStatus.SCHEDULED)).toBe(true);
    });

    it('allows DRAFT -> QUEUED', () => {
      expect(canTransitionPublication(PostStatus.DRAFT, PostStatus.QUEUED)).toBe(true);
    });

    it('allows SCHEDULED -> QUEUED', () => {
      expect(canTransitionPublication(PostStatus.SCHEDULED, PostStatus.QUEUED)).toBe(true);
    });

    it('allows QUEUED -> PUBLISHING', () => {
      expect(canTransitionPublication(PostStatus.QUEUED, PostStatus.PUBLISHING)).toBe(true);
    });

    it('allows PUBLISHING -> PUBLISHED', () => {
      expect(canTransitionPublication(PostStatus.PUBLISHING, PostStatus.PUBLISHED)).toBe(true);
    });

    it('allows PUBLISHING -> FAILED', () => {
      expect(canTransitionPublication(PostStatus.PUBLISHING, PostStatus.FAILED)).toBe(true);
    });

    it('allows PUBLISHING -> UNKNOWN', () => {
      expect(canTransitionPublication(PostStatus.PUBLISHING, PostStatus.UNKNOWN)).toBe(true);
    });

    it('allows FAILED -> QUEUED (retry)', () => {
      expect(canTransitionPublication(PostStatus.FAILED, PostStatus.QUEUED)).toBe(true);
    });

    it('allows idempotency (same state)', () => {
      expect(canTransitionPublication(PostStatus.QUEUED, PostStatus.QUEUED)).toBe(true);
    });

    it('denies illegal transitions', () => {
      expect(canTransitionPublication(PostStatus.PUBLISHED, PostStatus.DRAFT)).toBe(false);
      expect(canTransitionPublication(PostStatus.PUBLISHED, PostStatus.QUEUED)).toBe(false);
      expect(canTransitionPublication(PostStatus.QUEUED, PostStatus.SCHEDULED)).toBe(false);
      expect(canTransitionPublication(PostStatus.FAILED, PostStatus.PUBLISHED)).toBe(false);
      expect(canTransitionPublication(PostStatus.UNKNOWN, PostStatus.PUBLISHING)).toBe(false);
    });
  });

  describe('assertPublicationTransition', () => {
    it('does not throw for legal transition', () => {
      expect(() => assertPublicationTransition(PostStatus.DRAFT, PostStatus.SCHEDULED)).not.toThrow();
    });

    it('throws InvalidPublicationStateTransitionError for illegal transition', () => {
      expect(() => assertPublicationTransition(PostStatus.PUBLISHED, PostStatus.DRAFT))
        .toThrow(InvalidPublicationStateTransitionError);
    });
  });

  describe('isTerminalPublicationState', () => {
    it('returns true for PUBLISHED', () => {
      expect(isTerminalPublicationState(PostStatus.PUBLISHED)).toBe(true);
    });

    it('returns false for others', () => {
      expect(isTerminalPublicationState(PostStatus.PUBLISHING)).toBe(false);
      expect(isTerminalPublicationState(PostStatus.FAILED)).toBe(false);
    });
  });

  describe('isRetryablePublicationState', () => {
    it('returns true for FAILED and UNKNOWN', () => {
      expect(isRetryablePublicationState(PostStatus.FAILED)).toBe(true);
      expect(isRetryablePublicationState(PostStatus.UNKNOWN)).toBe(true);
    });

    it('returns false for others', () => {
      expect(isRetryablePublicationState(PostStatus.PUBLISHING)).toBe(false);
      expect(isRetryablePublicationState(PostStatus.PUBLISHED)).toBe(false);
    });
  });
});
