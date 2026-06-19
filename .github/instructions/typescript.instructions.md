---
applyTo: 'src/**/*.ts'
---

# TypeScript Type-Safety Rules

## No `any`

Never use `any` — explicit or implicit — anywhere in application source code.

- `@typescript-eslint/no-explicit-any` is treated as an **error**, not a warning.
- Never cast to `any` as a workaround (`value as any`, `<any>value`). Use a typed narrow helper instead.
- When a third-party function returns `unknown` or a broad union that includes `any` (e.g., MikroORM `Connection.execute`), wrap it in a typed narrow helper at the call site and keep the `any` fully contained there.

```typescript
// BAD
const result: any = await connection.execute(sql, params);
const rows = result as MyRow[];

// GOOD
async function typedQuery<T extends Record<string, unknown>>(
  connection: Connection,
  sql: string,
  params: readonly string[],
): Promise<T[]> {
  const result: unknown = await connection.execute(sql, [...params]);
  if (Array.isArray(result)) return result as T[];
  return [];
}
const rows = await typedQuery<MyRow>(connection, sql, params);
```

## No implicit `any`

`noImplicitAny` is enabled in `tsconfig.json`. All function parameters and return types for public/protected methods must be explicitly typed.

## `unknown` over `any` at system boundaries

When a type is genuinely unknown (e.g., parsed JSON, external webhook payloads, caught errors), use `unknown` and narrow before use:

```typescript
// BAD
function handle(data: any) { ... }

// GOOD
function handle(data: unknown) {
  if (typeof data === 'object' && data !== null && 'id' in data) { ... }
}
```

## Caught errors

Always narrow `error` in catch blocks — never access `.message` or any property directly on `unknown`:

```typescript
// BAD
} catch (error) {
  console.error(error.message);
}

// GOOD
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
}
```

## Type assertions

Only use `as` when you have narrowed the value yourself and the compiler cannot infer it. Document why with an inline comment when it is non-obvious.

## Generics

Prefer explicit generic parameters on utility functions and service methods over wide return types. Avoid `object`, `{}`, or `Record<string, any>` as catch-alls.
