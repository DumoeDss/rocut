/**
 * Identities that cross the Host port boundary.
 *
 * Deliberately plain string aliases rather than branded types. A brand would
 * force every Host to cast at the seam — `EditorHost.projectId` is a `string`
 * today and stays one (task 2.2 preserves it verbatim) — and the boundary rule
 * this contract enforces is about *what kind of thing* crosses, not about
 * nominal typing. The aliases exist so a signature says which identity it means.
 */

/** A project as the store knows it. Same value as `EditorHost.projectId`. */
export type ProjectId = string;

/** One editor session. Unique for the lifetime of the process. */
export type SessionId = string;

/**
 * A *logical* worker identity, stable across Hosts.
 *
 * It is not a URL: the URL is a request a Host may rewrite (see
 * `runtime-resources.ts`), so it cannot also serve as the thing that names the
 * worker.
 */
export type WorkerId = string;

/** One acquired resource, unique within its session. */
export type ResourceId = string;
