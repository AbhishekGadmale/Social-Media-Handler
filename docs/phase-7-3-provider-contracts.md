# Phase 7.3 — Publishing Provider Contracts & Capability Validation

## Interface Architecture
Phase 7.3 establishes a composable provider contract pattern. Instead of a monolithic `ISocialProvider`, publishing capabilities are decoupled into `IPublishingProvider`. The central `ProviderRegistry` performs structural capability checks (`supportsPublishing()`) and safely casts the provider adapter. 

Providers without publishing implementations (currently YouTube and LinkedIn) return `false` for `supportsPublishing()` and safely throw `ProviderCapabilityError('PUBLISHING')` if their adapter is forcibly requested.

## Capability Vocabulary
Capabilities are mapped to the strict `PublicationContentType` taxonomy defined by the design:
- `TEXT_POST`
- `IMAGE_POST`
- `MULTI_IMAGE_POST`
- `VIDEO_POST`
- `LINK_POST`

Features (metadata) are captured in a `features` array (e.g. `['TITLE', 'TAGS', 'VISIBILITY']`).

## Constraint Model
Each content type capability has a strict structural `ContentConstraint`:
```ts
{
  supported: boolean;
  maxLength?: number;
  maxBytes?: number;
  maxCount?: number;
  mimeTypes?: string[];
}
```

## Option Validation
Provider-specific options (e.g. YouTube visibility, LinkedIn privacy) are validated via `validateProviderOptions(options: unknown): ProviderOptionsValidationResult`. It is expected that adapters implement this internally using Zod schemas, returning a normalized `valid` boolean and an array of structured issues if invalid.

## Normalized Result & Failure
- **Success:** `ProviderPublishSuccess` containing `externalPostId`, `canonicalUrl`, `publishedAt`, and an optional `processingState` (e.g., `PUBLISHING` vs `PROCESSING` for video).
- **Failure:** `ProviderPublishFailure` mapped precisely to the persistent domain failure taxonomy (`TRANSIENT`, `RATE_LIMITED`, `AUTH_REQUIRED`, `VALIDATION`, `PERMANENT`, `UNKNOWN_RESULT`) alongside an optional `retryAfterSeconds`.

## Registry Behavior
`ProviderRegistry` exposes:
- `supportsPublishing(name)`: Structural type check.
- `getPublishingAdapter(name)`: Returns the adapter or cleanly throws a native `ProviderCapabilityError`.

## Adapter vs Platform Capability Distinction
By design, the platform capabilities (what a platform theoretically supports) and adapter capabilities (what our code actually executes securely) are decoupled. YouTube and LinkedIn *platform* publishing exists, but their adapters do *not* advertise this capability natively yet to prevent un-executable promises.
