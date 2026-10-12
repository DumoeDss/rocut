const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/** Selected fixture outputs only; no broad temp path, existing tree or junction. */
function privateWholegraphOutputRoot(root) {
  assert(typeof root === "string" && path.isAbsolute(root), "Explicit absolute private output required");
  const absolute = path.resolve(root);
  const normalized = value => path.resolve(value).toLowerCase();
  const allowedParents = ["C:/tmps", "E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/elftia/elftia/.artifacts"];
  assert(allowedParents.some(parent => normalized(path.dirname(absolute)) === normalized(parent)), "Private output parent is not allowlisted");
  assert(/^electron-wholegraph-png-[a-zA-Z0-9._-]+$/.test(path.basename(absolute)), "Private selected fixture leaf required");
  for (let parent = path.dirname(absolute);;) {
    const stat = fs.lstatSync(parent);
    assert(stat.isDirectory() && !stat.isSymbolicLink(), "Output ancestor must be a real directory");
    assert.equal(normalized(fs.realpathSync.native(parent)), normalized(parent), "Output ancestor redirection rejected");
    const next = path.dirname(parent);
    if (parent === next) break;
    parent = next;
  }
  return absolute;
}
module.exports = { privateWholegraphOutputRoot };
