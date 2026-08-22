---
name: backend-java-spring
description: Writing Spring Boot services — layering, dependency injection, JPA and transactions — without the framework's classic traps.
metadata:
  hermit: true
  title: Backend engineering — Java / Spring Boot
---

Applies when the project's stack is JVM. Check the build file first: `pom.xml` means Maven, `build.gradle(.kts)` means Gradle, and each has its own command for adding a dependency and running a single test. Check the Spring Boot version in the parent POM or the plugin block — Boot 3 requires Java 17+ and `jakarta.*` imports, Boot 2 uses `javax.*`, and mixing them does not compile.

## Dependency injection

- **Constructor injection only.** Field injection with `@Autowired` cannot be constructed in a plain unit test and hides a growing dependency list. A single constructor needs no annotation.
- Declare dependencies `private final`. If a class needs more than four or five, it is doing more than one job.
- Prefer `@Service`, `@Repository`, `@Component` on your own classes and `@Bean` methods in `@Configuration` for third-party types.
- Do not inject `ApplicationContext` to look beans up by hand.

## Layering

Controller → Service → Repository, and the layers do not skip.

- **Controllers** map HTTP to method calls: validate with `@Valid`, delegate, return a DTO. No business logic, no repository access.
- **Services** hold the logic and own the transaction boundary.
- **Repositories** hold queries and nothing else.
- **Never return an entity from a controller.** A JPA entity serialised to JSON leaks the schema, drags in lazy-loading exceptions outside the session, and makes every column part of your public API. Map to a DTO or a record.

## Transactions

`@Transactional` is the annotation most often applied by superstition. Get these right:

- Put it on the **service** method that defines the unit of work, not on the repository and not on the controller.
- It is **proxy-based**: a call from one method to another inside the same bean bypasses it entirely. Self-invocation does not start a transaction.
- It rolls back on unchecked exceptions only. A checked exception commits unless you declare `rollbackFor`.
- `@Transactional(readOnly = true)` on read paths — it lets the provider skip dirty-checking.
- Never hold a transaction open across an outbound HTTP call. The connection pool is smaller than you think.

## JPA and Hibernate

- **The N+1 problem is the default.** A lazy collection touched inside a loop issues one query per row and passes every functional test. Use a `JOIN FETCH` query, an entity graph, or a projection. Enable SQL logging once and count the statements before you call a read path done.
- `FetchType.LAZY` on every `@ManyToOne` and `@OneToOne`; the JPA default for those is EAGER and it is almost always wrong.
- Implement `equals`/`hashCode` on entities using the business key, not the generated id, or they misbehave in a `Set` before they are persisted. Never use Lombok's `@Data` on an entity.
- Use projections or DTO queries for read-heavy endpoints rather than loading a full aggregate to read two fields.
- **Schema changes go through Flyway or Liquibase**, whichever the project uses. `spring.jpa.hibernate.ddl-auto` is never `update` outside a local profile; verify what the project's profiles set.
- Pagination through `Pageable`. Fetching a whole table to slice it in memory is a defect.

## Configuration and profiles

- Externalise into `application.yml` bound to `@ConfigurationProperties` classes, not scattered `@Value` annotations.
- Never commit a credential. Environment variables or the project's secret manager, referenced as `${...}`.
- Respect the existing profiles (`dev`, `test`, `prod`). A change that only works under one profile needs to say so.

## Errors

- One `@RestControllerAdvice` handling exceptions centrally. Do not catch-and-format in each controller.
- Throw domain exceptions from services; translate them to status codes in the advice.
- Never return a stack trace or an internal message to a caller. Log with the correlation id, return a stable error body.
- Do not catch an exception only to log and rethrow it — the duplicate entries obscure the real one.

## Testing

- Plain JUnit 5 unit tests for services, with Mockito for collaborators. Constructor injection is what makes this possible without a Spring context.
- `@WebMvcTest` for controllers — it loads the web layer alone and stays fast.
- `@DataJpaTest` for repositories and queries.
- `@SpringBootTest` only for genuine end-to-end coverage. It loads everything and a suite of them is how a build gets slow.
- **Testcontainers over an in-memory database.** H2 accepts SQL your production engine rejects, so a green H2 test proves less than it appears to.
- `@MockBean` replaces a bean in the context; plain `@Mock` is for unit tests. Using the first everywhere fragments the context cache and slows the build.
- Assert on returned values and persisted state, not on log output.
