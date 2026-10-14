# SPEC-REIMBURSEMENT-ESTIMATOR-001 — progress

## §E.1 Plan-phase Audit-Ready Signal

Plan-phase evidence (manager-spec, 2026-10-14). The audit-ready lines are added by the orchestrator after plan-audit. This SPEC is NOT audit-ready (see "Closing status" below).

- Baseline: HEAD `c1f5d76e6e36d7fc18b3a7fdc6c6d9dbe9d4e5b2` (`git rev-parse HEAD`), design blob `4b4a1587e4361996ec834b5122515051c84cf7e8` (`git rev-parse HEAD:design/design.pen`). `design/design.pen` was not opened during the original authoring (revisions 0-2). Revision 3 read it read-only, see "Design-file read evidence (revision 3)" below. Revision 3 was written on the plan branch at `3b48f310b10281b55da321d42b23978d3dda2827` in a separate worktree; the remote plan branch had no newer commit when revision 3 started (`git rev-list --count --left-right origin/plan/…...plan/…` printed `0 0`).
- SPEC ID format: the Bash regex check `[[ "SPEC-REIMBURSEMENT-ESTIMATOR-001" =~ ^SPEC(-[A-Z][A-Z0-9]*)+-[0-9]{3}$ ]] && echo PASS || echo FAIL` printed `PASS` in the initial authoring run. `ls -la .moai/specs` listed no other SPEC directory at that time. This checks the ID format and directory uniqueness only. (Iteration 4 notes that `spec-frontmatter-schema.md:38` uses a stricter regex that this ID does not match while `manager-spec.md:129` uses the looser one; not run through `internal/spec` lint, which is unavailable here.)
- Sources read: `보담_기획설계_v0.2.md` lines 1-673; `.moai/project/product.md` 1-251, `structure.md` 1-165, `tech.md` 1-173, `interview.md` 1-55; `.moai/project/design-requirements.md` 1-113, 150-199, 613-714 (rest by Grep for frame names/IDs only); `quality.yaml` (development_mode `tdd`, coverage 85, per-commit 80); `spec-frontmatter-schema.md`. Revision 3 additionally read 기획서 lines 138-227, 340-410, 476-506, 556-648 and design-requirements 672-714 and the workflow files `.claude/skills/moai/workflows/plan.md` (marker rule) and `.claude/agents/moai/plan-auditor.md` (MP-7).
- Tier: L — four surfaces (engine, server, kiosk, admin), expected file count well above 15, cross-domain. Artifacts: spec.md, plan.md, acceptance.md, design.md, research.md, plus spec-compact.md and this file.
- Budget (revision 3, script-counted by manager-spec and re-counted by plan-auditor): 25 top-level requirements (ENG 5, DATA 5, FLOW 6, API 4, ADM 5), 25 top-level acceptance criteria with **152** lettered sub-criteria (134 at revisions 1-2; revision 3 added 18). Tier L ceiling of 25 each for top-level items is unchanged; no top-level item was added.
- Revision 1 (2026-10-14): applied plan-audit review-1 (D-01..D-22) and owner decisions recorded in plan.md §A.5 (single SPEC, Vitest, operating data deferred).
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
- Clarification markers (revision 3, counted by script): 36 rows in plan.md §E.2-§E.5; **33 open, 3 closed** (§E.2 5 open; §E.3 6 open + 1 closed; §E.4 17 open + 2 closed; §E.5 5 open). Open rows with no SPEC default: 10 (#1, #2, #3, #4, #5, #12, #21, #22, #27, #35). All 33 open rows still block Implementation Kickoff Approval under the real workflow (`.claude/skills/moai/workflows/plan.md` lines 53 and 73; plan-auditor MP-7 grep; CLAUDE.md §2 stage ④ and §8). 11 operating-data items are deferred by owner decision in plan.md §E.1 and carry no marker.
- Wording pass (reported by the orchestrator, not performed or re-verified by manager-spec): the final native-idiom wording pass of revisions 0-2 edited 13 lines using the hazard list in `native-idiom-and-register.md`, because the `moai-domain-humanize` skill was unavailable in this repository. Revision 3 ran no humanize pass (the skill is still not present); plan-auditor's grep for the hazard words (3축, 세 축, 기둥, 검증경제, 예산방어, 회로차단기) found none.
- Nothing was implemented, built, rendered, or run. The only things executed were file-text scripts (grep/Node) and read-only node/text queries of a copy of `design/design.pen` (a file-level check, not a rendering).

### Plan-audit record (orchestrator, 2026-10-14)

Audit reports live under `.moai/reports/plan-audit/` and are git-ignored, so the outcome is recorded here. The iteration-4 report is `.moai/reports/plan-audit/SPEC-REIMBURSEMENT-ESTIMATOR-001-review-4.md` in the worktree `C:/Users/Nexsol/Documents/bodam-wt-reimb`; it is not committed.

| Iteration | Verdict | Score (Tier L threshold 0.85) | Failing must-pass |
|-----------|---------|-------------------------------|-------------------|
| 1 | FAIL | 0.77 | MP-7 |
| 2 | FAIL | 0.86 | MP-7 |
| 3 | FAIL | 0.87 | MP-7 |
| 4 (revision 3, final files) | FAIL | 0.84 (harmonic mean; arithmetic mean 0.85) | MP-7 |

- Iteration 4 category scores: Clarity 0.75, Completeness 0.85, Testability 0.85, Traceability 0.95. MP-1, MP-2, MP-5, MP-6 PASS; MP-3 PASS with a reservation (the schema regex disagrees with `manager-spec.md:129`; lint not run); MP-4 N/A; **MP-7 FAIL (33 open markers)**.
- Audit mode of iteration 4: Claude-only. The `moai` MCP server and CLI were not available in this session, so there was no second-model opinion, no `internal/spec` lint, and no session-registry or model-profile query (agents ran on the session's default model). Iteration 4 is past the 3-iteration cap; it was run because the review request asked for a re-audit of the final files. The auditor's STOP signal (score fell from 0.87 to 0.84) was followed: no further revision was made after the audit.
- The audited files are exactly the files in the commit (blob ids from `git hash-object`): spec.md `f2602a405d3714414b0c55ab029928d3896242a4`, plan.md `15e0d2db82151b46531b4fc27e8f29df9693241b`, acceptance.md `e7d917f89ba7663050a6d9fbbf4ef02b5bdee3b0`, design.md `dad4d4b39f36990bda75c36fa8fa701f1855d509`, research.md `f02c5762c79456c0f473fa04df487607950f5f2c`, spec-compact.md `9e7205f22e973e431584d2783c919c84dec39d9c`. Only this progress.md was edited after the audit.
- Mechanical results confirmed by the auditor: 25/25 requirement ↔ acceptance traceability in both directions; 152 sub-criteria each closed by exactly one milestone; spec.md and spec-compact.md requirement texts identical; 21 hold codes consistent across DD-03, DD-04, DD-21 and acceptance.md; all `DD-`, `AC-`, `§E #`, `§H`, `§F` references resolve; all worked examples (AC-002, AC-004d) recomputed correctly; spot-checked source line citations match; no time estimates; no invented owner approval found; no open row was closed or hidden to pass the gate.

Separate statuses (do not read one as another):
- Score threshold met: **no** (0.84 < 0.85).
- All must-pass items met: **no** (MP-7 fails; it is independent of the score and cannot be fixed by revising documents).
- Owner approval: **none given in revision 3.** The only owner decisions on record are those in plan.md §A.5. The 33 open rows are presented to the owner at the Implementation Kickoff Approval gate. Caveat D11 below.
- Operations ready: **no.** Nothing is implemented; the 11 held operating-data items (plan.md §E.1) are not supplied; the DD-23 readiness table is all `NOT_READY` by design.
- Not run, therefore not passed: any unit/integration/e2e test, build, type-check, render, screenshot, real-device check, `internal/spec` lint, cross-model audit.

Closing status: `plan_status: fail` — the iteration-3 condition `pass-with-debt` (score met, only MP-7 failing) no longer holds because the score is now below the threshold as well. This SPEC is NOT `audit-ready`; the `plan_complete_at` / `audit-ready` signal is intentionally not written.

Remaining defects from iteration 4 (not fixed after the audit; proposed fixes are in the audit report):

| ID | Severity | What | Status |
|----|----------|------|--------|
| D1 | critical | MP-7: 33 open `[NEEDS CLARIFICATION` rows (plan.md §E) | Needs the owner at the kickoff gate; cannot be closed by editing |
| D2 | major | Some sub-criteria close in a milestone that precedes the code they test: AC-021a (admin 401/403/400 in M4 while admin is M7), AC-021e (kiosk document in M4, kiosk page is M6), AC-019c and AC-021d (kiosk code starts in M5), AC-011e and AC-011h (HTTP 400 in M3 which has no HTTP layer), AC-010b (production entry point not created before M4) | Open |
| D3 | major | progress.md stale (134 sub-criteria; 36 unresolved) | Fixed in this file |
| D4 | major | design.md DD-23 (line 850) adds three readiness tables with no requirement sentence or acceptance criterion | Open |
| D5 | major (optional) | Two undefined ways to express a confirmed exclusion (group `coverage: 'EXCLUDED'` vs mapping `decision: EXCLUDED`) | Open |
| D6 | major (optional) | Mapping resolution: ambiguity check vs fingerprint order between DD-03 and DD-04; reason choice among several non-usable records | Open |
| D7 | major | AC-003h boundary is not satisfiable as written: at `E = floor(MAX_SAFE_INTEGER/10000)` rate 10000 with ROUND_HALF_UP overflows on the `+5000`, and at rate 2000 the `E+1` side never overflows; DD-24 does not say the guard is rate-independent. The orchestrator re-computed this and confirms it | Open |
| D8 | minor | REQ-FLOW-004 vs DD-07/AC-015e: does the TimeoutDialog's "처음으로" show ResetConfirm? | Open |
| D9 | minor | `DocumentRule.when` evaluation semantics undefined; no AC exercises flags, insurerType or setting | Open |
| D10 | minor | Pen-derived facts rest on the orchestrator's Pencil read, not stored | The read is now recorded below; the auditor could not open the .pen file, so #25 and #28 remain supported by that read plus 기획서 line 67 and design-requirements line 586 |
| D11 | minor | plan.md §F 6 and §A.5.1 call the removal of the platform operator's emergency suspend an "소유자 결정", but this file lists no such decision. The review request of this revision also says not to add such a feature, which agrees with the removal, but it does not date or confirm the earlier attribution | Open; needs the owner to confirm the attribution |
| D12 | minor | Open owner rows (#6, #23, #24, #30, #32, #34) read as plain norms in some REQ sentences | Open |
| D13 | minor | 400 vs 422 layering for generation, cause, insurerType validation | Open |
| D14 | minor | Weak measurement methods in AC-005a, AC-017a, AC-017g | Open |
| D15 | minor | `isUsable` signature vs bundle status; pool limit kinds; `groupOrder` completeness | Open |

Suggested next step (a choice for the owner/user, not taken here): one small revision for D2, D4, D7 (plus the optional D5, D6, D9, D13, D15), followed by one more audit; the 33 open rows still go to the kickoff gate either way.

### Design-file read evidence (revision 3)

- File: `design/design.pen`, blob `4b4a1587e4361996ec834b5122515051c84cf7e8` (same at `c1f5d76` and at the plan branch HEAD `3b48f31`). Read on 2026-10-14 through the Pencil MCP tools on a COPY placed in the session scratchpad (SHA-256 of the copy equal to the original: `E0C96C1CBC559FB5E548912EC9958A95686F75F12BFA2566ECA5D5AD770E1F3D`). Only read calls (`Get`, `Print`) were issued; no edit, no screenshot, no export. After the reads, `git hash-object design/design.pen` on the original again printed `4b4a1587…` and `git status` showed no change to it. This is a file-level check of node trees and texts, not a rendering check.
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

_<pending run-phase>_

## §E.3 Run-phase Audit-Ready Signal

_<pending run-phase>_

## §E.4 Sync-phase Audit-Ready Signal

_<pending sync-phase>_
