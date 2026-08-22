---
name: frontend-angular
description: Writing Angular — components, DI, RxJS and change detection — without the framework's classic traps.
metadata:
  hermit: true
  title: Frontend engineering — Angular
---

Applies when the project's stack is Angular. Check the version in `package.json` before writing anything: standalone components, the `inject()` function, signals and the built-in control flow (`@if`, `@for`) each landed in different releases, and using one the project's version does not have will not compile. Match what the surrounding code does — a standalone component dropped into an NgModule codebase is a migration nobody asked for.

## Components

- One responsibility each. A component that fetches, transforms and renders cannot be tested as any of the three; move the first two into a service.
- Presentational components take `@Input()` and emit `@Output()`; container components hold the data access. Follow whichever split the project already uses.
- `trackBy` on every list (`@for` requires `track`). Without it Angular destroys and rebuilds every row on any change, losing focus and state.
- Prefer `OnPush` change detection for new components, and be deliberate about it: with `OnPush`, mutating an object in place will not re-render. Replace, do not mutate.
- Unsubscribe from everything. `takeUntilDestroyed()` where available, otherwise a `destroy$` subject completed in `ngOnDestroy`. A leaked subscription keeps the whole component tree alive.

## Dependency injection

- Inject through the constructor, or `inject()` if that is the project's convention — not both in the same file.
- `providedIn: 'root'` for singletons. Providing a service in a component's `providers` gives every instance its own copy, which is occasionally what you want and usually a bug.
- Never reach into the injector manually to look a service up.

## RxJS

This is where non-Angular habits show most.

- **Do not subscribe inside a template-bound method**, and prefer the `async` pipe to subscribing at all — it unsubscribes for you.
- **Do not nest subscriptions.** A `subscribe` inside a `subscribe` is a flattening operator waiting to be written: `switchMap` to cancel the previous (searches, navigation), `concatMap` to preserve order, `mergeMap` for genuinely independent work, `exhaustMap` to ignore new work while one is running (submit buttons).
- Handle errors inside the stream with `catchError`. An unhandled error terminates the observable and the stream never emits again — the UI simply stops updating with no console trace pointing at the cause.
- `shareReplay({ refCount: true })` for a stream several consumers subscribe to; without `refCount` it keeps the source alive forever.
- Debounce user input (`debounceTime`, `distinctUntilChanged`) before it reaches the network.

## Signals

If the project uses signals, prefer them for component state — they work with `OnPush` without manual marking:

- `computed()` for derived values. Never compute in the template; it runs on every check.
- `effect()` is for synchronising with the outside world, not for deriving state.
- Do not mix signals and observables for the same piece of state. Pick the one the project uses and convert at the boundary.

## Templates

- Keep logic out. No method calls in bindings — they execute on every change-detection cycle. Use a `computed`, a pipe, or a field.
- Pure pipes for formatting; they are cached and the template stays declarative.
- Use the built-in control flow (`@if`, `@for`, `@switch`) if the version supports it, otherwise the structural directives — consistently, not both.

## Forms

- **Reactive forms** for anything non-trivial: they are typed, testable and validate declaratively. Template-driven forms are for the simplest cases only, and mixing the two in one feature is confusing.
- Type the form (`FormGroup<...>`) where the version supports it.
- Custom validators return `ValidationErrors | null`; async validators go in the third argument, not the second.
- Show errors next to the field, associated for screen readers, and only after the control is touched.

## HTTP

- All access through `HttpClient` inside a service — never in a component.
- Cross-cutting concerns (auth headers, retries, error mapping, correlation ids) belong in an interceptor, once, not repeated per call.
- Type responses from the contract in `## Interfaces`, not from a sample payload.
- Cancel in-flight requests with `switchMap` when a newer one supersedes them.

## Testing

`TestBed` with the project's runner.

- Test through the DOM the way a user reaches it. If the project has Angular Testing Library, its `getByRole` queries are preferable to `By.css` selectors, which couple tests to markup.
- Mock services through the DI container (`{ provide: X, useValue: ... }`) rather than reaching into the component.
- Call `fixture.detectChanges()` deliberately, and remember `OnPush` components will not update from a mutated input.
- `fakeAsync`/`tick` for timers and debounces; `HttpTestingController` for HTTP, and `verify()` that no request went unhandled.
- Cover every state the design specifies, including error and empty.
