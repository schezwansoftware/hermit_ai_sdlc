---
name: backend-node
description: Writing server-side JavaScript and TypeScript — Express, Fastify, NestJS — with the async, typing and event-loop discipline the runtime demands.
metadata:
  hermit: true
  title: Backend engineering — Node.js
---

Applies when the project's stack is Node. Establish four things from `package.json` before writing a line, because each changes what correct code looks like:

- **Framework** — `express`, `fastify`, `@nestjs/core`, `koa` or `hapi`. NestJS is decorator-and-DI shaped and nothing like the other four; do not write bare handlers in a Nest project.
- **Express major version.** Express 5 forwards a rejected promise from an async handler to the error middleware. Express 4 does not — it hangs the request until the client times out, with nothing in the logs. In Express 4 every async handler is wrapped or every `await` is inside `try/catch`. Check the installed major; do not assume.
- **Module system.** `"type": "module"` means ESM: `import`, no `__dirname`, no `require`. Its absence means CommonJS. Mixing them is the most common way a Node change fails only at runtime.
- **TypeScript or not**, and if so the `strict` setting in `tsconfig.json`. Match it. Do not introduce TypeScript into a JavaScript service as a side effect of a feature.

## Async

Almost every Node defect that reaches production is here.

- **Every promise is awaited or explicitly handled.** A floating promise loses its rejection, and since Node 15 an unhandled rejection terminates the process — one missed `await` in a handler takes the service down.
- Use `await` throughout; do not mix it with `.then()` chains in the same function.
- `Promise.all` for independent work. `Promise.allSettled` when you need every result regardless of failure — with `all`, one rejection abandons the rest mid-flight and leaves you unable to say what completed.
- **Never `await` inside a loop over independent items.** That is sequential latency multiplied by the collection size. Map to promises and await once; bound the concurrency if the collection is unbounded.
- `try/catch` around `await` catches it; `try/catch` around a non-awaited call does not.

## Errors

- Throw `Error` instances, never strings or plain objects — anything else arrives at the handler without a stack.
- Preserve the cause: `throw new AppError('fetching invoice', { cause: err })`. Swallowing the original leaves the log with a symptom and no origin.
- Subclass `Error` for the domain's own failures and set `name`. Branch on the type, never on the message text.
- One error-handling middleware maps domain errors to status codes. Handlers throw; they do not each decide what a 404 looks like.
- Never return an internal message or a stack to the client. Log the detail with a correlation id and return the id.

## The event loop

One thread serves every request, so blocking it stalls the whole process — not just the caller.

- No synchronous I/O on a request path: `fs.readFileSync`, `execSync`, synchronous hashing. Startup is the only place these belong.
- CPU-bound work — large `JSON.parse`, image work, `crypto.pbkdf2Sync`, big loops — goes to a worker thread or a queue. Use the async form of a crypto call where one exists.
- Stream large payloads rather than buffering them. Reading a 200 MB upload into memory works in test and fails under concurrency.

## Boundaries and validation

TypeScript types are erased at runtime and prove nothing about a request body. Validate at the edge with whatever the project already uses — `zod`, `joi`, `class-validator` — and parse into a typed value there, so nothing downstream re-checks it.

Read configuration from `process.env` **once at startup**, validate it, and fail fast on anything missing. A service that starts happily and throws on the first request that touches an unset variable is worse than one that refuses to boot. Do not scatter `process.env` reads through the code, and never commit a secret's value.

## Persistence

- Parameterised queries only. A template literal carrying a value into SQL is an injection defect regardless of where the value came from.
- **A transaction runs on one connection.** Calling `pool.query('BEGIN')` and then `pool.query(...)` may take a different connection from the pool each time, so the work lands outside the transaction. Check out a client, use it for every statement, and release it in `finally`.
- Configure the pool size deliberately and close it on shutdown.
- Use the ORM or query builder that is already there. A second data-access style in one service is a permanent tax.

## HTTP calls out

`fetch` is built in from Node 18. Give every outbound call a timeout via `AbortSignal.timeout(ms)` — there is no default, so a hung dependency becomes a hung request. Check `res.ok` explicitly; a 500 does not reject. Reuse an agent or client rather than constructing one per call.

## Shutdown

Handle `SIGTERM`: stop accepting connections, let in-flight requests finish, close the database pool, then exit. A container that is killed mid-write during every deploy will eventually corrupt something.

## Testing

- Use the project's runner — `node:test`, Jest or Vitest. Do not add a second.
- `supertest` (or Fastify's `app.inject`) to exercise routes through the real router rather than calling handlers directly; the middleware chain is where the bugs are.
- Async tests `await` their assertions or return the promise. A test that forgets passes without asserting anything.
- Close servers, pools and timers in teardown. Open handles hang the suite, and the fix is usually mistaken for a flaky test.
- Fake the clock for anything time-dependent. Do not `setTimeout` your way to a passing test.
