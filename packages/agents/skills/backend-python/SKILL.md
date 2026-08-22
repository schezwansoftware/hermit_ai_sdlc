---
name: backend-python
description: Writing server-side Python — Django, FastAPI and Flask — in the idiom the codebase already uses.
metadata:
  hermit: true
  title: Backend engineering — Python
---

Applies when the project's stack is Python. Identify the framework before writing anything: `manage.py` or `django` in the dependencies means Django; `FastAPI(` or `uvicorn` means FastAPI; `Flask(` means Flask. They are not interchangeable and mixing their idioms is the clearest sign an outsider wrote the code.

## Common to all three

**Type hints are not optional in new code.** Annotate parameters and returns. If the project runs `mypy` or `pyright` in CI, your code passes it at the project's configured strictness — check `pyproject.toml` or `setup.cfg` before assuming.

**Follow the project's dependency manager.** `pyproject.toml` with `[tool.poetry]`, with `[project]`, `requirements.txt`, or a lock file each imply a different add-a-dependency command. Never hand-edit a lock file.

**Exceptions.** Raise a specific exception type, never bare `Exception`. Never write `except:` or `except Exception: pass` — a swallowed traceback is an afternoon lost. Chain with `raise ... from err` so the cause survives. Define the domain's own exception hierarchy where one already exists rather than reusing `ValueError` for everything.

**Do not mutate default arguments.** `def f(items=[])` shares one list across every call. Use `None` and build inside.

**Context managers own resources.** Files, connections, locks, transactions. If you write an explicit `close()` in new code, justify it.

**Settings come from the environment**, through the project's existing config object — `django.conf.settings`, a Pydantic `BaseSettings`, or whatever is there. Never `os.environ[...]` scattered through modules, and never a literal credential.

## Async

Sync and async do not mix silently. A blocking call inside an `async def` stalls the whole event loop, and it will not show up in a unit test — only under concurrent load.

- In FastAPI, a `def` handler runs in a threadpool and a `async def` handler runs on the loop. Choosing wrongly is a performance defect. Blocking DB drivers belong in `def`; `asyncio`-native ones in `async def`.
- Django is sync by default; `async` views need an ASGI deployment and async-safe ORM calls (`.aget()`, `.acreate()`, `sync_to_async`). Do not introduce them into a WSGI project.
- Never call `asyncio.run()` inside a request handler.

## Django

- Business logic goes in models or a service module, not in views. Fat views are the project's future problem.
- Query with `select_related` / `prefetch_related` wherever a loop touches a relation. The N+1 is the single most common Django performance bug and it passes every functional test.
- Migrations are generated (`makemigrations`), reviewed, and committed. Read the generated file — an unreviewed migration is how a table gets rewritten in production. Never edit an applied migration; add a new one.
- Use the ORM's transaction API (`transaction.atomic`) explicitly where the design names an atomic boundary. `ATOMIC_REQUESTS` is a project-wide setting, not a substitute.
- Validate through forms or DRF serializers, not ad-hoc in the view.

## FastAPI

- Pydantic models are the contract. Declare request and response models explicitly, including `response_model`, so the OpenAPI schema matches reality.
- Dependencies (`Depends`) carry sessions, auth and configuration. Do not instantiate a DB session inside a handler.
- Return domain objects mapped to response models; never leak an ORM object directly, which is how internal columns become public API.
- Raise `HTTPException` at the boundary; keep domain code free of HTTP concepts.

## Flask

- Use blueprints; a single-module app stops scaling the moment there are two features.
- The application factory pattern (`create_app`) is what makes the app testable. Follow it if the project has it.
- Access request state through the request context, and never store per-request data on module globals.

## Testing

`pytest` unless the project says otherwise. Match the existing layout — `tests/` beside the package, or `test_*.py` next to the module.

- Fixtures over setup methods. Scope them no wider than needed.
- Parametrise instead of copying a test body with different literals.
- Mock at the boundary you own — the HTTP client, the clock, the queue — never the code under test.
- Django: `pytest-django` with `@pytest.mark.django_db`. Do not hit the network or a real broker in a unit test.
- FastAPI: `TestClient` for sync, `httpx.AsyncClient` with `ASGITransport` for async paths.
- Assert on behaviour and returned values, not on log output.
