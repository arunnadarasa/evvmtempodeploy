# evvmtempodeploy

Web app for deploying EVVM (Ethereum Virtual Machine) contracts, registering instances on the Sepolia registry, and managing deployment manifests and signatures.

## Features

- **Deploy** – EVVM stack deployment on Tempo Moderato (chain 42431):
  - Staking → EVVM Core (with CoreHashUtils) → Estimator → Name Service → Treasury → P2P Swap
  - Automatic registration of the EVVM instance on the Ethereum Sepolia registry
- **Registry** – Register deployed EVVMs and track deployment records
- **Signatures** – Workflow for EVVM-related signing using `@evvm/viem-signature-library`
- **Dashboard** – View and manage deployments

## Tech stack

- **Frontend:** React 18, TypeScript, Vite 8
- **UI:** Tailwind CSS, shadcn/ui (Radix), Framer Motion
- **Web3:** wagmi, RainbowKit, viem
- **EVVM:** `@evvm/viem-signature-library` for ABIs and signature utilities

## Prerequisites

- Node.js 18+
- npm or bun

## Getting started

```bash
# Install dependencies
npm install

# Run development server (default: http://localhost:8080)
npm run dev
```

## Scripts

| Command        | Description              |
|----------------|--------------------------|
| `npm run dev`  | Start Vite dev server    |
| `npm run build`| Production build         |
| `npm run build:dev` | Build in development mode |
| `npm run preview`   | Preview production build |
| `npm run lint`     | Run ESLint               |
| `npm run test`     | Run Vitest once          |
| `npm run test:watch` | Run Vitest in watch mode |

## Project structure

- `src/pages/` – Deploy, Signatures, Dashboard, Index
- `src/lib/contracts/` – Deployment logic, bytecodes, registry integration
- `src/hooks/` – `useEVVMDeployment` and deployment state
- `src/components/` – UI components and Web3Provider

## Lovable compatibility

This repo is set up to work with [Lovable](https://lovable.dev) when the project is connected to GitHub:

- **GitHub as source of truth:** Connect this repo in Lovable (Settings → Connectors → GitHub). Lovable syncs from the **default branch (`main`)** only. Push changes to `main` so Lovable loads this frontend.
- **Dev server port:** The app runs on **port 8080** (`vite.config.ts`). Playwright is configured with `baseURL: http://localhost:8080` so Lovable’s browser tests hit the same app.
- **Stack:** React + Vite + TypeScript + Tailwind, with `lovable-tagger` and `lovable-agent-playwright-config` for Lovable’s tooling.

If Lovable was showing a different frontend, ensure the Lovable project is linked to **this** repository and that you’re on `main`. After pushing to `main`, Lovable will sync and preview this codebase.

## License
MIT License

Copyright (c) 2026 Arun Nadarasa
