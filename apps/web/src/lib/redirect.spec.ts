import { describe, it, expect } from 'vitest';
import { getValidRedirect, isValidRedirect } from './redirect';

describe('getValidRedirect & isValidRedirect', () => {
  describe('Valid internal redirects', () => {
    it('accepts a standard internal application path', () => {
      expect(getValidRedirect('/workspace-1/publishing')).toBe('/workspace-1/publishing');
      expect(isValidRedirect('/workspace-1/publishing')).toBe(true);
    });

    it('preserves query strings on valid internal paths', () => {
      expect(getValidRedirect('/workspace-1/publishing?tab=drafts')).toBe(
        '/workspace-1/publishing?tab=drafts'
      );
      expect(isValidRedirect('/workspace-1/publishing?tab=drafts')).toBe(true);
    });

    it('preserves hash fragments on valid internal paths', () => {
      expect(getValidRedirect('/workspace-1/publishing#section')).toBe(
        '/workspace-1/publishing#section'
      );
      expect(isValidRedirect('/workspace-1/publishing#section')).toBe(true);
    });

    it('preserves both query strings and fragments on valid internal paths', () => {
      expect(getValidRedirect('/workspace-1/publishing?tab=drafts#top')).toBe(
        '/workspace-1/publishing?tab=drafts#top'
      );
      expect(isValidRedirect('/workspace-1/publishing?tab=drafts#top')).toBe(true);
    });

    it('accepts root path and other application routes', () => {
      expect(getValidRedirect('/')).toBe('/');
      expect(isValidRedirect('/')).toBe(true);
      expect(getValidRedirect('/dashboard')).toBe('/dashboard');
      expect(isValidRedirect('/dashboard')).toBe(true);
    });

    it('accepts internal paths with encoded characters in query string', () => {
      expect(getValidRedirect('/search?q=a%2fb')).toBe('/search?q=a%2fb');
      expect(isValidRedirect('/search?q=a%2fb')).toBe(true);
    });
  });

  describe('Invalid external and malformed redirects', () => {
    it('rejects absolute https URLs', () => {
      expect(getValidRedirect('https://evil.example.com')).toBeNull();
      expect(isValidRedirect('https://evil.example.com')).toBe(false);
    });

    it('rejects absolute http URLs', () => {
      expect(getValidRedirect('http://evil.example.com')).toBeNull();
      expect(isValidRedirect('http://evil.example.com')).toBe(false);
    });

    it('rejects protocol-relative URLs (//)', () => {
      expect(getValidRedirect('//evil.example.com')).toBeNull();
      expect(isValidRedirect('//evil.example.com')).toBe(false);
    });

    it('rejects slash-backslash bypass targets (/\\)', () => {
      expect(getValidRedirect('/\\evil.example.com')).toBeNull();
      expect(isValidRedirect('/\\evil.example.com')).toBe(false);
    });

    it('rejects javascript: scheme targets', () => {
      expect(getValidRedirect('javascript:alert(1)')).toBeNull();
      expect(isValidRedirect('javascript:alert(1)')).toBe(false);
    });

    it('rejects data: scheme targets', () => {
      expect(getValidRedirect('data:text/html,test')).toBeNull();
      expect(isValidRedirect('data:text/html,test')).toBe(false);
    });

    it('rejects domain strings missing leading slash', () => {
      expect(getValidRedirect('evil.example.com')).toBeNull();
      expect(isValidRedirect('evil.example.com')).toBe(false);
    });

    it('rejects empty strings', () => {
      expect(getValidRedirect('')).toBeNull();
      expect(isValidRedirect('')).toBe(false);
    });

    it('rejects missing values (null or undefined)', () => {
      expect(getValidRedirect(null)).toBeNull();
      expect(isValidRedirect(null)).toBe(false);
      expect(getValidRedirect(undefined)).toBeNull();
      expect(isValidRedirect(undefined)).toBe(false);
    });

    it('rejects paths containing backslashes anywhere', () => {
      expect(getValidRedirect('/foo\\bar')).toBeNull();
      expect(isValidRedirect('/foo\\bar')).toBe(false);
      expect(getValidRedirect('\\evil.example.com')).toBeNull();
      expect(isValidRedirect('\\evil.example.com')).toBe(false);
    });

    it('rejects control characters', () => {
      expect(getValidRedirect('/test\r\nevil.com')).toBeNull();
      expect(isValidRedirect('/test\r\nevil.com')).toBe(false);
      expect(getValidRedirect('/test\tevil.com')).toBeNull();
      expect(isValidRedirect('/test\tevil.com')).toBe(false);
    });

    it('rejects encoded protocol-relative URLs and slashes', () => {
      expect(getValidRedirect('/%2f%2fevil.com')).toBeNull();
      expect(isValidRedirect('/%2f%2fevil.com')).toBe(false);

      expect(getValidRedirect('/%2F%2FEvil.com')).toBeNull();
      expect(isValidRedirect('/%2F%2FEvil.com')).toBe(false);

      expect(getValidRedirect('/%2f/evil.com')).toBeNull();
      expect(isValidRedirect('/%2f/evil.com')).toBe(false);
    });

    it('rejects encoded backslashes', () => {
      expect(getValidRedirect('/%5cevil.com')).toBeNull();
      expect(isValidRedirect('/%5cevil.com')).toBe(false);

      expect(getValidRedirect('/%5Cevil.com')).toBeNull();
      expect(isValidRedirect('/%5Cevil.com')).toBe(false);
    });

    it('rejects malformed percent-encoded sequences in path', () => {
      expect(getValidRedirect('/%zz')).toBeNull();
      expect(isValidRedirect('/%zz')).toBe(false);

      expect(getValidRedirect('/%2')).toBeNull();
      expect(isValidRedirect('/%2')).toBe(false);
    });

    it('rejects non-http/https URL schemes like file://', () => {
      expect(getValidRedirect('file:///etc/passwd')).toBeNull();
      expect(isValidRedirect('file:///etc/passwd')).toBe(false);
    });
  });
});
