# Non-goals

The project intentionally does not provide:

- a hosted multi-tenant sandbox service;
- an agent framework, model loop, tool registry, or memory system;
- billing, pricing, quota sales, or account management;
- portable process or memory checkpoints across unrelated providers;
- a claim that every provider offers equivalent isolation or lifecycle behavior;
- a replacement for Kubernetes, container runtimes, microVMs, or serverless platforms;
- production authentication, authorization, credential storage, or secret brokering;
- compatibility with any private or unpublished sandbox platform;
- provider-specific fields in the portable core solely for one implementation.

The reference runtime is development infrastructure. Production deployments own tenant isolation,
durable scheduling, network enforcement, credential handling, observability, and disaster recovery.
