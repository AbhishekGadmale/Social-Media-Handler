# LinkedIn Document Post Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add support for LinkedIn PDF Document Posts (Carousels) via the Documents API.

**Architecture:** We will add `DOCUMENT_POST` to the provider capabilities and use LinkedIn's `/rest/documents?action=initializeUpload` and `/rest/documents/{documentUrn}` polling to handle the PDF.

**Tech Stack:** TypeScript, NestJS, React, LinkedIn API (202608, 2.0.0).

**Spec:** Phase 8.7 LinkedIn Document Post.

## Global Constraints

- PDF only (application/pdf).
- Max 1 PDF per document post.
- Cannot mix PDF with images or videos.
- Max 100 MB.
- Do NOT implement page-count validation (MVP_PROVIDER_VALIDATION_DEBT).
- Use `Content.media.title` derived from filename or "Document.pdf".
- No schema migrations.
- Validate trusted upload hosts.

---

### Task 1: Provider Capabilities & Interfaces

**Files:**
- Modify: `packages/providers/core/interfaces/IPublishingProvider.ts`

- [ ] **Step 1: Add DOCUMENT_POST**
Modify `PublicationContentType` in `IPublishingProvider.ts` to include `'DOCUMENT_POST'`.

### Task 2: LinkedIn Provider Document Support

**Files:**
- Modify: `packages/providers/linkedin/linkedin.provider.ts`
- Modify: `packages/providers/linkedin/linkedin.provider.publish.spec.ts`

- [ ] **Step 1: Update Capabilities**
In `linkedin.provider.ts`, add `DOCUMENT_POST` to `getPublishingCapabilities()`:
```typescript
DOCUMENT_POST: { supported: true, maxCount: 1, maxBytes: 100 * 1024 * 1024, mimeTypes: ['application/pdf'] },
```

- [ ] **Step 2: Add `uploadLinkedInDocument`**
Implement the document initialization and polling logic matching the `Documents API`.
- `POST /rest/documents?action=initializeUpload`
- Upload via `PUT` with trusted host validation.
- Poll `GET /rest/documents/{urn}` until `AVAILABLE`.

- [ ] **Step 3: Update `publish()`**
Handle `application/pdf` by calling `uploadLinkedInDocument`, then format the `content.media.id` and `content.media.title` for `POST /rest/posts`.

- [ ] **Step 4: Provider Tests**
Add TDD tests in `linkedin.provider.publish.spec.ts` for the new flow.

### Task 3: API PublishabilityValidator

**Files:**
- Modify: `apps/api/src/modules/publishing/domain/PublishabilityValidator.ts`
- Modify: `apps/api/src/modules/publishing/domain/PublishabilityValidator.spec.ts`

- [ ] **Step 1: Classify DOCUMENT_POST**
In `PublishabilityValidator.ts`, if `mediaCount === 1` and mimeType is `application/pdf`, set `contentType = 'DOCUMENT_POST'`.
Reject mixing PDF with images/videos.

- [ ] **Step 2: Validator Tests**
Add TDD tests for PDF classification and rejection of mixed media.

### Task 4: Frontend MediaUploader

**Files:**
- Modify: `apps/web/src/components/media-uploader.tsx`

- [ ] **Step 1: Allow application/pdf**
Update `accept` attribute in file input.
Update `handleFileSelect` to handle `application/pdf`.
Prevent mixing PDF with image/video.
Limit PDF to 1.
Update the UI text to mention PDF.
