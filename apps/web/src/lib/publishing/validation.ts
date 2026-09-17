export interface MediaMinimal {
  mimeType: string;
}

export function isMediaCompatibleWithProvider(media: MediaMinimal[], provider: string): boolean {
  if (provider === 'YOUTUBE') {
    if (media.length !== 1) return false;
    if (!media[0].mimeType.startsWith('video/')) return false;
    return true;
  }
  return true; // We default to true for LinkedIn to keep current behavior
}

export function getTargetMediaValidationError(media: MediaMinimal[], provider: string): string | null {
  if (provider === 'YOUTUBE') {
    if (media.length === 0) {
      return 'YouTube posts require exactly 1 video.';
    }
    if (media.length > 1) {
      return 'YouTube only supports a single video.';
    }
    if (!media[0].mimeType.startsWith('video/')) {
      return 'This media format cannot be published to YouTube. Video required.';
    }
  }
  return null;
}
