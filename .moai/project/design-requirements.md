# Design Requirements and Review Criteria: 보담 (bodam)

> Status: planning only. Derived from `보담_기획설계_v0.2.md` ("§N" refers to it) and from read-only inspection of `design/design.pen`. Review basis commit: `f0520ad6da6caa78e40a1d45f56caa54eb6e8ce8`. Later saves of the same file are recorded separately in section 5.3: the save committed as `fecc9fa`, and the rebrand save (service name 보담, new color palette) committed as `836a8f6`. The brand-change review at repository HEAD `a9ffcfd` (same file blob as the latest save) is recorded in section 5.7. Nothing here claims that any screen was rendered, that the app exists, or that any device was tested. `design/design.pen` is edited only by Pencil; MoAI reviews it and never writes it.

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

- Large-text mode is a required MVP feature, not a candidate. Buttons, amounts, and key guidance must not clip in it, selections persist, and it keeps every function of the normal mode (on the result screen: edit insurance conditions, calculation basis, reselect treatments, ask staff, start over, finish).
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
| 1 | Insurance conditions are separate questions: deduction type and outpatient coverage limit, each with its own "모르겠어요". The limit question must not contain a deduction-type answer such as "선택형Ⅱ 가입이에요". Only limits and deduction types registered in a confirmed policy are offered; otherwise "확인 필요". No staff-entry feature is implied unless its flow and permission are defined | `K02Q_Conditions_Unknown` (H5Xw9I), `K02Q_Conditions` (VwsQ9), `K02Q_Conditions_Copay`, `K02Q_Conditions_LimitValue` |
| 2 | Injury/illness help text is cause-based: injury = "넘어짐·부딪힘 등 사고나 외부 충격으로 생긴 치료"; illness = "사고나 외부 충격 없이 발생한 질환으로 받는 치료"; unknown = "원인이 불분명하면 직원에게 확인해 주세요". No symptom-only wording such as pain or inflammation | `K02Q_Conditions` (VwsQ9) |
| 3 | Hospital administrator edits menu and prices, registers coverage-classification fields (benefit class, procedure code, treatment class) or requests a change to them, views review status (read-only), requests review, and reads the result and rejection reason. Only the insurance-rule reviewer approves or rejects. No "검토 완료" control lets a hospital administrator approve a coverage mapping. A classification change requires re-review; a price-only change does not | `A03_Admin_TreatmentEdit` (ECPf6), `A02_Admin_TreatmentList` |
| 4 | All results distinguish 예상 병원 결제액, 예상 보험금, 보험금 수령 후 예상 본인 부담, and the last one is not readable as today's hospital payment | `K04_Result` (TJoQ2), `K04_Result_NotCovered` (XxmHQ), `K04_Result_LargeText` (woEM7), `L_K04_Result` (n3WXk) |
| 5 | State handling: unconfirmed condition = hold, "확인 필요", null; network error = failure and retry, null; confirmed exclusion = item 0 won with reason; normal 0 won = 0 with basis. Confirmed-unknown is never shown as excluded | `K04_Result_Unconfirmed` (Ni5aI), `K04_Result_NotCovered` (XxmHQ), `KXX_Error_Network` (bWvFJ) |
| 6 | A result that excludes some treatments must not carry the assumption text "선택한 치료가 모두 보장 대상". The assumption instance and the hand-off note must be consistent with the displayed numbers | `K04_Result_NotCovered` (XxmHQ): assumption instance `reynT` / text `MzQqc`; `ZZ_HandoffSpec` (cvUDQ) / text `bI1cW` |
| 7 | Idle reset: input screens warn at 100 s and reset at 120 s; result screens warn at 160 s and reset at 180 s. The warning shows remaining time, "계속 사용할게요", and "처음으로"; extension is repeatable and restarts the idle time | `ZZ_HandoffSpec` (cvUDQ) text `MVOb1`, `K04_Result_Dialog_Timeout` (YcF5k), `K03_Treatments_Dialog_Reset` (r4N0OQ) |
| 8 | A consultation entry exists on the normal result screen as well; returning from consultation keeps the selections and result; "이용 완료" (user ends) and automatic reset are distinct. 1544-8069 shown as the user-provided number; operating entity and hours unconfirmed; "1588" not completed; no real call or staff-call feature | `K04_Result` (TJoQ2), `K05_Consult` (SmZwC) |
| 9 | Button components carry height 88 (a direct value is acceptable). An instance either inherits it or sets a larger value; an instance below 88 is a finding | `Button_Primary` (s8D6J), `Button_Secondary` (m1gMGk) |
| 10 | Condition questions are built from the selected product's reviewed condition data, not fixed per generation; only needed questions are asked; the deduction-type question is asked for any generation whose product needs it. Patient condition screens carry only the question, options, a short help text, and "모르겠어요". No "N", generation rule list, question-count method, data/option-generation explanation, or "staff entry not offered" note on a patient screen; that content lives in `ZZ_HandoffSpec` | `K02Q_*`, `ZZ_HandoffSpec` (cvUDQ) |
| 11 | Every "모르겠어요" / "모르는 채로 계속" / "목록에 없어요" on a condition screen has one destination rule: record that condition as "확인 필요" and go to the remaining needed question, or to `K03_Treatments_Empty` when none remain. No two hand-off rows give the same control different destinations | `ZZ_HandoffSpec` (cvUDQ), `K02Q_*` |
| 12 | The large-text result screen offers the same actions as the normal result screen, including "보험 조건 수정" | `K04_Result_LargeText` (woEM7) vs `K04_Result` (TJoQ2) |
| 13 | Admin copy describes what the admin UI actually allows: where benefit class and procedure code are editable, the text says they are registered or change-requested, and what a change does before approval, as fixed in row 14 | `A03_Admin_TreatmentEdit` (ECPf6) |
| 14 | Admin change rules (fixed by `보담_기획설계_v0.2.md` §7 "변경 종류별 재검토 기준", `product.md` (the line on re-review triggers), `structure.md` (the "Review trigger split" paragraph); not an open decision). A change that affects the coverage judgement (treatment or procedure code, benefit/non-benefit class, insurance calculation class) invalidates the existing approved mapping, and the expected payout of that treatment is on hold until re-review. A price-only change keeps the approved mapping and is published as a new price version with a change history. Every admin sentence about these changes must say the same | `A03_Admin_TreatmentEdit` (ECPf6) `VLDdc`, `F8XwNC`, `Pz5m4`; `ZZ_HandoffSpec` (cvUDQ) `JKWXH` |
| 15 | The color list in `ZZ_HandoffSpec` equals the file's color variables (name and value), and all text meets the criteria in 2.1 | `ZZ_HandoffSpec` (cvUDQ) `lwc8y`; all frames |

## 4. Review checklist for a saved Pencil revision

Run after Pencil reports a saved revision, against the actual file in the working tree:

1. `git status`, `git ls-files --eol`, `git diff --stat` for `design/design.pen`: confirm a revision exists, line endings are LF, and the diff is a content change and not a whole-file rewrite caused by line-ending conversion. Record the git blob (`git hash-object design/design.pen`) of the file that was read, and compare it with `HEAD:design/design.pen`, so a later save is never mistaken for the reviewed one.
2. Parse the file as JSON; list top-level frames and confirm the IDs in section 3 still exist.
3. Check component and variable references resolve. For buttons, check the component height (88, direct value allowed) **and** each instance: an absent `height` means it inherits the component's 88; an explicit value is compared with 88. Do not report an instance as inconsistent only because its own `height` is absent. Whether `h-btn` is bound is recorded but is not a pass condition.
4. Search the file text for the old wording (section 5) and for the new required wording (section 3).
5. Check consistency across portrait (K*), landscape (L_K*), large-text, and exception frames: same amounts, same terms, same assumption text, same actions.
6. Check the numbers on result frames against the examples in `보담_기획설계_v0.2.md` §6.4 (A to E).
7. If Pencil can render screens or screenshots are provided of the same saved revision: check text clipping, overlap, button size, and content outside the frame. Otherwise record "실제 렌더링 미확인". Exported images that predate the save being reviewed are not evidence for it.
8. A structural check (steps 1 to 6) never counts as proof of rendering or app behavior.
9. Brand and color: compare the `ZZ_HandoffSpec` color line (`lwc8y`) with `variables` entry by entry (name and value; also report variables missing from the line). Check the string variable `service-name` and the wordmark texts, and count occurrences of the old name in the file and in tracked files other than history records.
10. Contrast: for every text node, resolve its fill variable and its nearest solid background, compute the ratio, and compare with 2.1 using the node's font size and weight. Report nodes whose background could not be resolved (gradient, image, instance override) as unresolved, never as passing. Record this as 계산 결과 only (2.1).

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

A to E correspond to the five fixes requested of Pencil after `f0520ad`. F to H are further observations. D and I were rewritten and J and K added at the brand-change review (5.7). Statuses refer to the latest save (blob `c4a5800…`, still the file at HEAD `a9ffcfd`); none is closed by a report alone. "추가 수정본 대기" marks an item whose change was requested of Pencil and is not in the file read in this review.

| Id | Item | Status |
|----|------|--------|
| A | `K02Q_Conditions` "모르겠어요" destination duplicated | 파일 구조·문구 확인 완료. The control has one hand-off row (`VnL8t`, 5.3 #7). The entry cell (`b292e`) now reads "상품에 필요한 조건 질문의 첫 화면(예: K02Q_Conditions)", so a product that starts at `K02Q_Conditions_Copay` is not contradicted. Minor wording note, not blocking: "첫 번째로 필요한 질문" would be more exact than "첫 화면" |
| B | Product-needed conditions vs fixed per-generation rules | 파일 구조·문구 확인 완료: `ZZ_HandoffSpec` (`U2xB3Q`) and Note 2 (`ZxXPh`) both say questions come from the product's reviewed condition data and are not fixed by generation. Documents aligned: planning document §4, product.md 5.1, structure.md API table |
| C | "N", display rules, internal explanations on patient screens | 파일 구조·문구 확인 완료 for `K02Q_*`: no "N", no 표시 규칙, no data/option-generation explanation, no staff-entry note; that content now lives in `ZZ_HandoffSpec` (`LvJu6`, `JPZxN`). 추가 수정 필요 / 추가 수정본 대기 (owner decision): placeholder wording "디자인 예시입니다" is still in the visible assumption panel of `K04_Result` (`S39FN`), `K04_Result_NotCovered` (`reynT`), `K04_Result_Dialog_Timeout` (`p17ndv`), `L_K04_Result` (`AMVGI`), and "구현 단계에서 … 연결합니다" / "디자인 예시입니다" on `K04_Basis_Calculation` (`o16qMt`, `hmlxu`). Decide whether these are demo markers removed at implementation or text that stays |
| D | Behavior of a classification change before approval | 추가 수정 필요 / 추가 수정본 대기. Rule is fixed, not open: a coverage-affecting change invalidates the approved mapping and holds that treatment's expected payout until re-review; a price-only change keeps the approved mapping and is published as a new price version (row 14 in section 3; `보담_기획설계_v0.2.md` §7, `product.md`, `structure.md` already say this and need no change). The saved file disagrees in two places: `VLDdc` ("승인 전까지는 직전 승인 분류로 환자 계산이 유지됩니다") and `ZZ_HandoffSpec` `JKWXH` ("…직전 승인 분류가 유지됩니다") keep the old mapping valid. `F8XwNC` and `Pz5m4` ("승인 전까지 환자 계산에 반영되지 않습니다") do not say the old mapping stops applying or that the payout is on hold. Sentence-level findings and replacement wording for Pencil: 5.7.4. This is a Pencil fix, not a question for the owner |
| E | Admin 급여 구분 / 행위 코드 UI vs scope text | 파일 구조·문구 확인 완료 for the copy: role chip "권한: 메뉴·금액 편집 · 분류 변경 요청" (`N6ORf3`), "보장 매핑 승인 권한 없음" (`HQ2j1`), admin description (`hc7K8`) say register or request a change, with approval and rejection by the reviewer. 추가 수정 필요 / 추가 수정본 대기 (minor): the copy speaks of a "변경 요청" but A03 has a "검토 요청" button and no separate change-request control; unify the terms or add a control. `A02_Admin_TreatmentList` has three "검토 완료" text nodes (`GHGjX`, `c10Gp`, `GYSQ1`), each the label inside a node named "Status 검토 완료" in a table row; A03 has none. Whether the A02 badges behave as controls is 실제 렌더링 미확인 |
| F | Large-text button heights | Observation, no verdict: `K04_Result_LargeText` secondary buttons are 104, 104, 88, 88, 88 and the primary is 112; `K04_Result` has five secondary at 88 and a primary at 100; `L_K04_Result` has 96, 96, 96, 88, 88 and a primary at 96. Confirm intent; 실제 렌더링 미확인 |
| G | Preview images | `design/previews/` holds 8 PNG (`ECPf6`, `H5Xw9I`, `TJoQ2`, `VwsQ9`, `woEM7`, `zREqB`, `ZxXPh`, `h4KfhK`), untracked, not created by MoAI, file time 09:25 on 2026-10-13, before the 09:33 and 09:51 saves, so it cannot be assumed that they show the name or colors as saved (an earlier version of this document counted 13 images). They cannot be tied to a specific saved revision, are not evidence for the latest save, and were not viewed in this review or in 5.7. They stay out of the commit |
| H | Items never read in a rendered view | `K05_Consult`, `K03_Treatments_Dialog_Reset`, full large-text clipping, `ZZ_HandoffSpec` long-text clipping, `A02` status labels, and the spacing changes in `K04_Result_NotCovered` and `K04_Result_LargeText` (5.3): 실제 렌더링 미확인 |
| I | Text contrast of the new palette | 추가 수정 필요 (계산 결과; criteria now in 2.1). `text-muted` (`#94A3B8`) is 2.45:1 on `bg`, 2.56:1 on `surface`, 2.34:1 on `surface-alt`: below 3:1, so it fails the large-text minimum as well as the 4.5:1 normal-text minimum. It is the fill of 97 text nodes (kiosk 40 at 20 to 24 px, admin 33 at 11 to 16 px, shared components and notes 24) and 22 icons. Several kiosk nodes are key guidance (for example `K00_Start` `CHgw8`, `K05_Consult` `yGXlJ`, "확인 필요" `tBSNm`). Fix for Pencil: darken the `text-muted` variable so every pair is 4.5:1 or more (a candidate such as `#5B6B80` gives 5.20, 5.44, 4.97 by calculation; the value itself is Pencil's choice). The 6 `disabled-text` nodes on `K03_Treatments_Page2` are 2.56:1 at 32 and 36 px; see 5.7.3. Tables, counts, and unresolved nodes: 5.7.3. 실제 렌더링 미확인 |
| J | `ZZ_HandoffSpec` color line vs variables | 추가 수정 필요. `lwc8y` lists the pre-rebrand teal palette: 14 of 20 listed values differ from the file's variables and `shadow` is not listed. Table: 5.7.2 |
| K | Official logo version and where each is used | 추가 수정 필요. The file holds two forms of the logo and nothing marks either as official; `ZZ_HandoffSpec` does not mention the logo. Details: 5.7.5 |

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

## 6. Git handling for `.pen` files

`.gitattributes` carries `*.pen -text` so Git does not convert line endings in `.pen` files and file bytes are preserved. The file name `design/design.pen` stays unchanged.

History: when the attribute was added, the Windows clone (`core.autocrlf=true`) held a CRLF working copy of an LF blob (21,224 CR; content identical once CR is removed), and `-text` would have made that look like a whole-file change. Pencil's saved revisions are LF: the committed revisions (`f0520ad`, `fecc9fa`, `836a8f6`) all report `i/lf w/lf attr/-text`, so the feared whole-file rewrite did not occur. Review checklist step 1 keeps checking this on every saved revision.

Staging rule: stage by explicit path. MoAI never writes `design/design.pen`; a Pencil save is committed on its own as a `design:` commit, after its blob is re-checked, separate from the `docs:` commit that records the review. `design/previews/` is not committed.

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
- Whether the placeholder sentences "디자인 예시입니다" / "구현 단계에서 … 연결합니다" in the result and calculation-basis frames are demo markers removed at implementation or text that stays (5.4 item C).
- Medical-advertising rules in force at deployment time.
- Exact shape of the per-group plus overall calculation result.
- Stack: database, hosting, admin authentication provider, test runner.

Settled, no longer open (listed so they are not asked again):
- Behavior of a classification change before reviewer approval: invalidate the approved mapping and hold that treatment's expected payout; a price-only change keeps the mapping and publishes a new price version (section 3 row 14; the remaining work is the Pencil wording in 5.7.4).
- Minimum text contrast: 4.5:1 normal, 3:1 large, key kiosk guidance aiming for 4.5:1 (section 2.1; the remaining work is the Pencil fix in 5.4 item I).

Input materials needed:
- Actual policy texts with clause, page, revision, and effective dates; the original comparison image; the hospital's price list and procedure codes; Pencil's further saved revisions of `design.pen` and, if available, rendered views of the same saved revision.
