import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const contained = (parent, child) => {
	const path = relative(parent, child);
	return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
};

// Resolve existing ancestors too: a junction must not redirect a private build
// back into the shared package or an installed dependency.
function physicalPath(path) {
	const tail = [];
	let parent = resolve(path);
	while (!existsSync(parent)) {
		tail.unshift(basename(parent));
		const next = dirname(parent);
		if (next === parent) throw Error(`Cannot resolve package directory: ${path}`);
		parent = next;
	}
	return join(realpathSync(parent), ...tail);
}

/** Default remains rust/wasm/pkg. Build overrides are private; read-only gates
 * may explicitly pin the shared default when forwarding to child processes. */
export function packageDirectoryArguments(argv, option, root) {
	const remaining = [];
	let requested;
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		if (arg !== option && !arg.startsWith(`${option}=`)) {
			remaining.push(arg);
			continue;
		}
		if (requested !== undefined) throw Error(`${option} must be supplied only once`);
		requested = arg === option ? argv[++index] : arg.slice(option.length + 1);
		if (!requested || !isAbsolute(requested)) {
			throw Error(`${option} requires an absolute private package directory`);
		}
	}
	const shared = join(root, "rust", "wasm", "pkg");
	if (requested === undefined) return { pkgDir: shared, remaining };
	const pkgDir = physicalPath(requested);
	const repo = physicalPath(root), sharedPath = physicalPath(shared);
	if (option === "--out-dir" && (
		contained(pkgDir, repo) || contained(pkgDir, physicalPath(homedir())) ||
		contained(sharedPath, pkgDir) || contained(pkgDir, sharedPath) ||
		pkgDir.split(sep).some((part) => part.toLowerCase() === "node_modules")
	)) {
		throw Error(`${option} must not target a shared package, installation, or broad parent directory`);
	}
	return { pkgDir, remaining };
}

export function packageChildArguments(script, pkgDir, ...args) {
	return [script, "--pkg-dir", pkgDir, ...args];
}

export function isInvokedScript(url) {
	return process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(url);
}
