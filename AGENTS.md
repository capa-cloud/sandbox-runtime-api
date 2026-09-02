# Repository Guidelines

## Scope

This repository owns the public Sandbox Runtime API specification, reference implementation,
provider SPI, mock adapter, SDK-facing types, and conformance checks.

## Read First

- `DOCS-INDEX.md`
- `README.md`
- `docs/clean-room-policy.md`
- `ORIGIN_AND_PROVENANCE.md`
- `spec/runtime-model.md`
- nearest source or specification file before changing a contract

## Commands

- Install: `pnpm install`
- Full check (including build, coverage, docs, and package dry-run): `pnpm check`
- Build: `pnpm build`
- Tests: `pnpm test`
- Coverage: `pnpm test:coverage`
- Documentation: `pnpm docs:check`
- Package contents: `pnpm pack:check`
- Public-content scan: `pnpm sanitize`

## Contract Rules

- Keep the portable core provider-neutral and transport-neutral.
- Express optional behavior through capability manifests.
- Treat allocation and readiness as distinct observations.
- Fence mutations with the current sandbox generation.
- Keep provider extensions namespaced and optional.
- Do not claim provider parity unless conformance tests prove it.

## Clean-room and Public Safety

- Use public sources only. Private repositories and unpublished specifications are prohibited.
- Do not copy proprietary code, API shapes, state names, tests, configuration, or diagrams.
- Never add private endpoints, organization identifiers, customer data, credentials, local absolute
  paths, session logs, or production responses.
- Provider integration tests requiring credentials must be opt-in and excluded from default CI.
- Every substantive protocol contribution must identify its public source or independent rationale.

## Verification

Protocol changes require type tests, runtime behavior tests, and conformance coverage when provider
behavior changes. Documentation changes must pass formatting, link review, and the public-content
scan.
