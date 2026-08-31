import { PostStatus } from '@prisma/client';

export class InvalidPublicationStateTransitionError extends Error {
  constructor(public currentState: PostStatus, public requestedState: PostStatus) {
    super(`Cannot transition publication from ${currentState} to ${requestedState}`);
    this.name = 'InvalidPublicationStateTransitionError';
  }
}

const LEGAL_TRANSITIONS: Record<PostStatus, PostStatus[]> = {
  [PostStatus.DRAFT]: [PostStatus.SCHEDULED, PostStatus.QUEUED],
  [PostStatus.SCHEDULED]: [PostStatus.DRAFT, PostStatus.QUEUED],
  [PostStatus.QUEUED]: [PostStatus.PUBLISHING, PostStatus.DRAFT], // Adding DRAFT for cancellation from QUEUED
  [PostStatus.PUBLISHING]: [
    PostStatus.PUBLISHED,
    PostStatus.FAILED,
    PostStatus.UNKNOWN,
  ],
  [PostStatus.PUBLISHED]: [], // Terminal
  [PostStatus.FAILED]: [PostStatus.QUEUED, PostStatus.DRAFT], // Allow going back to DRAFT for edits, or QUEUED for retry
  [PostStatus.UNKNOWN]: [PostStatus.PUBLISHED, PostStatus.FAILED], // Manual reconciliation
  [PostStatus.PARTIAL]: [], // Aggregate state, not applicable to single variant
};

export function canTransitionPublication(from: PostStatus, to: PostStatus): boolean {
  if (from === to) return true; // Idempotency
  return LEGAL_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertPublicationTransition(from: PostStatus, to: PostStatus): void {
  if (!canTransitionPublication(from, to)) {
    throw new InvalidPublicationStateTransitionError(from, to);
  }
}

export function isTerminalPublicationState(state: PostStatus): boolean {
  return state === PostStatus.PUBLISHED;
}

export function isRetryablePublicationState(state: PostStatus): boolean {
  return state === PostStatus.FAILED;
}

export function isReconciliationRequiredState(state: PostStatus): boolean {
  return state === PostStatus.UNKNOWN;
}
