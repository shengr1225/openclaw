# Week 1 Remediation Plan (Error Report 2026-02-21)

## Scope

This plan operationalizes the 2026-02-21 error analysis into a 5-day execution flow.

Targets for Week 1:

- Reduce repeated error classes by 80% (19 -> <=4 per equivalent session volume).
- Eliminate known dependency and wildcard input failures.
- Improve first-error clarity so operators get actionable remediation without log digging.

## KPI / Exit Criteria

- `ModuleNotFoundError: No module named 'google'`: 0 occurrences
- `File not found: *.jpg` / wildcard-like Drive lookup errors: 0 occurrences
- Browser relay "no tab connected" cases return explicit attach guidance: 100%
- Tool parameter failures (`oldText`, exact match misses): reduced by >=50%

## Day-by-day execution

### D1 - Dependency and script entry hardening (P0)

- [x] Update `skills/nano-banana-pro/SKILL.md` to prefer `uv run` usage.
- [x] Add explicit dependency failure guidance in `skills/nano-banana-pro/scripts/generate_image.py`.
- [x] Make `main(argv=None)` compatible with both direct and programmatic invocation.

Acceptance:

- Running script without `google-genai` prints actionable install guidance and exits non-zero.

Rollback:

- Revert only the `nano-banana-pro` skill/script changes if unexpected behavior occurs.

### D2 - Drive input validation and metadata preflight (P0)

- [x] Add wildcard and ID-format validation in `scripts/gog-drive-download-safe.sh`.
- [x] Fail fast with user-readable metadata fetch errors.

Acceptance:

- Inputs like `*.jpg` fail before API call with clear remediation text.
- Invalid Drive IDs fail with format guidance.

Rollback:

- Revert validation blocks if they block valid IDs in real usage, then widen regex with tests.

### D3 - Browser error triage quality (P1)

- [ ] Validate browser relay failure messaging against current `src/browser/client-fetch.ts` behavior.
- [ ] Add/adjust tests for:
  - no-tab-attached relay response
  - timeout response
  - route validation errors

Acceptance:

- Application-level errors are surfaced as primary cause (not generic connectivity wrappers).

Rollback:

- Keep generic wrapper fallback only for transport-level failures.

### D4 - Tool parameter quality gates (P1)

- [ ] Add preflight checks in calling flows for required edit params (for example `oldText`/exact matching guardrails).
- [ ] Add troubleshooting snippets to operator docs for edit fallback behavior.

Acceptance:

- Missing required edit params are blocked with immediate guidance before tool invocation.

Rollback:

- Downgrade strict checks to warnings if false positives are detected.

### D5 - Regression pack and reporting (P1)

- [ ] Add a lightweight regression matrix for the top 6 recurring error signatures.
- [ ] Publish a weekly report template (error type, count, root cause, fix status).

Acceptance:

- One command (or one checklist run) can validate all high-frequency failure classes.

Rollback:

- Keep manual checklist if automation creates instability.

## Operating rules

- Prefer preflight validation over post-failure retries.
- Return concrete remediation commands whenever possible.
- Keep error messages machine-parseable (`error_code`) and human-readable (`hint`).

## Current implementation status

Completed in this pass:

- `skills/nano-banana-pro/SKILL.md`
- `skills/nano-banana-pro/scripts/generate_image.py`
- `scripts/gog-drive-download-safe.sh`

Pending next pass:

- Browser relay error-path verification tests
- Edit-parameter guardrails and fallback messaging
