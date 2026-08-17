/**
 * The current editor project schema version, alone in a leaf module.
 *
 * `./index` re-exports this so the published surface is unchanged, while
 * wasm-free consumers (the `./transactions` entry's host-seed path, the CLI
 * host) can read the constant without executing the transformer chain's
 * `opencut-wasm` closure — the constraint the package README states as policy
 * truth and S05 documented as a direction-level finding.
 */
export const CURRENT_PROJECT_VERSION = 31;
