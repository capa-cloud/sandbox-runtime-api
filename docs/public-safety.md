---
id: public-safety
authority: reference
status: active
title: Public safety and commit identity
genre: how-to
last_verified: 2026-10-13
---

# Public Safety and Commit Identity

## Separate checks

`pnpm sanitize` scans source, available Git patch history and image trace metadata for credential
shapes, private paths and dangerous files. It is not a full semantic, personal-identity or forensic
history audit. Synthetic tests and approved public identities still need human review.

`pnpm identity:check` checks author and committer email formats in all commits reachable from `HEAD`.
It accepts GitHub noreply formats, prints commit IDs and field names only, and fails closed when Git
or the requested range is unavailable. It checks format, not authenticated identity or approved names.
Known organization fingerprints and person names require a separate private, value-withholding audit.

## Candidate range gate

Existing historical identity findings require an explicit disposition. Do not silently exempt or
rewrite them. When the owner approves retaining a historical baseline, verify every new commit:

```bash
pnpm identity:check -- --since <approved-full-base-sha>
pnpm sanitize
```

The baseline must exist and be an ancestor of `HEAD`; invalid refs fail closed. A green range check
proves only that range's author/committer email formats, not that older history has been scrubbed.
Shallow CI clones may not have the baseline. Run against a complete owning clone before push and
again on the actual merged commit; synthetic CI merge identities are not a substitute.

Use an approved public name and GitHub noreply email in local configuration. For GitHub squash merges,
the author email is independent of local configuration. Pass an explicit approved address:

```bash
gh pr merge <number> --squash --match-head-commit <verified-head-sha> \
  --author-email <approved-github-noreply-email>
```

Inspect the merged commit with the range gate after merge. Never paste personal email values into a
public finding, report or fixture; use dynamic synthetic values and reserved example identities.

## Historical remediation

Commit history, released tags, open/closed PR refs, forks, caches and release metadata are distinct
surfaces. Ordinary new commits and `.mailmap` do not remove the original objects. Prepare exact ref
and tag mappings, backup/recovery, clone migration, release/source links and cache limitations before
requesting approval for rewriting. Force-pushes, tag moves, repository deletion and support removal
are not authorized by a generic code-fix request. Never claim all public copies have disappeared.

## Runtime data boundary

Provider exceptions and failure observations use fixed messages in the post-`v0.1.1` development
source; see [SECURITY](../SECURITY.md) for release status and trusted metadata responsibilities.
Intentional command output/file content is not rewritten. Local processes still run with host-user
permissions. Do not supply real secrets or untrusted code to development fixtures.
