---
name: backend-go
description: Writing server-side Go — net/http, Gin, Echo — with the error, context and concurrency discipline the language expects.
metadata:
  hermit: true
  title: Backend engineering — Go
---

Applies when the project's stack is Go. Check `go.mod` for the router before writing a handler: no HTTP dependency means `net/http` and probably `http.ServeMux`; `gin-gonic/gin` and `labstack/echo` each have their own handler signature and middleware convention.

Go has a narrower band of acceptable style than most languages, and the community enforces it. `gofmt` is not a preference. Run the project's linter — `golangci-lint` if configured — before claiming a package is done.

## Errors

This is where non-Go code most visibly leaks in.

- **Handle every error.** Never `_ = doThing()` to silence one. If it genuinely cannot fail here, the comment says why.
- **Wrap with context**: `fmt.Errorf("fetching invoice %s: %w", id, err)`. The `%w` verb is what keeps `errors.Is` and `errors.As` working up the stack. `%v` severs the chain.
- **Message style**: lower case, no trailing punctuation, no "failed to" — the caller adds its own layer and the result reads as a path.
- **Sentinel errors** (`var ErrNotFound = errors.New("not found")`) for conditions callers branch on; compare with `errors.Is`, never by string.
- **Panic is for programmer error only.** A malformed request is an error value, not a panic. Any panic that can reach a goroutine needs a recover at that goroutine's top, because an unrecovered one takes the process down.

## Context

`context.Context` is the first parameter of any function that does I/O, and it is named `ctx`. It is never stored in a struct field.

- Propagate the request's context all the way to the database and outbound calls. A cancelled request that keeps querying is wasted capacity you will only notice under load.
- Set timeouts at the boundary you control, and `defer cancel()` immediately after `context.WithTimeout`.
- `context.Value` carries request-scoped data only — trace ids, auth subject — with an unexported key type. It is not a dependency-injection mechanism.

## Concurrency

- **Do not start a goroutine without knowing how it ends.** Every one needs a termination path: a closed channel, a cancelled context, a `WaitGroup` the caller waits on.
- `errgroup.Group` for parallel work that can fail — it collects the first error and cancels the rest.
- Guard shared mutable state with a mutex held for the shortest possible span, or do not share it. Run the package's tests with `-race` before declaring concurrent code done; the race detector finds what review does not.
- Channels communicate; mutexes protect. Reaching for a channel to guard a field is a sign the design is off.

## Structure

- Follow the layout that is there. `cmd/<binary>/main.go` for entry points and `internal/` for code that must not be imported outside the module is the common convention, but the existing tree wins.
- **Accept interfaces, return structs.** Define the interface in the consuming package, sized to what that consumer needs — not a broad interface next to the implementation.
- Constructors return `(*T, error)` when construction can fail; wiring happens in `main`, not in package-level `init()`.
- Keep handlers thin: decode, validate, call a service, encode. Business logic in an HTTP handler cannot be tested without a request.

## HTTP

- Always set explicit timeouts on `http.Server` (`ReadHeaderTimeout` at minimum) and on any `http.Client` you construct. The zero-value client has no timeout and will hang forever.
- Reuse one `http.Client`; do not build one per call.
- `defer resp.Body.Close()` on every response, and drain the body before closing if you want the connection reused.
- Check `resp.StatusCode` explicitly — a 500 is not an error from `client.Do`.
- Support graceful shutdown: signal handling into `server.Shutdown(ctx)`.

## Database

- `defer rows.Close()`, and check `rows.Err()` after the loop — it is where the failure that ended iteration early actually surfaces.
- Always use parameterised queries. String-built SQL is an injection defect regardless of the input's apparent provenance.
- Pass the request's `ctx` to every query (`QueryContext`, `ExecContext`).
- Configure the pool (`SetMaxOpenConns`, `SetConnMaxLifetime`) rather than accepting defaults in a service that matters.

## Testing

- Table-driven tests are the norm. One `struct` slice of cases, `t.Run(tc.name, ...)`, subtests named so a failure identifies itself.
- Standard library `testing` first. Use whatever assertion library the project already imports; do not introduce a second.
- `t.Cleanup` over `defer` for test teardown. `t.Parallel()` only where cases are genuinely independent — and watch for the loop-variable capture if the module predates Go 1.22.
- `httptest.NewServer` for outbound HTTP, `httptest.NewRecorder` for handlers.
- Compare with `reflect.DeepEqual` or the project's diffing helper; a comparison that prints only "not equal" wastes the next person's time.
