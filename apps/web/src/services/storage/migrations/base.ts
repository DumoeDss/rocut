import type { MigrationResult, ProjectRecord } from "./transformers/types";

export interface LegacyStorageTarget {
	readonly kind: "database" | "directory";
	readonly name: string;
	readonly projectId: string;
}

export interface StorageMigrationRunArgs {
	projectId: string;
	project: ProjectRecord;
	assertLegacyTarget?(target: LegacyStorageTarget): void;
}

export abstract class StorageMigration {
	abstract from: number;
	abstract to: number;

	abstract run({
		projectId,
		project,
	}: StorageMigrationRunArgs): Promise<MigrationResult<ProjectRecord>>;
}
