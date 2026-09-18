# RAECS Mission Policy — github-viewer

## Authority

Human approval remains the final authority. Tools provide capability, not authority.

## Autonomy

- L0 READ — inspect only.
- L1 ANALYZE — inspect and derive non-mutating analysis.
- L2 SAFE WRITE — only after an explicit approved task and isolated target.
- L3 TEST — execute approved tests.
- L4 COMMIT — create a commit after verification.
- L5 PR — create a pull request after review.
- L6 DEPLOY — never implied by a lower level; requires its own release gate.

## Invariants

- No secrets in logs or UI.
- No hidden writes.
- No scope expansion.
- No claim without evidence.
- WARN is not PASS.
- BLOCK stops the workflow.
- Existing working behavior must be preserved unless a task explicitly authorizes a change.
- Checkpoints must identify the current task, gate state and repository revision.

## Transaction protocol

PRECHECK → PLAN → ISOLATE → IMPLEMENT → TEST → REVIEW → VERIFY → CHECKPOINT → RELEASE

The current Mission Control implementation stops at inspection/evidence and intentionally does not perform repository writes.
