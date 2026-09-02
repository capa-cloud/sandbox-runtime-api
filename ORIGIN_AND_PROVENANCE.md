---
id: origin-and-provenance
authority: canonical
status: canonical
title: Origin and provenance
genre: spec
last_verified: 2026-09-02
---

# Origin and Provenance

Sandbox Runtime API is an independently designed public project.

## Allowed design inputs

The initial design uses only:

- public Capa architecture and repositories;
- public `harness-runtime-api` contracts;
- public Kubernetes Agent Sandbox documentation;
- public OCI, container, Kubernetes, and cloud-provider documentation;
- public documentation from sandbox products and runtimes;
- general distributed-systems principles such as idempotency, capability negotiation,
  reconciliation, optimistic concurrency, and desired/observed state separation.

Initial public references:

- <https://capa.rxcloud.group/>
- <https://github.com/capa-cloud/harness-runtime-api>
- <https://github.com/kubernetes-sigs/agent-sandbox>
- <https://github.com/opencontainers/runtime-spec>
- <https://github.com/opencontainers/image-spec>
- <https://kubernetes.io/docs/concepts/workloads/pods/>

## Prohibited inputs

The project must not derive code or contracts from:

- private source repositories;
- internal API documentation, database schemas, cache keys, configuration, or runbooks;
- production incidents, logs, traces, account data, or customer data;
- unpublished provider integration behavior;
- proprietary test cases or deployment topology.

Knowing that a general engineering problem exists does not authorize copying a private solution.
Public contributions must be independently explainable from public sources or first-principles
rationale.

## Contribution provenance

Substantive protocol or provider contributions should include one of:

1. a public specification or documentation URL;
2. an independently written design rationale;
3. a minimal reproducible behavior against a public provider API.

If provenance is uncertain, stop and open a design issue without including the questionable
material.
