# Security Policy

## Supported versions

The project is pre-1.0. Security fixes are applied to the latest development release only.

## Reporting a vulnerability

Use GitHub private vulnerability reporting when enabled. Do not open a public issue containing
exploit details, credentials, private infrastructure, prompts, or user data.

## Deployment boundary

The reference runtime and mock provider are development implementations. They do not provide:

- tenant authentication or authorization;
- strong process, kernel, filesystem, or network isolation;
- credential storage or secret brokering;
- durable distributed scheduling;
- production rate limiting, audit retention, or disaster recovery.

A production adapter must document its trust boundary, capability limitations, credential model,
and isolation evidence. Passing portable conformance does not certify security.
