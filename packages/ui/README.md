# @aicaa/ui

Semantic design tokens for the Owner web surface. **Tokens only.**

D116 activates this package as a **semantic-token layer** — colour, type scale, spacing,
radius, motion — superseding its previous `Deferred` status in
[ARCHITECTURE.md](../../docs/ARCHITECTURE.md). D116 explicitly does **not** authorize a
general or broad reusable component library.

## What belongs here

Values: colour, typeface, type scale, type rhythm, spacing, borders, radius, motion,
touch targets, content measure.

## What must never be added here

React components, buttons, badges, cards, navigation primitives, hooks, route logic,
authentication logic, Task logic, or any `.tsx` file.
`apps/web/__tests__/p1-4-tokens.test.ts` fails if a component-shaped file appears.

## Consumption

`tokens.css` declares custom properties on `:root`. `apps/web` imports it once, ahead of
`globals.css`, in `apps/web/app/layout.tsx`:

```ts
import '@aicaa/ui/tokens.css';
import './globals.css';
```

There is deliberately **no build step**. The package ships one CSS file, so a compiled
JavaScript output would add tooling without adding capability. It therefore declares no
`build`, `lint`, or `test` script and does not need to be named in the root workspace
scripts; its correctness is asserted from `apps/web`, which is its only consumer.

## Cross-platform reality (D116)

Native clients may inherit **product and presentation rules**, **semantic token values**,
and **contract enums**. They cannot inherit React components, TypeScript formatter
implementations, or browser interaction code. Android parity is achieved by
re-implementing documented rules against these values. No Kotlin or cross-platform
token generation is authorized by D116. `apps/web/__tests__/p1-4-tokens.test.ts` pins
token values and proves every `var(--aicaa-*)` reference in `apps/web` CSS resolves.
