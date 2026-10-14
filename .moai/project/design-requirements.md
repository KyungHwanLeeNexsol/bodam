# Design Requirements and Review Criteria: 보담 (bodam)

> Status: planning only. Derived from `보담_기획설계_v0.2.md` ("§N" refers to it) and from read-only inspection of `design/design.pen`. Review basis commit: `f0520ad6da6caa78e40a1d45f56caa54eb6e8ce8`. Later saves of the same file are recorded separately in section 5.3: the save committed as `fecc9fa`, and the rebrand save (service name 보담, new color palette) committed as `836a8f6`. The brand-change review at repository HEAD `a9ffcfd` (save `c4a5800`) is recorded in section 5.7; the review of the next save is section 5.8, and the rendering check of that same save is section 5.9. The review of the save after that (a working-tree save that is not committed, blob `c68530b…`) is section 5.10, and the review of the next working-tree save (blob `01bacca…`, which adds the cause step) is section 5.11. Nothing here claims that the app exists or that any device was tested; a screen is claimed as rendered only where section 5.9 (for `08e3f22…`), 5.10 (for `c68530b…`), or 5.11 (for `01bacca…`) says so. `design/design.pen` is edited only by Pencil; MoAI reviews it and never writes it.

> **Latest review (current state): section 5.11.** Repository HEAD `57f5c019c73cf57f33fb02f7c2bc75e1bfd50805`; `design/design.pen` git blob `8709809b5801d324de95e08eb779d3beee861936`, committed in the `design:` commit that comes just before this documentation commit (before it, HEAD held `08e3f2209ff29fd330cf1affc0126642f1857002`). Section 5.10 records the save `c68530b…` (removal of the condition questions and the consultation screen); 5.11 records the save after it, which adds a cause step (injury / illness / unknown), so the input flow is now four steps. 5.11.1 to 5.11.4 were read as blob `01bacca…`; the font sentences were changed afterwards (5.11.5), which gives `8709809…`, and the counts (80 top-level frames, 1,770 nodes, 775 text nodes) did not change. Other differences between `01bacca…` and `8709809…` were not compared. Since `08e3f22…` the design changed a lot: the condition-question screens (`K02Q_*`), the consultation screen (`K05_Consult`), every "staff inquiry" button, and the unconfirmed-result screen (`K04_Result_Unconfirmed`) are gone; the input flow is three steps (generation, insurer type, treatments); a required-documents screen (`K07_Documents`) and ten `PDF_*` flow pages were added. **Section 5.11 records the next change (2026-10-13, same working tree): a cause step was added as input step 3, making the flow four steps, and a branched documents screen was added for the unknown cause; where 5.10 disagrees with 5.11, 5.11 is the current state.** Sections 5.2 to 5.9 are dated records of earlier saves (`f0520ad`, `fecc9fa`, `c4a5800`, `08e3f22…`) and are kept as they were; where they disagree with 5.10, 5.10 is the current state. Sections 2 to 4 and 7 were rewritten for the current design; rows of section 3 that describe screens that no longer exist are marked retired, not deleted, so references to row numbers stay valid. 5.10 and 5.11 read the document open in Pencil with read-only calls: structure-and-text reviews plus a few rendered screens. No app exists.

## 1. Purpose and ownership

- Pencil edits `design/design.pen`. MoAI maintains the requirements below and reviews each saved revision against them.
- This file is the checklist the review uses. An item is marked complete only after the saved file was actually read; a report from Pencil that a change was made is not completion.
- Status labels used in section 5:

| Label | Meaning |
|-------|---------|
| 파일 구조·문구 확인 완료 | Found in the saved `.pen` JSON (structure, node text, component properties). Says nothing about how it looks |
| 추가 수정 필요 | The saved file does not yet meet the requirement, or the file disagrees with a source document whose rule is already fixed. Pencil must change the file; an owner decision is listed only where the source documents themselves leave the rule open |
| 실제 렌더링 미확인 | Clipping, overlap, alignment, and touch area were not seen on a rendered screen |
| 앱 동작 미검증 | No app exists; behavior (timers, reset, calculation, permissions) was not run |

- "추가 수정본 대기" marks an item whose Pencil change was requested and is not in the saved file read in the latest review. It is not a completion state: the item closes only after the saved file is read again and shows the change.

## 2. Kiosk operation specification (design reference values)

These numbers are design references. They are not an accessibility certification and do not mean any real device was verified (§13.1).

| Item | Value |
|------|-------|
| Primary button default height | 88, written directly as `height: 88` on the `Button_Primary` / `Button_Secondary` components. The variable `h-btn` = 88 is kept as the implementation token; binding the component height to it is not a pass condition (see 5.5) |
| Minimum primary touch area when implemented | 72 CSS px or more |
| Selection card height target | 120 or more |
| Body text | 24 or more |
| Title | 36 or more |
| Key result number | 56 or more |
| Spacing between major elements | 16 or more |
| Provisional portrait / landscape review size | 1080x1920 / 1920x1080 (not real device specs; real size and resolution are undecided) |
| PC admin screens | Separate specification (reference frames are 1440x1024); the kiosk values above do not apply |

- Large-text mode is a required MVP feature, not a candidate. Buttons, amounts, and key guidance must not clip in it, selections persist, and it keeps every function of the normal mode (on the result screen: view required documents, view the calculation basis, reselect treatments, edit insurance conditions, start over, finish).
- Touch-only completion and assistive keyboard operation are both required and do not conflict: a patient completes the whole flow without a physical keyboard; with a keyboard present, navigation, selection, and confirmation work, focus is visible, and modals trap and then restore focus.

### 2.1 Text contrast criteria

Added at the brand-change review (5.7). The ratio is the WCAG 2.x contrast ratio between a text color and the color directly behind it. Like the values above, these are design review criteria, not an accessibility certification, and a passing calculation does not mean any real device was checked.

| Text | Minimum contrast |
|------|------------------|
| Normal text | 4.5:1 or more |
| Large text: 24 px or more, or 18.66 px or more in bold (the WCAG 2.x large-text definition) | 3:1 or more |
| Kiosk key guidance: anything a patient must read to continue, to understand a condition or amount, a warning or state such as "확인 필요", button labels, consultation guidance | Aim for 4.5:1 or more where possible, even when the text is large |

Exceptions, kept apart so none is applied by habit:

| Exception | Scope | Limit |
|-----------|-------|-------|
| Logo | The `Wordmark` component and the wordmark texts (start screens, admin headers) | Applies to the logo only, not to the service description beside it |
| Decoration | Shapes, dividers, and fills that carry no information | Text is never decoration |
| Inactive control | Text of a control that is actually disabled (state = disabled) | A placeholder or note that merely looks faded is not an inactive control and follows the rows above |

Two kinds of statement are never merged:

- **계산 결과**: the ratio computed from two color variables (solid backgrounds only; the nearest ancestor with a solid fill is taken as the background). It says nothing about what is on a screen. A failed calculation is a fix item for Pencil, not an owner decision; a passed calculation is not a rendering pass.
- **렌더링 확인**: the pair was seen on a rendered screen of the same saved revision. Not done so far (5.7).

## 3. Behavior requirements the design must express

| # | Requirement | Related frames |
|---|-------------|----------------|
| 1 | **Retired (save `c68530b…`, 5.10.2 row 2):** the `K02Q_*` screens no longer exist and no deduction-type or outpatient-limit question is asked; replaced by rows 16 and 17. Former requirement, kept for history: Insurance conditions are separate questions: deduction type and outpatient coverage limit, each with its own "모르겠어요". The limit question must not contain a deduction-type answer such as "선택형Ⅱ 가입이에요". Only limits and deduction types registered in a confirmed policy are offered; otherwise "확인 필요". No staff-entry feature is implied unless its flow and permission are defined | `K02Q_Conditions_Unknown` (H5Xw9I), `K02Q_Conditions` (VwsQ9), `K02Q_Conditions_Copay`, `K02Q_Conditions_LimitValue` |
| 2 | **Resolved by the owner (2026-10-13, 5.11):** the cause is asked on its own screen, input step 3 of four. The cause value feeds the documents screen only and is not an input to the amount calculation, so "잘 모르겠어요" does not put the result on hold; it splits the documents list instead (row 18). Help text must stay cause-based, not symptom-only: injury = an external, sudden event (넘어짐·부딪힘·화상); illness = a condition that arose in the body (통증·염증·질환). The removed `K02Q_Conditions` wording for the unknown case ("직원에게 확인해 주세요") does not return: the patient may proceed without knowing | `K02b_Cause_Empty` (QfXL0), `K02b_Cause_Selected` (FFtQN), `L_K02b_Cause` (CpUd6), `K07_Documents_Unknown` (J6jAj) |
| 3 | Hospital administrator edits menu and prices, registers coverage-classification fields (benefit class, procedure code, treatment class) or requests a change to them, views review status (read-only), requests review, and reads the result and rejection reason. Only the insurance-rule reviewer approves or rejects. No "검토 완료" control lets a hospital administrator approve a coverage mapping. A classification change requires re-review; a price-only change does not | `A03_Admin_TreatmentEdit` (ECPf6), `A02_Admin_TreatmentList` |
| 4 | **Resolved in the save of 2026-10-14 (5.12).** All results distinguish 예상 병원 결제액, 예상 보험금, 보험금 수령 후 예상 본인 부담, in that order and with the same wording, and the last one is not readable as today's hospital payment. Its caption is "보험금을 받은 뒤 남는 예상 부담액이며, 오늘 병원에 결제할 금액이 아닙니다." | `K04_Result` (TJoQ2), `K04_Result_NotCovered` (XxmHQ), `L_K04_Result` (n3WXk), `K04_Result_Dialog_Timeout` (YcF5k) |
| 5 | (At save `c68530b…` no frame shows the unconfirmed-hold result: `K04_Result_Unconfirmed` was removed, 5.10.3 item O.) State handling: unconfirmed condition = hold, "확인 필요", null; network error = failure and retry, null; confirmed exclusion = item 0 won with reason; normal 0 won = 0 with basis. Confirmed-unknown is never shown as excluded | `K04_Result_Unconfirmed` (Ni5aI), `K04_Result_NotCovered` (XxmHQ), `KXX_Error_Network` (bWvFJ) |
| 6 | (At save `c68530b…` the phrase "선택한 치료가 모두 보장 대상" appears 0 times in the file, and the node `MzQqc` is now the `HelpPanel` body, not an assumption text.) A result that excludes some treatments must not carry the assumption text "선택한 치료가 모두 보장 대상". The assumption instance and the hand-off note must be consistent with the displayed numbers | `K04_Result_NotCovered` (XxmHQ): assumption instance `reynT` / text `MzQqc`; `ZZ_HandoffSpec` (cvUDQ) / text `bI1cW` |
| 7 | Idle reset: input screens warn at 100 s and reset at 120 s; result screens warn at 160 s and reset at 180 s. The warning shows remaining time, "계속 사용할게요", and "처음으로"; extension is repeatable and restarts the idle time | `ZZ_HandoffSpec` (cvUDQ) text `MVOb1`, `K04_Result_Dialog_Timeout` (YcF5k), `K03_Treatments_Dialog_Reset` (r4N0OQ) |
| 8 | **Retired (save `c68530b…`):** `K05_Consult` and every consultation or "staff inquiry" button were removed (`ZZ_HandoffSpec` `H0AWKZ`, Note 4 `h4y2ZY`); replaced by row 19. Former requirement, kept for history: A consultation entry exists on the normal result screen as well; returning from consultation keeps the selections and result; "이용 완료" (user ends) and automatic reset are distinct. 1544-8069 shown as the user-provided number; operating entity and hours unconfirmed; "1588" not completed; no real call or staff-call feature | `K04_Result` (TJoQ2), `K05_Consult` (SmZwC) |
| 9 | Button components carry height 88 (a direct value is acceptable). An instance either inherits it or sets a larger value; an instance below 88 is a finding | `Button_Primary` (s8D6J), `Button_Secondary` (m1gMGk) |
| 10 | **Retired (save `c68530b…`):** no condition questions exist; the result uses a standard assumption (row 17). Former requirement, kept for history: Condition questions are built from the selected product's reviewed condition data, not fixed per generation; only needed questions are asked; the deduction-type question is asked for any generation whose product needs it. Patient condition screens carry only the question, options, a short help text, and "모르겠어요". No "N", generation rule list, question-count method, data/option-generation explanation, or "staff entry not offered" note on a patient screen; that content lives in `ZZ_HandoffSpec` | `K02Q_*`, `ZZ_HandoffSpec` (cvUDQ) |
| 11 | **Retired for condition screens (save `c68530b…`).** The one remaining "unknown" control, "세대를 모르겠어요" on step 1, goes to `K01_Generation_Unknown` (row 16). Former requirement, kept for history: Every "모르겠어요" / "모르는 채로 계속" / "목록에 없어요" on a condition screen has one destination rule: record that condition as "확인 필요" and go to the remaining needed question, or to `K03_Treatments_Empty` when none remain. No two hand-off rows give the same control different destinations | `ZZ_HandoffSpec` (cvUDQ), `K02Q_*` |
| 12 | **Resolved in the save of 2026-10-14 (5.12).** Every result screen that represents a finished calculation offers the same six actions, "보험 청구에 필요한 서류 확인" included. Large text is no longer a set of dedicated frames (owner decision of 2026-10-14): the "큰 글자 보기" toggle stays in `KioskHeader`, and the enlarged layout is produced responsively at implementation, so this row is checked on the built screen, not in the design file | `K04_Result` (TJoQ2), `K04_Result_NotCovered` (XxmHQ), `L_K04_Result` (n3WXk); toggle `MkKly` in `KioskHeader` (nacd2) |
| 13 | Admin copy describes what the admin UI actually allows: where benefit class and procedure code are editable, the text says they are registered or change-requested, and what a change does before approval, as fixed in row 14 | `A03_Admin_TreatmentEdit` (ECPf6) |
| 14 | Admin change rules (fixed by `보담_기획설계_v0.2.md` §7 "변경 종류별 재검토 기준", `product.md` (the line on re-review triggers), `structure.md` (the "Review trigger split" paragraph); not an open decision). A change that affects the coverage judgement (treatment or procedure code, benefit/non-benefit class, insurance calculation class) invalidates the existing approved mapping, and the expected payout of that treatment is on hold until re-review. A price-only change keeps the approved mapping and is published as a new price version with a change history. Every admin sentence about these changes must say the same | `A03_Admin_TreatmentEdit` (ECPf6) `VLDdc`, `F8XwNC`, `Pz5m4`; `ZZ_HandoffSpec` (cvUDQ) `JKWXH` |
| 15 | (At save `c68530b…` the list has 21 of the 23 color variables: 5.10.3 item Q.) The color list in `ZZ_HandoffSpec` equals the file's color variables (name and value), and all text meets the criteria in 2.1 | `ZZ_HandoffSpec` (cvUDQ) `lwc8y`; all frames |
| 16 | The input flow has four steps: 1/4 실손 (one of five generation cards, plus "세대를 모르겠어요"), 2/4 보험사 형태 (one of three: 손해보험사, 생명보험사, 그외 공제 조합 (우체국, 새마을금고 공제회, 농협)), 3/4 치료 원인 (상해 · 질병 · 잘 모르겠어요), 4/4 치료. The waiting screen (`K00`) and the result (`K04`) are not counted as steps. "다음" stays disabled until a choice is made. "세대를 모르겠어요" leads to `K01_Generation_Unknown`, which gives ways to check the enrollment date and the number 1544-8069 and returns to step 1; no generation is chosen for the patient, and no path leads to the treatment-cost total without a generation (owner decision of 2026-10-13). The two unknown controls differ by design: an unknown generation blocks the calculation, an unknown cause does not (row 2) | `K00_Start` (u5CZTt), `K01_Generation_Empty` (Z3izyJ), `K01_Generation_Selected` (lYlRt), `K01_Generation_Unknown` (p1nNbK), `K02_Type_Empty` (ghhVb), `K02_Type_Selected` (eDRoY), `K02b_Cause_Empty` (QfXL0), `K02b_Cause_Selected` (FFtQN), `K03_Treatments_*`, `ZZ_HandoffSpec` (cvUDQ) `eLIvV` |
| 17 | No condition questions are asked. The result uses a standard deduction and limit assumption for the chosen generation and insurer type, says so on the result ("표준 공제·한도 가정으로 계산한 예상 금액입니다"), and shows the applied assumption on the basis screen with "(가정)" marks. The wording must not let the after-payout burden be read as today's payment (row 4). What the standard values are for each generation and insurer type is defined nowhere yet; the owner will attach a table (image) to the GPT review request, and the values are entered in the documents and made into data afterwards (section 7) | `K04_Result` (TJoQ2), `K04_Basis_Calculation` (GhMYi), Note 3 (`RgdZA`) |
| 18a | **Added in the save of 2026-10-14 (5.12).** The documents screen is reachable from every finished-calculation result — normal, not-covered, and landscape — not only the normal one; the branch rule is the same from each (cause 상해/질병 → `K07_Documents`, cause unknown → `K07_Documents_Unknown`). "결과로 돌아가기" returns to the result the patient came from, never a fixed normal result, and keeps the result state, screen orientation, large-text setting, selections, and amounts. Landscape variants exist; large text is responsive at implementation and has no frame | `K07_Documents` (F19r1B), `K07_Documents_Unknown` (J6jAj), `L_K07_Documents` (CL4xk), `L_K07_Documents_Unknown` (mZDkv), `ZZ_HandoffSpec` transition rows `ekJGP`/`kw3S4`/`yOzQX`/`hLTpH` |
| 18 | Required-documents screen: reached only from the result button "보험 청구에 필요한 서류 확인"; asks nothing more; lists all nine lines always and gives a one-line reason to each document the case needs; receipt and itemized statement are one line, always required; states that the requirement needs verification; "결과로 돌아가기" keeps selections and result; "이용 완료" is offered. When the cause is unknown (row 2), the same nine lines are grouped instead of repeated: seven common lines, one injury-only line (초진기록지), one illness-only line (진단서); the two conditional groups sit side by side so the either/or reads at a glance, and the basis line says "상해 또는 질병 (선택 안 함)". The screen must not pick one cause for the patient | `K07_Documents` (F19r1B), `K07_Documents_Unknown` (J6jAj), `ZZ_HandoffSpec` (cvUDQ) `bAkLF`, `W4yt8`, `CEVX5`, `H9b4Jv`, `h9KK9R`, `oFMti`, `pQTqj` |
| 19 | No consultation screen and no staff-inquiry button anywhere. 1544-8069 appears only as text (generation-unknown guidance and the `A01` setting). Text guidance such as "접수 직원에게 문의해 주세요" may remain as text but must not look like a control. The error screen offers "다시 시도" and "이용 종료". "이용 완료" (user ends) and "처음으로" (confirmation, then reset) stay distinct | `ZZ_HandoffSpec` (cvUDQ) `H0AWKZ`, Note 4 (`h4y2ZY`), `KXX_Error_Network` (bWvFJ), `K01_Generation_Empty`, `K01_Generation_Unknown`, `A01_Admin_HospitalSettings` (HHJq7) |

## 4. Review checklist for a saved Pencil revision

Run after Pencil reports a saved revision, against the actual file in the working tree:

1. `git status`, `git ls-files --eol`, `git diff --stat` for `design/design.pen`: confirm a revision exists, line endings are LF, and the diff is a content change and not a whole-file rewrite caused by line-ending conversion. Record the git blob (`git hash-object design/design.pen`) of the file that was read, and compare it with `HEAD:design/design.pen`, so a later save is never mistaken for the reviewed one.
2. Parse the file as JSON; list top-level frames and confirm the IDs in section 3 still exist.
3. Check component and variable references resolve. For buttons, check the component height (88, direct value allowed) **and** each instance: an absent `height` means it inherits the component's 88; an explicit value is compared with 88. Do not report an instance as inconsistent only because its own `height` is absent. Whether `h-btn` is bound is recorded but is not a pass condition.
4. Search the file text for the old wording (section 5) and for the new required wording (section 3).
5. Check consistency across portrait (K*), landscape (L_K*), and exception frames: same amounts, same terms, same assumption text, same actions. Large-text frames no longer exist (owner decision of 2026-10-14); large text is checked on the built screen instead.
6. Check the numbers on result frames against the examples in `보담_기획설계_v0.2.md` §6.4 (A to E).
7. If Pencil can render screens or screenshots are provided of the same saved revision: check text clipping, overlap, button size, and content outside the frame. Otherwise record "실제 렌더링 미확인". Exported images that predate the save being reviewed are not evidence for it.
8. A structural check (steps 1 to 6) never counts as proof of rendering or app behavior.
9. Brand and color: compare the `ZZ_HandoffSpec` color line (`lwc8y`) with `variables` entry by entry (name and value; also report variables missing from the line). Check the string variable `service-name` and the wordmark texts, and count occurrences of the old name in the file and in tracked files other than history records.
10. Contrast: for every text node, resolve its fill variable and its nearest solid background, compute the ratio, and compare with 2.1 using the node's font size and weight. Report nodes whose background could not be resolved (gradient, image, instance override) as unresolved, never as passing. Record this as 계산 결과 only (2.1).
11. Flow: confirm the four-step input flow (section 3 row 16), that the retired frames (`K02Q_*`, `K04_Result_Unconfirmed`, `K05_Consult`, `K03_Treatments_LargeText`, `K04_Result_LargeText`) are absent, and that every result variant (normal, not-covered, landscape) offers the same actions (row 12) and the same documents entry (row 18a).
12. Untracked outputs: record `design/previews/`, `design/pdf-assets/`, and `design/deliverables/` as untracked. An exported image is evidence for a save only if it can be tied to that save (step 7).

## 5. Review record

### 5.1 Past record (superseded)

The first observation was made at commit `5d4c4fc` before any revision was saved: the old wording was present in the file, the working file equalled `5d4c4fc`, and no screen was rendered. Those statements described that moment only and no longer describe the repository. The same is true of the statement in `62d38bd` that blob `6cede25…` was an uncommitted working-tree save: it was committed as `fecc9fa`. These are kept here as history; the current state is in 5.2 to 5.6.

### 5.2 Review basis: committed `f0520ad`

`design/design.pen` at `f0520ad` is Pencil's first saved revision: git blob `9cd193139598d156caff45e6cb4b66cac7e3200e`, 826,452 bytes, LF, 73 top-level frames, 1,655 nodes. Read from the committed blob.

| # | Item | Status at `f0520ad` |
|---|------|---------------------|
| 1 | Condition separation (deduction type vs limit) | 파일 구조·문구 확인 완료: separate frames `K02Q_Conditions_Copay` and `K02Q_Conditions_LimitValue`; "선택형Ⅱ 가입이에요" not among the limit options |
| 2 | Cause-based injury/illness wording | 파일 구조·문구 확인 완료 |
| 3 | Admin permission | 파일 구조·문구 확인 완료 for "no 검토 완료 control, 검토 요청 only"; but see 5.4 item E (UI vs copy) |
| 4 | Three result amounts, examples A and E numbers | 파일 구조·문구 확인 완료 |
| 5 | NotCovered assumption text, unconfirmed state text | 파일 구조·문구 확인 완료 |
| 6 | Timer warnings 100 s / 160 s, consultation entry | 파일 구조·문구 확인 완료 |
| 7 | `K02Q_Conditions` "모르겠어요" destination | 추가 수정 필요: `ZZ_HandoffSpec` listed the control twice with different destinations (to `K02Q_Conditions_Unknown`, and to the next needed question) |
| 8 | Product-needed conditions vs fixed per-generation rules | 추가 수정 필요: hand-off text said the questions follow generation, while also saying they depend on the product |
| 9 | Internal text on patient screens | 추가 수정 필요: "1 / N", "N은 선택한 상품에서…", "표시 규칙 — 1세대(A·S)는…", and the staff-entry scope note appeared on `K02Q_*` patient frames |
| 10 | Large-text result: condition-edit entry | 추가 수정 필요: `K04_Result_LargeText` had 계산 근거 보기, 다시 선택, 직원에게 문의, 처음으로, 이용 완료 but no "보험 조건 수정" |
| 11 | Admin classification UI vs scope text | 추가 수정 필요: copy said admins edit only name, description, and amount, while the screen shows 급여 구분 and 행위 코드 controls |
| 12 | Button height | See 5.5 |

### 5.3 Saves after `f0520ad`

Three saves exist after the review basis. Each version was read by parsing the JSON and comparing nodes by id; a text search alone was not used as evidence. The middle one, `f8f28cc…` (09:33 on 2026-10-13, 819,382 bytes), was overwritten in the working tree by `c4a5800…` (09:51) before it was committed, so it appears only in this sentence; its changes are contained in `c4a5800`.

| | `f0520ad` | `fecc9fa` (committed 2026-10-12 22:50) | Latest save `c4a5800` (committed as `836a8f6`) |
|---|---|---|---|
| git blob | `9cd193139598d156caff45e6cb4b66cac7e3200e` | `6cede25c6354ef868133dcfd3e29f0d4e2a8f154` | `c4a580051cfa9a203d201e5e12a1f75f46caa39b` |
| bytes | 826,452 | 819,114 | 820,290 |
| file time | not recorded | 22:30 on 2026-10-12 | 09:51 on 2026-10-13 |
| top-level frames / nodes | 73 / 1,655 | 73 / 1,640 | 73 / 1,640 |
| line endings | LF | LF | LF, 0 CR (`git ls-files --eol`: `i/lf w/lf attr/-text`) |

`fecc9fa` is the save that an earlier version of this document (`62d38bd`) described as an uncommitted working-tree save; it has since been committed. The latest save `c4a5800` is newer than `fecc9fa`. MoAI read it from the working tree, and again from the committed blob after Pencil's save was committed on its own as `836a8f6`; MoAI did not write it.

Differences from `f0520ad` to the latest save: 4 nodes added, 19 removed, 125 changed.

- 54 changed nodes differ only in `height`: no own `height` became an explicit 88 (see 5.5).
- 71 changed nodes differ in other properties. By frame: `ZZ_HandoffSpec` 20, `A03_Admin_TreatmentEdit` 10, `K02Q_Conditions_LimitValue` 7, `K02Q_Conditions_Copay` 5, `K02Q_Conditions_Unknown` 5, `K02Q_Conditions` 4, `A01_Admin_HospitalSettings` 4, `K04_Result_NotCovered` 3 (padding and gap only), `K04_Result_LargeText` 3 (one action label and spacing), `A04_Admin_PublishPreview` 2, `Wordmark` 2, and 1 each in Note 2 (`ZxXPh`), `K00_Start`, `L_K00_Start`, `A02_Admin_TreatmentList`, `TimeoutDialog`, `ConfirmDialog`. The service-name, color, gradient, and shadow changes are described below.
- Added: "Action 보험 조건 수정" (`z8y27X`, height 88) and its row frame (`dZtYu`) in `K04_Result_LargeText`; two `ZZ_HandoffSpec` lines (`JPZxN`, `LvJu6`).
- Removed: 4 frames and 12 text nodes in `ZZ_HandoffSpec`, and 3 internal-explanation text nodes on `K02Q_*` patient frames (`RQ3du`, `ehGIm`, `JTNHi`). The "표시 규칙" notes (`I0NIg`, `fMUNw`) were replaced by the generic "확인 필요" notice.
- No text changed in `K04_Result`, `K04_Result_Unconfirmed`, `L_K04_Result`, `KXX_Error_Network`, `K04_Result_Dialog_Timeout`, `K05_Consult`, `K03_Treatments_Dialog_Reset`, or in the timer and state notes (`MVOb1`, `bI1cW`). The 5.2 results for items 4 to 6 therefore carry over. The spacing changes in `K04_Result_NotCovered` and `K04_Result_LargeText` cannot be judged without rendering.

Differences from `fecc9fa` to the latest save: 20 changed nodes, none added or removed (the node count stays 1,640). Three are the text changes below; the other 17 are the name and color change.

- `JPZxN` (`ZZ_HandoffSpec`): now says the limit-check and limit-value screens share one progress number, which is why the design example reads "3 / 3" on both.
- `ZxXPh` (Note 2): now says questions follow "선택한 상품의 검토된 보장 조건" and "세대로 질문을 고정하지 않습니다". At `fecc9fa` it still said "선택한 세대·치료에 따라".
- `b292e` (`ZZ_HandoffSpec` entry cell): now reads "상품에 필요한 조건 질문의 첫 화면(예: K02Q_Conditions)…" instead of naming `K02Q_Conditions` as the fixed first screen.
- Service name: the string variable `service-name` and 14 text nodes now read "보담": 8 wordmarks (`CoTFR`, `DBtJN`, `Kuwo9`, `MwMCI`, `PpRhB`, `QKRVe`, `TT4eV`, `Z1DG6N`), the hospital-settings value and hints (`bv2zb`, `oJOG8`, `MPCYV`), and the hand-off spec title and lines (`L6TPfL`, `V3IIhO`, `nDDmf`). The old name "메디헬퍼" appears 0 times in the file; "보담" appears 15 times. The particle after the name was corrected too ("‘보담’은").
- Colors: 14 color variables changed and `shadow` (`#0F172A40`) was added. Examples: `accent` `#0E8C96` to `#2563EB`, `accent-dark` `#0A6E77` to `#1D4ED8`, `navy` `#0D2A4B` to `#0F172A`, `bg` `#FBFAF8` to `#F8FAFC`, `text-body` `#35506E` to `#475569`, `text-muted` `#6B7F96` to `#94A3B8`, `blue` `#1B5FBE` to `#4F46E5`. No node carries a hard-coded hex fill or stroke.
- Gradient and shadow: the Wordmark mark (`m1YQdB`) and service name (`DBtJN`) use a linear gradient built from `accent`; the shadows of `ConfirmDialog` (`iu5nO`) and `TimeoutDialog` (`kPGiD`) now reference `$shadow` instead of a literal color.
- No document records brand color values (they only state accessibility wording such as "색상에만 의존하지 않는다"), so the color change required no edit to any document other than this record. Contrast of the new palette: see 5.4 item I.

| # | Item | At `fecc9fa` (committed) | In the latest save `c4a5800` |
|---|------|--------------------------|-----------------------------------|
| 7 | `K02Q_Conditions` "모르겠어요" destination | 파일 구조·문구 확인 완료: one row (`VnL8t`) for all condition screens ("모르겠어요 / 모르는 채로 계속 / 목록에 없어요" → record "확인 필요", go to the remaining needed question, else `K03_Treatments_Empty`). Residual: the entry cell called `K02Q_Conditions` the first screen | 파일 구조·문구 확인 완료; the entry cell now says "(예: K02Q_Conditions)". The word "첫 화면" remains (minor, see 5.4 item A) |
| 8 | Product-needed vs generation-fixed | 파일 구조·문구 확인 완료 in `ZZ_HandoffSpec` ("조건 질문 구성 — 세대로 고정하지 않습니다…"). 추가 수정 필요 (minor): Note 2 (`ZxXPh`) still said "선택한 세대·치료에 따라" | 파일 구조·문구 확인 완료, Note 2 included |
| 9 | Internal text on patient screens | 파일 구조·문구 확인 완료 for `K02Q_*`: progress reads "보험 조건 확인 n / 3" (design example), no "N", no 표시 규칙, no staff-entry scope note. Residual: see 5.4 item C | Same, plus the spec line `JPZxN` explains the repeated "3 / 3" |
| 10 | Large-text result: condition-edit entry | 파일 구조·문구 확인 완료: `K04_Result_LargeText` has "보험 조건 수정" (`z8y27X`, 88), "치료 다시 선택", and the same six actions as `K04_Result` | Same |
| 11 | Admin classification UI vs scope text | 파일 구조·문구 확인 완료 for the copy (register or request change; approval and rejection by reviewer). Residual: see 5.4 items D and E | Same |
| 12 | Button height | 파일 구조·문구 확인 완료: see 5.5 | Same |

All of the above are 실제 렌더링 미확인 and 앱 동작 미검증.

### 5.4 Open items register (additional fixes and checks)

A to E correspond to the five fixes requested of Pencil after `f0520ad`. F to H are further observations. D and I were rewritten and J and K added at the brand-change review (5.7). Statuses in this table describe the save `c4a5800…` (HEAD `a9ffcfd`), except D, I, J, and K, which also carry a "Current (5.8)" status for the save `08e3f22…` (HEAD `d1ad73f`). For A, B, C, E, F, G, and H, the nodes they rest on are unchanged between the two saves (5.8.1), so their status carries over. None is closed by a report alone. "추가 수정본 대기" marks an item whose change was requested of Pencil and is not in the file read in this review. **At the current save (5.10) this register is superseded:** A, B, and the condition-question parts of C refer to frames that no longer exist. 5.10.5 gives the status of A to K at the current save, and 5.10.3 adds items L to U (their status at the save `01bacca…` is in 5.11.3).

| Id | Item | Status |
|----|------|--------|
| A | `K02Q_Conditions` "모르겠어요" destination duplicated | 파일 구조·문구 확인 완료. The control has one hand-off row (`VnL8t`, 5.3 #7). The entry cell (`b292e`) now reads "상품에 필요한 조건 질문의 첫 화면(예: K02Q_Conditions)", so a product that starts at `K02Q_Conditions_Copay` is not contradicted. Minor wording note, not blocking: "첫 번째로 필요한 질문" would be more exact than "첫 화면" |
| B | Product-needed conditions vs fixed per-generation rules | 파일 구조·문구 확인 완료: `ZZ_HandoffSpec` (`U2xB3Q`) and Note 2 (`ZxXPh`) both say questions come from the product's reviewed condition data and are not fixed by generation. Documents aligned: planning document §4, product.md 5.1, structure.md API table |
| C | "N", display rules, internal explanations on patient screens | 파일 구조·문구 확인 완료 for `K02Q_*`: no "N", no 표시 규칙, no data/option-generation explanation, no staff-entry note; that content now lives in `ZZ_HandoffSpec` (`LvJu6`, `JPZxN`). 추가 수정 필요 / 추가 수정본 대기 (owner decision): placeholder wording "디자인 예시입니다" is still in the visible assumption panel of `K04_Result` (`S39FN`), `K04_Result_NotCovered` (`reynT`), `K04_Result_Dialog_Timeout` (`p17ndv`), `L_K04_Result` (`AMVGI`), and "구현 단계에서 … 연결합니다" / "디자인 예시입니다" on `K04_Basis_Calculation` (`o16qMt`, `hmlxu`). Decide whether these are demo markers removed at implementation or text that stays |
| D | Behavior of a classification change before approval | **Current (5.8): 파일 구조·문구 확인 완료** (blob `08e3f22…`: `VLDdc`, `JKWXH`, `F8XwNC`, `Pz5m4` now carry the rule; 5.8.2 row 5 and 6). At `c4a5800`: 추가 수정 필요 / 추가 수정본 대기. Rule is fixed, not open: a coverage-affecting change invalidates the approved mapping and holds that treatment's expected payout until re-review; a price-only change keeps the approved mapping and is published as a new price version (row 14 in section 3; `보담_기획설계_v0.2.md` §7, `product.md`, `structure.md` already say this and need no change). The saved file disagrees in two places: `VLDdc` ("승인 전까지는 직전 승인 분류로 환자 계산이 유지됩니다") and `ZZ_HandoffSpec` `JKWXH` ("…직전 승인 분류가 유지됩니다") keep the old mapping valid. `F8XwNC` and `Pz5m4` ("승인 전까지 환자 계산에 반영되지 않습니다") do not say the old mapping stops applying or that the payout is on hold. Sentence-level findings and replacement wording for Pencil: 5.7.4. This is a Pencil fix, not a question for the owner |
| E | Admin 급여 구분 / 행위 코드 UI vs scope text | 파일 구조·문구 확인 완료 for the copy: role chip "권한: 메뉴·금액 편집 · 분류 변경 요청" (`N6ORf3`), "보장 매핑 승인 권한 없음" (`HQ2j1`), admin description (`hc7K8`) say register or request a change, with approval and rejection by the reviewer. 추가 수정 필요 / 추가 수정본 대기 (minor): the copy speaks of a "변경 요청" but A03 has a "검토 요청" button and no separate change-request control; unify the terms or add a control. `A02_Admin_TreatmentList` has three "검토 완료" text nodes (`GHGjX`, `c10Gp`, `GYSQ1`), each the label inside a node named "Status 검토 완료" in a table row; A03 has none. Whether the A02 badges behave as controls is 실제 렌더링 미확인 |
| F | Large-text button heights | Observation, no verdict: `K04_Result_LargeText` secondary buttons are 104, 104, 88, 88, 88 and the primary is 112; `K04_Result` has five secondary at 88 and a primary at 100; `L_K04_Result` has 96, 96, 96, 88, 88 and a primary at 96. Confirm intent; 실제 렌더링 미확인 |
| G | Preview images | `design/previews/` holds 8 PNG (`ECPf6`, `H5Xw9I`, `TJoQ2`, `VwsQ9`, `woEM7`, `zREqB`, `ZxXPh`, `h4KfhK`), untracked, not created by MoAI, file time 09:25 on 2026-10-13, before the 09:33 and 09:51 saves, so it cannot be assumed that they show the name or colors as saved (an earlier version of this document counted 13 images). They cannot be tied to a specific saved revision, are not evidence for the latest save, and were not viewed in this review or in 5.7. They stay out of the commit |
| H | Items never read in a rendered view | **Current (5.9):** `K05_Consult`, `K03_Treatments_Dialog_Reset`, and the large-text action rows were rendered; still not seen: `ZZ_HandoffSpec` long-text clipping, `A02` status labels, and the spacing in `K04_Result_NotCovered`. At `c4a5800`: `K05_Consult`, `K03_Treatments_Dialog_Reset`, full large-text clipping, `ZZ_HandoffSpec` long-text clipping, `A02` status labels, and the spacing changes in `K04_Result_NotCovered` and `K04_Result_LargeText` (5.3): 실제 렌더링 미확인 |
| I | Text contrast of the new palette | **Current (5.8): 파일 구조·문구 확인 완료 (계산 결과만; 실제 렌더링 미확인)**: `text-muted` is `#58687E`, 5.68 / 5.43 / 5.19:1 on `surface` / `bg` / `surface-alt`; 0 resolvable text nodes below their threshold (5.8.2 row 3). At `c4a5800`: 추가 수정 필요 (계산 결과; criteria now in 2.1). `text-muted` (`#94A3B8`) is 2.45:1 on `bg`, 2.56:1 on `surface`, 2.34:1 on `surface-alt`: below 3:1, so it fails the large-text minimum as well as the 4.5:1 normal-text minimum. It is the fill of 97 text nodes (kiosk 40 at 20 to 24 px, admin 33 at 11 to 16 px, shared components and notes 24) and 22 icons. Several kiosk nodes are key guidance (for example `K00_Start` `CHgw8`, `K05_Consult` `yGXlJ`, "확인 필요" `tBSNm`). Fix for Pencil: darken the `text-muted` variable so every pair is 4.5:1 or more (a candidate such as `#5B6B80` gives 5.20, 5.44, 4.97 by calculation; the value itself is Pencil's choice). The 6 `disabled-text` nodes on `K03_Treatments_Page2` are 2.56:1 at 32 and 36 px; see 5.7.3. Tables, counts, and unresolved nodes: 5.7.3. 실제 렌더링 미확인 |
| J | `ZZ_HandoffSpec` color line vs variables | **Current (5.8): 파일 구조·문구 확인 완료**: `lwc8y` lists all 21 color variables and every value equals its variable (5.8.2 row 1). At `c4a5800`: 추가 수정 필요. `lwc8y` lists the pre-rebrand teal palette: 14 of 20 listed values differ from the file's variables and `shadow` is not listed. Table: 5.7.2 |
| K | Official logo version and where each is used | **Current (5.8): 파일 구조·문구 확인 완료**: one official logo, defined once as `BrandMark`, with `Wordmark`, `Wordmark_Hero`, `Wordmark_Admin` and the `A04` mock using it; usage described in `ZZ_HandoffSpec` and shown in `ZZ_Logo_Official` (5.8.3). One minor mismatch with that description is recorded in 5.8.4. At `c4a5800`: 추가 수정 필요. The file holds two forms of the logo and nothing marks either as official; `ZZ_HandoffSpec` does not mention the logo. Details: 5.7.5 |

### 5.5 Button height

Component values (all three versions): `Button_Primary` (s8D6J) and `Button_Secondary` (m1gMGk) both have width 420 and height 88, written as literals. The variable `h-btn` = 88 exists and is not bound to either component's `height`. The saved file notes that this Pencil version does not bind `height` to a variable, which MoAI did not test.

Reading rule: the effective height of an instance is its own `height` when present, otherwise the component's 88. The review compares the effective height with 88. An instance without its own `height` is not a finding, and an unbound `h-btn` is a note, not a failure. Three questions are kept apart:

| Question | Answer from the saved file | Status |
|----------|----------------------------|--------|
| Is `h-btn` bound to the component height? | No; the direct value 88 is used | Note only, not a pass condition |
| Does any instance have an effective height below 88? | No, in any of the three versions | 파일 구조·문구 확인 완료 |
| Do buttons clip, overlap, or fall short of the touch area when rendered? | Not seen | 실제 렌더링 미확인 |

Instances:

| Version | Secondary (m1gMGk) | Primary (s8D6J) |
|---------|--------------------|-----------------|
| `f0520ad` | 47 with no own `height` (inherit 88); 6 at 96; 6 at 104 (59) | 7 with no own `height` (inherit 88); 5 at 96; 9 at 100; 1 each at 112, 124, 132 (24) |
| `fecc9fa` and the latest save | 48 at 88 (explicit); 6 at 96; 6 at 104 (60) | 7 at 88 (explicit); 5 at 96; 9 at 100; 1 each at 112, 124, 132 (24) |

From `f0520ad` to `fecc9fa`, all 54 instances that had no own `height` (47 Secondary, 7 Primary) were given an explicit 88, the value they already inherited, so their effective height did not change. The one extra Secondary instance is the new "Action 보험 조건 수정" in `K04_Result_LargeText` (88). None of the 20 nodes that differ in the latest save (text, fill, effect) touches a height.

Correction of an earlier report: the first review described the portrait result frames' bottom secondary buttons as shorter than 88 and the unbound `h-btn` as an open defect. That came from eyeballing exported images and from the absent instance `height`, not from a rendered check of the saved file. It is withdrawn as a finding. What remains: 실제 렌더링 미확인 for clipping, overlap, alignment, and touch area; and the unbound `h-btn` is a note, not a failure.

### 5.6 Not verified in this review

| Kind of check | State in this review |
|---------------|----------------------|
| 파일 구조 검사 (saved `.pen` JSON: node ids, text, component properties) | Done for `f0520ad`, `fecc9fa`, and the latest save (blob `c4a5800…`), by parsing each file and comparing nodes by id |
| 실제 렌더링 (clipping, overlap, alignment, touch area on a rendered screen) | Not done: no screen was rendered or screenshotted in this review, and `design/previews/` predates the latest save and was not used. All visual claims are 실제 렌더링 미확인 |
| 앱 동작 (timers, session reset, calculation, permission enforcement, hand-off flows) | 앱 동작 미검증: no app exists |

- Insurance content: no real policy terms, limits, deductibles, riders, or treatment classes were added or confirmed; the numbers in the design remain examples.
- The latest save may change again after this review. Before relying on 5.3, compare the file's git blob with `c4a5800…`; if it differs, re-read the file.

### 5.7 Brand-change review at HEAD `a9ffcfd`

Dated record of the save `c4a5800`. Findings marked 추가 수정 필요 below were applied by Pencil in the next save; the current state is in 5.8.

Basis. HEAD `a9ffcfd9abd5827a2f8a9c9c806efa5cb7300805` on `main`; after `git fetch origin main` the divergence was `0 0`. The only untracked path was `design/previews/`. `git hash-object design/design.pen` = `c4a580051cfa9a203d201e5e12a1f75f46caa39b` = `git rev-parse HEAD:design/design.pen`; 820,290 bytes, `i/lf w/lf attr/-text`, 73 top-level frames, 1,640 nodes. This is the latest save already described in 5.3, so no newer Pencil save existed. The Pencil editor had no file open (`get_app_state` and `execute` both answered "A file needs to be open in the editor"), so the working file was read as JSON by a read-only script and compared by node id, the same method as 5.3. MoAI wrote nothing to `design/design.pen`. `design/previews/` was not used.

#### 5.7.1 Status summary

| Area | Status | What was read |
|------|--------|---------------|
| 이름 변경 (보담 / bodam) | 파일 구조·문구 확인 완료 | `service-name` = "보담"; 14 text nodes contain "보담"; 0 nodes contain "메디헬퍼" or "medi-helper". In tracked files the old name appears only in the change record (5.3) of this document; git history keeps it unchanged. The planning document keeps its name `보담_기획설계_v0.2.md` and is referenced under that name |
| 이전 수정사항 (5.2 items 1 to 12, 5.3 differences) | 파일 구조·문구 확인 완료 (carried over) | The blob equals the one read in 5.3, so the 5.3 results describe this file. In this review the nodes read again were `VLDdc`, `F8XwNC`, `Pz5m4`, `JKWXH`, `lwc8y`, the `Wordmark` component and every wordmark text, and the fill and size of every text node. The other items were not re-read one by one |
| 색상표 (`ZZ_HandoffSpec` vs variables) | 추가 수정 필요 | 14 of 20 listed values differ from the variables (5.7.2) |
| 글자 대비 | 추가 수정 필요 (계산 결과) | `text-muted` fails every criterion in 2.1; `disabled-text` placeholders fail 3:1 (5.7.3) |
| 관리자 변경 문구 | 추가 수정 필요 | `VLDdc` and `JKWXH` keep the old mapping valid; `F8XwNC` and `Pz5m4` are silent on the hold (5.7.4) |
| 로고 버전과 사용 위치 | 추가 수정 필요 | Two forms, none marked official, not described in the hand-off spec (5.7.5) |
| 실제 렌더링 | 실제 렌더링 미확인 | No screen or screenshot of this saved revision was seen. Nothing in 5.7 is a visual finding |
| 앱 동작 | 앱 동작 미검증 | No app exists |

#### 5.7.2 Hand-off color list vs variables (`lwc8y`, `ZZ_HandoffSpec` "색상" line)

6 values match (`surface`, `warn`, `warn-soft`, `danger`, `danger-soft`, `on-accent`). 14 do not, and the line also omits the color variable `shadow` (`#0F172A40`). The listed values are the pre-rebrand palette. This is a Pencil fix: the line must be rewritten from the variables.

| Variable | Listed in `lwc8y` | Actual variable |
|----------|-------------------|-----------------|
| `bg` | `#FBFAF8` | `#F8FAFC` |
| `surface-alt` | `#F2F6F8` | `#F1F5F9` |
| `navy` | `#0D2A4B` | `#0F172A` |
| `text-body` | `#35506E` | `#475569` |
| `text-muted` | `#6B7F96` | `#94A3B8` (also fails 2.1, see 5.7.3) |
| `accent` | `#0E8C96` | `#2563EB` |
| `accent-dark` | `#0A6E77` | `#1D4ED8` |
| `accent-soft` | `#E2F2F3` | `#DBEAFE` |
| `blue` | `#1B5FBE` | `#4F46E5` |
| `blue-soft` | `#E8F0FD` | `#EEF2FF` |
| `border` | `#D9DFE6` | `#CBD5E1` |
| `disabled` | `#E3E8ED` | `#E2E8F0` |
| `disabled-text` | `#93A2B1` | `#94A3B8` |
| `scrim` | `#0D2A4BB8` | `#0F172AB8` |

#### 5.7.3 Text contrast (계산 결과 only, criteria in 2.1)

Method: 660 text nodes; fill variable resolved to its hex, background = nearest ancestor with a solid fill, WCAG relative-luminance ratio, large text = 24 px or more (or 18.66 px or more in bold). 657 nodes resolved. 3 did not and are reported as unresolved, not as passing: `DBtJN` (gradient fill; logo exception), `TSc0s` (service description inside `Wordmark`, no filled ancestor in its own component) and `n5z7N` (pager text, no filled ancestor). Overrides inside component instances were not resolved. Gradients and shadows were not evaluated.

| Pair (fill on background) | Ratio | Text nodes | Result against 2.1 |
|---------------------------|-------|-----------|--------------------|
| `text-muted` on `surface-alt` | 2.34 | 11 (all small, 13 to 16 px) | Fails 4.5 and 3 |
| `text-muted` on `bg` | 2.45 | 20 (18 small, 2 large; 22 and 24 px) | Fails 4.5 and 3 |
| `text-muted` on `surface` | 2.56 | 66 (40 small, 26 large; 11 to 24 px) | Fails 4.5 and 3 |
| `disabled-text` on `surface` | 2.56 | 6 (large, 32 and 36 px), all on `K03_Treatments_Page2` | Fails 3 unless the inactive-control exception applies (below) |

All other resolved pairs are 4.75:1 or more (lowest: `warn` on `warn-soft` 4.75; `on-accent` on `accent` 5.17; `accent-dark` on `accent-soft` 5.49; `text-body` on `surface` 7.58; `text-body` on `bg` 7.24; `navy` 14.63 to 17.85). Variable pair `disabled-text` on `disabled` is 2.08:1; no text node uses that pair in the saved tree, and it falls under the inactive-control exception if a disabled control uses it.

- `text-muted` has 97 text nodes: 40 on kiosk frames (20, 22, 24 px; 23 frames), 33 on admin frames (11 to 16 px; 4 frames), and 24 in shared components, dialogs, and the state notes (`StepIndicator` 6, `ZZ_ComponentStates` 10, `TreatmentCard` 2, `InsurerCard` 1, `AmountCard` 1, `TimeoutDialog` 1, `ZZ_HandoffSpec` 3). It is also the fill of 22 icons (non-text; outside 2.1).
- Kiosk key guidance on `text-muted`, which must aim for 4.5:1: `K00_Start` `CHgw8` (touch instruction), `K05_Consult` `yGXlJ` (consultation notice), `K06_Complete` `uMr0p`, `KXX_Loading_Calculating` `cYm0f`, "확인 필요" `tBSNm` in `K04_Result_Unconfirmed`, and the result labels "보험 조건" / "선택한 치료" (24 px) on the result frames.
- Fix for Pencil, one change: darken the `text-muted` variable until all three backgrounds reach 4.5:1 or more. Calculation for a candidate `#5B6B80`: 5.20 on `bg`, 5.44 on `surface`, 4.97 on `surface-alt`. The value is Pencil's to choose; the criterion is the 4.5 floor. Not a question for the owner.
- `disabled-text` on `K03_Treatments_Page2`: the 6 nodes are the placeholder rows "관리자가 등록한 치료 항목" and "— 원". They are text that informs, not a disabled control, so the inactive-control exception is not taken for granted. Fix for Pencil: use the corrected `text-muted` for them, or show in the design that these rows are a disabled control state.
- Logo exception: the `Wordmark` gradient (`accent` to `blue`) is exempt as a logo. For information, both gradient end colors are 4.9:1 or more on `surface` by calculation. The service description beside it (`TSc0s`, `text-body`) is not exempt.
- Everything above is 계산 결과. 렌더링 확인 is 실제 렌더링 미확인 for every pair.

#### 5.7.4 Admin change rule vs the saved file

Rule (fixed, row 14 of section 3): coverage-affecting change = existing approved mapping invalidated, re-review required, that treatment's expected payout on hold until then (the existing "계산 보류" state: treatment classification unclear, planning document §6 state table). Price-only change = approved mapping kept, published as a new price version, change history kept.

| Node | Saved text (quoted) | Against the rule |
|------|--------------------|------------------|
| `VLDdc` (`A03_Admin_TreatmentEdit`, "재검토 필요" body) | "…승인 전까지는 직전 승인 분류로 환자 계산이 유지됩니다. 금액만 변경한 경우에는 재검토 없이 게시 요청할 수 있습니다." | Conflicts: keeps the old mapping and the patient calculation running. The price-only sentence is right in substance but omits "승인 매핑 유지" and "새 가격 버전" |
| `JKWXH` (`ZZ_HandoffSpec`, 검토 권한 line) | "…보장 분류 변경은 승인 전까지 환자 계산에 반영되지 않고 직전 승인 분류가 유지됩니다. 금액만 변경한 경우에는 재검토 없이 게시 요청할 수 있습니다…" | Same conflict and same omission |
| `F8XwNC` (급여 구분 hint) | "…보장 분류 변경 요청으로 처리되며, 승인 전까지 환자 계산에 반영되지 않습니다." | Does not state that the old approval stops applying or that the payout is on hold |
| `Pz5m4` (행위 코드 hint) | "…변경하면 보장 분류 재검토가 필요하며, 승인 전까지 환자 계산에 반영되지 않습니다." | Same |

Replacement wording proposed for Pencil (the sentences may be shortened; the three facts must stay):

- `VLDdc`: "보장 분류 변경(급여 구분 · 행위 코드 · 치료 분류)은 기존 승인을 무효로 하고 재검토를 거쳐야 합니다. 재검토가 끝나기 전까지 이 치료의 예상 보험금 계산은 보류됩니다. 금액만 변경한 경우에는 승인된 매핑이 유지되며, 새 가격 버전으로 게시하고 변경 이력을 남깁니다."
- `JKWXH`: replace the two sentences after the permission sentences with the same two sentences as `VLDdc`.
- `F8XwNC`: "급여 구분 변경은 보장 분류 변경 요청으로 처리됩니다. 재검토가 끝나기 전까지 이 치료의 예상 보험금 계산은 보류됩니다."
- `Pz5m4`: "병원 수가 코드. 변경하면 기존 승인이 무효가 되어 재검토가 필요하고, 재검토가 끝나기 전까지 이 치료의 예상 보험금 계산은 보류됩니다."

Not changed by this finding: the patient result screens (the hold already shows as "확인 필요", row 5), the "검토 완료" labels on `A02` (item E), and the planning document, `product.md`, and `structure.md`. Status: 추가 수정 필요 / 추가 수정본 대기 until the saved file is read again and shows the sentences.

#### 5.7.5 Logo versions and where they are used

No node, variable, or document designates an "official" logo version, and no image asset exists (no image node; the logo is built from frames, a lucide icon, and text). `ZZ_HandoffSpec` does not mention the logo. The file holds these forms:

| Form | Built from | Used in |
|------|-----------|---------|
| A. Lockup: mark + gradient name + description | Component `Wordmark` (`kH2FG`): `Mark` 64x64 radius 18 with an `accent` to `blue` gradient (`m1YQdB`) and a white lucide `heart-pulse` icon (`GEayx`); name "보담" 38 px bold with the same gradient (`DBtJN`); description "실손보험 예상 부담액 안내" in `text-body` (`TSc0s`) | Inside component `KioskHeader` (`nacd2`, instance `vbz8E`); `KioskHeader` is placed on 33 kiosk frames: every `K*` and `L_K*` frame |
| B. Plain text name | "보담" in `navy`, bold, no mark | `K00_Start` `CoTFR` 92 px and `L_K00_Start` `TT4eV` 84 px (these two frames therefore show forms A and B together); admin headers 20 px on `A01` `Z1DG6N`, `A02` `PpRhB`, `A03` `QKRVe`, `A04` `Kuwo9`; kiosk preview mock 13 px on `A04` `MwMCI` |
| C. Hospital logo upload (not the service logo) | `A01` `Logo Upload` (`PGLAS`) and hint `oJOG8`: "로고 이미지 업로드 (PNG/SVG). 미등록 시 ‘보담’ 워드마크만 표시됩니다." | `A01_Admin_HospitalSettings`; the hospital's own logo is a separate input (§7), no hospital logo exists in the design |

Findings: (1) the file does not say which of A and B is the official service logo, or where each is allowed; (2) the `A04` kiosk-preview mock uses form B at 13 px while the real kiosk header uses form A; (3) the hint `oJOG8` says only the wordmark is shown when no hospital logo is registered, but it does not say whether that is form A or B. Request to Pencil: name one form as the official logo (for example one reusable component), list its permitted places in `ZZ_HandoffSpec`, and make the `A04` preview match. Contrast: forms A and B are logo-exempt (2.1).

#### 5.7.6 Not verified

- 실제 렌더링: clipping, overlap, alignment, gradient legibility, and the contrast of any pair as seen on screen. No exported image of this saved revision exists, and `design/previews/` predates it.
- 앱 동작: no app exists; timers, reset, calculation, hold behavior of a reclassified treatment, and permissions were not run.
- Component-instance overrides (`descendants`) were not resolved in the contrast calculation.
- No real insurance content, device, or hospital data was added or confirmed.

### 5.8 Review of the save `08e3f22…`: HEAD `d1ad73f` (dated record; the current state is 5.11)

Basis. HEAD `d1ad73f5d176489e6aa7d7ac8aa2365a0669ea2b` on `main`; after `git fetch origin main` the divergence was `0 0`; the only untracked path was `design/previews/`. `git hash-object design/design.pen` = `08e3f2209ff29fd330cf1affc0126642f1857002` = `git rev-parse HEAD:design/design.pen`. The file is 828,440 bytes with 22,783 LF and 0 CR bytes (`git ls-files --eol`: `i/lf w/lf attr/-text`), valid JSON, 74 top-level frames, 1,643 nodes, no duplicate node ids. Pencil's save was committed on its own as `d1ad73f` (a `design:` commit, after the `docs:` commit `864c8e4`). The file was read as JSON by read-only scripts and compared by node id with `c4a5800…` (the save in 5.7); MoAI wrote nothing to `design/design.pen`. Pencil MCP could not open the file (5.8.5), so nothing was rendered.

#### 5.8.1 What differs from `c4a5800`

Compared by node id: 39 added, 36 removed, 18 changed. One variable changed: `text-muted` `#94A3B8` to `#58687E`.

- Changed (18): `K03_Treatments_Page2` 6 placeholder texts (fill `disabled-text` to `text-muted`); `K04_Basis_Calculation` 1 (a stroke `text-muted` to `border`); `A01_Admin_HospitalSettings` 3 (`bv2zb` fill, `PGLAS` stroke, `oJOG8` hint text); `A03_Admin_TreatmentEdit` 3 (`F8XwNC`, `Pz5m4`, `VLDdc`); `A04_Admin_PublishPreview` 1 (`MwMCI` fill); `ZZ_HandoffSpec` 4 (`lwc8y`, `WeYsW`, `ljO5G`, `JKWXH`).
- Added and removed: the hand-drawn brand blocks on `K00_Start`, `L_K00_Start`, and the `A01` to `A04` top bars were replaced by component instances; the mark inside `Wordmark` became a `BrandMark` instance; new components `BrandMark`, `Wordmark_Hero`, `Wordmark_Admin`; new frame `ZZ_Logo_Official`; seven new `ZZ_HandoffSpec` lines (`PCxKN` gradient, `CxRhG` shadow, `evvyh` contrast, `DlBf5` retired values, `vaNfm` logo, `Rwhuj` logo places, `fZceX` logo management).
- Whole-frame JSON identical to `c4a5800`: `K04_Result`, `K04_Result_LargeText`, `L_K04_Result`, `K04_Result_Unconfirmed`, `K04_Result_NotCovered`, `K05_Consult`, `K04_Result_Dialog_Timeout`, `K03_Treatments_Dialog_Reset`. The nodes behind 5.4 items A, B, C, E, F, G, and H are not among the changed nodes, so those statuses carry over unchanged. Button instance heights are unchanged (84 instances, smallest effective height 88).

#### 5.8.2 Current-state table

"파일 구조·문구 확인 완료" means: found in the saved file by structure and text. It is not a rendering result and not an app result.

| # | Item | Current status | What was read in blob `08e3f22…` |
|---|------|----------------|----------------------------------|
| 1 | Hand-off color list = variables (21) | 파일 구조·문구 확인 완료 | `lwc8y` lists 21 entries, the file has 21 color variables, 21 values match exactly; no variable is missing from the list and no listed name is not a variable. `shadow` `#0F172A40` is now listed. `DlBf5` names the 13 retired teal values as "do not use", which is intended |
| 2 | `text-muted` = `#58687E` | 파일 구조·문구 확인 완료 | Variable value, `lwc8y`, and `evvyh` all say `#58687E` |
| 3 | Contrast (계산 결과, not a rendering result) | 파일 구조·문구 확인 완료 | `text-muted` on `surface` 5.681, on `bg` 5.430, on `surface-alt` 5.186. 665 text nodes: 657 resolved, none below its threshold in 2.1; lowest pair `warn` on `warn-soft` 4.75. 104 text nodes use `text-muted`; 0 text nodes use `disabled-text` (the 6 placeholders on `K03_Treatments_Page2` now use `text-muted`). 8 text nodes unresolved: 5 gradient logo texts (`DBtJN`, `MwMCI`, `JBdLu`, `nqlvk`, `N6uYE`; logo exception), `bv2zb` (5.8.4), and `TSc0s` and `n5z7N` (no filled ancestor in their own component; `text-body` is 6.15 to 7.58:1 on every light background variable, so any background they get passes, but the real background was not resolved). No fill or stroke is a hard-coded hex |
| 4 | `BrandMark`, `Wordmark`, `Wordmark_Hero`, `Wordmark_Admin` and where used | 파일 구조·문구 확인 완료 | 5.8.3. `Rwhuj` (four places) matches the instances found |
| 5 | Classification change: approval void, payout on hold | 파일 구조·문구 확인 완료 | `VLDdc`: "…기존 승인을 무효로 하고 재검토를 거쳐야 합니다. 재검토가 끝나기 전까지 이 치료의 예상 보험금 계산은 보류됩니다." `JKWXH` says the same and adds that the result screen shows "확인 필요" (not 0 won) and the treatment total stays visible. `F8XwNC` and `Pz5m4` say the payout is on hold until re-review (`Pz5m4` also says the approval becomes void). The old phrases ("직전 승인 분류", "승인 전까지 환자 계산", "계산이 유지") have 0 hits in the file. `A03` has no control that approves; text says approval and rejection belong to the reviewer |
| 6 | Price-only change: mapping kept, new price version | 파일 구조·문구 확인 완료 | `VLDdc` and `JKWXH`: "금액만 변경한 경우에는 승인된 매핑이 유지되며, 새 가격 버전으로 게시하고 변경 이력을 남깁니다." Matches `보담_기획설계_v0.2.md` §7 |
| 7 | Normal, large-text, landscape results keep amounts and actions | 파일 구조·문구 확인 완료 | `K04_Result`, `K04_Result_LargeText`, `L_K04_Result` show 124,000원 (예상 병원 결제액), 114,000원 (예상 보험금), 10,000원 (보험금 수령 후 예상 본인 부담) and the same six actions (계산 근거 보기, 보험 조건 수정, 이용 완료, 직원에게 문의, 처음으로, 치료 다시 선택). The three frames are byte-identical to `c4a5800`. See the observation in 5.8.4 |
| 8 | Component references and override paths | 파일 구조·문구 확인 완료 | 321 `ref` nodes: 0 with a missing target, 0 whose target is not a reusable component. 272 refs carry overrides (765 override keys, nested paths followed): 0 unresolved. 39 distinct `$variable` references: 0 unresolved. 21 reusable components. The 20 frame and node ids named in section 3 exist. 0 duplicate ids |

#### 5.8.3 Logo components and where they are used

One official logo: `BrandMark` (`Cxiz2`, 64x64, corner radius 18, linear gradient `accent` to `blue`, white lucide `heart-pulse` icon) is the only definition of the mark; every other place holds an instance of it. The wordmark text "보담" uses the same two colors. `ZZ_Logo_Official` (`lOv3s`) shows all four places; `ZZ_HandoffSpec` describes them in `vaNfm`, `Rwhuj`, `fZceX`.

| Component | Built from | Instances |
|-----------|-----------|-----------|
| `BrandMark` (`Cxiz2`) | gradient mark + icon | 5: inside `Wordmark` (`c7Vy4`), `Wordmark_Hero` (`geSGT`, 148, radius 40), `Wordmark_Admin` (`R9JB3`, 32, radius 9), the `A04` mock (`fHL8c`, 18, radius 5), the mock sample in `ZZ_Logo_Official` (`U1wRwF`) |
| `Wordmark` (`kH2FG`) | mark instance + "보담" 38 px gradient + service description | 2: `KioskHeader` (`vbz8E`; `KioskHeader` is placed on 33 kiosk frames, every `K*` and `L_K*` frame) and the sample in `ZZ_Logo_Official` |
| `Wordmark_Hero` (`koJSi`) | mark 148 + "보담" 92 px gradient + description + divider + hospital name | 2: `K00_Start` (`o8N6Hp`) and `L_K00_Start` (`eoOrN`, overrides to 132 mark, 84 name, 36 description, 120 divider, 30 hospital name) |
| `Wordmark_Admin` (`W4siYx`) | mark 32 + "보담" 20 px gradient + "관리자" suffix (`text-muted`, 16 px) | 4: top bars of `A01` to `A04` |
| `Mock Brand` (`tQOoD`, plain frame, not a component) | mark instance 18 + "보담" 13 px gradient | 1: `A04` kiosk preview mock header |

The hospital's own logo is a separate input (`A01` `Logo Upload`); its hint `oJOG8` now reads "…미등록 시 공식 워드마크(마크 + ‘보담’)만 표시됩니다."

#### 5.8.4 Findings in this save

Real findings, both minor, neither a contrast failure:

1. `A01_Admin_HospitalSettings` `bv2zb` (the value of the "서비스명" field, "보담", 16 px) is filled with the brand gradient. It was `text-muted` at `c4a5800`; the six other field values on that frame (`G1aa3`, `M9ef1`, `I4InU`, `NCHH2`, `iUTLr`, `DdbGC`) are `navy`. `Rwhuj` says the logo appears in four places only, and `PCxKN` limits the gradient to the mark background and the wordmark text, so a gradient form value is outside both. By calculation its two stops are 4.72 and 5.74:1 on the field's `surface-alt` background, so contrast is not the issue. Fix for Pencil: set it to `navy` like its siblings (recommended), or add this field as a fifth place in `Rwhuj` and `PCxKN`.
2. `evvyh` says "문서 전체 텍스트 647개". The file has 665 text nodes (657 resolvable); excluding `ZZ_Logo_Official` gives 653, so 647 was not reproduced. The substance of the sentence was reproduced: 0 below threshold and lowest pair `warn` on `warn-soft` 4.75:1. Fix for Pencil: correct or drop the count.

Observations, no fix requested:

- Result frames (unchanged since `c4a5800`): the line "급여 14,000원 + 비급여 110,000원" appears only on `K04_Result`, and the assumption sentence is worded differently on each of the three frames. Amounts and actions are identical (row 7).
- The `A04` mock header is a reduced copy drawn as a frame; its mark is a `BrandMark` instance but its text is not a `Wordmark` instance and it omits the service description, which `Rwhuj` calls "같은 구성으로 축소".
- The variables `h-btn` (5.5), `service-name`, `service-desc`, `hospital-name`, and `consult-phone` are not referenced by any node; `WeYsW` explains that string variables are not substituted into texts.

#### 5.8.5 Rendering and app behavior

> Record as of the 5.8 review, kept unchanged below. The rendering rows were later checked against the same blob; the current rendering status is section 5.9.

| Check requested | Status |
|-----------------|--------|
| Portrait and landscape start-screen logo (`K00_Start`, `L_K00_Start`) | 실제 렌더링 미확인 |
| Admin top-bar logo and `A04` preview logo | 실제 렌더링 미확인 |
| Button wrapping and overlap on normal and large-text results | 실제 렌더링 미확인 |
| Clipping of result helper text and long admin sentences (`VLDdc`, `JKWXH`) | 실제 렌더링 미확인 |
| Consultation screen and timeout warning screen | 실제 렌더링 미확인 |
| Legibility of the gradient wordmark at 13 and 16 px (`MwMCI`, `bv2zb`) | 실제 렌더링 미확인 |

Why: `get_app_state` and `get_screenshot` (with the file path) both answered "A file needs to be open in the editor", so Pencil could not render the saved file. No exported image of this save exists, and `design/previews/` predates it and was not used. The structure checks and the contrast calculation above are not recorded as rendering checks. Only these items stay open; nothing already confirmed in 5.8.2 is re-requested because of them.

앱 동작 미검증: no app exists. Timers, session reset, calculation, the hold behavior of a reclassified treatment, and permissions were not run. No real insurance, device, or hospital data was added or confirmed.

### 5.9 Rendering check of the same save: HEAD `6e3ae53`, design blob `08e3f22…` (dated record; the rendering status of the current save is in 5.11.2)

Basis. The reviewed design save is `d1ad73f`; repository HEAD at this check is `6e3ae53c2c81ab36da180f07048424ef99533efd` (the `docs:` commit that recorded 5.8), on `main`, divergence `0 0` after `git fetch origin main`, only `design/previews/` untracked. `git rev-parse HEAD:design/design.pen` and `git hash-object design/design.pen` both gave `08e3f2209ff29fd330cf1affc0126642f1857002`, before and after the rendering, so the file did not change. Nothing was written to `design/design.pen`: only `Get`, `Print`, and `TakeScreenshot` were run in Pencil. `design/previews/` was not used.

What was rendered. This time Pencil had the file open (`get_app_state` listed `design/design.pen` as the active editor), so screens were rendered with `TakeScreenshot`. The open document matched the saved file by count: 74 top-level frames, 1,643 nodes, 665 text nodes, and `text-muted` = `#58687E` in both (the saved file counted by a read-only script). That is a count-level match, not a byte comparison; an unsaved editor change that keeps these counts cannot be excluded.

Resolution limit. Each image is about 400 px on its longer side, so a 1080x1920 screen is seen at roughly one fifth of its size. Whole-screen images show layout, overlap, and whether a block is present; text of 11 to 16 px cannot be read in them. Where the question was text clipping, the containing block was captured alone.

| Check requested | Status | What was seen |
|-----------------|--------|---------------|
| Portrait start logo (`K00_Start`) | 렌더링 확인 (whole screen) | Header lockup and hero logo (mark, "보담", description, divider, hospital name) shown, no overlap. `Wordmark_Hero` and `Wordmark` captured alone: mark and name legible |
| Landscape start logo (`L_K00_Start`) | 렌더링 확인 (whole screen) | Same elements in the left column, no overlap |
| Admin top-bar logo (`A01` to `A04`) | 렌더링 확인 (`A01`, `A04` whole screen; `Wordmark_Admin` alone) | Mark + "보담" + "관리자" shown and legible; `A02` and `A03` top bars seen only in whole-screen images, same appearance |
| `A04` preview logo (`Mock Brand`, `tQOoD`) | 렌더링 확인: present; fine legibility at 13 px 미확인 | Mark and "보담" visible next to each other; the image is about 50 px wide, so only presence and no overlap are established |
| `A01` service-name value (`bv2zb`) | 렌더링 확인 | "보담" in blue gradient text on a pale field, legible; confirms the 5.8.4 finding 1 (gradient instead of `navy`), which stays a minor Pencil fix |
| Normal and large-text result: amounts and actions | 렌더링 확인 | `K04_Result` and `K04_Result_LargeText` show 124,000원, 114,000원, 10,000원 and all six actions. Action blocks captured alone: every label on one line, no overlap, no text outside its button |
| Landscape result (`L_K04_Result`) | 렌더링 확인 (whole screen only) | Same amounts; six actions in one row, no overlap. Whether each label stays on one line was not judged at this size |
| Result helper and assumption text | 렌더링 확인: `K04_Result` body captured alone, no clipped text. `K04_Result_LargeText` and `L_K04_Result`: whole screen only, text blocks present, small text not readable | |
| Long admin sentences | 렌더링 확인: `VLDdc` (4 lines inside its box), `F8XwNC` (1 line), `Pz5m4` (2 lines), none clipped. `JKWXH` sits in `ZZ_HandoffSpec`, whose single tall image is unreadable at this size: 실제 렌더링 미확인 | |
| Consultation screen (`K05_Consult`) | 렌더링 확인 (whole screen) | 1544-8069 notice, guidance text, and both buttons shown, no overlap or clipping seen |
| Timeout warning (`K04_Result_Dialog_Timeout`) and reset dialog (`K03_Treatments_Dialog_Reset`) | 렌더링 확인 (whole screen) | Both dialogs sit over the dimmed screen: "남은 시간 20초" with 처음으로 / 계속 사용할게요, and the reset dialog with 계속 이용 / 처음으로; no overlap or clipping seen |

Layout-engine check (not a rendering check). For all 74 top-level frames, Pencil's resolved bounds were searched for any node that sticks out of its parent. One hit: `L_K01_Generation` `Question Column` (`UP40d`) is 688 high inside `Body` (686 high), 2 px over, in a frame with `clip: true`; no cut is visible in the whole-screen image. This is outside the requested list and is recorded as a minor observation, not a request. It was not compared with earlier saves.

Not checked: 앱 동작 미검증 (no app exists); touch area and size on a real device; fine legibility of the 13 px gradient wordmark at kiosk size; `ZZ_HandoffSpec` text clipping, `A02` status labels, and the spacing of `K04_Result_NotCovered`, `K04_Result_Unconfirmed`, and the other frames not named above, which were not rendered. The contrast in 5.8.2 row 3 is still a calculation; the screenshots were not used to measure it. Nothing already confirmed in 5.8.2 is re-requested because of these gaps.

### 5.10 Review of the working-tree save `c68530b…` (dated record; the current state is 5.11)

Basis. HEAD `57f5c019c73cf57f33fb02f7c2bc75e1bfd50805` on `main`; after `git fetch origin main` the divergence was `0 0`. `git status --short`: `M design/design.pen`, `?? design/pdf-assets/`, `?? design/previews/` (the empty `design/deliverables/` is not listed by Git). `git hash-object design/design.pen` = `c68530b03fd3e80d2c38af682ec30a1d3c1ee064`, which is not `git rev-parse HEAD:design/design.pen` = `08e3f2209ff29fd330cf1affc0126642f1857002`. The file is 776,503 bytes (file time 13:27:58 on 2026-10-13), `git ls-files --eol`: `i/lf w/lf attr/-text`; `git diff --stat` against HEAD: 776 insertions, 2,248 deletions. Pencil had the file open (`get_app_state` listed `design/design.pen` as the active editor), so the document was read in Pencil with `Get`, `Print`, and `TakeScreenshot` only. Nothing was written to `design/design.pen`. The open document was not compared byte by byte with the file on disk, so an unsaved editor change cannot be excluded; the hash above is that of the file on disk. The `moai` command was not on `PATH`, so the session registry was not queried: another running session is neither confirmed nor excluded.

Size: 75 top-level frames (`get_app_state`: ten listed plus 65 others), 1,606 nodes counted by a visitor over the whole document, 710 text nodes, 205 `ref` nodes, 20 reusable components. 5.8 recorded 74 / 1,643 / 665 / 321 / 21, counted by a read-only JSON script. The two counting methods are not the same, so the numbers are listed side by side and are not a difference.

#### 5.10.1 What differs from `08e3f22…`

The save `08e3f22…` was not opened in Pencil, so there is no node-by-node comparison. The differences come from comparing the current frame list, node ids, and texts with what 5.2 to 5.9 recorded.

- **Gone.** The ids `H5Xw9I` (`K02Q_Conditions_Unknown`), `VwsQ9` (`K02Q_Conditions`), `Ni5aI` (`K04_Result_Unconfirmed`), and `SmZwC` (`K05_Consult`) return nothing; no top-level frame or node name contains `K02Q`, `Unconfirmed`, or `K05`. So the four `K02Q_*` frames, `K04_Result_Unconfirmed`, and `K05_Consult` no longer exist. The text `S39FN` (the visible assumption panel text of `K04_Result`) is gone as well.
- **Present now and not named in 5.2 to 5.9.** `K07_Documents` (`F19r1B`); ten flow pages `PDF_01_Cover` to `PDF_10_Modal` (1920x1080; ids `JqEDS`, `KEUMa`, `XYmZv`, `B4BAQ`, `KvG6h`, `JhmgW`, `WAj6Q`, `TqTDf`, `VkAGk`, `pGFxd`); `ZZ_FontTest` (`SiBrE`); the color variables `success` `#136C3B` and `success-soft` `#E6F4EC` (23 color variables; 5.8.2 row 1 counted 21). `success` is the fill or stroke of 5 nodes in the `AmountCard` "예상 보험금" card.
- **Agrees with what 5.8 recorded.** The rule sentences `VLDdc`, `F8XwNC`, `Pz5m4`, `JKWXH`; the timer line `MVOb1` (100 / 120 / 160 / 180 seconds); `oJOG8`; the logo texts `vaNfm`, `Rwhuj`, `fZceX`, `PCxKN`, `CxRhG`, `DlBf5`; `text-muted` = `#58687E`.

#### 5.10.2 Current-state table

"파일 구조·문구 확인 완료" means: found in the open document by structure and text. It is not a rendering result and not an app result.

| # | Item | Current status | What was read |
|---|------|----------------|---------------|
| 1 | Three-step input flow (section 3 row 16) | 파일 구조·문구 확인 완료 | `K00_Start` lists "1 실손보험 선택 / 2 보험사 형태 선택 / 3 치료 선택"; the counters read "1 / 3", "2 / 3", "3 / 3"; `K02_Type_Empty` offers 손해보험사, 생명보험사, 그외 공제 조합 (우체국, 새마을금고 공제회, 농협); `ZZ_HandoffSpec` `eLIvV`: "입력 단계는 3개(실손·보험사 형태·치료)"; the transition table (`cvUDQ`) lists the same screens |
| 2 | Retired frames and wording absent | 파일 구조·문구 확인 완료 | 5.10.1. In the text nodes of the file: "K02Q" 0 hits, "공제 유형" 0, "자기부담 유형" 0, "선택형" 0, "1 / N" 0, "표시 규칙" 0; "조건 질문" 1 (Note 3 `RgdZA`, the sentence that says the step was removed); "모르겠어요" 1 (`il6Fo`, a row of the transition table). Texts inside component instances (for example the "세대를 모르겠어요" card) were read in the expanded view instead |
| 3 | Standard assumption instead of condition questions (row 17) | 파일 구조·문구 확인 완료 | Note 3 `RgdZA`: "조건 질문 단계를 없앴으므로 공제·한도는 환자에게 묻지 않고 세대·보험사 형태별 표준값을 적용해 계산합니다 … 적용한 가정은 계산 근거 화면에 표시합니다". The result frames say "표준 공제·한도 가정으로 계산한 예상 금액입니다". `K04_Basis_Calculation` shows "의원 외래 고정 공제(가정) - 10,000원" and "회당 지급한도(가정) 250,000원". "선택한 치료가 모두 보장 대상" and "한도가 남아" appear 0 times. The only standard values in the file are that one example (section 7) |
| 4 | Consultation removal (row 19) | 파일 구조·문구 확인 완료 | `H0AWKZ` and Note 4 (`h4y2ZY`) say the screen and buttons are excluded. The result frames list the actions 계산 근거 보기, 치료 다시 선택, 보험 조건 수정, 처음으로, 이용 완료 (plus 서류 확인 on the normal result); `KXX_Error_Network` has 다시 시도 / 이용 종료. 1544-8069 appears in `K01_Generation_Empty` (the "세대를 모르겠어요" panel), `K01_Generation_Unknown`, and `A01` (setting). The sentence "접수 직원에게 문의해 주세요" remains as text in 4 body texts (`M3bFr`, `fElFT`, `MeAAK`, `pyjBd`); it is text, not a control. See item T for the panel wording |
| 5 | Normal and not-covered result | 파일 구조·문구 확인 완료 (labels: item M) | `K04_Result`: 보험 조건 "2세대 (C1) · 손해보험사"; 124,000원 / 114,000원 / 10,000원; six actions: 보험 청구에 필요한 서류 확인 (primary), 계산 근거 보기, 치료 다시 선택, 보험 조건 수정, 처음으로, 이용 완료. `K04_Result_NotCovered`: 124,000원 / 74,000원 / 50,000원 with "보장 제외 가정" 신장분사치료 40,000원 |
| 6 | Required-documents screen (row 18) | 파일 구조·문구 확인 완료 | `K07_Documents`: title "필요 서류 안내" with the badge "예시 기준"; "청구 기준 상해 · 손해보험사 · 통원"; "서류 9가지 중 이번 청구에 필요한 항목에 체크했습니다."; nine document lines; five of them carry a reason line (통원확인서, 영수증·세부내역서, 초진기록지, 소견서, 판독지); buttons "결과로 돌아가기" and "이용 완료"; footer "서류는 병원 원무과에서 발급합니다. 보험사와 상품에 따라 추가 서류를 요구할 수 있습니다." The rules sit in `ZZ_HandoffSpec` (`bAkLF`, `W4yt8`, `CEVX5`, `H9b4Jv`, `h9KK9R`, `oFMti`); `pQTqj` says the mapping is an example and needs verification |
| 7 | Admin change rule (row 14) | 파일 구조·문구 확인 완료 | `VLDdc`, `Pz5m4`, `F8XwNC`, `JKWXH` read: a classification change voids the approval and puts the treatment's expected payout on hold until re-review; a price-only change keeps the approved mapping and is published as a new price version. `A03` has the button "검토 요청" and no approve control; `XORPR` and `HQ2j1` say approval and rejection belong to the reviewer. `JKWXH` says the result shows "확인 필요" (not 0 won); no frame shows that state (item O) |
| 8 | Hand-off color list = variables (row 15) | 추가 수정 필요 | `lwc8y` lists 21 colors and each listed value equals its variable, but the file has 23 color variables; `success` and `success-soft` are missing (item Q) |
| 9 | Brand and logo | 파일 구조·문구 확인 완료 (one carried finding) | `BrandMark` (`Cxiz2`), `Wordmark` (`kH2FG`), `Wordmark_Hero` (`koJSi`), `Wordmark_Admin` (`W4siYx`), `ZZ_Logo_Official` (`lOv3s`), `Mock Brand` (`tQOoD`) exist; `service-name` = "보담"; 18 text nodes contain "보담", 0 contain "메디헬퍼". The 5.8.4 finding 1 persists (item S) |
| 10 | Contrast (계산 결과, not a rendering result) | 파일 구조·문구 확인 완료 (계산 결과만) | Method: every text node with component instances expanded and variables resolved (1,313 text nodes); fill against the nearest solid ancestor; thresholds of 2.1. 1,271 resolved, 42 unresolved, 9 below threshold. The 9 are all `disabled-text` `#94A3B8` on `disabled` `#E2E8F0` = 2.08:1: labels of buttons and cards shown in the disabled state (the next buttons in `BottomActions` instances `qLqpt`, `aSWNJ`, `bpWa9`; the `KXX_Loading_Calculating` buttons `Q9SJc`, `g2aR3t`; the state board `OXuHI`, `EV0Hy`). The inactive-control exception of 2.1 covers them only if each control is actually disabled; the `state` of each instance was not read (5.10.4). The 42 unresolved are gradient logo texts (`DBtJN` and its instance copies, `JBdLu`, `nqlvk`, `N6uYE`), the gradient texts `bv2zb` and `MwMCI`, and `TSc0s` and `n5z7N` (no filled ancestor in their own component). The counts are not comparable with 5.8.2 row 3 (other counting method). The palette values are unchanged; the ratio figures in `evvyh` were not re-derived |
| 11 | Button heights (row 9) | 파일 구조·문구 확인 완료 | `Button_Primary` (`s8D6J`) and `Button_Secondary` (`m1gMGk`): width 420, height 88, literals. 58 instances, each with its own `height` of 88 or more: Primary 21 (88 x6, 96 x5, 100 x7, 112, 124, 132), Secondary 37 (88 x27, 96 x6, 100 x2, 104 x2). 0 nodes bind `height` to `$h-btn` (not a pass condition, 5.5) |
| 12 | Layout-engine check (not a rendering check) | 파일 구조·문구 확인 완료 (3 frames) | For `K04_Result`, `K07_Documents`, and `K02_Type_Empty`, no node was reported as sticking out of its parent. It was not run for the other frames; the 2 px overflow of `L_K01_Generation` `UP40d` (5.9) was not re-checked |
| 13 | Rendering | 렌더링 확인 (3 screens only) | `TakeScreenshot` of `K04_Result`, `K07_Documents`, and `K02_Type_Empty` (each image about 250 to 400 px wide): the blocks are present, nothing overlaps, no text outside its box was seen; in `K02_Type_Empty` the "다음" button is greyed. Small text cannot be read at this size. Not rendered: every other frame, including `K01_*`, `K03_*`, `L_*`, `A0*`, `ZZ_HandoffSpec`, and `PDF_*` |
| 14 | Image folders | 파일 구조·문구 확인 완료 (not viewed) | `design/previews/`: 21 PNG, file time 11:28, older than the 13:27 save. `design/pdf-assets/`: 20 PNG named by frame id, file time 15:11, newer than the save. `design/deliverables/`: empty. All untracked and not created by MoAI. No image was opened, so none is evidence for this save |

#### 5.10.3 Findings at this save (items L to U)

| Id | Item | Status |
|----|------|--------|
| L | No input for the cause (injury / illness) | **Closed 2026-10-13 (5.11).** The owner chose a separate screen at input step 3 of four, over placing it first, folding it into the treatment screen, or asking it on entry to the documents screen. `K02b_Cause_Empty` / `K02b_Cause_Selected` / `L_K02b_Cause` now ask it; `ZZ_HandoffSpec` `W4yt8` names step 3 as the source; the planning document carries it as 화면 3 and removed the item from §11 |
| M | Amount labels differ between the screens and the hand-off spec | 추가 수정 필요 (Pencil). The document terms stay (owner decision of 2026-10-13): `NMSFa`, Note 3 (`RgdZA`), and section 3 row 4 say 예상 병원 결제액 / 예상 보험금 / 보험금 수령 후 예상 본인 부담, with the caption "오늘 병원에 결제하는 금액이 아닙니다". `K04_Result`, `K04_Result_NotCovered`, `K04_Result_LargeText`, `L_K04_Result`, and `K04_Result_Dialog_Timeout` show "오늘 병원에 낼 금액 (예상)" / "예상 보험금" / "본인 부담금" with "오늘 내는 금액이 아닙니다." |
| N | Result variants without the documents action | 추가 수정 필요 (Pencil). `K04_Result` has six actions. `K04_Result_NotCovered` (XxmHQ), `K04_Result_LargeText` (woEM7), and `L_K04_Result` (n3WXk) list five and lack "보험 청구에 필요한 서류 확인"; row 12 requires the same actions on the large-text result. There is no large-text or landscape version of `K07_Documents`. Whether the not-covered result should offer it is not stated (`bAkLF` says "결과 화면") |
| O | No frame for the on-hold result | 추가 수정 필요 (Pencil). The rule is fixed (rows 5 and 14): `JKWXH` says a reclassified treatment shows "확인 필요" on the result, and the badge board (`rXjOB`, `KA7PL`) defines the state. `K04_Result_Unconfirmed` was removed and no remaining result frame shows it |
| P | Font | Owner decision (section 7). The variable `font-ko` is "Pretendard" and 1,306 text nodes use Pretendard (the others are the font-test rows: Inter 3, IBM Plex Sans KR 1, Noto Sans KR 1, Gothic A1 2). `V3IIhO` ("font-ko Noto Sans KR"), `vvQjy`, and Note 9 (`OYwdU`) say Noto Sans KR. No project document names a font |
| Q | Color line lists 21 of 23 variables | 추가 수정 필요 (Pencil): add `success` `#136C3B` and `success-soft` `#E6F4EC` to `lwc8y`, or state where they are used |
| R | `evvyh` text count | 추가 수정 필요 (Pencil), minor: "문서 전체 텍스트 647개" against 710 text nodes in the file (1,313 with instances expanded). Correct or drop the count |
| S | `A01` service-name value | 추가 수정 필요 (Pencil), minor, carried from 5.8.4 finding 1: `bv2zb` ("보담", 16 px) is gradient text. Set it to `navy` like the other values on the frame, or add it as a fifth place in `Rwhuj` and `PCxKN` |
| T | "당사 콜센터" wording | 추가 수정 필요 (Pencil), minor: the "세대를 모르겠어요" panel on `K01_Generation_Empty` says "당사 콜센터로 문의하시면 정확하고 빠른 안내가 가능합니다. 콜센터 문의 : 1544-8069", which presents the number as the service's own call center while its operating entity and hours are unconfirmed |
| U | No "treatment total only" path | Owner decision (section 7). The planning document (§1) and `product.md` let a patient who does not know the insurance condition still see the treatment-cost total. `K01_Generation_Unknown` offers only guidance and "보험 선택으로 돌아가기", and step 1 keeps "다음" inactive until a generation card is chosen (`ZZ_HandoffSpec` `SJf7g`, `PRsNH`), so no screen reaches the treatment total without a generation. The documents were changed to follow the design (planning document §1 and §4 screen 1) and list the rule as removed |

#### 5.10.4 Not verified

- Rendering of every frame except the three in 5.10.2 row 13; touch area and size on a real device; legibility of small text. The `PDF_*` pages and both image folders were not viewed.
- App behavior: no app exists. Timers, reset, calculation, the hold behavior of a reclassified treatment, the document selection logic, and permissions were not run.
- The `state` property of each instance behind the 9 contrast results was not read; whether the open document equals the saved file was not compared.
- No node-by-node comparison with `08e3f22…` (5.10.1). No real insurance, device, or hospital data was added or confirmed; the numbers and the document mapping in the design remain examples.

#### 5.10.5 Status of items A to K at the current save

| Id | Status at `c68530b…` |
|----|----------------------|
| A, B | Retired with the `K02Q_*` frames (5.10.1). The condition data they described is a future rule-data input (section 7) |
| C | The placeholder wording is narrower: "디자인 예시입니다" has 2 text hits (`hmlxu` on `K04_Basis_Calculation`; `w3r9EN`, the example-data line of the spec) and "구현 단계에서" has 2 (`o16qMt` on `K04_Basis_Calculation`; `HORET` on `A01`). The result frames no longer carry a visible assumption-panel placeholder (`S39FN` is gone). Owner decision remains for the basis screen: demo marker or text that stays |
| D | 파일 구조·문구 확인 완료, carried (5.10.2 row 7) |
| E | Carried unchanged: the copy speaks of a "변경 요청" while `A03` has the button "검토 요청" and no separate change-request control; `A02` still has three "검토 완료" text nodes (`GHGjX`, `c10Gp`, `GYSQ1`) |
| F | Observation only: every button instance has an effective height of 88 or more (5.10.2 row 11); the per-frame list of 5.4 item F was not recomputed |
| G | See 5.10.2 row 14 |
| H | Replaced by 5.10.2 rows 12 and 13 and by 5.10.4 |
| I | 파일 구조·문구 확인 완료 (계산 결과 only), with the reading of 5.10.2 row 10 |
| J | 추가 수정 필요 again: 21 of 23 (item Q) |
| K | 파일 구조·문구 확인 완료 (5.10.2 row 9); one carried minor finding (item S) |

### 5.11 Cause step added: working-tree save of 2026-10-13 (dated record; the current state is 5.12)

The owner decided to ask the treatment cause (injury / illness) and to split the documents guidance when the patient does not know it. This section records what was changed and what was actually checked; where it disagrees with 5.10, this section is the current state. The design file was edited through Pencil's `execute` calls, so the record below is of the document as it stands after those calls, not of a committed blob.

#### 5.11.1 What changed

| Area | Change |
|---|---|
| `StepIndicator` (cxHZR) | A third step "치료 원인" was inserted and the former step 3 became step 4; its node ids are unchanged, so the instances that highlighted "치료 선택" still highlight it. Step padding 10/22 to 10/12, inner gap 12 to 8, connectors 36 to 20 px wide, so four steps and the counter fit the 984 px content width (measured: steps 824 px, counter 55 px) |
| Step instances (13) | Counters now read 1/4, 2/4, 3/4, 4/4; the six treatment-screen instances also mark step 3 as completed |
| New screens | `K02b_Cause_Empty` (QfXL0), `K02b_Cause_Selected` (FFtQN), `L_K02b_Cause` (CpUd6), `K07_Documents_Unknown` (J6jAj) |
| Start screens | `K00_Start` and `L_K00_Start` gained a fourth flow chip; the chip labels were shortened to 실손보험 / 보험사 형태 / 치료 원인 / 치료 선택 so four chips fit one row (720 px of 952 px) and match the step labels |
| Hand-off spec (cvUDQ) | `eLIvV` four steps; `E4XomM` states 1/2/3/4; `W4yt8` names step 3 as the cause source; `bAkLF` and `h9KK9R` describe the branch; three rows added to the transition table |
| PDF deck | A flow page was added (`PDF_04_Flow3`); the later pages were renamed `PDF_05_Flow4` to `PDF_11_Modal`; section marks, page labels (now N / 11), step counters in captions, and item numbers 1 to 15 were renumbered; `PDF_08_Exc1` gained a cell for the unknown cause and became "예외 ① 조건을 모를 때" |
| `pdf-assets/` | Re-exported at the existing 2x scale: the eleven screens whose step indicator or flow chips changed, plus the three new screens |

#### 5.11.2 What was checked

| # | Check | Result |
|---|-------|--------|
| 1 | Layout engine over the whole document (`Get` with `ctx.problems`) | 1 problem, pre-existing and unrelated: `ZZ_FontTest` `T Gothic A1` fully clipped. No new screen or edited frame reported |
| 2 | Rendering | `TakeScreenshot` of `StepIndicator`, the three instance states (1/4, 2/4, 4/4), `K02b_Cause_Empty`, `K02b_Cause_Selected`, `L_K02b_Cause`, `K07_Documents_Unknown` (whole screen and its branch row), `K00_Start` and its flow row, `PDF_04_Flow3`, `PDF_08_Exc1`. Blocks present, nothing overlapping, no text outside its box seen; the small image size still prevents reading fine print |
| 3 | Vertical fit of `K07_Documents_Unknown` | Measured: body 1541 px tall, content ends at 1479 px. The first draft overflowed by 56 px; the branch groups were placed side by side and the list head and footer shortened |
| 4 | Colour and type values | Every new node uses existing variables (`$accent`, `$accent-soft`, `$navy`, `$text-body`, `$text-muted`, `$surface`, `$border`, `$font-ko`, the `$fs-*` and `$sp-*` scales). No new variable, and no hard-coded hex, was introduced |

#### 5.11.3 Not checked, and open

- The first pass of this section did not recalculate the contrast table of 5.10.2 row 10; a second pass did, for the whole document (5.11.4 row 1).
- `K03_*` and `L_*` screens were not re-rendered as whole screens after the step-indicator change; only their step-indicator instances were.
- Item N stands and now reaches further: there is still no large-text or landscape variant of `K07_Documents`, and none of `K07_Documents_Unknown` either.
- Whether the injury / illness split should also drive the amount calculation is open (planning document §11). If it does, the "잘 모르겠어요" option becomes an on-hold cause and this design changes.

#### 5.11.4 Second pass on the same save (blob `01bacca…`) and the owner decisions of 2026-10-13

Basis. `git hash-object design/design.pen` = `01bacca5d5bcdc225e4ddc08229f37b0071c6775` (873,306 bytes, file time 17:32:55 on 2026-10-13); HEAD `57f5c01`; divergence from the committed `08e3f22…` as in 5.10 and 5.11.1. The open document was read in Pencil with `Get`, `Print`, and `TakeScreenshot` only; the open document was not compared byte by byte with the disk file; the `moai` command was not on `PATH`, so the session registry was not queried. Another session edited this file and the planning document while this pass was running; the text above was re-read afterwards and the two records were merged without removing the other session's rows.

| # | Check | Result |
|---|-------|--------|
| 1 | Contrast (계산 결과, not a rendering result), method of 5.10.2 row 10 | 1,482 text nodes with component instances expanded; 1,436 resolved, 46 unresolved (gradient logo texts and the nodes listed in 5.10.2 row 10), 10 below the thresholds. All 10 are `disabled-text` `#94A3B8` on `disabled` `#E2E8F0` = 2.08:1: labels in `BottomActions` instances (4), `KXX_Loading_Calculating` buttons (2), and the state board (a button and 3 cards). The inactive-control exception of 2.1 covers them only if each control is actually disabled; the `state` of each instance was not read |
| 2 | Button heights | 62 instances, each with its own `height` of 88 or more: Primary 23 (88 x6, 96 x6, 100 x8, 112, 124, 132), Secondary 39 (88 x27, 96 x7, 100 x3, 104 x2). 0 nodes bind `height` to `$h-btn` |
| 3 | Layout-engine check (not a rendering check) | 0 nodes sticking out of their parent in `K02b_Cause_Empty`, `K02b_Cause_Selected`, `K07_Documents_Unknown`, `L_K02b_Cause`, `K07_Documents`, `K04_Result`, `K02_Type_Empty` |
| 4 | Rendering | `K02b_Cause_Empty` and `K07_Documents_Unknown` (whole screens, about 250 px wide): blocks present, nothing overlapping, "다음" greyed on the empty cause screen; small text not readable |
| 5 | Counts | 80 top-level frames (11 of them `PDF_*`), 1,770 nodes counted by a visitor, 775 text nodes, 227 `ref` nodes, 20 reusable components, 23 color variables. Method as in 5.10 (75 / 1,606 / 710 / 205 / 20) |
| 6 | Findings carried from 5.10.3 | M: `K04_Result` still shows "오늘 병원에 낼 금액 (예상)" / "예상 보험금" / "본인 부담금". N: the action lists of `K04_Result_LargeText` and `L_K04_Result` still lack "보험 청구에 필요한 서류 확인" (`K04_Result_NotCovered` was not re-read). Q: `lwc8y` still lacks `success` and `success-soft`. R: `evvyh` still says "647개". S: `bv2zb` is still gradient text. T: the "당사 콜센터" wording is still in `K01_Generation_Empty`. O: no `K04_Result_Unconfirmed` |

Owner decisions of 2026-10-13, asked one at a time:

| # | Decision | What follows |
|---|----------|--------------|
| 1 | Standard deduction and limit values: the owner will attach a table (image) to the GPT review request; the values are entered in the documents and made into data afterwards | Item stays open until the table arrives (section 7). No value was invented |
| 2 | Cause (injury / illness) input: the owner added the step in the design (`K02b_Cause_*`, input step 3 of four) | Item L is resolved by the design (5.11.1) |
| 3 | Treatment-total-only path: not provided; "세대를 모르겠어요" simply goes to `K01_Generation_Unknown` | Item U is settled: the rule of the earlier planning document is dropped |
| 4 | Font: Pretendard | Item P is decided. The spec sentences `V3IIhO` ("font-ko Noto Sans KR", re-read in this pass), `vvQjy`, and Note 9 `OYwdU` still say Noto Sans KR (the last two were not re-read), a Pencil change — **made on 2026-10-13, see 5.11.5**. Pencil cannot render Pretendard (`ZZ_FontTest` `AVcat`: "지정 불가 · 대체 글꼴로 표시됨"; `tBiRa`: Noto Sans KR "현재 · 사용 가능"), and 767 text nodes bind `$font-ko`, so every on-screen clipping check is made with a fallback font; the real font needs its own check |
| 5 | On-hold ("확인 필요") result screen | Settled at implementation design. Item O stays open until then |

#### 5.11.5 Font sentences changed to Pretendard (2026-10-13)

The owner instructed that every place naming Noto Sans KR be changed to Pretendard. The variable `font-ko` was already `Pretendard` and was not touched; what changed is the prose that still named Noto Sans KR as the font to use.

| Node | Before | After |
|---|---|---|
| `V3IIhO` (`ZZ_HandoffSpec`, string list) | `font-ko Noto Sans KR` | `font-ko Pretendard` |
| `vvQjy` (`ZZ_HandoffSpec`, font rule) | Noto Sans KR first, Pretendard as the first fallback | Pretendard first, then Noto Sans KR → 맑은 고딕 → system sans-serif; also asks for web-font loading to be confirmed, not only a device-installed font |
| `OYwdU` (Note 9) | same order as `vvQjy` | same change |
| `tBiRa` (`ZZ_FontTest` label) | "Noto Sans KR (현재 · 사용 가능)" | "Noto Sans KR (대체 1순위 · 사용 가능)" |
| `AVcat` (`ZZ_FontTest` row) | "Pretendard (지정 불가 · 대체 글꼴로 표시됨)" | "Pretendard (확정 글꼴 · Pencil에서는 지정 불가, 대체 글꼴로 표시됨)" |

Checked: a search of every text node for "Noto" returns three hits, all of them intended — the two fallback-order sentences (`vvQjy`, `OYwdU`) and the font-test row label (`tBiRa`). The font-test sample `ii1yx` still binds the literal family `Noto Sans KR`; that frame compares how fonts render, so its samples keep their own families. `GetVariables` reads `font-ko` = `Pretendard`.

Not changed, and still open: Pencil cannot render Pretendard, so the design screens are still drawn in a fallback font and clipping in the real font has not been checked anywhere. Whether the device carries Pretendard or it is loaded as a web font is undecided (section 7).

### 5.12 Consistency pass of 2026-10-14: documents entry, amount names, brand wording, and the removal of the large-text frames (current state)

Basis. Review target: commit `a2bfce8f66d4927e385e621aea5fdcb3b238d527`, design blob `8709809b5801d324de95e08eb779d3beee861936`. **The on-disk file still reads `8709809…`**: every change below was made with Pencil `execute` calls against the open document and has not been written to disk. A Pencil save is required before the `design:` commit, and the blob must be re-read and recorded then (section 6 staging rule). Checks below were run with `Get` / `Print` / `TakeScreenshot` on the open document.

#### 5.12.1 What changed

| # | Area | Change |
|---|------|--------|
| 1 | Documents entry | `K04_Result_NotCovered` (XxmHQ) and `L_K04_Result` (n3WXk) gained "보험 청구에 필요한 서류 확인". `XxmHQ` gained a row-0 frame (`blFMX` / button `Cii3R`, height 88); `n3WXk`'s flat action row was restructured into a vertical `kt6xq` with row 0 (`M0UEt` / `ohyEl`, 88) and row 1 (`ocqCm`, the five previous buttons). Item N of 5.10.3 is closed |
| 2 | Space for #1 in `XxmHQ` | The body had 14 px of slack and the new row needs 116, so the assumption panel (`reynT`), whose first two sentences repeated the condition row and the amount captions, was compressed to one sentence, and `fHA94` gap 32 to 12, `TYBQa` padding 24 to 18, `reynT` padding 24/32 to 18/28, `eCbcd` padding 16 to 14, `o98fQ1` gap 16 to 12. No content was removed from the screen |
| 3 | Amount names | All 15 `AmountCard` instances across `K04_Result`, `K04_Result_NotCovered`, `L_K04_Result`, `K04_Result_Dialog_Timeout` now read 예상 병원 결제액 / 예상 보험금 / 보험금 수령 후 예상 본인 부담. The third caption is "보험금을 받은 뒤 남는 예상 부담액이며, 오늘 병원에 결제할 금액이 아닙니다." Amounts unchanged: 124,000 / 114,000 / 10,000 normal, 124,000 / 74,000 / 50,000 not-covered. Item M of 5.10.3 is closed |
| 4 | Brand and channel wording | The `HelpPanel` body override in `K01_Generation_Empty` (LMKmS), `K01_Generation_Selected` (gQtVy), and `L_K01_Generation` (JNcEQ) is now "보험증권이나 보험사 앱에서 가입일을 확인해 주세요. / 확인이 어려우면 1544-8069로 문의해 주세요." The previous "당사 콜센터 … 카카오톡 채널 문의 : 메디헬퍼" is gone and the channel was not renamed to 보담. On `K01_Generation_Unknown`, step 2 reads "확인이 어려우면 1544-8069로 문의해 주세요" (`xTvRQ`) with "번호는 안내 문구이며 키오스크에서 전화가 걸리지는 않습니다." (`IMzH0`), replacing "가입 조건을 바로 확인해 드립니다". Item T of 5.10.3 is closed |
| 5 | Publish wording | `A04_Admin_PublishPreview` `KxKl3` now states that a published change keeps the patient's selections, that the server checks the price and rule version at calculation time, that a differing version re-announces the latest amount and the fact that it changed, and that a stale value never finalises a result. "현재 세션이 끝난 뒤 적용됩니다" was removed |
| 6 | Documents screens, landscape | New frames `L_K07_Documents` (CL4xk) and `L_K07_Documents_Unknown` (mZDkv), both 1920x1080. Nine lines in three columns; the unknown variant puts the seven common lines in two columns and stacks the two conditional groups in a third. Checks, reasons, the branch, "결과로 돌아가기" and "이용 완료" are all present; nothing was dropped |
| 7 | Large text removed | Owner decision of 2026-10-14: no dedicated large-text frames; the enlarged layout is produced responsively at implementation. Deleted `K03_Treatments_LargeText` (wKadX), `K04_Result_LargeText` (woEM7), and the two large-text documents frames built earlier in the same session. The "큰 글자 보기" toggle (`MkKly`) stays in `KioskHeader` |
| 8 | PDF deck | `PDF_10_Large` deleted; `PDF_11_Modal` renamed `PDF_10_Modal`; page labels now read N / 10 on all eight numbered pages; the cover note (`dt1ng`) no longer promises a 보조 모드 section. Ten pages remain |
| 9 | Hand-off spec | `lwc8y` now lists all 23 colour variables including `success #136C3B` and `success-soft #E6F4EC` (item Q closed). `evvyh` replaces the stale "647개" with a dated recount (item R closed). `Rwhuj` / `tPJHf` drop the fixed "33개 화면" and say to count `KioskHeader` instances. `IDKgG` describes large text as responsive rather than as frames; `NMSFa` names the amount wording and the new caption; transition rows `ekJGP` / `kw3S4` / `qOtbk` / `yOzQX` / `hLTpH` / `RxvMB` carry the entry-point, branch, and return rules; section label `C1Yxh8` drops 큰 글자 보기 |
| 10 | Pre-existing clipping fixed | `L_K02b_Cause` cause-card titles overflowed their 208 px body (274 px at 32 px, `textGrowth` auto). The three instances now wrap with an explicit break: "다쳐서 왔어요 / (상해)", "아파서 왔어요 / (질병)", "잘 모르겠어요". Not caused by this pass; found by the item-7 clipping check and fixed because it is a visible defect on a landscape screen |

#### 5.12.2 What was checked

| # | Check | Result |
|---|-------|--------|
| 1 | Layout engine over the whole document (`Get` with `ctx.problems`, instances expanded) | 8 findings remain, and **every one is on a node whose `enabled` is `false`**, i.e. hidden: `Help Actions` (`V3kMcu`) in four `HelpPanel` instances, `Check Icon` in `A03_Admin_TreatmentEdit`, `Select Mark` in `L_K02_Type` and `L_K02b_Cause`, and the pre-existing `ZZ_FontTest` `T Gothic A1`. No enabled node sticks out of its parent anywhere in the file |
| 2 | Rendering | `TakeScreenshot` of `K04_Result_NotCovered`, `L_K04_Result`, `K01_Generation_Empty`, `L_K01_Generation`, `L_K07_Documents`, `L_K07_Documents_Unknown`, `L_K02b_Cause`. Blocks present, nothing overlapping, no text outside its box, the documents button visible on both result screens, the new help wording visible. Image width is about 250-400 px, so fine print is still not readable |
| 3 | Text contrast (계산 결과, not rendering) | Recomputed over the current document with instances expanded and variables resolved: 1,461 text nodes, 1,415 resolved, 46 unresolved (gradient or otherwise unresolvable background), 10 below threshold. All 10 are `disabled-text #94A3B8` on `disabled #E2E8F0` = 2.08:1 — labels of inactive controls, which fall under the 2.1 exception only if each control is genuinely disabled; the `state` of each instance was not read. This is the figure now quoted in `evvyh` |
| 4 | Counts | 79 top-level nodes (10 of them `PDF_*`), 1,848 nodes, 802 text nodes, 219 `ref` nodes, 20 reusable components, 23 colour variables, 29 screens carrying a `KioskHeader` instance |
| 5 | Deleted-name sweep | A text search for `K03_Treatments_LargeText`, `K04_Result_LargeText`, `K07_Documents_LargeText`, `K07_Documents_Unknown_LargeText`, `PDF_10_Large`, and "/ 11" returns 0 hits; no `ref` points at a deleted frame |
| 6 | Old brand and channel sweep | A text search for 메디헬퍼, 카카오, 당사 콜센터, and 바로 확인해 드립니다 over both node content and instance overrides returns 0 hits |

#### 5.12.3 Not checked, and open

- The design file on disk is unchanged; everything above is in the open Pencil document. Nothing here is evidence about a committed blob.
- Pencil cannot render Pretendard, so every clipping result in 5.12.2 row 2 was observed in a fallback font. The real font still needs its own check (5.11.5). Each `execute` call that created text reported `Font family '$font-ko' (aka 'Pretendard') is invalid` for the new nodes; that is the same known limitation, not a new fault.
- The ten sub-threshold contrast pairs are accepted only if those controls really are disabled; the per-instance `state` was not read.
- Large text has no design artefact at all now, so the requirement in `보담_기획설계_v0.2.md` §13.1 can only be verified on the built screen.
- The exported images under `design/pdf-assets/` still contain the deleted large-text screens and the 11-page numbering; they were not re-exported.

## 6. Git handling for `.pen` files

`.gitattributes` carries `*.pen -text` so Git does not convert line endings in `.pen` files and file bytes are preserved. The file name `design/design.pen` stays unchanged.

History: when the attribute was added, the Windows clone (`core.autocrlf=true`) held a CRLF working copy of an LF blob (21,224 CR; content identical once CR is removed), and `-text` would have made that look like a whole-file change. Pencil's saved revisions are LF: the committed revisions (`f0520ad`, `fecc9fa`, `836a8f6`) all report `i/lf w/lf attr/-text`, so the feared whole-file rewrite did not occur. Review checklist step 1 keeps checking this on every saved revision.

Staging rule: stage by explicit path. MoAI never writes `design/design.pen`; a Pencil save is committed on its own as a `design:` commit, after its blob is re-checked, separate from the `docs:` commit that records the review. `design/previews/`, `design/pdf-assets/`, and `design/deliverables/` are not committed.

## 7. Inputs needed for the next SPEC (working name SPEC-REIMBURSEMENT-ESTIMATOR-001)

Not started in this step; implementation is out of scope.

Decisions needed:
- Real kiosk device: screen size, orientation, resolution, OS, browser, mounting height, network.
- Hospital: official name, logo, institution type, real treatment list and prices (full fee versus patient copay), common base fee.
- First insurer, product, and coverage whose real policy text will back published rules; their deduction types and outpatient limit options.
- 1544-8069: operating entity, purpose, hours. Complete "1588" number if it is ever to be shown.
- Rounding policy per rule; formulas for generation 1 injury/illness outpatient, generation 2 percentage deduction rates, generation 3 basic and three-major non-benefit rules, shared limits.
- Classification of 신장분사치료 (procedure code, billing content, purpose).
- Whether a staff-entry or staff-call feature will ever exist (needs flow and permission definition first).
- Split of rule-administration duties between the insurance-rule reviewer and the platform operator.
- Whether the placeholder sentences "디자인 예시입니다" / "구현 단계에서 … 연결합니다" on the calculation-basis frame (and "구현 단계에서" on `A01`) are demo markers removed at implementation or text that stays (5.10.5, item C).
- The standard deduction and limit profile the result uses for each generation and insurer type: the values, the source policy, and who approves them. The design says a standard assumption is applied and shows one example (C1, 의원 외래 공제 1만원, 회당 한도 25만원), but no document defines the profile for the other generations or insurer types (section 3 row 17). The owner will attach a table (image) to the GPT review request; the values are entered in the documents and made into data afterwards (decision of 2026-10-13).
- What the insurer-type choice (손해보험사 / 생명보험사 / 그외 공제 조합) means for rule selection: the planning document lists individual insurers and products, while the design asks only for the type.
- Required-documents rules: the real requirement per insurer, product, and claim-amount band, including whether a diagnosis certificate can be omitted for a small claim. The design marks its mapping as an example (`pQTqj`).
- Font: decided as Pretendard (2026-10-13); the spec sentences were changed to match on the same day (5.11.5). Still open: whether the real device has Pretendard or it is loaded as a web font. Pencil cannot render Pretendard, so on-screen clipping checks use a fallback font.
- On-hold ("확인 필요") result screen: the owner decided on 2026-10-13 to settle it at implementation design (5.10.3 item O stays open until then).
- Whether the injury / illness split should also drive the amount calculation (planning document §11); if it does, "잘 모르겠어요" becomes an on-hold cause.
- Whether `design/pdf-assets/` should be re-exported: the images there still show the deleted large-text screens and the 11-page numbering (5.12.3).
- Purpose and audience of the `PDF_*` flow pages and the `design/pdf-assets/` images (`design/deliverables/` is empty).
- Medical-advertising rules in force at deployment time.
- Exact shape of the per-group plus overall calculation result.
- Stack: database, hosting, admin authentication provider, test runner.

Settled, no longer open (listed so they are not asked again):
- Decisions of 2026-10-14 (5.12): the documents screen is entered from every finished-calculation result, including the not-covered and landscape ones, and "결과로 돌아가기" returns to the result the patient came from rather than a fixed normal result. The documents screen has landscape frames. Large text keeps its toggle and its requirement but has **no** dedicated frames: `K03_Treatments_LargeText` and `K04_Result_LargeText` were deleted and the enlarged layout is produced responsively at implementation, so items 4, 12, and 18a of section 3 are verified on the built screen for that mode. The PDF deck is ten pages. The amount names and the third caption are fixed as in section 3 row 4.
- Behavior of a classification change before reviewer approval: invalidate the approved mapping and hold that treatment's expected payout; a price-only change keeps the mapping and publishes a new price version (section 3 row 14; the Pencil wording is in the save `08e3f22…`, 5.8.2 rows 5 and 6, and is unchanged in `c68530b…`, 5.10.2 row 7).
- Condition questions are not part of the patient flow, and the consultation screen and every "staff inquiry" button are removed. The design at save `c68530b…` was changed accordingly and the documents follow it (instruction of 2026-10-13). The amount labels stay as the documents define them until the owner decides otherwise (5.10.3 item M). Decided later on 2026-10-13 (5.11.4): the cause is asked on input step 3 of four; a patient who does not know the generation gets guidance only (no treatment-total-only path); the font is Pretendard; the standard values come from a table the owner attaches to the GPT review request; the on-hold result screen is settled at implementation design.
- Minimum text contrast: 4.5:1 normal, 3:1 large, key kiosk guidance aiming for 4.5:1 (section 2.1; calculated as met in the save `08e3f22…`, 5.8.2 row 3; the rendered check is done for the screens listed in 5.9 and open for the rest). Recalculated for the save `c68530b…` in 5.10.2 row 10: the only pairs below the thresholds are disabled-control labels, which fall under the inactive-control exception only if each control is actually disabled.

Input materials needed:
- Actual policy texts with clause, page, revision, and effective dates; the original comparison image; the hospital's price list and procedure codes; Pencil's further saved revisions of `design.pen` and, if available, rendered views of the same saved revision.
