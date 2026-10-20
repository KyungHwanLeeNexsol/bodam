# SPEC-REIMBURSEMENT-001 — progress

## §E.1 Plan-phase Audit-Ready Signal

Plan-phase evidence (manager-spec, 2026-10-14). The audit-ready lines are added by the orchestrator after plan-audit. This SPEC is NOT audit-ready (see "Closing status" below).

- Baseline: HEAD `c1f5d76e6e36d7fc18b3a7fdc6c6d9dbe9d4e5b2` (`git rev-parse HEAD`), design blob `4b4a1587e4361996ec834b5122515051c84cf7e8` (`git rev-parse HEAD:design/design.pen`). `design/design.pen` was not opened during the original authoring (revisions 0-2). Revision 3 read it read-only, see "Design-file read evidence (revision 3)" below. Revision 3 was written on the plan branch at `3b48f310b10281b55da321d42b23978d3dda2827` in a separate worktree; the remote plan branch had no newer commit when revision 3 started (`git rev-list --count --left-right origin/plan/…...plan/…` printed `0 0`). Revision 4 starts from the plan branch commit `fe86087cc845ad9627fdb0c2f746a2b991d233b8` (local and remote equal, `0 0`), worktree `C:/Users/Nexsol/Documents/bodam-wt-reimb`; `design/design.pen` blob is still `4b4a1587…` after revision 4 (the revision-4 auditor re-checked it) and was not opened. Revision 5 (2026-10-15) starts from the plan branch commit `1eeb634ea04c461f82b8dc42dac5af6d278fcca4` in the same worktree (clean, `git rev-list --count --left-right origin/plan/…...HEAD` printed `0 0` against the last-fetched remote ref; no fetch was run by this pass); `git rev-parse HEAD:design/design.pen` printed `4b4a1587e4361996ec834b5122515051c84cf7e8` and `design/design.pen` was not opened or touched.
- SPEC ID format: the Bash regex check `[[ "SPEC-REIMBURSEMENT-ESTIMATOR-001" =~ ^SPEC(-[A-Z][A-Z0-9]*)+-[0-9]{3}$ ]] && echo PASS || echo FAIL` printed `PASS` in the initial authoring run. `ls -la .moai/specs` listed no other SPEC directory at that time. Revision 4 re-ran BOTH patterns on this ID (verbatim): `^SPEC-[A-Z][A-Z0-9]+-[0-9]{3}$` (`.claude/rules/moai/development/spec-frontmatter-schema.md:38`, the schema SSOT) → **FAIL**; `^SPEC(-[A-Z][A-Z0-9]*)+-[0-9]{3}$` (`.claude/agents/moai/manager-spec.md:129`) → **PASS**. The candidate `SPEC-REIMBURSEMENT-001` passes both. `.claude/skills/moai/workflows/plan/spec-assembly.md:83` also uses the strict pattern. `internal/spec/lint.go` (named by the schema as the enforcer) is not in this repository and the `moai` CLI is not installed, so the real lint was NOT run and which pattern it enforces is UNVERIFIED. ID, folder and branch were not changed; see research.md §5 #10 and plan.md §C R-14 for the options. Alternative check run instead of lint: the 12 canonical frontmatter fields plus the optional `tier` are present in `spec.md` (13 keys; `phase` is a release label; `status: draft`); this is a field-presence read, not a lint. [2026-10-15 note: the SPEC ID named in this line is the old ID at that time (당시 ID). The SPEC was renamed to SPEC-REIMBURSEMENT-001, see "ID normalization (2026-10-15)" below.]
- Sources read: `보담_기획설계_v0.2.md` lines 1-673; `.moai/project/product.md` 1-251, `structure.md` 1-165, `tech.md` 1-173, `interview.md` 1-55; `.moai/project/design-requirements.md` 1-113, 150-199, 613-714 (rest by Grep for frame names/IDs only); `quality.yaml` (development_mode `tdd`, coverage 85, per-commit 80); `spec-frontmatter-schema.md`. Revision 3 additionally read 기획서 lines 138-227, 340-410, 476-506, 556-648 and design-requirements 672-714 and the workflow files `.claude/skills/moai/workflows/plan.md` (marker rule) and `.claude/agents/moai/plan-auditor.md` (MP-7). Revision 4 re-read 기획서 lines 1-340, 339-474, 502-556, 556-648 (pass 4 source citations).
- Tier: L — four surfaces (engine, server, kiosk, admin), expected file count well above 15, cross-domain. Artifacts: spec.md, plan.md, acceptance.md, design.md, research.md, plus spec-compact.md and this file.
- Budget (revision 4, script-counted by the orchestrator with an independent script and by plan-auditor): 25 top-level requirements (ENG 5, DATA 5, FLOW 6, API 4, ADM 5; 20 now carry a normative condition table, 194 rows; 5 stay one sentence) and 25 top-level acceptance criteria with **170** lettered sub-criteria (152 at revision 3; revision 4 added 18). Closing milestones: M1 51 (M1.1 3, M1.2 11, M1.3 34, M1.4 3), M2 9, M3 14, M4 18, M5 13, M6 42, M7 20, M8 3 = 170; evidence-only entries 23 (22 distinct). 21 hold codes, 24 DD sections, 22 entities. Tier L ceiling of 25 for top-level items is unchanged; no top-level item was added. **After revision 5 (script-counted, see "Revision 5" below):** 25 REQ / 25 top-level AC with **189** lettered sub-criteria (170 + 19); closing milestones M1 51 (M1.1 3, M1.2 11, M1.3 34, M1.4 3), M2 9, M3 14, M4 29, M5 15, M6 48, M7 20, M8 3 = 189; evidence-only entries 28 (27 distinct); condition-table rows 197 (194 + 3); hold codes, DD sections (24) and entities unchanged. **After revision 6:** 197 sub-criteria (189 + 8); M4 29, M5 21, M6 50, others unchanged; evidence-only entries 29 (28 distinct); condition-table rows 204 (197 + 7). The paragraphs above are the revision-4 and revision-5 records and are kept as written.
- Revision 1 (2026-10-14): applied plan-audit review-1 (D-01..D-22) and the authoring-session user instructions recorded in plan.md §A.5 (single SPEC, Vitest, operating data deferred; label defined in plan.md §A.5: the original replies are not preserved in the repository).
- Revision 2 (2026-10-14): applied plan-audit review-2 (N-01..N-08). Marker timing unified: every marker must be settled before Implementation Kickoff Approval.
- Revision 3 (2026-10-14): applied the external review (9 points). Contract changes (all documents only, nothing implemented):
  1. Per-line payout removed: `LineResult.linePayout` deleted; payout lives in `GroupResult.P` / `P_pooled` and the overall total; `excludedItems[].payout` is the constant 0; shared-limit split is a sequential integer fill in `groupOrder`; per-treatment deduction/derivation is forbidden. Evidence for "no per-line payout needed": 기획서 141-156, 166, 181-188; `K04_Basis_Calculation` treatment-table columns; design-requirements §7 line 702. ACs: AC-002j, AC-004h (edited AC-003f, AC-004g, AC-005a).
  2. Rule-bundle suspension: immutable `RuleBundleVersion` vs append-only `RuleBundleStatusEvent`; suspended bundle never usable even when versions/hashes match (`RULE_BUNDLE_SUSPENDED`); options `ruleBundleStatus` + no-store; affected clinics = current scopes only; recovery = new version + existing scope designation; no platform-operator emergency stop. ACs: AC-008g, AC-011e, AC-011f, AC-011g, AC-025f.
  3. Per-attempt `requestId` (kiosk-local, never sent to the server) with an active-request guard independent of `AbortController`. ACs: AC-016h, AC-016i (edited AC-016c, AC-020b).
  4. Numeric validation contract (new DD-24): ranges, places, and the three different handlings (publish rejection / request rejection / calculation refusal `INVALID_NUMERIC_INPUT` → 500 / group hold `PROFILE_VALUE_INVALID`, `CALC_RANGE_EXCEEDED`). ACs: AC-006h, AC-006i, AC-003g, AC-003h, AC-011h.
  5. Document rules: the "one injury-only / one illness-only line" publish cap removed (REQ-DATA-005 now checks structure only); 7+1+1 is a design example; layout is a presentation concern (proposal: responsive / previous-next list). ACs: AC-007f (rewritten), AC-007h, AC-007i. Original planning sentences that need the owner's update are listed in plan.md §H (the SPEC edits none of them).
  6. `ReturnContext` now restores only the result kind; orientation and large text keep their latest value on return. ACs: AC-014e (rewritten), AC-014h, AC-014i.
  7. The 36 confirmation items were reclassified (plan.md §E.2-§E.7): A 2, B 2, C 19, D 5, E 7, D+E 1; **33 open (literal marker kept) and 3 closed with cited evidence (#9 RECORDED-DECISION, #25 and #28 RESOLVED-FACT)**; 10 open rows have no SPEC default. No row was deleted or renumbered. None of the closed rows is an owner approval of a SPEC proposal. #15 and #36 stay open because design-requirements line 706 says those readings can be changed by the owner.
  8. Hard-coding check narrowed: insurance business values must not be literals in the engine, ordinary implementation constants are allowed; behaviour test (change profile values → results change) is the primary evidence. AC-001c rewritten.
  9. Documents synchronized (spec.md, design.md, acceptance.md, plan.md, research.md, spec-compact.md) by three sequential manager-spec passes; progress.md written by the orchestrator after the audit.
- Revision 4 (2026-10-14): follow-up to the iteration-4 audit and a user review of commit `fe86087`; the user asked for ONE extra supplement-and-re-audit round beyond the usual iteration cap and said not to loop until PASS. Scope: SPEC documents only (no application code, no `main` merge, no `design/design.pen` change, no change of common MoAI workflow documents). Kept as instructed: single SPEC, Vitest, the 11 deferred operating-data items (plan.md §E.1), the 33 open rows. Four sequential manager-spec passes (one writer at a time; each pass verified by the orchestrator with its own script before the next), then one plan-auditor run. Contract changes (documents only, nothing implemented):
  1. Numeric boundary (iteration-4 D7): DD-24 now has the checked-operation table per deduction kind and rounding (rate × amount; the `+5000` rounding addition is a second checked step; `SPLIT_RATE` sums two products then rounds ONCE) and reference boundary values; AC-003h is a case table (TRUNCATE, ROUND_HALF_UP, CAPPED, SPLIT_RATE, "multiplication safe but rounding addition overflows", rate 0 / FIXED, T guard at function level, no clamping). T overflow = calculation refusal `INVALID_NUMERIC_INPUT`; group overflow = group hold `CALC_RANGE_EXCEEDED`. The reference numbers were recomputed with exact BigInt arithmetic by the orchestrator (`bounds.mjs`, pre-brief), by manager-spec (pass 1) and by plan-auditor; all three agree. The orchestrator's first mental estimate of the rate-2000 / ROUND_HALF_UP boundary was wrong (…369 instead of …368/…367) and was replaced by the computed value before the brief was written. Example (S = 9007199254740991): rate 10000 + ROUND_HALF_UP: normal max E = 900719925473, first over E = 900719925474 (product 9007199254740000 is safe, `+ 5000` = 9007199254745000 > S); the same E is normal under TRUNCATE.
  2. Coverage and mapping (D5, D6, D15): the mapping `decision` is the only carrier of per-treatment coverage (group-level `coverage` / `exclusionReason` removed); COVERED needs `groupKey`, EXCLUDED must have none and needs `exclusionReason` + source + approver; an exclusion exists only as a usable mapping (no shortcut, `NEEDS_REVIEW` etc. stay holds); `resolveMapping` defined (candidate scope, per-candidate `isUsable` order with fingerprint last inside it, usable-count 0 / 1 / many, fixed reason priority `MAPPING_UNDER_REREVIEW` > `UNREVIEWED` > `REJECTED` > `INVALID`, order independence and output ordering); DD-03 and DD-04 ambiguity/fingerprint order aligned; `checkProfileStructure` (duplicate/dangling keys, `groupOrder` completeness, allowed pool limit kinds, unsupported limit basis, impact scope; structure defect = profile-wide `PROFILE_INVALID`, pool value defect = member groups only); `isBundleUsable(bundle)` runs first and `isUsable(item, ctx)` never reads bundle status (typed signatures, call order, spy test). New: AC-008h..m, AC-011i.
  3. Milestones (D2): AC-021a split (public rows M4 / new AC-021f admin rows M7), AC-021e split (new AC-021g kiosk document header M6), AC-019c → M6, AC-021d → M7 (whole `src/`), AC-010b → M4 (M1.4 evidence), AC-016f → M7, AC-011e/h/i domain-only (HTTP 400 mapped in AC-021f / AC-025f), AC-011f via domain services + public API, AC-015i via the new catalog `idlePolicy` field (contract gap found: DD-19 had no way for the kiosk to read the idle policy); five sub-step moves inside M1; entry conditions of M3/M4/M5/M7 corrected. Record: plan.md §B.1. 0 mismatches in a 170-row code-surface review.
  4. Readiness (D4): DD-23 now defines four tables (profile cells, treatment mappings, document rules, rule scope + bundle state) and two separate derived conditions per clinic (`calculationReady` per cell, `documentReady`) computed by the same decision functions as `estimate()`; one ready profile never means the clinic is ready; `RULES_UNAVAILABLE` affects `documentReady` only; current state all `NOT_READY`; linked to REQ-DATA-004 and AC-011c, AC-011j..l. A toy model of the written definitions vs the DD-03 order ran 300000 seeded trials with 0 mismatches (self-consistency of the definitions only, not the app).
  5. Documents and session end (D8, D9): `DocumentRule.when` semantics (AND inside a rule, omitted = wildcard, OR across rules, OR flag aggregation over the selected treatments, deterministic tie-break `priority` then `reason` code-point order; UNKNOWN-cause two evaluations and the fixed 9 lines kept; AC-007j..l, AC-019d); "처음으로" inside TimeoutDialog = immediate reset vs ordinary screens = ResetConfirm when any input — marked an UNAPPROVED proposal under open row #36 (AC-015e/g/j/k); `settleRequest` single exit releasing `activeRequest` and clearing the request timer on every outcome (AC-016j). D13 resolved: 400 / 422 layering in DD-19.
  6. Provenance and decisions (D11): every "소유자 결정" attribution that cannot be verified was replaced by the label "작성 세션의 사용자 지시 (원문 응답 미보존)" defined in plan.md §A.5 (the user's revision-4 request keeps the three items); the emergency-stop removal is described with its real source (not in 기획서 §7 6번, removed after plan-audit review 1, no approval record). plan.md §E.8 groups the 33 open rows into six decision bundles with concrete recommendations (no marker or number touched). SPEC-ID regex mismatch recorded (research.md §5 #10, plan.md R-14).
  7. Synchronization: 20 long requirements became "core sentence + condition table" (`조건/내용/상태/정의`, every row normative; `상태` marks `확정 근거` / `SPEC 결정` / `잠정 (§E #n)` / `SPEC 제안 (승인 전, §E #n)`); 199 old clauses were ticked one by one against the new rows by script (0 unticked); `spec-compact.md` regenerated by script (REQ texts identical, 170 letters); HISTORY row added; §D MX plan extended.
- Revision 5 (2026-10-15): ONE documentation round requested by the user after the iteration-5 audit and a further user review (seven items). Documents only; one manager-spec run, one writer; no audit, no lint, no commit by this pass. Details, cross-check result, per-item change log and new proposals: "Revision 5" section below. **Revision 5: no audit run, score not re-measured.**
- Revision 6 (2026-10-15): one more documentation pass requested after the user reviewed `bf8e522`: the contract for re-fetching catalog and options after 409 / 422 `TREATMENT_NOT_PUBLISHED`, specified inside `K03_Treatments` (DD-09 "자료 갱신 생명주기"). See "Revision 6" below. **Revision 6: no audit run, score not re-measured.**
- Clarification markers (counted by script after revision 4): 36 rows in plan.md §E.2-§E.5; **33 open, 3 closed** (§E.2 5 open; §E.3 6 open + 1 closed; §E.4 17 open + 2 closed; §E.5 5 open), identical to HEAD. Literal `NEEDS CLARIFICATION` strings: plan.md 35 (33 rows + 2 prose mentions, equal to HEAD), research.md 0. Open rows with no SPEC default: 10 (#1, #2, #3, #4, #5, #12, #21, #22, #27, #35). All 33 open rows still block Implementation Kickoff Approval under the real workflow (`.claude/skills/moai/workflows/plan.md` lines 53 and 73; plan-auditor MP-7 grep; CLAUDE.md §2 stage ④ and §8). 11 operating-data items are deferred (plan.md §E.1) and carry no marker. **After revision 5 (script, see below):** still 36 rows, 33 open, 3 closed (#9, #25, #28), literal `NEEDS CLARIFICATION` plan.md 35 / research.md 0 (both equal to HEAD), every row's question cell identical to HEAD, §E.8 bundles B1-B6 cover exactly the 33 open numbers once each. Revision 5 touched only the B4 recommendation text of #21 and #36 in §E.8 (cross-references to the new overlay table, stated as not closing them).
- Wording pass (reported by the orchestrator, not performed or re-verified by manager-spec): the final native-idiom wording pass of revisions 0-2 edited 13 lines using the hazard list in `native-idiom-and-register.md`, because the `moai-domain-humanize` skill was unavailable in this repository. Revisions 3 and 4 ran no humanize pass (the skill is still not present); greps for the hazard words (3축, 세 축, 기둥, 검증경제, 예산방어, 회로차단기) found none in the six documents after revision 4.
- Nothing was implemented, built, rendered, or run. Executed: file-text scripts (grep / Node / exact-integer BigInt arithmetic, a Node toy model of the DD-23 definitions) and read-only `git` commands. NOT run, therefore not passed: any unit/integration/e2e test, build, type-check, render, screenshot, real-device check, the `internal/spec` lint, cross-model audit, `moai` CLI commands.
- Tooling limits during revision 4 (all fail-open, recorded so nobody reads them as passes): the `moai` CLI is not installed, so (a) `moai model profile --json` could not resolve per-agent models — every spawn used the agent definition default (`model: inherit`, i.e. the session model), no per-spawn model argument was injected; (b) `moai session list` could not be queried — the pre-spawn check was limited to `git fetch` + `git rev-list --count --left-right` (`0 0` before every spawn) and all work ran in the dedicated plan worktree; (c) `moai harness ledger record` was not run, so the routing ledger has no entry for this request. manager-spec saved one agent-memory note at `.claude/agent-memory/manager-spec/feedback_spec_files_crlf_worktree.md` in the main checkout; that folder is git-ignored and the note is not part of the commit.

### Plan-audit record (orchestrator, 2026-10-14)

This section is the **revision-4 audit record** (iteration 5 audited the revision-4 files). Revision 5 edited the documents afterwards and was NOT audited; the table below is not a result for revision 5. Audit reports live under `.moai/reports/plan-audit/` and are git-ignored, so the outcome is recorded here. The iteration-4 report is `.moai/reports/plan-audit/SPEC-REIMBURSEMENT-ESTIMATOR-001-review-4.md` and the iteration-5 report is `.moai/reports/plan-audit/SPEC-REIMBURSEMENT-ESTIMATOR-001-review-5.md`, both in the worktree `C:/Users/Nexsol/Documents/bodam-wt-reimb`; neither is committed. [2026-10-15 note: these git-ignored audit report file names keep the old ID (당시 ID). The SPEC was renamed to SPEC-REIMBURSEMENT-001, see "ID normalization (2026-10-15)" below.]

| Iteration | Verdict | Score (Tier L threshold 0.85) | Failing must-pass |
|-----------|---------|-------------------------------|-------------------|
| 1 | FAIL | 0.77 | MP-7 |
| 2 | FAIL | 0.86 | MP-7 |
| 3 | FAIL | 0.87 | MP-7 |
| 4 (revision 3, final files) | FAIL | 0.84 (harmonic mean; arithmetic mean 0.85) | MP-7 |
| 5 (revision 4, final files; one extra audit requested by the user) | FAIL | 0.89 (harmonic mean) | MP-7 |
| — (revision 5, 2026-10-15) | **no audit run** | **score not re-measured** | — |
| — (revision 6, 2026-10-15) | **no audit run** | **score not re-measured** | — |

- Iteration 5 category scores: Clarity 0.85, Completeness 0.90, Testability 0.85, Traceability 0.95. MP-1, MP-2, MP-5, MP-6 PASS; MP-3 PASS with a reservation (the schema regex disagrees with `manager-spec.md:129`; lint not run); MP-4 N/A; **MP-7 FAIL (33 open markers, owner-only; the auditor found no marker-writing defect)**.
- Audit mode of iteration 5: Claude-only (no `moai` CLI / MCP server, no second-model opinion, no `internal/spec` lint). Iterations 4 and 5 are past the 3-iteration cap; iteration 5 was run because the user explicitly asked for exactly one more re-audit of the final files. The user also said not to repeat fix/audit loops, so NO revision was made after the audit: the defects below stay open and are reported, not hidden.
- **Revision-4 audit blobs** (the files iteration 5 audited; they were exactly the files in the revision-4 commit, blob ids from `git hash-object`, re-checked after the audit and before that commit). Revision 5 changed spec.md, plan.md, acceptance.md, design.md, research.md and spec-compact.md after this, so these ids no longer identify the working-tree files and the audit result does not apply to them: spec.md `9532f3e00f2a8569ccd644c8aa0710df7a2d798f`, plan.md `16496ed82ac0afb5d72c6880bbbfba7a6829d9fd`, acceptance.md `49c1b72d7b965949093e5c8029db3e29666c9958`, design.md `f936205f9683cd14a5fd81c0aaf15c223b9e630f`, research.md `b370a710c597e6237c7f91ae80fa541e012db1a9`, spec-compact.md `7091bd09f7755c7c768390ac3804448b76cc7e4f`. At revision 4, only this progress.md was edited after the audit (revision 5 later changed more, see above).
- Mechanical results confirmed (orchestrator's own script `verify-final.mjs`, independent of the authoring agents' scripts, and by the auditor): 25 REQ / 25 AC top-level; 170 sub-criteria each closing in exactly one milestone and every sub-criterion token in acceptance.md has a closing milestone; letters contiguous; evidence-only entries point to a later milestone; REQ ↔ AC links consistent both ways; spec.md §4.1 milestone column equals the computed closing set (the M8 gate annotation on REQ-DATA-004 is documented); every spec.md requirement line (core sentence, condition table, 판정 기준) appears verbatim in spec-compact.md; 24 DD sections and all DD references resolve; 33 open + 3 closed rows with original numbers; `git diff --check` clean; no bare LF; no new "소유자 결정" wording in added lines; no hazard words or duration-style time estimates. The auditor additionally spot-checked 14 requirements against `git show HEAD:…spec.md` (no clause dropped or hidden), recomputed the AC-003h / DD-24 table in BigInt, and found no invented owner approval.

Separate statuses (do not read one as another):
- Score threshold met: **yes** (0.89 ≥ 0.85; Claude-only single-auditor score).
- All must-pass items met: **no** — MP-7 only. It is independent of the score and cannot be fixed by revising documents; it is owner-only.
- Technical contract defects: **4 blocking (small) and 10 optional open** (list below). Deliberately not fixed because the user asked for no further automatic fix/audit loop. They are separate from MP-7.
- Owner approval: **none given.** The 33 open rows are presented to the owner at the Implementation Kickoff Approval gate (decision memo: plan.md §E.8). The three kept items (single SPEC, Vitest, 11 deferred operating-data items) are "작성 세션의 사용자 지시" (original replies not preserved) that the user's revision-4 request told to keep.
- Implementation Kickoff Approval: **not requested, not given**; blocked by MP-7 (33 open rows). Implementation may not start.
- Operations ready: **no.** Nothing is implemented; the 11 held operating-data items (plan.md §E.1) are not supplied; the DD-23 readiness tables are all `NOT_READY` by design.
- Not run, therefore not passed: any unit/integration/e2e test, build, type-check, render, screenshot, real-device check, `internal/spec` lint, `moai` CLI, cross-model audit.

Closing status (as of the revision-4 audit): `plan_status: fail` — MP-7 fails (score threshold met). The condition for `pass-with-debt` (score met and ONLY MP-7 failing) did not hold because four small technical defects (R5-D1..R5-D4) were open. **Status after revision 5 (and unchanged after revision 6): `plan_status: fail`.** Revision 5 edited the documents for R5-D1..R5-D4 (and R5-D7, R5-D14 part 2, plus the new R6-1) but ran no audit, so whether those four defects are closed and whether the score still meets 0.85 has NOT been measured; MP-7 (33 open owner-only rows) is untouched. This SPEC is NOT `audit-ready`; the `plan_complete_at` / `audit-ready` signal is intentionally not written.

### Iteration-4 defects D1..D15: result after revision 4

Anchors are in the final files (design.md DD numbers, acceptance.md AC ids, plan.md sections).

| ID | Result | Evidence or reason |
|----|--------|--------------------|
| D1 | Open (owner-only) | 33 `[NEEDS CLARIFICATION` rows in plan.md §E.2-§E.5; cannot be closed by editing. Decisions needed at the kickoff gate; grouped memo with concrete recommendations in plan.md §E.8 |
| D2 | Fixed | plan.md §B closing/evidence lists and §B.1 (reassignment record); acceptance.md AC-010b, 011e, 011f, 011h, 011i, 015i, 016f, 018a, 019c, 021a, 021d, 021e, new 021f, 021g; 170-row code-surface review with 0 mismatches; entry conditions of M3/M4/M5/M7 corrected |
| D3 | Fixed (this file) | counts updated to 170 / 33 / 3; iteration table extended |
| D4 | Fixed | design.md DD-23 (four tables, two derived conditions), spec.md REQ-DATA-004 rows, acceptance.md AC-011c, 011j, 011k, 011l |
| D5 | Fixed | design.md DD-02 (`CoverageGroupDef` without `coverage`), DD-03 "확인된 제외와 줄 상태"; AC-008j, AC-011i |
| D6 | Fixed | design.md DD-03 `resolveMapping`, DD-04; AC-008e, 008h, 008i |
| D7 | Fixed | design.md DD-24 checked-operation table and boundary values; acceptance.md AC-003h case table (BigInt-verified three times) |
| D8 | Fixed as a documented proposal | design.md DD-07, DD-10, DD-13; AC-015e, 015g, 015j, 015k; REQ-FLOW-004. The distinction is an UNAPPROVED proposal under open row #36 |
| D9 | Fixed | design.md DD-06 "규칙 평가"; AC-007j, 007k, 007l |
| D10 | Unchanged | the Pencil read evidence stays in "Design-file read evidence (revision 3)" below; a new read needs the Pencil app and `design.pen` must not be touched in this revision; no decision needed unless an auditor wants a fresh read |
| D11 | Fixed (wording) | unverifiable "소유자 결정" attributions replaced by the label defined in plan.md §A.5; emergency-stop removal described with its real source; no approval record exists and the user's revision-4 request keeps it out of scope |
| D12 | Fixed | REQ condition tables carry a `상태` column (`잠정 (§E #n)` / `SPEC 제안 (승인 전, §E #n)`); 25 of the 33 open rows are cited in condition-table status cells, 4 more (#2, #16, #26, #34) inline in the five requirements that stay one sentence, and #1 #3 #4 #19 are cited by no requirement (they live in plan/DD) |
| D13 | Fixed | design.md DD-19 "요청 검증의 층" and error rows; DD-24 request row; AC-006f, AC-021a. Open edge: R5-D1 below |
| D14 | Not fixed | measurement method for AC-005a / AC-017a / AC-017g depends on the E2E tool chosen before M6 (plan.md §G); pass/fail criteria are stated. Carried as R5-D10 |
| D15 | Fixed | design.md DD-04 (`isBundleUsable` / `isUsable` split, call order), DD-02 structure rules; AC-008l, 008m |

### Iteration-5 findings (not fixed — reported)

Numbered `R5-D…` to avoid mixing with the iteration-4 ids above. Source: `.moai/reports/plan-audit/SPEC-REIMBURSEMENT-ESTIMATOR-001-review-5.md`. [2026-10-15 note: these git-ignored audit report file names keep the old ID (당시 ID). The SPEC was renamed to SPEC-REIMBURSEMENT-001, see "ID normalization (2026-10-15)" below.]

Blocking technical defects (small):

| ID | Severity | What |
|----|----------|------|
| R5-D1 | major | The precedence of 409 `VERSION_MISMATCH` against the 400/422 request layers is undefined (design.md DD-19 layers leave the order with DD-14 open; DD-14's step list has no treatment-publication check; the 409 body carries `treatmentsUnpublished[]` and no AC tests the overlap) |
| R5-D2 | major | spec.md REQ-FLOW-005 C3 says `requestId` is never sent, stored, logged, or put in a URL or analytics event and cites AC-016c / AC-016e, but neither AC asserts it |
| R5-D3 | minor | spec.md REQ-ENG-002 C15 and plan.md M1.3 list the check order as "ratio product → rounding add → SPLIT sum"; DD-24 orders SPLIT as p1, p2, sum, then `+ H` |
| R5-D4 | minor | research.md (§3.1 item 6) still lists "7+1+1" as a settled rule, contradicting DD-06 (a design example, no cap) |

Optional findings: R5-D5 spec.md §3 preamble says the tables "add no new conditions" although revision 4 added normative rows; R5-D6 AC-006c / 008a / 008b close at M1.1 / M1.2 but assert amounts and state composition that plan.md assigns to M1.3; R5-D7 AC-016j says `settleRequest` is called "exactly once per attempt" while DD-09 lets late arrivals enter it and be discarded; R5-D8 (not used by the auditor); R5-D9 REQ-ADM-001/002/003/005 and REQ-API-002 remain long single sentences without a table; R5-D10 measurement and trial-count gaps (AC-005a, AC-001c, AC-003b, AC-017a/f/g; iteration-4 D14); R5-D11 no "proposal / pending owner" label on AC-013c-style criteria; R5-D12 four of 194 table rows cite no AC (ENG-001 C3, ENG-004 C8, API-004 C8 and C11); R5-D13 open row #36 does not tell the owner that 기획서 lines 621 and 627 do not distinguish the TimeoutDialog button; R5-D14 nothing requires the request time limit to be shorter than the 100 s idle warning and DD-07 has no row for a response arriving while an overlay is open; R5-D15 this file was stale (fixed here).

Not verified by the auditor: lint, cross-model audit, `design.pen`, the relayed user instructions (single SPEC, Vitest, 11 deferred items, emergency-stop scope), owner agreement for all 33 rows and all SPEC proposals, any execution.

Suggested next step (a choice for the user, not taken here): (1) one small edit round for R5-D1..R5-D4 (one-sentence edits) followed by NO further audit unless wanted; (2) take the 33 rows to the kickoff gate with plan.md §E.8; (3) run the real SPEC lint where the `moai` CLI exists and decide the SPEC-ID question (plan.md R-14).

### Revision 5 (2026-10-15) — seven items, documents only

**Status: revision 5: no audit run, score not re-measured.** `plan_status: fail` is kept. No audit-ready signal is written. Implementation Kickoff Approval is not requested and not given; the 33 open rows are unchanged and owner-only. The real SPEC lint was NOT run (the `moai` CLI is not installed in this environment: `which moai` printed "no moai in …"), so MP-3 stays "PASS with a reservation": for `SPEC-REIMBURSEMENT-ESTIMATOR-001` the check `^SPEC(-[A-Z][A-Z0-9]*)+-[0-9]{3}$` (manager-spec.md:129) printed PASS and `^SPEC-[A-Z][A-Z0-9]+-[0-9]{3}$` (spec-frontmatter-schema.md:38) printed FAIL when re-run in this pass. That regex disagreement stays listed as open (plan.md §C R-14, research.md §5 #10). Nothing was implemented, built, rendered or run except the file-text script and read-only `git` commands named below. [2026-10-15 note: the SPEC ID named in this line is the old ID at that time (당시 ID). The SPEC was renamed to SPEC-REIMBURSEMENT-001, see "ID normalization (2026-10-15)" below.]

New source labels (defined in plan.md §A.5, spec.md §3 preamble): `사용자 지시 (2026-10-15 개정 5 요청)` for what the user's revision-5 request itself decided; `SPEC 제안 (승인 전)` for gap-filling additions by this pass (no §E row was added, so the 33 open rows and the numbering are untouched). No owner approval was invented.

**Per-item change log**

| Item | What changed | Where |
|------|--------------|-------|
| 1 Error precedence (R5-D1) | One order for DD-14 and DD-19: clinic check → request structure (400) → supported generation / empty treatments (422) → current-version comparison (409) → treatment IDs against the CURRENT catalog (422 `TREATMENT_NOT_PUBLISHED`) → calculation (suspended bundle = 200 `ON_HOLD`). DD-19 "요청 검증의 층" is the canonical statement (layers 0-5, six overlap cases as a table); DD-14 carries the same ordered list and refers to it. Minimal behaviour added and flagged as proposal: `changes.treatmentsUnpublished[]` = requested IDs not in the current catalog, in request order, without duplicates. | design.md DD-14, DD-19 (layer table, error table rows 409/422, POST bullets); acceptance.md AC-006f, AC-019b, AC-020a, AC-021a (clarified), new AC-021h..m, §6 row; plan.md M4 scope; spec.md REQ-API-004 C2 and REQ-API-003 C2 (citations only) |
| 2 Attempt `requestId` (R5-D2) | New ACs assert absence in: request body, headers, URL/query (k); client logs and analytics events (l); browser storage dump (m); server storage, server memory caches/maps, server logs, including a request that deliberately sends a marker (n). Holding it in the in-memory `activeRequest` is stated as allowed and used as a positive control. Test technique at design level: injected marker issuer, fetch/XHR spy, log sink capture, analytics sink capture, storage snapshot before/after, repository and server-memory dump. The admin review-request id is a different identifier: stated in AC-016k, DD-09 and DD-19 (path parameter renamed `{requestId}` → `{reviewRequestId}` in the admin table, with a note). REQ-FLOW-005 C3 now cites AC-016k..n instead of AC-016c/AC-016e. Every `requestId` hit was grepped (design.md DD-07/09/19, acceptance AC-016c/h/i/j, plan §C/§D, spec REQ-FLOW-005); the only conflation risk was the admin path parameter. | acceptance.md new AC-016k..n; design.md DD-09, DD-19; spec.md + spec-compact.md REQ-FLOW-005 C3; plan.md M4/M5/M6, R-06 |
| 3 SPLIT order (R5-D3) | DD-24 already orders SPLIT as `p1 = rateBenefit × G` → `p2 = rateNonBenefit × N` → `s = p1 + p2` → (ROUND_HALF_UP only) `s + H`, with no per-product rounding, exactly as the user stated; DD-24 was NOT edited. REQ-ENG-002 C15, plan.md M1.3 and the spec-compact copy of C15 now say the same order. Other mentions (DD-02 line "두 곱을 더한 뒤 한 번만", AC-003b, AC-003h table) already agreed. | spec.md + spec-compact.md REQ-ENG-002 C15; plan.md M1.3 |
| 4 "7+1+1" (R5-D4) | research.md §3.1 item 6 no longer lists 7+1+1 as a settled rule: it is a design example (the saved design's 9-line example, `K07_Documents_Unknown`); kept: 9 lines in that example, merged receipt/itemised line always required, cause-unknown evaluates two conditions; real counts come from rule evaluation (DD-06), no cap. No other document restates it as a rule (checked by grep: DD-06, AC-007c, spec-compact AC-007 row, plan §H H-1..H-5 all already say "example"). | research.md §3.1 item 6 |
| 5 settleRequest (R5-D7) | Contract rewritten: it may be CALLED several times per attempt (late response, late error, timer); handling, cleanup and result application happen ONCE, at the first valid call; every later call ends at step 1 and changes nothing. AC-016j no longer says "called exactly once"; it asserts the one-time handling plus a before/after state snapshot for repeated calls and for late calls from attempt A after attempt B started (B's timer count/handle, loading state, screen, `activeRequest` unchanged). | design.md DD-09 "요청 생명주기" (intro line, new paragraph, step 1, new bullets); acceptance.md AC-016j; spec.md + spec-compact.md REQ-FLOW-005 C6 (one sentence added) |
| 6 Response while an overlay is open (R5-D14 part 2) | New subsection with rules 1-5 and one 8-row table (2 overlays × 4 outcomes: 200, 409, other errors, request-time-limit expiry; columns: applied underneath / overlay behaviour / what the user sees after closing). Rules 1-4 labelled `사용자 지시 (2026-10-15 개정 5 요청)`; rule 5 (time limit vs 100 s warning) and two additions (open `TimeoutDialog` keeps its reset deadline; after a screen-kind change the elapsed idle time keeps counting and only the thresholds change) labelled `SPEC 제안 (승인 전)`. Pointers added in DD-09, DD-10, DD-13, DD-19. New REQ-FLOW-004 C13 (core sentence extended, table C1~C13). | design.md DD-07 new subsection after the transition table; acceptance.md new AC-015l..p; spec.md + spec-compact.md REQ-FLOW-004; plan.md M5/M6, §E.8 B4 (#21, #36 cross-references only) |
| 7 Per-item rule state and cache contract (R6-1, new) | Content of an item/bundle version is immutable; the item's lifecycle `state` is mutable and is read per request, never cached (the cache key never includes it). Bundle content may be cached; the bundle availability rule of DD-14 is extended to item states. No catalog/bundle version, hash or `ClinicRuleScope` change, so no 409; effects use the existing hold codes (`PROFILE_INVALID`/`PROFILE_UNDER_REREVIEW`, `MAPPING_INVALID`/`MAPPING_UNDER_REREVIEW` with `resolveMapping` deciding, `RULES_UNAVAILABLE` for documents); other bundles containing the item see it too; bundle suspension still leaves item states unchanged. Labelled `SPEC 제안 (승인 전)`. Tests observe it through a read-call spy on the memory repository and the next request's response (AC-011m..p: profile, mapping, document rule set, shared item across bundles + bundle suspension leaves item state). User wording "suspended / needs-review" maps to `SUSPENDED` / `UNDER_REREVIEW`. | design.md DD-14 new subsection "항목 생명주기 상태와 캐시 계약", DD-14 cache-contract sentence, DD-03 note, DD-04 bullet, DD-17 lifecycle bullet; acceptance.md new AC-011m..p; spec.md + spec-compact.md REQ-DATA-002 C11, C12 (core sentence extended, table C1~C12); plan.md M3/M4 |

**New sub-criteria (19)** and closing milestones: AC-011m..p (4) M4; AC-015l..p (5) M6 with M5 evidence; AC-016k, AC-016l (2) M5; AC-016m (1) M6; AC-016n (1) M4; AC-021h..m (6) M4. Per milestone after revision 5: M1 51, M2 9, M3 14, M4 29 (+11), M5 15 (+2), M6 48 (+6), M7 20, M8 3 = 189. Evidence-only entries 23 → 28 (27 distinct). Letters stay contiguous per AC; no existing sub-criterion was renumbered or moved.

**Item 1 cross-check result: no conflict; two scoping clarifications; one new proposal.** Checked against: DD-14 old step list (①-④: no 400/422 layers and no treatment-publication step, so silent, not contradicting); DD-19 "요청 검증의 층" (old text explicitly left the order of layer 3 vs 409 open and said earlier layers win); DD-19 error table; DD-24 request row ("계산 요청 구조": 400 for structure, 422 for generation beyond enumeration); DD-03 engine rejection order (`UNSUPPORTED_GENERATION` → `NO_TREATMENT_SELECTED` → `INVALID_NUMERIC_INPUT`, consistent with layer 2); DD-04 call order (`isBundleUsable` is step 2 inside `estimate()`, i.e. inside layer 5); DD-09/DD-19 kiosk response table (409 and the two 422 rows handled separately, unaffected); REQ-API-002 ("IDs belong to the current catalog, then recalculate": consistent, the version comparison simply comes before the ID check); REQ-API-003 C1/C3 (409 on differing versions; C3 suspended bundle with equal versions = `ON_HOLD`: consistent); REQ-API-004 C2/C6 (code list; 500 for `INVALID_NUMERIC_INPUT` = layer 5); REQ-FLOW-005; AC-006f (all inputs implicitly at current versions), AC-019b, AC-020a, AC-021a, AC-011f (stale-version and suspended-bundle cases agree). Scoping clarifications made in the ACs, not in requirement text: AC-020a is now explicitly for requests that pass layers 0-2; AC-019b is explicitly for current versions. spec.md requirement rows were not given precedence wording because none of them spoke about precedence (REQ-API-003 C1 and REQ-API-004 C2 are silent); only citations to AC-021h..m were added. Assigned responses: (a) invalid `cause` + stale version → 400 `INVALID_REQUEST` without `latest`/`changes`; (b) unsupported generation + stale → 422 `UNSUPPORTED_GENERATION`; (c) empty `treatmentIds` + stale → 422 `NO_TREATMENT_SELECTED`; (d) stale catalog + withdrawn treatment → 409 `VERSION_MISMATCH` with `changes.treatmentsUnpublished` listing it (the array's content is the new proposal, because the old contract did not say how it is computed); (e) latest versions + unpublished or other-clinic treatment ID → 422 `TREATMENT_NOT_PUBLISHED`; (f) latest versions + suspended bundle → 200 `ON_HOLD`, all lines `RULE_BUNDLE_SUSPENDED`, `hospitalPayment` numeric, payout amounts and `documents` null, `versions.ruleBundleStatus = SUSPENDED` (existing contract, DD-14/DD-04); extra: with an unpublished ID added it becomes 422, with a stale version it becomes 409 with `latest.ruleBundleStatus = SUSPENDED`.

**Design proposals introduced (all `SPEC 제안 (승인 전)`, none approved):** (1) `changes.treatmentsUnpublished[]` content (DD-14, AC-021k); (2) item lifecycle state read per request, bundle content cacheable (DD-14, REQ-DATA-002 C11/C12, AC-011m..p); (3) an open `TimeoutDialog` keeps the reset deadline fixed when it opened, and idle thresholds follow the screen kind while elapsed time keeps counting (DD-07 rule 4, AC-015n); (4) relation between the request time limit and the 100 s warning, three cases (DD-07 rule 5, AC-015p). Open rows #21 and #36 are not decided by any of this; their text and numbers are unchanged (only the §E.8 B4 recommendation cells gained a cross-reference, stated as non-closing).

**Result of the iteration-5 findings after revision 5 (documents edited, NOT re-audited):**

| ID | Result | Evidence / honest remainder |
|----|--------|-----------------------------|
| R5-D1 | Fixed in documents (unaudited) | DD-14/DD-19 order, AC-021h..m. Remainder: `treatmentsUnpublished[]` content is a proposal; the real order is untested until M4 |
| R5-D2 | Fixed in documents (unaudited) | AC-016k..n; REQ-FLOW-005 C3 citations now point at ACs that assert absence. Remainder: AC-016m needs a test configuration that swaps the id issuer in the built app |
| R5-D3 | Fixed in documents (unaudited) | REQ-ENG-002 C15, plan.md M1.3, spec-compact copy; DD-24 already matched the user's order and was not edited |
| R5-D4 | Fixed in documents (unaudited) | research.md §3.1 item 6; the owner-side original sentences stay in plan.md §H (unchanged) |
| R5-D7 | Fixed in documents (unaudited) | DD-09, AC-016j, REQ-FLOW-005 C6 |
| R5-D14 | Partially fixed | Overlay-time response relation defined (DD-07 table, AC-015l..p, REQ-FLOW-004 C13) and the time-limit/warning relation stated as a proposal. Remainder: nothing REQUIRES the request time limit to be shorter than the 100 s warning (plan.md §E.8 B4 only recommends 15 s and says it "must be smaller", which is a recommendation, not a requirement); #21 is open and its value is undecided |
| R6-1 (new, from the user's review) | Addressed as a SPEC proposal (unaudited) | DD-14 "항목 생명주기 상태와 캐시 계약", REQ-DATA-002 C11/C12, AC-011m..p. Remainder: not owner-approved; no §E row exists for it; the design leaves the storage shape of the item `state` to the implementation |

**Verification run in this pass** (read-only; scripts live in the scratchpad and are not committed): a Node consistency script (`verify5.mjs`) over the seven files plus `git diff --check`. Result of the last run before this section was written: CRLF intact in all seven files (CR == LF == CRLF count, 0 bare LF); 25 REQ and 25 top-level AC; 189 sub-criteria, each closing in exactly one milestone (0 with zero or two); evidence-only entries all point to a later closing milestone; letters contiguous for every AC; REQ↔AC links consistent both ways; spec.md §4.1 milestone column equals the computed closing set for all 25 REQ; 225 spec.md requirement lines (core sentences, condition rows, 판정 기준) found verbatim in spec-compact.md with 0 missing; 24 DD sections, every DD reference and every quoted DD sub-heading resolves; every AC token in all seven files exists; 36 clarification rows = 33 open + 3 closed (#9, #25, #28), question cells identical to HEAD, literal `NEEDS CLARIFICATION` plan.md 35 and research.md 0 (equal to HEAD), §E.8 B1-B6 cover exactly the 33 open numbers once each; 197 condition rows (194 + 3), 4 without AC citation (ENG-001 C3, ENG-004 C8, API-004 C8, C11: the unchanged R5-D12 finding); among the added diff lines of the seven files (232 at the final run) no time-estimate-like line, no line using the owner-decision attribution phrase that plan.md §A.5 retired, and no hazard-word line; new-AC similarity: only AC-021i~AC-021j (0.64, same template for two different codes, kept separate on purpose), AC-021h~j (0.40), AC-021h~i (0.39), AC-011n~o (0.38) were above 0.35 and none asserts the same thing. Remaining "170" strings are revision-4 history (spec.md HISTORY row 4, plan.md §B.1 "개정 4 시점 170개", the revision-4 records here). `git diff --check` printed nothing (exit 0).

**Gaps (not observed in this pass):** no unit/integration/e2e test, build, type-check, render, screenshot, real-device check, `internal/spec` lint or `moai` CLI command was run; no cross-model audit; no plan-auditor run; `design/design.pen` was not opened (so whether `KXX_Loading_Calculating` carries a "처음으로" button is unverified; DD-07 row 565 already presumes it, and the new overlay table follows that presumption); the DD-07 table was not exercised by any state-machine model; the 409 row of the overlay table deliberately does not decide what is drawn while catalog/options are being re-fetched (existing DD-14/DD-19 gap, kept as is in revision 5 and resolved in revision 6).

### Revision 6 (2026-10-15) — catalog/options refresh contract after 409 / 422 `TREATMENT_NOT_PUBLISHED`, documents only

**Status: revision 6: no audit run, score not re-measured.** `plan_status: fail` is unchanged. No audit-ready signal is written. Implementation Kickoff Approval is not requested and not given. The 33 open rows are unchanged and owner-only (question cells identical to HEAD `bf8e522`, B1-B6 still cover exactly the 33 numbers). The real SPEC lint was NOT run (no `moai` CLI in this environment), so MP-3 stays "PASS with a reservation" and the SPEC-ID regex disagreement (manager-spec.md:129 vs spec-frontmatter-schema.md:38, plan.md §C R-14) stays open. The iteration-5 audit table (FAIL 0.89, MP-7) is untouched and remains the revision-4 audit record. Base: plan branch HEAD `bf8e522` (clean). `design/design.pen` was not opened; no Pencil frame and no new patient input step was added.

Labels used: `사용자 지시 (2026-10-15 개정 6 요청)` for what the revision-6 request itself specified (its six items); `SPEC 제안 (승인 전)` for what this pass added beyond them (no §E row was added). The contract is specified once, in design.md DD-09 "자료 갱신 생명주기"; the other places point to it.

| Request item | Where it landed |
|--------------|-----------------|
| 1 button disabled while refreshing | DD-09 rule 1 (the state machine also refuses a forced calculate event and a `KXX_Error_Network` retry while a refresh is needed); DD-07 transition rows; REQ-API-003 C8, REQ-FLOW-001 C12; AC-020c, AC-020i |
| 2 apply both responses in one step | DD-09 rule 2 (selection keep/remove with the existing notice, new total, held catalog/options and both versions replaced, `refreshState = NONE`, button enabled; never one alone); DD-14 bullet, DD-19 rows, REQ-API-003 C5, C6, C9; AC-020b, AC-020d |
| 3 failure / time-out | DD-09 rule 3 (nothing applied, no calculation, held data kept, button stays disabled, retry runs the refresh first); REQ-API-003 C10; AC-020e |
| 4 refresh identity | DD-09 rule 4 (`refreshId`, distinct from the calculation `requestId` and the admin `{reviewRequestId}`; `settleRefresh` with the first-valid-termination idea; an earlier refresh cannot touch the current one); REQ-API-003 C11; AC-020f, AC-016o |
| 5 reset / input change | DD-09 rule 5 (sessionId/inputRevision guard; the three confirmed reset paths also settle the refresh as CANCELLED); DD-08 row; REQ-API-003 C12; AC-020g |
| 6 overlays | DD-07 rule 3 sentence, the 409 and other-error rows updated, new table 2 (refresh success / failure or time-out / still running x ResetConfirm, TimeoutDialog); DD-09 rule 6; REQ-API-003 C13; AC-020h |

What `inputRevision` raises today (observed in DD-08): a confirmed change of generation, insurer type or cause, and adding or removing a treatment; same-value re-selection, page moves, back/next, the large-text toggle and orientation changes do not. A refresh result that removes treatments is a system-side change of the treatment set, so it raises `inputRevision` once, after the guard was evaluated (stated in DD-09 rule 2).

New sub-criteria (8): AC-016o (unit, M5); AC-020c, AC-020d, AC-020e, AC-020f, AC-020g (unit, M5); AC-020h (unit + e2e-app, M6, evidence at M5); AC-020i (e2e-app, M6). AC-020b, AC-013d (4), AC-015l and AC-016j (8) were reworded to match. REQ-API-003 (core sentence, C4-C6 reworded, C8-C13 new, table C1~C13) and REQ-FLOW-001 (core sentence, C12 new, table C1~C12) changed in spec.md and spec-compact.md with verbatim parity; AC-020 now also lists REQ-FLOW-001 (spec.md §4.1 rows for REQ-FLOW-001 and REQ-API-003 updated). Counts after revision 6: 25 REQ / 25 AC / **197** sub-criteria (189 + 8); closing milestones M1 51, M2 9, M3 14, M4 29, **M5 21 (+6)**, **M6 50 (+2)**, M7 20, M8 3 = 197; evidence-only entries 29 (28 distinct); condition-table rows 204 (197 + 7).

**Correction found while cross-checking:** the DD-08 table row for the 409 handling said the idle time restarts ("다시 시작"), which contradicted DD-10 and the rule that a server outcome never restarts the idle timer. The row now reads "그대로" and covers the refresh application after 409/422. The request cited "REQ-API-004 C4" for the refetch rule; that row is REQ-API-003 C4 in spec.md, which is what was changed.

**Proposals introduced in revision 6 (all `SPEC 제안 (승인 전)`, none approved, no §E row):** (1) refresh failure is shown inline in `K03_Treatments` (draft one-line notice plus an inline retry) and `KXX_Error_Network` stays reserved for calculation-request failures; (2) `refreshId` is in-memory only, is not sent in the two GETs and is not stored, logged or put in URLs or analytics events; (3) during a refresh the treatment cards and "이전" are locked, and an input change that bypasses the lock cancels the refresh and leaves the "failed, retry" state with nothing applied; (4) one timer covers both fetches and, by default, has the same time limit as the calculation request (§E #21 stays open, the value is injected in tests); (5) the `idlePolicy` inside the catalog response changes in the same single step while the elapsed idle time keeps counting. Open rows #21 and #36 are not decided by any of this.

**Verification run in this pass** (read-only; the script is in the scratchpad and not committed): the same consistency script `verify5.mjs` with the new ACs added to its list. Result of the last run before this section was written: CRLF intact in all seven files; 25 REQ, 25 AC, 197 sub-criteria each closing in exactly one milestone; 29 evidence entries (28 distinct) all pointing to a later closing milestone; letters contiguous; REQ↔AC links consistent both ways; the §4.1 milestone column equal to the computed set for all 25 REQ; 232 spec.md requirement lines found verbatim in spec-compact.md, 0 missing; 24 DD sections, every DD reference and quoted DD heading (including the new "자료 갱신 생명주기") resolves; 36 rows = 33 open + 3 closed with question cells identical to HEAD, literal `NEEDS CLARIFICATION` plan.md 35 and research.md 0, B1-B6 covering the 33 open numbers once each; 204 condition rows, 4 without AC citation (the unchanged R5-D12 finding); no time-estimate-like text, retired owner-attribution phrase or hazard word among the added lines; the similarity pairs above 0.35 are the same four as in revision 5 (none involves a revision-6 criterion). `git diff --check` printed nothing.

**Gaps (not observed in this pass):** no unit, integration, e2e, build, type-check, render, real-device check, lint, `moai` command or audit was run; `design.pen` was not opened, so whether the `K03_Treatments` frames can host an inline progress line, an inline notice and an inline retry without a design change is unverified (the request said no new frame; the SPEC only states that none is requested); the refresh state machine and DD-07 table 2 were not exercised by any model; the notice wording is a draft; locking "이전" during a refresh is a usability trade-off bounded by the time limit (value open, §E #21) that nobody has reviewed.

### ID normalization (2026-10-15) — SPEC-REIMBURSEMENT-ESTIMATOR-001 -> SPEC-REIMBURSEMENT-001

**Status: documents only; no audit run, score not re-measured.** `plan_status: fail` and the iteration-5 audit table (FAIL 0.89, MP-7) are unchanged by this entry and by the rename; the rename is not an audit result. No run-phase evidence exists yet.

- **Approval and reason.** The user approved normalizing the SPEC ID (instead of widening the shared MoAI schema) in the 2026-10-15 implementation-start answer. Reason on record: plan.md §C R-14 and research.md §5 #10 — the schema SSOT regex `^SPEC-[A-Z][A-Z0-9]+-[0-9]{3}$` (`.claude/rules/moai/development/spec-frontmatter-schema.md:38`) rejects the old ID, while the new ID passes both regexes.
- **Mapping.** Old `SPEC-REIMBURSEMENT-ESTIMATOR-001` -> new `SPEC-REIMBURSEMENT-001`. Folder `.moai/specs/SPEC-REIMBURSEMENT-ESTIMATOR-001/` -> `.moai/specs/SPEC-REIMBURSEMENT-001/` (`git mv`, all seven files). The existing plan branch `plan/SPEC-REIMBURSEMENT-ESTIMATOR-001` keeps its name as history; the M1 implementation branch is `feature/SPEC-REIMBURSEMENT-001-m1-engine`.
- **Renamed (current references):** `id` in spec.md frontmatter; the H1 title of all seven SPEC files; the folder path. plan.md §C R-14 and research.md §5 #10 were updated to "resolved by ID normalization" and a mapping note was added at the top of plan.md.
- **Kept verbatim (historical facts):** the audit-record and revision-history lines of this file that name the old ID (including the file names of the git-ignored audit reports `...-review-4.md` / `...-review-5.md`, which still carry the old ID), the regex-check evidence that was run on the old ID, and the old branch name. Each such line carries a note that the ID in it is the old ID. Three project documents and the planning document that mention the old ID as a working name were kept and annotated: `.moai/project/design-requirements.md`, `.moai/project/product.md`, `.moai/project/structure.md`, `보담_기획설계_v0.2.md`.
- **Regex re-run in this pass (bash `[[ ... =~ ... ]]`, verbatim output):**
  - new ID `SPEC-REIMBURSEMENT-001`, schema pattern `^SPEC-[A-Z][A-Z0-9]+-[0-9]{3}$` (spec-frontmatter-schema.md:38) -> `schema-strict new: PASS`
  - new ID `SPEC-REIMBURSEMENT-001`, manager-spec pattern `^SPEC(-[A-Z][A-Z0-9]*)+-[0-9]{3}$` (manager-spec.md:129) -> `manager-spec new: PASS`
  - old ID, schema pattern -> `schema-strict old: FAIL`; old ID, manager-spec pattern -> `manager-spec old: PASS` (same as the revision-4 and revision-5 records)
- **Alternative check, not a lint.** Field-presence read of spec.md frontmatter keys: `id title version status created updated author priority phase module lifecycle tags tier` (12 canonical fields plus optional `tier`; `status: draft`, `phase: "v0.1.0 target"` unchanged).
- **Gaps.** The `moai` CLI is not installed and the moai MCP server is down, so the real SPEC lint was NOT run: whether it accepts the new ID is UNVERIFIED (the two documents' regexes both accept it; which one the lint enforces is still unconfirmed). No audit, test, build or render was run. The spec.md HISTORY table has no row for the rename (the mapping lives in plan.md and here).

### Implementation Kickoff Approval — M1 only (M1-limited exception), 2026-10-15

**Status: documents only; no audit run, score not re-measured.** The user's 2026-10-15 implementation-start answer is recorded in plan.md §E.9. This entry only points to it.

- **Approval.** The answer functions as the Implementation Kickoff Approval for **M1 only**. The user explicitly approved a project-specific M1-limited development exception to the rule that every open clarification row must be resolved before Implementation Kickoff Approval. The exception does NOT mean the SPEC passed a full audit and does NOT mean production readiness.
- **Approved scope.** (1) Decision-record cleanup, (2) the M1 calculation-engine implementation. NOT approved: M2 onward, production deployment, registering real insurance values, merging into main. Later stages must not start before their own deferred items are decided (plan.md §E.9 (c)).
- **Unchanged by this entry.** `plan_status: fail` and the last audit (iteration 5, FAIL 0.89, MP-7) are untouched; `status: draft` is untouched; the 33 open rows in plan.md §E.2~§E.5 and their counts are untouched. The §E.9 record layers on top of them and relabels nothing as PASS.
- **Deferred, still open as decision targets** (details and timing in plan.md §E.9 (c)): #1 actual DB product (before the M3 DB adapter), #2 auth provider and login/2FA method (before M7), #3 hosting and #5 real device (before M8 pilot / real-device validation), #30 and #34 (before their domain/permission implementation), #31 (before the M3 lifecycle implementation), #32 operating entity and hours and #35 (before M6), S15 (truncated answer, not a blanket approval), and the 11 operating-data holds of plan.md §E.1 (M1 is verified with `TEST_FIXTURE` data only).
- **Corrected item.** #8 was accepted with corrected wording (common base cost is in the expected hospital payment regardless of coverage; the payout side uses the same mapping decision as treatments; no or unusable mapping keeps the existing hold contract). Possible wording conflicts in other documents are listed in plan.md §E.9 "확인 필요" and were not edited.
- **S1-S15 codes.** No definition of these codes exists in the repository (searched `.moai/` and all `*.md`); plan.md §E.9 keeps only the user's own descriptors and marks the rest "정의 위치 미확인".
- **Verification note.** The formal SPEC lint is unavailable (no `moai` CLI, moai MCP server down), so lint stays UNVERIFIED. Fallback checks are regex, required-field and reference-substitution checks, which are not a lint. The absence of the lint tool does not stop the M1 work. No further full SPEC rewrite and no repeated automatic audits.
- **Run-phase evidence.** None yet. The §E.2 section below stays a placeholder; manager-develop owns it.

### 범위 밖 개선 목록 (이번 개정에서 하지 않음)

The remaining optional findings and observations below were NOT fixed, to keep this revision inside the seven requested items:

- R5-D5: spec.md §3 preamble still says the condition tables "add no new conditions" although tables carry normative rows; revision 5 adds three more rows (REQ-FLOW-004 C13, REQ-DATA-002 C11/C12) and extended the two core sentences so the rows stay decompositions of them, but the preamble sentence itself is unchanged.
- R5-D6: AC-006c / AC-008a / AC-008b close at M1.1 / M1.2 but assert amounts and state composition that plan.md assigns to M1.3.
- R5-D8: not used by the auditor.
- R5-D9: REQ-ADM-001/002/003/005 and REQ-API-002 remain long single sentences without a condition table.
- R5-D10 (= iteration-4 D14): measurement and trial-count gaps for AC-005a, AC-001c, AC-003b, AC-017a/f/g depend on the E2E tool chosen before M6 (plan.md §G).
- R5-D11: no "proposal / pending owner" label on AC-013c-style criteria.
- R5-D12: four condition rows still cite no AC (ENG-001 C3, ENG-004 C8, API-004 C8, API-004 C11); re-confirmed by the script.
- R5-D13: open row #36 still does not tell the owner that 기획서 lines 621 and 627 do not distinguish the TimeoutDialog button.
- R5-D15: this file was stale; the revision-5 section and the notes above bring it up to date, but the older revision-4 paragraphs keep their original counts as history.
- New observations, not fixed: (a) plan.md §E.8 B4 "대안과 차이" says #21 "must be smaller" than the 100 s warning while DD-07 rule 5 says no requirement demands it; wording differs, meaning is consistent (a recommendation); (b) DD-07's overlay table rests on a "처음으로" button existing on `Calculating` (unverified, see Gaps); (c) the 409 re-fetch display state was undefined (existing gap; resolved by revision 6, DD-09 "자료 갱신 생명주기"); (d) `AC-016m` and `AC-016k` rely on a test configuration that injects the marker issuer into the built app; (e) the admin API table is still a proposal ("관리자 API (제안)"), so renaming its path parameter only avoids a naming clash; (f) the SPEC-ID regex disagreement (R-14) and the unrun lint remain open.

### Design-file read evidence (revision 3)

- File: `design/design.pen`, blob `4b4a1587e4361996ec834b5122515051c84cf7e8` (same at `c1f5d76` and at the plan branch HEAD `3b48f31`). Read on 2026-10-14 through the Pencil MCP tools on a COPY placed in the session scratchpad (SHA-256 of the copy equal to the original: `E0C96C1CBC559FB5E548912EC9958A95686F75F12BFA2566ECA5D5AD770E1F3D`). Only read calls (`Get`, `Print`) were issued; no edit, no screenshot, no export. After the reads, `git hash-object` on the original again printed `4b4a1587…` and `git status` showed no change to it. This is a file-level check of node trees and texts, not a rendering check.
- Frames (name = id): `L_K01_Generation` = `xeW3n` (1920×1080); `K01_Generation_Empty` = `Z3izyJ`; `K01_Generation_Selected` = `lYlRt`; `K00_Start` = `u5CZTt`; `K01_Generation_Unknown` = `p1nNbK`; `K02_Type_Empty` = `ghhVb`; `K02_Type_Selected` = `eDRoY`; `K02b_Cause_Empty` = `QfXL0`; `K02b_Cause_Selected` = `FFtQN`; `L_K02b_Cause` = `CpUd6`; `K04_Result` = `TJoQ2`; `L_K04_Result` = `n3WXk`; `K04_Result_NotCovered` = `XxmHQ`; `K04_Basis_Calculation` = `GhMYi`; `K07_Documents` = `F19r1B`; `K07_Documents_Unknown` = `J6jAj`; `L_K07_Documents` = `CL4xk`; `L_K07_Documents_Unknown` = `mZDkv`; `K06_Complete` = `ilzkX`; `KXX_Error_Network` = `bWvFJ`; `K04_Result_Dialog_Timeout` = `YcF5k`; `K03_Treatments_Dialog_Reset` = `r4N0OQ`; `A01_Admin_HospitalSettings` = `HHJq7`; `A02_Admin_TreatmentList` = `RM9ZF`; `A03_Admin_TreatmentEdit` = `ECPf6`; `A04_Admin_PublishPreview` = `TMXlM`; `KXX_Loading_Calculating` = `BfNvc`; `ZZ_HandoffSpec` = `cvUDQ`; component `KioskHeader` = `nacd2`; component `HelpPanel` = `PxiwY`.
- Instances, not frames: `JNcEQ` = ref `PxiwY` named "HelpPanel", inside `UP40d` ("Question Column") inside `o0biU` ("Body") inside `xeW3n`; `LMKmS` = HelpPanel instance inside `uNYrL` ("Body") inside `Z3izyJ`; `gQtVy` = HelpPanel instance inside `He1I1` ("Body") inside `lYlRt`; `reynT` = "Assumption Panel" instance of `PxiwY` inside `TYBQa` inside `XxmHQ`; `f3IUJ` = "Assumption Panel" instance of `PxiwY` inside `cBpEs` inside `GhMYi`. `MzQqc` = the "Help Body" text node of component `PxiwY`; its component default text is "가입 시기가 경계에 있거나 전환·재가입 계약은 담보 확인이 필요합니다." and each of the five instances above overrides it ("보험증권이나 보험사 앱에서 가입일을 확인해 주세요.\n확인이 어려우면 1544-8069로 문의해 주세요." in `LMKmS`, `gQtVy`, `JNcEQ`; the 보장 제외 sentence in `reynT`; the "표준값" sentence in `f3IUJ`). A text search over the whole document for 경계 / 전환 / 재가입 found the phrase only in that component default.
- Large-text toggle: frame `P3xKHF` ("Large Text Toggle") inside `KioskHeader` `nacd2`; its label text is `MkKly` = "큰 글자 보기".
- Start button: `K00_Start` contains `OdYLw` = instance "Start Button" of `Button_Primary` `s8D6J`, overriding `z2xgo` content "시작하기" (font size 44).
- `K04_Basis_Calculation` texts: `hmlxu` "아래 값은 디자인 예시입니다. 실제 금액은 검토된 계산 엔진의 결과로 대체됩니다."; `o16qMt` "약관 조항 · 개정일 · 공제율 · 지급한도 · 규칙 ID가 표시되는 자리입니다. 구현 단계에서 검토된 규칙 데이터와 연결합니다."; treatment-table column headings 치료 / 구분 / 환자 결제액 / 보장 대상 여부 (no per-treatment insurance payout column); one 공제·한도 적용 block (보장 대상 치료비 합계 124,000원 → 공제 10,000원 → 예상 보험금 114,000원).
- `K04_Result` and `K04_Result_NotCovered` each show exactly three amount cards (예상 병원 결제액 / 예상 보험금 / 보험금 수령 후 예상 본인 부담) and the six actions.
- `K07_Documents_Unknown` rows: common group 영수증·세부내역서, 통원확인서, 판독지, 소견서, 진료확인서, 입퇴원확인서, 조직검사결과지 (7) plus 초진기록지 (상해) and 진단서 (질병) (1 + 1) — a design example whose header reads 예시 기준.
- Hand-off cells: `ZBdWg` "K04_Basis_Calculation → 결과로 돌아가기 → K04_Result"; `QUcQ1` "입력 화면 무입력 100초"; `tNbyp` "K04_Result_Dialog_Timeout → 계속 사용할게요(유휴 재시작) / 처음으로 · 무응답 시 180초에 초기화".
- The Pencil application was started only for this read and was closed afterwards. The only side effect outside the repository is the copy under the session scratchpad.

## §E.2 Run-phase Evidence

### M1.1 — types, validation, numeric helpers (cycle_type = tdd), 2026-10-15

**Attribution.** All results below were observed in this run, on Windows 11, Node v24.19.0, npm 11.6.2, against HEAD `d0607a7` plus the uncommitted M1.1 working tree (the M1.1 commit SHA is reported by the commit itself, not written here). Installed devDependencies, exact: `typescript` 7.0.2, `vitest` 5.0.4, `@vitest/coverage-v8` 5.0.4, `@types/node` 24.19.2 (`package-lock.json` committed). The `moai` CLI and the moai MCP server are unavailable, so no formal SPEC lint and no `moai verify` was run; neither is claimed. Bounded tails of long outputs were redirected to `.moai/state/verify/m1-1/` (a local, gitignored path) and the quoted excerpts below are copied verbatim from those files.

**Spec status.** `spec.md` frontmatter `status: draft -> in-progress` (`updated` was already 2026-10-15). `plan_status`, audit results and all other SPEC text untouched.

**Files (M1.1).** `package.json`, `package-lock.json`, `tsconfig.json`, `vitest.config.ts`, `src/engine/types.ts`, `src/engine/validate.ts`, `src/engine/numeric.ts`, `src/engine/limits.ts`, `tests/engine/validate.test.ts`, `tests/engine/numeric.test.ts`, `tests/engine/types.test.ts`; `.gitignore` gained one line `coverage/` (it was not ignored: `git check-ignore -v coverage/coverage-summary.json` exited 1).

#### RED evidence (verbatim, captured before the implementation existed)

1. numeric, step 1 (`limits`, `isWon`, `isBasisPoints`) — `npx vitest run tests/engine/numeric.test.ts`, exit 1:
```
 FAIL  tests/engine/numeric.test.ts [ tests/engine/numeric.test.ts ]
Error: Cannot find module '../../src/engine/limits' imported from C:/Users/Nexsol/Documents/bodam-wt-m1/tests/engine/numeric.test.ts
 Test Files  1 failed (1)
      Tests  no tests
```
2. numeric, step 2 (`checkedAdd`, `checkedMulBp`, `sumLineAmounts`), exit 1, after step 1 was GREEN:
```
 FAIL  tests/engine/numeric.test.ts > checkedAdd — 정확한 결과가 S 이하일 때만 통과 (DD-24 검사 덧셈) > 경계 쌍: checkedAdd(S − 1, 1) 은 S 로 통과하고 checkedAdd(S, 1) 은 거절한다 (AC-003h 10행, 함수 수준)
TypeError: checkedAdd is not a function
 Test Files  1 failed (1)
      Tests  40 failed | 47 passed (87)
```
3. types (`tests/engine/types.test.ts`) — `npx vitest run`, exit 1, and `npx tsc --noEmit`, exit 1:
```
Error: Cannot find module '../../src/engine/types' imported from C:/Users/Nexsol/Documents/bodam-wt-m1/tests/engine/types.test.ts
tests/engine/types.test.ts(7,8): error TS2307: Cannot find module '../../src/engine/types' or its corresponding type declarations.
tests/engine/types.test.ts(13,8): error TS2307: Cannot find module '../../src/engine/types' or its corresponding type declarations.
tests/engine/types.test.ts(93,5): error TS2578: Unused '@ts-expect-error' directive.
tests/engine/types.test.ts(143,5): error TS2578: Unused '@ts-expect-error' directive.
```
4. validate (`tests/engine/validate.test.ts`), exit 1:
```
 FAIL  tests/engine/validate.test.ts [ tests/engine/validate.test.ts ]
Error: Cannot find module '../../src/engine/validate' imported from C:/Users/Nexsol/Documents/bodam-wt-m1/tests/engine/validate.test.ts
```
5. validate, behaviour added after the first GREEN (an invalid amount on a line that deduplication would drop must still be rejected), exit 1, `Tests  1 failed | 60 passed (61)`:
```
 FAIL  tests/engine/validate.test.ts > validateEstimateInput — 줄 금액 범위 (AC-006h, DD-24) > 중복으로 걸러질 줄의 금액이 무효여도 조용히 버리지 않고 거절한다 (치료 줄·기본비용 줄 모두)
AssertionError: expected { ok: true, value: { …(5) } } to deeply equal { ok: false, rejection: { …(2) } }
```
The first implementation checked amounts after deduplication, so the invalid duplicate was silently dropped; the fix checks the raw arrays first.

#### GREEN evidence

| Step | Command | Exit | Result |
|------|---------|------|--------|
| numeric 1 | `npx vitest run tests/engine/numeric.test.ts` | 0 | `Tests  47 passed (47)` |
| numeric 2 | same | 0 | `Tests  87 passed (87)` |
| types | `npx vitest run tests/engine/types.test.ts` / `npx tsc --noEmit` | 0 / 0 | `Tests  9 passed (9)` / no output |
| validate 1 | `npx vitest run tests/engine/validate.test.ts` | 0 | `Tests  60 passed (60)` |
| validate 2 | same, after the duplicate-invalid fix | 0 | included in the final run below |

Final runs (this tree):
```
$ npx vitest run tests/engine            -> exit 0
 Test Files  3 passed (3)
      Tests  157 passed (157)
$ npx tsc --noEmit                       -> exit 0, empty output (0 bytes)
$ npx vitest run --coverage tests/engine -> exit 0
 Test Files  3 passed (3)
      Tests  157 passed (157)
Coverage summary (v8, include src/engine/**):
Statements   : 100% ( 66/66 )
Branches     : 100% ( 51/51 )
Functions    : 100% ( 14/14 )
Lines        : 100% ( 63/63 )
```
Per-file coverage (from `coverage/coverage-summary.json`; the text reporter collapses fully covered files):

| File | Stmts | Branch | Funcs | Lines |
|------|-------|--------|-------|-------|
| `src/engine/limits.ts` | 100 | 100 | 100 | 100 |
| `src/engine/numeric.ts` | 100 | 100 | 100 | 100 |
| `src/engine/types.ts` | 100 | 100 | 100 | 100 |
| `src/engine/validate.ts` | 100 | 100 | 100 | 100 |

One earlier coverage run showed `validate.ts` at 97.05% lines (uncovered line 47, the `compareCodePoints` branch where the left string is longer); an assertion for that case was added afterwards. The 100% above is the final tree. `types.ts` has little runtime code, so its 100% says little. The M1-end gate (85% over all of `src/engine`) is not evaluated yet.

Coverage `include` check: a temporary unimported file `src/engine/zz-probe.ts` appeared in the coverage table at 0% (`zz-probe.ts | 0 | 0 | 0 | 0 | 3-6`, overall dropped to 95.65%). It was deleted afterwards, so unimported files do count (`coverage.all` no longer exists in vitest 5; `coverage.include` does the job).

#### AC matrix (M1.1 scope)

| AC | M1.1 status | Proving test (file : describe > name) | Notes |
|----|-------------|----------------------------------------|-------|
| AC-006b | CLOSED | `validate.test.ts` : "치료 0개 (AC-006b)" > "treatmentIds 가 빈 배열이면 NO_TREATMENT_SELECTED 로 거절하고 0원 결과가 없다" | rejection result carries no `value` key |
| AC-006c | CLOSED at validation level | `validate.test.ts` : "중복 제거 (AC-006c)" > "같은 치료 ID 가 중복돼도 한 번만 계산되어 병원 결제액이 124,000 이다" | duplicate IDs/lines collapse and the validated hospital payment T is 124,000. `estimate().amounts.hospitalPayment` itself does not exist until M1.3, so the result-level repeat of this check belongs there |
| AC-006h | CLOSED (see gap 1) | `validate.test.ts` : "줄 금액 범위 (AC-006h, DD-24)", "병원 결제액 T 의 검사 합산", "거절 판정 순서"; `numeric.test.ts` : "checkedAdd", "sumLineAmounts" | amount range pair (0 and `MAX_AMOUNT_WON` valid, `MAX_AMOUNT_WON + 1` rejected, using the imported constant); negative, -0, fractional, NaN, +-Infinity, string, null, undefined, bigint, 2^53; T overflow rejected as `INVALID_NUMERIC_INPUT`, not a hold; judgement order UNSUPPORTED_GENERATION, NO_TREATMENT_SELECTED, INVALID_NUMERIC_INPUT |
| AC-006a | EVIDENCE ONLY (rejection part; closes in M1.2) | `validate.test.ts` : "세대 열거 (AC-006a 거절 부분, 증거만; 닫는 곳 M1.2)" | "no 4th-generation profile lookup" cannot be shown until M1.2 has a lookup |
| AC-003h | EVIDENCE ONLY (function-level T pair; closes in M1.3) | `numeric.test.ts` : "checkedAdd(S − 1, 1) passes / checkedAdd(S, 1) rejected", "sumLineAmounts([S−1,1]) passes / ([S,1]) rejected", DD-24 boundary values for `RATE_PRODUCT` (rate 10000 and 2000) and `ROUND_ADD` | also a 200-case fixed-seed BigInt oracle comparison for `checkedMulBp` |
| AC-006d | EVIDENCE ONLY (format level; closes in M1.3) | `types.test.ts` : "형식 수준: estimate() 입력에 치료 원인 인자가 없다" | `satisfies Record<keyof EstimateInput, true>` plus a `@ts-expect-error` on a `cause` field, both checked by `npx tsc --noEmit` (exit 0) |
| AC-002j (format part) | EVIDENCE ONLY (closes in M1.3) | `types.test.ts` : "형식 수준: 줄 단위 지급액 필드가 없다" | `LineResult` keys fixed, no payout field; `GroupResult` has `P` and `P_pooled`; `excludedItems[].payout` is the literal `0` |

`MAX_AMOUNT_WON` invariants asserted in `numeric.test.ts` : "limits": `BigInt(MAX_AMOUNT_WON) * 10000n <= BigInt(Number.MAX_SAFE_INTEGER)`; the largest rate times amount (10000 x 1,000,000,000 = 10^13) and that plus 5000 are safe integers; the value equals 1,000,000,000 (plan.md §E.9 acceptance).

#### Assumptions (non-blocking; each takes the conservative, hold-leaning side)

1. `isBasisPoints(-0)` is false. DD-24 excludes -0 for `Won` but is silent for `BasisPoints` (design.md:1258-1259); -0 is treated as the trace of a rewritten value.
2. `validateEstimateInput` deduplicates `treatmentIds`, `lines` and `baseFeeLines` by treatment ID (first in input order is kept) and returns them sorted by Unicode code point. Every amount in the raw arrays, including lines deduplication would drop, is checked first. Two lines with the same ID but different content are not detected (the catalog guarantees unique IDs). [SUPERSEDED by M1.5 (R1, e6a9658): lines with the same ID and different content are now rejected as `INPUT_INTEGRITY_VIOLATION`; only fully identical duplicates collapse to one]
3. T is summed over the deduplicated `lines` plus `baseFeeLines`, not filtered by `treatmentIds`. A selected ID with no matching line is not rejected here: DD-19 returns 422 `TREATMENT_NOT_PUBLISHED` before the engine runs, and no engine rejection code exists for it.
4. A non-array `treatmentIds` counts as "no treatment selected". No other structural checks are made on `treatmentIds` elements or line objects (TypeScript contract; structure belongs to the M4 request layer).
5. `validate.ts` checks only what DD-03 lists (generation, zero treatments, amounts, T). `insurerType`, `at`, `acceptedOrigins`, `bundle` are not validated; an unknown `insurerType` is for M1.2 to turn into a hold (`PROFILE_ABSENT`).
6. `INVALID_NUMERIC_INPUT` carries a diagnostic `reason` (`LINE_AMOUNT_INVALID` or `HOSPITAL_PAYMENT_OVERFLOW`). It must not reach API responses (AC-006i).
7. `checkedAdd` / `checkedMulBp` / `sumLineAmounts` return `{ok:false, reason: 'OVERFLOW' | 'INVALID_OPERAND', step}`; the step name is an optional argument chosen by the caller (default `null`); `sumLineAmounts` uses `HOSPITAL_PAYMENT_SUM`. Operands may be any non-negative safe integer (sums exceed `MAX_AMOUNT_WON`).
8. `limits.ts` holds `MAX_AMOUNT_WON`, `MAX_BASIS_POINTS` (10000) and `SAFE_INTEGER_MAX` (S). The scale `B = 10000` and `H = 5000` are left to `constants.ts` in M1.3 (design.md:1262 does not say which file holds S).
9. `types.ts` also defines provisional shapes the SPEC never spells out: `PolicySourceRef`, `ApproverRecord`, `RuleItemHeader`, `StandardAssumptionProfile`, `TreatmentCoverageMapping`, `DocumentRuleSet`, `FormulaStep`, `Basis`. Field names beyond design.md:375-379 and :913-917 are placeholders for M1.2/M1.3/M3 to settle.
10. `validateEstimateInput(input, sum = sumLineAmounts)` has a second parameter for a test double of the summation function (acceptance.md AC-003h row 10 permits this).

#### SPEC ambiguities / contradictions met

- design.md:137 comments `treatmentIds` as "after deduplication, 1 or more", while acceptance.md:97 (AC-006c) says duplicated IDs are computed once; resolved by deduplicating inside the engine.
- acceptance.md:97 (AC-006c) ties "124,000" to the hospital payment of the calculation result, which exists only after M1.3; plan.md:69 nevertheless assigns AC-006c to M1.1.
- design.md:1258 vs :1259: `-0` is excluded for `Won` but not mentioned for `BasisPoints` (assumption 1).
- design.md:137-138 and :156 do not say what happens when a selected treatment has no line (assumption 3).
- design.md:375-379 and :913-917 give no field-level shapes for profile, mapping and approver records (assumption 9).

#### Gaps (not observed)

1. The engine-level T overflow was exercised with an injected summation double, not with a real input of 9,007,200 lines (acceptance.md AC-003h row 10 allows this). The real `sumLineAmounts` boundary pair is tested at function level.
2. No formal SPEC lint, no `moai verify`, no linter or formatter (none is configured in the package); only `tsc --noEmit` and Vitest were run.
3. AC-006a "no 4th-generation profile lookup" is not observable before M1.2.
4. Only Windows 11 and one Node version were run. `moduleResolution: "Bundler"` is chosen for compatibility with the later Next.js app but was not exercised with Next.js (M4).
5. `types.ts` is mostly type declarations, so its coverage figure is not informative.

#### Residual risk

- The provisional shapes in `types.ts` (assumption 9) may need renaming when M1.2/M1.3/M3 consume them.
- Silent first-wins deduplication hides conflicting duplicate lines if the catalog ever produced them. [SUPERSEDED by M1.5 (R1, e6a9658): conflicting duplicates are no longer hidden; they are rejected, order-independently]
- TypeScript 7.0.2 and Vitest 5.0.4 were the latest releases at install time; later majors may change `tsconfig` or coverage options.

### M1.2 — usability, resolve, profile structure, estimate front end, fixtures (cycle_type = tdd), 2026-10-15

**Attribution.** All results below were observed in this run, on Windows 11, Node v24.19.0, npm 11.6.2, against HEAD `eb983aa` (the M1.1 commit) plus the uncommitted M1.2 working tree; the M1.2 commit SHA is reported by the commit itself. No new dependency was added (typescript 7.0.2, vitest 5.0.4, @vitest/coverage-v8 5.0.4, @types/node 24.19.2 unchanged). The `moai` CLI and the moai MCP server are unavailable: the formal SPEC lint and `moai verify` were NOT run, and no linter/formatter is configured, so formal lint is UNVERIFIED. Bounded tails of long outputs went to `.moai/state/verify/m1-2/` (local, gitignored); the quoted excerpts are copied verbatim from those files. `spec.md` status is unchanged (`in-progress` since M1.1).

**Files (M1.2).** `src/engine/usability.ts`, `src/engine/profile-structure.ts`, `src/engine/resolve.ts`, `src/engine/estimate.ts` (front end only); `tests/engine/usability.test.ts`, `profile-structure.test.ts`, `mapping-resolve.test.ts`, `hold-matrix.test.ts`, `bundle-gate.test.ts`, `origins.test.ts`; fixtures `tests/fixtures/engine/profiles.fixture.ts`, `mappings.fixture.ts`, `lines.fixture.ts`; one added case in `tests/engine/types.test.ts` (format part of AC-008j). `src/engine/types.ts` is unchanged. No M1.3 file exists (no `constants.ts`, deduction, group-values, limit, rounding, sum). `estimateFront()` returns the pre-arithmetic result `{validated, blocked, profile, lines, hasHold}`; M1.3 attaches the arithmetic and the `EstimateResult` assembly to it.

**Fixture status.** Every fixture value is `TEST_FIXTURE`: group keys `TEST_GROUP_*`, deduction/limit numbers, clause references, verifier names, and the approver `TEST_FIXTURE_APPROVER_NOT_A_REAL_APPROVAL` are made-up test data, not real insurance formulas, deductibles, limits, clauses, prices or approval records. `testDigest` is a non-cryptographic FNV-1a over key-sorted JSON used only because the engine receives its hash function by injection (DD-04).

#### RED evidence (verbatim, captured before the implementation existed; every RED here is a missing-module failure)

1. usability (`npx vitest run tests/engine/usability.test.ts`, exit 1):
```
 FAIL  tests/engine/usability.test.ts [ tests/engine/usability.test.ts ]
Error: Cannot find module '../../src/engine/usability' imported from C:/Users/Nexsol/Documents/bodam-wt-m1/tests/engine/usability.test.ts
```
2. profile-structure, exit 1:
```
 FAIL  tests/engine/profile-structure.test.ts [ tests/engine/profile-structure.test.ts ]
Error: Cannot find module '../../src/engine/profile-structure' imported from C:/Users/Nexsol/Documents/bodam-wt-m1/tests/engine/profile-structure.test.ts
```
3. mapping-resolve (resolveMapping, decideLine), exit 1:
```
 FAIL  tests/engine/mapping-resolve.test.ts [ tests/engine/mapping-resolve.test.ts ]
Error: Cannot find module '../../src/engine/resolve' imported from C:/Users/Nexsol/Documents/bodam-wt-m1/tests/engine/mapping-resolve.test.ts
```
4. estimate front end (`hold-matrix`, `bundle-gate`, `origins`), exit 1:
```
 FAIL  tests/engine/bundle-gate.test.ts [ tests/engine/bundle-gate.test.ts ]
Error: Cannot find module '../../src/engine/estimate' imported from C:/Users/Nexsol/Documents/bodam-wt-m1/tests/engine/bundle-gate.test.ts
 FAIL  tests/engine/hold-matrix.test.ts [ tests/engine/hold-matrix.test.ts ]
 FAIL  tests/engine/origins.test.ts [ tests/engine/origins.test.ts ]
 Test Files  3 failed (3)
      Tests  no tests
```
Mutation checks (temporary edits to `src/`, reverted afterwards; the working-tree results above were re-run after reverting): `usable.length >= 2` changed to `> 2` made 3 tests fail (`Tests  3 failed | 389 passed (392)`); swapping `MAPPING_UNDER_REREVIEW` and `MAPPING_UNREVIEWED` in the priority list made 2 fail (`2 failed | 390 passed`); disabling the approver check made 11 fail (`11 failed | 381 passed`). These are spot checks, not a mutation-testing run.

#### GREEN evidence

| Step | Command | Exit | Result |
|------|---------|------|--------|
| usability | `npx vitest run tests/engine/usability.test.ts` | 0 | `Tests  50 passed (50)` (before three coverage-driven cases were added; 53 afterwards) |
| profile-structure | same file | 0 | `Tests  19 passed (19)` |
| mapping-resolve | same file | 0 | `Tests  56 passed (56)` |
| estimate front end | three files together | 0 | `Test Files  3 passed (3)`, `Tests  105 passed (105)` (before the later added cases) |

Final runs (this tree):
```
$ npx vitest run tests/engine tests/boundary  -> exit 0   (tests/boundary does not exist yet; only tests/engine runs)
 Test Files  9 passed (9)
      Tests  394 passed (394)
$ npx tsc --noEmit                            -> exit 0, empty output (0 bytes)
$ npx vitest run --coverage tests/engine      -> exit 0
 Test Files  9 passed (9)
      Tests  394 passed (394)
Statements   : 100% ( 254/254 )
Branches     : 100% ( 209/209 )
Functions    : 100% ( 56/56 )
Lines        : 100% ( 248/248 )
```
Per file (cumulative `src/engine/**`, from `coverage/coverage-summary.json`; the text reporter collapses fully covered files): `estimate.ts`, `limits.ts`, `numeric.ts`, `profile-structure.ts`, `resolve.ts`, `types.ts`, `usability.ts`, `validate.ts` are each 100 / 100 / 100 / 100 (statements / branches / functions / lines). Earlier in the step the figures were `estimate.ts` 87.5% branches, `resolve.ts` 96.15%, `usability.ts` 96.66%; cases for non-array bundle lists, missing accepted-origin lists, missing validity, a non-object policy source and a non-string date were added, which are defensive branches written for those inputs. Coverage measures execution, not correctness; the M1-end 85% gate is met on the cumulative figure so far (it is re-evaluated after M1.3/M1.4).

#### AC matrix (M1.2 scope; "front level" = through `estimateFront`, before M1.3 arithmetic)

| AC | M1.2 status | Proving test (file : describe) | Notes |
|----|-------------|--------------------------------|-------|
| AC-006a | CLOSED (profile-lookup half; rejection half was M1.1) | `hold-matrix.test.ts` : "입력 검증 거절은 그대로 전달되고 묶음·프로필 조회가 일어나지 않는다" | a generation outside the enum is rejected and `isBundleUsable` (hence profile lookup) is never called |
| AC-008a | CLOSED at front level | `hold-matrix.test.ts` : "AC-008a 프로필 보류 행렬" (every row incl. 9 structure defects tested one by one, two profiles in one cell, bundle SUSPENDED, six policy-source fields one by one) | all lines `ON_HOLD` with the row's code, `hasHold` true, hospital payment still a number (124,000). The "expected payout = null" itself is an `EstimateResult` field that exists only after M1.3 |
| AC-008b | CLOSED at front level | `hold-matrix.test.ts` : "AC-008b 매핑 보류 행렬" (13 unusable states, absent, 2+ usable, group not in profile, EXCLUDED in each unusable state) | only the 신장분사치료 line holds, the other three are `ESTIMATED` |
| AC-008c | CLOSED at front level | `hold-matrix.test.ts` : "AC-008c 분류 확인 필요" | |
| AC-008d | CLOSED | `hold-matrix.test.ts` : "AC-008d 칸 조회" | no other cell's profile is used; an unknown `insurerType` also yields `PROFILE_ABSENT` |
| AC-008f | CLOSED at front level | `bundle-gate.test.ts` : "AC-008f" | `bundle = null` -> `CLINIC_RULE_SCOPE_ABSENT`, zero `isUsable` calls |
| AC-008h | CLOSED | `mapping-resolve.test.ts` : "resolveMapping — 후보 구성 행렬 (AC-008h)" | rows 1-9 incl. 9 unusable variants x both orders, every permutation of 3 usable candidates |
| AC-008i | CLOSED | `mapping-resolve.test.ts` : "고정 우선순위 (AC-008i)" | every pair, triple and the quadruple of the four code classes in all permutations; 12-candidate case with fixed seeds 20261015+n and 777+n; multi-reason candidate resolved by the first failing check |
| AC-008l | CLOSED | `bundle-gate.test.ts` : "AC-008l"; `usability.test.ts` : "형식 수준 시험" | call log for SUSPENDED / null is `['isBundleUsable']` only; ACTIVE call order recorded; throwing accessors on `profiles`/`mappings`/`documentRuleSet` do not fire; type-level checks (`@ts-expect-error`) for `isUsable` / `isBundleUsable` / `UsabilityContext` / `ItemUsabilityReason` |
| AC-009b | CLOSED | `origins.test.ts` : "AC-009b 지문 방어" | a changed line fingerprint -> that line `MAPPING_UNDER_REREVIEW`, others `ESTIMATED` |
| AC-010a | CLOSED | `origins.test.ts` : "AC-010a 운영 허용 출처" | `PROFILE_DEMO` (all lines), `MAPPING_INVALID`, `LINE_ORIGIN_NOT_ACCEPTED` x2; the same data is usable under the test accepted origins |
| AC-008e | EVIDENCE ONLY (closes in M1.3) | `hold-matrix.test.ts` : "AC-008e 판정 순서" | bundle -> profile cell -> profile `isUsable` -> structure -> line origin -> classification -> mapping -> `groupKey` is shown for profile+mapping, structure+mapping, origin+mapping, classification+mapping and mapping+`groupKey`; the group-level `PROFILE_SOURCE_INCOMPLETE` combination needs M1.3 |
| AC-008g | EVIDENCE ONLY (closes in M1.3) | `bundle-gate.test.ts` : "AC-008g" | scope-absent before suspended before profile reasons; "same content ACTIVE bundle computes normally" at front level; payout null / `documents = null` belong to M1.3 / M2 |
| AC-008j | EVIDENCE ONLY (closes in M1.3) | `mapping-resolve.test.ts` (field-rule defense, `decideLine` states, `lookupGroup` call spy, no-shortcut rows); `types.test.ts` (`CoverageGroupDef` keys) | `E` exclusion and `excludedItems[]` assembly are M1.3 |
| AC-008k | EVIDENCE ONLY (closes in M1.3) | `hold-matrix.test.ts` : "배열 순서 독립" | all permutations of `lines` and `profiles` with reversed `mappings`/`treatmentIds`; result serialized identically |
| AC-008m | EVIDENCE ONLY (closes in M1.3) | `profile-structure.test.ts`; `hold-matrix.test.ts` structure rows | pool value defects are intentionally not structure defects (M1.3) |
| AC-004f | EVIDENCE ONLY | `hold-matrix.test.ts` : "공통 기본비용 줄" | front level only: the base-fee amount is in the hospital payment (129,000), and the base-fee line goes through the same mapping decision (`MAPPING_ABSENT` -> hold) |

#### plan.md §E.9 #8 (corrected wording) and the conflict candidates

M1.2 follows the corrected wording: the common base cost is part of the expected hospital payment regardless of coverage (`validateEstimateInput` sums `baseFeeLines` into T before any mapping lookup), and in the payout path the base-fee line goes through the same `decideLine` as a treatment; no / unusable mapping -> the existing hold contract. Checked against the listed candidates: `design.md:155` agrees (included in the payment even if the line is held; "same mapping decision"); `spec.md:146` (C5) and `spec-compact.md:69` agree with the behavior but still label the mapping part "SPEC 제안 (승인 전, §E #8)" although plan.md §E.9 now records #8 as accepted with corrected wording; `plan.md:308` (the §E.2 row for #8) is worded "공통 기본비용도 보장 매핑이 필요하다는 SPEC 결정" with the old default "필요", which can be read as "a mapping is required for the cost to count at all"; `plan.md:400` (§E.8 B3 ③) says computing the base cost "without a mapping" would include an amount whose coverage is undetermined, which only holds for the payout side. `acceptance.md:85` (AC-004f) agrees. No document was edited (SPEC files are out of M1.2's write scope); the stale labels are listed for the owner.

#### Assumptions (non-blocking; each takes the hold-leaning side)

1. Dates are `YYYY-MM-DD` real calendar dates; validity includes both endpoint days; an unparseable `at`/`from`/`to`, a missing validity, or `from > to` is `OUTSIDE_VALIDITY`. The SPEC leaves the format open (design.md:377).
2. Policy sources: at least one, and every source needs all six items non-empty strings (`PolicySourceRef` field names are placeholders). The approver needs non-empty `approverId` and `approvedAt` (placeholder names).
3. A lifecycle `state` outside the nine known values is `STATE_INVALID`; a bundle `status` other than `ACTIVE` is treated as suspended (only `ACTIVE` is usable).
4. An empty fingerprint or content hash is an integrity mismatch even when both sides are equally empty.
5. The profile content-hash target is `profileContent()` = `{id, version, generation, insurerType, groups, groupOrder, sharedLimitPools}` (header fields and `contentHash` excluded). M3's hash writer must hash the same object; the SPEC does not define it.
6. The digest function reaches the engine through `estimateFront(input, { digest })`; `EstimateInput` has no digest field and design.md:365 only says it is injected.
7. `estimateFront` is the pre-arithmetic front end; its return shape (`validated`, `blocked`, `profile`, `lines`, `hasHold`) is mine. It does not build `excludedItems`, `baseFeeIncluded`, `amounts` or `groups`; those stay with M1.3. `decideLine` already yields `EXCLUDED_CONFIRMED` because the hold matrix needs it.
8. Field-rule defense treats any defined `exclusionReason` on a `COVERED` mapping (including `null` or `''`) and any defined `groupKey` on an `EXCLUDED` mapping as a violation -> `MAPPING_INVALID`.
9. Non-array `bundle.profiles`/`bundle.mappings`/`mapping.scope` count as empty; a missing accepted-origin list accepts nothing.
10. Structure check: an empty profile reports only `EMPTY_PROFILE`; duplicate empty group keys are reported as empty keys (not duplicates); non-string group keys count as empty and are left out of the `groupOrder` comparison; a non-array `groupOrder` counts as missing every key. [EXTENDED by M1.6 (b7244eb): a non-object `groups` entry is `GROUP_ENTRY_INVALID`, a non-object pool entry is `POOL_ENTRY_INVALID`, and a non-array `sharedLimitPools` is `POOLS_NOT_ARRAY` (it is no longer treated as an empty list); primitive group entries are no longer reported as `EMPTY_GROUP_KEY`]
11. Treatment lines and base-fee lines are merged and sorted by treatment ID; an ID present in both lists is not collapsed across the lists (the SPEC says the id spaces do not overlap).
12. The call-order evidence spies `isBundleUsable`, `resolveProfile`, `isUsable`, `checkProfileStructure`, `resolveMapping` (through `FrontDeps.functions`). Line-origin and classification checks are inline, so their position is shown by `resolveMapping` not being called for such lines, not by a spy.
13. `tests/boundary` does not exist (M1.4), so `npx vitest run tests/engine tests/boundary` ran only `tests/engine` and exited 0.

#### SPEC ambiguities / contradictions met

- design.md:365 (digest injected) vs `EstimateInput` (design.md:134-143) without a digest field: how the function reaches `estimate()` is unspecified (assumption 6).
- acceptance.md:124/139/155-156 state "expected payout null / documents null" as M1.2 outcomes (plan.md:70), but `EstimateResult` and `deriveDocuments` exist only after M1.3 / M2 (partial, listed above).
- plan.md:70 names `estimate.ts` (front) as an M1.2 file but nothing defines the front's return type (assumption 7).
- design.md:375-379 / :913-917: no field-level shapes for policy sources, approver, validity; design.md:3 notes names may change.
- The base-cost wording conflict candidates listed above (plan.md:308, :400; spec.md:146; spec-compact.md:69).
- acceptance.md:178 "exclusionReason 이 있음" does not say whether `null`/`''` count as present (assumption 8).

#### Gaps (not observed)

1. Every RED in this block is a missing-module failure. Behaviour-level RED was not separately captured, because each test file was written for a whole module before it existed. The three mutation spot checks above are the only evidence that the tests can fail on wrong behaviour.
2. The result-level outcomes "expected payout / out-of-pocket = null" and "documents = null" are not observable before M1.3 / M2; they are shown only as `hasHold` and `blocked`.
3. `testDigest` is not a real hash; the production hash and `profileContent` agreement with M3 are untested.
4. No formal SPEC lint, no `moai verify`, no linter or formatter. `tests/boundary` and the M1.4 determinism / import-boundary suites do not exist yet.
5. Only Windows 11 and Node 24.19.0 were run.

#### Residual risk

- `PolicySourceRef` / `ApproverRecord` / validity shapes may change when M3 defines the entities; the six-item and approver checks would need the same change.
- The assumption that a non-`ACTIVE` bundle status is suspended could hide a future third status value (for example a draft bundle) behind `RULE_BUNDLE_SUSPENDED`.
- First-wins semantics for duplicate lines (from M1.1) still hide conflicting duplicates. [SUPERSEDED by M1.5 (R1, e6a9658): conflicting duplicates are rejected; first-wins now applies only to fully identical duplicates]

### M1.3 — groups, deduction, limits, rounding, result assembly (cycle_type = tdd), 2026-10-15

**Attribution.** All results below were observed in this run, on Windows 11, Node v24.19.0, npm 11.6.2, against HEAD `d64a075` (the M1.2 commit) plus the uncommitted M1.3 working tree; the M1.3 commit SHA is reported by the commit itself. No dependency was added. The `moai` CLI and the moai MCP server are unavailable: the formal SPEC lint and `moai verify` were NOT run and no linter/formatter is configured, so formal lint is UNVERIFIED. Bounded tails of long outputs went to `.moai/state/verify/m1-3/` (local, gitignored); the quoted excerpts are copied verbatim from those files. `spec.md` and every SPEC file other than this progress block are untouched.

**Files (M1.3).** New source: `src/engine/constants.ts` (B = 10000, H = 5000), `rounding.ts`, `deduction.ts`, `limit.ts`, `group-values.ts`, `sum.ts`. Changed source: `src/engine/estimate.ts` (`estimate()` and the result assembly added to the M1.2 front end, which is unchanged), `resolve.ts` (unknown `benefitType` hold), `validate.ts` (no treatment line -> rejection), `types.ts` (`Basis` also carries `policySources`). New tests: `arithmetic-units`, `group-values`, `examples`, `rules`, `pooled-limit`, `pool-structure`, `numeric-groups`, `states`, `mapping-coverage`, `order-independence`, `invariants` (`.test.ts`); one case each added to `validate.test.ts` and `mapping-resolve.test.ts`. Fixtures: `tests/fixtures/engine/cases.fixture.ts`, `oracle.fixture.ts` (BigInt oracle of the DD-02 formulas; it imports nothing from `src/engine`). No M1.4 file exists and nothing from M2+ was started. Every fixture value is `TEST_FIXTURE` made-up test data (deduction/limit numbers are copies of the SPEC's calculation examples, the clause reference is the label `TEST_FIXTURE_CLAUSE_REF`, the approver is `TEST_FIXTURE_APPROVER_NOT_A_REAL_APPROVAL`); none is a real insurance formula, deductible, limit, clause, price or approval record. A grep of `src/` and `tests/` for insurer and product names (Korean and English) and clause-number patterns found no match; `src/engine` contains no digit literal outside `constants.ts`, `limits.ts` and comments.

**Result shape.** `estimate(input, { digest })` returns `{ ok: false, rejection }` or `{ ok: true, result }`. `result` is the DD-03 `EstimateResult`: `state`, `amounts` (`hospitalPayment`, `baseFeeIncluded`, `expectedInsurancePayout`, `expectedOutOfPocketAfterPayout`), `lines`, `groups`, `referenceGroups`, `assumptions`, `holdReasons`, `excludedItems`, `basis`. A rejected input never yields a result object (so never a 0-won result), and a result with `state = ON_HOLD` has `null` in both payout fields.

#### RED evidence (verbatim, captured before the implementation existed)

1. Arithmetic units (`rounding`, `sum`, `deduction`, `limit` as throwing stubs `미구현`), `npx vitest run tests/engine/arithmetic-units.test.ts`, exit 1:
```
 Test Files  1 failed (1)
      Tests  47 failed | 1 passed (48)
```
(`1 passed` is the constants test; the failures are `Error: 미구현` from the stubs.)
2. `group-values` (stub), exit 1: `Tests  67 failed (67)`.
3. `estimate()` skeleton (front end only, payouts null), `examples.test.ts`, exit 1 — a wrong-value failure, not a missing-module failure:
```
      Tests  12 failed | 2 passed (14)
 FAIL  tests/engine/examples.test.ts > AC-002a~e ... > AC-002a 사례 A: FIXED 10,000, PER_VISIT_PAYOUT 250,000 -> 보험금 114,000, 본인 부담 10,000
AssertionError: expected { hospitalPayment: 124000, …(3) } to deeply equal { hospitalPayment: 124000, …(3) }
-   "expectedInsurancePayout": 114000,
-   "expectedOutOfPocketAfterPayout": 10000,
```
4. No treatment line -> `NO_TREATMENT_SELECTED` (new behaviour in `validate.ts`), exit 1: `Tests  1 failed | 61 passed (62)`, `AssertionError: expected { ok: true, value: { …(5) } } to deeply equal { ok: false, …(1) }`.
5. Unknown `benefitType` -> `CLASSIFICATION_NEEDS_REVIEW` (new behaviour in `resolve.ts`), exit 1: `Tests  1 failed | 56 passed (57)`.
The remaining test files (`rules`, `pooled-limit`, `pool-structure`, `numeric-groups`, `states`, `mapping-coverage`, `order-independence`, `invariants`) exercise code paths that earlier steps had already implemented; they were green on first run and their RED is not captured (see Gaps). Mutation spot checks against `src/` (each reverted afterwards; the final runs below are on the unmutated tree): `Math.max` -> `Math.min` in the RATE deduction: `26 failed | 694 passed (720)`; `Math.max(E - D, 0)` -> `E - D`: `5 failed`; pool allocation ignoring the remaining limit: `15 failed`; reference groups including pool-tainted groups: `1 failed`; unchecked `ROUND_ADD`: `8 failed`; swapped missing/invalid priority: `3 failed`.

#### GREEN evidence

| Step | Command | Exit | Result |
|------|---------|------|--------|
| arithmetic units | `npx vitest run tests/engine/arithmetic-units.test.ts` | 0 | `Tests  48 passed (48)` |
| group-values | same file | 0 | `Tests  67 passed (67)`; 69 after two defensive cases |
| examples | `npx vitest run tests/engine/examples.test.ts` (after the real `estimate()`) | 0 | all green with the whole suite: `Tests  523 passed (523)` at that point |
| numeric-groups | AC-003h table | 0 | `Tests  34 passed (34)`, about 2.8 s |

Final runs (this tree):
```
$ npx vitest run tests/engine tests/boundary   -> exit 0   (tests/boundary does not exist yet; only tests/engine runs)
 Test Files  20 passed (20)
      Tests  720 passed (720)
$ npx tsc --noEmit                             -> exit 0, empty output (0 bytes)
$ npx vitest run --coverage tests/engine       -> exit 0
 Test Files  20 passed (20)
      Tests  720 passed (720)
Statements   : 100% ( 450/450 )
Branches     : 100% ( 370/370 )
Functions    : 100% ( 109/109 )
Lines        : 100% ( 417/417 )
```
Per file (cumulative `src/engine/**`, from `coverage/coverage-summary.json`; the text reporter collapses fully covered files): `constants.ts`, `deduction.ts`, `estimate.ts`, `group-values.ts`, `limit.ts`, `limits.ts`, `numeric.ts`, `profile-structure.ts`, `resolve.ts`, `rounding.ts`, `sum.ts`, `types.ts`, `usability.ts`, `validate.ts` are each 100 / 100 / 100 / 100 (statements / branches / functions / lines). Mid-step, `group-values.ts` was at 94.11% branches (lines 56, 78, 111: non-object rules and a non-array pool list); two defensive cases closed it. Coverage measures execution, not correctness; the M1-end 85% gate is met on the cumulative figure.

#### AC matrix (M1.3 scope)

| AC | M1.3 status | Proving test (file : describe) | Notes |
|----|-------------|--------------------------------|-------|
| AC-002a~e | CLOSED | `examples.test.ts` : "AC-002a~e" | cases A-E reproduce 114,000/10,000, 99,200/24,800, 100,600/23,400, 81,000 (4,000 + 77,000)/43,000, 74,000/50,000 with hospital payment 124,000; E-case group E = 84,000, `ESTIMATED_WITH_EXCLUSIONS`, `payout` constant 0 and reason, no `ALL_COVERED_AND_LIMIT_REMAINS` |
| AC-002f~j | CLOSED | `examples.test.ts` : "AC-002f~j" | one deduction per group (74,000 not 60,000); `LineResult` has no payout key (runtime key set here, type level in `types.test.ts`) |
| AC-003a | CLOSED | `rules.test.ts`, `group-values.test.ts` | missing `rounding` -> `PROFILE_VALUE_MISSING`, no default |
| AC-003b | CLOSED | `rules.test.ts`, `arithmetic-units.test.ts` | TRUNCATE vs ROUND_HALF_UP differ at 250.5; SPLIT rounds the sum once |
| AC-003c | CLOSED | `rules.test.ts`, `group-values.test.ts` | unknown deduction kind and `COVERED_COST` (all four limit kinds) -> `PROFILE_FORMULA_UNSUPPORTED` |
| AC-003d | CLOSED | `rules.test.ts` | PER_ACCIDENT/ANNUAL/COUNT applied + `REMAINING_LIMIT_ASSUMED` |
| AC-003e | CLOSED | `rules.test.ts` | `UNLIMITED_DECLARED` without clause -> `PROFILE_SOURCE_INCOMPLETE` |
| AC-003f | CLOSED | `pooled-limit.test.ts` | pool total applied once, shares in `groupOrder`, `P` and `P_pooled` both recorded, BigInt oracle for 9 limits x 2 orders |
| AC-003g | CLOSED | `rules.test.ts`, `group-values.test.ts` | 6 invalid kinds + missing/null; other groups unaffected; boundaries `MAX_AMOUNT_WON`, 10000, 0 valid; profile object not modified |
| AC-003h | CLOSED at engine level except row 10's real input | `numeric-groups.test.ts` | rows 1a-9c (28 cases), row 11 (no truncation, rate-9999 variant); every normal row equals the BigInt oracle and the table's own `D`/`D_applied`/`P`; failures carry the table's step name in `trace`/`basis.steps`; lines are built from `ceil(E / MAX_AMOUNT_WON)` lines (901 or 4,504), none hard-coded. Row 10: engine level only through the injected summation double (a real input needs 9,007,200 lines); the function-level pair `checkedAdd(S-1,1)`/`(S,1)` and `sumLineAmounts` are in `numeric.test.ts` (M1.1) |
| AC-004a~c, e, f, g | CLOSED | `states.test.ts` | 0-won with basis; all excluded; hold without payout (no zero, nulls); assumption codes; base-fee three cases; basis contents |
| AC-004d | CLOSED | `states.test.ts`, `pooled-limit.test.ts` | reference groups 4,000 and 40,000; pool-mates of a held group are excluded from `referenceGroups` |
| AC-004h | CLOSED | `pooled-limit.test.ts` | `sum P_pooled` = payout, payment - payout = out-of-pocket, `P_pooled <= P <= E`, JSON round trip |
| AC-005a | CLOSED | `invariants.test.ts` | 400 trials, seed 20261015 (recorded in the test title); 8 boundary-near cases (E at the AC-003h limits +-1); every trial checks the invariants and every non-hold result is compared to the oracle; the generator is asserted to cover held, estimated, with-exclusions and pooled cases |
| AC-006c | CLOSED (result level) | `examples.test.ts` : "AC-006c 결과 수준" | duplicate IDs and lines: `amounts.hospitalPayment` = 124,000 and group E = 124,000 |
| AC-006d | CLOSED | `examples.test.ts` : "AC-006d", `types.test.ts` | three "cause" values pushed in at runtime leave the serialized outcome byte-identical; the input type has no cause field |
| AC-006e | CLOSED | `examples.test.ts` : "AC-006e" | |
| AC-008e | CLOSED | `states.test.ts` : "AC-008e 결과 수준", `hold-matrix.test.ts` | a line-level mapping reason beats the group-level `PROFILE_SOURCE_INCOMPLETE` of the same group on that line only; value check precedes arithmetic |
| AC-008g | CLOSED (result level) | `states.test.ts` : "AC-008f/g" | suspended bundle: all lines `RULE_BUNDLE_SUSPENDED`, hospital payment a number, both payouts null; documents = null belongs to M2 (`deriveDocuments` does not exist yet) |
| AC-008j | CLOSED | `mapping-coverage.test.ts` | covered/group-missing/excluded, no group lookup for excluded lines, no exclusion shortcut (13 unusable states, `NEEDS_REVIEW`, absent, ambiguous), field-rule defense (7 cases) |
| AC-008k | CLOSED | `order-independence.test.ts` | seed 20261015 x 60 shuffles of mappings (9), lines/ids; all 6 x 2 permutations of groups and pools; output order rules (code point order with upper/lower case, "10" < "2", Korean ids); `groupOrder` is data |
| AC-008m | CLOSED | `pool-structure.test.ts` | 9 structure defects -> all lines `PROFILE_INVALID`, `groups` has no estimated entry, `referenceGroups` empty; pool value defects hit members only; memberless defective pool changes nothing (byte-identical result); code-priority examples |
| AC-008a, b, f | result-level repeat of M1.2's front-level closure | `states.test.ts` | |
| AC-001a/b/c, AC-010b | NOT M1.3 (M1.4 / M4) | - | cross-process determinism, import boundary and literal checks are not started |

#### plan.md §E.9 #8 (corrected wording): how each conflict candidate was resolved

The binding rule implemented: the common base cost is part of the expected hospital payment `T` regardless of coverage (`validateEstimateInput` sums `baseFeeLines` into `T` before any mapping lookup, and `baseFeeIncluded = INCLUDED` whenever one is registered); in the payout computation the base-fee line goes through the same `decideLine` as a treatment (same coverage-mapping decision); no or unusable mapping -> the existing hold contract (`MAPPING_ABSENT` etc., the whole result is `ON_HOLD`, the amount stays in `T`); a confirmed `EXCLUDED` mapping keeps the amount in `T` and leaves it out of every group `E`. Tests: `states.test.ts` "AC-004f 공통 기본비용". Per candidate (no stale text was edited):
- `design.md:155`: agrees with the corrected wording (same mapping decision; the amount counts in the payment even when the line is held). Followed as written.
- `plan.md:308` (the §E.2 row for #8, "공통 기본비용도 보장 매핑이 필요하다는 SPEC 결정", default "필요"): read as applying to the payout side only. Implemented so that a missing mapping holds the payout and does not remove the amount from the payment. The row's sentence can be read the other way; the corrected wording overrides it.
- `plan.md:400` (§E.8 B3 (3), "기본비용을 매핑 없이 계산하면 보장 여부가 정해지지 않은 금액이 들어간다"): read as describing the payout side (an unmapped amount must not be treated as covered); implemented as the hold contract. It does not say the amount leaves the payment.
- `spec.md:146` (C5) and `spec-compact.md:69`: the behaviour matches; the "SPEC 제안 (승인 전, §E #8)" label is stale because §E.9 records #8 as accepted with corrected wording. Behaviour unchanged by the label.
- `acceptance.md:85` (AC-004f): agrees; tested verbatim (three cases).

#### Assumptions (non-blocking; each takes the hold-leaning side)

1. `validateEstimateInput` now rejects with `NO_TREATMENT_SELECTED` when the raw `lines` list is empty (a base-fee-only input included). Without it, `treatmentIds` with no lines would produce a 0-won "ESTIMATED" result. Partial cases (some selected IDs without a line) are still not detected (server guarantee, DD-19). The M1.1 tests stay green; one case was added.
2. A line whose `benefitType` is neither `BENEFIT` nor `NON_BENEFIT` is held as `CLASSIFICATION_NEEDS_REVIEW` before the mapping lookup, because it cannot be placed in the benefit share `G` or the non-benefit share `N`.
3. `groups[]` contains only groups that have at least one line that passed the line stage, in `groupOrder`; profile groups without lines are omitted.
4. A group held at group level reports the exact sums `G`, `N`, `E` of its lines and `null` for `D`, `D_applied`, `L`, `P`, `P_pooled`; its lines become `ON_HOLD` with the group's code and no `groupKey`; `holdReasons` lists those lines.
5. If one member of a shared-limit pool is held, the other members keep `P` but get `P_pooled = null` and are not reference groups (their share depends on the held member).
6. Assumption codes: `STANDARD_PROFILE_APPLIED` whenever the result is not `ON_HOLD` (also when every line is excluded); `ALL_COVERED_AND_LIMIT_REMAINS` only when no line is excluded and none held; `REMAINING_COVERED_AND_LIMIT_REMAINS` only when at least one line is excluded AND at least one is estimated; `REMAINING_LIMIT_ASSUMED` only in non-hold results and only when a group limit or the applied pool limit is `PER_ACCIDENT`/`ANNUAL`/`COUNT`; an `ON_HOLD` result carries only `PERSONAL_CONTRACT_NOT_CONFIRMED`.
7. Value checks: `deduction`/`limit` absent or null -> `PROFILE_VALUE_MISSING`; present but not an object, or an unknown `kind` -> `PROFILE_FORMULA_UNSUPPORTED`; `rounding` outside the two values -> `PROFILE_VALUE_INVALID`; `limitBasis` absent -> `PROFILE_VALUE_MISSING`, any value other than `PAYOUT` (not only `COVERED_COST`) -> `PROFILE_FORMULA_UNSUPPORTED`; a blank or whitespace `policyClauseRef` -> `PROFILE_SOURCE_INCOMPLETE`; a non-selected `rounding` on `FIXED` is ignored.
8. `Basis` = `{ ruleBundleId, profile: { id, version, origin, policySources }, steps }`; `trace` of a group is a one-element list; a result blocked at bundle or profile stage has `profile: null` and `steps: []`. The catalog version is not an engine input and is left to the server.
9. `sum.ts` holds the group-share sums (`G`, `N`, `E`) with plain addition: every part is bounded by `T`, which `validate` already checked (DD-24 "한도·지급 단계"); `sumLineAmounts` stays in `numeric.ts`. The payout total `sum P_pooled` is also a plain sum for the same reason.
10. `floorDivide` uses `BigInt` division because a float quotient of a large safe integer can round up (for example `.9999`).
11. `estimate(input, { digest })` has the same dependency object as the front end (`sum`, `functions` for tests); the result for rejected input is `{ ok: false, rejection }`.
12. **Tension with the hand-off wording "hold results must not carry a payout number":** `referenceGroups` in an `ON_HOLD` result carries `P` values, because design.md DD-03 and AC-004d require it (flagged `isReference: true`, "응답에만 담고 보류 결과 화면에는 보이지 않는다"). `expectedInsurancePayout` and `expectedOutOfPocketAfterPayout` are `null` and held groups' `D`/`P`/`P_pooled` are `null`. If the owner wants no payout-like number at all in a hold result, `referenceGroups` would have to be dropped and AC-004d changed; that is a SPEC decision. M4/M6 must not show it to the patient.

#### SPEC ambiguities / contradictions met

- The hand-off line "hold results must not carry a payout number" vs design.md DD-03 "참고 그룹" and AC-004d (assumption 12).
- acceptance.md:31 (case E) lists `ALL_COVERED_AND_LIMIT_REMAINS` as absent and the DD-03 table says `REMAINING_COVERED_AND_LIMIT_REMAINS` needs "나머지 항목" — what to emit when every line is excluded is unspecified (assumption 6).
- design.md:216 `STANDARD_PROFILE_APPLIED` "프로필을 써서 계산했을 때": whether an all-excluded result "used" the profile is unspecified (assumption 6).
- design.md:134-143 / DD-03: a selected treatment ID without a line has no defined outcome (assumption 1).
- The DD-24 text lists no rejection or hold for a `rounding` value outside the enum or a `limitBasis` outside `PAYOUT`/`COVERED_COST` (assumption 7).
- plan.md:71 names `sum.ts` as an M1.3 file but `sumLineAmounts` is already listed under `numeric.ts` in DD-24 (assumption 9).
- The #8 candidate wording (see above).

#### Gaps (not observed)

1. AC-003h row 10: no real 9,007,200-line input was run; the engine-level overflow path uses the injected summation double, the function-level pair is in M1.1's `numeric.test.ts`.
2. RED was captured at behaviour level only for the arithmetic units, `group-values`, `examples`, the no-line rejection and the unknown-`benefitType` hold. The other new test files were written against code that already existed and were green on first run; the six mutation spot checks are the only evidence that they can fail on wrong behaviour, and they are not a mutation-testing run.
3. The property test (400 trials) is a sample, not a proof; its oracle shares the DD-02 reading with the implementation (both written from the same text).
4. `documents = null` for held results and `deriveDocuments` are M2; cross-process byte determinism, import-boundary and literal checks are M1.4; HTTP, persistence and the real hash are M3/M4.
5. `testDigest` is not a real hash.
6. No formal SPEC lint, no `moai verify`, no linter or formatter. Only Windows 11 and Node 24.19.0 were run.

#### Residual risk

- `referenceGroups` (assumption 12) may be rejected by the owner; the result shape would change.
- The placeholder shapes from M1.1/M1.2 (`PolicySourceRef`, `ApproverRecord`, validity) and `Basis` may be refined by M3/M4.
- Treating every `limitBasis` other than `PAYOUT` as unsupported could hold a future legitimate basis until the engine learns it.
- Large inputs (4,504 lines in the AC-003h rows) make the suite take a few seconds; the mapping lookup is O(lines x mappings).

### M1.4 — determinism, profile sensitivity, import and literal boundary (cycle_type = tdd), 2026-10-15

**Attribution.** All results below were observed in this run, on Windows 11, Node v24.19.0, npm 11.6.2, against HEAD `2de1f01` (the M1.3 commit) plus the uncommitted M1.4 working tree; the M1.4 commit SHA is reported by the commit itself. No dependency was added and **no file under `src/` changed** (`git diff --stat -- src` was empty after every mutation spot check; no production defect was found). The `moai` CLI and the moai MCP server are unavailable: the formal SPEC lint and `moai verify` were NOT run and no linter/formatter is configured, so formal lint is UNVERIFIED. Bounded outputs went to `.moai/state/verify/m1-4/` (local, gitignored); the quoted excerpts are copied verbatim from those files. `spec.md` (status stays `in-progress`) and every SPEC file other than this progress file are untouched. Every fixture value is `TEST_FIXTURE` made-up test data; a grep of `src/` and `tests/` for insurer names (Korean and English) and clause-number patterns found no match.

**Files (M1.4).** New tests: `tests/engine/determinism.test.ts` (14 tests), `tests/engine/profile-sensitivity.test.ts` (19), `tests/boundary/engine-imports.test.ts` (129), `tests/boundary/engine-literals.test.ts` (55), `tests/boundary/fixture-import-checker.test.ts` (22). New test helpers: `tests/boundary/source-scan.ts` (lexer, module-reference extractor, module classifier, hazard scanner, literal rule), `tests/boundary/fixture-reach.ts` (AC-010b reach checker). New fixtures: `tests/fixtures/engine/corpus.fixture.ts` (15 inputs: cases A-E, base fee, shared-limit pool, ROUND_HALF_UP split, hold with reference groups, suspended bundle, expired profile, 2 rejections, CALC_RANGE_EXCEEDED, code-point-order ids), `child-run.ts`, `ts-resolve-hooks.mjs`, `ts-resolve-register.mjs` (the child-process runner). Nothing from M2+ was started.

**How each check works.**
- *AC-001a.* (1) 25 repeated in-process runs of every corpus input, forward, reverse and seeded-shuffled call order; (2) deep-frozen and `structuredClone`d inputs give identical bytes and the input is unchanged afterwards; (3) `Date.now`, `Math.random`, `performance.now` replaced by throwing spies are never called, and the bytes are identical; (4) fake system time at three instants gives identical bytes; (5) time enters only through the input `at` (inside the validity window -> `ESTIMATED`, outside -> `ON_HOLD`, each stable); (6) seeded shuffles (seed 20261015, 20 trials per input) of lines, base-fee lines, treatment ids and mappings give identical bytes (full permutations stay in `order-independence.test.ts`, AC-008k); (7) **new process:** 4 child `node` processes (`spawnSync`, 90 s timeout, `SIGKILL` on timeout, `windowsHide`, no background process, nothing left running) with `TZ` = UTC, Asia/Seoul, America/Los_Angeles, Pacific/Auckland run the same corpus; the test asserts the child pid differs from the parent's and that the time-zone offsets really took effect (`[0,0]`, `[-540,-540]`, `[480,420]`, `[-780,-720]`), then compares every serialized outcome with the parent's string for byte equality. The child needs no new dependency: Node's built-in type stripping runs the `.ts` sources and a 10-line resolve hook (`ts-resolve-hooks.mjs`) appends `.ts` to extensionless relative specifiers.
- *AC-001c, main evidence.* The profile has 4 groups (all four deduction kinds, all four limit kinds incl. `COUNT`) and one shared-limit pool. Every numeric leaf of the profile (13 fields: 4 fixed floors, 4 rates, 4 limit amounts, 1 pool limit; enumerated generically, so a new numeric field is picked up automatically) is changed one at a time to 5-6 boundary values; the engine's `P`, `P_pooled`, `D`, `D_applied`, payout and out-of-pocket must equal the independent BigInt oracle exactly, and at least one variant per field must move the result. Also: unrelated groups do not change when a non-pooled group's field changes; deleting any of the 13 fields gives `ON_HOLD` with only `PROFILE_VALUE_MISSING` and null payout (no 0/default fill); two different `TEST_FIXTURE` profiles in the same cell give different results, each equal to the oracle.
- *AC-001b.* `tests/boundary/source-scan.ts` is a purpose-built lexer (comments, strings, template literals with nested `${}`, regex literals, numeric literal forms) and fails closed (`SCAN_ERROR`) on anything it cannot read. It extracts `import`, `import type`, `export ... from`, side-effect imports, dynamic `import()` and `require()`; every specifier must be a relative path that resolves to an existing file inside `src/engine`, otherwise the rule reports a category (`MODULE_REACT`, `_NEXT`, `_DB_DRIVER`, `_NETWORK`, `_FILE_SYSTEM`, `_AI_SDK`, `_NODE_BUILTIN`, `_FIXTURE`, `_OUTSIDE_ENGINE`, `_BARE_PACKAGE`, plus `DYNAMIC_SPECIFIER`, `COMMONJS_REQUIRE`, `UNRESOLVED_IMPORT`). It also flags un-injected `Date.now()`, `new Date()`, `Date()`, `performance`, `Math.random`, `crypto`, `process`/`globalThis`/`import.meta`, `fetch`/`XMLHttpRequest`/`WebSocket`, timers, `Intl`/`localeCompare`/`toLocale*` and local-time `Date` getters or multi-argument `new Date(...)` (beyond the SPEC's `Date.now`/`Math.random` wording, the timer, `Intl`/locale, local-time and environment items are my conservative extension). `deps.now()` style injected clocks, `Date.UTC`, `new Date(0)` and `new Date(Date.UTC(...))` pass. TypeScript 7.0.2 ships no JS compiler API (its `typescript` package is a native-binary launcher; only "unstable" process-based API paths exist), so the plan.md §G option "read imports with the TypeScript compiler API" was not available and no parser dependency was added.
- *AC-001c, narrow static check.* Rule (my choice, as acceptance.md allows): split an identifier into camelCase/snake words; if any word starts with `deduct`, `limit`, `rate`, `payout`, `copay`, `fixed`, `floor`, `cap` or `ratio`, a numeric literal directly bound to it (`=`, `:`, compound assignment, default parameter, type-annotated declaration), compared with it, used as an arithmetic operand with it, or used as a `??`/`||` default for it is a violation, **including 0 and 1**; numbers inside `interface`/`type` declarations are skipped; `10000` and `5000` (the scale and half, read from `constants.ts`) are a violation anywhere outside `constants.ts` and `limits.ts`. One allowlist entry (file + name + literal, with its reason) covers `payout: 0` in `estimate.ts` (the `ExcludedItem.payout` field is typed as the constant 0, DD-03); the test requires that entry to match exactly once and, with the allowlist emptied, exactly that one violation to appear (a stale entry is detected).

#### RED evidence (verbatim, captured before the helpers existed)

`tests/boundary/source-scan.ts` and `fixture-reach.ts` were first created as stubs throwing `Error: 미구현`, the three boundary test files were written against them, and `npx vitest run tests/boundary` was run (exit 1):
```
 FAIL  tests/boundary/engine-imports.test.ts [ tests/boundary/engine-imports.test.ts ]
Error: 미구현
 FAIL  tests/boundary/engine-literals.test.ts [ tests/boundary/engine-literals.test.ts ]
Error: 미구현
 FAIL  tests/boundary/fixture-import-checker.test.ts > isFixturePath > tests/fixtures/engine/profiles.fixture.ts -> true
 ...
 Test Files  3 failed (3)
      Tests  22 failed (22)
```
(The two files that call `readSourceFiles` at module level fail at collection, which is why only 22 tests are counted.) `determinism.test.ts` and `profile-sensitivity.test.ts` assert behaviour that already exists, so there is no missing-implementation RED for them; their falsifiability is shown by the mutation spot checks below (gap 2).

#### GREEN evidence and mutation spot checks

First green run of the helpers: `npx vitest run tests/boundary` -> `Test Files  3 passed (3)`, `Tests  206 passed (206)`. `npx vitest run tests/engine/determinism.test.ts tests/engine/profile-sensitivity.test.ts` -> `Tests  33 passed (33)`. Three repeated runs of the five new files: `Tests  239 passed (239)` each time, 2.07-2.13 s. Each child process took about 215-235 ms.

Real `src/engine` facts (`scan-facts.txt`): 14 source files, 37 import edges (all relative `import`), 0 boundary violations, 30 value-level numeric literals scanned outside the two exempt files and type regions, 0 violations, 1 allowlisted (`estimate.ts` `payout: 0`).

Mutation spot checks (each temporary and reverted; `src/` was byte-identical afterwards):

| Mutation | What failed |
|----------|-------------|
| `void Math.random();` in `sum.ts` | `Tests  8 failed | 231 passed (239)`: "경계 위반이 하나도 없다" (RANDOM) and determinism "Date.now·Math.random·performance.now 를 한 번도 부르지 않는다"; the other 6 are the add-one-violation tests that now see two |
| `FIXED` returns `D: 3000` instead of `rule.fixed` | `Tests  2 failed | 237 passed (239)`: only `profile-sensitivity` (`groups.3.deduction.fixed`, profile B). The static literal rule does **not** catch it (`D` is not a business name) - this is why the behaviour test is the main evidence |
| `const deductible = 10000;` added to `deduction.ts` | `Tests  2 failed | 204 passed (206)` (boundary): `BUSINESS_LITERAL` and `SCALE_LITERAL` |
| `floorDivide(value, 10000)` in `rounding.ts` | `Tests  2 failed | 252 passed (254)`: `SCALE_LITERAL` |
| `import { readFileSync } from 'node:fs'` + `new Date().getTime()` + `process.env.TZ` in `limit.ts` | `Tests  8 failed | 121 passed (129)`: `MODULE_FILE_SYSTEM`, `CLOCK`, `ENVIRONMENT` |
| the calendar-date check in `usability.ts` using local getters (`getFullYear`...) instead of `getUTC*` | `Tests  8 failed | 135 passed (143)`: static `LOCAL_TIME`, and **only the cross-process test** `America/Los_Angeles` catches the runtime effect (the parent runs in Asia/Seoul, where the in-process tests cannot see it) |

#### Final verification (this tree, HEAD `2de1f01` + M1.4 files)

```
$ npx vitest run tests/engine tests/boundary   -> exit 0
 Test Files  25 passed (25)
      Tests  959 passed (959)
   Duration  3.68s (tests 81%, import 13%, transform 4%, worker 1%)
$ npx tsc --noEmit                              -> exit 0, empty output (0 bytes)
$ npx vitest run --coverage tests/engine        -> exit 0
 Test Files  22 passed (22)
      Tests  753 passed (753)
   Duration  7.03s
Statements   : 100% ( 450/450 )
Branches     : 100% ( 370/370 )
Functions    : 100% ( 109/109 )
Lines        : 100% ( 417/417 )
```
Per file (`coverage-summary.json`, cumulative `src/engine/**`): `constants.ts`, `deduction.ts`, `estimate.ts`, `group-values.ts`, `limit.ts`, `limits.ts`, `numeric.ts`, `profile-structure.ts`, `resolve.ts`, `rounding.ts`, `sum.ts`, `types.ts`, `usability.ts`, `validate.ts` each 100 / 100 / 100 / 100 (statements / branches / functions / lines). `tests/boundary` code is outside the coverage `include` (`src/engine/**`).

#### AC matrix (M1.4 scope)

| AC | Status | Proving test | Notes |
|----|--------|--------------|-------|
| AC-001a | CLOSED | `determinism.test.ts` (all 14), `order-independence.test.ts` (AC-008k permutations) | repeats, frozen/cloned input, spies, fake clock, input-only time, seeded shuffles, 4 child processes x 4 time zones |
| AC-001b | CLOSED | `engine-imports.test.ts` ("AC-001b 실제 src/engine 소스" + negative tables + "실제 파일에 금지 항목을 일부러 더한 변형" + "디렉터리 검사"), `determinism.test.ts` (spies/fake clock as behaviour evidence) | negatives: 30 import forms across React, Next, DB drivers, network, fs, AI SDKs, Node built-ins, fixtures, outside-engine, dynamic, `require`; 26 clock/random/env/network/timer/locale forms; adding each forbidden item to every real engine file fails exactly that file |
| AC-001c | CLOSED | `profile-sensitivity.test.ts` (main), `engine-literals.test.ts` (narrow static) | the AC example `const deductible = 10000` fails; index/counter/loop/array-length numbers pass (18 positive cases) |
| AC-010b | EVIDENCE ONLY (closes in M4) | `fixture-import-checker.test.ts` | see below |

**AC-010b: what M1.4 observed and what it cannot.** Observed: the checker follows relative imports (including `index.ts`, `.js`->`.ts` specifiers, `export * from`, `import type`, string `import()`, side-effect imports, cycles) from an entry and reports a path to any fixture module (`fixtures` folder, `.fixture.` file name, or a package name containing `fixture`), plus unresolved/dynamic/unreadable imports as closed failures; the negative synthetic-entry cases (direct, two levels deep, through `index.ts`, four import forms, a `.js` specifier, three package names, dynamic/unresolved/unreadable imports, a cycle, several entries) fail as required, the clean synthetic entry passes, the on-disk (temp directory) variant agrees, and the real engine entry `src/engine/estimate.ts` reaches only `src/engine` files (no fixture). Not observable in M1: the real production composition entry (`src/server/composition.*`, first created in M4); the test globs for it and runs the same checker if it exists, but in M1 the target list is empty, so that one test is vacuous by construction; the "build fails" half of AC-010b (no build exists), and the configured `acceptedOrigins` of a real composition (AC-010a covers origin acceptance at engine level, M1.2).

#### Assumptions (non-blocking)

1. The exempt files for the literal rule are `constants.ts` and `limits.ts` only (design.md:47 and AC-001c). plan.md:72 also lists `numeric.ts` as a place where declarations are allowed; I did not exempt it (the stricter reading) and `numeric.ts` has no hit anyway.
2. The business-name stems come from the AC text; matching is per identifier word, so `operate`/`separate`/`generated` do not match but `capacity`/`capture` would.
3. `0` and `1` are not exempt from the literal rule, and `x ?? 0` / `x || 5` on a business name is a violation (the hazard the rule exists for is "fill a missing value"). The only allowlisted site is `payout: 0` (typed constant).
4. The fixture reach checker treats type-only imports as edges (strict), and any package name containing `fixture` as a fixture package.
5. The child-process test needs Node with built-in type stripping (22.18+/24 here, Node 24.19.0 observed) and sets `TZ` inside the child before the engine runs; `NODE_OPTIONS` and an inherited `TZ` are removed from the child environment.
6. A scan failure (unterminated string/comment/template/regex) is a violation, never a pass.
7. Extra hazards beyond the SPEC wording (timers, `Intl`, locale and local-time APIs, `process`/`globalThis`/`import.meta`, `crypto`) are flagged; the real engine has none.

#### SPEC ambiguities / contradictions met

- plan.md:72 (declarations allowed in `constants.ts`, `limits.ts`, `numeric.ts`) vs design.md:47 and AC-001c (`constants.ts`, `limits.ts`): assumption 1.
- plan.md §G "TypeScript compiler API" is not available with TypeScript 7.0.2; "or a lint rule" would need a linter dependency (none configured). I used a self-contained lexer.
- acceptance.md AC-001c says the narrow check covers literals "bound to or compared with" a business name; it does not say whether `0`/`1`, arithmetic operands or `??` defaults count (assumption 3).
- `payout: 0` in `estimate.ts` is a business-named numeric binding required by the DD-03 type (`payout: 0`); the AC text does not mention it, so the allowlist entry is my reading.
- AC-010b (acceptance.md:198) says M1.4 gives "only the checker and negative tests on a synthetic entry"; whether the glob-for-real-entry test that is vacuous in M1 counts as evidence is unspecified (I label it vacuous).

#### Gaps (not observed)

1. No formal SPEC lint, no `moai verify`, no linter or formatter. Only Windows 11 and Node 24.19.0 were run; the cross-process test was never run on another OS, another Node major or in CI.
2. `determinism.test.ts` and `profile-sensitivity.test.ts` have no missing-implementation RED (they assert behaviour the engine already has); their only falsifiability evidence is the six mutation spot checks, which are not a mutation-testing run.
3. The lexical scan cannot see aliasing (`const D = Date; D.now()`), `Reflect.get(Date, 'now')`, `eval`, or a name built at run time; the behavioural spies and the fake clock cover the common cases but not a clock read through a path they do not patch (for example `Intl.DateTimeFormat().format()`).
4. The literal rule is narrow by design: a hard-coded business value held under a non-business name (`D: 3000`) is only caught by the behaviour test (mutation 2).
5. The cross-process comparison uses the injected test digest, not a production hash; real hash determinism across processes (M3) is untested.
6. The real AC-010b target (M4) and the build-failure half do not exist yet.
7. 4 time zones and one locale-free Node ICU build were exercised; locale environment variables (`LANG`, `LC_ALL`) were not varied.

#### Residual risk

- The lexer is hand-written; an unusual syntax form (a regex literal after `}`, or `<`-generic ambiguity in a future file) could make it throw `ScanError`, which fails closed (a false failure, never a false pass). A later switch to a real parser would be cheap because only `tokenize` changes.
- Node's type-stripping and module-hook APIs are marked experimental in some releases; a Node upgrade may require changing `ts-resolve-register.mjs`.
- `tests/boundary/source-scan.ts` is shared infrastructure for M4/M7 (`AC-021d` widens the scope to all of `src/`); its rules are tuned for the engine and will need a configurable scope.

### M1 summary - cumulative M1.1 to M1.4, 2026-10-15

**Final cumulative commands (updated by M1.6 on 2026-10-15: HEAD `b7244eb` + the M1.6 documentation commit; verbatim excerpts, raw files in `.moai/state/verify/s1/`). Before M1.6 these were 27 files / 1063 tests and coverage 480/400/119/443; before M1.5, 25 files / 959 tests and coverage 450/370/109/417.**
```
$ npx vitest run tests/engine tests/boundary   -> exit 0
 Test Files  28 passed (28)
      Tests  1142 passed (1142)
   Duration  3.80s
$ npx tsc --noEmit                              -> exit 0, empty output (0 bytes)
$ npx vitest run --coverage tests/engine        -> exit 0
 Test Files  25 passed (25)
      Tests  936 passed (936)
Statements   : 100% ( 497/497 )   Branches : 100% ( 409/409 )
Functions    : 100% ( 117/117 )   Lines    : 100% ( 456/456 )
```
Test counts: `tests/engine` 936 (M1.1 157, M1.2 237, M1.3 326, M1.4 33, M1.5 104: R1 +61, R2 +43, M1.6 79) plus `tests/boundary` 206 = 1142 in 28 test files; the whole suite ran in about 4 s wall time (one worker per file), the coverage run about 7 s. Coverage is 100% for each of the 14 `src/engine` files, above the 85% M1 exit threshold. Formal lint: UNVERIFIED (no linter configured, `moai` unavailable).

**AC matrix, AC-001 to AC-010 families, across M1.1-M1.4** (plan.md §B: M1 closes 51 = M1.1 3 + M1.2 11 + M1.3 34 + M1.4 3; the per-AC sub-step results are in the M1.1-M1.4 blocks above).

| AC | Status | Closed in | Proven in (tests/...) |
|----|--------|-----------|-----------------------|
| AC-006b, AC-006c, AC-006h | closed | M1.1 | `engine/validate.test.ts`, `engine/numeric.test.ts`; AC-006c repeated at result level in `engine/examples.test.ts` (M1.3) |
| AC-006a | closed | M1.2 (rejection half evidence in M1.1) | `engine/hold-matrix.test.ts`, `engine/validate.test.ts` |
| AC-008a, AC-008b, AC-008c, AC-008f | closed | M1.2 (front level), result level repeated in M1.3 | `engine/hold-matrix.test.ts`, `engine/bundle-gate.test.ts`, `engine/states.test.ts` |
| AC-008d, AC-008h, AC-008i, AC-008l | closed | M1.2 | `engine/hold-matrix.test.ts`, `engine/mapping-resolve.test.ts`, `engine/bundle-gate.test.ts`, `engine/usability.test.ts` |
| AC-009b, AC-010a | closed | M1.2 | `engine/origins.test.ts` |
| AC-002a to AC-002j | closed | M1.3 | `engine/examples.test.ts` |
| AC-003a to AC-003h | closed (AC-003h row 10 with an injected summation double) | M1.3 | `engine/rules.test.ts`, `engine/group-values.test.ts`, `engine/pooled-limit.test.ts`, `engine/numeric-groups.test.ts`, `engine/numeric.test.ts` |
| AC-004a to AC-004h | closed | M1.3 | `engine/states.test.ts`, `engine/pooled-limit.test.ts` |
| AC-005a | closed | M1.3 | `engine/invariants.test.ts` |
| AC-006d, AC-006e | closed | M1.3 | `engine/examples.test.ts`, `engine/types.test.ts` |
| AC-008e, AC-008g, AC-008j, AC-008k, AC-008m | closed (AC-008g `documents = null` half belongs to M2) | M1.3 | `engine/states.test.ts`, `engine/mapping-coverage.test.ts`, `engine/order-independence.test.ts`, `engine/pool-structure.test.ts` |
| AC-001a, AC-001b, AC-001c | closed | M1.4 | `engine/determinism.test.ts`, `engine/profile-sensitivity.test.ts`, `boundary/engine-imports.test.ts`, `boundary/engine-literals.test.ts` |
| AC-010b | **evidence only** | M1.4 evidence, closes in **M4** | `boundary/fixture-import-checker.test.ts` |
| AC-006f, AC-006g, AC-006i | not in M1 | M4 | - |
| AC-007a-e, AC-007h, AC-007j-l | not in M1 | M2 | - |
| AC-007f | not in M1 | M3 | - |
| AC-007g, AC-007i | not in M1 | M6 | - |
| AC-009a, AC-009c, AC-010c | not in M1 | M3 | - |
| AC-010d | not in M1 | M4 | - |
| AC-010e | not in M1 | M6 | - |
| AC-011 and later | not in M1 | M3-M8 | - |

M1 closes all 51 assigned details. What M1 could not observe even for closed ACs: the AC-008g `documents = null` half and any document output (M2 `deriveDocuments`), the real 9,007,200-line T overflow (AC-003h row 10; function-level pair and the injected double exist), production hash determinism (M3), HTTP/persistence behaviour (M3/M4).

**Consolidated assumptions** (details in each sub-step block; all take the hold-leaning side).
- Numbers: `-0` is rejected for `Won` and `BasisPoints`; operands of checked arithmetic are non-negative safe integers; `MAX_AMOUNT_WON = 1,000,000,000` (accepted technical limit, not an insurance value); overflow rejects or holds, never truncates or clamps; `floorDivide` uses BigInt.
- Validation: duplicate treatment ids and lines collapse first-wins and output is code-point ordered; [SUPERSEDED by M1.5 (R1, e6a9658): only fully identical duplicates collapse; same id with any differing field is rejected as `INPUT_INTEGRITY_VIOLATION`, checked before the amount check and the T sum] T sums deduplicated treatment lines plus base-fee lines; no treatment line -> `NO_TREATMENT_SELECTED`; a selected id without a line is not detected by the engine (server guarantee); unknown `benefitType` -> `CLASSIFICATION_NEEDS_REVIEW`.
- Rule data: dates are real calendar `YYYY-MM-DD`, validity includes both ends; six policy-source items and an approver are required; a non-`ACTIVE` bundle status is suspended; an empty fingerprint/hash is an integrity mismatch; the profile content-hash target is `profileContent()`; the digest is injected through `deps.digest`; `PolicySourceRef`, `ApproverRecord`, `Basis` shapes are placeholders for M3.
- Calculation: unsupported formula or `limitBasis` other than `PAYOUT` -> `PROFILE_FORMULA_UNSUPPORTED`; shared limits are allocated in `groupOrder`; `UNLIMITED_DECLARED` needs a clause reference; groups without ESTIMATED lines are omitted; held groups report exact G/N/E and null D/P; the base fee is always in the hospital payment `T` and follows the treatment coverage-mapping decision for the payout (plan.md §E.9 #8, corrected wording).
- M1.4: literal-rule vocabulary and allowlist (assumptions 1-7 above).

**SPEC ambiguities / tensions for the owner.**
1. **`referenceGroups` vs "a hold result carries no payout number".** design.md DD-03 and AC-004d require `referenceGroups[].P` (flagged `isReference: true`) in an `ON_HOLD` result while `expectedInsurancePayout` and `expectedOutOfPocketAfterPayout` are null; the engine follows the SPEC. If the owner wants no payout-like number at all in a hold result, `referenceGroups` and AC-004d must change; M4/M6 must not show reference values to a patient. The orchestrator is surfacing this as an open decision; it was not changed.
2. **Stale labels (not edited, SPEC files are outside the run-phase write scope):** `spec.md:146` (C5) and `spec-compact.md:69` still label the base-fee mapping rule "SPEC 제안 (승인 전, §E #8)" although plan.md §E.9 records #8 as accepted with corrected wording; `plan.md:308` (§E.2 row for #8, "공통 기본비용도 보장 매핑이 필요하다 ... 기본값: 필요") can be read as "a mapping is required for the cost to count at all"; `plan.md:400` (§E.8 B3 (3)) is true only for the payout side. `design.md:155` and `acceptance.md:85` agree with the implemented rule. [RESOLVED in M1.5 (R3, this commit): the C5 labels in spec.md/spec-compact.md now read "SPEC 제안 · 소유자 수용 (2026-10-15, §E #8, 정정 수용)", and plan.md §E.3 row 8, §E.8 B3 (3) and design.md DD-03 state that the mapping decision applies to the payout only while the base fee is always in T; see block M1.5.]
3. Digest delivery (`EstimateInput` has no digest field), the unspecified outcomes in M1.3's list (all-excluded assumption codes, selected id without a line), and the plan.md:72 vs design.md:47 file list for literal declarations.
4. plan.md §G assumes a TypeScript compiler API that TypeScript 7 does not provide.

**Remaining constraints.**
- The 11 operational-data holds (plan.md §E.1, 보류-01 to 보류-11) remain open: no real insurance values, insurer names, clause texts, prices or approval records exist anywhere in `src/` or `tests/`; all data is `TEST_FIXTURE`.
- Deferred owner decisions not decided and not assumed by M1: #1 (database product), #2 (admin authentication), #3 (hosting), #5 (kiosk device specification), #30 (rule-management role split), #31 (author self-approval in operation), #32 (counselling number: display accepted, operator and hours still to be supplied), #34 (mapping author), #35 (2009.08-09 boundary-contract help text). M1 did not need them; M3-M8 do.
- Formal lint is UNVERIFIED (no linter configured, `moai` CLI/MCP absent). `spec.md` status remains `in-progress` (set in M1.1; the `implemented`/`completed` transitions belong to manager-docs).
- M2 and later milestones are not started; the owner's M1-limited approval (plan.md §E.9) does not cover M2+, production deployment, registering real insurance values, or merging to `main`.

### M1.5 외부 검토 보완 (R1~R3), 2026-10-15

**Scope.** Draft PR #1 received an external review. Three follow-ups were done on top of the M1.4 commit `cbba586`, same worktree and branch, one commit each: R1 (engine: conflicting duplicate treatment lines), R2 (engine: profile content-hash input independent of array order), R3 (documentation only, this block). No M2+ work, no real insurance value, no merge, no push, no new full audit. The audit result (iteration-5 FAIL 0.89, MP-7), `plan_status` and `spec.md` status (`in-progress`) are unchanged.

| Step | Commit | Content |
|------|--------|---------|
| base | `cbba586` | M1.4 (determinism, profile sensitivity, import/literal boundary) |
| R1 | `e6a9658` | `fix(SPEC-REIMBURSEMENT-001): M1 충돌하는 중복 치료 줄을 결정적으로 거절` |
| R2 | `eac034f` | `fix(SPEC-REIMBURSEMENT-001): M1 프로필 해시 입력의 배열 순서 의존 제거` |
| R3 | (this commit) | documentation alignment (spec, spec-compact, plan, design, acceptance, progress) |

#### R1: conflicting duplicate treatment lines

- **Problem.** `dedupeByTreatmentId()` kept the first line per `treatmentId` and silently dropped the rest, so two lines with the same id but different content gave an input-order-dependent result in a money calculation.
- **Behaviour now.** Same id with fully identical content (all `PublishedLine` fields, `documentFlags` included; object identity and key order ignored) is counted once. Any difference is rejected with `INPUT_INTEGRITY_VIOLATION` (reason `CONFLICTING_DUPLICATE_TREATMENT_LINE` or `CONFLICTING_DUPLICATE_BASE_FEE_LINE`; both arrays conflicting reports the treatment-line reason). No line is picked or summed; the result is identical for any order and any position of the duplicates; `estimate()` returns the rejection and no result object. The rejection carries no treatment id, amount or internal detail. Decision order: `UNSUPPORTED_GENERATION` → `NO_TREATMENT_SELECTED` → `INPUT_INTEGRITY_VIOLATION` → `INVALID_NUMERIC_INPUT` (conflict check before the per-line amount check and the T sum).
- **Files.** `src/engine/types.ts`, `src/engine/validate.ts`, `tests/engine/duplicate-conflict.test.ts` (new, 60 tests), `tests/engine/types.test.ts` (rejection-code list), `tests/engine/validate.test.ts` (one expectation changed, below).
- **RED (before the fix).** `npx vitest run tests/engine/duplicate-conflict.test.ts` -> `Tests  46 failed | 14 passed (60)`: conflicting duplicates were accepted (`expected { ok: true, value: … } to deeply equal { ok: false, rejection: … }`), `estimate()` returned a result, and malformed entries threw `TypeError: Cannot read properties of null` / `a[Symbol.iterator] is not a function`.
- **Existing test changed.** `validate.test.ts` "중복으로 걸러질 줄의 금액이 무효여도 조용히 버리지 않고 거절한다": it used pairs whose members differ (10,000 vs NaN; 5,000 vs -1) and expected `INVALID_NUMERIC_INPUT`; such pairs are now conflicts. Split into an identical-invalid-pair case (still `INVALID_NUMERIC_INPUT`) and a differing-pair case (`INPUT_INTEGRITY_VIOLATION`).
- **Mutation checks (reverted).** Comparing only `patientAmount` -> `27 failed | 33 passed (60)`; disabling the conflict check -> `43 failed | 771 passed (814)`.
- **Assumptions.** Equality is `Object.is` over the known `PublishedLine` fields and the three `documentFlags` booleans (NaN equals NaN, so identical NaN duplicates stay `INVALID_NUMERIC_INPUT`; `-0` differs from `0`, so such a pair is a conflict); properties outside the type are ignored. Malformed entries (null, non-object, no string `treatmentId`) are skipped by the conflict check and rejected as `INVALID_NUMERIC_INPUT`/`LINE_AMOUNT_INVALID` without throwing (previously a `TypeError`). Non-array `lines`/`baseFeeLines` still throw (TypeScript contract), unchanged.

#### R2: profile content-hash input independent of array order

- **Problem.** `profileContent()` passed `groups` and `sharedLimitPools` in stored order, so the same rules in another array order hashed differently (false `INTEGRITY_MISMATCH` → `PROFILE_INVALID`), and the M3 hash-generating side and the engine verifying side need one normalization.
- **Behaviour now.** `profileContent` (`src/engine/usability.ts`) is the single normalization: `groups` sorted by `groupKey` and `sharedLimitPools` by `poolKey` in Unicode code-point order on a copy (stable; input never mutated); `groupOrder` kept as stored (it decides shared-limit allocation); header fields and `contentHash` excluded. Arrays that are not arrays or contain null / key-less / non-string-key entries are left exactly as given (no repair, no throw); duplicate keys keep input order and are still rejected by the structure check. `compareCodePoints` is reused from `validate.ts` (no import cycle). The injected digest must be canonical with respect to object key order; the test stand-in `testDigest` already is (sorted keys), so it was not changed.
- **Files.** `src/engine/usability.ts`, `tests/engine/profile-content-order.test.ts` (new, 43 tests). `profile-structure.ts` semantics unchanged.
- **RED.** `Tests  7 failed | 36 passed (43)`: reordered profiles with the original hash failed integrity, the hash input was not sorted, estimate() of a reordered profile went `ON_HOLD`.
- **GREEN checks.** 24 group permutations x 6 pool permutations (144) keep the original hash and stay usable and give byte-identical `estimate()` results on a shared pool; 13 real rule changes and all 23 other `groupOrder` permutations with the old hash give `INTEGRITY_MISMATCH` → `PROFILE_INVALID` through `isUsable`, `resolveProfile` and `estimate()`; a deep-frozen profile is untouched; 13 malformed shapes do not throw; duplicate `groupKey`/`poolKey` profiles are `PROFILE_INVALID` via the structure check. [CORRECTED by M1.6 (b7244eb): "do not throw" was verified only for `profileContent` / `profileToRuleItem` tolerance, and the duplicate-key claim only through the structure check; the full path structure check -> `resolveProfile` -> `estimate()` was NOT exercised for null / non-object `groups` and `sharedLimitPools` entries or a non-array `sharedLimitPools`, and those still threw there until M1.6]
- **Mutation checks (reverted).** Removing the groups sort -> `7 failed | 850 passed (857)`; also sorting `groupOrder` (wrong) -> `5 failed | 852 passed (857)`.
- **Assumptions.** Sorting applies only when every element is an object with a string key; an empty-string key sorts first (still caught by the structure check); code-point order, no Unicode normalization (NFC and NFD forms of a key are different keys); hashes made under the old un-normalized scheme would not verify unless their stored order is key-sorted, so M3 must hash with this function and must not rely on old-scheme hashes (none exist in M1: fixtures only).

#### R3: documentation alignment (this commit; no src or tests change)

- **A. #8 base fee.** Aligned the current normative statements to the accepted record (plan.md §E.9): the base fee is always in the expected hospital payment T regardless of coverage; for the payout the base-fee line gets the same coverage-mapping decision as treatments; no or unusable mapping -> the existing hold contract (payout side only). Touched spec.md C5, spec-compact.md C5, design.md DD-03 (two sentences), plan.md §E.3 row 8 (default) and §E.8 B3 (recommendation and difference). acceptance.md AC-004f already says it (T includes the base fee even when unmapped or held; `baseFeeIncluded` semantics unchanged) and was not edited. plan.md §E.9's own "확인 필요" list is a record and was kept; one resolution note was appended after it. Other `#8` occurrences in plan.md (list of M1 items, milestone table, §E.9 record, research.md reference) are history or unrelated and were left.
- **B. Stale "승인 전" markers.** Only markers that cite an accepted §E number were changed to `SPEC 제안 · 소유자 수용 (2026-10-15, §E #N)` (or the equivalent inline form): 25 markers (spec.md 8, spec-compact.md 8, design.md 6, acceptance.md 3, plan.md 0; numbers #7, #8, #23, #24, #33, #36). The legend in spec.md §3 now defines the new marker and states that acceptance of a technical recommendation is not approval of real insurance values, production deployment or the full SPEC audit, and that the §E rows stay open. Left untouched: deferred numbers (#30, #34), revision-history rows (spec.md:27), the plan.md §E.9 record, and every marker without an explicit §E number (list below).
- **C. Input-integrity contract.** design.md DD-03 validation sentence, DD-04 call order, DD-19 (500 mapping sentence, layer 5 row, error table 500 row), DD-24 (new row and order line); spec.md/spec-compact.md C4 (duplicates) and C6 (500 mapping); spec-compact AC-006 summary row; acceptance.md AC-006c, AC-006h, AC-006i; plan.md M4 scope. `INPUT_INTEGRITY_VIOLATION` is treated like `INVALID_NUMERIC_INPUT`: a server data-integrity defect -> HTTP 500 `INTERNAL_ERROR` with no amounts or detail and no result object. **This API mapping is a contract requirement that is NOT implemented until M4.** No new AC id was added; every AC count and summary is unchanged.
- **D. Verification responsibility.** design.md DD-03 has a compact engine-versus-server table. Engine checks (implemented in M1): generation, no treatment, conflicting duplicates (both arrays), per-line amount range, T safe integer. Not checked by the engine, server guarantee, **NOT IMPLEMENTED, mandatory M4 validation and tests:** (a) a selected `treatmentId` without a published line, (b) a line whose `treatmentId` was not selected, (c) the same `treatmentId` in both `lines` and `baseFeeLines`, (d) an `isBaseFee` flag inconsistent with its array. Recorded as `M4 · 미구현` in plan.md M4, acceptance.md AC-006i and spec-compact.md; nothing is marked done or covered. The M1 characterization test only records current behaviour ("검사하지 않음").
- **E. Profile-hash contract.** design.md DD-04 (new bullet), plan.md M3 (new mandatory-test bullet), acceptance.md AC-008a (extended, covers M1) and AC-011a (M3 test requirement, `M3 · 미구현`).
- **F. referenceGroups.** No change. DD-03 (design.md:208) and the kiosk hold-result text (DD-07, design.md:531) and AC-013c already say the reference values are response-only and not shown on the hold-result screen; AC-004d keeps `referenceGroups[].P` with `isReference: true` while the overall payout and out-of-pocket stay null. The tension (a hold result carrying reference numbers) is still an owner decision.

#### Verification of the whole M1.5 range (verbatim tails, this session, HEAD `eac034f` + R3 documentation)

```
$ npx vitest run tests/engine tests/boundary   -> exit 0
 Test Files  27 passed (27)
      Tests  1063 passed (1063)
   Start at  15:40:57
   Duration  4.04s (tests 82%, import 12%, transform 4%, worker 2%)
$ npx tsc --noEmit                              -> exit 0, empty output (0 bytes)
$ npx vitest run --coverage tests/engine        -> exit 0
 Test Files  24 passed (24)
      Tests  857 passed (857)
Statements   : 100% ( 480/480 )
Branches     : 100% ( 400/400 )
Functions    : 100% ( 119/119 )
Lines        : 100% ( 443/443 )
```
Counts: base `cbba586` 25 files / 959 tests (753 under `tests/engine`); R1 -> 26 / 1020 (814); R2 -> 27 / 1063 (857). Raw outputs of R1 and R2 are in the gitignored `.moai/state/verify/r1/` and `r2/`. For R3, `git diff --check` was clean and every SPEC file kept all lines CRLF (line and CR counts recorded in the commit report). Formal lint and `moai verify` are UNVERIFIED (no linter configured, `moai` CLI absent).

#### AC mapping for the changed and extended sub-criteria

| AC | Change | Where proven |
|----|--------|--------------|
| AC-006c | extended: identical duplicates counted once, differing duplicates rejected, order independent | `engine/duplicate-conflict.test.ts`, `engine/validate.test.ts` (M1, closed) |
| AC-006h | extended: new rejection order and the NaN / -0 / malformed-entry rules | `engine/duplicate-conflict.test.ts`, `engine/types.test.ts` (M1, closed) |
| AC-006i | extended: `INPUT_INTEGRITY_VIOLATION` -> HTTP 500; mandatory server checks (a)-(d) | M4 · 미구현 (OPEN) |
| AC-008a | extended: hash input normalization, real-change and `groupOrder` detection | `engine/profile-content-order.test.ts` (M1, closed) |
| AC-011a | extended: M3 must use the same function and test reorder / change detection | M3 · 미구현 (OPEN) |
| AC-004d, AC-004f | confirmed, not edited | unchanged |

#### OPEN items (not done, not covered)

1. **M4 mandatory validation and tests (D):** (a) selected `treatmentId` without a published line, (b) line whose `treatmentId` was not selected, (c) same `treatmentId` in both `lines` and `baseFeeLines`, (d) `isBaseFee` inconsistent with the array. Not implemented, not tested in M4 yet; whether a violation is a request rejection or a 500 is for the M4 design.
2. **API mapping** of `INPUT_INTEGRITY_VIOLATION` to HTTP 500 `INTERNAL_ERROR` (contract requirement, not implemented until M4).
3. **M3:** the production digest function (canonical with respect to object key order) and the publish/seal path using `profileContent`; reorder / change / `groupOrder` tests (AC-011a).
4. **Owner decision:** the `referenceGroups` tension (reference numbers inside an `ON_HOLD` result) is unchanged.
5. **UNVERIFIED:** formal SPEC lint and `moai verify` (no linter, no `moai` CLI/MCP). Only Windows 11 and Node 24.19.0 were run.
6. The 11 operational-data holds and the deferred decisions (#1, #2, #3, #5, #30, #31, #32 operator/hours, #34, #35) remain open; M2+ is not started.

#### 정리하지 않은 승인 전 표시(매핑 불명확)

These "승인 전" markers have no explicit §E number (or cite a deferred number), so they were left as they are. They may correspond to accepted items (S1, S2, S6-S8, S10, #21 ...), but the SPEC files do not say which, and S1-S15 are not defined anywhere (plan.md §E.9). Line numbers refer to the files as committed by R3.

- Number-less `SPEC 제안 (승인 전)` / `제안, 승인 전` markers: spec.md 189, 203, 204, 274, 327, 397, 398, 399, 400 (327 and 397 sit next to the separate label `잠정 (§E #21)`); spec-compact.md 107, 121, 122, 185, 232, 293, 294, 295, 296; design.md 439, 586, 621, 622, 637, 728, 729, 730, 731, 733, 814, 828, 912 (line 622 still says plan.md §E #21 is open although §E.9 records #21 as accepted); acceptance.md 222, 277, 279, 297, 331, 333, 334, 335, 349; plan.md 348 (the §E.4 row for #36), 403 (§E.8 B4 row, mentions #36 without "§E").
- Deferred numbers, intentionally unchanged: spec.md 424, 430, 444 and spec-compact.md 316, 320, 333 (#30, #34).
- Revision-history row, intentionally unchanged: spec.md 27 (#36).
- Explanatory sentences about the marker vocabulary (not markers): spec.md 77, plan.md 49, 118, 462, design.md 614, 717.
- The plan.md §E.9 "확인 필요" record (plan.md 494-503) still quotes the old wording, by design.

### M1.6 잘못된 프로필 구조 보완 (S1~S2), 2026-10-15

**Scope.** A second external review finding on Draft PR #1: a malformed profile structure should reach the existing `PROFILE_INVALID` hold but threw instead. Two commits on top of the M1.5 documentation commit `b92cb16`, same worktree and branch: S1 (engine fix and tests) and S2 (this documentation commit). No M2+ work, no real insurance value, no merge, no push, no new full audit. The audit result (iteration-5 FAIL 0.89, MP-7, plan_status) and the `spec.md` status (`in-progress`) are untouched.

| Step | Commit | Content |
|------|--------|---------|
| base | `b92cb16` | M1.5 R3 documentation |
| S1 | `b7244eb` | `fix(SPEC-REIMBURSEMENT-001): M1 잘못된 프로필 구조를 예외 없이 PROFILE_INVALID 보류로 처리` (src/engine/profile-structure.ts, tests/engine/profile-structure.test.ts, tests/engine/profile-structure-malformed.test.ts) |
| S2 | (this commit) | documentation alignment (design.md, acceptance.md, progress.md) |

#### S1: malformed profile structure

- **Problem (three defects, one class).** (1) A `groups` entry that is `null` / `undefined` made `checkProfileStructure` throw (`group.groupKey`). (2) A `sharedLimitPools` entry that is `null` / `undefined` threw the same way (`pool.poolKey`). (3) A `sharedLimitPools` that is not an array (`null`, `undefined`, `{}`, a number, `true`, a string) with no group referencing a pool was replaced by `[]`, so the structure check returned ok and `allocatePools` in `estimate()` then threw (`profile.sharedLimitPools is not iterable`; for a string, `reading 'kind'`). Preconditions: the profile carries a `contentHash` that matches the malformed content (tests build it with `withValidHash({ ...makeProfile(), ...overrides })`), so the hash check passes and the structure check is reached.
- **Trace.** On the real path `estimateFront` -> `validateEstimateInput` -> `isBundleUsable` -> `resolveProfile` (`profileToRuleItem` -> `isUsable` -> `checkProfileStructure`) nothing reads `profile.groups` / `sharedLimitPools` entries before the structure check except the tolerant `profileContent` / `sortedByKey`. After a passing structure check the readers are `profileHasGroup` (resolve.ts), `checkGroupValues`, `profile.sharedLimitPools.find`, `allocatePools` and the `groupOrder` walk (estimate.ts). `group-values.ts` substitutes `[]` for a non-array `sharedLimitPools` but is reachable only after the structure check and is exported for M3 readiness; after the fix it is unreachable through `estimate()` for non-array pools and was left unchanged. No bypass route was found.
- **Behaviour now (`src/engine/profile-structure.ts` only).** Before any property is read, each `groups` / `sharedLimitPools` entry must be a non-null, non-array object. Otherwise one defect is reported for that entry and it is not read further: `GROUP_ENTRY_INVALID` (path `groups[i]`) or `POOL_ENTRY_INVALID` (path `sharedLimitPools[i]`); holes of a sparse array count as `undefined` entries. A non-array `sharedLimitPools` is the defect `POOLS_NOT_ARRAY` (path `sharedLimitPools`) instead of being replaced by an empty list; a real `[]` stays valid. The pool-reference check then treats a non-array as "no pools" so other defects are still reported, and it skips non-object groups. Defect order: group shape/keys -> pool array-ness/shape/keys -> pool references -> `groupOrder`; `groups` that is not an array or is empty still returns only `EMPTY_PROFILE`. `resolve.ts`, `estimate.ts`, `group-values.ts`, `usability.ts` are unchanged; there is no try/catch and the input is never mutated.
- **RED (before the fix).** `npx vitest run tests/engine/profile-structure-malformed.test.ts` -> `Tests  41 failed | 38 passed (79)` with `TypeError: Cannot read properties of null / undefined (reading 'groupKey' / 'poolKey')` (raw: `.moai/state/verify/s1/red.txt`).
- **GREEN.** The new file has 79 tests (`TEST_FIXTURE` only): 21 variants = 7 group-entry shapes (`null`, `undefined`, `7`, `"x"`, `[]`, `[1]`, `true`) at `groups[1]`, 7 pool-entry shapes at `sharedLimitPools[1]`, 7 non-array pool shapes (`null`, `undefined`, `{}`, `{length:0}`, `"abc"`, `7`, `true`), each checked for `checkProfileStructure` (no throw, expected defects), `profileContent` / `profileToRuleItem` / `isUsable`, `resolveProfile` (`PROFILE_INVALID`), hash-mismatch variants (`INTEGRITY_MISMATCH`, structure check never called), and `estimate()` end to end (every line `ON_HOLD` / `PROFILE_INVALID`, payout and out-of-pocket null, same result as the existing duplicate-`groupKey` hold, deep-frozen input untouched); plus null mixed with valid groups at index 0 / 2, no follow-on noise, defect order, `EMPTY_PROFILE` early return, `[]` pools stays ok, and a guard test that pins the pre-change `profileContent` string, `contentHash`, structure result and three `estimate()` digests of normal profiles (`TEST_DIGEST_3cec813b`, `TEST_DIGEST_ec1de793`, `TEST_DIGEST_78a047d8`).
- **Existing test changed (the only one).** `tests/engine/profile-structure.test.ts` "sharedLimitPools 가 배열이 아니면 ...": it asserted the old substitution (only `UNKNOWN_POOL_REFERENCE`). It now expects `[POOLS_NOT_ARRAY sharedLimitPools, UNKNOWN_POOL_REFERENCE groups[0].sharedLimitPoolKey]` and its title says so. The reason is the intended behaviour change: a non-array is a defect in itself, not an empty list.
- **Mutation checks (reverted, `git diff` confirmed only the intended change).** (a) Restore the old behaviour for a non-array `sharedLimitPools` (no defect reported) -> `Tests  21 failed | 77 passed (98)`. (b) Make the entry-objectness check always true -> `Tests  26 failed | 72 passed (98)` with `TypeError: Cannot read properties of null / undefined (reading 'groupKey' / 'poolKey')` (raw: `mutation-a.txt`, `mutation-b.txt`).
- **Probe, before -> after (temporary probe test, not committed; raw `probe-before.txt`, `probe-after.txt`).** Columns checked: `profileContent`/`profileToRuleItem`, `checkProfileStructure`, `resolveProfile`, `estimate()`. Rows that threw: 12 before, 2 after (both out of scope, below).

| Malformed shape (hash matches the malformed content) | Before | After |
|---|---|---|
| `groups[1]` = `null` / `undefined` | structure, resolve, estimate THROW `TypeError` (reading `groupKey`) | `GROUP_ENTRY_INVALID groups[1]`, `PROFILE_INVALID`, estimate `ON_HOLD`, payout null |
| `groups[1]` = `7` / `"x"` / `[]` / `true` | `EMPTY_GROUP_KEY` hold | `GROUP_ENTRY_INVALID` hold |
| `groups[1]` = `{}` | `EMPTY_GROUP_KEY` hold | unchanged |
| `sharedLimitPools[0]` = `null` / `undefined` | structure, resolve, estimate THROW `TypeError` (reading `poolKey`) | `POOL_ENTRY_INVALID sharedLimitPools[0]`, hold |
| `sharedLimitPools[0]` = `7` / `"x"` / `[]` / `true` | `EMPTY_POOL_KEY` hold | `POOL_ENTRY_INVALID` hold |
| `sharedLimitPools[0]` = `{}` | `EMPTY_POOL_KEY` hold | unchanged |
| `sharedLimitPools` = `null` / `undefined` / `{}` / `7` / `true` / `"abc"` | structure ok, resolve resolved, **estimate THROWS** | `POOLS_NOT_ARRAY sharedLimitPools`, `PROFILE_INVALID`, estimate `ON_HOLD` |
| `sharedLimitPools` = `[]` | ok, `ESTIMATED` payout 100,000 | unchanged |
| `groupOrder` non-array, `groups` non-array or empty, group / pool value defects | hold (no throw) | unchanged |

- **Assumptions (all hold-leaning).** (1) The three new defect-code names (`GROUP_ENTRY_INVALID`, `POOLS_NOT_ARRAY`, `POOL_ENTRY_INVALID`) are the implementer choice; the hold code stays `PROFILE_INVALID`, no new hold code. (2) An array entry counts as an invalid entry (it is an object in JS but not a group / pool record). (3) Holes in a sparse array are reported as invalid entries. (4) Primitive group / pool entries are now `*_ENTRY_INVALID` instead of `EMPTY_*_KEY`; an object without a usable key stays `EMPTY_GROUP_KEY` / `EMPTY_POOL_KEY`. (5) After `POOLS_NOT_ARRAY` the reference check still runs and treats pools as absent, so a referencing group also reports `UNKNOWN_POOL_REFERENCE`. (6) Only the hash-matches-malformed-content case reaches the structure check; with a non-matching hash the result is `INTEGRITY_MISMATCH` -> `PROFILE_INVALID` before it.
- **Correction of earlier wording.** The R2 note in M1.5 said malformed shapes do not throw and that duplicate-key structure rejection was covered. Precisely: R2 verified the tolerance of `profileContent` / `profileToRuleItem` and that duplicate `groupKey` / `poolKey` give `PROFILE_INVALID` through the structure check. It did not exercise the full path structure check -> `resolveProfile` -> `estimate()` for null / non-object entries or a non-array `sharedLimitPools`; those threw until S1. The R2 line is annotated in place, not deleted.

#### Verification (verbatim tails, this session, HEAD `b7244eb`; raw files in the gitignored `.moai/state/verify/s1/`)

```
$ npx vitest run tests/engine tests/boundary   -> exit 0
 Test Files  28 passed (28)
      Tests  1142 passed (1142)
$ npx tsc --noEmit                              -> exit 0, empty output (0 bytes)
$ npx vitest run --coverage tests/engine        -> exit 0
 Test Files  25 passed (25)
      Tests  936 passed (936)
14 files fully covered.
Statements   : 100% ( 497/497 )
Branches     : 100% ( 409/409 )
Functions    : 100% ( 117/117 )
Lines        : 100% ( 456/456 )
```
Counts: base `b92cb16` 27 files / 1063 tests (857 under `tests/engine`); S1 +1 file / +79 tests -> 28 / 1142 (936). Coverage is 100% in all 14 `src/engine` files with no exclusions. S2 changed only SPEC documents; `git diff --check` was clean and every SPEC file kept all lines CRLF (counts in the commit report). Formal lint and `moai verify` are UNVERIFIED (no linter configured, `moai` CLI/MCP absent).

#### AC mapping for the extended sub-criteria

| AC | Change | Where proven |
|----|--------|--------------|
| AC-008a | extended: the structure-defect row now also lists non-object `groups` / `sharedLimitPools` entries and a non-array `sharedLimitPools`; a malformed profile reaches `PROFILE_INVALID` without an exception | `engine/profile-structure-malformed.test.ts`, `engine/profile-structure.test.ts` (M1, closed) |
| AC-008m | covered by the AC-008a row it references; no wording change | same |
| other AC | none; no new AC id, so no AC count changes | - |

#### OPEN items (not done, not covered)

1. **Bundle container entries, not fixed (different class, out of this review point).** `bundle.profiles = [null, validProfile]` throws `TypeError: Cannot read properties of null (reading 'generation')` in `resolveProfile` (the `bundle.profiles` filter, resolve.ts) and in `estimate()`; `bundle.mappings = [null, ...]` makes `resolveProfile` resolve but `estimate()` throws `TypeError: Cannot read properties of null (reading 'treatmentId')` (the mapping candidate filter). `bundle.profiles = null` is a `PROFILE_ABSENT` hold and is fine. These are entry-objectness defects of the bundle containers; whether to reject, skip or hold them is for the owner / M3 publish validation. [관리 위치 지정 (M1.7): M3 게시 검증 + M4 읽기 경로 구조 검증. 여전히 OPEN — 미구현·미검증]
2. M1.5 OPEN items 1-6 remain open (M4 mandatory validation, HTTP 500 mapping, M3 digest and publish path, `referenceGroups` tension, formal lint UNVERIFIED, 11 operational-data holds and deferred decisions); M2+ is not started.
3. **Publish validation (M3):** the same `checkProfileStructure` is the publish-time check (DD-02), so a non-object entry or a non-array pool list is now rejected at publish with its field path; M3 tests should include these shapes.

### M1.7 후속 관리 항목 연결 (문서만), 2026-10-15

**Scope.** Documentation only; one commit on top of `02c847a` (`(this commit)`). The user reported that the external re-review of the profile-structure fix (`b7244eb` + `02c847a`) passed; this is recorded as a user report, NOT as an audit result. The formal audit result stays as recorded (iteration-5 FAIL 0.89, MP-7, plan_status unchanged) and no new audit was run. By user decision no further M1 code change was made: the bundle-container null-entry throws (M1.6 OPEN item 1) are NOT fixed in M1 and the engine keeps throwing for them. No M2+ work, no merge, no deploy, no push, no new AC ids, no AC count change. spec.md and design.md were not edited; their wording will be aligned when the M3 / M4 design is detailed (a statement of fact, not a claim it is done).

**What was linked, and where (file : line numbers refer to the files as committed here).**

| Responsibility | Where recorded | Stage | Status |
|----------------|----------------|-------|--------|
| Publish validation rejects a rule bundle whose `profiles` / `mappings` is not an array or has an entry that is not a non-null non-array object (null, undefined, primitive, array); rejection stores nothing, existing rejection path (AC-011h / AC-011i, 400 with field path via AC-021f); test inputs (M1.8: `profiles = null` and `mappings = null` are named separately) | plan.md M3 section, new bullet "M3 필수 검증·시험: 규칙 묶음 항목의 데이터 무결성" (after the profile-content-hash bullet); acceptance.md AC-011i new sub-bullet "M3 · 미구현 (필수 하위 기준 — 묶음 항목의 형식)" (after the bundle cross-check sub-bullet) and a pointer sentence at the end of AC-011h | M3 | NOT IMPLEMENTED, NOT VERIFIED |
| Server validates the bundle structure after reading it from the store and before calling the engine; a defect is a server data-integrity defect -> HTTP 500 `INTERNAL_ERROR` with no amounts, no treatmentId, no internal detail, no result object; applies only to a bundle that passed the existing bundle-level pre-judgment | plan.md M4 section, new bullet "M4 필수 검증·시험: 읽어 온 규칙 묶음의 구조" (after the existing M4 mandatory-validation bullet); acceptance.md AC-006i, new clause "M4 · 미구현 (필수 하위 기준 — 읽어 온 규칙 묶음의 구조)" | M4 | NOT IMPLEMENTED, NOT VERIFIED |
| Precedence kept unchanged and made a completion condition with tests: no scope (`bundle = null`) -> `CLINIC_RULE_SCOPE_ABSENT`, then `SUSPENDED` -> 200 `ON_HOLD` `RULE_BUNDLE_SUSPENDED` without reading any bundle item (AC-008g, AC-008l); test (iv) SUSPENDED bundle with the same defects still returns the 200 `ON_HOLD`, test (v) no scope still `CLINIC_RULE_SCOPE_ABSENT` | plan.md M4 bullet and acceptance.md AC-006i clause (above) | M4 | NOT IMPLEMENTED, NOT VERIFIED |

Out of scope of these items (stated in one clause in each place): `documentRuleSet` entries and other bundle fields. [SUPERSEDED by M1.8: decided — `profiles = null` / `mappings = null` on an `ACTIVE` bundle are structure defects (M3 publish rejection, M4 read-path HTTP 500); see the M1.8 block.] Not decided here and left to the M4 design: the meaning of a `null` `profiles` for an `ACTIVE` bundle (the current engine returns a `PROFILE_ABSENT` hold for it); test (vi) was therefore left out. The M1.6 OPEN item 1 above carries the annotation "관리 위치 지정 (M1.7)"; it is still OPEN.

**Verification of this step (verbatim tails, HEAD `02c847a` before this commit, raw files in the gitignored `.moai/state/verify/s1/t1-*.txt`).**

```
$ npx vitest run tests/engine tests/boundary   -> exit 0
 Test Files  28 passed (28)
      Tests  1142 passed (1142)
$ npx tsc --noEmit                              -> exit 0, empty output (0 bytes)
$ npx vitest run --coverage tests/engine        -> exit 0
 Test Files  25 passed (25)
      Tests  936 passed (936)
14 files fully covered.
Statements   : 100% ( 497/497 )
Branches     : 100% ( 409/409 )
Functions    : 100% ( 117/117 )
Lines        : 100% ( 456/456 )
$ git diff 02c847a HEAD --stat -- src tests     -> (empty)
```
The totals equal the M1.6 totals (28 files / 1142 tests; `tests/engine` 25 files / 936 tests; coverage 497/409/117/456), so `src/` and `tests/` are unchanged. Formal lint and `moai verify` remain UNVERIFIED (no linter configured, `moai` CLI/MCP absent).

**OPEN (unchanged status).** (1) M3: bundle item publish validation, rejection tests (AC-011i, M3 · 미구현; M1.8: `profiles = null` and `mappings = null` named separately). (2) M4: read-path bundle structure check -> 500 plus the precedence tests (iv) / (v) (AC-006i, M4 · 미구현). (3) M4 design: the `profiles = null` case. [SUPERSEDED by M1.8: the policy is decided (structure defect: M3 reject / M4 HTTP 500); the implementation is still NOT IMPLEMENTED and NOT VERIFIED under items (1) and (2).] (4) All earlier OPEN items of M1.5 and M1.6 remain open; M2+ is not started.

### M1.8 bundle 내부 null 예외 정리 (문서만), 2026-10-15

**Scope.** Documentation only; one commit on top of `75dc21c` (`(this commit)`). By user decision after reviewing `75dc21c`: the M1 close judgement stands and NO further M1 code change was made (`src/` and `tests/` are byte-identical to `75dc21c`). The user reported that the external re-review of the profile-structure fix passed; this is recorded as a user report, NOT as an audit result. The formal audit result stays as recorded (iteration-5 FAIL 0.89, MP-7, plan_status unchanged) and no new audit was run. No M2+ work, no merge, no deploy, no new AC ids, no AC count change. By user instruction the full test suite was NOT re-run for this commit because the code is identical to `75dc21c`; the last full run on `75dc21c` (28 files / 1142 tests, `tsc` exit 0, coverage 497/409/117/456) remains the only code evidence.

**Decision recorded (user, M1.8).**

- An `ACTIVE` bundle whose `profiles` or `mappings` is not an array (`null`, `undefined`, object, string, ...) is a structure defect: M4 structure validation returns HTTP 500 `INTERNAL_ERROR` (no amounts, no treatmentId, no internal detail, no result object). `profiles = null` and `mappings = null` are covered by the same rule and are named as separate tests. The earlier wording that left `profiles = null` to the M4 design is removed from plan.md and acceptance.md.
- M3 publish validation rejects the same shapes (and `null` entries) with the existing rejection path; `profiles = null` and `mappings = null` are named as separate required tests.
- A normal empty array `[]` is valid. The existing engine judgement for "no profile / no mapping" (hold codes such as `PROFILE_ABSENT`, `MAPPING_ABSENT`) is unchanged.
- The bundle-level pre-judgment stays first and unchanged: no scope (`bundle = null`) -> `CLINIC_RULE_SCOPE_ABSENT`, then `SUSPENDED` -> 200 `ON_HOLD` `RULE_BUNDLE_SUSPENDED`. Neither path reads any bundle item, so a `SUSPENDED` bundle carrying `profiles = null` / `mappings = null` still returns the 200 `ON_HOLD`, not a 500.

**What was changed, and where.**

| File | Change |
|------|--------|
| plan.md M3 bullet | Test inputs now list `null` profile entry, `null` mapping entry, `profiles = null`, `mappings = null` (each separately) and other non-array values; `[]` is not a format defect. |
| plan.md M4 bullet | Test (iii) covers every non-array `profiles` / `mappings` on an `ACTIVE` bundle with `null` named separately; (iv) `SUSPENDED` with the same defects (including `null`) stays 200 `ON_HOLD`; (v) no scope stays `CLINIC_RULE_SCOPE_ABSENT`; new (vi) `[]` is valid. The "left to the M4 design" sentence was replaced by the current engine behaviour and the M4 responsibility. |
| acceptance.md AC-006i | Same changes in the `M4 · 미구현` read-path clause. |
| acceptance.md AC-011i | Same changes in the `M3 · 미구현` sub-bullet. |
| progress.md | M1.7 table row, the M1.7 "Not decided here" sentence and M1.7 OPEN items (1) and (3) carry `SUPERSEDED by M1.8` annotations; their original text is kept. |

spec.md, spec-compact.md and design.md were not edited; their wording will be aligned when the M3 / M4 design is detailed (a statement of fact, not a claim it is done).

**Unchanged on purpose.** The M1 engine is untouched: it still treats a non-array `bundle.profiles` / `bundle.mappings` as an empty list (M1.2 assumption 9) and still throws `TypeError` for `bundle.profiles = [null, ...]` and `bundle.mappings = [null, ...]`. There is no catch-all and no engine guard; the guarantee must come from the M3 and M4 layers.

**Status (nothing here is resolved).** NOT IMPLEMENTED and NOT VERIFIED: (1) M3 publish rejection of malformed bundle containers and entries (AC-011i). (2) M4 read-path structure validation -> HTTP 500 for `ACTIVE` bundles (AC-006i). (3) The precedence integration tests (iv) and (v). M1.6 OPEN item 1 remains OPEN. All earlier OPEN items of M1.5, M1.6 and M1.7 remain open; M2+ is not started. Formal lint and `moai verify` remain UNVERIFIED.

### M2 서류 산출 엔진 (M2.A~M2.C), 2026-10-15

**Scope and branch.** Milestone M2 (documents engine) only. Branch `feature/SPEC-REIMBURSEMENT-001-m2-documents` was created from the M1 tip `b27bf38`; the M1 branch `feature/SPEC-REIMBURSEMENT-001-m1-engine` and Draft PR #1 are untouched. M2 is a separate stacked branch; its pull request is separate, with the M1 branch as its base, so only M2 changes show. The owner approved M2 only: no M3+ work, no merge, no deploy, no push from the implementer, no new audit. The audit result (iteration-5 FAIL 0.89, MP-7, plan_status) and the `spec.md` status (`in-progress`) are untouched. All data is `TEST_FIXTURE`; no real insurer document requirement, clause text or approval record exists anywhere in `src/` or `tests/`.

| Step | Commit | Content |
|------|--------|---------|
| base | `b27bf38` | M1 tip (28 files / 1142 tests, coverage 497/409/117/456) |
| M2.A | `89b9fef` | `feat(SPEC-REIMBURSEMENT-001): M2.A 서류 규칙 형식·구조 검사·사용 가능 판정 연결` (types, hash input, structure check, rule-set selection, fixture) |
| M2.B | `1708bfa` | `feat(SPEC-REIMBURSEMENT-001): M2.B deriveDocuments 서류 산출 (AC-007a·b·c·d·e·h·j·k·l)` |
| M2.C | (this commit) | this progress record (progress.md only; no src, no tests, no other SPEC file) |

#### What was built

| File | Change |
|------|--------|
| `src/engine/types.ts` | Additive (+65 lines, 0 deletions): `Cause`, `DocumentWhen`, `DocumentFlags`, `DocumentScope`, `DocumentLine`, `DocumentsResult`, `DOCUMENT_LINE_KEYS` (the fixed 9 keys in the design order), `DOCUMENT_CODE_LINE` (10 codes to 9 lines; only `RECEIPT` and `ITEMIZED_STATEMENT` share `RECEIPT_AND_ITEMIZED`) |
| `src/engine/usability.ts` | Additive (+104 lines, 0 deletions): `documentRuleSetContent` (THE single hash-input function for a document rule set, used by both the M3 sealing side and the engine verifying side) and `documentRuleSetToRuleItem`; `isUsable` and `isBundleUsable` are reused unchanged |
| `src/engine/documents.ts` | New in M2.A, extended in M2.B: `checkDocumentRuleSetStructure` (pure, non-throwing, shared with M3 publish validation), `selectDocumentRuleSet` (`isBundleUsable` first, then `isUsable`, then structure; any failure -> null), `deriveDocuments` and `DeriveDocumentsInput` |
| `tests/fixtures/engine/document-rules.fixture.ts` | New, `TEST_FIXTURE` only; every reason sentence ends with the mark "(검증 필요 · 시험 자료)"; reproduces the planning-document §4 conditional-mapping example; three variants for AC-007h (2 injury-only + 3 illness-only, 0 + 4, 0 + 0) with expected scope outcomes; builders `rule`, `plainRule`, `ruleSetOf`, `documentInput`, `treatmentWith` |

Existing M1 source files changed additively only. `estimate()` and its result are untouched: there is no `documents` field in the estimate result (documents are not part of `estimate()`, DD-01). No existing test was modified.

| New test file | Tests | Step |
|---------------|-------|------|
| `tests/engine/document-line-keys.test.ts` | 7 | M2.A |
| `tests/engine/document-rule-set-content.test.ts` | 38 | M2.A |
| `tests/engine/document-rule-set-structure.test.ts` | 92 | M2.A |
| `tests/engine/document-rule-set-select.test.ts` | 38 | M2.A |
| `tests/engine/documents.test.ts` | 50 | M2.B |
| `tests/engine/documents-when.test.ts` | 35 | M2.B |
| `tests/engine/documents-order.test.ts` | 18 | M2.B |

Total 278 new tests (175 in M2.A, 103 in M2.B): 1142 + 278 = 1420.

#### Evidence (measured on `1708bfa`; the orchestrator independently verified these numbers, and the implementer measured the same)

```
$ npx vitest run tests/engine tests/boundary   -> exit 0
 Test Files  35 passed (35)
      Tests  1420 passed (1420)
$ npx tsc --noEmit                              -> exit 0, empty output (0 bytes)
$ npx vitest run --coverage tests/engine        -> exit 0
 Test Files  32 passed (32)
      Tests  1214 passed (1214)
15 files fully covered.
Statements   : 100% ( 643/643 )
Branches     : 100% ( 551/551 )
Functions    : 100% ( 145/145 )
Lines        : 100% ( 598/598 )
```
Baseline `b27bf38`: 28 files / 1142 tests; `tests/engine` 25 files / 936; coverage 497/409/117/456. Now: 35 files / 1420 tests; `tests/engine` 32 files / 1214; coverage 643/551/145/598, every `src/engine` file at 100% with no exclusions (`documents.ts` included). The `tests/boundary` import and literal scans pass with the new source file (no fixture import; no business-named numeric literal).

**RED before GREEN.** M2.A: the new tests were run with the new src additions taken out -> `Tests  5 failed | 2 passed (7)` plus three files failing to load (missing exports / `Cannot find module .../documents`); the implementation had been drafted first in M2.A, so RED was obtained by removing it, and it was restored afterwards. M2.B: tests written before the implementation -> `Tests  34 failed | 1 passed (35)`, every failure `TypeError: deriveDocuments is not a function` (34 rather than 103 because parameterised `it.each` cases are counted as one entry when the function is missing); then GREEN `Tests  103 passed (103)` for the three new files.

**Mutation checks (each RED, then restored and confirmed identical to its backup).**

| Step | Mutation | Result |
|------|----------|--------|
| M2.A | remove the `rules` sort in `documentRuleSetContent` | `12 failed \| 64 passed (76)` (reorder-with-original-hash and content tests) |
| M2.A | `selectDocumentRuleSet` reads the rule-set item before `isBundleUsable` | `1 failed \| 37 passed (38)` (the no-item-read test) |
| M2.B | break priority ties by array position (first match) | `7 failed \| 96 passed (103)` |
| M2.B | COMMON reasons keep only the injury reason | `6 failed \| 97 passed (103)` |
| M2.B | aggregate the document flags with AND instead of OR | `9 failed \| 94 passed (103)` |
| M2.B | remove the hold (overall state) check | `7 failed \| 96 passed (103)` |
| M2.B | UNKNOWN cause evaluates only INJURY | `14 failed \| 89 passed (103)` |
| M2.B | compare reasons with plain `<` instead of code points | `1 failed \| 102 passed (103)` (only the U+FF5E vs U+1F600 test, as intended) |
| orchestrator | independent mutation: reason tie-break disabled | `7 failed \| 96 passed (103)`, restored, tree clean |

#### AC table

Status of the rows below: `CLOSED at unit level (M2)`.

| AC | Test file and describe name | What is checked |
|----|-----------------------------|-----------------|
| AC-007a | `documents.test.ts` "AC-007a ..." | planning-example set x cause (3) x insurerType (3) x flag combinations (8) = 72 inputs: nine distinct keys in the fixed order, `RECEIPT_AND_ITEMIZED` required; empty `rules: []` -> only the receipt line required, no reasons |
| AC-007b | `documents.test.ts` "AC-007b ..." | INJURY -> `INITIAL_EXAM_RECORD` with its reason, ILLNESS -> `DIAGNOSIS_CERT`; a line demanded by several rules shows exactly the single highest-priority reason |
| AC-007c | `documents.test.ts` "AC-007c ..." | planning-example set, UNKNOWN, no flags, outpatient: the full nine-line list (required, scope, reasons), 7 COMMON + `INITIAL_EXAM_RECORD` INJURY_ONLY + `DIAGNOSIS_CERT` ILLNESS_ONLY; one extra INJURY rule gives 6 + 2 + 1, showing 7+1+1 is only this example outcome, not a cap |
| AC-007d | `documents.test.ts` "AC-007d ..." | null set with each non-hold state; `OPERATING`-only accepted origins with a `TEST_FIXTURE` bundle; no scope, SUSPENDED, each `isUsable` failure, sealed-but-defective set; malformed sets passed straight in -> `RULES_UNAVAILABLE` without throwing |
| AC-007e | `documents.test.ts` "AC-007e ..." | ON_HOLD -> null for a valid, a null and a defective set; unknown state values -> null; feeding the real `estimate()` state: ESTIMATED and ESTIMATED_WITH_EXCLUSIONS -> AVAILABLE, SUSPENDED bundle / profile absent / no scope -> null |
| AC-007h | `documents.test.ts` "AC-007h ..." | the three fixture variants: nine keys once each, scopes equal the expected outcomes, every required line (receipt included) has a reason; COMMON reasons (3 vs 5, 5 vs 3, tie -> injury first, identical text -> one); cause never collapsed |
| AC-007j | `documents-when.test.ts` "AC-007j (1)/(3)/(4)/(5)" | `when` key matrix for cause, setting, insurerType; non-matching input is `JSON.stringify`-identical to the baseline; every key pair and key+flag pair has an effect only when both match; missing keys are wildcards; `when: {}` matches all 72 inputs |
| AC-007k | `documents-when.test.ts` "AC-007k ..." | per flag: one/two/three flagged treatments in every permutation give identical results (OR), none flagged is baseline-identical; several rules for one line; `RECEIPT` and `ITEMIZED_STATEMENT` rules landing on one line; type-level check that treatment elements carry no line state; every element counted |
| AC-007l | `documents-order.test.ts` "AC-007l (1)-(5)" | priority 0 / 1 / `MAX_SAFE_INTEGER`; U+FF5E vs U+1F600 (a naive `<` picks the other winner); full ties; all 720 permutations of 6 rules x 3 causes; fixed-seed shuffles (seed 20261015, 200 trials, recorded in the test name and a `console.info` line); all 24 treatment permutations; mixed UNKNOWN set |

**NOT closed, and why.**

- AC-007f (publish validation, integration): the pure structure function `checkDocumentRuleSetStructure` exists and M3 must reuse it, but the publish path and repository are NOT implemented.
- AC-007g (e2e-app) and AC-007i (render + e2e-app): the kiosk screens belong to M6.
- AC-008g: only the "documents = null on a held result" half is evidenced, by the AC-007e tests fed with real `estimate()` states. AC-008g itself is NOT claimed closed.
- AC-011o (documents `RULES_UNAVAILABLE` integration with a suspended / under-re-review rule set): M3 / M4, NOT done.

#### Decisions and assumptions

Items marked **[not in docs]** are implementer decisions that design.md / acceptance.md do not state; the others follow the documents.

1. **[not in docs]** The hold check is a whitelist: only `ESTIMATED` and `ESTIMATED_WITH_EXCLUSIONS` pass; `ON_HOLD` (spec), any other state value and a non-object input return null.
2. **[not in docs]** `deriveDocuments` also runs `checkDocumentRuleSetStructure` and returns `RULES_UNAVAILABLE` for a null or malformed set (a last safety net). It does no header checks (state, origin, approver): `selectDocumentRuleSet` owns usability, so a structurally valid DRAFT set passed straight to `deriveDocuments` yields AVAILABLE (pinned by a test).
3. **[not in docs]** A `cause` value that is none of INJURY / ILLNESS / UNKNOWN is evaluated as UNKNOWN (two evaluations); no cause is ever picked.
4. **[not in docs]** Malformed `treatments` (not an array, a non-object element, a non-object `documentFlags`, flag values that are not strictly `true`) add no flag and never throw. This is a soft spot until M4 builds `treatments` from validated lines (AC-019d).
5. **[not in docs]** A garbage `insurerType` or `clinicSetting` matches no `insurerType` / `setting` rule and does not throw. `setting: OUTPATIENT` matches only when `clinicSetting` is `OUTPATIENT_ONLY`; `INPATIENT` never matches (design.md DD-06 rule 5).
6. **[not in docs]** Output lines always use the `DOCUMENT_LINE_KEYS` order for all nine lines regardless of scope (DD-03 is silent about document-line order).
7. **[not in docs]** A line object has the fixed property order `line, required, scope, reasons` and omits absent properties (no `undefined` keys), so serialised comparison is meaningful. SINGLE_CAUSE lines carry no `scope`; `reasons` is a one-element array only for a required line with a winner.
8. COMMON reason ordering is priority ascending, a tie puts the INJURY winner first (design.md:508, SPEC proposal). **[not in docs]** Identical reason text collapses to one entry even when the priorities differ (the earlier one is kept).
9. Only `RECEIPT_AND_ITEMIZED` can be required without a reason. **[not in docs]** If only one of the two evaluations has a winner for it, that one reason is shown.
10. **[not in docs] OWNER DECISION NEEDED:** an empty `rules: []` is a VALID set (the result is the receipt line only). design.md:509 and AC-007f list no such rejection and say the number of rules is never a reason to reject. Whether publish validation should reject an empty set is for the owner.
11. **[not in docs]** `reason` only has to be a non-empty string (a whitespace-only reason passes); `priority` -0 is accepted as 0.
12. **[not in docs]** `deriveDocuments` copies `id`, `version` and `origin` of the rule set through unchecked; origin acceptance is vetted by `selectDocumentRuleSet` through `isUsable`.
13. **[not in docs]** The hash input of `documentRuleSetContent` sorts a copy of `rules` by `documentCode` (code-point order), `priority` (ascending; non-numbers after all numbers), `reason` (code-point order), then a hand-built `when` key (keys sorted, `key=type:value` joined with `;`). A malformed `rules` (not an array, or an entry that is not a non-null non-array object, holes included) is left exactly as given. Header fields and `contentHash` are excluded. A rule set sealed under any other scheme would not verify: M3 MUST seal with this same function and MUST test both reorder-with-original-hash and change detection (same contract as `profileContent`); the production digest must be canonical with respect to object key order.
14. **[not in docs]** The structure check defect codes `RULE_SET_NOT_OBJECT`, `RULES_NOT_ARRAY`, `RULE_ENTRY_INVALID`, `DOCUMENT_CODE_INVALID`, `REASON_INVALID`, `PRIORITY_INVALID`, `WHEN_NOT_OBJECT`, `WHEN_UNKNOWN_KEY`, `WHEN_VALUE_INVALID` and their paths (for example `rules[3].when.imaging`, root `ruleSet`) are implementer choices, not owner-confirmed. The check does not look at `id`, `version` or header fields.
15. **[not in docs]** The planning-document example fixture maps "통원" to BOTH `OUTPATIENT_CONFIRMATION` and `TREATMENT_CONFIRMATION`, and adds two `when: {}` rules (`RECEIPT`, `ITEMIZED_STATEMENT`) so the always-required line has a reason. These are fixture choices marked "검증 필요"; the four expected-outcome constants written in M2.A matched the real implementation (a `required` list was added to each).

#### OPEN items (not done, not covered)

1. **M3:** publish validation of document rule sets using `checkDocumentRuleSetStructure`, and sealing with `documentRuleSetContent` (AC-007f; hash tests in the AC-011a style: reorder with the original hash, change detection) - NOT IMPLEMENTED.
2. **M4:** the server builds `treatments` from validated lines and passes confirmed-excluded treatments but not base-fee lines (AC-019d), calls `selectDocumentRuleSet` and then `deriveDocuments` with the `estimate()` overall state, and returns `documents` - NOT IMPLEMENTED. The M1.8 bundle-structure 500 rule does not cover `documentRuleSet` entries (out of scope there); `selectDocumentRuleSet` and `deriveDocuments` fail closed to `RULES_UNAVAILABLE`.
3. **M6:** the kiosk document screens (AC-007g, AC-007i).
4. design.md / acceptance.md wording is not yet aligned with the decisions in items 1-15 above (a statement of fact, not a claim it is done).
5. Design ambiguities met in M2 (file:line as reported): design.md:508 (cardinality of COMMON reasons beyond "distinct, in priority order"); design.md:342-353 (silent about the order of document lines); design.md:500 vs acceptance.md:110 (order of the hold check and the unavailable check); design.md:509 (header items "출처·약관 출처·승인자·내용 해시" are listed with the rule structure but are item-level checks); design.md:509 and :524 (no path convention for a `when` that is not an object or a rule set that is not an object).
6. All earlier OPEN items of M1.5 to M1.8 remain open: the M4 mandatory validations (a)-(d), the HTTP 500 mappings, the M3 production digest and publish path, bundle null entries (M3 rejection / M4 500), the `referenceGroups` owner decision, the 11 operational-data holds and the deferred owner decisions. Formal SPEC lint and `moai verify` remain UNVERIFIED (no tool). Only Windows 11 and Node 24.19.0 were run, with no CI. M3+ is not started; PR #1 is not merged. No real insurance values or insurer document requirements are registered anywhere.

### M2.D 외부 검토 보완 (비정상 입력 처리), 2026-10-16

**Scope and base.** Supplement to M2 only, base `ef8d687` (branch `feature/SPEC-REIMBURSEMENT-001-m2-documents`), answering the external review of PR #2 (invalid-input handling in the documents engine). No M3+ work, no merge, no deploy, no new SPEC audit, no commit/push by the implementer. `types.ts`, `usability.ts` (so the hash input `documentRuleSetContent`), M1 code and all fixtures are unchanged; `spec.md` / `plan.md` / `acceptance.md` / `design.md` and the earlier M2 block above are untouched. All data is `TEST_FIXTURE`.

#### What changed

| File | Change |
|------|--------|
| `src/engine/documents.ts` | `collectFlags` now returns `Record<FlagKey, boolean> \| null` (null = invalid input) so validation and OR aggregation are one pass over `treatments` by index; three small readonly enum lists (`CAUSE_VALUES`, `INSURER_TYPE_VALUES`, `CLINIC_SETTING_VALUES`); `deriveDocuments` returns `RULES_UNAVAILABLE` when any input defect is found, after the unchanged null checks; `checkDocumentRuleSetStructure` requires `reason.trim().length >= 1`; the stale comments and docstrings ("bad input counts as no flag", "any other value is UNKNOWN", "reason only has to be non-empty") were replaced |
| `tests/engine/documents.test.ts` | Expectations of the bad-`cause`, malformed-`treatments` and garbage-`insurerType`/`clinicSetting` tests changed to `RULES_UNAVAILABLE`; whitespace-only reasons added to the malformed rule-set list; new groups: mixed arrays, per-flag matrix, positive controls, ON_HOLD precedence, reason original text, no throw / no mutation of invalid inputs |
| `tests/engine/document-rule-set-structure.test.ts` | The test that accepted a whitespace-only reason now expects `REASON_INVALID` at `rules[1].reason` (7 whitespace kinds); added padded-reason-valid and defect-order tests; `rules: []` test retitled (it already existed, not duplicated) |
| `tests/engine/document-rule-set-select.test.ts` | Added: sealed set with a whitespace-only reason -> `null` through `selectDocumentRuleSet`; sealed set with a padded reason (' 사유 ') still selected as the same object |

#### Decisions (M2.D)

1. Order of results is unchanged: non-object input -> `null`; `overallState` not `ESTIMATED` / `ESTIMATED_WITH_EXCLUSIONS` (including `ON_HOLD` and unknown values) -> `null` and it wins over every other defect; then any input defect -> `{ state: 'RULES_UNAVAILABLE' }`; otherwise `AVAILABLE` as before. Never throws, never uses data partially, never mutates the input.
2. `treatments` that is not an array -> `RULES_UNAVAILABLE`. Any element that is not a non-null, non-array object (null, undefined, primitives, arrays, sparse-array holes) -> `RULES_UNAVAILABLE`. `documentFlags` missing, null, not an object or an array -> `RULES_UNAVAILABLE`.
3. `documentFlags.imaging`, `.biopsy`, `.opinionRequired` must each be `typeof === 'boolean'`; strings ("true"), numbers (0/1), null, undefined and missing keys are invalid, with no coercion. `false` is valid.
4. Mixed arrays (valid and invalid elements) are invalid as a whole; the valid elements are not counted.
5. `cause` must be exactly `INJURY`, `ILLNESS` or `UNKNOWN`; anything else (empty string, wrong case, null, undefined, numbers ...) -> `RULES_UNAVAILABLE`, no fallback to UNKNOWN. Explicit `UNKNOWN` keeps the two-evaluation `UNKNOWN_CAUSE` behaviour.
6. `insurerType` must be exactly `NON_LIFE`, `LIFE` or `MUTUAL_AID`; `clinicSetting` must be exactly `OUTPATIENT_ONLY`.
7. Empty `treatments: []` stays valid (all flags false, as before). Valid all-false flags stay valid. Extra properties on treatment elements and on `documentFlags` are allowed.
8. `reason` must be a string with `trim().length >= 1`; whitespace-only reasons (space, tab, newline, CRLF, mixed, U+00A0, U+3000) -> `REASON_INVALID` at `rules[i].reason`, the same code and path as the empty string. This is only a validity judgement: the original text of a valid reason is never trimmed or modified (output `reasons`, and the hash input `documentRuleSetContent`, carry the raw string).
9. An empty `rules: []` is VALID under the current structure contract (`checkDocumentRuleSetStructure` returns `{ ok: true }`; the result is the receipt line only). This is a statement of the contract, not an open owner/business question.

**Superseded decisions.** M2 decisions 3, 4, 5 and 11 above are superseded by M2.D (3: a bad `cause` is no longer evaluated as UNKNOWN; 4: malformed `treatments` no longer add no flag but make the result `RULES_UNAVAILABLE`; 5: garbage `insurerType` / `clinicSetting` no longer just fail to match but make the result `RULES_UNAVAILABLE`; 11: a whitespace-only `reason` no longer passes). M2 decision 10 ("OWNER DECISION NEEDED" on an empty `rules: []`) is closed as: an empty `rules: []` is valid under the current structure contract (decision 9 here).

#### RED before GREEN (exact statement)

M2.D: tests were modified/written first, then the implementation was changed (test-first); this is distinct from M2.A, where the implementation was drafted first and RED was obtained by removing it, and from M2.B, where tests were written before the implementation. For M2.D the tests were edited while `src/engine/documents.ts` was still at `ef8d687`, and RED was run before any source edit.

```
$ npx vitest run tests/engine/documents.test.ts tests/engine/document-rule-set-structure.test.ts tests/engine/document-rule-set-select.test.ts   -> exit 1 (RED, source unchanged)
 Test Files  3 failed (3)
      Tests  54 failed | 213 passed (267)
$ (same command after the source change)                                                   -> exit 0 (GREEN)
 Test Files  3 passed (3)
      Tests  267 passed (267)
```

The RED failures include, for example, the `documentFlags 가 null`, `희소 배열의 빈 칸`, `표시값 imaging 만 틀려도 ...`, `원인이 정확히 INJURY·ILLNESS·UNKNOWN 이 아니면 ...`, `공백뿐인 문자열(탭)은 ... REASON_INVALID` and `공백뿐인 reason(...)이 든 묶음은 ... null 이다` cases. The ON_HOLD / unknown-state precedence tests, the reason-original-text tests and the positive controls pass in RED on purpose: they pin behaviour that must not change (ON_HOLD precedence is checked by mutation (d) below). One test title in the ON_HOLD group was reworded after the RED run (names only, no assertion change).

#### Evidence (measured after the change; the full set was run with `--maxWorkers=4` to avoid load noise; outputs saved under `.moai/state/verify/m2d/`, gitignored)

```
$ npx vitest run tests/engine tests/boundary --maxWorkers=4     -> exit 0   (vitest-all.txt; re-run after the mutation checks: vitest-all-post.txt, exit 0)
 Test Files  35 passed (35)
      Tests  1507 passed (1507)
$ npx tsc --noEmit                                               -> exit 0   (tsc.txt; re-run after the mutation checks: tsc-post.txt, exit 0)
$ npx vitest run --coverage tests/engine --maxWorkers=4          -> exit 0   (coverage.txt; re-run after the mutation checks: coverage-post.txt, exit 0)
 Test Files  32 passed (32)
      Tests  1301 passed (1301)
Statements   : 100% ( 652/652 )
Branches     : 100% ( 558/558 )
Functions    : 100% ( 145/145 )
Lines        : 100% ( 606/606 )
```

Before M2.D (`ef8d687`, measured by the orchestrator): 35 files / 1420 tests; coverage 643/551/145/598. Now: 35 files / 1507 tests (+87, all in the three changed test files: 180 -> 267); coverage 652/558/145/606, still 100% with no exclusions. No `skip`, `only` or disabled test was added.

#### Mutation checks (each run with `npx vitest run tests/engine --maxWorkers=4`, then restored)

| Mutation | Result |
|----------|--------|
| (a) revert the reason `trim()` to the old `reason === ''` check | `Test Files  3 failed \| 29 passed (32)`, `Tests  18 failed \| 1283 passed (1301)` |
| (b) a bad `cause` falls back to UNKNOWN again (the `CAUSE_VALUES` check removed) | `Test Files  1 failed \| 31 passed (32)`, `Tests  4 failed \| 1297 passed (1301)` |
| (c) skip the non-boolean flag check (truthy accepted) | `Test Files  1 failed \| 31 passed (32)`, `Tests  7 failed \| 1294 passed (1301)` |
| (d) validate the input before the `overallState` check (ON_HOLD with bad input returns `RULES_UNAVAILABLE`) | `Test Files  1 failed \| 31 passed (32)`, `Tests  20 failed \| 1281 passed (1301)` |

After each mutation the edit was reverted by hand; after the last one `git diff --stat` showed only the four intended files (`src/engine/documents.ts`, `tests/engine/document-rule-set-select.test.ts`, `tests/engine/document-rule-set-structure.test.ts`, `tests/engine/documents.test.ts`), and the full set, `tsc` and coverage were re-run green (outputs above).

#### OPEN items (unchanged by M2.D)

- The sharing of `documentRuleSetContent` stays a contract, NOT IMPLEMENTED and NOT VERIFIED on the M3 side: M3 must seal document rule sets with that single function, test reorder-with-original-hash and change detection, and the production digest must be canonical over object key order.
- M3 publish / seal verification of document rule sets (AC-007f, using `checkDocumentRuleSetStructure`) is NOT IMPLEMENTED and NOT VERIFIED.
- AC-007f, AC-007g, AC-007i and AC-008g are NOT closed by M2.D (AC-008g still has only the `documents = null on a held result` half evidenced). M4 (building `treatments` from validated lines, calling `selectDocumentRuleSet` and `deriveDocuments`) and M6 (kiosk screens) are not started.
- SPEC wording aligned minimally with the M2.D decisions: design.md DD-06 (input-defect bullet, flag aggregation item 4, publish-validation bullet and item 9), acceptance.md AC-007d and AC-007f, plan.md M2 scope, a new M3 bullet for the `documentRuleSetContent` hash contract (NOT implemented, NOT verified) and one M4 clause. The wording of the earlier M2 decisions 1-15 in design.md / acceptance.md is otherwise not re-aligned. All earlier OPEN items of M1.5 to M2 remain open. Formal SPEC lint and `moai verify` remain UNVERIFIED (no tool). Only Windows 11 and Node 24.19.0 were run, with no CI.

### M3.A 기반 (도메인·정본 해시·지문·저장소), 2026-10-16

**Scope.** M3.A only (cycle_type = tdd), on branch `feature/SPEC-REIMBURSEMENT-001-m3-data` (from M2 tip `2589ce8`, not committed by this step). It builds the foundation every later M3 step uses: domain types (DD-18 entities M3 touches), the typed error style, the production digest, the coverage fingerprint, repository interfaces plus an in-memory implementation with transactions, an audit helper, test doubles, and a server import-boundary test. There is NO lifecycle logic, NO publish validation, NO versioning service, NO readiness, NO HTTP, NO DB. M4 to M7 are not started. **No AC is closed by M3.A** (AC-011a is closed in M3.D).

#### What was built

| File | Change |
|------|--------|
| `src/server/domain/errors.ts` | `DomainError` (stable `code`, message, `defects: {code, path}[]`), closed `DOMAIN_ERROR_CODES` (6 codes so far) |
| `src/server/domain/actor.ts` | `Actor`, `Role` (`HA`/`RV`/`PO`), `requireRole` (role check only, throws `ROLE_NOT_PERMITTED`) |
| `src/server/domain/ports.ts` | `Clock`, `IdGenerator` ports |
| `src/server/domain/items.ts` | `ItemKind`, `ItemVersionRef`, immutable `ItemVersionRecord` (content = engine type minus `state` and `approver`), `ItemStateRecord` / `ItemStateSnapshot`, `StateTransition`, `ItemTransitionInput` |
| `src/server/domain/entities.ts` | Types for `Clinic`, `Treatment`, `TreatmentVersion`, `CommonBaseFee`, `CatalogVersion`, `Insurer`, `PolicySource`, `CoverageReviewRequest`, `RuleBundleVersion`, `RuleBundleStatusEvent`, `ClinicRuleScope`, `IdlePolicy`, `AuditLogEntry` |
| `src/server/domain/projection.ts` | `toEngineProfile` / `toEngineMapping` / `toEngineDocumentRuleSet`: cached content + freshly read state -> engine type |
| `src/server/digest.ts` | `canonicalDigest` (SHA-256 hex, encoding v1 documented in the file header); the ONLY `node:` import in `src/server` |
| `src/server/fingerprint.ts` | `COVERAGE_JUDGMENT_FIELDS`, `coverageFingerprint`, `coverageFingerprintOf` (DD-15, DD-16) |
| `src/server/audit.ts` | `appendAudit` |
| `src/server/repo/interfaces.ts` | `Repository` port (contract in the file header) |
| `src/server/repo/memory/{memory-repository,store,read-spy}.ts` | In-memory implementation: snapshot/rollback transactions, write-once versions, append-only logs, deep-copy isolation, read spy, `exportState()` |
| `vitest.config.ts` | `coverage.include` is now `['src/engine/**', 'src/server/**']`; everything else unchanged |
| `tests/server/{digest,fingerprint,domain,repo-memory,seal-roundtrip}.test.ts`, `tests/boundary/server-imports.test.ts` | New tests (counts below) |
| `tests/fixtures/server/{actors,clock,entities,errors,items,repo}.fixture.ts` | New fixtures, all `TEST_FIXTURE`; engine content is imported from `tests/fixtures/engine/*` (profile, mapping, document rule set), not duplicated |

No file under `src/engine/**`, `tests/engine/**`, `tests/boundary/` (existing files) or `tests/fixtures/engine/**` was edited. The new boundary test only imports `tests/boundary/source-scan.ts` read-only. `package.json` is untouched.

| New test file | Tests |
|---------------|-------|
| `tests/server/digest.test.ts` | 58 |
| `tests/server/fingerprint.test.ts` | 29 |
| `tests/server/domain.test.ts` | 23 |
| `tests/server/repo-memory.test.ts` | 141 |
| `tests/server/seal-roundtrip.test.ts` | 23 |
| `tests/boundary/server-imports.test.ts` | 37 |
| total | 311 |

#### Decisions and assumptions (`[not in docs]` = design / acceptance are silent)

1. **Error style (fixed by the step prompt).** Domain rejections are thrown as `DomainError`; services run inside `repo.transaction`, so a throw rolls back every write including audit and status events. No HTTP concept appears in `src/server`.
2. **Content vs state split.** `ItemVersionRecord.content` is the engine item type minus `state` AND `approver`; `ItemStateRecord` holds the current `LifecycleState`, the `approver` record, and an append-only transition history (actor id, role, time, reason). `[not in docs]` Moving `approver` to the state side is a decision: the approver exists only after approval, so keeping it in write-once content would force a second write. `projection.ts` fills `state` and `approver` from the freshly read state record and nothing else. `approvedFingerprint` of a mapping stays in content (see OPEN item 1).
3. **Digest encoding v1** (full text in the `digest.ts` header). UTF-16LE bytes of `"bodam.digest.v1:" + enc(value)`, tagged self-delimiting tokens, object keys sorted (insertion order irrelevant), arrays order-sensitive, `-0`/`NaN`/`Infinity`/`undefined`/holes/`null`/missing key all distinct, no Unicode normalization, lone surrogates preserved, total (cycles and depth > 256 are closed with a marker rather than thrown). `[not in docs]` A key whose value is `undefined` differs from a missing key (injective); typed data cannot produce it under `exactOptionalPropertyTypes`. Known limits (Map, Set, typed arrays, boxed primitives are not distinguished by content) are listed in the header.
4. **Fingerprint.** `approvedFingerprint = canonicalDigest({ treatmentCode, procedureCodes (code-point-sorted copy), benefitType, calcClass })`. `[not in docs]` DD-15 does not say whether the procedure code list is ordered or may repeat. Order does not matter (sorted copy, engine `compareCodePoints`), duplicates are NOT merged (`[A]` and `[A, A]` differ). The closed list `COVERAGE_JUDGMENT_FIELDS` uses the `TreatmentVersion` field names (`procedureCodes` for the document's `procedureCode(s)`).
5. **Write-once rule.** Rewriting the same key with an identical record (compared by `canonicalDigest`, whole record including `authorId` and `createdAt`) is an idempotent no-op; any difference is `IMMUTABLE_VERSION`. There is no delete operation; a test scans the repository's method names for delete-like verbs. `[not in docs]` Idempotent-or-reject was left to M3.A by the prompt; idempotent was chosen so retries are safe.
6. **Transactions.** Synchronous only (a callback returning a Promise is rejected with `TypeError` and rolled back). Every call takes a full-state checkpoint and restores it on throw, so a nested call is a savepoint that joins the outer transaction: an outer throw undoes the inner writes, an inner throw caught by the outer undoes only the inner writes. `[not in docs]` Async transactions are left for the DB adapter (plan.md §E #1 undecided).
7. **Bundle status chain (repository backstop).** The only accepted chain is `[ACTIVE (previous = null), SUSPENDED (previous = ACTIVE)]`; any other event is `STATE_CONFLICT`, so re-activation is impossible at the repository level (DD-14). The typed service-level rejection and the mandatory suspend reason are M3.D.
8. **Item state writes.** `recordItemTransition` requires the item version to exist and `from` to equal the current state (`null` for the first write) else `STATE_CONFLICT`. It does NOT check the DD-17 transition table (M3.B). `readItemStates(refs)` takes a list in one call and returns an array of the same length and order, with `null` for a ref that has no state record, and no history.
9. **References.** Repository writes check that referenced entities exist (`NOT_FOUND`); catalog/bundle membership checks are existence-only. Clinic ownership of catalog entries is a service concern (M3.D). `saveClinic` also rejects a duplicate `slug` (`DUPLICATE_KEY`) and a `currentCatalogVersionId` that is missing (`NOT_FOUND`) or belongs to another clinic (`REF_CONTENT_MISMATCH`).
10. **Ordering.** Entity lists keyed by id (clinics, treatments per clinic, insurers, policy sources, review requests per clinic) are in code-point order of `id`; version and history lists (item versions, catalog versions, bundles, status events, scope history, audit log) are in write order.
11. **Entity shapes `[not in docs]`.** DD-18 lists fields but not types. Chosen: `TreatmentVersion` has no mutable "publish status" (it is catalog membership); `CommonBaseFee` is write-once by id (a changed fee gets a new id); `CatalogChangeSummary` is `{addedTreatmentIds, removedTreatmentIds, priceChangedTreatmentIds, baseFeesChanged}`; `ProposedCoverageInfo` is `{benefitType, procedureCodes, calcClass}`; `Clinic.institutionType` is `'CLINIC'`; actor-bearing records use `Actor` (`publishedBy`, `assignedBy`, `requestedBy`) while status events and audit entries use flat `actorId` + `role` as DD-18 lists them. `TreatmentCoverageMapping` has no `clinicId` because the engine type has none (a mapping is scoped by `treatmentId`).
12. **IdlePolicy.** Type only: `{clinicId, screens: Record<string, {warnSeconds, resetSeconds}>, completionHoldSeconds: number | null}`. The DD-10 default reader is left to M3.D, which will also fix the closed list of screen kinds (the DD-10 table groups screens, it does not name keys).
13. **Determinism.** `src/server` uses no `Date.now`, `Math.random`, `randomUUID`; time and ids come from the injected `Clock` and `IdGenerator` (test doubles `FixedClock`, `CounterIdGenerator`). The boundary test reuses the engine hazard rules (clock, random, environment, network call, timer, locale) on `src/server`. A fresh-process determinism run of the digest (the `child-run.ts` pattern) was NOT added (the prompt said only if cheap): determinism is evidenced by pure-function tests and the known-answer vectors, not by a second process.
14. **`exportState()` on the memory class** exists for the `snapshotOf(repo)` test helper (rollback comparisons). It returns a deep copy and does not touch the read spy.

#### Foundation behaviors later steps depend on

- M3.B (lifecycle): `recordItemTransition` (from-check, append-only history with actor id and role), `readItemStates`, `requireRole`, `appendAudit`, `COVERAGE_JUDGMENT_FIELDS`, `coverageFingerprintOf`, `DomainError` and the `STATE_CONFLICT` / `ROLE_NOT_PERMITTED` codes, the transaction rollback guarantee for rejected self-approval.
- M3.C (publish validation): `DomainError.defects`, `canonicalDigest`, engine structure checks (not wrapped yet).
- M3.D (versions/bundles): write-once `put*`, `IMMUTABLE_VERSION`, `appendBundleStatusEvent` chain backstop, `assignClinicRuleScope`, `toEngine*` projections, sealing with `canonicalDigest(profileContent(p))` / `canonicalDigest(documentRuleSetContent(s))` (proved to verify through engine `isUsable`, reorder-with-original-hash and change detection in `seal-roundtrip.test.ts` as a SANITY test only; AC-011a ownership stays in M3.D).
- M3.E (readiness): `readItemStates`, `toEngine*`, `ReadSpy` counters.

#### AC evidence

No AC is closed. Evidence-only support for later closure: AC-011a (digest/seal sanity in `tests/server/seal-roundtrip.test.ts`, describe `프로필: 봉인과 검증이 같은 정규화를 쓴다` and `서류 규칙 묶음: 봉인과 검증이 같은 정규화를 쓴다`); DD-14 read contract (`readItemStates` batch and spy in `tests/server/repo-memory.test.ts`, describe `항목 상태 일괄 읽기` and `읽기 감시 (spy)`); atomic rollback (describe `트랜잭션`).

#### RED before GREEN (exact statement)

Tests and fixtures were written first, with no implementation under `src/server/` yet (the fixtures are typed against the planned module paths). The RED run was a module-resolution failure, not an assertion failure, because no `src/server` module existed:

```
$ npx vitest run tests/server tests/boundary/server-imports.test.ts --maxWorkers=4   -> exit 1 (RED, red.txt)
 Test Files  6 failed (6)
      Tests  no tests
 e.g. Error: Cannot find module '../../src/server/digest' imported from tests/server/fingerprint.test.ts
      Error: Cannot find module '../../src/server/repo/memory/memory-repository' imported from tests/server/repo-memory.test.ts
```

Then the implementation was written and the same command passed on the first run (6 files / 307 tests, exit 0, `first-green.txt`) after `npx tsc --noEmit` exit 0. The known-answer digest vectors were computed once with an independent re-derivation of the encoding spec (a scratch script, not the repo code) and cross-checked for `null` and `"a"` with `printf | iconv -t UTF-16LE | sha256sum`; they were hard-coded in the test before `digest.ts` existed. Four tests were added AFTER the first GREEN (three `brokenFirstEvents` rows and one per-bundle chain test in `repo-memory.test.ts`) because the first coverage run showed one branch of the bundle status chain unexercised; they passed immediately against the existing implementation (test-after for those four; they are not evidence of a RED). Two small source edits followed the first coverage run: an unused `ITEM_KINDS` constant was removed and `ReadSpy.counts` was typed by query name. Final totals are in the next block.

#### Evidence (outputs saved under `.moai/state/verify/m3a/`, gitignored; all vitest runs with `--maxWorkers=4`)

```
$ npx vitest run tests/server tests/boundary --maxWorkers=4          -> exit 0   (vitest-server-boundary-post.txt)
 Test Files  9 passed (9)
      Tests  517 passed (517)
$ npx vitest run tests/engine tests/boundary --maxWorkers=4          -> exit 0   (vitest-engine-boundary-post.txt)
 Test Files  36 passed (36)
      Tests  1544 passed (1544)
$ npx tsc --noEmit                                                   -> exit 0   (tsc-post.txt)
$ npx vitest run --coverage tests/server --maxWorkers=4              -> exit 0   (coverage-server-post.txt)
 Test Files  5 passed (5)
      Tests  274 passed (274)
$ npx vitest run --coverage tests/engine --maxWorkers=4              -> exit 0   (coverage-engine-post.txt)
 Test Files  32 passed (32)
      Tests  1301 passed (1301)
```

Regression baseline: the M2 engine+boundary set was 35 files / 1507 tests; it is now 36 files / 1544 tests = the same 35 files / 1507 tests plus the new boundary file (37 tests). No existing test was modified; no `skip`, `only` or disabled test was added.

Coverage. This vitest version prints only non-100% rows in the text table, so per-file figures were read from `coverage/coverage-summary.json` and summed per directory (`coverage-server-rows-post.txt`, `coverage-engine-rows-post.txt`). Because `coverage.include` now has both folders, the `All files` row of a run that executes only one folder mixes in the other folder at 0%; read the per-folder sums:

```
src/server (tests/server run):  statements 247/247  branches 132/132  functions 85/85  lines 239/239   = 100% each
src/engine (tests/engine run):  statements 652/652  branches 558/558  functions 145/145 lines 606/606  = 100% each (unchanged)
```

No coverage exclusions and no coverage-only tests. `interfaces.ts`, `ports.ts` and `entities.ts` are type-only (no statements).

#### Mutation spot checks (each run with `npx vitest run tests/server --maxWorkers=4`; the boundary mutation with the boundary file only; every edit reverted by hand and the restored files compared by sha256 — `src-hashes-before-mutation.txt` equals `src-hashes-after-mutation.txt`, and `audit.ts` hash equals its pre-mutation hash)

| Mutation | Result |
|----------|--------|
| (a) `digest.ts`: stop sorting object keys | `Test Files  3 failed \| 2 passed (5)`, `Tests  6 failed \| 268 passed (274)` |
| (b) `digest.ts`: drop the `-0` branch | `Test Files  1 failed \| 4 passed (5)`, `Tests  2 failed \| 272 passed (274)` |
| (c) `memory-repository.ts`: transaction no longer restores the checkpoint | `Test Files  2 failed \| 3 passed (5)`, `Tests  7 failed \| 267 passed (274)` |
| (d) `putOnce`: different content overwrites instead of `IMMUTABLE_VERSION` | `Test Files  1 failed \| 4 passed (5)`, `Tests  12 failed \| 262 passed (274)` |
| (e) `fingerprint.ts`: procedure codes not sorted | `Test Files  1 failed \| 4 passed (5)`, `Tests  2 failed \| 272 passed (274)` |
| (f) bundle status chain relaxed to `previousStatus === last.status` (re-activation allowed) | `Test Files  1 failed \| 4 passed (5)`, `Tests  2 failed \| 272 passed (274)` |
| (g) reads return the stored object instead of a copy | `Test Files  1 failed \| 4 passed (5)`, `Tests  8 failed \| 266 passed (274)` |
| (h) read spy counts once per ref instead of once per `readItemStates` call | `Test Files  1 failed \| 4 passed (5)`, `Tests  2 failed \| 272 passed (274)` |
| (i) append `Date.now()` and a `tests/fixtures` import to `src/server/audit.ts` | boundary file only: `Test Files  1 failed (1)`, `Tests  2 failed \| 35 passed (37)` |

#### OPEN items / NOT IMPLEMENTED / NOT VERIFIED

1. **Re-approval vs immutable fingerprint (design contradiction, for M3.B).** DD-17 lifecycle table allows `UNDER_REREVIEW -> APPROVED` (re-approval of the same mapping version, design.md:908) while DD-14 lists the mapping's `approvedFingerprint` among the immutable cached content (design.md:827) and DD-15 stores it "at approval" (design.md:844). M3.A keeps `approvedFingerprint` in write-once content. If a re-approval must carry a new fingerprint, M3.B must either require a new mapping version or move the fingerprint into the state record; this was not decided here.
2. NOT IMPLEMENTED: lifecycle state machine and self-approval rejection (M3.B), publish validation (M3.C), catalog/bundle publish, suspend service and reason check, DD-10 default reader, scope assignment service, recovery (M3.D), readiness tables (M3.E). All their ACs stay open.
3. NOT VERIFIED: any DB behavior (no DB adapter, §E #1 undecided); asynchronous transactions; behavior of `canonicalDigest` on Map/Set/typed arrays (documented limit); digest determinism across a fresh process (not added).
4. The digest encoding is versioned by the `bodam.digest.v1:` prefix. Any change to the encoding invalidates every sealed item hash; the `@MX:ANCHOR` on `canonicalDigest` records this.

### M3.B 생명주기 (상태 기계·본인 승인 금지·재검토 전환), 2026-10-16

**Scope.** M3.B only (cycle_type = tdd), on branch `feature/SPEC-REIMBURSEMENT-001-m3-data` on top of M3.A (`f07df7b`), not committed by this step. It adds the lifecycle state machine shared by the three item kinds (DD-17), the authoring and approval services (draft create / edit / next version, submit, approve, reject, item suspend, internal publish / supersede / expire primitives), author != approver enforcement (owner decision #31), mapping fingerprint pinning at approval (DD-15), the re-review trigger (DD-16, unit-level part of AC-009a), the coverage review request flow (owner decision #34), and the engine-integration tests. It also contains the one deliberate change to M3.A decided by the orchestrator: `approvedFingerprint` moved from the immutable mapping content into the item STATE record. There is NO publish validation (M3.C), NO catalog or bundle publishing, bundle suspend, scope assignment (M3.D), NO readiness (M3.E), NO HTTP, NO DB, NO M4-M7 work. **No AC is closed by M3.B** (AC-009a closes in M3.D when catalog publishing calls the trigger in the same transaction; AC-024a and AC-025b close in M7 and only get domain-side evidence here).

#### What was built

| File | Change |
|------|--------|
| `src/server/lifecycle.ts` | NEW. `LIFECYCLE_STATES`, `LIFECYCLE_TRANSITIONS` (frozen data table, 11 allowed pairs), `isTransitionAllowed`, `assertTransition` (`STATE_CONFLICT` with from/to in message and a `TRANSITION_NOT_ALLOWED` defect) |
| `src/server/deps.ts` | NEW. `ServiceDeps` = `AuditDeps` with the full `Repository` |
| `src/server/authoring.ts` | NEW. `createDraft`, `editDraft`, `createNextDraft` (RV only; seals `contentHash` with the engine normalizers + `canonicalDigest`) |
| `src/server/approval.ts` | NEW. `submitForReview`, `approve`, `reject`, `suspendItem`, `markPublished`, `markSuperseded`, `markExpired` |
| `src/server/re-review.ts` | NEW. `triggerReReview(deps, actor, treatmentVersion)` |
| `src/server/review-request.ts` | NEW. `createCoverageReviewRequest` (HA), `createMappingDraftFromRequest` (RV), `closeReviewRequestForMapping` (called by approve/reject), HA read helpers `readReviewRequest`, `readClinicReviewRequests` |
| `src/server/domain/errors.ts` | 5 codes added (additive): `SELF_APPROVAL_FORBIDDEN`, `REASON_REQUIRED`, `TREATMENT_VERSION_ABSENT`, `NOT_ITEM_AUTHOR`, `INVALID_INPUT` (union stays closed, now 11) |
| `src/server/domain/items.ts` | CHANGED (deliberate): `MappingContent` no longer has `approvedFingerprint`; `ItemStateRecord` / `ItemStateSnapshot` gain `approvedFingerprint`; `ItemTransitionInput` gains `approvedFingerprintAfter`; `StateTransition` gains `approver` and `approvedFingerprint` (the values in force after that transition); new helpers `formatRef`, `isMappingRecord` |
| `src/server/domain/projection.ts` | CHANGED: `toEngineMapping` takes `approvedFingerprint` from the state snapshot (`null` becomes `''`, which the engine's `isUsable` turns into `INTEGRITY_MISMATCH`) |
| `src/server/domain/entities.ts` | `CoverageReviewRequest` gains `draftMappingRef` (additive) |
| `src/server/repo/interfaces.ts`, `repo/memory/memory-repository.ts`, `repo/memory/read-spy.ts` | Added `listTreatmentVersions(treatmentId)`, `reviseDraftItemVersion(record)` (the only content overwrite, DRAFT only), fingerprint handling in `recordItemTransition` / `readItemStates`, `draftMappingRef` existence check, spy name `listTreatmentVersions` |
| `tests/server/{lifecycle-table,lifecycle-authoring,lifecycle-approval,lifecycle-engine,re-review,review-request,repo-lifecycle}.test.ts` | NEW (counts below) |
| `tests/fixtures/server/lifecycle.fixture.ts` | NEW (world, content builders, `forceState`, `itemInState`, `adoptTreatmentVersion`); `actors.fixture.ts` (+`TEST_FIXTURE_RV_APPROVER_2`), `entities.fixture.ts` (+`draftMappingRef: null`), `items.fixture.ts` (mapping record has no `approvedFingerprint`), `repo.fixture.ts` (`approvedFingerprintAfter: null`) changed |
| `tests/server/domain.test.ts`, `tests/server/repo-memory.test.ts` | M3.A tests adjusted for the deliberate change (error-code list, state shape, history shape, spy table, the "no overwrite verbs" test now names `reviseDraftItemVersion` as the one exception) |

No file under `src/engine/**`, `tests/engine/**`, `tests/boundary/**` or `tests/fixtures/engine/**` was edited; `package.json` and `vitest.config.ts` are untouched. Sources of truth reused: engine `profileContent` / `documentRuleSetContent` (sealing), `isUsable` / `mappingToRuleItem` (integration tests), M3.A `canonicalDigest`, `coverageFingerprintOf`, `appendAudit`, `requireRole`, repository transactions.

| Test file | Tests |
|-----------|-------|
| `lifecycle-table.test.ts` | 88 (81-pair matrix + 7) |
| `lifecycle-authoring.test.ts` | 134 |
| `lifecycle-approval.test.ts` | 308 (189-cell service-operation x 9-state matrix inside) |
| `lifecycle-engine.test.ts` | 13 |
| `re-review.test.ts` | 34 |
| `review-request.test.ts` | 19 |
| `repo-lifecycle.test.ts` | 20 |
| new total | 616 (M3.A files changed: `domain.test.ts` 23 -> 25, `repo-memory.test.ts` 141 -> 142) |

#### Deliberate change to M3.A: `approvedFingerprint` is an approval-time fact `[not in docs]`

DD-15 stores the fingerprint "at approval" and DD-17 allows `UNDER_REREVIEW -> APPROVED` (re-approval of the SAME version); both hold only if the fingerprint is not part of the immutable content. So, like the approver, it lives in the item state record. It is set on every transition to `APPROVED` (first approval and re-approval), carried unchanged through other transitions, read together with the state on every request (`readItemStates`), and each transition's history entry records the approver and fingerprint in force after it (earlier values stay in the history). `toEngineMapping` fills it from the state snapshot only, so a stale content cache can never serve a stale fingerprint (test: `lifecycle-engine.test.ts`, `내용을 미리 읽어 두었어도(캐시)...`).
**SPEC wording issue found (not edited):** design.md:827 (DD-14 "항목 생명주기 상태와 캐시 계약", item (1) 내용) lists the mapping's `approvedFingerprint` among the immutable, cacheable content; design.md:844 (DD-15, "승인 때 … 저장") and design.md:908 (DD-17 table, `UNDER_REREVIEW -> APPROVED`) require it to change on re-approval. One of the three sentences has to change; the implementation follows 844 and 908.

#### Decisions and assumptions (`[not in docs]` = design / acceptance are silent)

1. **Transition table (DD-17).** `DRAFT -> REVIEW_REQUESTED`; `REVIEW_REQUESTED -> APPROVED | REJECTED`; `APPROVED -> PUBLISHED | UNDER_REREVIEW`; `PUBLISHED -> SUSPENDED | SUPERSEDED | UNDER_REREVIEW | EXPIRED`; `UNDER_REREVIEW -> APPROVED | REJECTED`; `REJECTED`, `SUSPENDED`, `SUPERSEDED`, `EXPIRED` have no outgoing transition (the new version is a separate DRAFT, via `createNextDraft`). The table is frozen data; every service calls `assertTransition` before writing. The test matrix of 189 cells (3 kinds x 9 states x 7 service operations) proves that exactly the table's 9 operation-reachable pairs per kind succeed (the other 2 table pairs, `APPROVED/PUBLISHED -> UNDER_REREVIEW`, belong to the re-review trigger).
2. **Roles.** `RV` for create / edit / next version / submit / approve / reject / item suspend and the internal publish, supersede, expire primitives; `HA` for `createCoverageReviewRequest`; the re-review trigger takes any actor (it is a system effect of publishing, recorded with the publisher's id and role). A mapping draft by `HA` is `ROLE_NOT_PERMITTED` (decision #34); HA has only read helpers.
3. **Self-approval (decision #31).** `approve` throws `SELF_APPROVAL_FORBIDDEN` when `actor.id === record.authorId`, for first approval and re-approval and for every kind. It runs inside a transaction before any write, so state, approver record, fingerprint, audit log and review request are unchanged (`snapshotOf(repo)` before/after is deep-equal in the tests). Reject does not apply the rule. There is no `selfApproval` flag anywhere (an audit-entry key test still asserts it).
4. **`[not in docs]` submit by author.** DD-17 says "작성자의 검토 제출"; `submitForReview` therefore requires `actor.id === authorId` (`NOT_ITEM_AUTHOR`) in addition to role `RV`.
5. **`[not in docs]` editing a DRAFT in place.** Any `RV` may edit a DRAFT (author and `createdAt` never change); the audit entry records editor, time, optional reason and the canonical digests of the content before and after. Because the author is the only identity compared for author != approver, an RV who edited a draft written by someone else may approve it (design is silent on editors).
6. **`[not in docs]` content seal.** `createDraft`, `editDraft` and `createNextDraft` recompute `contentHash` of profiles and document rule sets from the content with the engine's `profileContent` / `documentRuleSetContent` and `canonicalDigest` (a hash passed by the caller is ignored), so a stored hash always matches the stored content; the next-version copy needs it because the version label is part of the hashed content. Publish-time verification stays M3.C/M3.D.
7. **`[not in docs]` repository additions.** `reviseDraftItemVersion` (DRAFT only; `NOT_FOUND` / `STATE_CONFLICT` / `REF_CONTENT_MISMATCH` / `IMMUTABLE_VERSION` for author or `createdAt` changes) is the only content overwrite and a test asserts it is the only such method name; `listTreatmentVersions` in write order.
8. **Fingerprint pinning rule `[not in docs]`.** For a mapping, `approve` pins `coverageFingerprintOf(v)` where `v` is the treatment's version that is a member of its clinic's CURRENT `CatalogVersion` (first match in write order); if the treatment is not in the current catalog (or the clinic has none) it is the treatment's latest version by write order; if the treatment has no version (or does not exist) `TREATMENT_VERSION_ABSENT` and nothing changes. Consequence: a mapping cannot be approved before its treatment has at least one stored version.
9. **Re-review trigger.** Compares each `APPROVED` / `PUBLISHED` mapping's pinned fingerprint of that treatment with `coverageFingerprintOf(newVersion)` (not with the previous treatment version), so it is idempotent. Moved mappings get a state-history entry (reason `COVERAGE_JUDGMENT_FIELD_CHANGED`, actor = the acting publisher, approver and pinned fingerprint kept) and an `ITEM_REREVIEW` audit entry. `[not in docs]` A mapping without a state record is skipped; an `APPROVED` / `PUBLISHED` mapping with a `null` pinned fingerprint cannot be compared and is moved (fail-safe). The function runs in `repo.transaction`, joins an outer one, and does not store the treatment version.
10. **Review requests `[not in docs]`.** `CoverageReviewRequest.draftMappingRef` links the request to the single mapping draft RV creates for it (the existing `resultMappingRef` stays "approved result only", null after rejection as documented in M3.A). Approving that mapping closes the request `APPROVED` with `resultMappingRef`; rejecting closes it `REJECTED` with the reason; later re-review, re-approval or re-rejection of the same mapping, mappings created without a request, and profiles / document rule sets never touch requests. A second draft for one request, or a draft for a closed request, is `STATE_CONFLICT`. An RV may also create a mapping draft directly (needed for next versions and not forbidden by DD-17).
11. **Audit conventions `[not in docs]`.** `beforeVersion` / `afterVersion` carry lifecycle states for state changes (`null` -> `DRAFT` for creation), the canonical digests of the content before/after for a draft edit, and states of the request for request audit entries (`REVIEW_REQUEST_CREATE`, `REVIEW_REQUEST_DRAFT_LINK`, `REVIEW_REQUEST_CLOSE`). Actions: `ITEM_CREATE_DRAFT`, `ITEM_EDIT_DRAFT`, `ITEM_CREATE_NEXT_VERSION`, `ITEM_SUBMIT`, `ITEM_APPROVE`, `ITEM_REJECT`, `ITEM_SUSPEND`, `ITEM_PUBLISH`, `ITEM_SUPERSEDE`, `ITEM_EXPIRE`, `ITEM_REREVIEW`. The target is `KIND/id/version`.
12. **Reasons.** `reject` and `suspendItem` require a non-empty trimmed reason (`REASON_REQUIRED`, includes whitespace-only and the ideographic space).

#### AC evidence

No AC is closed. Evidence-only mapping (unit level):

| AC | Test file / describe | What is checked |
|----|----------------------|-----------------|
| AC-009a (unit-level part; closes in M3.D) | `re-review.test.ts` : `보장 판단 필드가 바뀐 치료 버전 → ...`, `보장 판단 필드가 아닌 변경은 아무것도 바꾸지 않는다`, `바깥 트랜잭션 안에서 부를 수 있다`; `lifecycle-engine.test.ts` : `재검토 전환과 엔진 판정` | the four guarantee fields each trigger `APPROVED` / `PUBLISHED` -> `UNDER_REREVIEW`; price, display name and 7 other neutral changes leave the repository deep-equal; other states, other treatments, other kinds untouched; rolls back with an outer transaction; the engine reports `MAPPING_UNDER_REREVIEW`; the fingerprint mismatch alone is also caught by the engine |
| AC-024a, AC-025b (domain side only; M7 closes) | `lifecycle-approval.test.ts` : `[AC-024a·AC-025b 의 도메인 쪽 증거]` tests in `승인 (PROFILE / MAPPING / DOCUMENT_RULE_SET)` | self-approval rejected for first approval and re-approval for every kind with the repository unchanged; a different principal succeeds afterwards |
| AC-011a (sanity only; M3.D owns it) | `lifecycle-engine.test.ts` : `프로필·서류 규칙 묶음: 서비스가 봉인한 내용 해시가 엔진 무결성 판정을 통과한다` | service-sealed hashes (including after an edit) pass the engine's `isUsable` |
| DD-14 state/content split | `lifecycle-engine.test.ts`, `domain.test.ts` | state and pinned fingerprint come from freshly read state; cached content cannot serve a stale fingerprint |

#### RED before GREEN (exact statement)

Order: (1) the M3.A tests and fixtures touched by the deliberate change, the new fixtures and all seven new test files were written first, with no change under `src/server/` yet; (2) the RED run; (3) the implementation. The RED run was `npx vitest run tests/server tests/boundary --maxWorkers=4` -> exit 1 (`red.txt`): `Test Files  9 failed | 7 passed (16)`, `Tests  8 failed | 512 passed (520)`. Seven files could not load (`Cannot find module '../../src/server/approval'`, `.../authoring`, `.../lifecycle`, `.../re-review`; `repo-lifecycle.test.ts` through the fixture import), and 8 assertions failed in two M3.A files: `domain.test.ts` (error-code list; two projection fingerprint tests) and `repo-memory.test.ts` (history shape, `readItemStates` keys, spy table, the one-overwrite-verb test, `listTreatmentVersions is not a function`).
After the implementation the first run had 1 failure: an M3.A history assertion in `repo-memory.test.ts` that still lacked the new `approver` / `approvedFingerprint` fields (a test I had not updated; fixed in the test, the implementation was correct); the next run was 16 files / 1134 tests green (`first-green.txt`). `npx tsc --noEmit` first reported 4 type errors in two new test files (an import of `ItemUsabilityReason` from the wrong module; readonly array typing) and was exit 0 after test-only fixes. Two tests were added AFTER the first GREEN because the first coverage run showed two uncovered branches (`approval.ts` item without a state record; `review-request.ts` mapping whose treatment is absent): test-after, they passed immediately and are not evidence of a RED. Final totals below.

#### Evidence (outputs saved under `.moai/state/verify/m3b/`, gitignored; all vitest runs with `--maxWorkers=4`)

```
$ npx vitest run tests/server tests/boundary --maxWorkers=4          -> exit 0   (vitest-server-boundary.txt)
 Test Files  16 passed (16)
      Tests  1136 passed (1136)
$ npx vitest run tests/engine tests/boundary --maxWorkers=4          -> exit 0   (vitest-engine-boundary.txt)
 Test Files  36 passed (36)
      Tests  1544 passed (1544)          (unchanged from M3.A)
$ npx tsc --noEmit                                                   -> exit 0   (tsc.txt)
$ npx vitest run --coverage tests/server --maxWorkers=4              -> exit 0   (coverage-server.txt)
 Test Files  12 passed (12)
      Tests  893 passed (893)
$ npx vitest run --coverage tests/engine --maxWorkers=4              -> exit 0   (coverage-engine.txt)
 Test Files  32 passed (32)
      Tests  1301 passed (1301)
```

Per-folder coverage (summed from `coverage/coverage-summary.json` with the scratchpad `covsum.mjs`; `coverage-server-rows.txt`, `coverage-engine-rows.txt`):

```
src/server (tests/server run):  statements 429/429  branches 234/234  functions 131/131  lines 417/417   = 100% each
src/engine (tests/engine run):  statements 652/652  branches 558/558  functions 145/145  lines 606/606   = 100% each (unchanged)
```

No coverage exclusions; no coverage-only tests beyond the two noted above (each asserts a real behavior: a stateless item is `NOT_FOUND`, a mapping without a stored treatment can still be rejected). No `skip`, `only` or disabled test.

#### Mutation spot checks (each run with `npx vitest run tests/server --maxWorkers=4`; every edit reverted by hand and the restored sources compared by sha256: `src-hashes-before-mutation.txt` equals `src-hashes-after-mutation.txt`, then `tests/server tests/boundary` again 16 files / 1136 tests green)

| Mutation | Result |
|----------|--------|
| (a) `approval.ts`: self-approval check never fires | `Test Files  3 failed \| 9 passed (12)`, `Tests  11 failed \| 882 passed (893)` |
| (b) `lifecycle.ts`: table also allows `DRAFT -> APPROVED` | `Test Files  2 failed \| 10 passed (12)`, `Tests  5 failed \| 888 passed (893)` |
| (c) `re-review.ts`: no fingerprint-equality skip (neutral changes also move mappings) | `Test Files  2 failed \| 10 passed (12)`, `Tests  10 failed \| 883 passed (893)` |
| (d) `approval.ts`: pin the latest version instead of the current-catalog member | `Test Files  1 failed \| 11 passed (12)`, `Tests  1 failed \| 892 passed (893)` |
| (e) `authoring.ts`: `editDraft` does not re-seal the content hash | `Test Files  2 failed \| 10 passed (12)`, `Tests  3 failed \| 890 passed (893)` |
| (f) `approval.ts`: re-approval keeps the old approver record | `Test Files  2 failed \| 10 passed (12)`, `Tests  4 failed \| 889 passed (893)` |
| (g) `memory-repository.ts`: `reviseDraftItemVersion` no longer requires DRAFT | `Test Files  2 failed \| 10 passed (12)`, `Tests  35 failed \| 858 passed (893)` |
| (h) `approval.ts`: approving a mapping does not close its review request | `Test Files  1 failed \| 11 passed (12)`, `Tests  3 failed \| 890 passed (893)` |
| (i) `approval.ts`: `approve` without the RV role check | `Test Files  2 failed \| 10 passed (12)`, `Tests  10 failed \| 883 passed (893)` |

#### OPEN items / NOT IMPLEMENTED / NOT VERIFIED

1. **SPEC wording (see above):** design.md:827 vs :844 / :908 on where `approvedFingerprint` lives. Not edited.
2. **No trigger for `UNDER_REREVIEW` on profiles and document rule sets.** The table allows `APPROVED` / `PUBLISHED -> UNDER_REREVIEW` for all kinds, but design only names a trigger for mappings (guarantee-field change / fingerprint mismatch). No service moves a profile or document rule set there; tests reach that state with the repository primitive only.
3. **Editors are not compared with approvers** (decision 5): only the author. If the owner wants editors treated as authors, `approve` needs a second check.
4. **Publishing is not wired.** `markPublished` / `markSuperseded` / `markExpired` are internal primitives; the catalog-publish call to `triggerReReview` in the same transaction, the bundle publish, bundle suspend with reason, scope assignment, recovery, and the DD-10 default reader are M3.D. Publish validation (structure, ranges, mapping field rules, hash verification at publish) is M3.C. Readiness is M3.E. Their ACs stay open.
5. **Mapping approval requires at least one stored treatment version** (decision 8); until M3.D publishes catalogs, tests store treatment versions directly with the repository.
6. NOT VERIFIED: clinic ownership / membership of requests and drafts, 401 / 403, HTTP mapping (M7); any DB behavior; asynchronous transactions.

### M3.C 게시 검증기 (카탈로그·규칙 묶음), 2026-10-16

**Scope.** M3.C only (cycle_type = tdd), on branch `feature/SPEC-REIMBURSEMENT-001-m3-data` on top of M3.B (`6a6cace`), not committed by this step. It adds the PURE publish validators: `validateCatalogPublish` (treatment prices, common base fees, closed enumerations, accepted line origins, duplicates), `validateRuleBundlePublish` (item form, header and seal, mapping field rules, profile structure and value ranges, document rule set structure, bundle cross checks) and `assertNoDefects`. They take everything as arguments (no repository, clock or globals), return `{ code, path }` defects in a fixed order, never throw and never mutate. There is NO publish service, NO transaction, NO status event, NO rollback, NO version write (all M3.D), NO readiness (M3.E), NO HTTP, NO DB. **No AC is closed by M3.C** (the coverage of each AC by the validators and what remains for M3.D is in the AC table below).

#### What was built

| File | Change |
|------|--------|
| `src/server/publish-validate.ts` | NEW. Public facade: re-exports `validateCatalogPublish`, `validateRuleBundlePublish`, the request/config/resolver types, the closed `PUBLISH_DEFECT_CODES` list, and `assertNoDefects(defects)` (throws `DomainError('PUBLISH_VALIDATION_FAILED', ..., defects)`). The file header documents all defect codes and the path conventions |
| `src/server/validate/shape.ts` | NEW. Guards (`isPlainObject`, `isAbsent`, `isNonEmptyString`), closed enumeration lists written as `Record<EngineType, true>` so an engine enum change breaks compilation, `expectValue` (VALUE_MISSING / VALUE_INVALID), `repeatedPositions` |
| `src/server/validate/catalog.ts` | NEW. `validateCatalogPublish`, `CatalogPublishConfig`, `CatalogPublishRequest` |
| `src/server/validate/bundle-form.ts` | NEW. Layer (a): container/item form, ref parsing, resolution through `BundleItemResolver`; `RuleBundlePublishRequest` |
| `src/server/validate/bundle-header.ts` | NEW. Layer (b): origin, policy sources, approver, seal (`canonicalDigest(profileContent(p))` / `canonicalDigest(documentRuleSetContent(s))`), mapping pinned fingerprint |
| `src/server/validate/bundle-mapping.ts` | NEW. Layer (c): DD-03 mapping field rules + `scope` shape |
| `src/server/validate/bundle-profile.ts` | NEW. Layer (d): cell keys, engine `checkProfileStructure`, DD-24 value ranges (mirror of the value half of engine `checkGroupValues`) |
| `src/server/validate/bundle-docrules.ts` | NEW. Layer (e): engine `checkDocumentRuleSetStructure` with bundle paths |
| `src/server/validate/bundle-cross.ts` | NEW. Layer (f): group-in-profile, one profile per cell, one version per mapping id |
| `src/server/validate/bundle.ts` | NEW. `validateRuleBundlePublish` (layer orchestration and order) |
| `src/server/domain/errors.ts` | CHANGED (additive): code `PUBLISH_VALIDATION_FAILED` (union now 12 codes); no existing code changed |
| `tests/server/domain.test.ts` | CHANGED: the closed error-code list test now expects the new code (this was the only existing test edited) |
| `tests/fixtures/server/publish.fixture.ts`, `mutate.fixture.ts` | NEW fixtures: valid catalog request, valid bundle (profile, COVERED + EXCLUDED mapping, document rule set resealed with `canonicalDigest`), ref/resolver builders (the resolver records its calls), `setAt`/`unsetAt`, `deepFreeze`, `reverseKeys`, seeded PRNG. All `TEST_FIXTURE`; engine content is imported from `tests/fixtures/engine/*` |

No file under `src/engine/**`, `tests/engine/**`, `tests/boundary/**` or `tests/fixtures/engine/**` was edited; `package.json` and `vitest.config.ts` are untouched.

| New test file | Tests |
|---------------|-------|
| `validate-catalog.test.ts` | 113 |
| `validate-bundle-form.test.ts` | 80 |
| `validate-bundle-header.test.ts` | 60 |
| `validate-bundle-mapping.test.ts` | 42 |
| `validate-bundle-profile.test.ts` | 265 |
| `validate-bundle-docrules.test.ts` | 36 |
| `validate-bundle-cross.test.ts` | 26 |
| `validate-determinism.test.ts` | 14 |
| `validate-reuse.test.ts` | 17 |
| total (9 files) | 653 |

#### Exported API (what M3.D calls)

```ts
// src/server/publish-validate.ts
validateCatalogPublish(request: unknown, config: { acceptedLineOrigins: readonly Origin[] }): Defect[]
//   request = { treatmentVersions: TreatmentVersion[]; commonBaseFees: CommonBaseFee[] } (typed loosely as unknown)
validateRuleBundlePublish(request: unknown, resolver: BundleItemResolver): Defect[]
//   request = { profiles: ItemVersionRef[]; mappings: ItemVersionRef[]; documentRuleSet: ItemVersionRef | null }
interface BundleItemResolver {          // pure; the service builds it from repo reads + domain/projection.ts toEngine*
  profile(ref): StandardAssumptionProfile | null
  mapping(ref): TreatmentCoverageMapping | null
  documentRuleSet(ref): DocumentRuleSet | null
}
assertNoDefects(defects: readonly Defect[]): void   // throws DomainError('PUBLISH_VALIDATION_FAILED')
PUBLISH_DEFECT_CODES                                // closed list of this validator's own codes
```

Defect codes: form `NOT_OBJECT` `NOT_ARRAY` `VALUE_MISSING` (absent or null) `VALUE_INVALID` `REF_UNRESOLVABLE`; catalog `ORIGIN_NOT_ACCEPTED` `DUPLICATE_TREATMENT_ID` `DUPLICATE_ID`; header `POLICY_SOURCES_MISSING` `POLICY_SOURCE_INCOMPLETE` `APPROVER_MISSING` `APPROVER_INCOMPLETE` `INTEGRITY_MISMATCH` `FINGERPRINT_MISSING`; mapping `DECISION_INVALID` `GROUP_KEY_REQUIRED` `GROUP_KEY_FORBIDDEN` `EXCLUSION_REASON_REQUIRED` `EXCLUSION_REASON_FORBIDDEN` `SCOPE_INVALID`; cross `MAPPING_GROUP_NOT_IN_PROFILE` `CELL_PROFILE_DUPLICATE` `MAPPING_ID_DUPLICATE`. Engine structure codes pass through unchanged (12 profile codes such as `EMPTY_PROFILE`, `DUPLICATE_GROUP_KEY`, `UNKNOWN_POOL_REFERENCE`, `GROUP_ORDER_MISSING_KEY`; 8 document-rule codes such as `REASON_INVALID`, `PRIORITY_INVALID`, `WHEN_UNKNOWN_KEY`).

Paths: catalog `treatmentVersions[2].patientAmount`, `commonBaseFees[0].amount`, request-level `catalog`; bundle always starts with `bundle.` (`bundle.profiles[2].groups[0].deduction.rate`, `bundle.profiles[0].sharedLimitPools[0].limit.amount`, `bundle.mappings[0].groupKey`, `bundle.documentRuleSet.rules[3].when.imaging`, `bundle.documentRuleSet.contentHash`, request-level `bundle`).

Fixed order. Catalog: treatment versions (list form, then entries in order; inside an entry id, treatmentId, displayName, benefitType, patientAmount, treatmentCode, procedureCodes, calcClass, documentFlags, origin, accepted origin) -> base fees (same style: id, clinicId, displayName, benefitType, amount, code, origin, accepted origin) -> duplicates (treatmentId, treatment version id, base fee id). Bundle layers: (a) form (profiles, mappings, documentRuleSet) -> (b) header for profiles, mappings, document rule set (origin, policy sources, approver, seal or fingerprint) -> (c) mapping field rules (decision, groupKey, exclusionReason, scope) -> (d) profiles (cell keys, engine structure order, group values, pool values) -> (e) document rule set (engine order) -> (f) cross (group-in-profile by mapping order, cell duplicates by profile order, mapping id duplicates by mapping order). Items are visited in request order; the layers are NOT interleaved per item.

#### Decisions and assumptions (`[not in docs]` = design / acceptance are silent)

1. **Style.** Validators return `Defect[]` (empty = valid) and are total; `assertNoDefects` is the thin throwing helper (`PUBLISH_VALIDATION_FAILED`, defects copied). Keeping "typed error thrown by the service inside the transaction" consistent with M3.A/B.
2. **Catalog input.** `request` and every element are accepted as `unknown`. Request not an object -> `NOT_OBJECT @ catalog`; `treatmentVersions` / `commonBaseFees` not arrays (also `undefined`) -> `NOT_ARRAY`. Empty arrays are valid `[not in docs]`. Required (VALUE_MISSING when absent or null): treatment version `id treatmentId displayName benefitType patientAmount treatmentCode procedureCodes calcClass documentFlags origin`; base fee `id clinicId displayName benefitType amount code origin`. `description`, `amountCondition`, `effectiveDate` are not judged `[not in docs]` (the engine does not read them). `displayName` and base fee `code` are checked for being strings only, not for emptiness `[not in docs]`.
3. **Amounts and flags.** Prices and base fees use the engine `isWon` (so `-0`, `NaN`, `Infinity`, decimals, strings, `MAX_AMOUNT_WON + 1` are `VALUE_INVALID`; `0` and `MAX_AMOUNT_WON` pass). `documentFlags` must be an object with three strict booleans (no coercion).
4. **`procedureCodes`.** Array of non-empty strings; an empty array and repeated codes are allowed `[not in docs]` (DD-03/DD-15/DD-18 are silent; the fingerprint keeps duplicates).
5. **Origins (AC-010c).** An `origin` outside the three-value enum is `VALUE_INVALID` and never reaches the acceptance check; an enum value not in `acceptedLineOrigins` is `ORIGIN_NOT_ACCEPTED`. An empty accepted list rejects every origin. Rule items (profile, mapping, document rule set) are only checked against the enum; the accepted-rules-origin policy is the calculation's `isUsable` job and the brief gave the validator no rule-origin configuration.
6. **Duplicates.** Every member of a duplicate group is reported (not only the later ones) so the result does not depend on array order. Treatment version `id` duplicates (`DUPLICATE_ID`) are an addition beyond the brief's list (integrity, not a business rule) `[not in docs]`. Entries with a malformed key are not counted as duplicates.
7. **Bundle request and resolver.** The three request fields are refs; the validator never reads a repository. A ref must be an object with `kind` equal to the slot's kind and non-empty string `id` and `version`; only well-formed refs reach the resolver, once each, in the order profiles, mappings, document rule set. A resolver result that is not a plain object is `REF_UNRESOLVABLE`. A resolver that throws is the caller's fault and is not caught. `documentRuleSet: null` means none; a missing or `undefined` field is `VALUE_MISSING` (not assumed to mean none) `[not in docs]`.
8. **Malformed parts.** A malformed or unresolvable item is reported and read no further; the other items continue through layers (b) to (e). Layer (f) runs only when `profiles` and `mappings` are arrays and every item is well-formed and resolved, because "this cell has no profile" and "this group is missing" are wrong judgments on an incomplete list (tested with a bundle that has all three cross defects and one extra `null`).
9. **Header (b)** mirrors engine `isUsable`'s criteria: `origin` enum; `policySources` an array with at least one entry and every entry an object with the six `PolicySourceRef` fields as non-empty strings (whitespace-only counts as non-empty, same as the engine); `approver` an object with non-empty `approverId` and `approvedAt`; profile and document rule set `contentHash === canonicalDigest(profileContent(p) | documentRuleSetContent(s))` (a missing, empty or non-string hash is a mismatch; the hash is never repaired); mapping `approvedFingerprint` a non-empty string. Lifecycle `state` and `validity` are not judged here: the service checks item states as a precondition and calculation checks both through `isUsable`. Whether a mapping fingerprint equals the CURRENT treatment version is not checked (no treatment data here). The seal check is tested against `isUsable`'s INTEGRITY verdict on the same variants (reordered groups/pools/rules keep the seal, a changed value, `groupOrder`, rule text, priority or version breaks it).
10. **Mapping field rules (c).** `decision` outside `COVERED`/`EXCLUDED` -> `DECISION_INVALID` only (the group/reason rules are then skipped); "absent" means `undefined`, exactly as the engine's defensive check (`null` or `''` counts as present). `exclusionReason` / `groupKey` emptiness uses the engine's non-empty-string test (whitespace-only passes). `scope` must be an array of `{generation, insurerType}` from the closed lists (the engine's `resolveMapping` reads it) `[not in docs]`; an empty `scope` is allowed `[not in docs]`.
11. **Profile values (d).** The value half of engine `checkGroupValues` is mirrored field by field: `fixed`, `amount`, `perUseAmount` (Won), `rate`, `rateBenefit`, `rateNonBenefit` (BasisPoints), plus `rounding` (`TRUNCATE` / `ROUND_HALF_UP`) and a missing `limitBasis`. `rounding` is not in the DD-24 field table but design.md:48 and :254 treat a missing `rounding` as `PROFILE_VALUE_MISSING`, so a profile that publishes must not hit that hold at calculation. Absent or null -> `VALUE_MISSING`; present but invalid -> `VALUE_INVALID`. Formula support is NOT a defect: unknown deduction/limit kinds (including non-objects), `limitBasis` other than `PAYOUT` and `UNLIMITED_DECLARED` without a clause pass publish (tests show the engine holds them with `PROFILE_FORMULA_UNSUPPORTED` / `PROFILE_SOURCE_INCOMPLETE`).
12. **Pools `[interpretation]`.** Pool limit values are validated whether or not any group uses the pool. acceptance.md:217 says an out-of-range pool amount is rejected "like group values" and also that a pool without members is not rejected; I read the second as a structure statement (design.md:88 rule 3). The engine only sees a memberless pool's value if a group points at it, so publish is intentionally stricter here. The agreement test uses a probe group per pool so the engine itself judges every pool.
13. **Agreement test.** `validate-bundle-profile.test.ts` generates 800 profiles with fixed seed 20261016 (printed with `console.info`; use `--reporter=verbose` to see it) and checks, per group, per pool and per pool member, that publish numeric verdicts equal the engine's `PROFILE_VALUE_MISSING | PROFILE_VALUE_INVALID` verdicts. The generator avoids unsupported kinds on purpose (the engine returns a single code by priority, so `PROFILE_FORMULA_UNSUPPORTED` would mask a value code); masking is covered by the separate unsupported table. The test asserts it saw more than 100 bad and 100 good groups and more than 30 bad and 30 good pools so it cannot pass vacuously.
14. **Cross checks (f).** A COVERED mapping is checked against the profiles of its scope cells that passed the engine structure check (a profile with a structure defect has an unreliable group list and is already rejected); it is reported ONCE per mapping at `bundle.mappings[i].groupKey` if any such profile in any of its cells lacks the group; cells without a profile are skipped (not a defect). Cell and mapping-id duplicates report every member. The cell check ignores profiles whose cell keys are not in the closed lists (their `VALUE_INVALID` is already reported).
15. **Reuse.** The validators import `checkProfileStructure`, `checkDocumentRuleSetStructure`, `profileContent`, `documentRuleSetContent`, `profileHasGroup`, `isWon`, `isBasisPoints` from the engine and `canonicalDigest` from `digest.ts`; `validate-reuse.test.ts` scans the sources to prove the imports are real, that no same-named function is defined anywhere in `src/server`, and that no validator imports `node:crypto`.
16. **Determinism.** No clock, random or id source is used; the existing server boundary test (hazard rules, import rules) passes over the new files unchanged.

#### AC coverage by the validators (no AC is closed in M3.C)

| AC | Covered by the validators (test file : describe) | Remains for the publish service (M3.D) |
|----|-----------------------------------------------|---------------------------------------|
| AC-007f | `validate-bundle-docrules.test.ts` : `거절하지 않는 것`, `구조·when 계약 ...` (one case per engine defect code with `bundle.documentRuleSet.rules[i]...` paths, whitespace-only `reason`, `rules: []`, `when: {}`, priority 0 and `Number.MAX_SAFE_INTEGER`, many injury-only/illness-only lines), `머리 정보 배선`, `봉인` | the typed error out of the service, "nothing stored" (repository before/after equal), previous version intact, publishing the corrected bundle |
| AC-010c | `validate-catalog.test.ts` : `허용 출처 (AC-010c)` (operating config rejects `DEMO` and `TEST_FIXTURE` treatment versions and base fees, test config accepts all three) | the service rejection with the repository unchanged; "no seed/migration path writes DEMO/TEST_FIXTURE as APPROVED/PUBLISHED" |
| AC-011h | `validate-catalog.test.ts` : `금액 범위 (DD-24 ...)` (price and base fee, boundaries 0 and `MAX_AMOUNT_WON`, `MAX_AMOUNT_WON + 1`, negative, decimal, NaN, strings); `validate-bundle-profile.test.ts` : `$label 의 값 범위 (DD-24)` for group deduction, group limit and pool limit (rates 0 and 10000 pass, 10001 and -1 fail) with field paths | typed error from the service, nothing stored, previous version intact |
| AC-011i | mapping field rules: `validate-bundle-mapping.test.ts`; profile structure and pool values: `validate-bundle-profile.test.ts` (12 engine codes, memberless pool allowed); cross checks: `validate-bundle-cross.test.ts`; the `M3 · 미구현` form sub-criterion: `validate-bundle-form.test.ts` (`profiles = null` and `mappings = null` separately, `undefined`, object, string, number, boolean; `null`/`undefined`/primitive/array items; empty arrays valid; no throw for any garbage) | typed error from the service, repository before/after equal, no bundle status event written, previous bundle intact, corrected bundle publishes |
| AC-011a (seal part only) | `validate-bundle-profile.test.ts` : `봉인 ...`, `validate-bundle-docrules.test.ts` : `봉인 ...` (reorder with the original hash passes, changed values / `groupOrder` / rule content fail, agreement with `isUsable`) | bundle `contentHash`, immutability of published versions through the service, recovery |

#### RED before GREEN (exact statement)

Order: (1) the fixtures, the eight new `validate-*` test files and the `domain.test.ts` code-list edit were written first, with no file under `src/server/validate/`, no `publish-validate.ts` and no `PUBLISH_VALIDATION_FAILED` code; (2) the RED run; (3) the implementation. RED: `npx vitest run <the 8 new files + domain.test.ts> --maxWorkers=4` -> exit 1 (`red.txt`): `Test Files  9 failed (9)`, `Tests  1 failed | 24 passed (25)`. Eight files could not load (`Cannot find module '../../src/server/publish-validate'`) and `domain.test.ts` failed on the missing `PUBLISH_VALIDATION_FAILED` code. `npx tsc --noEmit` was exit 0 on the first try and the same command passed on the first run (9 files / 659 tests, exit 0, `first-run.txt`) — no failing iteration between RED and GREEN. Written AFTER the first GREEN (test-after, they passed immediately and are not RED evidence): the non-object-limit row of the unsupported table (the first coverage run showed that line uncovered), `validate-reuse.test.ts` (17 tests), the code-set assertion in the garbage-input test, and the cross-skip test in `validate-bundle-form.test.ts` (added because mutation (i) below survived; it fails under that mutation). Two source refactors followed the first coverage run: `repeatedPositions` replaced `Map.get(...) ?? 0` fallbacks that were unreachable branches (behavior unchanged, tests green before and after). A scratch script, not repo code, applied the mutations.

#### Evidence (outputs saved under `.moai/state/verify/m3c/`, gitignored; all vitest runs with `--maxWorkers=4`)

```
$ npx vitest run tests/server tests/boundary --maxWorkers=4          -> exit 0   (vitest-server-boundary.txt)
 Test Files  25 passed (25)
      Tests  1789 passed (1789)
$ npx vitest run tests/engine tests/boundary --maxWorkers=4          -> exit 0   (vitest-engine-boundary.txt)
 Test Files  36 passed (36)
      Tests  1544 passed (1544)          (unchanged from M3.A/M3.B)
$ npx tsc --noEmit                                                   -> exit 0   (tsc.txt)
$ npx vitest run --coverage tests/server --maxWorkers=4              -> exit 0   (coverage-server.txt)
 Test Files  21 passed (21)
      Tests  1546 passed (1546)
$ npx vitest run --coverage tests/engine --maxWorkers=4              -> exit 0   (coverage-engine.txt)
 Test Files  32 passed (32)
      Tests  1301 passed (1301)
```

Baseline before this step (same tree, `baseline-server-boundary.txt`): `tests/server tests/boundary` 16 files / 1136 tests. Now 25 files / 1789 tests = +9 files, +653 tests (the 9 new files; `domain.test.ts` count unchanged at 25). No `skip`, `only` or disabled test.

Per-folder coverage (`covsum.mjs` over `coverage/coverage-summary.json`; `coverage-server-rows.txt`, `coverage-engine-rows.txt`):

```
src/server (tests/server run):  statements 783/783  branches 410/410  functions 191/191  lines 747/747   = 100% each
src/engine (tests/engine run):  statements 652/652  branches 558/558  functions 145/145  lines 606/606   = 100% each (unchanged)
```

No coverage exclusions. `docrules` has no unreachable defensive branch: the engine's `RULE_SET_NOT_OBJECT` cannot occur because only objects pass the form layer (documented in the file).

#### Mutation spot checks (each run with `npx vitest run tests/server --maxWorkers=4` against the final test set; every edit reverted by the script; `src-hashes-before-mutation.txt` equals `src-hashes-after-mutation.txt`, `git status` shows only the intended files; outputs `mut-a.txt` ... `mut-p.txt`)

| Mutation | Result |
|----------|--------|
| (a) catalog: accepted-origin check removed | `Test Files  1 failed \| 20 passed (21)`, `Tests  7 failed \| 1539 passed (1546)` |
| (b) catalog: patient amount accepts any number | `2 failed \| 19 passed`, `12 failed \| 1534 passed` |
| (c) form: non-object item silently skipped | `1 failed \| 20 passed`, `20 failed \| 1526 passed` |
| (d) header: seal check disabled | `5 failed \| 16 passed`, `14 failed \| 1532 passed` |
| (e) mapping: COVERED `exclusionReason` no longer forbidden | `1 failed \| 20 passed`, `5 failed \| 1541 passed` |
| (f) profile: `rate` checked with `isWon` instead of `isBasisPoints` | `2 failed \| 19 passed`, `12 failed \| 1534 passed` |
| (g) profile: pool limit values not checked | `1 failed \| 20 passed`, `45 failed \| 1501 passed` |
| (h) cross: group-not-in-profile never reported | `3 failed \| 18 passed`, `8 failed \| 1538 passed` |
| (i) bundle: cross checks run despite form defects | first run SURVIVED (`21 passed`, `1545 passed`); after the cross-skip test was added: `1 failed \| 20 passed`, `1 failed \| 1545 passed` |
| (j) docrules: engine structure result ignored | `1 failed \| 20 passed`, `24 failed \| 1522 passed` |
| (k) shape: `null` no longer counts as absent | `4 failed \| 17 passed`, `42 failed \| 1504 passed` |
| (l) form: missing `documentRuleSet` field not flagged | `1 failed \| 20 passed`, `1 failed \| 1545 passed` |
| (m) shape: duplicates need three occurrences | `3 failed \| 18 passed`, `12 failed \| 1534 passed` |
| (n) `assertNoDefects` never throws | `1 failed \| 20 passed`, `3 failed \| 1543 passed` |
| (o) a second `checkProfileStructure` defined in the validators | `1 failed \| 20 passed`, `1 failed \| 1545 passed` |
| (p) profile seal hashed with `JSON.stringify` instead of `canonicalDigest` | `6 failed \| 15 passed`, `405 failed \| 1141 passed` |

All 16 mutants end up killed with the final tests (one needed an added test, see (i)). The table counts come from the last full mutation run (1546 tests).

#### OPEN items / NOT IMPLEMENTED / NOT VERIFIED

1. **Item lifecycle state is not judged by the validator.** Which states a bundle may include (`APPROVED` to be published by the bundle publish, or already `PUBLISHED`) is a service precondition for M3.D; the validator only sees assembled engine items. `validity` ranges are not judged either (calculation does, `OUTSIDE_VALIDITY`).
2. **Resolver contract for M3.D.** The service must build resolver results from a fresh state read and the `toEngine*` projections (so `approver`, `state` and a mapping's `approvedFingerprint` come from the state record), and must ensure the resolved item's `id`/`version` equal the ref (the validator does not compare them; `toEngine*` already throws `REF_CONTENT_MISMATCH` for a state/content mismatch).
3. **Clinic ownership** of base fees (`clinicId` equals the catalog's clinic) and treatment ownership are service concerns; the catalog validator takes no clinic id.
4. **SPEC wording notes (not edited):** (a) design.md DD-24 field table (design.md:1292-1300) does not list `rounding` although design.md:48 and :254 make a missing `rounding` a value hold; the validator follows the engine. (b) acceptance.md:217 asks both that an out-of-range pool amount be rejected and that a memberless pool not be rejected; see decision 12. (c) acceptance.md:216 names `policySourceIds` while the engine/DD-18 item types carry `policySources` (the validator checks `policySources`).
5. **Known limit of the agreement test:** it avoids unsupported formulas in the generator because the engine returns one code by priority; masking is covered by example rows, not by the generated set.
6. NOT IMPLEMENTED: the publish services, transactions, bundle status events, rollback and recovery, scope assignment, DD-10 default reader (M3.D); readiness tables (M3.E). AC-007f, AC-010c, AC-011h, AC-011i (and AC-011a) stay open until M3.D.
7. NOT VERIFIED: any service-level atomicity ("nothing stored"); any DB behavior; only Windows 11 and Node 24.19.0 were run, with no CI.

### M3.D1 게시 서비스·버전 불변·복구, 2026-10-16

**Scope.** M3.D1 only (cycle_type = tdd), on branch `feature/SPEC-REIMBURSEMENT-001-m3-data` on top of M3.C (`b1c440f`), not committed by this step. It builds the publish SERVICES that call the M3.C pure validators inside repository transactions: the catalog publish service (role `HA`), the rule bundle publish service (role `RV`), immutability of published `CatalogVersion` / `RuleBundleVersion`, the bundle content hash, and recovery (restore an earlier catalog version or rule bundle version as a NEW-id copy through the same pipeline). There is NO bundle suspend, NO suspend reason check, NO `ClinicRuleScope` assignment, NO insurer service, NO `IdlePolicy` reader (all M3.D2), NO readiness tables (M3.E), NO HTTP, NO DB, NO M4-M7 work. Errors are typed `DomainError` thrown inside the transaction (same style as M3.A to M3.C); every rejection leaves the repository deep-equal to its state before the call. **Closed by this step (tests pass): AC-007f, AC-009a, AC-009c, AC-010c, AC-011a, AC-011b, AC-011h, AC-011i.** Not closed: AC-011c, 011d, 011e, 011j, 011k, 011l. AC-024a and AC-025b get no new evidence from this step.

#### What was built

| File | Change |
|------|--------|
| `src/server/catalog-publish.ts` | NEW. `publishCatalog`, `restoreCatalogVersion` |
| `src/server/bundle-publish.ts` | NEW. `publishRuleBundle`, `restoreRuleBundle`, `computeBundleContentHash`, `bundleContentHashOf` |
| `src/server/versioning.ts` | NEW. Facade that re-exports the two modules (plan.md file list name); exports no modify/delete verb |
| `src/server/publish-defects.ts` | NEW. `SERVICE_PUBLISH_DEFECT_CODES` (8 service-level defect codes, documented in the file header) |
| `src/server/treatment-current.ts` | NEW. `currentTreatmentVersion(repo, treatmentId)`: the one rule that picks a treatment's "current" version (extracted from `approval.ts`) |
| `src/server/approval.ts` | CHANGED (refactor, behavior preserved): `pinnedFingerprint` now calls `currentTreatmentVersion`. No M3.B test was edited and all still pass |
| `tests/server/publish-catalog.test.ts` | NEW, 66 tests |
| `tests/server/publish-bundle.test.ts` | NEW, 189 tests |
| `tests/server/versioning.test.ts` | NEW, 44 tests |
| `tests/server/no-seed-paths.test.ts` | NEW, 9 tests |
| `tests/fixtures/server/versioning.fixture.ts` | NEW fixtures (all `TEST_FIXTURE`): catalog world, bundle world, `validSpec` / `approveSpec`, engine snapshot assembly, `lineOfVersion` |

New tests total 308 (4 files). No file under `src/engine/**`, `tests/engine/**`, `tests/boundary/**` or `tests/fixtures/engine/**` was edited; `package.json` and `vitest.config.ts` are untouched; no existing test was edited; the existing `repo-memory.test.ts` method-name scan test (no delete-like verbs) still passes because no `Repository` method was added.

#### Public API (what M3.D2 / M3.E / M4 / M7 call)

```ts
// src/server/catalog-publish.ts (re-exported by src/server/versioning.ts)
publishCatalog(deps: ServiceDeps, actor: Actor, clinicId: string,
               request: unknown /* { treatmentVersions: TreatmentVersion[]; commonBaseFees: CommonBaseFee[] } */,
               config: CatalogPublishConfig /* { acceptedLineOrigins: readonly Origin[] } */): CatalogVersion
restoreCatalogVersion(deps: ServiceDeps, actor: Actor, sourceCatalogVersionId: string, config: CatalogPublishConfig): CatalogVersion
// src/server/bundle-publish.ts
publishRuleBundle(deps: ServiceDeps, actor: Actor,
                  request: unknown /* { profiles: ItemVersionRef[]; mappings: ItemVersionRef[]; documentRuleSet: ItemVersionRef | null } */): RuleBundleVersion
restoreRuleBundle(deps: ServiceDeps, actor: Actor, sourceBundleId: string): RuleBundleVersion
computeBundleContentHash(entries: readonly { ref: ItemVersionRef; contentDigest: string }[]): string
bundleContentHashOf(repo: Pick<Repository, 'getItemVersion'>, itemRefs: readonly ItemVersionRef[]): string
// src/server/treatment-current.ts
currentTreatmentVersion(repo, treatmentId: string): TreatmentVersion | null
```

All four services throw `DomainError`: `ROLE_NOT_PERMITTED` (wrong role, nothing read), `NOT_FOUND` (missing clinic / restore source), `PUBLISH_VALIDATION_FAILED` with `{ code, path }` defects (validator defects first, then service-level defects), or a repository error (`IMMUTABLE_VERSION`, `STATE_CONFLICT`, `DUPLICATE_KEY`) which rolls the whole transaction back. D2 can write its suspend through `appendBundleStatusEvent` (repository) and read the current ACTIVE/SUSPENDED state with `getBundleStatus`; a restored bundle is always a new ACTIVE bundle, even when the source is SUSPENDED (DD-14 recovery path).

#### Decisions and assumptions (`[not in docs]` = design / acceptance are silent)

1. **Catalog publish pipeline (one transaction).** `HA` role -> clinic exists (`NOT_FOUND`) -> `validateCatalogPublish` + `assertNoDefects` -> service ownership checks -> new id from the injected generator (called only after validation, so a rejection does not consume ids) -> `putTreatmentVersion` / `putCommonBaseFee` / `putCatalogVersion` -> `saveClinic` with the new `currentCatalogVersionId` -> `triggerReReview` for EVERY treatment version in the catalog -> audit. `[not in docs]` Calling the trigger for every version (not only "changed" ones) is idempotent because it compares the mapping's pinned fingerprint with the version's fingerprint; a price-only change and an unchanged treatment move nothing (AC-009a, AC-009c).
2. **Ownership checks (validator contract: "the service's job"), reported after the validator's defects and only when the validator found none.** A treatment version whose treatment is absent -> `TREATMENT_ABSENT` @ `treatmentVersions[i].treatmentId`; whose treatment belongs to another clinic -> `TREATMENT_CLINIC_MISMATCH` (same path); a common base fee whose `clinicId` differs -> `BASE_FEE_CLINIC_MISMATCH` @ `commonBaseFees[i].clinicId`. `[not in docs]` Because the ownership phase runs only on a validator-clean request, a request with both a value defect and an ownership defect reports only the value defect first.
3. **Change summary** (`CatalogChangeSummary`) is computed against the clinic's previous CURRENT catalog: added / removed treatment ids, treatment ids whose `patientAmount` differs (display name and other fields are not price changes), all sorted by code point; `baseFeesChanged` = the set of base fee ids differs (base fees are write-once by id, so a changed fee has a new id). No previous catalog = everything is "added" and `baseFeesChanged` is true only if the new catalog has base fees. `CatalogVersion.treatmentVersionIds` / `baseFeeIds` keep request order.
4. **Which item states a bundle may contain (DD-17).** DD-17 lists the only incoming transition of `PUBLISHED` as "규칙 묶음 게시", and a bundle's items must be usable (`PUBLISHED`). So a bundle may contain `APPROVED` items (the publish moves them to `PUBLISHED` in the same transaction, via `markPublished`, with actor, time and audit entry; approver and pinned fingerprint are carried unchanged) and items that are already `PUBLISHED` (published by another bundle; DD-14 expressly allows a second bundle to contain the same item version; no transition, no new history entry). Every other state (`DRAFT`, `REVIEW_REQUESTED`, `REJECTED`, `UNDER_REREVIEW`, `SUSPENDED`, `SUPERSEDED`, `EXPIRED`) is rejected with `ITEM_STATE_NOT_PUBLISHABLE` @ `bundle.profiles[i].state` (`bundle.mappings[i].state`, `bundle.documentRuleSet.state`). A 27-cell matrix (3 kinds x 9 states) proves exactly `APPROVED` and `PUBLISHED` publish.
5. **`[not in docs]` Publishing a bundle does NOT supersede older versions of the same item.** DD-17 names "새 버전 게시" as the trigger of `SUPERSEDED`, but item state is read on every calculation request (DD-14), so superseding the previous version at bundle publish would make the previous bundle (still the clinics' current scope) unusable before `ClinicRuleScope` is reassigned. `SUPERSEDED` stays the explicit `markSuperseded` action. Flagged for the owner (OPEN item 2).
6. **`[not in docs]` Validity precondition.** Both dates must be calendar `YYYY-MM-DD` dates, `from <= to`, and `to` must not be earlier than the publish date (the injected clock's date), so an item that is already over cannot be published; a validity that starts in the future IS publishable (items can be published ahead of their effective date). Defect `OUTSIDE_VALIDITY` @ `<item>.validity`. The date check is a small local helper (`isCalendarDate`) because the engine's `isIsoDate` is private; it is not a same-named copy of an engine function. The usability verdict at calculation time (`isUsable` with `at`) is unchanged.
7. **Ref-content equality.** The resolver result's `id` / `version` must equal the requested ref (`ITEM_REF_MISMATCH` @ the item path). The memory repository already guarantees it on write, so the check is a backstop for other repository implementations; it is exercised through a `Proxy` repository that lies about the stored version.
8. **Stale mapping pin.** A mapping's pinned `approvedFingerprint` (from the state record) must equal `coverageFingerprintOf(currentTreatmentVersion(treatmentId))`: `FINGERPRINT_STALE` @ `bundle.mappings[i].approvedFingerprint`; no version at all -> `TREATMENT_VERSION_ABSENT` @ `bundle.mappings[i].treatmentId`. A missing pin (empty) is left to the validator's `FINGERPRINT_MISSING`. "Current treatment version" is the version in the clinic's current catalog, else the latest by write order; this is the same rule `approve` uses and now lives in one function (`treatment-current.ts`).
9. **Bundle contentHash (definition v1).** `canonicalDigest({ format: 'bodam.rule-bundle.v1', items })`, `items` = one `{ kind, id, version, contentDigest }` per item sorted by `(kind, id, version)` in code-point order, `contentDigest = canonicalDigest(stored item content)`. Inputs that are NOT part of it: request order, bundle id, publish time, publisher, current item states, mappings' pinned fingerprints (state-side). Consequences tested: independent of the order of `itemRefs` in the request (two worlds, reversed arrays, same hash and same stored `itemRefs`), recomputing it later from the repository gives the same value even after an item was suspended, two bundles with the same item versions have the same hash, a restored copy has the source's hash, a different item set or a next item version changes it. `RuleBundleVersion.itemRefs` is stored in the same canonical `(kind, id, version)` order. Changing the definition would invalidate comparison with already published bundles, hence the format marker.
10. **Bundle publish pipeline (one transaction).** `RV` role -> resolver built from repository reads (`getItemVersion` + `readItemStates` + `toEngineProfile/Mapping/DocumentRuleSet`; one `readItemStates` call per distinct ref, not one batch for the whole bundle) -> `validateRuleBundlePublish` -> service preconditions (ref equality, state, validity, mapping pin; reported after the validator's defects, in request order profiles -> mappings -> document rule set) -> `assertNoDefects` -> new bundle id (after validation) -> `putRuleBundleVersion` -> first `ACTIVE` event (previous status null, actor id / role / time, reason null) -> `markPublished` for `APPROVED` items -> audit `BUNDLE_PUBLISH` (target `BUNDLE/<id>`, before null, after the id). The empty bundle (`[]`, `[]`, `null`) is valid and publishes (`[]` is not a form defect, AC-011i).
11. **Recovery (AC-011b).** `restoreCatalogVersion` (HA) rebuilds the request from the source's stored treatment versions and base fees and publishes it through the same `publishNew` path with the CURRENT config (so an old catalog with `TEST_FIXTURE` origin cannot be restored under an operating config); `restoreRuleBundle` (RV) rebuilds the ref request from the source's `itemRefs`. The new record gets a new id, `publishedBy` / `publishedAt` of the restoring actor / clock, and a change summary relative to the clinic's current catalog (catalog). Audit entries use action `CATALOG_RESTORE` / `BUNDLE_RESTORE` and reason `RESTORE_OF:<source id>`. `[not in docs]` Restoring a catalog re-runs the re-review trigger for its treatment versions, so restoring an older version whose coverage fields differ from an approved mapping's pinned fingerprint moves that mapping to `UNDER_REREVIEW` (tested). The source and every other earlier version, event and history entry are untouched (deep-equal tests). The restored catalog belongs to the source's clinic: M7 must check the actor's membership of that clinic.
12. **Immutability (AC-011a).** No service modifies or deletes a published version; the facade exports only publish / restore / hash functions (a test rejects any export name matching delete / remove / update / edit / modify / overwrite / revise / drop). Repository-level rewrite with different content is `IMMUTABLE_VERSION` (catalog and bundle, several mutated fields each). Service-level attempt: an id generator that replays an existing catalog or bundle id (the id is the only way a service could target an existing version) makes the second, different publish fail with `IMMUTABLE_VERSION` and the repository stays deep-equal; the same-content replay of a bundle fails at the status-event chain (`STATE_CONFLICT`). A failure in the LAST step (an occupied audit id) rolls back every earlier write of a publish or a restore (catalog and bundle).
13. **Seal contract (AC-011a, real publish).** The bundle is published through the service; the published profile / document rule set records are then read back and assembled with `toEngine*`, and the engine `isUsable` (with `canonicalDigest`) is run: the sealed hash verifies; reordered `groups` / `sharedLimitPools` / `rules` and reversed object key order still verify with the hash computed from the original (non-sorted) order; changed values (fixed, limit, pool limit), changed `groupOrder`, group key, version label, generation (profile) and changed rule reason / priority / document code / removed rule / version label (rule set) give `INTEGRITY_MISMATCH`. Only `profileContent`, `documentRuleSetContent` and `canonicalDigest` are used (the sealing is done by the M3.B authoring service); no second normalization exists.
14. **AC-010c "no seed / migration path" claim, exactly what is supported** (`tests/server/no-seed-paths.test.ts`, token scan of `src/server`, comments ignored): (1) no module or identifier named seed / migrate / bootstrap / import / loader / fixture / demo / sample exists; (2) the origin names `DEMO` / `TEST_FIXTURE` appear only in `validate/shape.ts` (closed enumeration used for validation), never as a value written to a record; (3) the only non-repository code calling `putTreatmentVersion` / `putCommonBaseFee` / `putCatalogVersion` is `catalog-publish.ts`, and it calls the validator and `assertNoDefects` before its first write; (4) the only non-repository callers of `recordItemTransition` are `authoring.ts`, `approval.ts` and `re-review.ts`; the publish services never write a state themselves (they call `markPublished`). NOT claimed: anything about code outside `src/server` (none exists), a DB adapter (none), or that an operating database is empty.
15. **Determinism.** The services use no clock, random or id source of their own; a scenario of publishes and restores run in two fresh worlds yields deep-equal repository state (audit log and status events included). The server boundary test (hazard rules, imports) passes over the new files unchanged.

#### AC evidence (test file -> describe -> what is checked)

| AC | Test file / describe | What is checked |
|----|----------------------|-----------------|
| AC-007f | `publish-bundle.test.ts` : `AC-007f 서류 규칙 묶음 게시: 구조 결함은 엔진 결함 경로와 함께 거절되고 아무것도 저장되지 않는다` | 10 rows (whitespace-only and empty `reason`, unknown document code, negative / unsafe `priority`, unknown `when` key, non-`true` flag, non-object `when`, non-object rule entry, non-array `rules`): typed `PUBLISH_VALIDATION_FAILED`, defect `bundle.documentRuleSet.rules[i]...`, repository before/after deep-equal incl. no status event, previous bundle and its items intact, corrected bundle publishes; `rules: []` publishes; several injury-only / illness-only lines publish; a valid `reason` is stored verbatim |
| AC-009a | `publish-catalog.test.ts` : `AC-009a ...` | through `publishCatalog`, each of `treatmentCode`, `procedureCodes`, `benefitType`, `calcClass` changed separately moves an `APPROVED` and a `PUBLISHED` mapping to `UNDER_REREVIEW` (8 cases; history reason `COVERAGE_JUDGMENT_FIELD_CHANGED`, actor = the HA publisher, audit `ITEM_REREVIEW`); 7 neutral changes (price, display name, description, amount condition, document flags, effective date, procedure code order) x 2 states move nothing; other treatments' mappings and a DRAFT mapping untouched; a rejected publish does not move the mapping |
| AC-009c | `publish-catalog.test.ts` : `AC-009c ...` | real engine `estimate()`: line `ESTIMATED` at 10,000; after a price-only publish (new `CatalogVersion`, `changeSummary.priceChangedTreatmentIds = [T1]`, earlier version unchanged, mapping still `PUBLISHED`) the line is `ESTIMATED` at the NEW price 25,000 with no hold reasons; contrast: a coverage-field change gives `ON_HOLD` / `MAPPING_UNDER_REREVIEW` |
| AC-010c | `publish-catalog.test.ts` : `AC-010c ...`; `no-seed-paths.test.ts` | operating config (`['OPERATING']`) rejects `DEMO` and `TEST_FIXTURE` treatment versions and base fees with `ORIGIN_NOT_ACCEPTED` @ `...origin`, repository unchanged; mixed requests are rejected as a whole; test config accepts both; an empty accepted list rejects everything; the scan test states the supported claim (decision 14) |
| AC-011a | `versioning.test.ts` : `AC-011a ...` (immutability, profile seal, rule set seal); `publish-bundle.test.ts` : `묶음 내용 해시` | immutability and seal as in decisions 9, 12, 13; hash recomputation equal, order independence |
| AC-011b | `versioning.test.ts` : `AC-011b 카탈로그 복구`, `AC-011b 규칙 묶음 복구` | new id, same membership / same hash, current catalog / ACTIVE event, older versions, events and item histories deep-equal, audit names the source, role rules (HA / RV), `NOT_FOUND`, old content failing today's rules (operating config; suspended / superseded / expired item) -> typed rejection and repository unchanged, restoring a SUSPENDED bundle gives a new ACTIVE one |
| AC-011h | `publish-catalog.test.ts` : `AC-011h 카탈로그 ...`; `publish-bundle.test.ts` : `AC-011h 규칙 묶음 게시 ...` | catalog price and base fee: negative, decimal, NaN, string, `MAX_AMOUNT_WON + 1` -> `VALUE_INVALID` with field path, nothing stored, previous catalog current; bundle: 4 Won fields (group deduction `fixed`, group limit `amount`, `perUseAmount`, pool limit `amount`) x 5 bad values and 4 rate fields (`rate`, capped `rate`, `rateBenefit`, `rateNonBenefit`) x 5 bad values (below 0, above 10000, decimal, NaN, string), field path `bundle.profiles[0].groups[0]...`, repository unchanged, previous bundle intact, corrected bundle publishes; boundaries 0 / `MAX_AMOUNT_WON` (rates 0 / 10000) publish |
| AC-011i | `publish-bundle.test.ts` : `AC-011i ...` (mapping field rules, profile structure, bundle cross checks, item form) | 9 mapping rows, 10 profile structure rows (incl. out-of-range pool amount), 3 cross rows, and the form sub-criterion (`profiles` / `mappings` = null, undefined, object, string, number, boolean separately; null, undefined, number, string, boolean, array items; missing `documentRuleSet`; unresolvable and wrong-kind refs): typed error with paths, repository before/after deep-equal, no status event for the next bundle id, previous bundle intact, corrected bundle publishes; memberless pool and a mapping scoped to a cell without a profile publish; `[]` is valid; unsupported formula kinds are not a publish defect |

#### RED before GREEN (exact statement)

Order: (1) the fixture `versioning.fixture.ts` and the four test files were written first, with no `catalog-publish.ts`, `bundle-publish.ts`, `versioning.ts`, `publish-defects.ts` or `treatment-current.ts` yet; (2) the RED run; (3) the implementation. RED: `npx vitest run <the 4 new files> --maxWorkers=4` -> exit 1 (`red.txt`): `Test Files  4 failed (4)`, `Tests  5 failed | 4 passed (9)`. Three files could not load (`Cannot find module '../../src/server/bundle-publish'` for `publish-bundle.test.ts`, `.../catalog-publish` for `publish-catalog.test.ts`, `.../versioning` for `versioning.test.ts`); the scan test file ran its 9 tests with 5 failing (for example `expected [] to deeply equal [ 'src/server/catalog-publish.ts' ]`). Two expectations in the scan test were corrected AFTER the RED run because they were my own mistakes, not behavior (the file-count threshold `> 30` was above the 29 source files that existed at RED time, and `approval.ts` also writes `REJECTED` and `REVIEW_REQUESTED` through `to:`); a third (call order of `validateCatalogPublish` / `assertNoDefects`) was fixed before the first GREEN run.
After the implementation `npx tsc --noEmit` was exit 0 and the first run (`first-run.txt`) was `Test Files  2 failed | 2 passed (4)`, `Tests  7 failed | 295 passed (302)`; all 7 failures were defects in my new tests (a request that mixed rejected and accepted origins, a DEMO republish of an existing id, an id-replay helper that restarted its audit counter), fixed in the tests only; the implementation was not changed between `first-run.txt` and the green `second-run.txt` (4 files / 302 tests). Test-after additions that passed immediately and are NOT RED evidence: three coverage-driven tests (an item with no state record, `bundleContentHashOf` on a missing item, restoring a bundle without a document rule set; the first coverage run showed one statement and two branches of `bundle-publish.ts` uncovered) and the atomicity group of 3 tests (added because mutation (k) below survived; it fails under that mutation). The `approval.ts` refactor and `treatment-current.ts` were written with the implementation (existing M3.B tests as safety net, unchanged and green).

#### Evidence (outputs saved under `.moai/state/verify/m3d1/`, gitignored; all vitest runs with `--maxWorkers=4`, run sequentially on the final tree)

```
$ npx vitest run tests/server tests/boundary --maxWorkers=4          -> exit 0   (vitest-server-boundary.txt)
 Test Files  29 passed (29)
      Tests  2097 passed (2097)          (M3.C baseline 25 files / 1789 tests + 4 files / 308 tests)
$ npx vitest run tests/engine tests/boundary --maxWorkers=4          -> exit 0   (vitest-engine-boundary.txt)
 Test Files  36 passed (36)
      Tests  1544 passed (1544)          (unchanged)
$ npx tsc --noEmit                                                   -> exit 0   (tsc.txt)
$ npx vitest run --coverage tests/server --maxWorkers=4              -> exit 0   (coverage-server.txt)
 Test Files  25 passed (25)
      Tests  1854 passed (1854)
$ npx vitest run --coverage tests/engine --maxWorkers=4              -> exit 0   (coverage-engine.txt)
 Test Files  32 passed (32)
      Tests  1301 passed (1301)
```

Per-folder coverage (`covsum.mjs` over `coverage/coverage-summary.json`; `coverage-server-rows.txt`, `coverage-engine-rows.txt`):

```
src/server (tests/server run):  statements 944/944  branches 490/490  functions 249/249  lines 890/890   = 100% each
src/engine (tests/engine run):  statements 652/652  branches 558/558  functions 145/145  lines 606/606   = 100% each (unchanged)
```

No coverage exclusions, no `skip` / `only` / disabled tests.

#### Mutation spot checks (each run with `npx vitest run tests/server --maxWorkers=4` after a scripted one-spot edit; the script restored the file from a backup each time; `src-hashes-before-mutation.txt` equals `src-hashes-after-mutation.txt` (49 files); outputs `mut-<id>.txt`; totals were 1851 tests for (a), (b), (d)-(j), (l), (m) and 1854 for (c), (k), (n) because the atomicity tests were added in between)

| Mutation | Result |
|----------|--------|
| (a) `catalog-publish.ts`: re-review trigger no longer called | `Test Files  2 failed \| 23 passed (25)`, `Tests  10 failed \| 1841 passed (1851)` |
| (b) `catalog-publish.ts`: validator always given all three origins (config ignored) | `3 failed \| 22 passed`, `8 failed \| 1843 passed (1851)` |
| (c) `catalog-publish.ts`: transaction wrapper replaced by a plain call (no rollback) | `1 failed \| 24 passed`, `2 failed \| 1852 passed (1854)` (an earlier faulty mutant that returned an uncalled function was discarded) |
| (d) `bundle-publish.ts`: item state precondition never fires | `2 failed \| 23 passed`, `24 failed \| 1827 passed (1851)` |
| (e) `bundle-publish.ts`: first `ACTIVE` status event not written | `3 failed \| 22 passed`, `108 failed \| 1743 passed (1851)` |
| (f) `bundle-publish.ts`: `computeBundleContentHash` no longer sorts its entries | `1 failed \| 24 passed`, `1 failed \| 1850 passed (1851)` |
| (g) `bundle-publish.ts`: stored `itemRefs` in request order instead of canonical order | `1 failed \| 24 passed`, `4 failed \| 1847 passed (1851)` |
| (h) `bundle-publish.ts`: stale pinned fingerprint never reported | `1 failed \| 24 passed`, `1 failed \| 1850 passed (1851)` |
| (i) `bundle-publish.ts`: `APPROVED` items not moved to `PUBLISHED` | `3 failed \| 22 passed`, `129 failed \| 1722 passed (1851)` |
| (j) `bundle-publish.ts`: validity precondition always true | `1 failed \| 24 passed`, `18 failed \| 1833 passed (1851)` |
| (k) `bundle-publish.ts`: transaction wrapper replaced by a plain call | first run SURVIVED (`25 passed`, `1851 passed`); after the atomicity tests were added: `1 failed \| 24 passed`, `1 failed \| 1853 passed (1854)` |
| (l) `catalog-publish.ts`: treatment of another clinic not reported | `1 failed \| 24 passed`, `2 failed \| 1849 passed (1851)` |
| (m) `treatment-current.ts`: current catalog membership ignored (always latest version) | `1 failed \| 24 passed`, `1 failed \| 1850 passed (1851)` |
| (n) `bundle-publish.ts`: restore audit reason no longer names the source | `1 failed \| 24 passed`, `1 failed \| 1853 passed (1854)` |

All 14 mutants end up killed with the final tests. (f), (h), (m) and (n) are killed by a single test each.

#### OPEN items / NOT IMPLEMENTED / NOT VERIFIED

1. **Bundle content hash input is a decision of this step** (decision 9): design.md DD-14 / DD-18 only say "내용 해시". If the owner wants the mapping's pinned fingerprint or the item states in the hash, the definition (and the format marker) must change.
2. **`SUPERSEDED` is not triggered by bundle publish** (decision 5). If the owner wants "new version publish supersedes the previous version", the previous bundle's items become unusable at once and the DD-14 recovery sequencing (publish, then reassign scopes) needs a rule for the gap.
3. **Validity precondition at publish is `[not in docs]`** (decision 6); the inclusion of the publish date and the allowance for future-starting validity are my choice.
4. **Ownership check order**: service-level (ownership) defects are reported only when the validator finds none (decision 2).
5. **Resolver reads**: one `readItemStates` call per distinct ref at publish (the DD-14 "one read per request" contract is for the calculation path, M4).
6. **Restoring a catalog re-runs the re-review trigger** (decision 11); and the restore copies the source's clinic, so M7 must check membership of that clinic.
7. NOT IMPLEMENTED (M3.D2): bundle suspend and its mandatory reason, re-activation rejection at service level, `ClinicRuleScope` assignment (PO), insurer separation, `IdlePolicy` default reader; AC-011d and AC-011e stay open. NOT IMPLEMENTED (M3.E): readiness tables; AC-011c, 011j, 011k, 011l stay open. M4 to M7, DB adapter, HTTP, deployment, merging and commits are not started.
8. NOT VERIFIED: any DB behavior; asynchronous transactions; behavior under real concurrency (two sessions publishing at once); the SPEC lint (`moai` CLI absent); only Windows 11 and Node 24.19.0 were run, with no CI. AC-024a / AC-025b receive no new evidence here.
9. SPEC wording notes (not edited): acceptance.md:207 (AC-011a) says "service-level attempts" to modify or delete are rejected, but no modify or delete service exists to attempt; the replayed-id test is the closest service-level attempt. acceptance.md:216 names `policySourceIds` while the engine / DD-18 item types carry `policySources` (also noted in M3.C).

### M3.D2 묶음 중지·범위·보험사·무조작 정책, 2026-10-16

**Scope.** M3.D2 only (cycle_type = tdd), on branch `feature/SPEC-REIMBURSEMENT-001-m3-data` on top of M3.D1 (`2b408b1`), not committed by this step. It builds four small services over the existing repository interface (no `Repository` method was added or changed): rule bundle suspend (role `RV`), `ClinicRuleScope` assignment (role `PO`), insurer institution records (role `RV`), and the clinic idle policy save (role `HA`) plus its default reader. Errors are typed `DomainError` thrown inside the transaction (same style as M3.A to M3.D1); every rejection leaves the repository deep-equal to its state before the call. **Closed by this step (tests pass): AC-011d, AC-011e.** The scope service and the idle policy close no AC by themselves (they are supporting scope for AC-011f / M4 / M5 / M7). Not closed: AC-011c, 011j, 011k, 011l (M3.E). NO readiness tables, NO HTTP, NO DB, NO estimate path, NO M4-M7 work.

#### What was built

| File | Change |
|------|--------|
| `src/server/bundle-status.ts` | NEW. `suspendRuleBundle` (the only export; there is deliberately no reactivation function) |
| `src/server/rule-scope.ts` | NEW. `assignRuleScope`, `readClinicRuleBundle`, `findAffectedClinics` |
| `src/server/insurer.ts` | NEW. `saveInsurerRecord` |
| `src/server/idle-policy.ts` | NEW. `saveClinicIdlePolicy`, `readIdlePolicy`, `IDLE_SCREEN_KINDS`, `DEFAULT_IDLE_THRESHOLDS`, `MIN_IDLE_LEAD_SECONDS` |
| `src/server/audit.ts` | CHANGED (additive): `AuditInput.affectedClinicCount?`; the entry gets the key only when it is passed, so every other audit entry keeps its 9 keys (the existing key-list test still passes) |
| `src/server/domain/entities.ts` | CHANGED (additive): `AuditLogEntry.affectedClinicCount?: number` |
| `tests/server/bundle-suspend.test.ts` | NEW, 34 tests |
| `tests/server/rule-scope.test.ts` | NEW, 13 tests |
| `tests/server/insurer.test.ts` | NEW, 42 tests |
| `tests/server/idle-policy.test.ts` | NEW, 70 tests |
| `tests/fixtures/server/governance.fixture.ts` | NEW fixtures (all `TEST_FIXTURE`): scope world with clinics 1-4 and one ACTIVE bundle, second bundle of the same items, three synthetic insurers |

New tests total 159 (4 files). No file under `src/engine/**`, `tests/engine/**`, `tests/boundary/**` or `tests/fixtures/engine/**` was edited; `package.json` and `vitest.config.ts` are untouched; no existing test was edited; `versioning.ts` (the exact-export-list facade) was not touched; the repository method-name scan test and the AC-010c no-seed scan test still pass (the new modules contain no seed / migrate / bootstrap identifiers and no `TEST_FIXTURE` / `DEMO` token).

#### Public API (what M3.E / M4 / M7 call)

```ts
// src/server/bundle-status.ts
suspendRuleBundle(deps: ServiceDeps, actor: Actor, bundleId: string, reason: string):
  { event: RuleBundleStatusEvent; affectedClinics: { clinicId: string; slug: string }[] }
// src/server/rule-scope.ts
assignRuleScope(deps, actor /* PO */, clinicId: string, bundleId: string): ClinicRuleScope
readClinicRuleBundle(repo, clinicId): { ruleBundleVersionId: string | null; ruleBundleStatus: 'ACTIVE' | 'SUSPENDED' | null }
findAffectedClinics(repo, bundleId): { clinicId: string; slug: string }[]      // id order, current scope only
// src/server/insurer.ts
saveInsurerRecord(deps, actor /* RV */, input: unknown): Insurer
// src/server/idle-policy.ts
saveClinicIdlePolicy(deps, actor /* HA */, clinicId: string, request: unknown /* { screens, completionHoldSeconds } */): IdlePolicy
readIdlePolicy(repo, clinicId): { clinicId; screens: Record<IdleScreenKind, { warnSeconds; resetSeconds }>; completionHoldSeconds: number | null }
```

Reading the calculation-time facts needs no new method: `repo.getClinicRuleScope(clinicId)` + `repo.getBundleStatus(bundleId)` (or `readClinicRuleBundle`, which does both and is read fresh on every call), and `repo.readItemStates(bundle.itemRefs)` for item states. Suspend errors: `ROLE_NOT_PERMITTED`, `REASON_REQUIRED` (defect `{code:'EMPTY', path:'reason'}`), `NOT_FOUND`, `STATE_CONFLICT` (already suspended or no availability record), repository `DUPLICATE_KEY` on an occupied audit id (whole transaction rolled back).

#### Decisions and assumptions (`[not in docs]` = design / acceptance are silent)

1. **Suspend pipeline (one transaction).** role `RV` -> reason check -> bundle exists (`NOT_FOUND`) -> current availability must be `ACTIVE` (`STATE_CONFLICT` otherwise: already `SUSPENDED`, or no availability record at all) -> append the `SUSPENDED` event (actor id / role, time from the injected clock, reason, `previousStatus = ACTIVE`) -> compute affected clinics -> audit `BUNDLE_SUSPEND` (target `BUNDLE/<id>`, before `ACTIVE`, after `SUSPENDED`, reason, affected count). The role is checked before the reason, so a non-RV with an empty reason gets `ROLE_NOT_PERMITTED`. The reason must be a string with a non-blank trim (`undefined`, `null`, numbers, objects, `''`, whitespace-only all give `REASON_REQUIRED`); it is stored verbatim, not trimmed. `REASON_REQUIRED` / path `reason` reuses the M3.B code and defect shape.
2. **No reactivation function exists.** DD-14 says "다시 활성으로 돌리는 동작은 없다", so `bundle-status.ts` exports only `suspendRuleBundle` (a test checks the export list for activate / resume / restore verbs). The two "reactivation attempt" proofs are therefore: (a) repository level, `appendBundleStatusEvent(ACTIVE, previousStatus = SUSPENDED | ACTIVE | null)` on a suspended bundle -> `STATE_CONFLICT`, nothing stored; (b) service level, the closest real attempt: a second `publishRuleBundle` of the same items at the same clock time with an id generator that replays the suspended bundle's id (the bundle record write is idempotent, the ACTIVE event is not) -> `STATE_CONFLICT`, repository deep-equal. A second suspend is also `STATE_CONFLICT` (no second `SUSPENDED` event). Same limitation as D1 decision 12 / OPEN item 9: acceptance.md:211 speaks of a service-level rejection but no reactivation service exists to attempt.
3. **Affected clinics = clinics whose CURRENT `ClinicRuleScope` points at the bundle id** (DD-14, design.md:828), computed with `listClinics` + `getClinicRuleScope`, returned as `{ clinicId, slug }` in clinic id order; earlier scope history and clinics on another bundle are not counted.
4. **`[not in docs]` Audit entry carries the affected-clinic count in a new OPTIONAL field `affectedClinicCount`.** design.md:828 requires the count in the suspend audit entry, but the DD-18 `AuditLog` field list (design.md:944) has no place for it. An optional field was the smallest additive change (no existing audit entry gains the key; the 9-key test still passes). M7's audit query should read the count from it.
5. **Scope assignment (PO).** `assignRuleScope` checks role `PO`, clinic exists, bundle exists (`NOT_FOUND`), appends to the history through `assignClinicRuleScope` and audits `CLINIC_SCOPE_ASSIGN` (target `CLINIC/<id>`, before = previous bundle id or null, after = new bundle id). `[not in docs]` Assigning a SUSPENDED bundle is ALLOWED: DD-14 only says the scope keeps pointing at a suspended bundle, and adding a rejection rule would be the bigger behavior; the calculation then holds with `RULE_BUNDLE_SUSPENDED`. Assigning the bundle that is already current appends another history entry (no de-duplication rule was invented). Suspending a bundle never touches any scope (tested on current value and history of all four clinics).
6. **Insurer records (RV).** An insurer is identified by `id` only. Input is validated field by field with fixed defect order (`id`, `insurerType`, `currentName`, `formerNames[i]`, `verifiedContact`): `id` / names must be strings with a non-blank trim (`EMPTY`), `insurerType` must be one of `NON_LIFE | LIFE | MUTUAL_AID` (the engine's closed list, via `validate/shape.ts`; absent -> `VALUE_MISSING`, other -> `VALUE_INVALID`), `formerNames` an array, `verifiedContact` a string or an explicit `null` (`undefined` -> `VALUE_MISSING`, no silent default). Only the known fields are stored (extra keys such as a `selfApproval` flag are dropped); names are stored verbatim (no trim, no Unicode normalization). Nothing looks up or merges records by name or alias: same name + different type, an alias equal to another record's current name, and same name + same type with a different id all stay separate records (tested). `[not in docs]` The `insurerType` of an EXISTING id cannot change (`STATE_CONFLICT`, defect `INSURER_TYPE_CHANGE` @ `insurerType`): changing it would turn one institution into another, which is the merge AC-011d forbids. Audit: `INSURER_SAVE`, target `INSURER/<id>`, before / after = `canonicalDigest` of the previous / new record (same convention as `editDraft`).
7. **Real names are not seeded.** AC-011d names NH농협손해보험, NH농협생명 and 과거 농협공제. Following brief §3 (no real insurer data), the tests use three visibly synthetic records `TEST_FIXTURE_INSURER_NONLIFE` (`NON_LIFE`), `TEST_FIXTURE_INSURER_LIFE` (`LIFE`), `TEST_FIXTURE_INSURER_FORMER_MUTUAL` (`MUTUAL_AID`), each with its own name and alias list. A test asserts that the fixtures carry the `TEST_FIXTURE` marker and none of the real names. The property proven is "institutions of different type are separate records that never merge", not those specific names.
8. **Idle policy role = `HA`.** design.md:875 (authority table: 무조작 정책·`completionHoldSeconds` 조회·수정 is `O` only in the HA column, RV / PO are `—`) and design.md:1142 (`GET/PUT …/idle-policy` -> HA). Brief §5 does not list this operation. Role only; clinic ownership is M7.
9. **Closed screen kinds (M3.A item 12 left this to D2).** Five keys taken from the DD-19 `catalog` response example (design.md:995-1002, 1010): `INPUT`, `RESULT`, `BASIS_AND_DOCUMENTS`, `HOLD_RESULT`, `NOTICE_PROGRESS_ERROR` (K00_Start and K06_Complete have no timer and no key). Defaults encoded from the DD-10 table (design.md:742-749): `INPUT` 100/120, `RESULT` 160/180, `BASIS_AND_DOCUMENTS` 160/180, `HOLD_RESULT` 160/180, `NOTICE_PROGRESS_ERROR` 100/120 (warn/reset seconds). `completionHoldSeconds` default is `null` (design.md:1011: no default until plan.md §E #12 is decided; plan.md B4 ① only proposes 10 s, which is NOT encoded).
10. **Idle policy save validation.** Order: role -> clinic exists (`NOT_FOUND`) -> request check (`INVALID_INPUT` with `{code, path}` defects) -> write -> audit `IDLE_POLICY_SAVE` (target `CLINIC/<id>/IDLE_POLICY`, before / after = `canonicalDigest` of the previous stored policy (null if none) / the new one). `screens` is required (object; may be empty), keys must be in the closed list (`SCREEN_UNKNOWN` @ `screens.<key>`), each entry a plain object whose `warnSeconds` / `resetSeconds` are safe integers >= 0 (`VALUE_MISSING` for absent / null, `VALUE_INVALID` otherwise), and `resetSeconds - warnSeconds >= 20` (`LEAD_TIME_TOO_SHORT` @ `screens.<key>.resetSeconds`; this covers equal and reversed values). The 20-second floor is design.md:754 (DD-10, "잠정, SPEC 결정", plan.md §E #16, owner confirmation pending) and lives in one constant `MIN_IDLE_LEAD_SECONDS`; it does NOT apply to `completionHoldSeconds`. `completionHoldSeconds` must be explicitly `null` or a safe integer >= 1 (`undefined` -> `VALUE_MISSING`, 0 / negative / decimal / NaN / string -> `VALUE_INVALID`; design.md:1011 "양의 정수"). All defects are reported together in the order: screen names in code-point order (per screen: warn, reset, gap), then `completionHoldSeconds`, independent of the order the keys were written. `[not in docs]` Save is a full replacement (PUT): screens not in the request read back as defaults.
11. **Idle policy reader.** `readIdlePolicy` returns all five screens always: the stored value for a stored screen, the DD-10 default otherwise (design.md:1010 "저장하지 않은 화면 종류는 DD-10 표의 값"); `completionHoldSeconds` = stored value or `null`. It never mutates the repository and returns a fresh copy each call (mutating the result changes neither the next read nor the default table). Keys outside the closed list that someone wrote straight into the repository are not returned. `[not in docs]` An unknown clinic gives `NOT_FOUND` (the M4 catalog route checks the clinic first anyway).
12. **No new `DomainErrorCode`.** The existing `domain.test.ts` enumerates the closed code list exactly, so the services reuse existing codes (`ROLE_NOT_PERMITTED`, `REASON_REQUIRED`, `NOT_FOUND`, `STATE_CONFLICT`, `INVALID_INPUT`); the new strings are defect codes only (`SCREEN_UNKNOWN`, `LEAD_TIME_TOO_SHORT`, `INSURER_TYPE_CHANGE`; `EMPTY` / `VALUE_MISSING` / `VALUE_INVALID` are existing ones).
13. **Determinism.** The services use no clock, random or id source of their own; the suspend scenario run in two fresh worlds yields deep-equal repository state (audit log and status events included). The server boundary test (hazard rules, imports) passes over the new files unchanged.

#### AC evidence (test file -> describe -> what is checked)

| AC | Test file / describe | What is checked |
|----|----------------------|-----------------|
| AC-011d | `insurer.test.ts` : `AC-011d 종류가 다른 보험사는 서로 다른 기관 기록이다` | three records of three different `insurerType` values stay three records, each readable by its own id with its own type / name / aliases; all 6 save orders give the same list; saving or editing one leaves the others deep-equal and the alias lists per record; equal names / aliases across types and equal name + type with different ids do not merge; changing an existing id's type is rejected (`[not in docs]`); audit hashes |
| AC-011d | `insurer.test.ts` : `보험사 저장 서비스의 역할·입력 검사`, `실제 기관명을 시드하지 않는다` | role `RV` only; 18 field-level bad inputs and 5 non-object inputs -> `INVALID_INPUT` with paths and repository deep-equal; fixed defect order; unknown fields dropped; isolation; verbatim names; audit-id collision rolls back; fixtures are `TEST_FIXTURE` only |
| AC-011e | `bundle-suspend.test.ts` : `AC-011e 게시는 ACTIVE 가용성 기록을 같은 트랜잭션에 쓴다` | publish writes exactly one `ACTIVE` event (publisher id / role / time, `previousStatus` null); a rejected publish leaves no bundle and no event |
| AC-011e | `bundle-suspend.test.ts` : `AC-011e 중지는 SUSPENDED 기록을 덧붙이고 앞의 기록을 지우지 않는다` | the appended event has actor id / role / time / reason / `previousStatus = ACTIVE`, the earlier `ACTIVE` event is deep-equal, reason stored verbatim, audit entry has actor / role / action / target / before / after / reason / time / affected count (2, and 0 with no clinics) |
| AC-011e | `bundle-suspend.test.ts` : `AC-011e 중지는 묶음 기록만 바꾼다` | bundle record, `contentHash`, `itemRefs` unchanged and the hash recomputes from stored item content; profile / mapping / document rule set state records (history included) and contents unchanged and still `PUBLISHED`; only `auditLog` and `bundleEvents` differ in the full repository snapshot; scope current value and history of four clinics unchanged; engine `isBundleUsable` on the stored snapshot flips from usable to `BUNDLE_SUSPENDED` |
| AC-011e | `bundle-suspend.test.ts` : `AC-011e 같은 항목 버전을 담은 두 번째 묶음은 계속 사용할 수 있다` | second bundle (same item refs, same hash) keeps its `ACTIVE` status, its events and record are untouched, its items are `PUBLISHED`, engine says usable while the first is not |
| AC-011e | `bundle-suspend.test.ts` : `AC-011e 같은 묶음 id 를 다시 활성으로 돌리려는 시도는 거절된다` | repository `STATE_CONFLICT` for `ACTIVE` after `SUSPENDED` with 3 `previousStatus` values; service-level id replay -> `STATE_CONFLICT`; second suspend -> `STATE_CONFLICT`; export list has no reactivation verb; recovery path (restore as new id, `ACTIVE`, PO reassigns the affected clinics, history `[old, new]`, old stays `SUSPENDED`) |
| AC-011e | `bundle-suspend.test.ts` : `AC-011e 사유가 비었거나 없는 중지는 …` | 7 reason values (`''`, whitespace, tab / newline, `undefined`, `null`, number, object) -> `REASON_REQUIRED` with `[{EMPTY, reason}]`, full repository snapshot (audit log, status events) deep-equal, status still `ACTIVE`; the same call with a valid reason afterwards succeeds |
| (support) | `bundle-suspend.test.ts` : `중지의 역할·대상 거절`, `영향을 받는 병원`, `중지 서비스의 결정성` | `HA` / `PO` -> `ROLE_NOT_PERMITTED` (role before reason), unknown bundle `NOT_FOUND`, no availability record `STATE_CONFLICT`, audit-id collision rolls back; affected clinics = current scope only, id order; two-world determinism |
| (support) | `rule-scope.test.ts` | PO assignment, history and current value, audit before / after, roles `HA` / `RV` rejected, unknown clinic / bundle `NOT_FOUND`, suspended bundle assignable `[not in docs]`, only `auditLog` and `scopeHistory` change, rollback; `readClinicRuleBundle` (null / ACTIVE / SUSPENDED, read-only, copy); `findAffectedClinics` |
| (support) | `idle-policy.test.ts` | defaults equal the DD-10 table, reader read-only and copy, partial stored screens merged over defaults, PUT replacement, per-clinic isolation, unknown stored keys dropped, audit hashes; role `HA` only; gap boundary 19 / 20 (and equal, reversed, 0 / 20); 2 x 9 number cases; unknown screen / bad entry / bad `screens` / non-object request; 12 `completionHoldSeconds` cases (no 20 s floor on it); combined defect order independent of key order; rejection keeps the stored policy |

#### RED before GREEN (exact statement)

Order: (1) the fixture `governance.fixture.ts` and the four test files were written first, with no `bundle-status.ts`, `rule-scope.ts`, `insurer.ts`, `idle-policy.ts` yet; (2) the RED run; (3) the implementation (the two additive audit edits and the four new modules). RED: `npx vitest run <the 4 new files> --maxWorkers=4` -> exit 1 (`red.txt`): `Test Files  4 failed (4)`, `Tests  no tests`, every file failing to load (`Cannot find module '../../src/server/bundle-status'` for `bundle-suspend.test.ts` and `rule-scope.test.ts`, `.../idle-policy`, `.../insurer`). So the RED state is "module absent", not failing assertions. After the implementation `npx tsc --noEmit` was exit 0 and the first run (`first-run.txt`) was `Test Files  4 passed (4)`, `Tests  159 passed (159)`: no test and no implementation line was changed after the RED run. Two test-authoring slips were corrected BEFORE the RED run (a nonsensical assertion in `idle-policy.test.ts`, a stray test removed from `bundle-suspend.test.ts`). The value of the tests as behavior detectors is shown by the mutation table below, not by a failing-assertion RED.

#### Evidence (outputs saved under `.moai/state/verify/m3d2/`, gitignored; all vitest runs with `--maxWorkers=4`, run sequentially on the final tree)

```
$ npx vitest run tests/server tests/boundary --maxWorkers=4          -> exit 0   (vitest-server-boundary.txt)
 Test Files  33 passed (33)
      Tests  2256 passed (2256)          (M3.D1 baseline 29 files / 2097 tests + 4 files / 159 tests)
$ npx vitest run tests/engine tests/boundary --maxWorkers=4          -> exit 0   (vitest-engine-boundary.txt)
 Test Files  36 passed (36)
      Tests  1544 passed (1544)          (unchanged)
$ npx tsc --noEmit                                                   -> exit 0   (tsc.txt)
$ npx vitest run --coverage tests/server --maxWorkers=4              -> exit 0   (coverage-server.txt)
 Test Files  29 passed (29)
      Tests  2013 passed (2013)
$ npx vitest run --coverage tests/engine --maxWorkers=4              -> exit 0   (coverage-engine.txt)
 Test Files  32 passed (32)
      Tests  1301 passed (1301)
```

Per-folder coverage (`covsum.mjs` over `coverage/coverage-summary.json`; `coverage-server-rows.txt`, `coverage-engine-rows.txt`):

```
src/server (tests/server run):  statements 1086/1086  branches 590/590  functions 271/271  lines 1028/1028  = 100% each
src/engine (tests/engine run):  statements 652/652    branches 558/558  functions 145/145   lines 606/606    = 100% each (unchanged)
```

No coverage exclusions, no `skip` / `only` / disabled tests.

#### Mutation spot checks (each run with `npx vitest run tests/server --maxWorkers=4` after a scripted one-spot edit of the final tree; the script restored the file from memory each time; `src-hashes-before-mutation.txt` equals `src-hashes-after-mutation.txt`; the baseline of that run is 29 files / 2013 tests; outputs `mut-<id>.txt`, rows in `mutation-rows.txt`)

| Mutation | Result |
|----------|--------|
| (a) `bundle-status.ts`: reason check removed | `Test Files  1 failed \| 28 passed (29)`, `Tests  8 failed \| 2005 passed (2013)` |
| (b) `memory-repository.ts`: bundle event chain accepts any event after the first (reactivation backstop removed) | `3 failed \| 26 passed`, `8 failed \| 2005 passed (2013)` |
| (c) `rule-scope.ts`: affected clinics = every clinic that has any scope | `2 failed \| 27 passed`, `2 failed \| 2011 passed (2013)` |
| (d) `bundle-status.ts`: suspend also moves the contained items to `SUSPENDED` | `2 failed \| 27 passed`, `6 failed \| 2007 passed (2013)` |
| (e) `insurer.ts`: insurer type change guard removed | `1 failed \| 28 passed`, `1 failed \| 2012 passed (2013)` |
| (f) `insurer.ts`: record keyed by name (merges same-named institutions) | `1 failed \| 28 passed`, `14 failed \| 1999 passed (2013)` |
| (g) `idle-policy.ts`: minimum lead 20 -> 10 | `1 failed \| 28 passed`, `2 failed \| 2011 passed (2013)` |
| (h) `idle-policy.ts`: reader ignores stored screens | `1 failed \| 28 passed`, `6 failed \| 2007 passed (2013)` |
| (i) `bundle-status.ts`: suspend runs without a transaction | `1 failed \| 28 passed`, `1 failed \| 2012 passed (2013)` |
| (j) `rule-scope.ts`: scope assignment role check removed | `1 failed \| 28 passed`, `2 failed \| 2011 passed (2013)` |
| (k) `bundle-status.ts`: audit entry no longer records the affected clinic count | `1 failed \| 28 passed`, `3 failed \| 2010 passed (2013)` |
| (l) `idle-policy.ts`: idle policy save role check removed | `1 failed \| 28 passed`, `2 failed \| 2011 passed (2013)` |

All 12 mutants are killed (no survivor). (b) also fails two existing M3.A repository tests, which confirms the backstop is covered at both levels. (e), (i) are killed by a single test each.

#### OPEN items / NOT IMPLEMENTED / NOT VERIFIED

1. **Assigning a SUSPENDED bundle is allowed** (decision 5). If the owner wants it rejected, that is a new rule (`STATE_CONFLICT` at assignment) and it affects the DD-14 recovery sequencing only slightly (recovery always assigns the NEW bundle).
2. **Insurer type of an existing id is immutable** (decision 6) is my addition to make "never merge" enforceable; the docs do not state it.
3. **`affectedClinicCount` is a new optional audit field** (decision 4); DD-18 should list it if the owner agrees.
4. **Idle policy: role `HA` (decision 8), 20-second floor (decision 10, §E #16 pending), five screen keys (decision 9) and `completionHoldSeconds` with no default (decision 9)** are taken from the docs as written; plan.md B4 ① proposes a 10-second hold default that the design says does not exist yet. Nothing here decides §E #12 / #16.
5. **No reactivation service exists** (decision 2): AC-011e's "service rejects reactivation" is proven through the repository backstop and the id-replay publish, not through a reactivation function.
6. NOT IMPLEMENTED (M3.E): readiness tables; AC-011c, 011j, 011k, 011l stay open. M4 to M7, DB adapter, HTTP, clinic ownership / membership checks (AC-022a), the HTTP 400 mapping of the suspend rejection (AC-025f / AC-021f), deployment, merging and commits are not started.
7. NOT VERIFIED: any DB behavior; asynchronous transactions; behavior under real concurrency (two sessions suspending or assigning at once); the SPEC lint (`moai` CLI absent); only Windows 11 and Node 24.19.0 were run, with no CI.
8. SPEC wording notes (not edited): design.md:828 asks for the affected-clinic count in the audit entry while design.md:944 (DD-18 `AuditLog`) has no field for it; the brief §5 role list omits the idle policy operation, design.md:875 / 1142 give `HA`; design.md:754 / plan.md B4 ⑤ present the 20-second floor as provisional; acceptance.md:211 (AC-011e) speaks of a service-level rejection of reactivation although DD-14 defines no reactivation action.

### M3.E 운영 준비 상태 (표 P·M·D·S, calculationReady·documentReady), 2026-10-19

**Scope.** M3.E only (cycle_type = tdd), on branch `feature/SPEC-REIMBURSEMENT-001-m3-data` on top of M3.D2 (`3a307a7`), not committed by this step. The readiness module (`src/server/readiness.ts`) and its first six test files were written by an EARLIER session that ended before any verification, progress record or commit; this session treated them as unverified work of another author, audited every Given/When/Then clause of AC-011c, 011j, 011k, 011l against them, added tests for the clauses that were missing or only weakly asserted, and ran the verification and the mutation checks. **Closed by this step (tests pass): AC-011c, AC-011j, AC-011k, AC-011l** (unit level; the open items below stay open). NO HTTP, NO DB, NO estimate service, NO M4-M7 work.

#### What exists (provenance is stated per row)

| File | Provenance | Notes |
|------|-----------|-------|
| `src/server/readiness.ts` | EARLIER session (533 lines), UNCHANGED this session (`git hash-object` 9c2ac1e8… before and after) | `computeReadiness`, `loadReadinessSnapshot`, `readReadiness`, `renderReadinessReport`, `operatingReadinessContext`, `READINESS_CELLS`, `INSURER_TYPES`, row types |
| `src/server/domain/projection.ts` | EARLIER session (uncommitted diff), UNCHANGED this session (hash 181daf76…) | adds `toEnginePublishedLine`, `toEngineBaseFeeLine` |
| `tests/fixtures/server/readiness.fixture.ts` | EARLIER session; this session APPENDED the operating-origin world helpers (`operatingProfiles`, `operatingLines`, `operatingBaseFeeLines`, `operatingBundleOf`, `operatingClinicOf`) | all `TEST_FIXTURE` values; "OPERATING" is only an origin label so a single item can be flipped to `TEST_FIXTURE` under an OPERATING-only configuration |
| `tests/server/readiness-{derived,mappings,profiles,repo,reuse,scope-documents}.test.ts` | EARLIER session, 285 tests; this session added ONE assertion to `readiness-derived.test.ts` (matrix: total line amount per trial `< MAX_AMOUNT_WON / 1000`, AC-003h clearance) and its import; nothing else changed or removed | |
| `tests/server/readiness-profile-defects.test.ts` | NEW this session, 50 tests | AC-011c |
| `tests/server/readiness-mapping-defects.test.ts` | NEW this session, 58 tests | AC-011j |
| `tests/server/readiness-documents-derived.test.ts` | NEW this session, 104 tests | AC-011k, AC-011l (1), (4) |
| `tests/server/readiness-reuse-identity.test.ts` | NEW this session, 31 tests | AC-011l (6), function-object level |
| `tests/server/readiness-repo-readonly.test.ts` | NEW this session, 9 tests | AC-011l (5), read-only proof |

This session added 252 tests in 5 files (50 + 58 + 104 + 31 + 9). No file under `src/engine/**`, `tests/engine/**`, `tests/boundary/**` or `tests/fixtures/engine/**` was edited; `package.json` and `vitest.config.ts` are untouched; no `src/**` file was changed by this session at all (the readiness code needed no fix); no test was deleted or weakened. The earlier session's verification files in `.moai/state/verify/m3e/` (`red.txt`, `mut1..7.txt`, …, dated 2026-10-16) were NOT relied on; this session's evidence files carry the prefix `s2-`.

#### Public API (unchanged, from the earlier session)

```ts
computeReadiness(snapshot: ReadinessSnapshot, ctx: ReadinessContext, functions?: Partial<ReadinessFunctions>): ReadinessReport   // pure, no throw on data
loadReadinessSnapshot(repo: ReadinessReads): ReadinessSnapshot     // read-only, items' states + bundle availability read fresh per call
readReadiness(repo, ctx, functions?): ReadinessReport              // load + compute
renderReadinessReport(report): string                              // calculationReady one line per cell, documentReady one line per clinic
operatingReadinessContext(at): ReadinessContext                    // rules + lines accept OPERATING only, digest = canonicalDigest
```

`ReadinessReport` = `platformProfiles[15]` (table P platform view) + per clinic `{ scope (S), profiles[15] (P clinic view), mappings (M, line id order x cell order), documents (D), calculationReady[15], documentReady }`. NOT_READY carries the blocked stage (S, P, TREATMENT, M, D) and the code.

#### Audit result: clause checklist (acceptance.md:209, :220, :221, :222; design.md DD-23 at :1194-1271)

| AC | Clauses checked | Asserted before this session | Missing or weak, closed this session |
|----|-----------------|------------------------------|--------------------------------------|
| AC-011c | 15: empty repo platform / clinic reasons; origin DEMO; origin `TEST_FIXTURE` under OPERATING-only; 8 states; outside validity; 6 policy-source items; approver missing; hash mismatch; structural defects (AC-008a row); two profiles in one cell; bundle `SUSPENDED`; no spill to other cells; platform view with 2+ candidates (any-usable READY, fixed priority, array-order independence); table P READY alone is not `calculationReady` | 13 | (a) `TEST_FIXTURE` one cell at a time under an OPERATING-only configuration with every other item usable (before: only "whole bundle TEST_FIXTURE", which proves nothing about spill); (b) the AC-008a structural row: before 5 shapes, now all 9 named defects plus 7 non-object `groups` entries, 7 non-object `sharedLimitPools` entries, 7 non-array `sharedLimitPools` containers, each at all 15 cells |
| AC-011j | 5 groups: (1) per-line state list (absent, scope without the cell, unreviewed, rejected, under re-review + fingerprint mismatch, 4 invalid kinds, two usable incl. COVERED + EXCLUDED, stored field-rule breaks, group not in profile, line origin, needs review, 4 group value defects, pool defect hitting only member lines); (2) `READY (EXCLUDED_CONFIRMED)` vs unusable EXCLUDED; (3) unresolved profile -> table P reason; (4) independence of lines / cells / array order; (5) no scope | all groups present, but (2) used 6 of 13 unusable kinds, mapping origin was tested only as `DEMO`, pool defect only as one kind, multi-candidate unusable priority and empty `scope` untested | (a) unusable EXCLUDED with all 13 kinds x 2 lines; (b) mapping origin `TEST_FIXTURE` under OPERATING-only (COVERED and EXCLUDED); (c) all 13 x 13 ordered pairs of unusable candidates equal `estimate()` and are order independent; (d) 6 pool defect kinds x 15 target cells; (e) `scope: []` and single-cell scopes for the base-fee line |
| AC-011k | tables S and D: origin, 8 states, `OUTSIDE_VALIDITY`, `SOURCE_INCOMPLETE`, `APPROVER_MISSING`, `INTEGRITY_MISMATCH`, set absent, scope absent, bundle suspended; reason always `RULES_UNAVAILABLE` + detail; agreement with `deriveDocuments()`; per-clinic independence | all listed states present; 1 of 6 source fields, no empty approver id, no calendar-invalid validity; agreement with `deriveDocuments()` was a forced `ESTIMATED`, never fed from a real `estimate()` state and never the `ON_HOLD` side | (a) all 6 source fields, empty approver id, calendar-invalid dates, `DEMO`, structure defect, each x (usable bundle / `SUSPENDED` bundle -> `BUNDLE_SUSPENDED` first); (b) single `TEST_FIXTURE` rule set under OPERATING-only -> only `documentReady` flips; (c) real `estimate()` state -> `deriveDocuments()`: `RULES_UNAVAILABLE` when not `ON_HOLD`, `null` when `ON_HOLD`, for 23 rule-set conditions at 15 cells |
| AC-011l | 6: (1) separate values, no merged phrase in any output string; (2) table P READY alone never makes a cell ready; (3) seeded equivalence matrix; (4) documents-only unavailability flips only `documentReady`; (5) empty repository; (6) no second implementation | (2), (3), (5) solid; (1) 4 worlds with a short regex over the render; (4) 3 states; (6) import scan + injected spies; amounts of the matrix not asserted | (1) 200 seeded states x render text and every string/key of the report object, with a regex proven to catch 9 merged phrases; (4) all 23 rule-set conditions; (3) amount clearance asserted; (5) one repository-level test with a published catalog and no scope (platform, S, D, M, both conditions, no new codes); (6) module-mock identity test (below) |

Reuse proof audit (the brief's question): `readiness-reuse.test.ts` had three layers: (a) import / no-redefinition scan, (b) no status / origin / validity comparison scan, (c) injected spies. Layer (c) only reaches a function when the TEST injects it, so a behaviour-identical local copy wired into the default `REAL_FUNCTIONS` passed all of it: mutation (M) below survived all 285 earlier tests. The new identity file wraps the engine MODULES with `vi.mock` (delegating `vi.fn`) so the default path (no injection) must hit the very exports `estimate()` uses; it also swaps each of the eight functions and checks that `estimate()` and the readiness tables follow, and it widens the "second definition" scan to arrow-valued properties, method shorthand, `class`, and alias import / export. `selectDocumentRuleSet` is not used by `estimate()` (the document path calls it), so the identity test expects readiness to call exactly `estimate()`'s seven functions plus it.

#### Decisions and assumptions (`[not in docs]` = design / acceptance are silent)

1. (Earlier session, audited) Table M never looks at bundle availability (design.md:1233); when the cell's profile does not resolve, a usable COVERED row takes `resolveProfile`'s code, not the table P clinic-view code. `[not in docs]` The two differ only for a `SUSPENDED` bundle (table P clinic view says `RULE_BUNDLE_SUSPENDED`, design.md:1236 / acceptance.md:220 (3) say "table P clinic-view reason"); the reported `calculationReady` stops at stage S first, so the reported reason is the same. Test: `readiness-mappings.test.ts` "표 M 은 묶음의 가용성을 보지 않는다". Recorded as spec ambiguity 2 below.
2. (Earlier session, audited) Report-only display values, not hold codes: `NO_PUBLISHED_TREATMENT` (stage TREATMENT), `RULES_UNAVAILABLE` details `SET_ABSENT` and `SET_STRUCTURE_INVALID` `[not in docs]` (DD-23 names no detail for a structure defect). A test walks every `code` in the reports and allows only the DD-03 hold codes plus `RULES_UNAVAILABLE` and `NO_PUBLISHED_TREATMENT` (`readiness-derived.test.ts`, `readiness-repo-readonly.test.ts`).
3. (Earlier session, audited) Base-fee lines: `toEngineBaseFeeLine` sets class from `benefitType` (`BENEFIT` -> `GENERAL_BENEFIT`, else `GENERAL_NON_BENEFIT`), all document flags `false`, line id = version id = base-fee id, fingerprint = `coverageFingerprint({ treatmentCode: fee.code, procedureCodes: [], benefitType, calcClass })`. This choice is documented in the `@MX:NOTE` at `projection.ts:64-67` and asserted in `readiness-repo.test.ts` "공통 기본비용 줄 [문서에 없음]". `toEnginePublishedLine` and `toEngineBaseFeeLine` are both covered (100% statements / branches / functions / lines for `projection.ts` and `readiness.ts`, from `coverage-summary.json`).
4. (This session) The OPERATING-only one-item-flip worlds label items `OPERATING` because the origin is header information outside the content hash (`profileContent` omits it), so flipping one item to `TEST_FIXTURE` changes nothing else; no operating data was created.
5. (This session) Test-side oracle: expected hold codes are never typed by hand; every new row-level assertion compares with the code `estimate()` gives the same line / cell on the same input (the earlier convention), except the fixed platform priority list and the `isUsable` reason for table D details, both of which DD-23 itself fixes.

#### AC evidence (test file -> describe -> what is checked)

| AC | Test file / describe | What is checked |
|----|----------------------|-----------------|
| AC-011c | `readiness-profiles.test.ts`: `AC-011c 운영 데이터가 없는 저장소`, `… 15칸` | 15 cells in order; empty repository: platform `PROFILE_ABSENT`, clinic view `CLINIC_RULE_SCOPE_ABSENT` (no scope) or `PROFILE_ABSENT` (scope without profile); non-array `profiles` does not throw |
| AC-011c | `readiness-profiles.test.ts`: `… 칸 하나의 프로필 기록만 어긋나게 하면 …`, `… 묶음이 SUSPENDED 이면 …` | DEMO origin, 8 states, validity (2), source (empty list + 6 fields), approver (2), hash (2), 5 structure shapes, two profiles in a cell, each at 15 cells: only that cell `NOT_READY`, code equals the one code `estimate()` gives all 4 lines, no spill; bundle `SUSPENDED` -> `RULE_BUNDLE_SUSPENDED` |
| AC-011c | `readiness-profile-defects.test.ts`: `… 출처 TEST_FIXTURE 를 운영 허용 출처 …` (NEW) | 15 cells, one `TEST_FIXTURE` profile among 14 `OPERATING`: that cell `PROFILE_DEMO` in both views and stage P, the other 14 READY and `estimate()` not `ON_HOLD`; same data READY under a TEST_FIXTURE-accepting configuration |
| AC-011c | `readiness-profile-defects.test.ts`: `… AC-008a 의 구조 결함 행 전부 …` (NEW) | 9 named defects + 21 non-object / non-array shapes x 15 cells: `PROFILE_INVALID`, equal to `estimate()`, never throws; `[]` pools control READY; structure-defect candidate ranks `PROFILE_INVALID` in the platform priority |
| AC-011c | `readiness-profiles.test.ts`: `… 플랫폼 보기: 후보가 여럿이면 …` | 7 candidate kinds individually equal `estimate()`; all 120 subsets of size >= 2 x 3 orders (given + 2 shuffles, seed 20261016): code = highest priority present, independent of order; usable candidate anywhere -> READY with only the usable bundle ids; candidate without the cell's profile is not a candidate |
| AC-011j | `readiness-mappings.test.ts`: `AC-011j (1) …` | per-line variants (13 unusable kinds, two usable, COVERED + EXCLUDED, 5 field-rule breaks, group not in profile, line origin, classification, 4 group value defects, pool value defect) on the treatment line and the base-fee line: row = `estimate()` hold or READY, other lines unchanged; `scope` missing exactly one cell, per cell |
| AC-011j | `readiness-mappings.test.ts`: `(3)`, `(4)`, `(5)`, `표 M 은 묶음의 가용성을 보지 않는다` | unresolved profile (5 kinds) -> profile code, EXCLUDED stays `READY (EXCLUDED_CONFIRMED)`; shuffled arrays (seed 20261016, 20 rounds) leave the report deep-equal; no-scope clinic -> `MAPPING_ABSENT` for lines passing origin and class; availability does not change table M |
| AC-011j | `readiness-mapping-defects.test.ts` (NEW) | 13 unusable kinds as EXCLUDED x 2 lines -> never `EXCLUDED_CONFIRMED`; mapping `TEST_FIXTURE` under OPERATING-only (COVERED, EXCLUDED) -> `MAPPING_INVALID`, OPERATING control READY; 169 ordered pairs of unusable candidates equal `estimate()` and are order independent; 6 pool defect kinds x 15 cells hit only member-group lines; empty / single-cell `scope` |
| AC-011k | `readiness-scope-documents.test.ts`: `AC-011k 표 S`, `표 D …`, `병원마다 독립이다` | table S values (`SCOPE_ABSENT`, `BUNDLE_SUSPENDED` with id and hash kept, `ACTIVE` with id and hash); table D READY only if S ACTIVE and set usable; 15 listed conditions -> `RULES_UNAVAILABLE` + detail (= `isUsable` reason); `deriveDocuments` -> `RULES_UNAVAILABLE`; bundle-suspension isolation between clinics |
| AC-011k | `readiness-documents-derived.test.ts`: `AC-011k 표 D …`, `… deriveDocuments() …` (NEW) | 23 rule-set conditions (6 source fields, empty approver id, calendar-invalid dates, `DEMO`, structure defect included): detail = `isUsable` reason; under a `SUSPENDED` bundle the detail is `BUNDLE_SUSPENDED` and `documentReady` is stage S; one `TEST_FIXTURE` rule set under OPERATING-only flips only `documentReady`; real `estimate()` state fed to `deriveDocuments()`: `RULES_UNAVAILABLE` when not `ON_HOLD`, `null` when `ON_HOLD` |
| AC-011k | `readiness-repo.test.ts`: `서비스가 바꾼 상태가 다음 호출에 바로 반영되고 …` | through the real services: bundle suspension, item suspension (profile / mapping / document rule set), re-review after a coverage-affecting catalog change, per-clinic isolation, all equal to the independently assembled engine input |
| AC-011l (1) | `readiness-derived.test.ts`: `AC-011l (1) …` | 4 worlds: separate keys, render has 15 `calculationReady` lines + 1 `documentReady` line, never both on a line |
| AC-011l (1) | `readiness-documents-derived.test.ts`: `AC-011l (1) 출력 문자열 …` (NEW) | seed 20261019, 200 states (scope none / ACTIVE / SUSPENDED x profile faults x mapping kinds x rule-set faults x 0-3 treatments): no merged phrase in the render text or any string / key of the report object (regex verified to catch 9 merged phrases); NOT_READY lines carry stage and code; all four (calc, doc) combinations occur (distribution printed) |
| AC-011l (2) | `readiness-profiles.test.ts` last describe; `readiness-derived.test.ts`: `AC-011l (2) …` | platform READY + no scope -> stage S; P READY + one blocked line -> stage M with all blocked lines; no published treatment (also with base fees only) -> TREATMENT, `estimate()` rejects with `NO_TREATMENT_SELECTED`; stage order S -> P -> TREATMENT -> M; cell independence |
| AC-011l (3) | `readiness-derived.test.ts`: `AC-011l (3) 고정 시드 동치 행렬 (seed=20261016, 시행 300회)` | 300 trials, seed and trial count in the test name and printed with `console.info`; per trial and cell `calculationReady == READY` iff `estimate()` over all published treatments and base fees is not `ON_HOLD`; S / P codes equal what `estimate()` gives every line; stage M (line, code) set equals `holdReasons[]`; zero-treatment clinics only NOT_READY; amounts per trial `< MAX_AMOUNT_WON / 1000` (NEW assertion); printed distribution `{"READY":308,"S":1245,"P":516,"TREATMENT":688,"M":1743,"docReady":157,"docBlocked":143}` (cell level) |
| AC-011l (4) | `readiness-derived.test.ts`: `AC-011l (4) …`; `readiness-documents-derived.test.ts`: `AC-011l (4) …` (NEW) | 3 + 1 earlier, now all 23 rule-set conditions: only `documentReady` NOT_READY (stage D), `calculationReady`, `profiles`, `mappings`, `scope` deep-equal the good-rule-set report; the reverse direction (calculation blocked, `documentReady` READY) |
| AC-011l (5) | `readiness-derived.test.ts`: `AC-011l (5) …`; `readiness-repo.test.ts`: `AC-011l (5) …`; `readiness-repo-readonly.test.ts`: `AC-011l (5) …` (NEW) | S `SCOPE_ABSENT`, D `RULES_UNAVAILABLE`, M all `MAPPING_ABSENT` (60 rows with a published catalog), P platform 15 `PROFILE_ABSENT`, both conditions NOT_READY at stage S, no code outside the DD-03 list plus the two display values |
| AC-011l (6) | `readiness-reuse.test.ts` (earlier) + `readiness-reuse-identity.test.ts` (NEW) | import / no-redefinition / no-comparison scans and injected spies (earlier); NEW: engine modules wrapped by `vi.mock`, `computeReadiness` without injection calls all 8 wrapped functions, the set it calls = the 7 `estimate()` calls + `selectDocumentRuleSet`; swapping each of 8 engine functions changes both `estimate()` and the matching readiness table; widened definition scan (arrow-valued properties, method shorthand, class, alias) over `src/server` for 15 names; `REAL_FUNCTIONS` holds only shorthand entries |
| (read-only, DD-14) | `readiness-repo.test.ts` + `readiness-repo-readonly.test.ts` (NEW) | full `exportState()` deep-equal before / after (audit log and bundle events included); a `Proxy` that throws on any property outside the 9 `ReadinessReads` methods gives the same report and touches exactly those 9; `readItemStates` count doubles over two calls; a suspension between two calls changes only the second report and a third call equals the second |

#### RED before GREEN (exact statement)

The E code and its first six test files (285 tests) PRE-EXISTED from the earlier session; this session did not write them test-first and cannot vouch for their order. On this exact tree they passed on arrival: `npx vitest run <the 6 files> --maxWorkers=4` -> exit 0, `Test Files  6 passed (6)`, `Tests  285 passed (285)` (`s2-baseline-readiness.txt`).

For what THIS session added: order = audit the earlier files against the acceptance text -> write the five new test files (and the fixture append) -> run them against the UNCHANGED readiness code -> no implementation change was needed. Because the implementation already satisfied the new clauses, the new tests were GREEN on the first complete run; there is NO failing-assertion RED against a missing implementation, and I do not claim one. The first runs that did fail were test-authoring defects, corrected in the tests (never in `src/**`): `readiness-mapping-defects.test.ts` first run 6 failed | 52 passed (the pool-defect world gave the non-target cells no member groups; `s2-mapping-defects-run1.txt`); `readiness-reuse-identity.test.ts` first run 2 failed | 23 passed (the definition scan matched a ternary branch and the `resolveMapping` dependency adapter that delegates to `fns.resolveMapping`; `s2-reuse-identity-run1.txt`); `readiness-repo-readonly.test.ts` first run 1 failed | 8 passed (a world without base fees never calls `getCommonBaseFee`; `s2-repo-readonly-run1.txt`); `npx tsc --noEmit` once failed with 1 error (`TS2322` in `readiness-profile-defects.test.ts`, `noUncheckedIndexedAccess`; `s2-tsc-run1.txt`).

The substitute for RED is mutation evidence that the new tests have teeth: three mutants (M second implementation, N read path calls a write method, P merged phrase in the render) SURVIVED all 285 earlier tests and are KILLED by the new files (table below).

#### Evidence (outputs under `.moai/state/verify/m3e/`, gitignored; every vitest run with `--maxWorkers=4`, sequential, on the final tree; `src/server/readiness.ts` hash 9c2ac1e8… and `projection.ts` hash 181daf76… equal to the start of the session)

```
$ npx vitest run tests/server tests/boundary --maxWorkers=4     -> exit 0   (s2-final-server-boundary.txt)
 Test Files  44 passed (44)
      Tests  2793 passed (2793)
$ npx vitest run tests/engine tests/boundary --maxWorkers=4     -> exit 0   (s2-final-engine-boundary.txt)
 Test Files  36 passed (36)
      Tests  1544 passed (1544)          (M1/M2 regression, unedited)
$ npx tsc --noEmit                                              -> exit 0   (s2-final-tsc.txt, empty output)
$ npx vitest run --coverage --maxWorkers=4                      -> exit 0   (s2-final-coverage.txt)
 Test Files  76 passed (76)
      Tests  4094 passed (4094)          (start of session: 71 files / 3842 tests as observed by the orchestrator; +5 files, +252 tests)
$ node .moai/state/m3/covsum.mjs coverage/coverage-summary.json (s2-final-covsum.txt)
 engine: statements 652/652, branches 558/558, functions 145/145, lines 606/606
 server: statements 1237/1237, branches 685/685, functions 319/319, lines 1165/1165
```

`src/server/readiness.ts` and `src/server/domain/projection.ts`: 100% statements / branches / functions / lines each (`coverage-summary.json`). No coverage exclusions, no `skip` / `only` / disabled tests, no coverage-only test added (each new test asserts an AC clause). The seeds and trial counts are printed with `console.info` (shown with the verbose reporter: `s2-seed-output-verbose.txt`): `seed=20261016, 300` (equivalence matrix), `seed=20261019, 200` (output strings), `seed=20261016` (array order, candidate order).

#### Mutation spot checks (scripted one-spot edit of `src/server/readiness.ts`, test run, restore from a backup, hash check after each; the baseline of the 11 readiness files is 537 tests = 285 earlier + 252 new; outputs `s2-mut<id>.txt` (all 11 files) and `s2-mut<id>old.txt` (the 6 earlier files only))

| Mutation | All 11 readiness files | Earlier 6 files only |
|----------|------------------------|----------------------|
| (A) table P ignores bundle `SUSPENDED` | 10 failed \| 527 passed | 8 failed \| 277 passed |
| (B) `calculationReady` ignores table S | 11 failed \| 526 passed | 9 failed \| 276 passed |
| (C) `documentReady` merged with `calculationReady` (needs a READY cell) | 5 failed \| 532 passed | 2 failed \| 283 passed |
| (D) unusable EXCLUDED (unreviewed / rejected) reported `READY (EXCLUDED_CONFIRMED)` | 26 failed \| 511 passed | 15 failed \| 270 passed |
| (E) platform priority replaced by the first code seen (depends on candidate array order) | 3 failed \| 534 passed | 2 failed \| 283 passed |
| (F) platform view READY only if ALL candidates usable | 3 failed \| 534 passed | 3 failed \| 282 passed |
| (G) no-published-treatment check removed | 4 failed \| 533 passed | 4 failed \| 281 passed |
| (H) default `isUsable` replaced by a local always-usable lambda | 171 failed \| 366 passed | 98 failed \| 187 passed |
| (I) table M line sort removed (array-order dependent) | 3 failed \| 534 passed | 3 failed \| 282 passed |
| (J) `documentReady` ignores table D | 97 failed \| 440 passed | 24 failed \| 261 passed |
| (K) item states cached in a module-level map (DD-14 violation) | 8 failed \| 529 passed | 5 failed \| 280 passed |
| (L) `EXCLUDED_CONFIRMED` shown as `confirmedExclusion: false` | 9 failed \| 528 passed | 8 failed \| 277 passed |
| (M) behaviour-identical COPY of `checkGroupValues` (renamed, in a new `src/server` file) wired into `REAL_FUNCTIONS` | 4 failed \| 533 passed (`readiness-reuse-identity.test.ts`) | **0 failed \| 285 passed — survivor of the earlier suite** |
| (N) `readReadiness` calls the write method `transaction` (writes nothing) | 1 failed \| 536 passed (`readiness-repo-readonly.test.ts`) | **0 failed \| 285 passed — survivor of the earlier suite** |
| (P) render appends the line `clinic is ready for service` | 3 failed \| 534 passed (`readiness-documents-derived.test.ts`) | **0 failed \| 285 passed — survivor of the earlier suite** |

15 mutants, 0 survivors against the final suite; 12 were also killed by the earlier six files alone. After every run the file was restored and compared with the backup (`복원 후 해시 원본과 같다` printed after each run); the temporary `src/server/zz-groupvalues-copy.ts` of (M) was deleted (`ls src/server | grep -c zz-` = 0).

#### OPEN items / NOT IMPLEMENTED / NOT VERIFIED

1. **SPEC AMBIGUITY (blocks real use of base-fee lines): a mapping that points at a common base fee cannot be approved or published.** design.md:157 and design.md:318 say a base-fee line goes through the same mapping judgement as a treatment and shares the `treatmentId` id space, and DD-23 table M counts base fees as lines. But `approve()` pins the TREATMENT version's fingerprint: `approval.ts:112` -> `pinnedFingerprint` (`approval.ts:87-93`) -> `currentTreatmentVersion` (`treatment-current.ts:15-21`) looks up `getTreatment(<base fee id>)`, which does not exist, and throws `TREATMENT_VERSION_ABSENT`; `bundle-publish.ts:120-123` would reject such a mapping at publish for the same reason. Proof test: `readiness-repo.test.ts` "공통 기본비용 줄에는 지금 매핑을 승인할 길이 없다" (observed `TREATMENT_VERSION_ABSENT`). Consequence: through the real services, a clinic whose current catalog holds any common base fee can never reach `calculationReady = READY` (its base-fee rows stay `MAPPING_ABSENT`); only the engine-level fixtures reach READY with base fees. The comment at `projection.ts:67` ("스펙 모호점으로 progress.md 에 올렸다") is correct; this item is that record. Needs an owner decision on how a base-fee mapping fixes its fingerprint (for example the base-fee code fingerprint `toEngineBaseFeeLine` already computes). Not changed here (scope: M3.E, approval / publish are closed D1 code).
2. **SPEC AMBIGUITY: unresolved profile on a `SUSPENDED` bundle.** acceptance.md:220 (3) and design.md:1236 ("표 P(병원 보기)의 같은 칸 사유") versus design.md:1233 ("묶음의 가용성은 여기서 보지 않는다") disagree for a suspended bundle: table P clinic view says `RULE_BUNDLE_SUSPENDED`, the implementation (resolving the profile directly) gives `resolveProfile`'s code. The reported `calculationReady` and `documentReady` are identical either way (stage S comes first). If the owner wants the literal reading, table M would have to consult availability, contradicting the sentence at :1233.
3. **Known limitation (not an acceptance gap): a bundle with a `null` profile entry makes readiness throw even when the bundle is `SUSPENDED`.** Observed with a throw-away probe (deleted): `estimate()` returns `RULE_BUNDLE_SUSPENDED` without reading items, while `computeReadiness` throws `TypeError` from the platform candidate scan (`isCandidate`) and from the table M profile resolution (`resolveProfile`, same `TypeError` as the engine gives an `ACTIVE` bundle, acceptance.md:103 AC-006i (i)). Unreachable through the repository path (`toEngineProfile` always returns objects); the M4 structural check on a loaded bundle (AC-006i) should also run before readiness if a raw snapshot can ever reach it. No test pins the throw.
4. `calculationReady` is judged over ALL published lines (design.md:1257): a patient who picks only some treatments can be calculable while the cell is `NOT_READY`. By design.
5. `CALC_RANGE_EXCEEDED` and `INVALID_NUMERIC_INPUT` are outside readiness (DD-24); the matrix amounts are kept small (asserted `< MAX_AMOUNT_WON / 1000` per trial).
6. NOT IMPLEMENTED: the M4 HTTP 500 mapping of readiness-adjacent input errors and any real API / route integration of readiness; M7 permissions for reading readiness (design adds no admin API for it); M8's gate that consumes the pair.
7. NOT VERIFIED: any DB adapter behaviour; behaviour under real concurrency (a readiness read while a suspension commits); the formal SPEC lint (the `moai` CLI is absent); CI. Only Windows 11 with Node v24.19.0 were run. `renderReadinessReport` is a human-readable report only; its wording is not an acceptance contract beyond "no merged phrase", "one line per cell", "stage and code on NOT_READY lines".
8. The readiness CLI / report command and a persistence of reports are not part of M3.E and do not exist.

### M3.F 최종 검증과 M3 종결 기록, 2026-10-19

**Scope.** Closing record of milestone M3 (data model, lifecycle, repository interface with in-memory implementation, versions, publish validation, readiness). Branch `feature/SPEC-REIMBURSEMENT-001-m3-data`, created from the M2 tip `2589ce8`; Draft PR #1 (M1, head `b27bf38`) and Draft PR #2 (M2, head `2589ce8`) were read through GitHub REST before work resumed and were not changed. This section adds no code. Its inputs are the orchestrator's own runs on the final tree, the per-step sections M3.A to M3.E above, and the status-wording update of plan.md / acceptance.md (six stale `구현 안 됨` / `M3 · 미구현` markers and one M3 status line; nothing else in those files).

**Owner decisions applied (2026-10-16, recorded in plan.md §E.10 and design DD-17 / DD-18).** #34 mapping authors are the platform insurance-rule staff (role `RV`), separate from hospital staff (`HA`). #31 an author may not approve their own work (typed domain error, state unchanged). #1 the database product stays deferred; M3 ships repository interfaces plus an in-memory implementation only. These are policy decisions, not the registration of real accounts, staff or approval records. Every id, name and approver in tests and fixtures is `TEST_FIXTURE`; no operating data exists anywhere in `src/` or `tests/`.

#### Final verification (run by the orchestrator on the final tree; HEAD at run time `f4744e9` plus uncommitted plan.md / acceptance.md wording edits, which no test reads; always `--maxWorkers=4`; outputs under `.moai/state/verify/m3f/`, gitignored)

```
$ npx tsc --noEmit                                           -> exit 0 (empty output)
$ npx vitest run tests/engine tests/boundary --maxWorkers=4  -> exit 0
 Test Files  36 passed (36)
      Tests  1544 passed (1544)          (M1/M2 regression, no test file of M1/M2 edited)
$ npx vitest run tests/server tests/boundary --maxWorkers=4  -> exit 0
 Test Files  44 passed (44)
      Tests  2793 passed (2793)
$ npx vitest run --coverage --maxWorkers=4                   -> exit 0
 Test Files  76 passed (76)
      Tests  4094 passed (4094)
```

Per-folder coverage (`covsum.mjs` over `coverage/coverage-summary.json`):

```
src/engine: statements 652/652  branches 558/558  functions 145/145  lines 606/606   (unchanged from M2)
src/server: statements 1237/1237  branches 685/685  functions 319/319  lines 1165/1165
```

No coverage exclusions, no `skip` / `only` / disabled tests. Compared with the M2 tip `2589ce8`: `src/engine/**`, `tests/engine/**`, `tests/fixtures/engine/**`, `package.json` and every existing file under `tests/boundary/**` are unchanged. Two deliberate changes outside `src/server/`, both from M3.A: `vitest.config.ts` (coverage now includes `src/server/**`) and one NEW file `tests/boundary/server-imports.test.ts` (server import boundary; added, no existing boundary test edited).

#### Closing ACs by step (evidence tables are in the named sections; this table only locates them)

| AC | Closed in | Level |
|----|-----------|-------|
| AC-007f, AC-009a, AC-009c, AC-010c, AC-011a, AC-011b, AC-011h, AC-011i | M3.D1 (publish services, versions, recovery), on the validators of M3.C | unit, in-memory repository |
| AC-011d, AC-011e | M3.D2 (insurers, bundle suspend, rule scope, idle policy) | unit, in-memory repository |
| AC-011c, AC-011j, AC-011k, AC-011l | M3.E (readiness tables P / M / D / S, `calculationReady`, `documentReady`) | unit, in-memory repository |

These 14 ACs are the ones plan.md assigns to M3; no other AC is marked closed. AC-024a and AC-025b received evidence-only support from the domain self-approval rejection (M3.B) and stay open for M7. AC-007g, AC-007i, AC-008g are not M3 ACs and stay open.

#### Contract points named by the owner, and where they are proven

| Contract | Proven in |
|----------|-----------|
| Reorder of `groups` / `sharedLimitPools` / document `rules` with the ORIGINAL hash passes; a real content change is detected as `INTEGRITY_MISMATCH` | `tests/server/seal-roundtrip.test.ts` (profile and document rule set; hash input is the engine's `profileContent` / `documentRuleSetContent`, sealed with `canonicalDigest`) |
| `profiles = null` and `mappings = null` rejected separately; bad container entries rejected; nothing stored | `tests/server/validate-bundle-form.test.ts` (describe "profiles · mappings 가 배열이 아닌 묶음 (각각 따로)"), `tests/server/publish-bundle.test.ts` (reject table rows `profiles = null`, `mappings = null`, item rows; each row compares the repository before and after and publishes the corrected bundle) |
| Whitespace-only document reason rejected; empty `rules: []` allowed | `tests/server/publish-bundle.test.ts`, `tests/server/validate-bundle-docrules.test.ts` |
| `calculationReady` and `documentReady` separate, equivalent to engine verdicts | M3.E section: `tests/server/readiness-derived.test.ts` (seeded matrix), `readiness-documents-derived.test.ts`, `readiness-reuse-identity.test.ts` |
| M1 / M2 shared judgement, structure and hash-input functions reused, no second implementation | `tests/server/readiness-reuse-identity.test.ts`, `tests/server/readiness-reuse.test.ts`, server boundary scan |

#### Not done (unchanged by M3)

- M4: HTTP layer, HTTP 500 mapping, read-path structure check (AC-006i), real API integration, estimate service. NOT IMPLEMENTED, NOT VERIFIED.
- M5 to M8, M7 permissions (clinic ownership, membership, 401 / 403), any database adapter or driver (DB product still deferred, §E #1), deployment, paid services.
- Formal SPEC lint, `moai verify`, model profile resolution, session registry and handoff save: the `moai` CLI is absent on this machine, so these were not run. CI: none; only Windows 11 and Node v24.19.0 were run.
- No full-SPEC audit was run in M3; the last audit result (iteration 5, FAIL 0.89, MP-7) is untouched and `plan_status` is unchanged.

#### OPEN items collected from M3.B to M3.E (each needs an owner decision or later work; none is resolved here)

1. **Common base fee lines cannot get an approved mapping.** Approval pins the TREATMENT version's fingerprint (`approval.ts` -> `pinnedFingerprint` -> `treatment-current.ts`), so a mapping that points at a common base fee id fails with `TREATMENT_VERSION_ABSENT`, and bundle publish rejects it for the same reason, while design.md:157 and :318 say base-fee lines go through the same mapping judgement. Through the real services a clinic whose catalog holds any common base fee therefore cannot reach `calculationReady = READY`. Evidence: M3.E section and `readiness-repo.test.ts` "공통 기본비용 줄에는 지금 매핑을 승인할 길이 없다". Needs an owner decision (how a base fee pins a fingerprint).
2. **Self-approval compares the approver only with the version's author** (M3.B). A different `RV` who merely edited a draft may approve it. Kept because the owner's wording was "author != approver".
3. **AC-011a "수정·삭제 시도 거절".** Immutability is proven at the repository (write-once, `IMMUTABLE_VERSION`, no delete operation, scanned by method name) and by the id-replay publish test. No service-level modify / delete function exists, so there is no separate service-level rejection test (M3.D1 note 9). The hash-contract part of AC-011a is proven as in the table above.
4. Assigning a SUSPENDED bundle to a clinic scope is allowed `[not in docs]` (M3.D2 decision 5); insurer type of an existing id is immutable `[not in docs]` (decision 6); `affectedClinicCount` is an optional audit field that DD-18 does not list (decision 4).
5. Table M on a SUSPENDED bundle: design.md:1233 says table M ignores availability, acceptance.md:220 (3) and design.md:1236 say to use the table P clinic-view reason. They differ only in the reason shown for an unresolved profile on a suspended bundle; the reported `calculationReady` / `documentReady` are identical because stage S comes first (M3.E).
6. `computeReadiness` throws `TypeError` for a bundle containing a `null` profile entry even when the bundle is SUSPENDED, whereas `estimate()` returns `RULE_BUNDLE_SUSPENDED` without reading items. Unreachable through the repository path (publish rejects such bundles); M4's structure check (AC-006i) should run before readiness if a raw snapshot can ever reach it. No test pins the throw.
7. Idle policy: role `HA`, 20-second floor (§E #16 pending), five screen keys, `completionHoldSeconds` without a default are taken from the documents as written; nothing here decides §E #12 / #16.
8. The M3.E module and its first six test files were written by an earlier session; M3.E added tests and mutation evidence but there is no failing-assertion RED for them (stated in the M3.E section). Three mutants survived the first 285 tests and are killed by the final suite.

#### Branch and PR hygiene

M3 changes live only on `feature/SPEC-REIMBURSEMENT-001-m3-data`. Draft PR #1 and #2 were not edited and not merged; `main` was not touched; nothing was deployed; no paid service was used. The M3 pull request is separate, with the M2 branch as its base, so only M3 changes show.

### M3 외부 검토 보완 ① 공통 기본비용 매핑 승인·게시 경로, 2026-10-19

**Scope.** External-review item 1 for Draft PR #3 (cycle_type = tdd), on branch `feature/SPEC-REIMBURSEMENT-001-m3-data` at `9bc0b4a`, not committed by this step. Defect accepted as an M3 gap by the owner review: `approve()` (`approval.ts` `pinnedFingerprint` -> `treatment-current.ts`) and the rule-bundle publish stale check (`bundle-publish.ts`) looked up only treatments, so a mapping whose `treatmentId` was a common base fee id failed with `TREATMENT_VERSION_ABSENT` and a clinic whose catalog holds a base fee could never reach `calculationReady = READY` through the real services. The business decision is NOT open (plan.md §E #8 "정정 수용", design.md:157): a base fee gets the same coverage-mapping judgement as a treatment, the base fee is ALWAYS part of the hospital payment T, and a missing / unusable mapping keeps the existing hold contract on the benefit side only. This section completes the M3 path for that contract. **It closes NO new AC and adds NO AC id**; it gives additional evidence to AC-009a, AC-009c, AC-011b, AC-011j, AC-011l (AC-011c only indirectly, see the evidence table). **Supersedes the earlier text** in M3.B (line 1391), M3.D1 (line 1672), M3.E (line 2017) and M3.F OPEN item 1 (line 2085) saying "common base fee lines cannot get an approved mapping" / `TREATMENT_VERSION_ABSENT` for base fee mappings: that statement is no longer true as of this section (the old text is intentionally not edited; line numbers are those of the file before this section was inserted). Owner decisions #31 / #34 / #1 are intact (author != approver, `RV` authors mappings, in-memory repository only). NO M4 (HTTP, caching, 500 mapping, API) and NO M7 (permissions) work.

#### What was built

| File | Change |
|------|--------|
| `src/server/domain/entities.ts` | CHANGED. `CommonBaseFee.baseFeeId: string` (stable identity); `id` stays the immutable version id |
| `src/server/fingerprint.ts` | CHANGED (additive). `COMMON_BASE_FEE_JUDGMENT_FIELDS = ['code','benefitType']`, `calcClassOfBaseFee`, `coverageFingerprintOfBaseFee` (built on the existing `coverageFingerprint`, `procedureCodes: []`) |
| `src/server/coverage-target.ts` | NEW. `currentCoverageTarget(repo, targetId)` + `CoverageTarget`: the ONE "current coverage target" lookup (treatment first, base fee second, else `null`) |
| `src/server/treatment-current.ts` | CHANGED. The selection rule is extracted as `pickCurrentVersion` (shared by treatments and base fees); `currentTreatmentVersion` behaves exactly as before |
| `src/server/approval.ts` | CHANGED. `pinnedFingerprint` uses only `currentCoverageTarget`; same error code `TREATMENT_VERSION_ABSENT`, message says "치료 또는 공통 기본비용" |
| `src/server/bundle-publish.ts` | CHANGED. The stale-fingerprint precondition uses only `currentCoverageTarget` (defect codes `TREATMENT_VERSION_ABSENT` / `FINGERPRINT_STALE` unchanged) |
| `src/server/re-review.ts` | CHANGED. Shared body `triggerReReviewForTarget(deps, actor, targetId, fingerprint)`; `triggerReReview(deps, actor, version)` keeps its signature and delegates; NEW entry `triggerReReviewForBaseFee(deps, actor, fee)` |
| `src/server/catalog-publish.ts` | CHANGED. Ownership step: two new typed defects per base fee; after the writes the re-review trigger runs for EVERY base fee version in the catalog (as for treatment versions) |
| `src/server/validate/catalog.ts`, `src/server/publish-validate.ts` | CHANGED. `baseFeeId` non-empty string check (field path), duplicate `baseFeeId` in one catalog -> `DUPLICATE_BASE_FEE_ID` (added to `PUBLISH_DEFECT_CODES`) |
| `src/server/publish-defects.ts` | CHANGED. `BASE_FEE_ID_COLLIDES_WITH_TREATMENT`, `BASE_FEE_ID_CLINIC_MISMATCH` added to `SERVICE_PUBLISH_DEFECT_CODES` |
| `src/server/domain/projection.ts` | CHANGED. `toEngineBaseFeeLine`: `treatmentId = baseFeeId`, `treatmentVersionId = fee.id`, `calcClass = calcClassOfBaseFee(...)`, `coverageFingerprint = coverageFingerprintOfBaseFee(fee)`; the inline fingerprint and the inline derivation are removed |
| `src/server/repo/interfaces.ts`, `repo/memory/memory-repository.ts`, `repo/memory/read-spy.ts` | CHANGED. `listCommonBaseFeeVersions(baseFeeId)` (write order, copies, empty when none, counted by the read spy); one id space enforced at the backstop: `putCommonBaseFee` rejects a `baseFeeId` equal to an existing treatment id, `saveTreatment` rejects an id equal to an existing `baseFeeId` (`DUPLICATE_KEY`, repository unchanged) |
| `src/server/readiness.ts` | NOT CHANGED (it builds base fee lines from `catalog.baseFeeIds` through `toEngineBaseFeeLine`; verified working with the new line shape, see tests) |
| `tests/fixtures/server/base-fee.fixture.ts` | NEW (all `TEST_FIXTURE`): clinic world with a base fee, base fee version factory, COVERED / EXCLUDED / no mapping through approve -> bundle publish -> PO scope, independent engine-input builder for the base fee line, estimate helpers |
| `tests/server/base-fee-mapping-path.test.ts` | NEW, 12 tests (test group B) |
| `tests/server/base-fee-versions.test.ts` | NEW, 16 tests (test group C) |
| `tests/server/base-fee-identity.test.ts` | NEW, 22 tests (test group D) |
| `tests/server/base-fee-fingerprint.test.ts` | NEW, 28 tests (test group E) |

Existing files touched, with the reason (no assertion weakened or removed; no skipped test):

| Existing file | Why |
|---------------|-----|
| `tests/fixtures/server/entities.fixture.ts` | `makeCommonBaseFee` must return the new required `baseFeeId`; it defaults to the version `id`, so every existing test that passes only `id` keeps its meaning |
| `tests/server/readiness-repo.test.ts` | Test group A. The test "공통 기본비용 줄에는 지금 매핑을 승인할 길이 없다..." (asserted the defect as if it were the contract) is REPLACED by a test of the normal capability (a base fee mapping approves and pins the base fee fingerprint) plus a new describe with the real failure conditions (neither-treatment-nor-base-fee target at approve and at bundle publish -> `TREATMENT_VERSION_ABSENT`, nothing stored; self-approval -> `SELF_APPROVAL_FORBIDDEN`; stale pinned fingerprint at publish -> `FINGERPRINT_STALE`, then re-review + re-approval + publish). Five imports added |
| `tests/server/repo-memory.test.ts` | One table row for the new read method: a test enumerates every `get*` / `list*` / `read*` method of the repository and the read-spy counter per name |

No file under `src/engine/**`, `tests/engine/**`, `tests/boundary/**`, `tests/fixtures/engine/**` was edited; `package.json` and `vitest.config.ts` are untouched; `design.md` / `acceptance.md` / `plan.md` / `spec*.md` / `research.md` are untouched. New tests total 78 in 4 files; with +4 in `readiness-repo.test.ts` and +1 in `repo-memory.test.ts` the suite grew by 83 tests (4094 -> 4177 in the full run).

#### Public API (new or changed)

```ts
// src/server/fingerprint.ts
COMMON_BASE_FEE_JUDGMENT_FIELDS: readonly ['code', 'benefitType']
calcClassOfBaseFee(benefitType: BenefitType): CalcClass            // BENEFIT -> GENERAL_BENEFIT, NON_BENEFIT -> GENERAL_NON_BENEFIT (the only place)
coverageFingerprintOfBaseFee(fee: CommonBaseFee): string
// src/server/coverage-target.ts
type CoverageTarget = { kind: 'TREATMENT'; version: TreatmentVersion; fingerprint: string } | { kind: 'BASE_FEE'; fee: CommonBaseFee; fingerprint: string }
currentCoverageTarget(repo, targetId: string): CoverageTarget | null   // approval, bundle publish and every other caller use ONLY this
// src/server/re-review.ts
triggerReReviewForTarget(deps, actor, targetId, fingerprint): ItemVersionRef[]
triggerReReview(deps, actor, version: TreatmentVersion): ItemVersionRef[]      // signature unchanged, delegates
triggerReReviewForBaseFee(deps, actor, fee: CommonBaseFee): ItemVersionRef[]
// Repository
listCommonBaseFeeVersions(baseFeeId: string): CommonBaseFee[]
```

#### Decisions and assumptions (`[not in docs]` = design / acceptance are silent)

1. **`[not in docs]` Stable identity `baseFeeId`.** DD-18 (design.md:929) lists the `CommonBaseFee` fields as "id, clinicId, 표시명, `benefitType`, 금액, 코드, `origin`" and the code comment said a changed price is issued under a NEW id. A mapping keyed by that id would be orphaned by a price-only change, which confuses a price change with a coverage-judgement change. So `CommonBaseFee` mirrors the treatment model: `id` = immutable VERSION id (like `TreatmentVersion.id`, engine line `treatmentVersionId`), `baseFeeId` = stable identity (like `treatmentId`; a base fee mapping's `treatmentId` is the `baseFeeId`; engine line `treatmentId`). The line shape change is internal: a base fee line's `coverageFingerprint` is byte-identical to the earlier inline computation for the same fee (same input to the same function), only `treatmentId` changed from the version id to `baseFeeId`.
2. **`[not in docs]` Coverage-judgement fields of a base fee (closed list): `code` and `benefitType`.** DD-16 lists judgement fields for treatment versions only. `calcClass` is DERIVED from `benefitType` (`calcClassOfBaseFee`, one place, used by the fingerprint and by the engine line; there is no `NEEDS_REVIEW` for base fees). `amount`, `displayName`, `origin`, `clinicId`, `id`, `baseFeeId` are NOT judgement fields. A test lists every key of a base fee version and requires it to be a judgement field or a known non-judgement field, so a new field forces a decision.
3. **One fingerprint function per target kind, one target lookup.** `coverageFingerprintOfBaseFee` is used by `currentCoverageTarget` (approval and bundle publish), `triggerReReviewForBaseFee` and `toEngineBaseFeeLine`. Selection of the "current version" is one function (`pickCurrentVersion`): the version listed in the clinic's current catalog version, else the latest written, else none. A base fee's clinic is read from its first-written version (catalog publish guarantees all versions share one clinic). Treatment is looked up first, base fee second; the repository id space makes this unambiguous.
4. **Error and defect names unchanged.** `TREATMENT_VERSION_ABSENT` (error at approve, defect at bundle publish) and `FINGERPRINT_STALE` keep their codes; only the approve message wording says "치료 또는 공통 기본비용". The domain error list test passes unchanged. New defect codes only where needed: validator `DUPLICATE_BASE_FEE_ID`; service `BASE_FEE_ID_COLLIDES_WITH_TREATMENT`, `BASE_FEE_ID_CLINIC_MISMATCH`. Per base fee the ownership defects are reported in the order `BASE_FEE_CLINIC_MISMATCH` -> `BASE_FEE_ID_COLLIDES_WITH_TREATMENT` -> `BASE_FEE_ID_CLINIC_MISMATCH`; validator order inside a base fee entry is `id` -> `baseFeeId` -> `clinicId` -> ..., duplicates after `DUPLICATE_ID`.
5. **`[not in docs]` Id-space backstop at the repository** (design.md:318 says treatment and base fee lines share one id space and ids do not overlap; design.md:171 (c) says the engine does not check a `treatmentId` present in both `lines` and `baseFeeLines`, a server guarantee left to M4). This step makes the STORED data safe: a `baseFeeId` equal to a treatment id, or a treatment id equal to a `baseFeeId`, is `DUPLICATE_KEY` and atomic. The M4 request-time check (c) is still M4. Not enforced (by choice): a base fee VERSION id vs a treatment id (they are different spaces; only `baseFeeId` reaches the engine as `treatmentId`), and "all versions of one `baseFeeId` share a clinic" at the repository (catalog publish enforces it with `BASE_FEE_ID_CLINIC_MISMATCH`).
6. **Re-review for base fees uses the pinned fingerprint, not the previous version.** Same body as treatments (`triggerReReviewForTarget`): only `APPROVED` / `PUBLISHED` mappings of the target whose pinned fingerprint differs from the new version's fingerprint move to `UNDER_REREVIEW`, with reason `COVERAGE_JUDGMENT_FIELD_CHANGED`, history and audit entries by the publishing actor; approver and pinned fingerprint are kept until re-approval. A price-only / `displayName` / `origin`-only version moves nothing and records nothing. A catalog that omits a base fee does not touch its mappings.
7. **Restore.** `restoreCatalogVersion` needed no change: it republishes copies of stored base fee versions, which now carry `baseFeeId`, through the same ownership and re-review path. Observed behaviour (tested, same as treatments): restoring an earlier catalog after a price-only change keeps the mapping `PUBLISHED` and puts T back; restoring after a judgement-field change leaves an already `UNDER_REREVIEW` mapping where it is until a different RV re-approves (the re-approval then pins the restored version's fingerprint); restoring a catalog whose base fee fingerprint differs from a current pin moves the mapping to `UNDER_REREVIEW`.
8. **After a re-approval the mapping is `APPROVED`, not yet usable.** Readiness shows `MAPPING_UNREVIEWED` until a new bundle containing it is published (`APPROVED -> PUBLISHED`) and the PO assigns the scope. This is the existing lifecycle, asserted in the version tests, not a new rule.
9. **HA review requests stay treatment-only** (`closeReviewRequestForMapping` already returns early for an id that is not a treatment); RV authors base fee mappings directly (#34).

#### AC evidence (additional evidence only; no AC is closed or added by this section)

| AC | Test file / describe | What is checked |
|----|----------------------|-----------------|
| AC-011j | `base-fee-mapping-path.test.ts`: `기본비용 줄: 준비 상태와 계산이 줄 단위로 같다` | Through approve (a different RV) -> bundle publish -> PO scope -> `readReadiness`: base fee row `READY`, `READY` with `confirmedExclusion` (EXCLUDED), `MAPPING_ABSENT`, `MAPPING_UNDER_REREVIEW`, and (versions file) `MAPPING_UNREVIEWED`; each row equals the hold code / state the independent `estimate()` gives that line at the READY cell |
| AC-011l | same describe + `it.each` over COVERED / EXCLUDED / NONE | `calculationReady` equals the `estimate()` verdict for all 15 cells (`expectCalculationAgrees` plus an explicit "READY only at the profile cell and only when the base fee mapping exists"); `estimate()` input assembled independently of the service (`independentClinicInput`) |
| AC-011j / AC-011l (T contract) | same file | `hospitalPayment` = treatments + base fee in all of: mapping present, absent (hold on that line only, `expectedInsurancePayout` null), `UNDER_REREVIEW`, EXCLUDED; `baseFeeIncluded` `INCLUDED` when registered, `NOT_REGISTERED` after a catalog without it |
| AC-009a | `base-fee-versions.test.ts`: `보장 판단 필드(code, benefitType)가 바뀐 새 버전` ; `base-fee-fingerprint.test.ts` | Each judgement field alone (`code`, `benefitType`) moves the PUBLISHED mapping to `UNDER_REREVIEW` with history + audit; fingerprint differs; non-judgement fields never move it; trigger compares with the pinned fingerprint (a version 3 written without version 2 still moves it) and is idempotent; shared body for treatments and base fees |
| AC-009c | `base-fee-versions.test.ts`: `가격만 바뀐 새 기본비용 버전` | Same `baseFeeId`, new version id, new amount: same fingerprint, mapping state record deep-equal, no `ITEM_REREVIEW` audit, readiness `READY`, `estimate()` T changes by exactly the price delta |
| AC-011b | `base-fee-versions.test.ts`: `카탈로그 게시의 그 밖의 경로` | Restoring an earlier catalog version publishes a new-id copy including base fees, results stay consistent with the engine (3 scenarios above in decision 7) |
| AC-011c | indirect only | Table P is untouched; in every scenario the single profile cell stays the only `READY` cell (`calculationReady` over 15 cells) |
| (supporting, DD-15 / design.md:318) | `base-fee-identity.test.ts`, `base-fee-fingerprint.test.ts`, `readiness-repo.test.ts` | One id space and ownership (repository + catalog publish, full snapshot before / after, corrected request publishes); shared lookup rules; reuse proof (module-wrapped spies prove `approve`, `publishRuleBundle`, `toEngineBaseFeeLine` and the catalog re-review call the shared functions; source scans prove the single definitions and that `approval.ts` / `bundle-publish.ts` do not import `currentTreatmentVersion` or a fingerprint function) |

#### RED before GREEN (exact statement)

Order: (1) the fixture change (`baseFeeId` default), the new fixture `base-fee.fixture.ts`, the four new test files, the replacement test group A in `readiness-repo.test.ts` and the read-spy table row were written FIRST, with no change under `src/` (the repository had no `listCommonBaseFeeVersions`, no `coverage-target.ts`, no `baseFeeId`); (2) the RED run; (3) the implementation. RED run: `npx vitest run tests/server --maxWorkers=4` -> exit 1 (`red-server.txt`): `Test Files  6 failed | 38 passed (44)`, `Tests  50 failed | 2555 passed (2605)`. The six files: `base-fee-mapping-path`, `base-fee-versions`, `base-fee-identity`, `readiness-repo`, `repo-memory` (assertion failures / missing methods) and `base-fee-fingerprint` (failed to load: `Cannot find module '/src/server/coverage-target'`, so its 28 tests have only load-failure RED, no per-assertion RED). The behavioural RED that motivated the step is visible: the replaced test failed because `approve()` threw `TREATMENT_VERSION_ABSENT` from `pinnedFingerprint` (`approval.ts:90`), and 20+ service-path tests failed at `approveSpec` -> `approve` for the same reason. The group A tests that assert PRESERVED guards (neither-treatment-nor-base-fee target at approve and at publish, self-approval) passed before the implementation by design; they are the "real failure conditions still reject" half and are made meaningful by the mutation table (M1 breaks 34 tests including them). After the implementation: `npx tsc --noEmit` exit 0, and the first GREEN run was `Test Files  44 passed (44)`, `Tests  2633 passed (2633)` (`green-iter1.txt`). No test was changed between the RED run and the GREEN run. Test-authoring slips corrected BEFORE the RED run: a convoluted assertion in the 15-cell test was simplified, one bogus re-approve test was dropped, an unused import merged. No implementation was written before its failing test.

#### Evidence (outputs under `.moai/state/verify/m3g1/`, gitignored; every vitest run with `--maxWorkers=4`, sequential, on the final tree)

```
$ npx vitest run tests/server tests/boundary --maxWorkers=4     -> exit 0   (vitest-server-boundary.txt)
 Test Files  48 passed (48)
      Tests  2876 passed (2876)
$ npx vitest run tests/engine tests/boundary --maxWorkers=4     -> exit 0   (vitest-engine-boundary.txt)
 Test Files  36 passed (36)
      Tests  1544 passed (1544)          (M1/M2 regression, unedited)
$ npx tsc --noEmit                                              -> exit 0   (tsc.txt, empty output)
$ npx vitest run --coverage --maxWorkers=4                      -> exit 0   (vitest-coverage.txt)
 Test Files  80 passed (80)
      Tests  4177 passed (4177)          (before this step: 76 files / 4094 tests)
$ node .moai/state/m3/covsum.mjs coverage/coverage-summary.json (covsum.txt)
 engine: statements 652/652, branches 558/558, functions 145/145, lines 606/606
 server: statements 1266/1266, branches 701/701, functions 330/330, lines 1191/1191
```

Engine stays at 100% (652/558/145/606) and `src/server` at 100% for what was added (before this step: 1237/685/319/1165). No coverage-only tests were added; no unreachable-by-design lines. No `skip` / `only` / disabled tests. `git -C <worktree> diff --check` printed only the LF-to-CRLF autocrlf warnings (the same warning every existing LF working-copy file produces) and no whitespace-error line.

#### Mutation spot checks (scripted one-spot edit of the final tree, `npx vitest run tests/server --maxWorkers=4` each; baseline 2633 tests; the script restored every file from its in-memory original; `src-hashes-before.txt` equals `src-hashes-after.txt` over every `src/server/**` file; outputs `mutations/M*.txt`, rows in `mutations/summary.json`)

| Mutation | Result (failed tests / files) |
|----------|-------------------------------|
| M1 `coverage-target.ts`: base fee branch skipped (approval / publish ignore base fees again) | 34 / 4 |
| M2 `coverage-target.ts`: base fee version picked as latest written instead of the current-catalog version | 2 / 2 |
| M3 `fingerprint.ts`: `amount` leaks into the base fee fingerprint (price-only change moves the mapping) | 17 / 4 |
| M4 `fingerprint.ts`: `code` ignored in the base fee fingerprint (judgement change does NOT move the mapping) | 20 / 4 |
| M5a `memory-repository.ts`: `putCommonBaseFee` accepts a `baseFeeId` equal to a treatment id | 1 / 1 |
| M5b `memory-repository.ts`: `saveTreatment` accepts an id equal to a `baseFeeId` | 2 / 1 |
| M6 `projection.ts`: engine base fee line computes its own fingerprint | 16 / 4 |
| M7 `projection.ts`: base fee line amount forced to 0 (hospital payment loses the base fee) | 3 / 3 |
| M8 `catalog-publish.ts`: re-review trigger skipped for base fees | 8 / 2 |
| M9 `bundle-publish.ts`: stale fingerprint check disabled | 2 / 2 |
| M10 `catalog-publish.ts`: other-clinic `baseFeeId` no longer rejected | 2 / 1 |
| M11 `projection.ts`: engine line `treatmentId` = version id instead of `baseFeeId` | 16 / 3 |

All 12 mutants are killed. Limit: "the engine excludes a held base fee from T" cannot be mutated here because `src/engine/**` is out of bounds for this step; M7 is the projection-level analogue and the T-invariance tests assert the engine behaviour (T = 25 000 in all four mapping states).

#### OPEN items / NOT IMPLEMENTED / NOT VERIFIED

1. **Spec wording to update by the document owner (not edited here).** design.md:929 (DD-18 `CommonBaseFee` field list) should add `baseFeeId` and say `id` is the version id; DD-16 (judgement fields) and DD-15 should add the base fee judgement fields (`code`, `benefitType`; `calcClass` derived); design.md:157 / :318 / :1233 should say a base fee mapping's `treatmentId` is the `baseFeeId`. plan.md §E #8 text is consistent with the implementation; the M3.B / M3.D1 / M3.E / M3.F texts saying base fee mappings cannot be approved are superseded by this section.
2. **M4 still owns design.md:171 (c)** (the same `treatmentId` in both `lines` and `baseFeeLines` of an estimate request). This step only guarantees that stored treatment ids and `baseFeeId`s cannot collide; request-level validation and the HTTP 500 mapping are NOT IMPLEMENTED.
3. **Catalog `changeSummary.baseFeesChanged`** still compares version ids, so a price-only new base fee version reports `true` (a change of the catalog's base fee set). Left as is `[not in docs]`; no priceChangedBaseFeeIds list exists in DD-14.
4. NOT IMPLEMENTED: M4 to M7, DB adapter, HTTP, clinic ownership / membership checks (AC-022a), deployment, merging, committing. NOT VERIFIED: any DB behaviour; asynchronous transactions; real concurrency; lint (no lint script and no `moai` CLI on this machine); CI; only Windows 11 and the local Node were run.

### M3 외부 검토 보완 ② 재승인 정보와 캐시 계약 회귀 시험, 2026-10-19

**Scope.** External-review item 2 (code side) for Draft PR #3 (cycle_type = tdd), on branch `feature/SPEC-REIMBURSEMENT-001-m3-data` at `76646d3`, not committed by this step. Review finding: `ItemStateSnapshot` carries `state`, `approver` and `approvedFingerprint`; they live in the item STATE record (`repo.readItemStates`), not in the immutable item content (`repo.getItemVersion`), and `domain/projection.ts` composes immutable content plus freshly read state into the engine snapshot. A re-approval (`UNDER_REREVIEW -> APPROVED`, `approval.ts` `approve`) writes a NEW approver and re-pins a NEW fingerprint, while the rule bundle version (`id`, `itemRefs`, `contentHash`) and every item content stay unchanged. design.md DD-14 still lists approver and fingerprint as immutable / cacheable content; the document owner corrects the wording separately (this step does not edit design.md, acceptance.md, plan.md, spec*.md or research.md). **This step is a regression proof in code only. It changes NO production code, closes NO new AC and adds NO AC id.** The implementation already matched the corrected contract; the new tests pin it. NO M4 work (no HTTP, no cache layer, no routes, no 500 mapping). Owner decisions #31 / #34 / #1 are intact.

The contract the tests pin:

| Kind | Items | Cache rule |
|------|-------|------------|
| Immutable, cacheable | item version content (`content`, `contentHash`, header fields such as `origin`, `validity`, `policySources`, author), rule bundle version (`id`, `itemRefs`, `contentHash`) | may be served from a cache keyed by (bundle id, `contentHash`) |
| Read fresh on every composition, composed TOGETHER | `state`, `approver`, `approvedFingerprint` (item level), plus bundle availability `status` | never cached; one `readItemStates` per composition |

#### What was built

| File | Change |
|------|--------|
| `tests/server/reapproval-cache-contract.test.ts` | NEW, 32 tests per target x 2 targets = 64 tests (`describe.each` over a treatment mapping and a common base fee mapping) |
| `tests/fixtures/server/reapproval.fixture.ts` | NEW (all `TEST_FIXTURE`): the two targets, the test-side "cache" (`cacheBundle` = a deep copy of one `getRuleBundleVersion` + `getItemVersion` read), `composeFromCache` (cached content + `readItemStates` + `getBundleStatus` through `projection.ts`; reads NO content), step helpers `stepOne / stepTwo / stepThree / stepFive`, engine verdict helpers |

No file under `src/**` was edited (hash proof below). No file under `src/engine/**`, `tests/engine/**`, `tests/boundary/**`, `tests/fixtures/engine/**` was edited; `package.json`, `vitest.config.ts`, design.md, acceptance.md, plan.md, spec*.md and research.md are untouched. Existing fixtures are reused unchanged (`publishedBaseFeePath`, `base-fee.fixture.ts`, `governance.fixture.ts`, `versioning.fixture.ts`).

#### Scenario S (every step goes through the services; no direct repository state injection)

Principals: author `TEST_FIXTURE_RV_AUTHOR`, first approver A1 = `TEST_FIXTURE_RV_APPROVER`, re-approver A2 = `TEST_FIXTURE_RV_APPROVER_2` (a test asserts the three differ), bundle publisher `TEST_FIXTURE_RV_PUBLISHER`, catalog publisher `TEST_FIXTURE_HA_1`, scope `TEST_FIXTURE_PO_1`, suspender `TEST_FIXTURE_RV_SUSPENDER`. Path: catalog publish -> author -> submit -> approve (A1) -> bundle publish (X) -> PO scope -> readiness `READY`.

| Step | What the tests do and assert |
|------|------------------------------|
| 1 | Read bundle X first and keep a deep copy of what a cache would hold (bundle record + the content records of all its items). Negative control: a deep copy of the state snapshots read at that time (mapping `PUBLISHED`, A1, F1). Assert content records have no `state` / `approver` / `approvedFingerprint` key (3 item kinds), the bundle record keys are exactly `id, itemRefs, contentHash, publishedBy, publishedAt`, and the stale copy equals `{PUBLISHED, A1, F1}` |
| 2 | HA publishes a catalog with a new version whose coverage-judgement field changed (treatment: `treatmentCode`; base fee: `code`). Fresh state read: `UNDER_REREVIEW`, approver and fingerprint still A1 / F1. X `id` / `contentHash` / `itemRefs` deep-equal the cached copy, `bundleContentHashOf` recomputed from storage equals it, cached content deep-equals a fresh `getItemVersion` read, readiness row and `estimate()` both give `MAPPING_UNDER_REREVIEW` |
| 3 | A2 re-approves. Fresh read: `APPROVED`, approver `{A2, 2026-10-20T09:00:00.000Z}`, fingerprint F2 != F1 and equal to the fingerprint of the NEW current version. X unchanged vs the cache, content unchanged (and content has no `approver` / `approvedFingerprint`). History keeps the A1 / F1 rows and appends `APPROVED, A2, F2` (full tuple list asserted); audit shows `ITEM_APPROVE(A1)`, `ITEM_REREVIEW(HA_1)`, `ITEM_APPROVE(A2)` in that order |
| 4 | Compose the engine snapshot two ways. (a) cached content + FRESH state: mapping `APPROVED`, A2, F2. (b) cached content + the stale copy: `PUBLISHED`, A1, F1. Engine verdicts differ: (a) `MAPPING_UNREVIEWED`, (b) `MAPPING_UNDER_REREVIEW` (the stale F1 no longer equals the line's fingerprint). The readiness loader's bundle deep-equals composition (a) (one composition path). Key-shape assertion: composed keys = content keys + `state, approver, approvedFingerprint`. Planting fake `state` / `approver` / `approvedFingerprint` values into the cached content changes nothing in the composed result (they come only from the state record) |
| 5 | Lifecycle continuation, see "Observed semantics" below |
| 6 | Read spy: composing from the cache calls `readItemStates` exactly once per composition and `getItemVersion` / `getRuleBundleVersion` zero times; the readiness loader calls `readItemStates` once per bundle per load (second load doubles it); one cache object composed three times across `UNDER_REREVIEW -> APPROVED -> PUBLISHED` returns the new state / approver / fingerprint each time, the cache object stays deep-equal to its pre-sequence copy, and no invalidation call exists or is needed |
| 7 | Suspend bundle X: item states, approvers, fingerprints and item histories are unchanged (deep-equal before / after), X's record equals the cached copy, composition shows `status SUSPENDED` read fresh while the mapping is still `PUBLISHED, A2, F2`; the clinic scoped to X reads `RULE_BUNDLE_SUSPENDED`, and after the PO scopes it to X2 it is `READY` for the same items |

#### Observed semantics of step 5 (plain words; read from `bundle-publish.ts` / `lifecycle.ts` and confirmed by tests, nothing invented)

1. After the re-approval the mapping is `APPROVED`, which the engine does not accept: while bundle X is still `ACTIVE` and the clinic still points at X, the line is held with `MAPPING_UNREVIEWED`. Bundle X itself is not touched by the re-approval.
2. The only way back to `PUBLISHED` is publishing a bundle that contains the item: `publishRuleBundle` moves every `APPROVED` item of the request to `PUBLISHED`. There is no operation that "re-publishes" X (a published bundle is write-once); publishing the same item refs gives a NEW bundle X2 (new id).
3. X2's `contentHash` EQUALS X's (the hash is defined over the sorted item refs and the digests of the stored item content; it does not read state, approver, fingerprint, bundle id, time or publisher). X2's `itemRefs` equal X's. X's record is unchanged and X stays `ACTIVE`. The publish does not mark any earlier item version `SUPERSEDED` (the existing `@MX:NOTE` in `bundle-publish.ts`).
4. Item state is shared across bundles. So after X2 is published, bundle X becomes usable again WITHOUT any action on X: a clinic whose scope still points at X reads `READY` (scope bundle id is still X) and the engine estimates the line. The mapping now carries A2 and F2. A clinic scoped to X2 sees the identical item states; composing X and X2 from their caches differs only in the bundle id.
5. Consequence worth knowing: nothing forces anyone to publish X2. Until some RV publishes a bundle containing the re-approved mapping, every bundle with that item stays held for that line, and publishing ANY bundle that contains it (not only a copy of X) also returns it to `PUBLISHED`.
6. A stale fingerprint alone blocks even a `PUBLISHED` item: after step 5, the composition with the stale state copy (`PUBLISHED`, A1, F1) is held with `MAPPING_UNDER_REREVIEW` while the fresh composition estimates the line. This is the concrete reason `state`, `approver` and `approvedFingerprint` must be read fresh and together.

History after step 5 (asserted): `DRAFT, REVIEW_REQUESTED, APPROVED(A1,F1), PUBLISHED(A1,F1), UNDER_REREVIEW(A1,F1), APPROVED(A2,F2), PUBLISHED(A2,F2)`.

#### Decisions and assumptions (`[not in docs]` = design / acceptance are silent)

1. **`[not in docs]` The "cache" is test-side only.** There is no cache layer in `src/`. `cacheBundle` is a deep copy of repository reads and `composeFromCache` is the composition an M4 server would do from such a cache; the readiness loader (the real composition path) is compared to it by deep equality. Content reads may be repeated or cached; the tests do not require a cache.
2. **`[not in docs]` One judgement field per target.** Treatment: `treatmentCode`; base fee: `code`. The other judgement fields (`procedureCodes`, `benefitType`, `calcClass`) are covered by `re-review.test.ts`, `base-fee-versions.test.ts` and `base-fee-fingerprint.test.ts`; `calcClass: NEEDS_REVIEW` was deliberately not used here because it adds an unrelated classification hold to the verdicts.
3. **`[not in docs]` Composition ignores unknown keys planted in content for kinds that do not have the field.** `state` and `approver` are always taken from the state record for all three kinds, and a mapping's `approvedFingerprint` always from the state record (a planted value is overridden). A planted `approvedFingerprint` key on a PROFILE or DOCUMENT_RULE_SET content record is not an engine field and passes through as an unknown content key; it cannot be produced through the services. My first version of the planting test planted it on every kind and failed on that (2 of 64 tests); the test was narrowed to plant the mapping-only field only on mappings. This is a test-authoring correction, not a production defect, and no `src/` file was changed.
4. **Audit sequence is part of the contract check** (step 3): the re-approval is a second `ITEM_APPROVE` entry rather than an edit of the first; nothing is overwritten silently.
5. **Document wording left to the document owner:** design.md DD-14 / DD-15 / DD-17 text that treats approver and `approvedFingerprint` as immutable cacheable content; the corrected statement is the table at the top of this section. Already noted in `items.ts`'s header comment from M3.B.

#### AC evidence (additional evidence only; no AC is closed or added by this section)

| AC | Test file / describe | What is checked |
|----|----------------------|-----------------|
| AC-011a | `reapproval-cache-contract.test.ts`: steps 1, 2, 3, 5 | The bundle content hash is unchanged by approver / fingerprint / state changes and recomputes equal from storage; X2 over the same item refs has the same hash as X; bundle record is write-once and equal to the cached copy |
| AC-009a | same: steps 2, 3 | Judgement field change -> `UNDER_REREVIEW` (history + audit), re-approval by a different RV re-pins the fingerprint to the new current version and writes the new approver, the old values stay in the history |
| AC-011m / AC-011n (data-layer part only, M3) | same: steps 4, 5, 6 | Cached content + freshly read state reflects `UNDER_REREVIEW` / `APPROVED` / `PUBLISHED` on the next composition with no invalidation and the same bundle id / hash; the HTTP 200 / 409 behaviour is M4 |
| AC-011p (data-layer part only, M3) | same: step 5 | Item state is shared by two bundles containing the same item version; bundle X and X2 compose to the same item states |
| AC-011e (additional) | same: step 7 | Suspension is a bundle-level availability read fresh, item-level state / approver / fingerprint unchanged |

#### RED before GREEN (exact statement)

Order: the fixture and the test file were written FIRST; no change under `src/` was made at any time. The contract was already implemented (`projection.ts`, `approval.ts`, `re-review.ts`, `bundle-publish.ts`, the memory repository), so there was no failing run caused by missing production behaviour and **no behavioural RED exists for this step**. The first run (`first-run.txt`) was `Tests  2 failed | 62 passed (64)`: the 2 failures were my own over-broad planting assertion (decision 3), fixed in the test; 62 tests passed on their first run. Because passing-on-first-run says nothing about teeth, the proof that the tests can fail is the mutation table below (11 production mutants, all killed, each by the new file). No implementation was written before a failing test because no implementation was written.

#### Evidence (outputs under `.moai/state/verify/m3g2/`, gitignored; every vitest run with `--maxWorkers=4`, sequential, on the final tree)

```
$ npx vitest run tests/server tests/boundary --maxWorkers=4     -> exit 0   (vitest-server-boundary.txt)
 Test Files  49 passed (49)
      Tests  2940 passed (2940)         (before this step: 48 files / 2876 tests; +1 file, +64 tests)
$ npx vitest run tests/engine tests/boundary --maxWorkers=4     -> exit 0   (vitest-engine-boundary.txt)
 Test Files  36 passed (36)
      Tests  1544 passed (1544)          (M1/M2 regression, unedited)
$ npx tsc --noEmit                                              -> exit 0   (tsc.txt, empty output)
$ npx vitest run --coverage --maxWorkers=4                      -> exit 0   (vitest-coverage.txt)
 Test Files  81 passed (81)
      Tests  4241 passed (4241)          (before this step: 80 files / 4177 tests)
$ node .moai/state/m3/covsum.mjs coverage/coverage-summary.json (covsum.txt)
 engine: statements 652/652, branches 558/558, functions 145/145, lines 606/606
 server: statements 1266/1266, branches 701/701, functions 330/330, lines 1191/1191
```

Coverage is unchanged (no `src/` change). No coverage-only tests; no `skip` / `only` / disabled tests.

#### Mutation spot checks (scripted one-spot edit of the final tree, `npx vitest run tests/server --maxWorkers=4` each; baseline 2940 tests; the script restored every file from its in-memory original; `src-hashes-before.txt` equals `src-hashes-after.txt` over all 40 `src/server/**` files; outputs `mutations/M*.txt`, rows in `mutations/summary.json`, script `.moai/state/m3/mutate-m3g2.mjs`)

| Mutation | Failed tests total / files | Failed in the new file (of 64) |
|----------|----------------------------|--------------------------------|
| M1 `projection.ts`: `approver` taken from the content record | 351 / 14 | 64 |
| M2 `projection.ts`: mapping `approvedFingerprint` taken from the content record | 341 / 13 | 64 |
| M3 `projection.ts`: `state` taken from the content record | 32 / 7 | 12 |
| M4 `memory-repository.ts`: `readItemStates` result cached per repository instance | 143 / 15 | 56 |
| M5 `approval.ts`: `approve()` does not re-pin the fingerprint on re-approval | 36 / 6 | 28 |
| M6 `approval.ts`: `approve()` keeps the old approver on re-approval | 22 / 4 | 16 |
| M7 `bundle-publish.ts`: bundle `contentHash` recomputed to include item state | 18 / 4 | 8 |
| M8 `re-review.ts`: the re-review transition clears the approver | 12 / 2 | 8 |
| M9 `readiness.ts`: loader reuses the states of an earlier load of the same bundle | 8 / 4 | 2 |
| M10 `bundle-publish.ts`: publish does not move `APPROVED` items back to `PUBLISHED` | 185 / 9 | 26 |
| M11 `memory-repository.ts`: the state history entry loses the approver | 19 / 7 | 4 |

All 11 mutants are killed, and each is killed by the new file. Limits: the mutants are one-spot edits of the in-memory implementation; they do not prove the absence of other cache bugs. The planted-content test (decision 3) is the only guard against a mutant that reads a planted content key for kinds other than the mutated one; a mutant that takes `approvedFingerprint` for a PROFILE from content would not be caught because the field does not exist on profiles.

#### M4 cache-hit test criteria to carry forward (for the document owner to link into the specification; testable sentences, NOT implemented or verified here)

1. Item content (`content`, `contentHash`, header fields) and the rule bundle version (`id`, `itemRefs`, `contentHash`) may be served from a cache keyed by (bundle id, `contentHash`). A cache hit never changes the response for a request whose state has not changed.
2. `state`, `approver`, `approvedFingerprint` and the bundle availability `status` are read on every request and composed together into the engine snapshot; none of the four is ever served from the content cache.
3. A cache hit for content still triggers exactly one `readItemStates` call per request (per bundle used) and one availability read; a request that served content from the cache and skipped the state read is a failure.
4. After a re-approval (`UNDER_REREVIEW -> APPROVED`, then publication of a bundle containing the mapping) the next request returns HTTP 200 and the response carries the same `ruleBundleVersion` id and `contentHash` as before when the clinic's scope still points at the original bundle, with NO 409 and no cache invalidation call; the engine uses the new approver and the new `approvedFingerprint`.
5. Between the re-approval and the publication of a bundle containing the mapping, the next request returns HTTP 200 with the line `ON_HOLD` and `MAPPING_UNREVIEWED` (state `APPROVED`), again with the unchanged bundle id and hash and no 409.
6. Serving a state snapshot older than the request (stale state, stale approver or stale fingerprint) is a failure: with a cached content and a state copy from before the re-approval, a request must not return the result that stale copy would give (the stale `PUBLISHED, A1, F1` copy gives `MAPPING_UNDER_REREVIEW` after a judgement-field change, the fresh state gives `ESTIMATED`).
7. Two bundles containing the same item version return the same item state to their clinics; changing the state through the domain service is reflected for both on their next request.
8. Suspending a bundle changes only that bundle's availability: item state / approver / fingerprint are unchanged and a clinic scoped to another bundle with the same items is unaffected.

#### OPEN items / NOT IMPLEMENTED / NOT VERIFIED

1. **Spec wording to update by the document owner (not edited here):** DD-14 (cache contract) should say approver and `approvedFingerprint` are item STATE read per request, not cacheable content; DD-15 / DD-17 should say a re-approval writes a new approver and re-pins the fingerprint, and the bundle `contentHash` does not change; acceptance wording for AC-011m..p may reference the M4 criteria above.
2. **Owner may want a rule for the `APPROVED`-but-unpublished gap** (observed semantics 5): today re-approval does not republish anything, so a bundle stays held for that line until some RV publishes a bundle containing the item. Not changed here (no document requires otherwise).
3. NOT IMPLEMENTED: M4 caching, HTTP, routes, 500 mapping; M5 to M7; DB adapter; clinic ownership / membership; deployment; merging; committing. NOT VERIFIED: any real cache behaviour, concurrency (a state change between the content read and the state read), a DB; lint (no lint script and no `moai` CLI on this machine); CI; only Windows 11 and the local Node were run. The case of a re-approval that lands between two requests is the same as step 6 of the scenario; races inside a single request are not modelled by the synchronous memory repository.

### M4.A Next.js 골격·운영/시험 구성·catalog·options·운영 진입점 경계, 2026-10-19

**Scope.** M4 step A (cycle_type = tdd) on branch `feature/SPEC-REIMBURSEMENT-001-m4-api` (created from the M3 tip `7be1d03`), not committed by this step. Built: the Next.js App Router skeleton and its dependencies; the operating composition `src/server/composition.ts` (accepted origins fixed to `OPERATING`) and the production wiring `src/app/services.ts`; the test composition under `tests/`; API plumbing (JSON response helper with `Cache-Control: no-store`, error body helper, server-integrity error to 500 mapping, injectable log sink); the services and `route.ts` for `GET /api/clinics/{slug}/catalog` and `GET /api/clinics/{slug}/insurance/options`; the production no-fixtures boundary test with negative tests. NOT built here (belongs to B / C): the estimate service and route, request layers 0-5 for POST, the 409 body, the bundle content cache, privacy log/dump checks (AC-016e, AC-016n), engine calls from the API. Owner decisions (DB deferral, in-memory repository only, `OPERATING` only in operating composition) are intact. No file under `src/engine/**`, no existing file under `src/server/**`, `tests/engine/**`, `tests/boundary/**`, `tests/fixtures/**`, `tests/server/**` was edited.

#### What was built

| File | Change |
|------|--------|
| `package.json`, `package-lock.json` | `next@16.4.2`, `react@19.3.1`, `react-dom@19.3.1` (dependencies), `@types/react@19.3.0`, `@types/react-dom@19.3.0` (devDependencies), all exact; script `build: next build`. Lockfile grows by Next's transitive packages (148 `node_modules/` entries in total now), including Next's optional platform binaries |
| `tsconfig.json` | Added what `next build` itself asked for: `allowJs`, `incremental`, `esModuleInterop`, `resolveJsonModule`, `jsx: react-jsx`, `plugins: [{name: next}]`, `include` += `.next/types/**/*.ts` and `.next/dev/types/**/*.ts`, `exclude: [node_modules]`. No strictness option was weakened; type-check stays on |
| `vitest.config.ts` | Coverage include += `src/app/**` |
| `next-env.d.ts` | Generated by Next (not hand-written; `.next/` is already gitignored, this file is not). The orchestrator decides whether to commit or gitignore it |
| `src/server/api/log.ts` | Log sink interface (`ServerLogEntry` = `{event, code}` only) and `silentLog` |
| `src/server/api/http.ts` | `jsonResponse` (always `no-store` + `application/json`), `errorResponse`, `ERROR_STATUS` (the six non-409 public codes of the DD-19 error table) |
| `src/server/api/integrity.ts` | `ServerIntegrityError` (closed code list, message = code only) and `guarded` (any throw -> 500 `INTERNAL_ERROR`, log = event + code) |
| `src/server/api/services.ts` | `ApiServices = { repo, log, acceptedOrigins }`, `AcceptedOrigins` |
| `src/server/api/clinic.ts` | `findClinicBySlug` (exact match), `handleClinicRead` (404 `CLINIC_NOT_FOUND` / 200 / 500) |
| `src/server/api/published-catalog.ts` | `readPublishedCatalog`: the one reader of "the clinic's current published catalog" (treatments with `active`, sorted; base fees; dangling or foreign references -> `ServerIntegrityError`). B reuses it for the 422 layer-4 check and for engine line assembly |
| `src/server/api/catalog.ts`, `options.ts`, `options-cards.ts` | The two services, their handlers and the fixed card texts |
| `src/server/composition.ts` | `createOperatingServices({repo, log})`, `OPERATING_ACCEPTED_ORIGINS` (frozen). Hazard-free for `server-imports.test.ts` |
| `src/app/services.ts` | Production wiring: `getApiServices()` builds `createOperatingServices` over an empty `createMemoryRepository()` once. The only way a `route.ts` gets services |
| `src/app/api/clinics/[slug]/catalog/route.ts`, `.../insurance/options/route.ts` | Thin `GET` exports; `params` is a Promise (Next.js 16) |
| `tests/fixtures/server/api-composition.fixture.ts` | TEST composition (`createTestServices`, `TEST_ACCEPTED_ORIGINS`, `useTestServices`/`activeTestServices` holder, `CollectingLog`) and world builders that use the real services (catalog publish, bundle approve + publish, PO scope, suspend) |
| `tests/api/plumbing.test.ts` (25), `catalog.test.ts` (33), `options.test.ts` (25), `production-composition.test.ts` (20), `helpers.ts` | New. Integration tests call the REAL `GET` exports |
| `tests/boundary/production-no-fixtures.test.ts` (46), `production-reach.ts` | New. Reuses `source-scan.ts` and `fixture-reach.ts` read-only |

No existing M3 `src/server/**` module was changed (no blast radius). `tests/boundary/server-imports.test.ts` scans the new `src/server/api/**` and `composition.ts` and passes unedited.

#### Decisions and assumptions (`[not in docs]` = design / acceptance are silent; the orchestrator moves these into design.md)

1. **How real `route.ts` exports get services.** The accessor `getApiServices()` lives in `src/app/services.ts` (not in `src/server/composition.ts`). Tests replace that one module with `vi.mock('.../src/app/services')` and the TEST composition. Why not the accessor inside `composition.ts`: production needs inputs that must come from outside `src/server` (the system date for M4.B's `at`, a real log sink), and `src/server` may not read clocks (`server-imports.test.ts`); a zero-argument accessor in `composition.ts` would force a late-bound clock/setter, which is an override hook. With the wiring module in `src/app`, composition stays pure (`createOperatingServices(deps)`), and production has no setter and no env hook (asserted: `services.ts` exports only `getApiServices`; `composition.ts` exports only `OPERATING_ACCEPTED_ORIGINS` and `createOperatingServices`, and an extra `acceptedOrigins` argument is ignored). For A no clock is needed, so none was added (B will add `clock` to `ApiServices` and the wiring).
2. **`[not in docs]` Empty production store behaves as "no clinic".** Every slug answers 404 `CLINIC_NOT_FOUND`. This is expected and documented in `services.ts`/`composition.ts`; nothing is seeded and nothing works around it. Verified over real HTTP with `next start` (`smoke-*.txt`): both GET routes answer 404 with `cache-control: no-store` and `content-type: application/json`; POST answers 405 (only `GET` is exported).
3. **`[not in docs]` Clinic lookup by slug** scans `listClinics()` for an exact (case- and whitespace-sensitive) match; the repository interface has no slug query. A DB adapter should add a slug-index query; existing methods are untouched.
4. **`[not in docs]` Catalog behaviour for a clinic without a published catalog:** 200, `catalogVersion: null`, `treatments: []`, `baseFees: []`, `baseFeeIncluded: NOT_REGISTERED`, `idlePolicy` as usual. The clinic exists, so it is not a 404; the kiosk cannot build a calculation request (it needs a string `catalogVersion`) and has nothing to select.
5. **`[not in docs]` `baseFees[]` item shape:** `{ baseFeeId, displayName, benefitType, amount }` (stable `baseFeeId`, not the version id; display fields only), sorted by `baseFeeId` in code-point order; `baseFeeIncluded = INCLUDED` iff there is at least one (same rule as `estimate()`).
6. **`[not in docs]` `priceCondition`:** `"<patientType> · <assumption> · 기준일 <referenceDate>"` built from the stored `amountCondition`; the stored values are not interpreted.
7. **`[not in docs]` `order` = the treatment's `sortOrder`**; treatments are sorted by `sortOrder`, ties by `treatmentId` in code-point order. `clinic.setting`: `CLINIC` -> `OUTPATIENT_ONLY`. `clinic.displayName` = clinic name; `serviceDisplayName` = `보담`. Clinic `contact`, ids, `origin`, `calcClass`, codes, document flags, `effectiveDate` are not in the response.
8. **`[not in docs]` Inactive treatments (`active=false`) are "not in the current published catalog":** left out of the catalog response. `readPublishedCatalog` is the single definition, so M4.B's layer-4 check (DD-19 names "비활성·미게시 치료 ID" there) cannot disagree with what catalog shows.
9. **Server integrity (`ServerIntegrityError` -> 500 `INTERNAL_ERROR`, no body detail, log = event + code):** `TREATMENT_VERSION_MISSING`, `TREATMENT_MISSING`, `TREATMENT_CLINIC_MISMATCH`, `BASE_FEE_MISSING`, `BASE_FEE_CLINIC_MISMATCH`, `BUNDLE_AVAILABILITY_MISSING` (a scope that points to a bundle with no availability record; `ruleBundleStatus: null` is never emitted together with a non-null `ruleBundleVersion`). Request rejections (404 here; 400/422/409 in B) are returned as values; only integrity defects and unexpected errors are thrown. Any other thrown error is also 500 with the log code `UNEXPECTED`.
10. **Options reads exactly the rule scope (1 read) and the bundle availability (1 read, only when a scope exists).** No item state, item content, bundle content, catalog, or idle policy is read, and nothing in the response comes from items. Cards are static and identical for every clinic, including clinics with no scope, no catalog, a suspended bundle, or a bundle without profiles.
11. **Card texts are copied from the planning document, nothing invented:** generations from §3 table (`1세대(A·S)` ... `4세대(C4)` with the §3 period texts; 4th period is `2021.07.01부터의 4세대 계약`), insurer types from §4 screen 2 (`손해보험사`, `생명보험사`, `그외 공제 조합` with the institution examples as `help`), causes from §4 screen 3 (labels and helps verbatim), guidance = the fixed §4 screen 1 sentence with `1544-8069`. No wording was chosen by me. Codes equal the engine enums: `GENERATIONS` and the readiness `INSURER_TYPES` are compared in a test, and the cause codes are typed by the engine `Cause` type and listed literally in the test.
12. **Log sink:** production uses `silentLog` (writes nothing). Operationally a 500 leaves no trace in production; a stderr sink with the same two-field entries can be injected from `src/app` later (see OPEN).
13. **Accepted origins are carried but not yet used by A's handlers.** `ApiServices.acceptedOrigins` is what B passes to `estimate()`. A proves the operating value (`{rules:['OPERATING'], lines:['OPERATING']}`, frozen) and proves with the real `estimate()` that `TEST_FIXTURE` lines (all lines `LINE_ORIGIN_NOT_ACCEPTED`) and `TEST_FIXTURE` profile/mappings (`PROFILE_DEMO`) are unusable under it, with a positive control (all `OPERATING` -> no hold; `TEST_FIXTURE` + test origins -> no hold).
14. **Production reach checker (`production-reach.ts`) is new rather than an edit of `fixture-reach.ts`** (which is protected). It adds what the old checker lacks for production entries: alias spellings (`@/`, `~/`, `src/…`, `tests/…`) resolved to repo-root paths, non-fixture test paths (`tests/**`, `*.test.*`), test-runner packages (`vitest`, `jest`, ...), and closed failure for unknown aliases (`#…`), absolute paths, unresolved imports, expression imports and unscannable sources. Entries = `src/server/composition.ts` plus every file under `src/app`.
15. **Next.js and TypeScript 7.0.2:** compatible. `next build` ran its own type-check step with this repo's TypeScript 7 and reported a real type error (`TS2322`) when one was planted in a route (probe restored); so type checking is not disabled or skipped. No root layout was needed (route handlers only); `next build` lists `/_not-found` and the two API routes.

#### AC evidence (closing: AC-010b, AC-011g, AC-018a, AC-018b, and the options half of AC-021e; AC-021e is NOT fully closed until B covers the estimate response)

| AC | Test file / describe | What is checked |
|----|----------------------|-----------------|
| AC-010b | `tests/boundary/production-no-fixtures.test.ts` / `실제 운영 진입점` | Entries = `composition.ts` + all `src/app/**`; the walk over relative imports transitively through `src/server` and `src/engine` finds 0 fixture/test paths; the walk is non-empty (>= 20 files, includes catalog/options/http/idle-policy/rule-scope/memory-repository/engine files); no reached file under `tests/` or with a fixture/test name; `composition.ts` and `src/app` name neither `TEST_FIXTURE` nor `DEMO` as string or identifier; each `route.ts` obtains services through exactly one `getApiServices()` |
| AC-010b | same / `음성 시험: 깨끗한 합성 구성은 통과하고 위반 구성은 실패한다` | Synthetic entries that violate on purpose all FAIL: direct relative, `@/`, `~/`, `tests/…`, `src/…` alias spellings; fixture folder and `.fixture` file inside `src`; non-fixture `tests/api/helpers`; `*.test.ts`; from `route.ts`, `services.ts`, `layout.tsx`; re-export, side-effect, `import type`, literal dynamic import; `./a/../../..` detours; transitive paths through server and engine files (chain from the entry to the fixture asserted); `vitest` and fixture-named packages; closed failures. Controls: clean graph passes, an unreachable file importing a fixture is not reported, `next/server`/`react`/scoped packages pass |
| AC-010b | `tests/api/production-composition.test.ts` / `운영 구성: 허용 출처`, `운영 구성의 허용 출처로 엔진을 부르면 시험 자료는 쓸 수 없다` | Built context passes only `['OPERATING']` for rules and lines (frozen; push/assign throw); an extra `acceptedOrigins` argument is ignored; the real `estimate()` holds `TEST_FIXTURE` lines (`LINE_ORIGIN_NOT_ACCEPTED`) and `TEST_FIXTURE` profile/mappings (`PROFILE_DEMO`) under the operating origins; positive controls |
| AC-011g | `tests/api/options.test.ts` / `AC-011g 묶음 중지` | Suspended bundle: same bundle id, `ruleBundleStatus` = `SUSPENDED`, cards 5/3/3 with the same texts, `no-store`, scope record and scope history unchanged (before/after deep equal); next request on the same services sees the suspension; the other clinic's bundle stays `ACTIVE`; two clinics on one suspended bundle both show it |
| AC-011g | same / `AC-018b 규칙 묶음 버전과 상태` | No scope -> both null |
| AC-018a | `tests/api/catalog.test.ts` / `AC-018a 없는 slug`, `AC-018a 게시 카탈로그: 표시 필드만`, `AC-018a idlePolicy`, `AC-018a 병원마다 다른 카탈로그`, `AC-018a 규칙 범위가 없거나 …`, `AC-018a 카탈로그를 게시한 적 없는 병원 [문서에 없음]` | 404 `CLINIC_NOT_FOUND` for unknown/near-miss slugs (case, trailing space, prefix, clinic id, `__proto__`, empty); 200 body equals the DD-19 shape literally; deep key allowlist (exact key set) + forbidden-key regex + value scan (treatment code, procedure codes, coverage fingerprint, contact, ids absent from the text); `catalogVersion` = current catalog id and changes after a price-only republish; `sortOrder` order and inactive exclusion; stored idle policy per screen kind vs DD-10 defaults, `completionHoldSeconds` stored vs null, per-clinic isolation; clinic without scope still gets the catalog; suspension does not change the catalog body; reads no item/bundle/scope; read-only |
| AC-018b | `tests/api/options.test.ts` / `AC-018b 없는 slug`, `AC-018b 카드와 안내 문구`, `AC-018b 규칙 묶음 버전과 상태`, `읽는 것: 범위와 가용성만` | 404; 5/3/3 cards with the planning-document texts; codes equal engine enums; `1544-8069` once as text and no `1588` anywhere; exact key set; clinic with no approved profile (no scope), clinic without catalog, bundle without profiles still get the cards; two clinics with different bundles get their own `ruleBundleVersion` / `ACTIVE`; re-assigning scope is visible on the next request; read counts: scope 1, availability 1 (0 without scope), items/bundles/catalog 0 |
| AC-021e (options half) | `options.test.ts` (headers in every describe), `catalog.test.ts`, `plumbing.test.ts` / `jsonResponse`, `errorResponse` | `Cache-Control: no-store` and `content-type: application/json` on 200, 404 and 500 for catalog and options, through the real route exports; the response helper is the only constructor of responses. The estimate response half is M4.B |

Not closing here, evidence only: AC-019c (server-side module identity) and AC-021d are untouched by A.

#### RED before GREEN (exact statement)

Order: I first wrote three small plumbing modules (`log.ts`, `http.ts`, `integrity.ts`) before any test, then recognized that as implementation-before-test, DELETED them (and a placeholder `route.ts` that I had used only to probe `next build`), wrote the fixtures and all five test files, ran them (RED), and only then re-created the plumbing from the same design and wrote the rest. RED run (`.moai/state/verify/M4.A/red.txt`): `Test Files 5 failed (5)`, `Tests 4 failed | 42 passed (46)`. Four files failed at import (`Cannot find module` for `src/server/api/http` and the two `route` files), and 4 tests of `production-no-fixtures.test.ts` failed against the real entry list (no `src/app/services.ts`, zero files walked). The 42 passing tests of that file are the synthetic negative tests: the checker is test-side code (`production-reach.ts`) and does not depend on `src/`, so those could not be RED. GREEN on the first run after implementing: `Test Files 5 passed (5)`, `Tests 149 passed (149)` (`green1.txt`). `next build` and the type-check probe were done after the implementation existed.

#### Evidence (outputs under `.moai/state/verify/M4.A/`, gitignored; every vitest run with `--maxWorkers=4`, sequential, on the final tree)

```
$ npx vitest run tests/api tests/server tests/boundary --maxWorkers=4   -> exit 0   (final-1-api-server-boundary.txt)
 Test Files  54 passed (54)
      Tests  3089 passed (3089)
$ npx vitest run tests/engine tests/boundary --maxWorkers=4              -> exit 0   (final-2-engine-boundary.txt)
 Test Files  37 passed (37)
      Tests  1590 passed (1590)         (M1/M2 regression: 36 files / 1544 tests unchanged + the new boundary file with 46 tests)
$ npx tsc --noEmit                                                       -> exit 0   (final-3-tsc.txt, empty output)
$ npx vitest run --coverage --maxWorkers=4                               -> exit 0   (final-4-coverage.txt)
 Test Files  86 passed (86)
      Tests  4390 passed (4390)         (before this step: 81 files / 4241 tests; +5 files, +149 tests)
$ node .moai/state/m4/covsum.mjs coverage/coverage-summary.json
 engine: statements 652/652, branches 558/558, functions 145/145, lines 606/606
 server: statements 1338/1338, branches 731/731, functions 356/356, lines 1258/1258
 other (= src/app): statements 7/7, branches 0/0, functions 3/3, lines 7/7
 total: Statements 100% (1997/1997), Branches 100% (1289/1289), Functions 100% (504/504), Lines 100% (1871/1871)
$ npx next build                                                         -> exit 0   (final-5-next-build.txt)
 Next.js 16.4.2 (Turbopack); Compiled successfully; Running TypeScript ... Finished; routes: /_not-found, /api/clinics/[slug]/catalog, /api/clinics/[slug]/insurance/options
```

Per-file coverage of the new files is in `final-4-coverage-files.txt` (all 100% statements/branches/functions/lines; `services.ts` has no runtime code). No coverage exclusions, no `skip` / `only` / disabled tests.

#### Mutation spot checks (scripted one-spot edit of the final tree, restored from a copy after each run; all files verified identical after restore; output `mutations.txt`; script copied to `.moai/state/verify/M4.A/mutate.mjs`)

| Mutation | Tests run | Result |
|----------|-----------|--------|
| M1 `http.ts`: `cache-control: no-store` header removed | `tests/api` (103) | killed: 35 failed |
| M2 `composition.ts`: `TEST_FIXTURE` added to the accepted rule origins | production-composition + production-no-fixtures (66) | killed: 6 failed |
| M3 `published-catalog.ts`: inactive-treatment filter removed | `tests/api` (103) | killed: 1 failed |
| M4 `options.ts`: `ruleBundleVersion` becomes null when the bundle is suspended | `tests/api` (103) | killed: 2 failed |
| M5 `clinic.ts`: slug compared case-insensitively | `tests/api` (103) | killed: 2 failed |
| M6 catalog `route.ts` imports a fixture (production entry contaminated) | production-no-fixtures (46) | killed: 1 failed (the real-graph finding test) |
| M7 `catalog.ts`: `origin` key added to each treatment | `catalog.test.ts` (33) | killed: 2 failed |
| M8 `integrity.ts`: error message written to the log | `tests/api` (103) | killed: 2 failed |
| M9 `composition.ts`: accepted origins taken from an argument when given | production-composition (20) | killed: 1 failed |

All 9 mutants killed. Limits: one-spot edits; they do not prove absence of other defects. M6 is killed by exactly one test (the real-graph finding test), which is the intended gate for a contaminated production entry; the synthetic negatives prove the checker itself.

#### OPEN / NOT IMPLEMENTED / NOT VERIFIED

1. NOT IMPLEMENTED (B / C): estimate service and `POST` route, request layers 0-5, 409 body, `exactly one readItemStates` content-cache contract, privacy log/dump tests (AC-016e, AC-016n), AC-019a/b/d, AC-020a, AC-021a-c, AC-021h-m, AC-006f/g/i, AC-010d, AC-011f/m-p. AC-021e is only half closed. M5+ (kiosk), M7 (admin API, auth), DB adapter, deployment, merging, committing.
2. Production data does not exist: every slug is 404 on the operating composition. Operating catalog/options behaviour with real clinics is NOT VERIFIED (only the TEST composition exercises it).
3. `silentLog` is the production sink, so production 500s leave no trace. A stderr sink is a small `src/app` addition (entries are already free of patient fields); not done because nothing runs in production yet. Decision for the orchestrator.
4. `src/app/services.ts` holds a per-process module singleton over an in-memory repository; with several server workers each would hold its own empty store. Irrelevant while the store is empty; a DB adapter replaces it.
5. `next-env.d.ts` is generated and untracked (not gitignored). `tsconfig.json` keeps Next's required additions; if the orchestrator wants to keep Next-specific options out of the shared config, that is a separate decision (Next re-adds them on build).
6. The new files were written with LF and the working tree uses CRLF (`core.autocrlf=true`); Git normalizes on commit (warnings only).
7. Lint: no lint script and no `moai` CLI on this machine (same as M3). NOT VERIFIED: CI; platforms other than Windows 11 with Node 24.19.0; behaviour under `next dev`; real concurrency.
8. Spec points noticed while implementing (for the document owner): (a) DD-19 catalog example shows `catalogVersion` as a string only and does not say what an unpublished catalog returns (decision 4); (b) DD-19 does not define the `baseFees[]` item shape or how `priceCondition` is composed (decisions 5, 6); (c) DD-19 `order` is not tied to a field (decision 7); (d) design.md DD-19 lists no behaviour for a scope whose bundle has no availability record (decision 9 treats it as an integrity defect); (e) the 기획서 §3 4th-generation period is a sentence (`2021.07.01부터의 4세대 계약`), not a half-open range like the others; the card carries it verbatim.

### M4.B 계산 요청 POST …/estimate: 요청 검증의 층·줄 조립·묶음 읽기·서류 입력·출처 요약, 2026-10-19

**Scope.** M4 step B (cycle_type = tdd) on branch `feature/SPEC-REIMBURSEMENT-001-m4-api` on top of M4.A (`144e733`), not committed by this step. Built: `POST /api/clinics/{slug}/estimate` end to end through the real route export, with the request layers 0-5 of DD-19 in the exact order (404, 400, 422, 409, 422, compute); the single body reader that reads only the six contract properties; the 409 body of DD-14; assembly of the engine input from the clinic's current published data; the pre-engine guard for the four server responsibilities (a)-(d); the bundle read split into content / structure check / fresh state composition; engine-rejection and data-defect mapping to HTTP 500; `deriveDocuments` input; response `versions` and the `origin` summary; the injected reference date (`ApiServices.today`). NOT built here (step C): the bundle-content cache and the eight cache-hit conditions (AC-011m..p), the privacy/log/dump tests (AC-016e, AC-016n). The structure is ready for C: `loadBundleContent(repo, bundleId)` is the only function C needs to wrap with a cache keyed by (bundle id, content hash); `composeBundleSnapshot` reads the item states fresh, exactly once, on every request. Owner decisions (DB deferral, in-memory repository only, `OPERATING` only in the operating composition, no external call) are intact. No file under `src/engine/**`, no existing M3 `src/server/**` module outside `src/server/api/**`, `src/server/composition.ts`, no existing file under `tests/engine/**`, `tests/boundary/**`, `tests/server/**` was edited.

#### What was built

| File | Change |
|------|--------|
| `src/app/api/clinics/[slug]/estimate/route.ts` | New. Thin `POST` (`params` is a Promise); passes `() => request.json()` to the handler; reads nothing else from the request |
| `src/server/api/estimate.ts` | New. `handleEstimate` (layers 0-5, 409/422/200 responses) and the compute path (`calculate`): lines, bundle, `estimate()`, `selectDocumentRuleSet()` + `deriveDocuments()`, `versions`, origin summary |
| `src/server/api/estimate-request.ts` | New. `parseEstimateRequest` (layers 1-2) and `CONTRACT_FIELDS`; reads exactly the six property names, never enumerates the body |
| `src/server/api/estimate-lines.ts` | New. `resolveLines` (lines from the current published catalog; projection.ts conversions) and `assertLineAssembly` (guard (a)-(d)) |
| `src/server/api/estimate-versions.ts` | New. `versionsMatch`, `versionMismatchBody` (DD-14 409 body, `priceChanged`, `ruleChanged`, `treatmentsUnpublished`) |
| `src/server/api/bundle-content.ts` | New. `loadBundleContent` (immutable content, the future cache seam), `assertBundleStructure`, `composeBundleSnapshot` (one `readItemStates` per call, projection.ts composition) |
| `src/server/api/bundle-ref.ts` | New. `readBundleRef`: scope + availability read shared by options and estimate (extracted from options.ts) |
| `src/app/clock.ts` | New. `seoulDate`, `systemToday`: the only place in `src/app` that reads the system clock |
| `tests/api/estimate-layers.test.ts` (120), `estimate-compute.test.ts` (45), `estimate-integrity.test.ts` (58), `estimate-body-access.test.ts` (12), `bundle-content.test.ts` (17), `clock.test.ts` (11), `estimate-helpers.ts`, `post-helpers.ts` | New. Integration tests call the REAL `POST` export; the services come from the TEST composition through the existing `vi.mock` of `src/app/services` |
| `tests/boundary/estimate-surface.test.ts` (10) | New boundary file (nothing existing edited): the estimate path is inside the production-entry graph with 0 fixture/test paths, the route is thin, no outside-call identifiers or network modules, `Date` only in `src/app/clock.ts` and not in `src/server/api/**` / `composition.ts` |
| `tests/fixtures/server/estimate-world.fixture.ts` | New. World builders that go through the real services (catalog publish, draft, submit, approve by another RV, bundle publish, PO scope): `buildWorld`, `originWorld`, `specOf`, `requestBody` |
| Changed M4.A files (justified, see below) | `src/server/api/services.ts`, `src/server/composition.ts`, `src/app/services.ts`, `src/server/api/integrity.ts`, `src/server/api/options.ts`, `src/server/api/catalog.ts`, `tests/fixtures/server/api-composition.fixture.ts`, `tests/api/production-composition.test.ts` |

Changes to M4.A files (file, reason, blast radius):
1. `src/server/api/services.ts`: `ApiServices` gains `today: () => string` (the injected reference date). Required by the estimate path. Blast radius: every `ApiServices` producer (the two compositions).
2. `src/server/composition.ts`: `OperatingDeps` gains required `today`; the frozen services carry it. Accepted origins are still fixed (`OPERATING` only, extra arguments ignored). Blast radius: callers of `createOperatingServices` (`src/app/services.ts` and 5 calls in `tests/api/production-composition.test.ts`).
3. `src/app/services.ts`: passes `systemToday` from the new `clock.ts`. Still exports only `getApiServices`.
4. `src/server/api/integrity.ts`: the closed code list grows (BUNDLE_MISSING, ITEM_CONTENT_MISSING, ITEM_STATE_MISSING, BUNDLE_STRUCTURE_INVALID, ASSEMBLY_x4, ORIGIN_MAPPING_UNRESOLVED, ENGINE_<rejection>); no existing code changed. Blast radius: none for existing callers (type union only).
5. `src/server/api/options.ts`: the "scope points to a bundle without availability" check moved into the new shared `readBundleRef` (behaviour identical, same error code); options tests unchanged and green. Not strictly required, done so the invariant has one definition.
6. `src/server/api/catalog.ts`: `SETTING_OF` is now exported (the document derivation's `clinicSetting` uses the same table). One keyword.
7. `tests/fixtures/server/api-composition.fixture.ts`: `TEST_TODAY` and `createTestServices({ today? })` (default fixed date `2026-10-15`); `tests/api/production-composition.test.ts`: the five `createOperatingServices(...)` calls pass a fixed `today` (the contract change forces it). No assertion changed.

#### Request layers (DD-19 "요청 검증의 층") as implemented

| Layer | Condition | Response | Reads (read spy) |
|-------|-----------|----------|------------------|
| 0 | no clinic for the slug (exact match) | 404 `CLINIC_NOT_FOUND` | `listClinics` once; the body is not even read |
| 1 | body not JSON / not an object / a field missing / wrong JSON type / `insurerType` or `cause` outside the enum | 400 `INVALID_REQUEST` | none beyond layer 0 |
| 2 | `generation` a string outside the five (checked first), `treatmentIds` empty | 422 `UNSUPPORTED_GENERATION`, 422 `NO_TREATMENT_SELECTED` | none beyond layer 0 |
| 3 | `catalogVersion` or `ruleBundleVersion` differs from the clinic's current value | 409 `VERSION_MISMATCH` + DD-14 body | scope (1), bundle availability (1), catalog reads; never item states, bundle record or item content |
| 4 | a selected id is not in the clinic's current published catalog (`readPublishedCatalog`, the same definition as the catalog route; inactive, other clinic, base-fee id, unknown id) | 422 `TREATMENT_NOT_PUBLISHED` | same as layer 3 |
| 5 | compute | 200 (also `ON_HOLD`) | no scope: none; `SUSPENDED`: availability only; `ACTIVE`: bundle record 1, item content per item, `readItemStates` exactly 1 |

#### Decisions and assumptions (`[not in docs]` = design / acceptance are silent; the orchestrator moves these into design.md)

1. **`[not in docs]` Which server defects are HTTP 500 (technical decision).** Request rejections are values (404/400/422/409). All of these throw `ServerIntegrityError` and become 500 `{"error":"INTERNAL_ERROR"}` with no body detail and a log entry of exactly `{event: 'SERVER_INTEGRITY_ERROR', code}`: (a) a selected treatment has no line (`ASSEMBLY_SELECTED_LINE_MISSING`), (b) a line for an unselected treatment is in the input (`ASSEMBLY_UNSELECTED_LINE_PRESENT`), (c) one id in both `lines` and `baseFeeLines` (`ASSEMBLY_LINE_IN_BOTH_ARRAYS`), (d) `isBaseFee` disagrees with the array (`ASSEMBLY_BASE_FEE_FLAG_MISMATCH`); the `ACTIVE` bundle structure defect (`BUNDLE_STRUCTURE_INVALID`); missing bundle record / item content / item state / availability (`BUNDLE_MISSING`, `ITEM_CONTENT_MISSING`, `ITEM_STATE_MISSING`, `BUNDLE_AVAILABILITY_MISSING`); the five catalog reference defects of M4.A; and every engine rejection (`ENGINE_INVALID_NUMERIC_INPUT`, `ENGINE_INPUT_INTEGRITY_VIOLATION`; also `ENGINE_UNSUPPORTED_GENERATION` and `ENGINE_NO_TREATMENT_SELECTED`, which can only happen if the server's own layer 2 was bypassed). Any other thrown error is also 500 (`UNEXPECTED_ERROR`). The guard runs before the engine: in all four tests `estimate()` is not called.
2. **`[not in docs]` How the four defects are injected without a test hook in production code.** (a)-(d) cannot be produced by repository data: `readPublishedCatalog` derives the selected lines from the catalog entries, the repository refuses an id that is both a treatment and a base fee, and projection.ts fixes `isBaseFee`. So the tests `vi.mock` the lower-level module `src/server/api/estimate-lines` with a pass-through wrapper that calls the real `resolveLines` and then corrupts exactly one thing (drop a line / add a line of an unselected treatment / add the same id to the other array / flip one `isBaseFee`); the real guard runs on the result. A control test with an uncorrupted wrapper returns 200. For the bundle structure (i)-(iii) the same technique is used on `src/server/api/bundle-content` (`loadBundleContent`). The engine rejections and the missing-reference defects use real repository data corrupted without publish validation (`putTreatmentVersion`, `putCatalogVersion`, `saveClinic`) or the existing `repoWith` Proxy.
3. **`[not in docs]` Structure check target.** The check runs on the loaded `BundleContent` (the cacheable value), after the scope / `SUSPENDED` decisions, so it also protects a future cached copy: `profiles` and `mappings` must be arrays, every item (a sparse hole counts as a defect) must be a non-null non-array object, and so must its `content` (a record whose `content` is `null` would otherwise be spread into an empty profile and hide behind another hold code). `[]` is not a defect (engine `PROFILE_ABSENT` / `MAPPING_ABSENT`). `documentRuleSet` is out of scope as the SPEC says. `SUSPENDED` and no-scope never call the loader (counted by the test wrapper) and read no item.
4. **`[not in docs]` Suspended bundle snapshot.** For `SUSPENDED` the engine receives `{id, contentHash: '', status: 'SUSPENDED', profiles: [], mappings: [], documentRuleSet: null}`: the engine reads only `status` there (DD-04) and the contract is that no bundle record is read, so there is no real hash to put; it never appears in a response.
5. **`[not in docs]` 409 body details.** `latest.catalogVersion` is `null` for a clinic that never published (every request is then a 409, because `catalogVersion` is a required string). `ruleChanged` = requested `ruleBundleVersion` differs from the current scope bundle (also `null` vs string). `treatmentsUnpublished` = the requested ids (de-duplicated, request order) that are not in the current published catalog, other clinics' ids included (DD-14). `priceChanged`: false if the requested `catalogVersion` is the current one; otherwise the requested catalog is read; if it is unknown or belongs to another clinic the answer is `true` (no price equality can be shown and no other clinic's data is compared); else `true` iff a treatment (by `treatmentId`) or a common base fee (by `baseFeeId`) present in both catalogs has a different amount. Adding or removing treatments or registering a base fee alone is `false`. Dangling references in the requested catalog are server defects (`TREATMENT_VERSION_MISSING` / `BASE_FEE_MISSING`).
6. **`[not in docs]` Reference date.** `ApiServices.today()` returns `YYYY-MM-DD` and is passed to the engine as `at` and to `selectDocumentRuleSet`. Production injects `systemToday` (`src/app/clock.ts`): the Asia/Seoul calendar date by a fixed +9 h shift (Korea has no daylight saving), because rule validity is a date and the clinics are in Korea; the UTC date would be a day behind from 00:00 to 09:00 KST. `src/server` never reads a clock.
7. **`[not in docs]` Origin summary.** "Used" = every line of the result, the profile in `basis.profile`, the mapping that decided every non-hold line, and the document rule set when `documents.state === 'AVAILABLE'`. The result does not say which mapping decided a line, so the engine's own `resolveMapping` is called again with the same arguments (same function, same input, no new judgement); a decided line whose mapping cannot be resolved is a server defect (`ORIGIN_MAPPING_UNRESOLVED`, tested with a wrapper that fails only the call after `estimate()`). Precedence TEST_FIXTURE, then DEMO, then OPERATING is the reverse of the closed list `ORIGINS` in `validate/shape.ts` (declaration order OPERATING, DEMO, TEST_FIXTURE), because `tests/server/no-seed-paths.test.ts` (existing, unedited) allows those origin names as source tokens only in that file; a test pins the declaration order. Unused items do not count (an unselected treatment's mapping, a rule set when the whole result is on hold).
8. **`[not in docs]` Documents.** `deriveDocuments` is called on every compute (the engine itself returns `null` for `ON_HOLD`); its `treatments` are `{documentFlags}` copies of all selected treatments, de-duplicated by id, confirmed exclusions included, base-fee lines never; `ruleSet` comes from the engine's `selectDocumentRuleSet(bundle, ctx)`; `clinicSetting` from the existing `SETTING_OF` table.
9. **`[not in docs]` Body reading.** The handler asks for the body only after the clinic exists; any failure of `request.json()` is a 400. A body that is not a plain object (`null`, array, scalar) is a 400. Duplicates in `treatmentIds` are removed keeping the first occurrence order; there are no quantities. Only `POST` is exported, so other methods get Next's 405 (seen over HTTP, below).
10. **`[not in docs]` Catalog data defects reach the engine.** If a catalog lists one treatment twice, `resolveLines` keeps both lines (no filtering, no choosing): identical copies collapse in the engine (200, total unchanged), different copies are `INPUT_INTEGRITY_VIOLATION` (500). Same for base fees.
11. **Shared composition (brief: reuse or extract).** The state composition (`state`, `approver`, `approvedFingerprint` from the fresh state record) is the single implementation in `projection.ts` (`toEngineProfile/Mapping/DocumentRuleSet`). The 10-line kind dispatch of readiness `assembleBundle` is not extracted (it throws `DomainError` and reads in a different order; editing M3 `readiness.ts` was not necessary). Instead `bundle-content.test.ts` proves the API composition deep-equals `loadReadinessSnapshot(...).bundles[...]` and the fixture `engineSnapshotOf(...)` for a real published bundle, and that changing an item state is visible to a second composition over the same content object.
12. **Privacy groundwork (not closing AC-016e / AC-016n).** The log entry type stays `{event, code}`; the route reads only `json()` (boundary test); `x-request-id` / headers / query are never read. The cache dump and the log assertions with patient fields belong to step C.

#### AC evidence (closing: AC-006f, AC-006g, AC-006i, AC-010d, AC-011f, AC-019a, AC-019b, AC-019d, AC-020a, AC-021a, AC-021b, AC-021c, AC-021e, AC-021h..m)

| AC | Test file / describe | What is checked |
|----|----------------------|-----------------|
| AC-006f | `estimate-layers.test.ts` / `AC-006f · AC-021a 층 0`, `층 1: 요청 구조`, `층 2: 지원 세대와 빈 치료` | 404 incl. near-miss slugs and "body not read"; 7 non-object bodies + no body, 6 missing fields, 23 wrong-type cases, 8 enum-outside cases all 400 (never 422); 5 non-enum generation strings and empty list 422; both together gives `UNSUPPORTED_GENERATION`; the five generations pass; enum codes equal the options cards; `ruleBundleVersion: null` accepted |
| AC-006g | `estimate-compute.test.ts` / `AC-006g 원인만 다른 세 요청은 result 블록이 바이트까지 같다` | INJURY / ILLNESS / UNKNOWN: `JSON.stringify(result)` identical, the `estimate()` input JSON identical, `deriveDocuments` receives the three causes in order, documents differ (SINGLE_CAUSE vs UNKNOWN_CAUSE) |
| AC-006i | `estimate-integrity.test.ts` / `(1)` x2, `(2)`, `(3)`, `저장소 자료가 서로 맞지 않으면` | (1) invalid line amounts (-1, 1.5, NaN, Infinity, 1,000,000,001, beyond safe integer) and an invalid base-fee amount, conflicting duplicate treatment and base-fee lines: 500, body exactly `{error}`, no amount / id / stack text, log exactly `[{event, code}]`; an unselected invalid treatment never reaches the engine (200); identical duplicate lines collapse (200, total 25,000). (2) the four server responsibilities each (a, b, c, d-1, d-2) 500 with `estimate()` not called, plus a control and "4xx layers win". (3) structure (i)-(vi): 22 corrupt `ACTIVE` cases (null / scalar / array / undefined items, null or array `content`, `profiles` and `mappings` each null / undefined / object / string / number) 500 with no item-state read; `SUSPENDED` (4 corruptions) and no-scope keep their hold with the loader never called and 0 item reads; `[]` keeps `PROFILE_ABSENT` / `MAPPING_ABSENT`; no document rule set keeps `RULES_UNAVAILABLE`; missing bundle / item content / item state / availability / catalog references |
| AC-010d | `estimate-compute.test.ts` / `AC-010d 응답 origin ...` | all `OPERATING` gives `OPERATING` (documents `AVAILABLE`); each of the 7 slots (profile, 3 mappings, rule set, treatment lines, base-fee line) alone `TEST_FIXTURE` gives `TEST_FIXTURE`; DEMO lines give `DEMO`; mixed gives `TEST_FIXTURE`; unused mapping / unused rule set / suspended bundle do not count; precedence pinned to `ORIGINS` order |
| AC-011f | `estimate-compute.test.ts` / `AC-011f 묶음 중지와 복구 시나리오` | (1) `ESTIMATED`, (2) domain-service suspend: same request is 200 `ON_HOLD`, all lines `RULE_BUNDLE_SUSPENDED`, `hospitalPayment` 25,000, `ruleBundleStatus` `SUSPENDED`, (3) new bundle + scope re-assignment: old version 409 `ruleChanged` with `latest.ruleBundleStatus` `ACTIVE`, new version `ESTIMATED`; clinic B (own bundle) response is byte-identical before and after |
| AC-019a | `estimate-body-access.test.ts` (both describes) | Proxy over the body records `get/has/ownKeys/getOwnPropertyDescriptor/set/define/delete`: only the six contract names are touched, no enumeration, also for rejected bodies; throwing getters on 27 foreign names are never read (unit and through the real route with a fake request whose only allowed member is `json()`); a body full of forged prices, ratios, clinic ids, lines, results, fingerprints, class, quantities, `__proto__` gives a response byte-identical to the clean request and the server's own totals |
| AC-019b | `estimate-layers.test.ts` / `AC-019b · AC-021l ...` | other clinic's id, inactive, never-published, removed-by-v2, base-fee id, unknown id: 422 `TREATMENT_NOT_PUBLISHED`, no other-clinic name or price in the body |
| AC-019d | `estimate-compute.test.ts` / `AC-019d ...` | (a) only the confirmed-excluded treatment carries imaging: the document line is required; the actual `deriveDocuments` input holds both selected treatments' flags and no base-fee entry; (b) the base-fee line carrying imaging (pass-through wrapper on `toEngineBaseFeeLine`) does not make the line required, 2 treatments in the input; (c) `treatmentIds` order swapped gives byte-identical `documents`; `ON_HOLD` gives `documents: null`; no rule set gives `RULES_UNAVAILABLE` |
| AC-020a | `estimate-layers.test.ts` / `AC-020a 409 VERSION_MISMATCH 본문` | exact DD-14 body for stale catalog / price-only republish / treatment removal / base-fee price / stale bundle / both / null vs string / no scope / suspended; no `result`, `versions`, `documents`; read set limited to scope, availability, catalog (no item, no bundle record) |
| AC-021a | `estimate-layers.test.ts` / `AC-021a 공개 오류 표 전체` | one row per public status/code: 404, 400 (5 kinds), 409, 422 x3, 500 (engine `INVALID_NUMERIC_INPUT` from corrupted stored data); body exactly `{error}` (409 has the DD-14 shape), `no-store`, `application/json` |
| AC-021b | `estimate-compute.test.ts` / `AC-021b 보류도 HTTP 200 이다` | mapping absent, profile absent (cell outside), no scope, suspended: 200 `ON_HOLD`, `hospitalPayment` number, payouts null, `documents` null |
| AC-021c | `estimate-compute.test.ts` / `AC-021b · AC-021c · AC-021e 성공 응답` | `versions` {catalogVersion, ruleBundleVersion, ruleBundleStatus, profile {id, version, origin}} and `origin`; `result` and `documents` equal an independent real-engine computation (same module, different assembly path); literal amounts 25,000 / 24,000 / 1,000 |
| AC-021e (estimate half; options half closed in A) | all three estimate test files, `expectNoStoreJson` | `Cache-Control: no-store` and `application/json` on 200, 400, 404, 409, 422, 500; also over real HTTP (smoke) for 404 |
| AC-021h | `estimate-layers.test.ts` / `AC-021h ...` | invalid `cause` + stale catalog / stale bundle / both: 400 (not 409), no `latest` / `changes`, read spy shows only the slug lookup; invalid cause + bad generation or empty list is still 400 |
| AC-021i | `AC-021i ...` | unsupported generation + stale version: 422, no layer 3 reads |
| AC-021j | `AC-021j ...` | empty list + stale version: 422 `NO_TREATMENT_SELECTED`, no layer 3 reads; with bad generation `UNSUPPORTED_GENERATION` first |
| AC-021k | `AC-021k ...` | v1 (T1, T2) then v2 (T1): 409 with `treatmentsUnpublished` [T2]; plus clinic 2 id gives [T2, Z] in request order, de-duplicated; all still published gives [] and 409; inactive treatment listed |
| AC-021l | `AC-019b · AC-021l ...` | the three cases of the AC (+ more) give 422; one stale version turns it into 409; the 422 path reads no item |
| AC-021m | `AC-021m ...` | suspended + current versions: 200 `ON_HOLD` as in the AC; + unpublished id: 422; + stale version: 409 with `latest.ruleBundleStatus` `SUSPENDED` |

Not closing here (step C): AC-011m, AC-011n, AC-011o, AC-011p, AC-016e, AC-016n. Evidence only, not closed: AC-019c (the call spies show the API calls the engine module's `estimate` / `deriveDocuments` / `selectDocumentRuleSet`), AC-021d (`estimate-surface.test.ts`: estimate path inside the production graph with 0 fixture paths, no outside-call identifiers or network / process modules, `Date` only in `src/app/clock.ts`).

#### RED before GREEN (exact statement)

The test files, fixtures, and the `today` contract change of the two A test files were written first. RED run (`.moai/state/verify/M4.B/red.txt`): `Test Files 6 failed | 4 passed (10)`, `Tests 103 passed (103)`. The 6 failing files (5 new estimate test files and the boundary file) failed at import / collection (`Cannot find module .../estimate/route`; the boundary file because the route does not exist), so this RED shows that the implementation did not exist, not that individual assertions failed; the 103 passing tests are the unchanged M4.A tests. After the implementation, the first run (`green0.txt`) was `Test Files 3 failed | 7 passed (10)`, `Tests 4 failed | 351 passed (355)`; all 4 failures were defects in my tests, not in `src`, and were fixed in the tests: the Proxy recorded Promise's own `then` lookup; the no-fee world still asked for a base-fee mapping; a JSON text search for `"cause"` hit the document-rule data inside the bundle; the `Date` boundary assertion was broader than the existing server-imports rule. Because most assertions passed on the first run, the mutation table below is the evidence that they can fail. Tests added afterwards (`bundle-content.test.ts`, the origin-order pin, price-change cases, `ORIGIN_MAPPING_UNRESOLVED`) were written against the finished code.

#### Evidence (outputs under `.moai/state/verify/M4.B/`, gitignored; every vitest run with `--maxWorkers=4`, sequential, on the final tree)

```
$ npx vitest run tests/api tests/server tests/boundary --maxWorkers=4   -> exit 0   (final-1-api-server-boundary.txt)
 Test Files  61 passed (61)
      Tests  3362 passed (3362)        (M4.A: 54 files / 3089 tests; +7 files, +273 tests)
$ npx vitest run tests/engine tests/boundary --maxWorkers=4              -> exit 0   (final-2-engine-boundary.txt)
 Test Files  38 passed (38)
      Tests  1600 passed (1600)        (M1/M2 regression 36 files / 1544 tests unchanged + 2 boundary files with 46 + 10 tests)
$ npx tsc --noEmit                                                       -> exit 0   (final-3-tsc.txt, empty output)
$ npx vitest run --coverage --maxWorkers=4                               -> exit 0   (final-4-coverage.txt)
 Test Files  93 passed (93)
      Tests  4663 passed (4663)
$ node .moai/state/m4/covsum.mjs coverage/coverage-summary.json
 engine: statements 652/652, branches 558/558, functions 145/145, lines 606/606
 server: statements 1515/1515, branches 839/839, functions 401/401, lines 1416/1416
 other (= src/app): statements 13/13, branches 0/0, functions 7/7, lines 12/12
 total: Statements 100% (2180/2180), Branches 100% (1397/1397), Functions 100% (553/553), Lines 100% (2034/2034)
$ npx next build                                                         -> exit 0   (final-5-next-build.txt)
 Next.js 16.4.2 (Turbopack); Compiled successfully; Running TypeScript ... Finished; routes: /_not-found, /api/clinics/[slug]/catalog, /api/clinics/[slug]/estimate, /api/clinics/[slug]/insurance/options
$ node .moai/state/verify/M4.B/smoke.mjs (next start -p 3199, empty operating store)   (smoke.txt)
 POST estimate unknown clinic -> 404 {"error":"CLINIC_NOT_FOUND"} cache-control: no-store, content-type: application/json
 POST estimate unknown clinic, body "{not json" -> 404 (clinic is checked before the body)
 GET  estimate -> 405 (only POST is exported)
 GET  options  -> 404 no-store
```

Per-file coverage of the new files is in `final-4-coverage-files.txt` (all 100% on statements, branches, functions, lines). No coverage exclusions, no `skip` / `only` / disabled tests. The smoke server was stopped afterwards (port 3199 closed).

#### Mutation spot checks (scripted one-spot edit of the final tree, restored from a copy after each run; every restore verified identical; script `mutate.mjs`, output `mutations.txt`; suite = `tests/api` + `tests/boundary/estimate-surface.test.ts`, 376 tests)

| Mutation | Result |
|----------|--------|
| B1 layer 4 (published-id check) moved before layer 3 (version compare) | killed: 7 failed |
| B2 body reader enumerates keys (`Object.keys(body)`) | killed: 6 failed |
| B3 `SUSPENDED` pre-decision removed (bundle content and item states are read) | killed: 2 failed |
| B4 bundle structure check call removed | killed: 22 failed |
| B5 `cause` also passed to `estimate()` | killed: 2 failed |
| B6 base-fee lines also passed to `deriveDocuments` | killed: 2 failed |
| B7 confirmed-excluded treatment dropped from the document input | killed: 2 failed |
| B8 engine rejection turned into a 0-won result instead of 500 | killed: 12 failed |
| B9 `readItemStates` called twice per request | killed: 3 failed |
| B10 pre-engine line-assembly guard call removed | killed: 5 failed |
| B11 guard check (c) (id in both arrays) disabled | killed: 1 failed |
| B12 `treatmentIds` de-duplication removed | killed: 2 failed |
| B13 mapping origins left out of the origin summary | killed: 5 failed |
| B14 reference date fixed instead of the injected `today()` | killed: 1 failed |
| B15 layer 2 order swapped (empty list before unsupported generation) | killed: 2 failed |
| B16 `priceChanged` always true on version difference | killed: 6 failed |
| B17 `deriveDocuments` always gets `UNKNOWN` instead of the request's cause | killed: 3 failed |

All 17 mutants killed. Limits: one-spot edits; they do not prove absence of other defects. B11 and B14 are each killed by a single test.

#### OPEN / NOT IMPLEMENTED / NOT VERIFIED

1. NOT IMPLEMENTED (step C): bundle-content cache keyed by (bundle id, content hash) and the eight cache-hit conditions (AC-011m..p, including re-approval semantics over HTTP), privacy tests for log / repository writes / cache dump / `requestId` in body, header and query (AC-016e, AC-016n). M5+ (kiosk), M7 (admin API, auth), DB adapter, deployment, merging, committing.
2. Production data does not exist: every slug is 404 on the operating composition (over real HTTP too). The estimate path with real clinics, real prices, real rules and real approvers is NOT VERIFIED; only the TEST composition exercises it.
3. `silentLog` is still the production sink, so a production 500 leaves no trace (carried over from M4.A, decision for the orchestrator).
4. Spec ambiguities noticed (for the document owner): (a) design.md:825 (DD-14 processing order, step ④) lists the clinic's scope, bundle snapshot, bundle status and the current lifecycle state of the bundle's items as read before the version comparison, while AC-021h..j only forbid reads on the 400/422 layers and the M4 brief says item states are read on the compute path only; implemented as the brief says (409 and layer-4 422 read scope, availability and catalog only). (b) DD-19 does not say what the 409 `latest.catalogVersion` is for a clinic with no published catalog, nor how `priceChanged` is derived (decision 5). (c) DD-03 "입력 검증의 책임 분담" and DD-19/AC-006i still mark (a)-(d), the structure check and the engine-rejection mapping as "구현 안 됨 — M4"; they are implemented and tested now. (d) DD-19 example shows `"basis": {}`; the response carries the engine's real `basis` (rule bundle id, profile id / version / origin / policy sources, formula steps).
5. NOT VERIFIED: CI; platforms other than Windows 11 with Node 24.19.0; `next dev`; real concurrency (the in-memory repository is synchronous); behaviour under very large bodies (no size limit is added; `request.json()` is the framework default); lint (no lint script and no `moai` CLI on this machine, as in M3 / M4.A).
6. The new files were written with LF and the working tree uses CRLF (`core.autocrlf=true`); Git normalizes on commit (warnings only). `git diff --check` printed only those line-ending warnings, exit 0.

### M4.C 묶음 내용 캐시·캐시 적중 계약 여덟 조건·로그/저장소/메모리 개인정보 점검, 2026-10-19

**Scope.** M4 step C (cycle_type = tdd) on branch `feature/SPEC-REIMBURSEMENT-001-m4-api` on top of M4.B (`0558a18`), not committed by this step. Built: the bundle CONTENT cache at the `loadBundleContent` seam, keyed by (bundle id, content hash), created by the composition and carried in `ApiServices.bundleCache`; fresh per-request reads of item state / approver / approved fingerprint (exactly one `readItemStates` per used bundle) and of bundle availability, also on cache hits; integration tests through the real `POST` route export for the eight cache-hit conditions of plan.md M4 and for AC-011m..p; privacy tests for AC-016e and AC-016n over the server log, the repository dump, the content cache, the service object and the exports of every `src/server` / `src/app` module, with a marker `requestId` in the body, in the `x-request-id` header and in the query string; a source-level scan for module-scope mutable state; one test file that asserts both the response `Cache-Control: no-store` and the internal content cache; evidence-only tests for AC-019c and AC-021d; a one-comment fix. NOT built here: M5+ (kiosk), M7 (admin API, auth), a DB adapter, deployment, merging, committing. Owner decisions (DB deferral, in-memory repository only, `OPERATING` only in the operating composition, no external call) are intact. No file under `src/engine/**`, `tests/engine/**`, existing files of `tests/boundary/**` or `tests/server/**`, and no M3 `src/server/**` module outside `src/server/api/**` and `src/server/composition.ts` was edited.

#### What was built

| File | Change |
|------|--------|
| `src/server/api/bundle-content-cache.ts` | New. `BundleContentCache` (`lookup(id, hash)`, `store(content)`, `entries()`), `createBundleContentCache()`. Instance state only (a `Map` inside the factory closure), no module state, no invalidation method. Stores a deep clone, deep-frozen; keeps the first copy of a key; `entries()` returns a fresh frozen array of frozen entries |
| `src/server/api/bundle-content.ts` | `loadBundleContent(repo, bundleId, cache)`: reads the bundle record every time (to learn the content hash), looks up (id, hash); on a hit returns the cached content without reading item content; on a miss reads the item content and stores it only if the structure is valid. `assertBundleStructure` is now `isBundleStructureValid` + the same throwing wrapper (behaviour unchanged) |
| `src/server/api/services.ts`, `src/server/composition.ts` | `ApiServices.bundleCache` (required). `createOperatingServices` creates a new cache per call; there is no parameter, setter or environment hook for it (an extra `bundleCache` argument is ignored, asserted) |
| `src/server/api/estimate.ts` | `readBundle(services, ref)` passes `services.bundleCache`; unused `Repository` import removed; one comment updated |
| `src/server/api/estimate-lines.ts` | Doc comment only (item 7 of the step prompt): the request parser de-duplicates treatment ids, not the engine |
| `tests/api/bundle-content-cache.test.ts` (17) | New. Cache unit tests, `loadBundleContent` hit / miss reads, key = (id, hash), structure-invalid content not cached, composition creates the cache |
| `tests/api/estimate-cache-contract.test.ts` (39) | New. The eight conditions (1)..(8) through the real `POST`, plus `no-store` vs internal cache, plus cache size |
| `tests/api/estimate-cache-ac011.test.ts` (13) | New. AC-011m, AC-011n, AC-011o, AC-011p |
| `tests/api/privacy.test.ts` (27) | New. AC-016e, AC-016n, plus controls for the dump scanner |
| `tests/api/cache-contract-helpers.ts` | New helper (not a test file): call-counting cache, `send` (one request with its own read counts and engine input), two-clinic world, re-approval helpers |
| `tests/boundary/server-state.test.ts` (20) | New boundary file. Module-scope mutable state scan with negative tests; cache module is in the production entry graph |
| `tests/boundary/engine-module-identity.test.ts` (7) | New boundary file. Evidence only for AC-019c and AC-021d |
| `tests/fixtures/server/api-composition.fixture.ts`, `tests/api/post-helpers.ts`, `tests/api/bundle-content.test.ts` | Contract-forced edits, see below |

Changes to earlier-step files (file, reason, blast radius):
1. `src/server/api/bundle-content.ts` (B): `loadBundleContent` gets a required third parameter. Blast radius: its one caller (`estimate.ts`) and `tests/api/bundle-content.test.ts` (5 calls now pass `createBundleContentCache()`; no assertion changed). The B hook in `estimate-integrity.test.ts` forwards `...args`, so it needed no edit.
2. `src/server/api/services.ts` and `src/server/composition.ts` (A/B): the new required `bundleCache` field. Blast radius: the two compositions only (`createTestServices` and `createOperatingServices`).
3. `src/server/api/estimate.ts` (B): signature of the private `readBundle`; no behaviour change besides the cache.
4. `tests/fixtures/server/api-composition.fixture.ts` (existing fixture, edit forced by the new field): `createTestServices` accepts an optional `bundleCache` (default a fresh cache). `tests/api/post-helpers.ts`: `callPostRequest` added.

#### Decisions and assumptions (`[not in docs]` = design / acceptance are silent; the orchestrator moves these into design.md)

1. **`[not in docs]` How the content hash is known for the key, and what a hit reads.** The bundle id alone cannot be the key (plan.md (1) says (bundle id, content hash)), and the hash lives only in the bundle record. So every compute request reads the bundle record once (`getRuleBundleVersion`, an immutable write-once record) to get (id, hash), then looks the pair up. On a hit the item version content (`getItemVersion` x N) is not read; on a miss it is read and stored. Consequence worth knowing: a cache hit still costs one repository read of the bundle record; what the cache saves is the N item-content reads. Reason for keeping the record read: a record whose id is unchanged but whose hash differs can never be served from an older entry (tested with a repository wrapper). `SUSPENDED` and no-scope requests never reach the loader (no record read, no lookup); 409 / 422 requests never reach it either.
2. **`[not in docs]` What the cache holds.** plan.md (1) allows caching item version content / hash / header and the bundle version (`id`, `itemRefs`, `contentHash`). The cache stores `BundleContent`: bundle id, content hash and the item version records in reference order (profiles, mappings, rule set; each record carries its own ref, so the `itemRefs` information is there). The bundle record itself (publisher, time) is not stored because it is read each request for the key. Nothing else has a place in the type: no `state`, `approver`, `approvedFingerprint`, availability, clinic rule scope, patient selection or `requestId`.
3. **`[not in docs]` Where the cache lives.** In the service object, created by the composition (`createOperatingServices` makes one per call; production wiring calls it once). No module-level state, no environment or override hook, no setter in production code. The TEST composition may inject a cache (tests only) to count calls or to use a no-cache double.
4. **`[not in docs]` Storage semantics.** `store` keeps a deep clone that is deep-frozen; a second store of the same key keeps the first copy. A hit returns that frozen object, shared between requests. This is safe because `projection.ts` builds the engine items with `structuredClone(record.content)`, so the engine never receives the shared objects (and a frozen copy would make a mutation visible instead of leaking). `entries()` is the read-only inspection point: a fresh frozen array of frozen entries.
5. **`[not in docs]` Only structurally valid content is cached.** A content that fails the B structure check is returned (and then rejected with 500 by `assertBundleStructure`, which still runs on every request, hits included) but never stored, so a repaired record is picked up by the next request instead of failing from a stale entry.
6. **`[not in docs]` Growth, no eviction.** Entries = distinct (bundle id, hash) pairs that some clinic's rule scope pointed at while `ACTIVE`. A request cannot create a key (the id comes from the clinic's scope, not from the request; tested with 40 requests that carry unknown versions: 0 entries). One entry holds the item version records of one bundle (5 in the test world; the real size is NOT VERIFIED because no real bundle exists). The number of entries is bounded by the number of bundle versions that reviewers publish, which is operator-driven, so no eviction is added. If publications grow large, a bound can be added later (OPEN 4).
7. **Re-approval semantics are unchanged.** No M3 lifecycle code was changed. Re-approval leaves the mapping `APPROVED` (line held `MAPPING_UNREVIEWED`) until a bundle containing it is published; tests (5) and "재승인은 자동 게시되지 않는다" prove no request path publishes.
8. **How states are changed in the tests.** Item suspension: `suspendItem`. Mapping `UNDER_REREVIEW`: `triggerReReviewForTarget` (the same system transition catalog publishing calls; used with a different fingerprint so no catalog is published and the versions stay the same, AC-011n) or a real judgement-field catalog publication (scenario (4)(5)(6)). Re-approval: `approve` by a third reviewer. Publication: `publishRuleBundle` with the same item refs. **Exception, not a domain service:** M3 has no service that moves a PROFILE or DOCUMENT_RULE_SET to `UNDER_REREVIEW` (the automatic re-review targets mappings only), so the `UNDER_REREVIEW` variants of AC-011m and AC-011o write the transition with the repository's own `recordItemTransition` (a table-allowed `PUBLISHED -> UNDER_REREVIEW`, approver and fingerprint carried over). The `SUSPENDED` variants use the service.
9. **`[not in docs]` Scenario (4)(5)(6) changes the catalog version.** To make a stale state copy produce a different verdict (plan.md (6): old copy `PUBLISHED` / old approver / old fingerprint gives `MAPPING_UNDER_REREVIEW`, fresh gives `ESTIMATED`) the old fingerprint F1 must differ from the new line fingerprint F2, which requires a judgement-field change and therefore a new catalog version. So after step 2 the request carries the new `catalogVersion`; the bundle id and content hash are unchanged, and nothing in steps 3-5 (re-approval, publication of the same item refs) changes any version. "Versions unchanged / no 409" in plan.md (4) is read as: the re-approval and the publication do not cause a 409.
10. **`[not in docs]` Reading of AC-011n's "another usable candidate".** Two usable candidates for one cell and treatment are ambiguous (`MAPPING_INVALID`, `resolveMapping`), so a second candidate that changes nothing when its state changes must be unusable before and after. The test uses a second candidate whose origin is `DEMO` (not accepted): the response is byte-identical before and after suspending it. (An expired validity window is not constructible: publish validation rejects `OUTSIDE_VALIDITY`.) The contrast case suspends the real candidate and gets `MAPPING_INVALID`.
11. **Privacy proof design.** (a) The collecting log is compared with `[]` after 200 / 4xx paths and with exactly `[{event, code}]` after 500 paths; (b) the repository dump (`exportState`) is deep-equal before and after, and also scanned for unique marker strings; (c) the cache after 15 varied requests deep-equals the cache after one request; (d) a recursive scanner (`deepContains`: strings, object keys, Map keys and values, Set members, byte arrays, cycle-safe) runs over repository, log, cache and the whole service object; its controls show it finds a marker in each of those container shapes; (e) every non-function export of every module under `src/server` and `src/app` is scanned; (f) a Proxy around a real `Request` records every property the handler reads: always exactly `['json']`, for the body, header, query and combined carriers and for 400 / 409 / 422 / 500 responses; (g) a Proxy around the parsed body records the property names read: only the six contract names, `requestId` / `request_id` never, no enumeration. Patient values are distinct valid selections for the 200 grid and unique marker strings for the rejected paths (a unique string cannot occur in rule data, which valid values like `GEN4_C4` do).
12. **Module-scope state scan.** Lexical, at brace depth 0: `let` / `var`, `new Map|Set|WeakMap|WeakSet|Array`, `= []`, `= {}`; anywhere: `static` members, `globalThis`. The real tree has exactly one finding, `let services` in `src/app/services.ts` (the production service singleton; the assertions pin its type to `ApiServices | null` and its only assignment to the `??=` that creates operating services). The scan has negative tests for each rule.
13. **Evidence-only (not closing) AC-019c / AC-021d.** `engine-module-identity.test.ts`: the estimate service imports `estimate`, `deriveDocuments`, `selectDocumentRuleSet`, `resolveMapping` from `src/engine/*`; no file under `src/server` or `src/app` declares a function or constant of those (or related) names; no network / file / process identifier or module in `src/server/api`, `composition.ts`, `src/app`; the cache module has a single type-only import.

#### AC evidence (closing: AC-011m, AC-011n, AC-011o, AC-011p, AC-016e, AC-016n)

| AC | Test file / describe | What is checked |
|----|----------------------|-----------------|
| AC-011m | `estimate-cache-ac011.test.ts` / `AC-011m …` (2) | Cache filled by a first request (`getItemVersion` 5), then profile `SUSPENDED` (service) or `UNDER_REREVIEW` (repository transition): same request gives 200 `ON_HOLD`, all lines `PROFILE_INVALID` / `PROFILE_UNDER_REREVIEW`, `hospitalPayment` 25,000, payouts null, `documents` null, `ruleBundleStatus` `ACTIVE`, same ids and content hash; read counts: `getItemVersion` 0, `readItemStates` 1, availability 1, scope 1; the engine receives the new state with the stored approver |
| AC-011m | `estimate-cache-contract.test.ts` (1)..(8) | The eight conditions, see the next table |
| AC-011n | `estimate-cache-ac011.test.ts` / `AC-011n …` (5) | Mapping `SUSPENDED`: only the T1 line `MAPPING_INVALID`, the others `ESTIMATED`, overall `ON_HOLD`, payouts null, `versions` equal; `UNDER_REREVIEW` (service) for T1, T2 and the base-fee mapping: only that line `MAPPING_UNDER_REREVIEW`; second unusable candidate suspended: response byte-identical; real candidate suspended: `MAPPING_INVALID` |
| AC-011o | `estimate-cache-ac011.test.ts` / `AC-011o …` (3) | Rule set `SUSPENDED` / `UNDER_REREVIEW`: 200, `result` deep-equal to before, `documents` exactly `{ state: 'RULES_UNAVAILABLE' }`, versions equal; an `ON_HOLD` input has `documents: null` before and after |
| AC-011p | `estimate-cache-ac011.test.ts` / `AC-011p …` (3) | (1) shared profile `SUSPENDED` / `UNDER_REREVIEW` with both bundles cached: both clinics `PROFILE_INVALID` / `PROFILE_UNDER_REREVIEW`, client versions unchanged; (2) suspend bundle X only: clinic 2 response byte-identical to before, clinic 1 `RULE_BUNDLE_SUSPENDED`, the five item states read directly from the repository unchanged (all `PUBLISHED`) |
| AC-016e | `privacy.test.ts` / `AC-016e …` (6) | 15 varied valid selections: repository dump equal before and after, log `[]`; no audit / scope / review / event writes; cache independent of requests; unique markers in rejected requests (400, 409, 422) found nowhere (log, dump, cache, services); 500 path: log is exactly `[{event, code}]` and neither log nor response contains the selection; unexpected-error path likewise |
| AC-016n | `privacy.test.ts` / `AC-016n …` (11) | Control that the marker is really on the request; 6 carrier variants (body field, nested body field, `x-request-id` header, query `requestId`, query `x-request-id` / `attemptId`, all three): response byte-equal to the marker-free response and the handler reads only `json()`; 400 / 409 / 422 / 500 responses likewise; body-access recorder (six names only, no `requestId`, no enumeration); after 15 mixed requests: repository dump equal before and after, no marker in repository, log, cache, service object; exports of all `src/server` / `src/app` modules scanned (non-function exports > 20, modules > 40) |
| AC-016e / AC-016n | `server-state.test.ts` (20) | Module-scope state scan: exactly one finding (`let services` in `src/app/services.ts`), negative tests for every rule, the cache module has none and the composition creates it once |

The eight cache-hit conditions of plan.md M4 (`estimate-cache-contract.test.ts`, test names carry the number):

| # | Test(s) | What is checked |
|---|---------|-----------------|
| (1) | `(1) …` (9) | For 7 request variants: response of a cache-less server = first request (miss) = second request (hit), byte-equal; counts `{lookups 2, hits 1, stores 1}`; the engine snapshots of miss and hit are deep-equal; 6 varied requests leave one entry |
| (2) | `(2) …` (4) | No `state` / `approver` / `approvedFingerprint` / `status` key anywhere in the cache; a poisoned cache that returns planted state, approver, fingerprint and status still yields the stored values in the engine input; after a service suspension the cached entry is the same object but the engine gets `SUSPENDED`; bundle suspension shows on the next request while the cache is warm |
| (3) | `(3) …` (6) | Miss and hit: scope 1, availability 1, `readItemStates` 1, `getItemState` 0, `getItemVersion` 5 / 0; five identical requests give exactly 5 / 5 reads; the single `readItemStates` argument is the 5 refs in PROFILE, MAPPING x3, DOCUMENT_RULE_SET order; two clinics: one read per used bundle; with a warm cache: no-scope clinic, suspended bundle, 409 and 422 read no item state, no item content, no bundle record and do no cache lookup |
| (4) | `재승인 시나리오 … (4)` x2 targets | After judgement-field publication, re-approval by a third reviewer and publication of a bundle with the same refs, with the scope still on X: 200 (not 409), same `ruleBundleVersion` and content hash, engine mapping `PUBLISHED` / approver A2 / fingerprint F2 (not A1, not F1), line `ESTIMATED`; the cache was stored once and its entry is the same object; the cache has no invalidation method |
| (5) | `재승인 시나리오 … (5)` x2 targets | Between re-approval and publication: 200, the line `ON_HOLD` / `MAPPING_UNREVIEWED`, repository state `APPROVED` with approver A2, engine mapping `APPROVED` / A2 / F2, other lines `ESTIMATED`, same bundle id and hash, no 409 |
| (6) | `재승인 시나리오 … (6)` x2 targets (2 tests each) | A state copy taken before the change is `PUBLISHED` / A1 / F1; evaluated by the real engine over the same cached content it gives `MAPPING_UNDER_REREVIEW`; the HTTP response is `ESTIMATED` (after publication) or `MAPPING_UNREVIEWED` (before it), never the stale verdict, and its text never contains `MAPPING_UNDER_REREVIEW` after publication |
| (7) | `(7) …` (3) | Two clinics on bundles X and Y that share the profile and rule set: equal shared item states in both engine inputs; one service suspension is seen by both clinics' next request (`PROFILE_INVALID`), one entry per bundle, cache untouched; same refs and hash in two bundles (X, X2) are two cache entries returning the same fresh states (A2, F2) |
| (8) | `(8) …` (1) | Suspending X: item states, approver, fingerprints and histories of X's and Y's items unchanged (repository), X's clinic `SUSPENDED` with no item / bundle-record reads, Y's clinic `ESTIMATED` with an unchanged shared profile, cache entries unchanged |

Also in `estimate-cache-contract.test.ts`: `응답의 Cache-Control: no-store(HTTP 계층)와 서버 안의 … 캐시는 서로 다른 것이다` (2): the hit response has `Cache-Control: no-store` and the cache holds one entry that contains none of the response's values; 409 and 422 responses are `no-store` and touch the cache 0 times. `캐시 크기` (2): 40 requests with unknown versions leave 0 entries; two bundles stay two entries after 10 requests.

Not closing here: AC-019c (server-side module identity) and AC-021d (server-side dependency / import graph / outside-call evidence) have additional evidence in `engine-module-identity.test.ts`; M6 and M7 close them.

#### RED before GREEN (exact statement)

The tests were written first (including the fixture option `bundleCache` and the extra argument of the existing `loadBundleContent` unit tests). RED run 1 (`.moai/state/verify/M4.C/red1-import.txt`, no implementation file existed): `Test Files 6 failed (6)`, `Tests 2 failed | 17 passed (19)`. Five files failed at import (`Cannot find module .../bundle-content-cache`), so this RED shows only that the module did not exist. The 17 passing tests are those of `server-state.test.ts` whose checker is test-side code (the 2 failing ones read files that did not exist yet), so most of that file could not be RED. Then I wired the seam without using it (the cache module, `ApiServices.bundleCache`, composition, the third parameter of `loadBundleContent` ignored): RED run 2 (`red2-seam-no-cache.txt`): `Test Files 4 failed | 2 passed (6)`, `Tests 46 failed | 81 passed (127)`. The 46 failures are the hit-dependent assertions (item content read on a hit, `stores` / `hits` counts, empty `entries()`, key / copy / freeze unit tests, and the scenario tests that assert `getItemVersion` 0). The 81 that pass in RED 2 include the state-freshness tests: with a seam that never caches, states are trivially fresh, so those cannot be RED; they are protected by the mutation table below (C1, C2, C4, C12). Most privacy tests (absence of a marker in log / repository / cache) cannot be RED before a cache exists either; their power is shown by the dump-scanner controls and by mutants C7, C8, C9. GREEN after implementing the cache and the seam: `Tests 3 failed | 124 passed (127)` (`green1.txt`); all 3 failures were defects in my tests, fixed in the tests: AC-011n's second candidate was first built with an expired validity window (publish validation rejects `OUTSIDE_VALIDITY`, now a `DEMO`-origin candidate), a contrast step suspended the wrong mapping (found by id now), and the AC-011p assertion compared `versions.profile`, which is `null` on a whole-hold response. Tests added afterwards (cache composition, cache size, warm no-scope, evidence-only boundary tests) were written against the finished code.

#### Evidence (outputs under `.moai/state/verify/M4.C/`, gitignored; every vitest run with `--maxWorkers=4`, sequential, on the final tree)

```
$ npx vitest run tests/api tests/server tests/boundary --maxWorkers=4   -> exit 0   (final-1-api-server-boundary.txt)
 Test Files  67 passed (67)
      Tests  3485 passed (3485)        (M4.B: 61 files / 3362 tests; +6 files, +123 tests)
$ npx vitest run tests/engine tests/boundary --maxWorkers=4              -> exit 0   (final-2-engine-boundary.txt)
 Test Files  40 passed (40)
      Tests  1627 passed (1627)        (M1/M2 regression 36 files / 1544 tests unchanged + 4 boundary files with 46 + 10 + 20 + 7 tests)
$ npx tsc --noEmit                                                       -> exit 0   (final-3-tsc.txt, empty output)
$ npx vitest run --coverage --maxWorkers=4                               -> exit 0   (final-4-coverage.txt)
 Test Files  99 passed (99)
      Tests  4786 passed (4786)        (M4.B: 93 files / 4663 tests)
$ node .moai/state/m4/covsum.mjs coverage/coverage-summary.json
 engine: statements 652/652, branches 558/558, functions 145/145, lines 606/606
 server: statements 1537/1537, branches 854/854, functions 408/408, lines 1437/1437
 other (= src/app): statements 13/13, branches 0/0, functions 7/7, lines 12/12
$ node .moai/state/verify/M4.C/covfiles.mjs                              (final-4-coverage-files.txt)
 total statements 2202/2202 branches 1412/1412 functions 560/560 lines 2055/2055; files measured: 77; files below 100%: 0
$ npx next build                                                         -> exit 0   (final-5-next-build.txt)
 Next.js 16.4.2 (Turbopack); Compiled successfully; Finished TypeScript; routes: /_not-found, /api/clinics/[slug]/catalog, /api/clinics/[slug]/estimate, /api/clinics/[slug]/insurance/options
$ node .moai/state/verify/M4.C/smoke.mjs (next start -p 3199, empty operating store)   (smoke.txt)
 POST estimate unknown clinic -> 404 {"error":"CLINIC_NOT_FOUND"} cache-control: no-store, content-type: application/json
 same with requestId in body + x-request-id header + query -> identical response; marker not echoed and not in the server output
```

No coverage exclusions, no `skip` / `only` / disabled tests. The smoke script printed its results and the server was killed with `taskkill`; the script process itself did not return on its own (Windows child-process handles), which does not affect the results.

#### Mutation spot checks (scripted one-spot edit of the final source tree, restored from a copy after each run, every restore verified identical; script `mutate.mjs`, output `mutations.txt`; suite = `tests/api` + `tests/boundary/server-state.test.ts` + `tests/boundary/estimate-surface.test.ts` (491 tests); C5 and C13 also run the M3 files that exercise the edited M3 module)

The runs happened before the last test-only additions (warm no-scope test, evidence-only boundary tests); no source file changed afterwards.

| Mutation | Result (failed tests per file) |
|----------|--------------------------------|
| C1 item states remembered per bundle after the first request (stale state served; second `readItemStates` skipped) | killed: 41 failed (contract 18, ac011 11, compute 5, integrity 4, bundle-content 3) |
| C2 clinic rule scope + bundle availability read once per (repository, clinic) and remembered | killed: 19 failed (contract 9, ac011 6, options 3, compute 1) |
| C3 cache key ignores the content hash (id only) | killed: 2 failed (bundle-content-cache 2) |
| C4 request path treats an `APPROVED` mapping as `PUBLISHED` (auto-publish imitation) | killed: 4 failed (contract 4: the (5) and (6) tests of both targets) |
| C5 `approve()` of a re-approval also records `PUBLISHED` (auto-publish in the M3 service) | killed: 26 failed (contract 6, M3 lifecycle-approval 6, M3 reapproval-cache-contract 14) |
| C6 `readItemStates` called twice per request | killed: 18 failed (contract 10, ac011 5, bundle-content 2, compute 1) |
| C7 patient selection (generation, cause) stored as a cache entry | killed: 22 failed (contract 16, ac011 4, privacy 2) |
| C8 patient selection (generation) written to the server log | killed: 53 failed (integrity 47, privacy 6) |
| C9 route reads the `x-request-id` header | killed: 14 failed (privacy 9, body-access 3, layers 1, boundary estimate-surface 1) |
| C10 cache stores the caller's object instead of a clone | killed: 2 failed (bundle-content-cache 2) |
| C11 structure-invalid content is cached | killed: 1 failed (bundle-content-cache 1) |
| C12 whole engine snapshot remembered per bundle (state read skipped on hits) | killed: 46 failed (contract 19, ac011 11, compute 11, integrity 5) |
| C13 bundle suspension also suspends the bundle's profile item (violates "only availability") | killed: 7 failed (bundle-suspend 5, contract 1, ac011 1) |

All 13 mutants killed. Limits: one-spot edits; they do not prove absence of other defects. C3, C10 and C11 are each killed only by unit tests of the cache module (not by the HTTP tests), because through HTTP the repository never serves a record whose hash changes; the unit tests simulate that with a repository wrapper. C13 is killed by one test in each of the two new contract files (the (8) test and AC-011p (2)) and by 5 tests of the existing M3 file tests/server/bundle-suspend.test.ts.

#### OPEN / NOT IMPLEMENTED / NOT VERIFIED

1. NOT VERIFIED: server-side traces outside `src/` code: Next.js / Node / reverse-proxy / platform access logs can record the request URL including a query string; this step proves only that the application code never reads headers or URL and never logs or stores them (Proxy over `Request`, source scans, a real `next start` run whose output did not mention the marker). Client-side behaviour (the kiosk not sending the id) belongs to M6.
2. NOT VERIFIED: state that lives in closures. The module-scope scan is lexical and cannot see a non-empty module constant that is mutated later, aliases of `globalThis`, or state captured inside functions; the module-export scan skips functions. The public stores (repository, log, cache, service object) are dumped and scanned directly, so those are covered.
3. Production data does not exist: the operating store is empty, every slug is 404, so the cache is never filled in the operating composition. Estimate with real clinics / rules / approvers is NOT VERIFIED (only the TEST composition exercises it). `silentLog` is still the production sink (carried over).
4. No eviction: entries are bounded by the number of published bundle versions that an `ACTIVE` scope points at. If bundle publications become numerous, add a bound (decision for the orchestrator).
5. NOT VERIFIED: concurrency. The repository interface is synchronous, so a request cannot interleave with another; with a future asynchronous adapter two concurrent misses may both read and both call `store`, which keeps the first copy (idempotent) but is not tested. The cache is per process; a multi-instance deployment has one cache per instance, which is correct for immutable content.
6. The `UNDER_REREVIEW` variants of AC-011m / AC-011o for a profile and a document rule set are written through the repository's `recordItemTransition`, not a domain service, because M3 has none (decision 8). When M7 adds such a service these two tests should switch to it.
7. Spec points noticed (for the document owner): (a) plan.md M4 (1) lists the bundle version's `itemRefs` among the cacheable values, but the bundle record has to be read every request to obtain the hash (decision 1); (b) plan.md (4)(5)(6) and acceptance AC-011m say "versions unchanged", but the only way to get a stale-vs-fresh verdict difference (F1 vs F2) is a judgement-field catalog publication, which changes `catalogVersion` (decision 9); (c) AC-011n's "other usable candidate leaves the response unchanged" is only satisfiable with an unusable second candidate (decision 10); (d) plan.md (5) says the line state is `APPROVED`, which the response does not show; it is verified in the repository and in the engine input; (e) design.md DD-14 "항목 생명주기 상태와 캐시 계약" and plan.md still say the HTTP cache is "구현 안 됨·미검증" for AC-011m..p, AC-016e, AC-016n; they are implemented and tested now.
8. NOT VERIFIED: CI; platforms other than Windows 11 with Node 24.19.0; `next dev`; lint (no lint script and no `moai` CLI on this machine, as in M3 / M4.A / M4.B).
9. The new files were written with LF and the working tree uses CRLF (`core.autocrlf=true`); Git normalizes on commit (warnings only).

### M4 AC 추적표 (A·B·C 통합), 2026-10-19

**Scope.** Documentation alignment only (no code, no test run by the author of this section). One row per closing AC of plan.md M4 (29) plus the two evidence-only ACs. "Status" restates the AC evidence tables of the M4.A, M4.B and M4.C sections above; where the author could verify a link independently, it was done by grep (every AC id in the table appears in the cited test file, except that the AC-021e files `estimate-integrity.test.ts` and `estimate-cache-contract.test.ts` carry the assertion without the AC id in their text; every cited source file exists in the tree at HEAD `87b504d`). "Closed at integration level" means: exercised through the real route exports over the IN-MEMORY repository with the TEST composition (`TEST_FIXTURE` data only); it does not mean verified against production data, a database, or a deployment. Abbreviations: `api/` = `src/server/api/`; tests are under `tests/api/` unless the path starts with `tests/boundary/`.

| AC | Implementing source | Test file / describe | Step | Status |
|----|---------------------|----------------------|------|--------|
| AC-006f | `api/estimate-request.ts` (layers 1-2), `api/estimate.ts` (`handleEstimate`, layers 0-5), `api/http.ts` | `estimate-layers.test.ts` / `AC-006f · AC-021a 층 0`, `층 1: 요청 구조`, `층 2: 지원 세대와 빈 치료` | B | closed at integration level |
| AC-006g | `api/estimate.ts` (`cause` goes only to `deriveDocuments`, never to `estimate()`) | `estimate-compute.test.ts` / `AC-006g 원인만 다른 세 요청은 result 블록이 바이트까지 같다` | B | closed at integration level |
| AC-006i | `api/estimate-lines.ts` (`assertLineAssembly`), `api/bundle-content.ts` (`isBundleStructureValid`, `assertBundleStructure`), `api/integrity.ts` (`ServerIntegrityError`, `guarded`), `api/estimate.ts` | `estimate-integrity.test.ts` / `AC-006i (1)` x2, `AC-006i (2)`, `AC-006i (3)`, `저장소 자료가 서로 맞지 않으면 …` | B | closed at integration level |
| AC-010b | `src/server/composition.ts`, `src/app/services.ts`, `api/services.ts` | `tests/boundary/production-no-fixtures.test.ts` / `실제 운영 진입점`, `음성 시험: …`; `production-composition.test.ts` / `운영 구성: 허용 출처`, `운영 구성의 허용 출처로 엔진을 부르면 시험 자료는 쓸 수 없다` | A | closed at integration level |
| AC-010d | `api/estimate.ts` (origin summary, `SUMMARY_PRECEDENCE`) | `estimate-compute.test.ts` / `AC-010d 응답 origin …` | B | closed at integration level |
| AC-011f | `api/estimate.ts`, `api/estimate-versions.ts`, `api/bundle-ref.ts` | `estimate-compute.test.ts` / `AC-011f 묶음 중지와 복구 시나리오 …` | B | closed at integration level |
| AC-011g | `api/options.ts`, `api/bundle-ref.ts` | `options.test.ts` / `AC-011g 묶음 중지` | A | closed at integration level |
| AC-011m | `api/bundle-content.ts` (`loadBundleContent`, `composeBundleSnapshot`), `api/bundle-content-cache.ts`, `api/estimate.ts` | `estimate-cache-ac011.test.ts` / `AC-011m …`; `estimate-cache-contract.test.ts` / `(1)` … `(8)` | C | closed at integration level (cache-hit contract: DD-14 "구현 선택, 소유자 확인 필요 (M4)" 2, 3, 5 are open) |
| AC-011n | same as AC-011m | `estimate-cache-ac011.test.ts` / `AC-011n …` | C | closed at integration level (open: DD-14 "구현 선택" 4) |
| AC-011o | same as AC-011m | `estimate-cache-ac011.test.ts` / `AC-011o …` | C | closed at integration level (open: DD-14 "구현 선택" 5, the `UNDER_REREVIEW` variant) |
| AC-011p | same as AC-011m | `estimate-cache-ac011.test.ts` / `AC-011p …` | C | closed at integration level |
| AC-016e | `api/log.ts`, `api/integrity.ts`, `api/bundle-content-cache.ts`, `src/server/composition.ts` | `privacy.test.ts` / `AC-016e …`; `tests/boundary/server-state.test.ts` | C | closed at integration level (infrastructure and access logs not observed) |
| AC-016n | `api/estimate-request.ts`, `src/app/api/clinics/[slug]/estimate/route.ts` (reads only `json()`) | `privacy.test.ts` / `AC-016n …`; `tests/boundary/server-state.test.ts` | C | closed at integration level (kiosk-side behaviour is M6; infrastructure and access logs not observed) |
| AC-018a | `api/catalog.ts`, `api/published-catalog.ts`, `api/clinic.ts`, `src/app/api/clinics/[slug]/catalog/route.ts` | `catalog.test.ts` / `AC-018a 없는 slug`, `게시 카탈로그: 표시 필드만`, `idlePolicy`, `병원마다 다른 카탈로그`, `규칙 범위가 없거나 …`, `카탈로그를 게시한 적 없는 병원 [문서에 없음]` | A | closed at integration level |
| AC-018b | `api/options.ts`, `api/options-cards.ts`, `api/bundle-ref.ts`, `src/app/api/clinics/[slug]/insurance/options/route.ts` | `options.test.ts` / `AC-018b 없는 slug`, `AC-018b 카드와 안내 문구`, `AC-018b 규칙 묶음 버전과 상태`, `읽는 것: 범위와 가용성만 (항목은 읽지 않는다)` | A | closed at integration level |
| AC-019a | `api/estimate-request.ts` (`CONTRACT_FIELDS`, `parseEstimateRequest`) | `estimate-body-access.test.ts` / `AC-019a 본문 읽기 함수 …`, `AC-019a 실제 route.ts 의 POST …` | B | closed at integration level |
| AC-019b | `api/estimate.ts` (layer 4), `api/published-catalog.ts` | `estimate-layers.test.ts` / `AC-019b · AC-021l 겹침 (e) …` | B | closed at integration level |
| AC-019d | `api/estimate.ts` (`documentTreatments`, `deriveDocuments` input) | `estimate-compute.test.ts` / `AC-019d 서류 산출 입력 …` | B | closed at integration level |
| AC-020a | `api/estimate-versions.ts` (`versionsMatch`, `versionMismatchBody`) | `estimate-layers.test.ts` / `AC-020a 409 VERSION_MISMATCH 본문 (DD-14)` | B | closed at integration level |
| AC-021a | `api/http.ts` (`ERROR_STATUS`), `api/integrity.ts`, `api/estimate.ts` | `estimate-layers.test.ts` / `AC-021a 공개 오류 표 전체 …` and the three layer describes | B | closed at integration level |
| AC-021b | `api/estimate.ts` | `estimate-compute.test.ts` / `AC-021b 보류도 HTTP 200 이다` | B | closed at integration level |
| AC-021c | `api/estimate.ts` (`versions`, `origin`, `result`, `documents`) | `estimate-compute.test.ts` / `AC-021b · AC-021c · AC-021e 성공 응답 (200)` | B | closed at integration level |
| AC-021e | `api/http.ts` (`jsonResponse`, the only response constructor) | options half: `options.test.ts`, `catalog.test.ts`, `plumbing.test.ts` (A); estimate half: `estimate-compute.test.ts`, `estimate-layers.test.ts`, `estimate-integrity.test.ts` (B); `no-store` vs the internal cache: `estimate-cache-contract.test.ts` (C) | A + B | closed at integration level (options half in A, estimate half in B) |
| AC-021h | `api/estimate.ts`, `api/estimate-request.ts` | `estimate-layers.test.ts` / `AC-021h 겹침 (a) …` | B | closed at integration level |
| AC-021i | `api/estimate.ts` | `estimate-layers.test.ts` / `AC-021i 겹침 (b) …` | B | closed at integration level |
| AC-021j | `api/estimate.ts` | `estimate-layers.test.ts` / `AC-021j 겹침 (c) …` | B | closed at integration level |
| AC-021k | `api/estimate.ts`, `api/estimate-versions.ts` | `estimate-layers.test.ts` / `AC-021k 겹침 (d) …` | B | closed at integration level |
| AC-021l | `api/estimate.ts` (layer 4), `api/published-catalog.ts` | `estimate-layers.test.ts` / `AC-019b · AC-021l 겹침 (e) …` | B | closed at integration level |
| AC-021m | `api/estimate.ts` (`SUSPENDED` decision before any item read), `api/estimate-versions.ts` | `estimate-layers.test.ts` / `AC-021m 겹침 (f) …` | B | closed at integration level |
| AC-019c | `api/estimate.ts` imports `estimate`, `deriveDocuments`, `selectDocumentRuleSet`, `resolveMapping` from `src/engine/*` (no second implementation) | `tests/boundary/engine-module-identity.test.ts` / `AC-019c 증거(서버 쪽) …` (C); call spies in `estimate-compute.test.ts` / `엔진과 서류 산출에 실제로 넘어간 인자 (통과형 감시)` (B) | B, C | evidence only, NOT closed (M6 closes it together with the kiosk side) |
| AC-021d | `src/server/api/**`, `src/server/composition.ts`, `src/app/**` (no outside-call identifiers or modules, `Date` only in `src/app/clock.ts`) | `tests/boundary/estimate-surface.test.ts` / `계산 요청 경로가 운영 진입점 그래프에 들어 있다` (B); `tests/boundary/engine-module-identity.test.ts` / `AC-021d 증거(서버 쪽) …` (C) | B, C | evidence only, NOT closed (M7 closes it over all of `src/`) |

Table note: every closing AC has at least one test file in this table; none was left without a test. The AC-021e row lists files, not describes, because the `no-store` and `application/json` assertions run in the shared header helpers of every describe of those files (M4.A and M4.B tables). `…` in a describe name abbreviates the rest of the name in the test file.

#### M4 필요 기존 코드 변경 (earlier-step files changed by B and C; taken from the M4.B and M4.C sections)

| Step | File | Reason | Blast radius |
|------|------|--------|--------------|
| B | `src/server/api/services.ts` | `ApiServices` gains `today: () => string` (the injected reference date, required by the estimate path) | every `ApiServices` producer: the two compositions |
| B | `src/server/composition.ts` | `OperatingDeps` gains a required `today`; accepted origins unchanged (`OPERATING` only) | `createOperatingServices` callers: `src/app/services.ts` and 5 calls in `tests/api/production-composition.test.ts` |
| B | `src/app/services.ts` | passes `systemToday` (new `src/app/clock.ts`); still exports only `getApiServices` | the production wiring only |
| B | `src/server/api/integrity.ts` | the closed error-code list grows (bundle, assembly, origin-mapping and engine-rejection codes); no existing code changed | type union only, no change for existing callers |
| B | `src/server/api/options.ts` | the "scope points to a bundle without availability" check moved into the shared `readBundleRef` (behaviour identical, same code); done so the invariant has one definition | options tests unchanged and green |
| B | `src/server/api/catalog.ts` | `SETTING_OF` exported (the document derivation uses the same table) | one keyword |
| B | `tests/fixtures/server/api-composition.fixture.ts` | `TEST_TODAY` and `createTestServices({ today? })` | test composition only |
| B | `tests/api/production-composition.test.ts` | the five `createOperatingServices(...)` calls pass a fixed `today` (forced by the contract change) | no assertion changed |
| C | `src/server/api/bundle-content.ts` | `loadBundleContent` gets a required third parameter (the cache) | its one caller `estimate.ts` and `tests/api/bundle-content.test.ts` (5 calls now pass `createBundleContentCache()`; no assertion changed) |
| C | `src/server/api/services.ts`, `src/server/composition.ts` | new required field `bundleCache`; `createOperatingServices` creates a new cache per call and ignores an extra argument | the two compositions only |
| C | `src/server/api/estimate.ts` | signature of the private `readBundle`; no behaviour change besides the cache | none outside the file |
| C | `src/server/api/estimate-lines.ts` | doc comment only | none |
| C | `tests/fixtures/server/api-composition.fixture.ts`, `tests/api/post-helpers.ts` | `createTestServices` accepts an optional `bundleCache` (default a fresh cache); `callPostRequest` added | tests only |

No file under `src/engine/**`, no existing file under `tests/engine/**`, `tests/boundary/**` (existing files), `tests/server/**`, and no M3 `src/server/**` module outside `src/server/api/**` and `src/server/composition.ts` was edited by A, B or C (each step section states this).

#### 미구현·미검증 (still true after M4; none of these may be read as closed)

1. Production data does not exist: the operating store is empty, so every slug is 404 on the operating composition (also over real HTTP). The estimate path with real clinics, prices, rules and approvers is NOT VERIFIED; only the TEST composition (`TEST_FIXTURE` data) exercises it, and the bundle content cache has never been filled in the operating composition.
2. NOT IMPLEMENTED: a DB adapter and the DB product (§E #1 stays deferred); M5 and later (kiosk session store, screens); M7 (admin API, authentication, RBAC); M8; deployment; CI.
3. NOT VERIFIED: lint and the formal `moai` SPEC lint (no lint script and no `moai` CLI on this machine); platforms other than Windows 11 with Node 24.19.0; behaviour under `next dev`.
4. NOT VERIFIED: real concurrency (the in-memory repository is synchronous; two concurrent cache misses are not tested; the cache is per process); the real size of a cached bundle (no real bundle exists); behaviour under very large request bodies (no size limit was added).
5. NOT VERIFIED: server-side traces outside application code (Next.js, Node, reverse-proxy or platform access logs can record the request URL including a query string); state held in closures (the module-scope scan is lexical); client-side behaviour (the kiosk not sending the attempt id) belongs to M6.
6. The production log sink is `silentLog`, so a production 500 leaves no trace (DD-14 "구현 선택, 소유자 확인 필요 (M4)" 6).
7. AC-019c and AC-021d are evidence only and stay open (M6 and M7 close them).
8. Open owner confirmations for implementation choices that conflict with or narrow existing text (not added as `[NEEDS CLARIFICATION` rows in plan.md §E): design.md DD-14 "구현 선택, 소유자 확인 필요 (M4)" items 1-7 (the DD-14 step ④ read position, the per-request bundle record read vs plan.md M4 (1), the "versions unchanged" reading of scenarios (4)-(6), AC-011n's second candidate, no domain service for PROFILE / DOCUMENT_RULE_SET `UNDER_REREVIEW`, the production log sink, no cache eviction). [Update 2026-10-19, after this section was written: item 1 was resolved by the owner's PR #4 review-follow-up instruction and DD-14 step ④~⑥ was aligned to the implementation; items 2-7 stay open. See "M4 review follow-up: published-treatment set consistency (PR #4, 2026-10-19)" below. The original wording above is kept as written.]
9. Whole-SPEC audit status is unchanged: the earlier plan-audit FAIL records and `plan_status: fail` above are history and are preserved verbatim; no audit was run for M4 and nothing here marks the SPEC audited, approved or ready.
10. The test counts and coverage figures quoted in the M4.C section (tsc exit 0; 99 files / 4786 tests; `tests/engine` + `tests/boundary` 40 files / 1627 tests; engine, server and `src/app` 100%) were reported by the orchestrator on the final tree and are not re-measured by this documentation step.

### M4 review follow-up: published-treatment set consistency (PR #4, 2026-10-19)

**Scope.** A code fix found by an external review of Draft PR #4, plus the minimal documentation alignment recorded here. Branch `feature/SPEC-REIMBURSEMENT-001-m4-api` on top of `01009fd`; the code change was not committed when this section was written (the orchestrator commits after reviewing the diff). PR #3 and its branch were NOT touched: the M3-layer fix lives in PR #4 only. The numbers below marked "orchestrator-run" were reported by the orchestrator on the final tree and were not re-run by the author of this documentation step.

#### Defect

The public API's `readPublishedCatalog()` (`src/server/api/published-catalog.ts`) excluded inactive (`Treatment.active = false`) treatments, but the operational readiness snapshot `loadReadinessSnapshot()` (`src/server/readiness.ts`, M3.E) included every treatment version of the clinic's current catalog. Two cases were reproduced:

1. Active treatment with a base fee fine, inactive treatment unmapped: an estimate over the whole public catalog was `ESTIMATED`, while readiness said `NOT_READY` (the inactive treatment's line was `MAPPING_ABSENT`).
2. All treatments inactive, mappings fine: the public catalog was empty and nothing was computable, while readiness said `READY`.

Both break the DD-23 / AC-011l equivalence ("readiness `READY` <=> an estimate over the published set is not `ON_HOLD`") because the two layers disagreed on what "published" means.

#### Fix and design

One shared selection criterion in a new lower-layer module `src/server/published-treatments.ts` (`selectPublishedTreatments(repo, clinicId, catalog, fail)`): per catalog treatment version, in catalog order: version -> treatment -> ownership (`treatment.clinicId === clinicId`) -> keep only `active`. Broken references (missing version, missing treatment, treatment of another clinic) are reported through an injected `fail` callback, regardless of `active` and before the active check. No sorting; read-only (uses only `getTreatmentVersion` and `getTreatment`). The module imports domain entity types and repository interface types only (not `src/server/api`), so both layers can depend on it.

- Public API: maps the defects to `ServerIntegrityError` with the same three codes as before (`TREATMENT_VERSION_MISSING`, `TREATMENT_MISSING`, `TREATMENT_CLINIC_MISMATCH`) -> HTTP 500 `INTERNAL_ERROR`; behaviour unchanged.
- Readiness: maps the defects to `DomainError` (`NOT_FOUND` for a missing version or treatment, `REF_CONTENT_MISMATCH` for a treatment owned by another clinic).
- `computeReadiness` (pure function, engine-function reuse contract of DD-23 rule 0) is unchanged. Only `loadReadinessSnapshot` and the `ReadinessReads` type (gained `getTreatment`) changed in `src/server/readiness.ts`.
- Common base fees are unchanged in both layers: every registered base fee is auto-included.

#### Files changed

| File | Change | Reason |
|------|--------|--------|
| `src/server/published-treatments.ts` | New | the single selection criterion |
| `src/server/api/published-catalog.ts` | Modified (uses the shared module; defect mapping to `ServerIntegrityError`) | public API and readiness must use one definition |
| `src/server/readiness.ts` (existing M3 file) | `loadReadinessSnapshot` uses the shared module; `ReadinessReads` gained `getTreatment`; a failure mapper to `DomainError`; doc comments | readiness must see the same treatments as the public API |
| `tests/api/published-set-consistency.test.ts` | New | cross-layer consistency through the real Route Handlers and `readReadiness` over one repository |
| `tests/server/published-treatments.test.ts` | New | unit tests of the shared module |
| `tests/server/readiness-inactive-treatment.test.ts` | New | snapshot-level behaviour and the readiness-side rejections |
| `tests/server/readiness-repo-readonly.test.ts` (existing M3 test) | `READ_METHODS` allow-list gained `'getTreatment'`; "아홉 개" -> "열 개" in one comment and one test title | the read-only guard enumerates the read methods; no assertion was weakened |

Existing M3 files touched (reason and impact scope): `src/server/readiness.ts` and `tests/server/readiness-repo-readonly.test.ts`. Impact: `readReadiness` and `loadReadinessSnapshot` have no `src` caller (only tests; the M8 operation gate will call them), so no runtime path changed; the M3.E readiness tests ran green on the final tree (orchestrator-run, counts below). This supersedes the earlier statement in the "M4 필요 기존 코드 변경" section that no M3 `src/server/**` module outside `src/server/api/**` and `src/server/composition.ts` was edited: that statement was true for steps A, B and C and is kept as written.

#### Behaviour changes

1. Readiness excludes the lines of inactive treatments (they are not published treatments).
2. Readiness now throws `DomainError` on a catalog treatment version whose treatment is missing, and on a treatment owned by another clinic (`REF_CONTENT_MISMATCH`); previously there was no such check. A missing treatment version was already `NOT_FOUND` and still is.
3. With every treatment inactive, readiness reports `calculationReady` `NOT_READY` at the treatment stage with `NO_PUBLISHED_TREATMENT`, instead of `READY`.

#### Tests added and what each proves

- `tests/api/published-set-consistency.test.ts` (a)(b)(c), against the real Route Handlers and `readReadiness` over the same repository: (a) an active well-mapped treatment plus a base fee plus an inactive unmapped treatment: the inactive one is absent from the public catalog and from readiness; readiness `READY` <=> the estimate over all published treatments is `ESTIMATED` for every cell (exactly one `READY` cell is asserted); the base fee is still included. (b) all treatments inactive: catalog `treatments` is `[]`, readiness `calculationReady` at the usable cell is `NOT_READY` at stage `TREATMENT` with code `NO_PUBLISHED_TREATMENT`, the estimate is 422 `TREATMENT_NOT_PUBLISHED` / `NO_TREATMENT_SELECTED`, the base fee is still included. (c) re-activation: the treatment reappears in the catalog and in readiness; readiness stage `M` `MAPPING_ABSENT` for that treatment and the estimate is `ON_HOLD` with the same `MAPPING_ABSENT` hold; the base fee is still `ESTIMATED` and included.
- `tests/server/published-treatments.test.ts` (unit): only active treatments, in catalog order; all inactive -> empty (the `fail` callback is not called); re-activation selects again; no sorting; the three defect codes through the injected `fail`; ownership check precedes the active check; read-only (only the two read methods, input catalog unchanged).
- `tests/server/readiness-inactive-treatment.test.ts` (snapshot level): no line for an inactive treatment, base fee lines unchanged, all-inactive gives no treatment lines, re-activation restores the lines in catalog order, a clinic without a catalog has no lines, table M has no inactive line, the snapshot stays a copy, read-only with `getTreatment` among ten read methods; `DomainError` `NOT_FOUND` for a missing version and a missing treatment, `REF_CONTENT_MISMATCH` for a foreign treatment, and a broken reference is rejected even when the treatment is inactive.

#### Evidence

Orchestrator-run, on the final tree (the author of this documentation step did not re-run them):

| Check | Observed |
|-------|----------|
| `tsc --noEmit` | exit 0 |
| full `vitest run --coverage` | 102 files / 4813 tests pass |
| coverage | 100% on `src/engine`, `src/server`, `src/app` |
| `next build` | exit 0 |
| revert-then-restore of the readiness expression | with `loadReadinessSnapshot` reverted to the old expression the three cross-layer tests (a)(b)(c) fail; they pass after restoring it |

Agent-run mutation checks (4, all detected, all restored afterwards):

| Mutant | Result |
|--------|--------|
| the `active` filter removed from the shared module | killed: 13 tests failed |
| readiness bypasses the shared module (old expression) | killed: 11 tests failed |
| the ownership check dropped from the shared module | killed: 4 tests failed |
| base fees dropped from the readiness snapshot | killed: 7 tests failed |

Limits: one-spot edits; they do not prove the absence of other defects.

#### Documentation alignment (this step; documents only)

- DD-23 (design.md: table M key, the `NO_PUBLISHED_TREATMENT` note, a new definition bullet) and AC-011l / AC-011j (acceptance.md) now say that "published treatment / published line" means exactly the public API's set: treatment versions of the current `CatalogVersion` whose treatment is active, plus all registered common base fees. The single shared criterion and the readiness-side rejection of an inconsistent store are stated in one place. AC-011l carries an integration-level marker pointing to `tests/api/published-set-consistency.test.ts` (a)(b)(c). DD-19 "구현 결정" 3 got one cross-reference sentence.
- DD-14 (design.md) step ④ was rewritten to the implementation: ④ reads scope, bundle availability and the current catalog (409), ⑤ checks treatment ids (422), neither reads item states; ⑥ reads item states / approver / approvedFingerprint together once per used bundle, also on a content-cache hit. Item 1 of "구현 선택, 소유자 확인 필요 (M4)" ("항목 상태를 읽는 위치") is marked resolved by the owner's PR #4 review-follow-up instruction of 2026-10-19 (number and history kept); items 2-7 are untouched and open. plan.md's M4 status line was updated to say 1 of 7 is resolved and 6 remain.
- Stale status wording corrected where evidence exists: spec.md C6 row, spec-compact.md C6 row and the AC-006 row now say implemented and tested in M4.B at integration level over the in-memory repository (evidence: the "M4 AC 추적표" rows AC-006i / AC-021a and `tests/api/estimate-integrity.test.ts` `AC-006i (1)`, `(2)`, `(3)`); the production-data limit is stated.
- The "M4 AC 추적표" has no AC-011l row (AC-011l is an M3 AC), so no row was changed; the extra evidence for AC-011l is recorded in this section and in acceptance.md. The earlier statements that quote "99 files / 4786 tests" (M4.C and the "미구현·미검증" item 10, plan.md M4 status line) are history and are kept; the final-tree numbers after this follow-up are the ones in the Evidence table above.

#### Not done / unverified / open

1. Observation (i), from code reading only and NOT reproduced by a test: base-fee API-vs-readiness drift. The public API throws `BASE_FEE_CLINIC_MISMATCH` / `BASE_FEE_MISSING` (HTTP 500) while readiness only does `must(getCommonBaseFee)` with no ownership check. Not fixed. [Update 2026-10-19: later reproduced by injecting another clinic's `clinicId` into `getCommonBaseFee()` (catalog 500, estimate 500, readiness cell `READY`) and FIXED in "M4 review follow-up 2: base-fee existence/ownership consistency and stale status wording" below; the original text above is kept as written.]
2. Observation (ii): the `TREATMENT_MISSING` and `TREATMENT_CLINIC_MISMATCH` paths are tested through read-method overrides because the in-memory repository rejects such inconsistent writes; stored data cannot produce them in the test environment, so these two paths are NOT verified against a real inconsistent store.
3. Observation (iii): the `silentLog` production log sink and the absence of cache eviction remain pre-operation tasks (design.md DD-14 "구현 선택, 소유자 확인 필요 (M4)" items 6 and 7, unchanged; not broadened and not implemented here).
4. NOT RUN: formal SPEC lint and any `moai` CLI verification (this machine has no `moai` CLI and the repository has no lint script); CI; platforms other than Windows 11 with Node 24.19.0; real concurrency (the in-memory repository is synchronous); production data (the operating store is empty, every slug is 404 on the operating composition, so none of this was exercised with real clinics, prices, rules or approvers).
5. Whole-SPEC audit status is unchanged: frontmatter `plan_status: fail` and every earlier plan-audit FAIL record are history and are preserved verbatim; no audit was rerun and nothing here marks the SPEC audited, approved or ready.
6. DD-14 items 2-7 of "구현 선택, 소유자 확인 필요 (M4)" are still open (six items).
7. AC-019c and AC-021d are still evidence only and not closed (M6 and M7 close them).
8. Other stale wording noticed and NOT changed (M3 wording, out of this step's M4 scope): acceptance.md AC-007f (line 112) and design.md line 510 still say the publishing-path rejection of a document rule set structure is "M3의 일이며 아직 구현·검증되지 않았다", while plan.md's M3 status line (2026-10-19) lists AC-007f among the 14 closing ACs implemented and verified at unit level over the in-memory repository (plan.md lines 104-105; not re-checked against the M3.D sections by this step). For the document owner. [Update 2026-10-19: both sentences were corrected in "M4 review follow-up 2: base-fee existence/ownership consistency and stale status wording" below, after checking them against the code and the M3.C / M3.D1 tests; the original text above is kept as written.]

### M4 review follow-up 2: base-fee existence/ownership consistency and stale status wording (PR #4, 2026-10-19)

**Scope.** A second code fix found by an external review of Draft PR #4, plus the minimal documentation alignment recorded here and the correction of two stale status sentences the document owner asked for. Branch `feature/SPEC-REIMBURSEMENT-001-m4-api` on top of `f63a56a`; the code change and these documents were not committed when this section was written (the orchestrator commits after reviewing the diff). PR #3 and its branch were NOT touched. The numbers below marked "orchestrator-run" were reported by the orchestrator on the final tree and were not re-run by the author of this documentation step; the only commands this step ran are named under "Evidence (this step)".

#### Defect

The public API's `readPublishedCatalog()` (`src/server/api/published-catalog.ts`) rejected a current-catalog common base fee whose `clinicId` differs from the requested clinic (HTTP 500 `INTERNAL_ERROR`, code `BASE_FEE_CLINIC_MISMATCH`) and a missing one (`BASE_FEE_MISSING`), but the operational readiness snapshot `loadReadinessSnapshot()` (`src/server/readiness.ts`, M3.E) did no ownership check, so another clinic's base fee could still be turned into a line. Reproduced by the orchestrator by injecting another clinic's `clinicId` into `getCommonBaseFee()`: the catalog was 500, the estimate was 500, and the `readReadiness` cell was `READY`. This breaks the DD-23 / AC-011l equivalence (readiness `READY` <=> an estimate over the published set is not `ON_HOLD`) for base fees, the same way follow-up 1 broke it for inactive treatments. It also confirms observation (i) of follow-up 1, which was "from code reading only" at that time.

#### Fix and design

One shared existence + ownership criterion in a new lower-layer module `src/server/published-base-fees.ts` (`selectPublishedBaseFees(repo, clinicId, catalog, fail)`): per `catalog.baseFeeIds` entry, in catalog order: read -> missing? -> ownership (`fee.clinicId === clinicId`)? The first defect is reported through an injected `fail` callback and later entries are not read. No sorting (display order by `baseFeeId` stays with the caller); read-only (uses only `getCommonBaseFee`). Like `published-treatments.ts`, the module imports domain entity types and repository interface types only (not `src/server/api`).

- Public API: `readPublishedCatalog` maps the defects to `ServerIntegrityError` with the same two codes (`BASE_FEE_MISSING`, `BASE_FEE_CLINIC_MISMATCH`) -> HTTP 500 `INTERNAL_ERROR`, unchanged; it still checks all treatments first and the base fees after, then sorts base fees by `baseFeeId`.
- Readiness: maps the defects to `DomainError`: a missing base fee keeps the existing `NOT_FOUND` with the identical message (`공통 기본비용 '<id>' 이(가) 없다 (저장소가 일관되지 않아 준비 상태를 낼 수 없다)`), and a base fee owned by another clinic is the new `REF_CONTENT_MISMATCH` (the same code as the treatment ownership mismatch).
- `computeReadiness` (pure function, engine-function reuse contract of DD-23 rule 0) is unchanged. No new hold code and no new API field. Normal base-fee auto-inclusion, `baseFeeId` / version-id resolution and mapping retention on price-only changes are unchanged.

#### Files changed

| File | Change | Reason |
|------|--------|--------|
| `src/server/published-base-fees.ts` | New | the single existence + ownership criterion for common base fees |
| `src/server/api/published-catalog.ts` | Modified (inline base-fee loop replaced by the shared module; `integrityFailure` accepts both defect types) | public API and readiness must use one definition |
| `src/server/readiness.ts` (existing M3 file) | `loadReadinessSnapshot` builds `baseFeeLines` through the shared module; a new failure mapper `publishedBaseFeeFailure` to `DomainError`; doc comment | readiness must reject the same base-fee defects as the public API |
| `tests/api/published-base-fee-consistency.test.ts` | New | cross-layer consistency through the real Route Handlers and `readReadiness` over one repository |
| `tests/server/published-base-fees.test.ts` | New | unit tests of the shared module |
| `tests/server/readiness-base-fee.test.ts` | New | snapshot-level behaviour and the readiness-side rejections |

Existing M3 file touched again (reason and impact scope): `src/server/readiness.ts`, only `loadReadinessSnapshot` and one new helper. Impact: a base fee owned by another clinic now makes `readReadiness` / `loadReadinessSnapshot` throw instead of returning a report. Their callers are tests only (no `src` caller yet; the M8 operation gate will call them), so no runtime path changed. The read-method set of `ReadinessReads` did not change (`getCommonBaseFee` was already read), so `tests/server/readiness-repo-readonly.test.ts` needed no change.

#### Behaviour change

1. Readiness throws `DomainError` `REF_CONTENT_MISMATCH` when a current-catalog base fee belongs to another clinic; previously the foreign base fee became a line and the cell could be `READY`.
2. A missing base fee is still `DomainError` `NOT_FOUND` with an unchanged message; the public API is still 500 `INTERNAL_ERROR` for both defects.

#### Tests added and what each proves

- `tests/api/published-base-fee-consistency.test.ts` (a)(b)(c), against the real Route Handlers and `readReadiness` over the same repository: (a) a properly owned base fee: readiness `READY` <=> estimate `ESTIMATED` over all 15 cells with exactly one `READY` cell asserted, and the base fee is present in the estimate lines (`isBaseFee`), in the catalog `baseFees` and in the 15 readiness mapping rows. (b) a base fee owned by another clinic: catalog and estimate are 500 `INTERNAL_ERROR` with no id in the body, readiness throws `DomainError` `REF_CONTENT_MISMATCH` and returns no report. (c) a missing base fee: both API paths are 500, readiness keeps the existing `NOT_FOUND` message. (b) and (c) are DATA-DEFECT tests built with a read-method override (`getCommonBaseFee`) of the same repository, because the in-memory repository rejects such inconsistent writes; they are NOT stored-data cases. Both assert that the repository content (full snapshot comparison) is identical before and after and that no write method was touched.
- `tests/server/published-base-fees.test.ts` (unit): the owned base fees come back in catalog order with the stored content; no sorting; an empty catalog gives an empty list and `fail` is not called; `BASE_FEE_MISSING` and `BASE_FEE_CLINIC_MISMATCH` through the injected `fail`; checks run per entry in catalog order and stop at the first defect (later entries are not read); only `getCommonBaseFee` is used, once per catalog entry; the input catalog is not changed.
- `tests/server/readiness-base-fee.test.ts` (snapshot level): owned base fees become lines in catalog order with the stored conversion; a foreign base fee is `REF_CONTENT_MISMATCH` (message carries the base-fee id and the clinic), `readReadiness` rejects with the same error, a foreign second base fee is rejected too (all are checked); a missing one is `NOT_FOUND` with the message byte-identical to the old one. The foreign / missing cases use a repository whose read results are overridden.

#### Evidence

Orchestrator-run, on the final tree (the author of this documentation step did not re-run them):

| Check | Observed |
|-------|----------|
| `tsc --noEmit` | exit 0 |
| full `vitest run` | 105 files / 4833 tests pass |
| coverage | 100% on `src/engine`, `src/server`, `src/app`: 2214/2214 statements, 1417/1417 branches, 564/564 functions, 2067/2067 lines |
| `tests/engine` + `tests/boundary` | 40 files / 1627 tests pass |
| `next build` | exit 0 |
| revert-then-restore of the readiness base-fee expression | with `loadReadinessSnapshot` reverted to the old inline base-fee lines, 4 of the new tests (the ownership ones) fail; they pass after restoring it |

Agent-run mutation checks (4, all detected, all restored afterwards):

| Mutant | Result |
|--------|--------|
| the ownership check disabled in the shared module | killed: 6 tests failed |
| readiness uses the old inline way | killed: 4 tests failed |
| the public API uses an inline existence-only check | killed: 2 tests failed (including the existing catalog test "카탈로그가 다른 병원의 기본비용을 담았다") |
| readiness `baseFeeLines: []` | killed: 8 tests failed |

Limits: one-spot edits; they do not prove the absence of other defects.

Evidence (this step, run by the author of this documentation step on the working tree, which already holds the code change): `npx vitest run tests/server/publish-bundle.test.ts tests/server/validate-bundle-docrules.test.ts --maxWorkers=2` -> 2 test files passed, 225 tests passed (these are the two AC-007f files used for the wording correction below). Nothing else was run.

#### Stale status wording corrected (Part A, requested by the owner)

The two sentences that follow-up 1 left unchanged ("Other stale wording noticed and NOT changed", item 8 above) were checked against the code and tests before being corrected:

- Code read: `src/server/validate/bundle-docrules.ts` calls the engine's `checkDocumentRuleSetStructure` with no second implementation and prefixes each defect path with `bundle.documentRuleSet`; `src/server/validate/bundle.ts` runs it as layer (e) of `validateRuleBundlePublish`; `src/server/bundle-publish.ts` calls `validateRuleBundlePublish` and throws `PUBLISH_VALIDATION_FAILED`, documented there as leaving the repository (including audit and availability records) as before the call.
- Tests read: `tests/server/validate-bundle-docrules.test.ts` (accepted cases `rules: []`, `when: {}`, priority 0 / `Number.MAX_SAFE_INTEGER`, several injury-only / illness-only lines; one case per engine defect code with paths; header wiring; sealing) and `tests/server/publish-bundle.test.ts` `AC-007f 서류 규칙 묶음 게시` (10 rejection rows with `expect(snapshotOf(repo)).toEqual(before)`, previous bundle intact, corrected bundle publishes, `rules: []` publishes, several injury-only / illness-only lines publish, a valid `reason` stored verbatim). Matches the M3.C and M3.D1 evidence rows already in this file (AC-007f traceability rows) and plan.md lines 104-105 (AC-007f among the 14 closing M3 ACs "구현·검증").
- acceptance.md AC-007f and design.md DD-06 (publish-validation bullet) now say the publishing path is implemented and tested in M3.C / M3.D1 over the in-memory repository (unit and integration), and keep the limits: no DB adapter / real DB, no production data, no other platforms. All other words of both paragraphs are unchanged.
- Other occurrences checked and left: spec.md / spec-compact.md C1-C8 rows only list AC-007f as a reference and carry no "not implemented" claim; plan.md lines 98-99 and 104-105 already say implemented and verified; acceptance.md and design.md carry no other "아직 구현" claim for AC-007f. Statements such as "NOT IMPLEMENTED" for AC-007f inside the M2 and early M3 sections of this file are history of what was true at that step and are left as written.

#### Documentation alignment (this step; documents only)

- design.md DD-23 definition bullet ("게시된 줄·게시된 치료의 정의는 하나다") extended: the common base fee's existence and ownership are also checked by one shared criterion used by the public API and readiness; readiness rejects a foreign-owned or missing base fee with an error instead of reporting; the public API reports the same defects as 500 `INTERNAL_ERROR` (DD-19 "구현 결정" 1). DD-19 "구현 결정" 3 got one clause for base fees. The DD-23 table M key sentence needed no change.
- acceptance.md AC-011l: the previous marker was kept and a "M4 후속 2" marker was appended with the base-fee evidence, including the explicit note that (b)(c) are read-override data-defect tests. No AC was created or closed.
- plan.md M4 status line: one clause for this second follow-up and the final-tree figures replaced by 105 files / 4833 tests (orchestrator-run, from this follow-up's final tree; this document step did not rerun them). The earlier 99 / 4786 and 102 / 4813 figures are history.
- The "M4 AC 추적표" was not changed: AC-011l is an M3 AC and no row's closing statement is affected.

#### Not done / unverified / open

1. Observation 1: `priceChanged` in `src/server/api/estimate-versions.ts` (the 409 body) reads the base fees of the client-seen OLDER catalog of the same clinic with a null check only and no `fee.clinicId` check (its treatments loop likewise has no treatment ownership check). A corrupted older catalog could feed another clinic's amount into the single boolean `changes.priceChanged`. Not covered by any test; left as is (outside this scope).
2. Observation 2: the (b)/(c) cases are read-override data-defect tests, not stored-data cases; no real inconsistent store was exercised.
3. Observation 3: the `silentLog` production log sink and the absence of cache eviction remain pre-operation tasks (design.md DD-14 "구현 선택, 소유자 확인 필요 (M4)" items 6 and 7, unchanged).
4. NOT RUN: formal SPEC lint and any `moai` CLI verification (no `moai` CLI and no lint script here); CI; platforms other than Windows 11 with Node 24.19.0; real concurrency; production data (the operating store is empty, every slug is 404 on the operating composition). The whole-SPEC audit status is unchanged: `plan_status: fail` and every earlier plan-audit FAIL record are history and preserved; no audit was rerun and nothing here marks the SPEC audited, approved or ready.
5. DD-14 items 2-7 of "구현 선택, 소유자 확인 필요 (M4)" are still open (six items). AC-019c and AC-021d are still evidence only and not closed.
6. The correction of the two stale sentences rests on reading the code and tests and on one two-file vitest run in this step; the DB-backed publish path, production data and other platforms are not verified and are stated as such in the corrected sentences.

### M5 키오스크 세션 저장소와 상태 기계 (M5.A~M5.D), 2026-10-20

**Scope.** The screenless kiosk state machine: session store, screens and transitions, overlays, idle timers, input-change invalidation, display settings, return context, the calculation-request lifecycle and the catalog/options refresh lifecycle. Branch `feature/SPEC-REIMBURSEMENT-001-m5-kiosk-state`, worktree `bodam-wt-m5`. No screen is rendered; rendering is M6. Everything is verified at unit and integration level on a fake clock and a fake transport; the only real server code exercised is the M4 Route Handlers called in-process (200, 409, and 422 TREATMENT_NOT_PUBLISHED round trips). This record was written before the M5 commit, from the final working tree.

#### Stage records

| Stage | What it built |
|-------|---------------|
| M5.A | A pure `reduce(state, event, env)` in `machine.ts` with an `EVENT_SPECS` table, `selectors.ts`, the imperative shell `controller.ts`, and `idle.ts` (idle schedule). Covers screens and transitions, overlays (ResetConfirm, TimeoutDialog), idle timers, input-change invalidation, display settings and return context. |
| M5.B | `request.ts`: the pure request lifecycle, where `settleRequest` is the only place that sets `activeRequest` to null. `request-effects.ts`: the shell with an `AbortController` and a timer. DD-19 outcome mapping; the six-field request body; `requestId` exists only in memory. |
| M5.C | `refresh.ts` and `refresh-effects.ts`: `refreshState`, `activeRefresh`, `settleRefresh`, atomic apply only after both GETs (catalog and options) have arrived, two GETs under one 15 s timer, `refreshNotice`, and the `RETRY_REFRESH` event. |
| M5.D | Fixes from the independent review (see the review section): F1 timer delays clamped to 2^31-1 ms through `timerDelay` in `deps.ts`; F2 strict validation of the amounts in a 200 body; F3 `START` creates a fresh empty session but keeps display settings; F6 the boundary-scan exemption narrowed to `src/app/kiosk/state/deps.ts`; F8 the default transport uses `credentials: 'omit'` and `cache: 'no-store'`. |

**Source files (15, all under `src/app/kiosk/state/`):** `api-types.ts`, `controller.ts`, `defaults.ts`, `deps.ts`, `display.ts`, `events.ts`, `idle.ts`, `machine.ts`, `refresh-effects.ts`, `refresh.ts`, `request-effects.ts`, `request.ts`, `selectors.ts`, `session-store.ts`, `steps.ts`.

**Tests:** 27 files under `tests/kiosk/state/`, of which 26 are test files and one (`refresh-helpers.ts`) is a shared helper; plus 3 fixture files under `tests/fixtures/kiosk/` (`clinic.fixture.ts`, `state.fixture.ts`, `transport.fixture.ts`). Counts are from a Glob of the tree in this documentation step.

#### Tracked-file edits outside the kiosk folders

`git diff` (read in this step) shows two tracked files changed, 4 insertions and 2 deletions in total: `tests/boundary/engine-module-identity.test.ts` and `tests/boundary/estimate-surface.test.ts`. Each got one Korean comment and one changed line. The server-side outbound-call scan (`appFiles`) now excludes only `src/app/kiosk/state/deps.ts`, because the kiosk default transport legitimately uses `fetch`. The kiosk-side request-static and purity tests restrict `fetch` to `deps.ts`. M7's closure of AC-021d must treat `src/app/kiosk` the same way (exempt `deps.ts` only, nothing else under `src/app/kiosk`).

#### M5 AC trace table

Source: `.moai/state/verify/m5c/ac-evidence.md`, refreshed after M5.D. Common caveats for every row: time is a vitest fake clock, so real browser timer throttling is unobserved; touch and key input are modelled as the `INTERACTION` event and named button events, so no DOM listener is exercised; the transport is an injected fake (or the real Route Handlers in-process), never a browser `fetch`; orientation exists only as a state value. All test files are under `tests/kiosk/state/`. Test names are shortened.

**(A) The 21 AC that plan.md assigns to M5 as closing**

| AC | Main test files / cases | What remains unverified |
|----|-------------------------|-------------------------|
| AC-012g | machine-transitions (K03 previous returns to K02b with selection kept; steps 2-4 keep earlier values) | common caveats only |
| AC-014a | invalidation (changing the generation clears derived data and bumps inputRevision; result screens unreachable until a new confirm; exhaustive reachable-screen search); DD-08 row table | the search covers input-phase events only; server-side recomputation is not part of this AC |
| AC-014b | invalidation (adding or removing a treatment clears derived data) | none |
| AC-014d | invalidation (same-value reselect, page change, large-text toggle keep the result) | none |
| AC-015a | idle-timers (AC-015a block); idle-policy-integration (AC-015i cycle checks) | real browser timers |
| AC-015b | idle-timers (AC-015b block; result, not-covered, hold, basis, documents screens in both orientations; never K06) | orientation is a state value only |
| AC-015c | idle-timers (AC-015c block); request-overlays (AC-015p cases for the request-driven path) | the AC-015c block reaches Calculating and KXX by constructed state |
| AC-015d | idle-timers (AC-015d block); event-classes; request-overlays and refresh-overlays (`lastInteractionAt` unchanged by server outcomes) | real touch and key listeners (M6); non-button touches modelled only as INTERACTION |
| AC-015h | idle-timers (AC-015h block: K00 has no timer, K06 with null hold stays) | none |
| AC-015i | idle-policy-integration (real catalog handler idlePolicy drives the timers); idle-policy; refresh-lifecycle (AC-020d) | admin API and the 20 s floor validation (AC-023d, M7) |
| AC-016h | request-lifecycle (a late result of attempt A changes nothing while retry B runs) | none |
| AC-016i | request-lifecycle (cancel protected by requestId even when abort is a no-op: 4 reset ways plus expiry, 6 late outcomes) | input-change cancellation is exercised from a constructed state; "new patient session" is the PAGE_RESTORED/START path |
| AC-016j | request-lifecycle (15 endings leave nothing behind; replacement by input change or a new attempt); request-static (settleRequest is the only place that releases `activeRequest`; screen changes from outcomes live only in request.ts); request-settle (pure guards, 200-body amount validation); refresh-lifecycle (AC-020g for item 8) | item 7 asks for a recorded call order of settleRequest; it is not implemented as a spy (no test-only hooks), and listener-visible state, timer and abort counts are asserted instead |
| AC-016k | request-lifecycle (requestId absent from body, headers, URL); request-static; request-integration (six-field body accepted by the real handler); default-transport (stubbed `fetch`: no marker, credentials omit, cache no-store) | no real browser network tap; the injected transport and a lexical `fetch` restriction stand in for it |
| AC-016l | request-lifecycle (logs and analytics carry no requestId and only stage-level anonymous fields, with a count>0 control); request-static | the default log sink is a no-op, so no real console or error-reporting adapter was tested |
| AC-016o | refresh-lifecycle (refreshId absent from GET URLs, headers, bodies, logs, analytics, with a control group); request-static; purity | item 4 is a lexical scan (aliasing is not caught); browser storage dumps are AC-016m (M6) |
| AC-020c | refresh-lifecycle (no calculation request while a refresh is needed: RUNNING and FAILED, KXX retry, several treatments) | the rendered button is M6; "active value" is the state-derived `canRequestEstimate` |
| AC-020d | refresh-lifecycle (apply only after both responses, one subscriber notification; removed treatments, price and options-version changes; notice cleared on next input change); refresh-settle | the loading indicator and removal wording are M6; they exist as `refreshState` and `refreshNotice` |
| AC-020e | refresh-lifecycle (14 failure shapes change nothing; first failure wins; inline retry with a new refreshId; no calculation request) | inline notice and retry are the `selectRefresh` flags, not rendered; timeout value is still plan.md §E #21 |
| AC-020f | refresh-lifecycle (late results of refresh A cannot touch refresh B; idempotent settle); refresh-settle | the literal scenario "A timed out, retry, then four late calls" is the union of two tests, not one scenario |
| AC-020g | refresh-lifecycle (reset and input-change races with a refresh: 4 reset ways, direct add/remove, PREV then change, dispose); refresh-overlays | item 3 wording (treatment cards and previous disabled on screen, AC-020i) is M6; the machine exposes `selectRefresh().locked` and does not reject the events |

**(B) The 24 evidence-only AC, closed in M6**

| AC | What the M5 tests show | What only M6 or e2e can show |
|----|------------------------|------------------------------|
| AC-012a | display-and-selectors (K01 right after start, step indicator 1/4..4/4); machine-transitions (start creates a new empty session); start-session (M5.D: fresh session, derived data, return context, refresh state and notice, and page position cleared; pending request and refresh cancelled) | clinic name and service name on the start screen, step-label wording, rendering; START keeps large text and orientation (owner to confirm) |
| AC-012b | display-and-selectors and machine-transitions (next and confirm availability rules) | disabled buttons rendered |
| AC-012e | machine-transitions (card touch, repeated touch does not add quantity, next page); display-and-selectors; selectors-edge | page buttons, cards and the 2-per-page large-text layout |
| AC-012f | display-and-selectors (selection summary through the engine's `sumLineAmounts`); request-integration and refresh-integration (preview total equals server hospitalPayment) | immediate display at the screen bottom |
| AC-012i | display-and-selectors (no date events; generation set only by SELECT_GENERATION) | no date input element on any screen |
| AC-014c | invalidation (changing only the cause clears derived data, keeps the treatment selection) | byte-identical amounts and newly derived documents through a rendered flow |
| AC-014e | display-and-selectors; machine-transitions (return from documents or basis, 6 combinations) | landscape and large-text result layouts on return |
| AC-014g | machine-transitions (6 combinations of document entry) | the document screens themselves |
| AC-014h | display-and-selectors (large text toggled on document screens; `activeRequest` stays null) | that no request leaves the browser (network tap); rendered large text |
| AC-014i | display-and-selectors (orientation change both directions, including documents) | real viewport rotation and layouts |
| AC-015e | home-and-overlays (home button inside TimeoutDialog); idle-timers | dialog rendering, six result actions visible behind the dialog |
| AC-015f | idle-timers (completion hold, null never auto-returns); machine-transitions (finish clears the session before K06) | K06 rendering; "before painted" is shown only as "the first notified state already has an empty session" |
| AC-015g | home-and-overlays; idle-timers (ResetConfirm first, cancel behavior) | ResetConfirm rendering |
| AC-015j | home-and-overlays (screens without input reset directly); idle-timers | the button on screen 1 |
| AC-015k | home-and-overlays; idle-timers (7 tests on overlay ordering and fixed `resetAt`) | overlays rendered one at a time |
| AC-015l | request-overlays (ResetConfirm against 11 outcomes, both arrival orders) | e2e-app: the screen the patient sees |
| AC-015m | request-overlays (3 reset ways against late outcomes, abort mocked to no-op) | e2e-app |
| AC-015n | request-overlays (200 under TimeoutDialog; `resetAt` unchanged) | e2e-app |
| AC-015o | request-overlays (both orders, thresholds 160/180 after continue) | e2e-app |
| AC-015p | request-overlays (timeout against warn and reset thresholds) | e2e-app |
| AC-016a | purity and request-static (forbidden identifiers; `fetch` only in `deps.ts`); tests/boundary engine-module-identity and estimate-surface (scan exempts only `deps.ts`); default-transport (credentials omit, cache no-store) | runtime storage watching and a service-worker check in a browser |
| AC-016c | request-lifecycle (reset before the response, next patient starts, late response ignored); the AC-016i tests | e2e-app |
| AC-020b | request-lifecycle (409 and 422 TREATMENT_NOT_PUBLISHED go to K03 and start a refresh in the same transition); refresh-lifecycle; refresh-integration (real handlers, 409 round trip with new versions, 422 with the unpublished treatment dropped and a notice); request-settle (a late 409 of a non-active attempt starts nothing) | on-screen removal notice |
| AC-020h | refresh-overlays (ResetConfirm and TimeoutDialog against success, failure, connection failure, expiry, both arrival orders; `resetAt` unchanged) | e2e-app: inline notice and button visuals |

**Rows that need rendering are not closed by M5.** AC-012a..AC-020h rows in table (B) stay open until M6. AC-019c and AC-021d remain evidence-only and are not closed.

**Things M5 does not get at all**

- Anything needing pixels (every "e2e-app" half), real tab and timer throttling, real browser `fetch`, CORS and cookies, `Cache-Control` of the kiosk document, service workers (runtime parts of AC-016a and AC-016m).
- AC-016m browser storage dumps (M6, e2e). AC-016n is covered by the M4 server tests, not by any kiosk test.
- M7 items referenced by these AC (admin policy API, the 20 s floor).
- Request and refresh timeout values: plan.md §E #21 stays open; tests inject them, defaults are 15 000 ms each.
- AC-016j item 7, the recorded call order of settleRequest.

#### Evidence

Run by the orchestrator on the final tree. The author of this documentation step did not re-run them. The files live under `.moai/state/verify/` (gitignored, local only).

| Check | Result |
|-------|--------|
| Baseline before M5 (non-kiosk) | 105 files / 4833 tests |
| Full `npx vitest run --maxWorkers=4` on the final tree | 131 files / 5624 tests pass |
| Full-suite progression | 124 files / 5450 tests after M5.B; 128 / 5583 after M5.C; 131 / 5624 after M5.D |
| `npx tsc --noEmit` | exit 0 |
| `npx vitest run tests/kiosk --coverage --coverage.include='src/app/kiosk/**'` | 26 files / 791 tests; statements 444/444, branches 429/429, functions 161/161, lines 360/360 (100%) |
| `npx next build` | exit 0; routes are `/_not-found` and the three API routes only (no kiosk page yet) |
| `tests/kiosk` + `tests/boundary` after M5.D | 34 files / 1117 tests pass |

**Agent-run mutation checks** (M5.B 6, M5.C 10, M5.D 7 mutations; all detected, all restored). Failing-test counts are given where known.

| Mutation | Failing tests |
|----------|---------------|
| refresh guard dropped | 4 |
| outcomes classified as PATIENT | 4 |
| second GET replaced | 51 |
| refresh timer left armed | 21 |
| estimate allowed during a FAILED refresh | 35 |
| failure routed to KXX | 30 |
| resetSession not cancelling the refresh | 9 |
| removal not bumping inputRevision | 5 |
| applyInputs not cancelling the refresh | 6 |
| stale derived data kept | 1 |
| controller delay not clamped | 2 |
| request timeout not clamped | 1 |
| amounts check loosened | 9 |
| START keeps the old session | 6 |
| START resets display settings | 1 |
| default transport drops options | 2 |
| stray `fetch` in another kiosk file | 3 |

These are one-spot edits; they do not prove the absence of other defects. The per-stage totals (6, 10, 7) and the failing-test counts are taken from the orchestrator's brief; which stage each mutation belongs to is not recorded here.

#### Independent review

One read-only sync-auditor pass over the uncommitted tree: a fuzz of about 240 000 reducer steps and a controller fuzz with fake timers. Invariants checked: `activeRequest` set exactly when the screen is Calculating; `activeRefresh` set exactly when refresh is RUNNING; no Calculating while a refresh is needed; stale ids return the same state reference; `TimeoutDialog.resetAt` never moves; SYSTEM events never move `lastInteractionAt`; a direct REQUEST_ESTIMATE is rejected while `refreshState` is not NONE; timer count equals idle plus request plus refresh timers.

| # | Finding | Disposition |
|---|---------|-------------|
| F1 | timer delay could exceed the 32-bit timer limit | Fixed in M5.D (clamp to 2^31-1 ms via `timerDelay`) |
| F2 | 200-body amounts not strictly validated | Fixed in M5.D |
| F3 | START kept the old session contents | Fixed in M5.D: START creates a fresh empty session; it keeps large text and orientation by choice, flagged for the owner |
| F4 | the reducer does not itself enforce an overdue `resetAt`: a "계속 사용할게요" tap arriving after `resetAt` but before the late TICK is accepted | NOT fixed; low, relies on timers firing first |
| F5 | a FAILED refresh does not abort the sibling GET | NOT fixed; spec-literal, its late result is discarded |
| F6 | boundary-scan exemption too wide | Fixed in M5.D (only `src/app/kiosk/state/deps.ts`) |
| F7 | `createKioskControllerFromState` is an exported seam for tests and screen assembly; no static check forbids using it as a restore path | NOT fixed; M6 must not use it that way |
| F8 | default transport sent default credentials and cache behavior | Fixed in M5.D (`credentials: 'omit'`, `cache: 'no-store'`) |

Informational: PREV is accepted while a refresh is RUNNING (the lock is a view concern exposed by `selectRefresh().locked`; M6 must wire AC-020i); `crypto.randomUUID` needs a secure context.

The review did not cover real browser behavior, M6 wiring, e2e, lint, MX tags, or the accuracy of Korean comments.

#### Decisions and deviations

- (a) Pure reducer plus `EVENT_SPECS` plus an imperative controller shell. The controller and timeout handles live in the effects shells, not in state. This deviates from the DD-09 field-list wording (`controller`, `timeoutHandle`): state keeps data-only `ActiveRequest {requestId, sessionId, inputRevision}` and `ActiveRefresh {refreshId, sessionId, inputRevision, reason}`.
- (b) The reducer does NOT reject TOGGLE_TREATMENT or PREV while a refresh is RUNNING, because AC-020g(3) and DD-09 rule 5 require a direct input change to cancel the refresh and move it to FAILED. The lock is exposed as `selectRefresh().locked` for M6.
- (c) A successful refresh always clears derived data and return context (DD-08 refresh row) and bumps `inputRevision` only when a treatment was removed. `refreshNotice` carries removed treatments with their OLD display names.
- (d) 409 and 422 TREATMENT_NOT_PUBLISHED: `settleRequest` only releases the request and moves to K03; `settleOnEvent` then calls `beginRefresh` in the same reduce step (one notification). A late non-matching 409 starts nothing.
- (e) A refresh failure keeps K03_Treatments, never KXX, and sends no calculation request. Inline retry is a new refresh with reason RETRY.
- (f) Abort is issued only for EXPIRED and CANCELLED-family outcomes.
- (g) Analytics and log output carry outcome kinds and screen names only. Screen names in analytics SCREEN events are a policy question for the owner.
- (h) Request and refresh timeouts are injectable defaults of 15 000 ms; plan.md §E #21 stays open. An injected value above 2^31-1 ms expires at 2^31-1 ms.
- (i) The selection total uses the engine's `sumLineAmounts` (AC-019c evidence note).
- (j) START keeps display settings (flag for the owner).

#### Not done / unverified / open

- Nothing was run in a browser; no real device, orientation or timer throttling.
- No e2e.
- The default `fetch` path and CORS are untested against a real network; the credentials and cache init are asserted through a stubbed `fetch` only.
- Screens and the Pencil design are M6.
- `derived.basis` is never populated here (M6 fills it).
- Real server 5xx, ON_HOLD and exclusion outcomes are exercised only through the fake transport; the real handlers are exercised for 200, 409 and 422 TREATMENT_NOT_PUBLISHED round trips.
- AC-016a runtime storage watching, AC-016m and AC-016n are not covered by kiosk tests.
- AC-016j item 7 call order is structural, not a spy.
- No `moai` CLI, formal SPEC lint or CI run; there is no lint tool in the repo; platform only Windows 11 with Node 24.
- Model-profile injection (`moai model profile`) was skipped because the CLI is absent.
- The whole-SPEC audit status is unchanged (`plan_status: fail`); earlier FAIL records are history.
- M7, M8, the DB adapter and operating data are untouched.
- M4 follow-ups are unchanged and still open, and M5 did not touch them: `priceChanged` ownership for the past catalog in `src/server/api/estimate-versions.ts`, the `silentLog` production sink, the cache eviction policy, and the DD-14 owner-confirmation items.
- Open owner confirmations (plan.md §E #12, #13, #14, #15, #17, #20, #21, #36 and others) were taken as the accepted §E.9 values and not reopened. The START display-retention and analytics screen-name choices are flagged for the owner.

## §E.3 Run-phase Audit-Ready Signal

_<pending run-phase>_

## §E.4 Sync-phase Audit-Ready Signal

_<pending sync-phase>_
