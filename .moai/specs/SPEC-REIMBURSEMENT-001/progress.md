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

## §E.3 Run-phase Audit-Ready Signal

_<pending run-phase>_

## §E.4 Sync-phase Audit-Ready Signal

_<pending sync-phase>_
