# GitHub Copilot Instructions

`telenest` is a reusable, fully-typed **NestJS library** (Bot API via
Telegraf + MTProto user account via GramJS) — not a Next.js app. See `CLAUDE.md`
for the authoritative project rules.

## Documentation & Comments — Required for Everything

Every file, function, class, method, constant, and type that Copilot creates or
significantly modifies **must** include complete documentation and inline
comments. No exceptions.

---

### File-level

Every new source file must start with a JSDoc / TSDoc block that covers:

- **PURPOSE** — what this file does and why it exists
- **USAGE** — how to use or import it (examples if applicable)
- **ENVIRONMENT VARIABLES** — any env vars the file reads (scripts/utilities only)
- **KEY EXPORTS** — list of main exports and their roles (modules/libs only)

```ts
/**
 * @file path/to/file.ts
 *
 * PURPOSE
 * -------
 * One paragraph explaining what this file does.
 *
 * USAGE
 * -----
 * import { foo } from './file';
 */
```

---

### Functions & Methods

Every function and method must have a JSDoc / TSDoc block that includes:

- A one-line summary sentence.
- `@param` for every parameter (name + type + what it represents).
- `@returns` describing the return value and its type.
- `@throws` for every exception that can propagate to the caller.
- An `@example` block for non-trivial public APIs.

```ts
/**
 * Computes the checksum of a file.
 *
 * @param filePath - Absolute path to the file to hash.
 * @param algorithm - Hashing algorithm to use (default: `sha256`).
 * @returns A hex-encoded digest string.
 * @throws {Error} If the file cannot be read.
 */
async function hashFile(filePath: string, algorithm = 'sha256'): Promise<string> { … }
```

---

### Classes

Every class must have a JSDoc block describing:

- What the class represents / its responsibility.
- Constructor parameters documented with `@param`.
- Notable lifecycle concerns (e.g. "call `.destroy()` when done").

---

### Interfaces & Types

Every exported `interface` and `type` (this repo uses no `enum`s — see below)
must have a JSDoc block
summarising its purpose, plus an inline comment on **every member** that is not
self-evident from its name alone.

```ts
/** Configuration for the PostgreSQL connection pool. */
interface PgPoolConfig {
  /** Postgres host (default: `localhost`). */
  host: string;
  /** Postgres port (default: `5432`). */
  port: number;
}
```

### No Enums

- Never introduce JavaScript or TypeScript `enum` declarations in this repo.
- Model closed sets with `as const` records plus derived union types instead.
- When validation needs the allowed values, export a values array derived from
  the record (for example `Object.values(MY_RECORD) as readonly MyType[]`).
- If you touch existing enum-based code, convert it to the record + union
  pattern as part of the change unless doing so would be unrelated to the task.

---

### Inline Comments

- Add a comment above (not inline) any logic that is not immediately obvious.
- Use `// ── Section title ──────` dividers to separate logical blocks inside
  long functions.
- Never leave a `TODO` or `FIXME` without an explanation of what needs doing.

---

### Constants & Module-level Variables

Every exported constant and every non-trivial module-level variable must have a
single-line JSDoc comment (`/** … */`) explaining what it holds and where the
value comes from.

---

### Scripts

All scripts in `scripts/` must additionally include:

- A **STEPS EXECUTED** section listing numbered steps in order.
- A **SAFETY GUARDS** section if the script performs destructive operations.

---

## Feature Documentation — Required for Every New Feature

Whenever Copilot implements a **new feature** or makes a **significant change**
to an existing one, it **must** create or update the corresponding documentation
file in `docs/`.

### Rules

1. **New feature → new doc file.**
   Create `docs/<FEATURE-NAME>.md` following the structure below.

2. **Significant change to an existing feature → update its doc file.**
   Locate the relevant file in `docs/` and update every section that is now
   out of date. Do not leave stale information.

3. **Doc files live in `docs/` at the repository root.**
   Filenames must be `SCREAMING-KEBAB-CASE.md` (e.g. `AUTH.md`,
   `QUEUE-ENGINE.md`, `INTEGRITY-CHECKS.md`).

4. **Each doc file must include at minimum:**

   ```markdown
   # Feature Name

   One-paragraph description of what the feature does and why it exists.

   ---

   ## Table of Contents

   (link to every section)

   ## Architecture Overview

   Diagrams or prose describing components and their relationships.

   ## File Structure

   Annotated tree of all files that belong to this feature.

   ## Environment Variables

   Table of every env var the feature reads (if any).

   ## Flow Diagrams / Step-by-Step

   Numbered or ASCII-art sequences for every non-trivial operation.

   ## HTTP API Reference (if applicable)

   Endpoint, method, request shape, response shape, error codes.

   ## Security Notes (if applicable)

   Known attack surfaces and the mitigations in place.

   ## How To Extend

   Developer guide: how to add a new variant, route, worker, etc.
   ```

5. **The checklist below is not complete until the doc file is created/updated.**

---

## Summary Checklist

Before Copilot finalises any generated code, verify:

- [ ] File-level JSDoc present
- [ ] Every function/method has JSDoc with `@param`, `@returns`, `@throws`
- [ ] Every exported type/interface has JSDoc with member comments
- [ ] No JavaScript/TypeScript enums introduced; use `as const` records instead
- [ ] Non-obvious logic has inline explanatory comments
- [ ] Section dividers used in long functions
- [ ] No undocumented magic values (use named constants with JSDoc)
- [ ] `docs/<FEATURE>.md` created or updated to reflect the changes

## Codebase Search (SocratiCode)

This project is indexed with SocratiCode. Always use its MCP tools to explore the codebase
before reading any files directly.

### Workflow

1. **Start most explorations with `codebase_search`.**
   Hybrid semantic + keyword search (vector + BM25, RRF-fused) runs in a single call.
   - Use broad, conceptual queries for orientation: "how is authentication handled",
     "database connection setup", "error handling patterns".
   - Use precise queries for symbol lookups: exact function names, constants, type names.
   - Prefer search results to infer which files to read — do not speculatively open files.
   - **When to use grep instead**: If you already know the exact identifier, error string,
     or regex pattern, grep/ripgrep is faster and more precise — no semantic gap to bridge.
     Use `codebase_search` when you're exploring, asking conceptual questions, or don't
     know which files to look in.

2. **Follow the graph before following imports.**
   Use `codebase_graph_query` to see what a file imports and what depends on it before
   diving into its contents. This prevents unnecessary reading of transitive dependencies.
   - **Before modifying or deleting a file**, check its dependents with `codebase_graph_query`
     to understand the blast radius.
   - **When planning a refactor**, use the graph to identify all affected files before
     making changes.

3. **Use Impact Analysis BEFORE refactoring, renaming, or deleting code.**
   The symbol-level call graph (`codebase_impact`, `codebase_flow`, `codebase_symbol`,
   `codebase_symbols`) goes one step deeper than the file graph: it knows which
   functions and methods call which.
   - `codebase_impact` answers "what breaks if I change X?" (blast radius — every file
     that transitively calls into the target).
   - `codebase_flow` answers "what does this code do?" by tracing forward from an entry
     point. Call with no `entrypoint` to discover candidate entry points (auto-detected
     via orphans, conventional names like `main()`, framework routes, tests).
   - `codebase_symbol` gives a 360° view of one function: definition, callers, callees.
   - `codebase_symbols` lists symbols in a file or searches by name.
   - Always prefer these over reading multiple files when the question is about
     dependencies between functions, not concepts.

4. **Read files only after narrowing down via search.**
   Once search results clearly point to 1–3 files, read only the relevant sections.
   Never read a file just to find out if it's relevant — search first.

5. **Use `codebase_graph_circular` when debugging unexpected behaviour.**
   Circular dependencies cause subtle runtime issues; check for them proactively.
   Also run `codebase_graph_circular` when you notice import-related errors or unexpected
   initialisation order.

6. **Check `codebase_status` if search returns no results.**
   The project may not be indexed yet. Run `codebase_index` if needed, then wait for
   `codebase_status` to confirm completion before searching.

7. **Leverage context artifacts for non-code knowledge.**
   Projects can define a `.socraticodecontextartifacts.json` config to expose database
   schemas, API specs, infrastructure configs, architecture docs, and other project
   knowledge that lives outside source code. These artifacts are auto-indexed alongside
   code during `codebase_index` and `codebase_update`.
   - Run `codebase_context` early to see what artifacts are available.
   - Use `codebase_context_search` to find specific schemas, endpoints, or configs
     before asking about database structure or API contracts.
   - If `codebase_status` shows artifacts are stale, run `codebase_context_index` to
     refresh them.

### When to use each tool

| Goal                                                                   | Tool                                                                        |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Understand what a codebase does / where a feature lives                | `codebase_search` (broad query)                                             |
| Find a specific function, constant, or type                            | `codebase_search` (exact name) or grep if you know already the exact string |
| Find exact error messages, log strings, or regex patterns              | grep / ripgrep                                                              |
| See what a file imports or what depends on it                          | `codebase_graph_query`                                                      |
| Check blast radius before modifying or deleting a file                 | `codebase_impact` (symbol-level) or `codebase_graph_query` (file-level)     |
| **What breaks if I change function X?**                                | `codebase_impact target=X`                                                  |
| **What does this entry point actually do?**                            | `codebase_flow entrypoint=X`                                                |
| **List entry points in this codebase**                                 | `codebase_flow` (no args)                                                   |
| **Who calls this function and what does it call?**                     | `codebase_symbol name=X`                                                    |
| **What functions/classes exist in this file?**                         | `codebase_symbols file=path`                                                |
| **Search for symbols by name across the project**                      | `codebase_symbols query=X`                                                  |
| Spot architectural problems                                            | `codebase_graph_circular`, `codebase_graph_stats`                           |
| Visualise module structure                                             | `codebase_graph_visualize`                                                  |
| Verify index is up to date                                             | `codebase_status`                                                           |
| Discover what project knowledge (schemas, specs, configs) is available | `codebase_context`                                                          |
| Find database tables, API endpoints, infra configs                     | `codebase_context_search`                                                   |

## Code Style

- ALWAYS ALWAYS ALWAYS Be type-Safe.
- DON'T use enums in TypeScript; prefer union types or `as const` objects.
- Use `camelCase` for variables, functions, and methods.
- Use `PascalCase` for classes, interfaces, and types.
- Use `SCREAMING_SNAKE_CASE` for constants and environment variables.
- Always prefer `const` over `let`; never use `var`.
- Never use `any` in TypeScript; prefer precise types or `unknown` if necessary.
- Use async/await for asynchronous code; avoid raw Promises.
- Use template literals instead of string concatenation.
- Always handle errors with try/catch; never let unhandled rejections occur.
- For React components, use function components with hooks; avoid class components.
- Use descriptive names for variables and functions; avoid abbreviations.|
- File names should be `kebab-case` and reflect their contents (e.g. `user-service.ts`, not `utils.ts`).
- For private fields in classes, start the field name with an underscore (e.g. `_cache`).
- Use 2 spaces for indentation; never use tabs.
- If you need to use one statement in an if block, don't add the curly braces. For example:

```ts
if (condition) return value;
```
