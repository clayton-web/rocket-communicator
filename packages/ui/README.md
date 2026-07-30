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

## No-op extraction (P1.4)

Every value was introduced equal to the literal it replaced at commit `34d048e7`, so P1.4
changed no rendered pixel through tokenization. Radius is `0` and motion is `none`
because the shipped interface is square and static — recording the current value is what
makes a future change traceable. `apps/web/__tests__/p1-4-tokens.test.ts` pins each value
and additionally proves that every `var(--aicaa-*)` referenced anywhere in `apps/web` CSS
resolves to a token defined here, so a typo cannot silently drop a declaration.

## Cross-platform reality (D116)

A9 can inherit **product and presentation rules**, **semantic token values**, and
**contract enums**. It cannot inherit React components, TypeScript formatter
implementations, or browser interaction code. Android parity is therefore achieved by
re-implementing documented rules against these values. **No Kotlin or cross-platform
token generation exists or is authorized during P1.**
