---
name: frontend-flutter
description: Writing Flutter and Dart — widgets, state management, navigation and platform channels — for the mobile app the design was drawn against.
metadata:
  hermit: true
  title: Frontend engineering — Flutter
---

Applies when the project's stack is Flutter (a `pubspec.yaml` at the root). Establish three things before writing anything, from `pubspec.yaml` and the surrounding code, because each changes what correct code looks like:

- **State management.** `provider`, `flutter_riverpod`, `flutter_bloc`/`bloc`, or bare `setState` — these are not interchangeable, and mixing two approaches in one feature is the clearest sign an outsider wrote it. Match what is already there.
- **Navigation.** `go_router` or another declarative router means routes are configuration, not imperative `Navigator.push` calls. Do not reach for `Navigator.push` in a `go_router` app.
- **Null safety is not optional.** Every current Flutter project runs sound null safety. A nullable type is a real state to handle, not a warning to silence.

## Widgets

- **`const` every widget that can be.** A `const` constructor lets Flutter skip rebuilding that subtree entirely; its absence is the single most common unnecessary-rebuild cause in a Flutter codebase. Add it by default and only omit it where the arguments genuinely vary.
- `StatelessWidget` unless the widget owns mutable state that survives a rebuild. Reaching for `StatefulWidget` to hold something derivable from `build` is state that can go stale.
- One widget, one concern. A build method that fetches, transforms and lays out is three jobs, and Flutter's own DevTools rebuild profiler will show you the whole subtree paying for one of them changing.
- Keys (`ValueKey`, `ObjectKey`) on any widget in a list that can reorder, insert or remove — without one, Flutter matches by position and animates or preserves state against the wrong element. `GlobalKey` is for the rare case you need imperative access to state or context from outside; it is not a plain list key and creating one per build leaks state.

## State management

- **Put state as low as it can go.** A value only one widget reads has no business in a provider. Lift only when a second, non-nested widget genuinely needs it.
- **Scope the rebuild, not just the state.** `context.watch<T>()` (or a `Consumer`/`BlocBuilder`) rebuilds everything below it whenever `T` changes. `context.select<T, V>()` (or a `Selector`, or reading only the fields you need) rebuilds only what depends on that one field. Watching the whole object when you read one field is a performance bug that only shows up under load.
- **Never call `setState` (or emit to a controller) after the widget is disposed.** An async callback that resolves after navigation away is the classic case: check `mounted` before touching state in anything that resumed after an `await`.
- Dispose what you create: `TextEditingController`, `AnimationController`, `StreamSubscription`, `FocusNode`. An undisposed controller leaks and, for animation controllers, keeps ticking against a widget that no longer exists.

## Async and BuildContext

- **Never use `BuildContext` after an `await` without checking `mounted` first.** The widget can be disposed while the future is pending, and the linter (`use_build_context_synchronously`) exists because this is a real, frequent crash, not a style nit.
- **Never construct a new `Future` or `Stream` inside `build()`.** `FutureBuilder(future: fetchThing())` calls `fetchThing()` on every rebuild, which re-triggers loading state forever. Create the future once — in `initState`, a provider, or a field — and pass the same instance to the builder.
- `StreamBuilder` needs a stream that outlives a single build, for the same reason. Cancel subscriptions you create manually in `dispose`.
- `compute()` or an isolate for CPU-bound work — JSON parsing a large payload, image processing. Flutter has one UI isolate; blocking it drops frames, not just responsiveness.

## Navigation

- Follow the router already in place. In `go_router`, routes and their guards are declared in the router config, not scattered `Navigator.push` calls through the widget tree.
- Passing data through a route belongs in the route's own typed arguments, not through a global or a static field reached from the destination screen.
- Guard against navigating with a stale `context` the same way as any other post-`await` context use.

## Platform channels

- A `MethodChannel` call can throw a `PlatformException` — catch it specifically and handle the platform-not-supported case, since the same Dart code often runs on a platform without the native implementation.
- Keep the channel's native-side work off the platform's own main thread for anything slow, mirroring the isolate rule on the Dart side.
- Prefer an existing, maintained plugin over a hand-written channel unless the project has a specific reason not to; a hand-rolled channel is code someone now has to maintain across every platform.

## Styling and design tokens

- Route colors, spacing and type through `ThemeData`/`ThemeExtension`, not literals scattered through widgets. A raw `Color(0xFF...)` where the design specified a token is a defect, the same as a raw hex in CSS.
- `MediaQuery` for responsive layout decisions; do not hardcode device dimensions.

## Testing

- **Widget tests** (`flutter_test`) for individual widgets and screens. `pumpAndSettle()` waits out animations and microtasks; use plain `pump()` when you specifically need to inspect an in-flight state, or `pumpAndSettle` will hide it.
- Find elements the way a user would: `find.byType`, `find.text`, `find.bySemanticsLabel` — prefer these over `find.byKey` scattered through production widgets purely to make them testable.
- `mocktail` or `mockito` for collaborators; mock at the boundary you own (a repository, an API client), not the widget under test.
- **Integration tests** (`integration_test`) for real end-to-end flows across screens, run on a device or simulator — a widget test alone cannot catch a navigation or platform-channel regression.
- Golden tests for pixel-level UI regressions where the design's visual fidelity matters; regenerate goldens deliberately, never as a reflex to make a failing test pass.
