export function openPrivateFilesystem() {
	return navigator.storage.getDirectory();
}
