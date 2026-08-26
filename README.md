# bus-app

A TypeScript bus app.

## Requirements

- Node.js 20 or newer

## Getting started

```bash
npm install
npm test
npm run build
npm start
```

## Scripts

| Script | What it does |
| --- | --- |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run typecheck` | Type-check without emitting |
| `npm run lint` | Run ESLint |
| `npm test` | Run the test suite once |
| `npm run test:watch` | Run tests in watch mode |
| `npm start` | Run the compiled app |

## CI

Every push and pull request to `main` runs lint, typecheck, tests, and build on
Node 20 and 22 via [GitHub Actions](.github/workflows/ci.yml).
