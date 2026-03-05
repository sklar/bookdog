# Code Standards

This project uses **Biome** for formatting and linting.

- **Check**: `pnpm lint.check`
- **Auto-fix**: `pnpm lint.write`

---

## Modern JavaScript

- Use arrow functions for callbacks and short functions
- Prefer `for...of` loops over `.forEach()` and indexed `for` loops
- Use optional chaining (`?.`) and nullish coalescing (`??`)
- Prefer template literals over string concatenation
- Use destructuring for object and array assignments
- Use `const` by default, `let` only when reassignment is needed, never `var`

## Async & Promises

- Always `await` promises in async functions
- Use `async/await` over promise chains
- Handle errors with try-catch blocks
- Don't use async functions as Promise executors

## Error Handling

- Throw `Error` objects with descriptive messages, not strings
- Use `try-catch` meaningfully — don't catch just to rethrow
- Prefer early returns over nested conditionals

## Code Organization

- Keep functions focused and under reasonable cognitive complexity
- Extract complex conditions into well-named boolean variables
- Use early returns to reduce nesting
- Prefer simple conditionals over nested ternaries

## Performance

- Avoid spread syntax in accumulators within loops
- Use top-level regex literals instead of creating them in loops
- Prefer specific imports over namespace imports
