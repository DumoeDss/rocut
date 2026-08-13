export interface ProjectStore {
	openDatabase(): Promise<IDBDatabase>;
}
