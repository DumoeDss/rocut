# Downstream recovery handoff

## T3 resume gate

T3 `s0304-ui-commit-routing` MUST remain paused until this corrective branch has an independently reviewed, review-clean implementation commit. Before any T3 product-source edit, T3 MUST record the exact reviewed corrective commit hash in its own artifacts and consume that commit as a prerequisite. A pre-review candidate hash is deliberately not blessed by this handoff.

The correction does not relax T3's reviewed architecture. T3 must preserve detached prepare → durable commit → publish, exact donor/engine public equality, one shared engine, opaque overlay, one `ProjectStore.save`, and durable-before-publication. It must not add a generic invoke path, provider-private payload smuggling, adapter inference, or a second legacy save.

## T3 recovery matrix

| Concern                  | Required recovery                                                                                                                                                                                                                                                    |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public projection        | `projection.ts` emits exactly one typed `update-project` operation when `name`, `frameRate`, `canvasWidth`, or `canvasHeight` differs.                                                                                                                               |
| Detached Draft context   | Retain public fps and canvas mutations; do not suppress `fps` or `canvasSize` to force equality.                                                                                                                                                                     |
| Project settings routing | Classify per changed field: public-only routes as a typed transaction; mixed public/private carries exactly one typed public sibling while private state remains only in the explicit staged donor candidate; private-only remains an explicit provider-private gap. |
| FPS ratchets             | Replace untracked legacy mutation with an explicit typed transaction and an explicit history policy after attachment success. Never infer or retime silently.                                                                                                        |
| First-image canvas       | The 1920x1080 → 320x180 public canvas patch belongs to the same forward durable root as asset/clip work. Preserve the established nested `pushHistory: false` ownership: command undo restores tracks but does not reverse the automatic canvas choice.              |

## T3 acceptance matrix

- First-image insertion proves 320x180 equality across engine read, live donor state, persisted record, persistence cache, and reopen after exactly one apply/save/revision/watch/history publication.
- A failed save leaves all those surfaces at 1920x1080 and publishes no history, selection, revision, idempotency, or watcher state.
- Routing identities remain explicit and stable under production minification; audio projection continues normalizing missing `hidden` to `false`.
- Successful transaction publication does not trigger a duplicate legacy save.
- FPS parity is probed under the final-document placement rule. Existing clips/markers on an old-only grid reject unless typed repairs in the same batch leave the complete final document valid.
- Capture normalized before-routing versus after-routing behavior on Vite and Next separately. Then compare Vite versus Next as a second axis; cross-Host equality alone cannot prove behavior preservation.
- Do not modify the parity oracle or pull Surface, Host composition-root, command-routing implementation, Rust, or WASM work into this corrective child.

## T4 acceptance after corrected T2 and T3

T4 `s0304-agent-transaction-evidence` must advertise all twelve operation kinds and execute at least one typed Agent `update-project` patch through the public interface. Evidence must show exactly one revision/save/watch transition, Project equality after reopen, mutation-free same-key canonical replay, and same-key/different-patch `duplicate` rejection. The scenario must not depend on donor inference, a provider-private command, a companion delta, or a generic payload.
