# Design Requirements and Review Criteria: 보담 (bodam)

> Status: planning only. Derived from `보담_기획설계_v0.2.md` ("§N" refers to it) and from read-only inspection of `design/design.pen`. Review basis commit: `f0520ad6da6caa78e40a1d45f56caa54eb6e8ce8`. Later saves of the same file are recorded separately in section 5.3: the save committed as `fecc9fa`, and the rebrand save (service name 보담, new color palette) committed as `836a8f6`. Nothing here claims that any screen was rendered, that the app exists, or that any device was tested. `design/design.pen` is edited only by Pencil; MoAI reviews it and never writes it.

## 1. Purpose and ownership

- Pencil edits `design/design.pen`. MoAI maintains the requirements below and reviews each saved revision against them.
- This file is the checklist the review uses. An item is marked complete only after the saved file was actually read; a report from Pencil that a change was made is not completion.
- Status labels used in section 5:

| Label | Meaning |
|-------|---------|
| 파일 구조·문구 확인 완료 | Found in the saved `.pen` JSON (structure, node text, component properties). Says nothing about how it looks |
| 추가 수정 필요 | The saved file does not yet meet the requirement, or two sources disagree; a Pencil or owner decision is needed |
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
| 13 | Admin copy describes what the admin UI actually allows: where benefit class and procedure code are editable, the text says they are registered or change-requested, and that nothing changes patient calculation without reviewer approval (rule for the interim state: see 5.4 item D) | `A03_Admin_TreatmentEdit` (ECPf6) |

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

A to E correspond to the five fixes requested of Pencil after `f0520ad`. F to H are further observations. Statuses refer to the latest save (blob `c4a5800…`); none is closed by a report alone. "추가 수정본 대기" marks an item whose change was requested of Pencil and is not in the file read in this review.

| Id | Item | Status |
|----|------|--------|
| A | `K02Q_Conditions` "모르겠어요" destination duplicated | 파일 구조·문구 확인 완료. The control has one hand-off row (`VnL8t`, 5.3 #7). The entry cell (`b292e`) now reads "상품에 필요한 조건 질문의 첫 화면(예: K02Q_Conditions)", so a product that starts at `K02Q_Conditions_Copay` is not contradicted. Minor wording note, not blocking: "첫 번째로 필요한 질문" would be more exact than "첫 화면" |
| B | Product-needed conditions vs fixed per-generation rules | 파일 구조·문구 확인 완료: `ZZ_HandoffSpec` (`U2xB3Q`) and Note 2 (`ZxXPh`) both say questions come from the product's reviewed condition data and are not fixed by generation. Documents aligned: planning document §4, product.md 5.1, structure.md API table |
| C | "N", display rules, internal explanations on patient screens | 파일 구조·문구 확인 완료 for `K02Q_*`: no "N", no 표시 규칙, no data/option-generation explanation, no staff-entry note; that content now lives in `ZZ_HandoffSpec` (`LvJu6`, `JPZxN`). 추가 수정 필요 / 추가 수정본 대기 (owner decision): placeholder wording "디자인 예시입니다" is still in the visible assumption panel of `K04_Result` (`S39FN`), `K04_Result_NotCovered` (`reynT`), `K04_Result_Dialog_Timeout` (`p17ndv`), `L_K04_Result` (`AMVGI`), and "구현 단계에서 … 연결합니다" / "디자인 예시입니다" on `K04_Basis_Calculation` (`o16qMt`, `hmlxu`). Decide whether these are demo markers removed at implementation or text that stays |
| D | Behavior of a classification change before approval | 추가 수정 필요 / 추가 수정본 대기 (conflict between sources; owner decision first). The "재검토 필요" body of `A03_Admin_TreatmentEdit` (`VLDdc`) says "승인 전까지는 직전 승인 분류로 환자 계산이 유지됩니다" (added after `f0520ad`, present at `fecc9fa`). The field hints (`F8XwNC`, `Pz5m4`) say a change is "승인 전까지 환자 계산에 반영되지 않습니다", which fits either rule. Planning document §7, product.md, and structure.md say a coverage-affecting change invalidates the approved mapping and the treatment's expected payout is on hold until re-reviewed. Until the owner decides, the "hold" rule in those three documents governs and the `VLDdc` sentence needs revision. If the owner chooses "keep the last approved class", the planning document, product.md, structure.md, and the test table must change together. No payout rule is added here |
| E | Admin 급여 구분 / 행위 코드 UI vs scope text | 파일 구조·문구 확인 완료 for the copy: role chip "권한: 메뉴·금액 편집 · 분류 변경 요청" (`N6ORf3`), "보장 매핑 승인 권한 없음" (`HQ2j1`), admin description (`hc7K8`) say register or request a change, with approval and rejection by the reviewer. 추가 수정 필요 / 추가 수정본 대기 (minor): the copy speaks of a "변경 요청" but A03 has a "검토 요청" button and no separate change-request control; unify the terms or add a control. `A02_Admin_TreatmentList` has three "검토 완료" text nodes (`GHGjX`, `c10Gp`, `GYSQ1`), each the label inside a node named "Status 검토 완료" in a table row; A03 has none. Whether the A02 badges behave as controls is 실제 렌더링 미확인 |
| F | Large-text button heights | Observation, no verdict: `K04_Result_LargeText` secondary buttons are 104, 104, 88, 88, 88 and the primary is 112; `K04_Result` has five secondary at 88 and a primary at 100; `L_K04_Result` has 96, 96, 96, 88, 88 and a primary at 96. Confirm intent; 실제 렌더링 미확인 |
| G | Preview images | `design/previews/` holds 8 PNG (`ECPf6`, `H5Xw9I`, `TJoQ2`, `VwsQ9`, `woEM7`, `zREqB`, `ZxXPh`, `h4KfhK`), untracked, not created by MoAI, file time 09:25 on 2026-10-13, before the 09:33 and 09:51 saves, so it cannot be assumed that they show the name or colors as saved (an earlier version of this document counted 13 images). They cannot be tied to a specific saved revision, are not evidence for the latest save, and were not viewed in this review. They stay out of the commit |
| H | Items never read in a rendered view | `K05_Consult`, `K03_Treatments_Dialog_Reset`, full large-text clipping, `ZZ_HandoffSpec` long-text clipping, `A02` status labels, and the spacing changes in `K04_Result_NotCovered` and `K04_Result_LargeText` (5.3): 실제 렌더링 미확인 |
| I | Text contrast and gradients of the new palette | Observation, no verdict. Arithmetic only: WCAG contrast ratio of variable pairs, old to new. `text-body` on `bg` 7.98:1 to 7.24:1 and on `surface` 8.32:1 to 7.58:1; `text-muted` on `bg` 3.95:1 to 2.45:1 and on `surface` 4.12:1 to 2.56:1; `surface` (white) on `accent` 4.03:1 to 5.17:1; `disabled-text` on `disabled` 2.12:1 to 2.08:1. 97 text nodes in 34 frames use `text-muted` (sizes from 11 to 24, plus size tokens). No document states a minimum contrast, so no pass or fail is given; whether this gray is acceptable for older kiosk users is an owner decision (§7), and which pairs actually appear together on screen is 실제 렌더링 미확인, as are the gradient fills (`m1YQdB`, `DBtJN`) |

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
- Behavior of a classification change before reviewer approval (5.4 item D): hold the expected payout or keep the last approved class.
- Minimum text contrast for the kiosk palette: no criterion is stated today (5.4 item I).
- Whether the placeholder sentences "디자인 예시입니다" / "구현 단계에서 … 연결합니다" in the result and calculation-basis frames are demo markers removed at implementation or text that stays (5.4 item C).
- Medical-advertising rules in force at deployment time.
- Exact shape of the per-group plus overall calculation result.
- Stack: database, hosting, admin authentication provider, test runner.

Input materials needed:
- Actual policy texts with clause, page, revision, and effective dates; the original comparison image; the hospital's price list and procedure codes; Pencil's further saved revisions of `design.pen` and, if available, rendered views of the same saved revision.
