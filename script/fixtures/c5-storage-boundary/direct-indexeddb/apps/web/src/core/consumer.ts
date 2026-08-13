export function openPrivateDatabase() {
	return indexedDB.open("private-editor-database");
}
