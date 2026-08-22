---
name: frontend-react
description: Writing React — components, hooks, state and data fetching — in the idiom the codebase already uses.
metadata:
  hermit: true
  title: Frontend engineering — React
---

Applies when the project's stack is React. Identify the surrounding conventions before writing anything: `next` in the dependencies means Next.js and its routing and rendering rules apply; `vite` usually means a plain SPA; check for a router, a data-fetching library and a state library, because each one changes what idiomatic looks like here.

## Components

- **Function components only.** Class components are legacy; do not add one.
- One component, one job. A component that fetches, transforms, and renders is three jobs and cannot be tested as any of them.
- Derive during render rather than mirroring props into state. `useState` seeded from a prop goes stale the moment the prop changes — this is the most common React bug there is.
- Keys come from stable ids. An array index as a key corrupts state when the list reorders.
- Prefer composition and `children` over configuration props that multiply.

## Hooks

- The rules are mechanical: only at the top level, only from components or other hooks. If the project runs `eslint-plugin-react-hooks`, it passes clean.
- **The dependency array is a correctness feature, not a lint annoyance.** Never silence the exhaustive-deps warning to make an effect run less often; fix what the effect depends on instead.
- **Most effects should not exist.** `useEffect` is for synchronising with something outside React — a subscription, a timer, an imperative browser API. It is not for deriving state, not for transforming props, and not for fetching in a codebase that has a data-fetching library.
- Every subscription, timer and listener returns its cleanup. An effect that fetches handles the unmount case, or it sets state on a component that is gone.
- `useMemo` and `useCallback` cost something. Reach for them when a measurement or a referential-equality dependency justifies it, not by default.

## State

Decide where each piece belongs and say so — the architecture's `## Frontend Design` names the split:

- **Server state** — anything that came from an API. It belongs in the project's data-fetching layer (TanStack Query, RTK Query, the framework's loader), which owns caching, refetching and invalidation. Copying it into `useState` discards all three.
- **Client state** — form drafts, open/closed, selection. Local `useState` first; lift only when a second component genuinely needs it.
- **Global state** — a store, if the project has one. Not a default: prop drilling two levels is cheaper to read than indirection through a store.
- Context is for values that rarely change. Every consumer re-renders when it does, so a fast-changing value in Context is a performance bug spread across the tree.

## Data fetching

- Use whatever the project already uses. Introducing a second data-fetching approach is worse than an imperfect first one.
- Type responses from the contract in `## Interfaces`, not from a sample payload — a sample shows one case, not the shape.
- Handle loading, empty and error explicitly at the point of use. A component that renders only the success branch is incomplete.
- Cancel or ignore in-flight requests on unmount and on rapid re-query.

## Forms

- Follow the project's form library if there is one. Hand-rolled state beside a configured library is duplicate machinery.
- Controlled inputs need a value *and* an onChange; a value without one is read-only by accident.
- Validate on the schema the backend enforces, and show the error next to the field, associated with it for screen readers.

## Styling

- Use the project's approach — CSS modules, Tailwind, styled-components, whatever is there. Do not add a second.
- Values come from `design-tokens`. A raw hex or a magic pixel value where a token exists is a defect.
- Avoid inline styles except for genuinely dynamic values; they cannot be themed or overridden.

## Testing

React Testing Library with the project's runner (Vitest or Jest).

- **Query the way a user finds things**: `getByRole` first, then label text, then text. `getByTestId` is a last resort and usually signals a missing accessible name.
- Assert on rendered output and on what the user can do, never on state, props, or internal function calls.
- `userEvent` over `fireEvent` — it models real interaction, including focus.
- Use `findBy*` for anything asynchronous rather than an arbitrary wait.
- Mock at the network boundary (MSW or the project's equivalent), not by stubbing the component's own hooks.
- Test every state the design specifies, including error and empty — those are the ones that break in production.
