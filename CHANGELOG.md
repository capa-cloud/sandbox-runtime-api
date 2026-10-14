# Changelog

## Unreleased

No changes queued.

## 0.1.2 - 2026-10-14

- replace Provider exception details and stored failure messages with fixed public messages, preserve
  legal portable error codes, and normalize arbitrary failure codes;
- suppress Provider exception details in conformance reports without losing runner deadline evidence;
- reject embedded credentials in Provider endpoint URLs;
- add synthetic HTTP/SDK/resource-read regressions and a value-withholding commit-identity gate;
- verify exact supplied release archives, diagram integrity and Provider redaction in the installed
  distribution, including downloaded release assets;
- separate descendant fixture startup headroom from its unchanged cancellation deadline, assert
  the child is alive before cancellation, and clean up owned execution after failed readiness;
- document the difference between content scans, commit-identity checks, explicit legacy baselines,
  and authorized history remediation. The existing `v0.1.1` archive remains unchanged.

## 0.1.1 - 2026-10-09

- protect the reference HTTP server with authority/origin/fetch-metadata checks, JSON media-type
  enforcement, strict action/file routes, and portable malformed-path errors;
- reject special filesystem write/list targets and cancel descendants after their group leader exits;
- validate an independently installed tarball, compile the packaged example, and smoke the actual
  SDK/CLI through files, commands, SSE, recreation, fencing, and graceful resource cleanup;
- expand credential-shaped detection without printing matching values, including historical hits;
- make public-content scanning self-contained in Node.js and fail closed on scan/history errors,
  including CI environments without ripgrep;
- isolate all test-created filesystem fixtures in unique temporary directories;
- align reference Provider and OpenAPI versions with the package and include a release acceptance map;
- allow generation-fenced termination during ambiguous pause/resume transitions;
- bound every conformance Provider call, validate timeout options, and verify cleanup state;
- use unique conformance create-intent keys and reject unsuccessful recovery before data-plane probes;
- upgrade development tooling with matching Vitest/coverage versions and group future upgrades;
- update the transitive development dependency `source-map-js` to 1.2.2 for
  [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) and gate all dependencies
  against high-severity advisories;
- package documentation and diagrams, and validate actual tarball links and runtime entrypoints;
- clarify shipped SDK/transport behavior and add verified v0.1 release evidence.
- add three validated AnyCap explanatory diagrams and two deterministic contract diagrams;
- add text equivalents, visual provenance, integrity hashes, multi-size validation evidence, and
  generated-image metadata scanning.

## 0.1.0 - 2026-09-02

Initial public MVP:

- lifecycle, generation fencing, reconciliation, and recreation;
- capability manifests and provider SPI;
- command, file, event replay, and SSE contracts;
- TypeScript SDK and CLI reference server;
- Local and Mock Providers;
- conformance, security-negative, HTTP/SDK, and concurrency tests;
- clean-room provenance, public-content scanning, OpenAPI, and bilingual documentation.
