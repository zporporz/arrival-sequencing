# Realtime authority rollout

This change requires **both** the realtime Worker and Pages application/functions.
Deploy the Worker first, then Pages. Reload existing controller tabs after the
rollout. There can be a temporary realtime interruption between deployments;
shared-state polling remains the fallback. Do not deploy only the frontend.

- Room names now use `v2:DATE:AIRPORT`, excluding previously unverified cached
  commits. The existing database is unchanged; no schema migration is required.
- `/authority` is private to the Durable Object binding. Never forward public
  Worker HTTP traffic to it. The Worker's public fetch must continue returning 404.
- Browser flight/sequence commits are ignored. The sequence API middleware
  publishes successful database responses through the private binding.
- Manual/AUTO changes use a per-flight browser queue and conditional database
  revision writes. Conflicts return 409 and trigger shared-state refresh rather
  than overwriting another controller's change.
- Sessions carry absolute/idle expiry into the room; activity renews them, logout
  revokes them, and an alarm closes silent expired sockets. A revoked session
  cannot reopen the same room with its old session credentials.

Local verification: regression tests and application build. Before operational
use, smoke-test two authenticated browsers: repeated drags, AUTO after drag,
late join, logout, and session expiration. OAuth and deployed binding behavior
must be checked in the deployed environment; local UI preview has no auth API.
