# TypeScript base configuration

All apps and packages should **extend** the repo root `tsconfig.base.json`.

## Shared defaults (strict)

Root `tsconfig.base.json` enables:

- `strict: true`
- `noUncheckedIndexedAccess: true`
- `noImplicitOverride: true`
- `noFallthroughCasesInSwitch: true`
- `verbatimModuleSyntax: true`
- `module` / `moduleResolution`: `NodeNext`

## Package / Node library example

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "composite": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts"]
}
```

## Next.js app example

Next.js should extend the base, then override module settings for the bundler:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["dom", "dom.iterable", "ES2022"],
    "noEmit": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "preserve",
    "allowJs": false,
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "verbatimModuleSyntax": false,
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["next-env.d.ts", "src/**/*.ts", "src/**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

## Verify base config

From the repo root (after `pnpm install`):

```bash
pnpm typecheck:base
```

This typechecks `tooling/typescript/verify/noop.ts` via `tooling/typescript/tsconfig.json`, which extends the root base config.

Do not put app-specific paths or `include` arrays in `tsconfig.base.json` — keep it compiler-options only.
