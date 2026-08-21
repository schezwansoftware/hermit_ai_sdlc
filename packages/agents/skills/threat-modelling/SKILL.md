---
name: threat-modelling
description: Finding the security consequences of a design or change, focused on what untrusted input can reach.
metadata:
  hermit: true
  title: Threat modelling
---

Ask one question repeatedly: **what can an untrusted party influence, and where does that influence end up?**

## Trace every new input

For each new or changed interface, follow the data:

```
untrusted input → parsing → validation → business logic → sink
```

Sinks that matter: SQL, shell, filesystem paths, HTTP requests made by the server, template rendering, deserialisation, log statements, and anything reflected back to another user.

| Sink | Threat | Control |
|---|---|---|
| SQL | Injection | Parameterised queries; never string concatenation |
| Shell | Command injection | Avoid the shell; pass argv arrays |
| Path | Traversal | Resolve, then verify the result is inside the base directory |
| Outbound HTTP | SSRF | Allowlist hosts; block link-local and private ranges; no redirects to them |
| Template/DOM | XSS | Contextual escaping; never build HTML with concatenation |
| Deserialisation | RCE | Schema-validated formats only; never native deserialisation of untrusted bytes |
| Logs | Injection, PII leak | Structured logging; never log secrets or full request bodies |

## Authorisation, specifically

Authentication answers *who*. Authorisation answers *may they* — and it is missed far more often.

For every new endpoint and every new field: who may read this, who may write it, and **is the check on the object or only on the route?** Route-level checks miss the case where a valid user requests another user's id. Ask explicitly: can user A pass user B's identifier and get a 200?

## Secrets and data

- No credentials in source, tests, fixtures, or error messages.
- Classify new data: is any of it personal, financial, or health data? That determines retention, logging and encryption obligations.
- Error responses must not leak internals — stack traces, queries, or whether an account exists.

## Multi-tenant and concurrency

- Does every query filter by tenant? A missing tenant predicate is a data breach, not a bug.
- Can two concurrent requests interleave to skip a check? Check-then-act on a shared resource needs a lock or a constraint.

## Reporting

Each finding: the untrusted input, the path it takes, the sink it reaches, and the concrete consequence. "Input is not validated" is not a finding. "The `redirect` query parameter reaches `res.redirect` unvalidated at `auth.js:88`, enabling an open redirect used to phish the OAuth callback" is.
