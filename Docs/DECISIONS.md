# Decisions Log

This document records locked choices, open questions, and the chosen defaults according to `docs/SPEC.md` Section 0, Section 2, and Section 17.

| Decision ID | Area | Choice / Default | Rationale | Status |
| --- | --- | --- | --- | --- |
| DEC-001 | Product Name & Branding | Infinite Canvas | Specified working title in SPEC Section 17. | ADOPTED (DEFAULT) |
| DEC-002 | Persistence Model | Permanent | Stated default in SPEC Section 17. No resets or time decay for MVP. | ADOPTED (DEFAULT) |
| DEC-003 | Erasing Mechanic | Undo own last stroke only (within 30s window) | Stated default in SPEC Section 17 & Section 3/9. No erasing others' strokes. | ADOPTED (DEFAULT) |
| DEC-004 | Tile Stroke Cap | 20,000 strokes | When reached, tile is marked `frozen = true` and rejects new strokes. Remains vector for display. | ADOPTED (DEFAULT) |
| DEC-005 | Moderation Provider | Noop provider for dev; Pluggable Cloud HTTP adapter for prod | Stated default in SPEC Section 2, 10 & 17. Dev uses Noop/mock; production configurable via env. | ADOPTED (DEFAULT) |
| DEC-006 | Minimum Age | 13+ | Stated default in SPEC Section 11 & 17. Displayed in rules/terms. | ADOPTED (DEFAULT) |
| DEC-007 | Analytics | Privacy-friendly aggregate event counts (no PII) | Stated default in SPEC Section 11 & 17. Stored ephemeral metrics only. | ADOPTED (DEFAULT) |
| DEC-008 | Native Wrapper | None for MVP (Web PWA first, Capacitor later) | PWA first as per SPEC Section 2 & 17. | ADOPTED (DEFAULT) |
| DEC-009 | Accounts & Auth | Anonymous device token (UUID + SHA-256 hashed 32-byte secret) | Stated locked decision in SPEC Section 2 & 11. Zero-login friction. | ADOPTED (DEFAULT) |
| DEC-010 | Canvas Theme | Canvas is always light paper (`#FBFAF7`); Dark mode applies only to UI chrome | Stated locked decision in SPEC Section 2 & 7. | ADOPTED (DEFAULT) |
| DEC-011 | Local Dev Environment & Services | Node 20+, pnpm workspaces, docker compose for postgres & minio | Docker compose for databases/s3; fallbacks for direct local/WSL instances if docker daemon is inactive. | ADOPTED (DEFAULT) |
