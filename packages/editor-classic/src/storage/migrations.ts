// Declared entry "./storage/migrations" (S05 P3, LEAD ruling 2026-08-15).
//
// The react-free migration surface: everything a consumer needs to walk the
// published storage migration chain — the chain itself, its runner, and the
// current target version — WITHOUT the react-carrying "./storage" barrel
// (whose `use-storage-persistence` hook is a Host-side concern). The forcing
// module named in the ruling's record: the third-party adapter's react-free
// migration conformance — an installed consumer with no react anywhere in its
// tree can still run the published chain.
//
// Closure audit (ruling verification, evidence group 9): this entry reaches
// services/storage/migrations/** (+ runner), services/storage/indexeddb-adapter,
// services/storage/types, src/utils/id, src/wasm -> opencut-wasm, and culori
// (transformer v21-to-v22). No react specifier anywhere in the closure.
export {
	CURRENT_PROJECT_VERSION,
	migrations,
	runStorageMigrations,
	StorageMigration,
} from "../services/storage/migrations";
export type { MigrationProgress } from "../services/storage/migrations";
