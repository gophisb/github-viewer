# Mission Control Verification Model

## Evidence Graph
Mission Control now models verification as a graph rather than a single status:
- Claim → SHA
- SHA → repository files
- Evidence → SHA
- CI evidence → current SHA
- Adversarial review → current SHA and referenced files
- Checkpoint → verified revision

A PASS is only attached to evidence that has a concrete reference. WARN is not promoted to PASS.

## Commit / Diff Inspection
The read-only inspector compares `main...HEAD` through GitHub's compare API and records:
- base/head SHA
- ahead/behind counts
- commit count
- changed files
- additions/deletions

This is inspection evidence, not proof that the code builds or works.

## Adversarial Reviewer
The first deterministic reviewer checks:
1. unexpected files / scope creep
2. sensitive-path changes
3. workflow/policy changes
4. service-worker/privacy changes
5. potential hidden write/deploy paths
6. unusually large change surface
7. absence of current-head CI proof
8. explicit base/head binding

Any BLOCK remains a BLOCK. The reviewer is intentionally conservative and is not a substitute for human review.

## Current boundary
This feature remains read-only. It does not commit, merge, deploy, change permissions, or grant autonomy levels.
