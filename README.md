# OpenCut (Legacy)

This is the original OpenCut codebase. It's archived and no longer maintained.

The rewrite is happening at [opencut-app/opencut](https://github.com/opencut-app/opencut).

## Sponsors

Thanks to [Vercel](https://vercel.com?utm_source=github-opencut&utm_campaign=oss) and [fal.ai](https://fal.ai?utm_source=github-opencut&utm_campaign=oss) for their support of open-source software.

<a href="https://vercel.com/oss">
  <img alt="Vercel OSS Program" src="https://vercel.com/oss/program-badge.svg" />
</a>

<a href="https://fal.ai">
  <img alt="Powered by fal.ai" src="https://img.shields.io/badge/Powered%20by-fal.ai-000000?style=flat&logo=data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTEyIDJMMTMuMDkgOC4yNkwyMCAxMEwxMy4wOSAxNS43NEwxMiAyMkwxMC45MSAxNS43NEw0IDEwTDEwLjkxIDguMjZMMTIgMloiIGZpbGw9IndoaXRlIi8+Cjwvc3ZnPgo=" />
</a>

## Why?

- **Privacy**: Your videos stay on your device
- **Free features**: Most basic CapCut features are now paywalled 
- **Simple**: People want editors that are easy to use - CapCut proved that

## Project Structure

- `apps/web/`: Next.js web application
- `apps/desktop/`: Native desktop app built with GPUI (in progress)
- `rust/`: Platform-agnostic core: GPU compositor, effects, masks, and WASM bindings. We're actively migrating business logic here from TypeScript.
- `docs/`: Architecture and subsystem documentation

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/docs/installation)
- The Rust toolchain, `wasm-pack`, and the `wasm32-unknown-unknown` target — see
  ["WASM development"](#wasm-development) below. **Not optional**: the editor's `opencut-wasm`
  dependency resolves to the artifact built from `rust/`, so the wasm must be built before
  `bun install` can resolve it.
- [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/)

> **Note:** Docker is optional but recommended for running the local database and Redis. If you only want to work on frontend features, you can skip it. The Rust toolchain is **not** in that category — it is required for every build.

### Setup

1. Fork and clone the repository

2. Copy the environment file:

   ```bash
   # Unix/Linux/Mac
   cp apps/web/.env.example apps/web/.env.local

   # Windows PowerShell
   Copy-Item apps/web/.env.example apps/web/.env.local
   ```

3. Start the database and Redis:

   ```bash
   docker compose up -d db redis serverless-redis-http
   ```

4. Build the WASM package — **required, and it must come before `bun install`.** This fork
   consumes the wasm built from `rust/`, not the published npm package, so `opencut-wasm` cannot
   resolve until this has run. See "WASM development" below for the one-off toolchain setup.

   ```bash
   bun run build:wasm
   ```

5. Install dependencies and start the dev server:

   ```bash
   bun install
   bun dev:web
   ```

The application will be available at [http://localhost:3000](http://localhost:3000).

The `.env.example` has sensible defaults that match the Docker Compose config — it should work out of the box.

### Desktop setup

Desktop is opt-in. If you're only working on the web app, skip this entirely.

If you want to get ready for `apps/desktop`, see [`apps/desktop/README.md`](apps/desktop/README.md). It's a two-step setup: Rust toolchain first, then desktop native dependencies.

### WASM development

**Required for every contributor, not only those editing `rust/wasm`.** This fork builds
`opencut-wasm` from its own `rust/` sources: both the root `package.json` and `apps/web/package.json`
declare it as a `file:` dependency on `rust/wasm/pkg`, so `bun install` resolves the specifier to the
build output and there is no published-package path to fall back to. Upstream is archived, so the
registry copy can never gain a function again.

**Prerequisites** — install these once per machine, before anything else:

```bash
# Rust toolchain and wasm-pack
script/setup-rust                        # or script/setup-rust.ps1 on Windows

# the wasm compilation target
rustup target add wasm32-unknown-unknown

# reruns the build on file changes, used by bun dev:wasm
cargo install cargo-watch
```

Point Cargo's build directory somewhere with several GB free. It does not have to sit beside the
checkout, and a shared path keeps additional worktrees warm:

```bash
export CARGO_TARGET_DIR=/path/with/room  # PowerShell: $env:CARGO_TARGET_DIR = "..."
```

1. Build the package from the repo root, **before `bun install`**:

   ```bash
   bun run build:wasm
   ```

   Budget ~15 minutes fully cold. About **4 of those minutes are completely silent**: the Cargo
   workspace includes `apps/desktop` (`gpui`), so cargo resolves the whole workspace before compiling
   only the wasm crate. That silence is not a hang.

2. Install dependencies, which links the build output into `node_modules`:

   ```bash
   bun install
   ```

3. Rebuild on changes while you work:

   ```bash
   bun dev:wasm
   ```

   `dev:wasm` re-installs for you on every rebuild. That is not cosmetic: bun installs a `file:`
   dependency as hard links, and `wasm-opt` replaces `opencut_wasm_bg.wasm` rather than rewriting it
   in place — so that one file's link breaks and the resolved copy silently keeps the previous
   build's pre-`wasm-opt` intermediate while every other file looks current. If you invoke
   `build:wasm` yourself, run `bun install` after it (under a second).

4. Verify that what the build resolves really is your build output:

   ```bash
   bun run check:wasm
   ```

   CI runs the same check straight after `bun install`.

> **If you skip step 1**, `bun install` fails with bun's own
> `opencut-wasm@file:./rust/wasm/pkg failed to resolve`, not a message naming the build command —
> dependency resolution runs before any `preinstall` hook, so this cannot be intercepted from the
> repository. Following the ordering above is what avoids it. A *partial* build is caught, with the
> command named.

### Self-Hosting with Docker

To run everything (including a production build of the app) in Docker:

```bash
docker compose up -d
```

The app will be available at [http://localhost:3100](http://localhost:3100).

## Contributing

We welcome contributions! While we're actively developing and refactoring certain areas, there are plenty of opportunities to contribute effectively.

**🎯 Focus areas:** Timeline functionality, project management, performance, bug fixes, and UI improvements outside the preview panel.

**⚠️ Avoid for now:** Preview panel enhancements (fonts, stickers, effects) and export functionality - we're refactoring these with a new binary rendering approach.

See our [Contributing Guide](.github/CONTRIBUTING.md) for detailed setup instructions, development guidelines, and complete focus area guidance.

**Quick start for contributors:**

- Fork the repo and clone locally
- Follow the setup instructions in CONTRIBUTING.md
- Working on `apps/desktop`? See [`apps/desktop/README.md`](apps/desktop/README.md) for setup
- Create a feature branch and submit a PR

## License

[MIT LICENSE](LICENSE)

---

![Star History Chart](https://api.star-history.com/svg?repos=opencut-app/opencut&type=Date)

