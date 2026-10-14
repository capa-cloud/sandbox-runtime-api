# Contributing

## Development

```bash
pnpm install
pnpm check
pnpm sanitize
pnpm test:coverage
pnpm pack:check
```

Use Node.js 22.12+ (22.x) or 24.x for development. Keep each change scoped to one protocol or provider
concern and add tests
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

Before pushing and after merging, review [public-safety guidance](docs/public-safety.md) and run the
commit-identity gate against the declared candidate range. Configure an approved public name and
GitHub noreply email. For squash merges, pass an explicit approved author email and verify the actual
merged commit; local Git configuration alone does not control GitHub merge authorship.
