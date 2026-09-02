# Contributing

## Development

```bash
pnpm install
pnpm check
pnpm sanitize
pnpm test:coverage
pnpm pack:check
```

Use Node.js 22 or later. Keep each change scoped to one protocol or provider concern and add tests
for observable behavior.

## Contract changes

Public contract changes must include:

1. specification or decision-record updates;
2. protocol type changes;
3. reference runtime behavior when affected;
4. conformance coverage when provider behavior changes;
5. compatibility notes for breaking changes.

## Provenance

Read `docs/clean-room-policy.md` before contributing. Pull requests must identify public sources or
an independent design rationale. Do not include proprietary code, private infrastructure names,
credentials, user data, or unpublished behavior.

Contributions are accepted under the Apache License 2.0.
