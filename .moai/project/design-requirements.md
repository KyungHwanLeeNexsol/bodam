# Design Requirements and Review Criteria: 메디헬퍼 (medi-helper)

> Status: planning only. Derived from `메디헬퍼_기획설계_v0.2.md` ("§N" refers to it) and from a read-only inspection of `design/design.pen` at commit `5d4c4fc`. Nothing here claims that any screen was rendered, that the app exists, or that any device was tested. `design/design.pen` is edited only by Pencil; MoAI reviews it and never writes it.

## 1. Purpose and ownership

- Pencil edits `design/design.pen`. MoAI maintains the requirements below and reviews the saved revision against them.
- This file is the checklist the review uses. A design item is only marked "confirmed" after the saved file, the Git diff, and (where possible) a rendered view were actually checked.
- Status values used below: **confirmed** (checked in the saved file), **awaiting revision** (a Pencil change is requested and no revised file has been saved), **unverified** (cannot be checked with the tools available).

## 2. Kiosk operation specification (design reference values)

These numbers are design references. They are not an accessibility certification and do not mean any real device was verified (§13.1).

| Item | Value |
|------|-------|
| Primary button default height | 88 (design variable `h-btn` = 88 observed) |
| Minimum primary touch area when implemented | 72 CSS px or more |
| Selection card height target | 120 or more |
| Body text | 24 or more |
| Title | 36 or more |
| Key result number | 56 or more |
| Spacing between major elements | 16 or more |
| Provisional portrait / landscape review size | 1080x1920 / 1920x1080 (not real device specs; real size and resolution are undecided) |
| PC admin screens | Separate specification (reference frames are 1440x1024); the kiosk values above do not apply |

- Large-text mode is a required MVP feature, not a candidate. Buttons, amounts, and key guidance must not clip in it, and selections persist.
- Touch-only completion and assistive keyboard operation are both required and do not conflict: a patient completes the whole flow without a physical keyboard; with a keyboard present, navigation, selection, and confirmation work, focus is visible, and modals trap and then restore focus.

## 3. Behavior requirements the design must express

| # | Requirement | Related frames |
|---|-------------|----------------|
| 1 | Insurance conditions are separate questions: deduction type and outpatient coverage limit, each with its own "모르겠어요", shown only when needed. The limit question must not contain a deduction-type answer such as "선택형Ⅱ 가입이에요". Only limits and deduction types registered in a confirmed policy are offered; otherwise "확인 필요". No staff-entry feature is implied unless its flow and permission are defined | `K02Q_Conditions_Unknown` (H5Xw9I), `K02Q_Conditions` (VwsQ9) |
| 2 | Injury/illness help text is cause-based: injury = "넘어짐·부딪힘 등 사고나 외부 충격으로 생긴 치료"; illness = "사고나 외부 충격 없이 발생한 질환으로 받는 치료"; unknown = "원인이 불분명하면 직원에게 확인해 주세요". No symptom-only wording such as pain or inflammation | `K02Q_Conditions` (VwsQ9) |
| 3 | Hospital administrator can manage menu and prices, view review status, request review, and read the result and rejection reason. Only the insurance-rule reviewer can approve or reject. No "검토 완료" control that lets a hospital administrator approve a coverage mapping. Changes to treatment code or benefit/non-benefit class require re-review; a price-only change does not | `A03_Admin_TreatmentEdit` (ECPf6) |
| 4 | All results distinguish 예상 병원 결제액, 예상 보험금, 보험금 수령 후 예상 본인 부담, and the last one is not readable as today's hospital payment | `K04_Result` (TJoQ2), `K04_Result_NotCovered` (XxmHQ), `K04_Result_LargeText` (woEM7), `L_K04_Result` (n3WXk) |
| 5 | State handling: unconfirmed condition = hold, "확인 필요", null; network error = failure and retry, null; confirmed exclusion = item 0 won with reason; normal 0 won = 0 with basis. Confirmed-unknown is never shown as excluded | `K04_Result_Unconfirmed` (Ni5aI), `K04_Result_NotCovered` (XxmHQ), `KXX_Error_Network` (bWvFJ) |
| 6 | A result that excludes some treatments must not carry the assumption text "선택한 치료가 모두 보장 대상". The assumption instance and the hand-off note must be consistent with the displayed numbers | `K04_Result_NotCovered` (XxmHQ): assumption instance `reynT` / text `MzQqc`; `ZZ_HandoffSpec` (cvUDQ) / text `bI1cW` |
| 7 | Idle reset: input screens warn at 100 s and reset at 120 s; result screens warn at 160 s and reset at 180 s. The warning shows remaining time, "계속 사용할게요", and "처음으로"; extension is repeatable and restarts the idle time | `ZZ_HandoffSpec` (cvUDQ) text `MVOb1`, `K04_Result_Dialog_Timeout` (YcF5k), `K03_Treatments_Dialog_Reset` (r4N0OQ) |
| 8 | A consultation entry exists on the normal result screen as well; returning from consultation keeps the selections and result; "이용 완료" (user ends) and automatic reset are distinct. 1544-8069 shown as the user-provided number; operating entity and hours unconfirmed; "1588" not completed; no real call or staff-call feature | `K04_Result` (TJoQ2), `K05_Consult` (SmZwC) |
| 9 | Button components carry the 88 height reference | `Button_Primary` (s8D6J), `Button_Secondary` (m1gMGk) |

## 4. Review checklist for the saved Pencil revision

Run after Pencil reports a saved revision, against the actual file in the working tree:

1. `git status` and `git diff --stat` for `design/design.pen`: confirm a revision exists and is not a whole-file rewrite caused by line-ending conversion.
2. Parse the file as JSON; list top-level frames and confirm the referenced IDs in section 3 still exist.
3. Check component and variable references resolve (for example `h-btn` is used by the button components).
4. Search the file text for the old wording (see section 5) and for the new required wording (section 3).
5. Check consistency across portrait (K*), landscape (L_K*), large-text, and exception frames: same amounts, same terms, same assumption text.
6. Check the numbers on result frames against the examples in `메디헬퍼_기획설계_v0.2.md` §6.4 (A to E).
7. If Pencil can render screens or screenshots are provided: check text clipping, overlap, button size, and content outside the frame. If neither is available, record "unverified".
8. A structural check (steps 1 to 6) never counts as proof of rendering or app behavior.

## 5. Observed state at commit 5d4c4fc (read-only grep and parse; no revision saved)

| Frame / item | Observation in the current file | Status |
|--------------|--------------------------------|--------|
| `K02Q_Conditions_Unknown` (H5Xw9I) | Text "외래 보장한도를 알고 계신가요?" and an option "선택형Ⅱ 가입이에요" are both present in the file; their exact placement in this frame was not traced | awaiting revision |
| `K02Q_Conditions` (VwsQ9) | Old wording present: "다치거나 사고로 생긴 치료는 상해, 몸의 이상이나 통증으로 받는 치료는 질병입니다." and "통증·염증 등 몸의 이상으로 받는 치료예요" | awaiting revision |
| `A03_Admin_TreatmentEdit` (ECPf6) | The text "검토 완료" appears 4 times in the file; which frames hold them was not traced | awaiting revision |
| `K04_Result_NotCovered` (XxmHQ), `reynT`/`MzQqc` | The "모두 보장 대상" assumption wording appears in 5 text nodes; the NotCovered placement was not traced | awaiting revision |
| `ZZ_HandoffSpec` (cvUDQ), `bI1cW`, `MVOb1` | Timer text found: "입력 화면 120초 무조작", "결과 화면 180초 무조작", "20초 경고"; 100 s / 160 s warning points not found as text | awaiting revision |
| `Button_Primary` / `Button_Secondary` | Both components exist; variable `h-btn` = 88 exists; whether the components use it was not checked | unverified |
| `K04_Result` (TJoQ2), `K05_Consult` | Frames exist; consultation entry on the normal result screen not checked | unverified |
| Rendering of any frame | Pencil MCP server failed to connect in this session; no screen was rendered or inspected | unverified |

All 12 referenced IDs (H5Xw9I, VwsQ9, ECPf6, XxmHQ, reynT, MzQqc, cvUDQ, bI1cW, MVOb1, s8D6J, m1gMGk, TJoQ2) were found in the file by text search. The working tree is identical to `5d4c4fc` for `design/design.pen`, so no Pencil revision has been saved yet.

## 6. Git handling for `.pen` files

`.gitattributes` carries `*.pen -text` so Git does not convert line endings in `.pen` files and file bytes are preserved. This is a precaution; it is not claimed that CRLF conversion necessarily breaks Pencil. The file name `design/design.pen` stays unchanged.

Measured when the attribute was added (this Windows clone has `core.autocrlf=true`):

| Measurement | Result |
|-------------|--------|
| Committed blob (`HEAD:design/design.pen`) | 760,955 bytes, 0 CR, hash `f9faaf19…` |
| Working file | 782,179 bytes, 21,224 CR (CRLF from checkout conversion) |
| Working file with CR removed | hash `f9faaf19…` (identical to the blob; content is the same, only line endings differ) |
| `git ls-files --eol` after the attribute | `i/lf w/crlf attr/-text` |
| Working file hashed raw (what `-text` makes Git compare) | `a27b3b7e…`, different from the blob |

Consequence: with `-text`, the CRLF working file no longer matches the LF blob. `git status` did not report it yet because Git's stat cache was still valid, but any event that refreshes the file state (touching it, a checkout, a Pencil save) can make it appear as a whole-file change of about 21,000 lines. MoAI did not modify `design/design.pen` to avoid this. Handling: when Pencil saves its revision, check the line endings of the saved file first (review checklist step 1); if the revision is LF it diffs cleanly against the blob, and if it is CRLF the diff will be a whole-file rewrite that is not a content change. The remaining options (restore the working file to LF, or commit the revision with CRLF bytes) are the owner's decision and are listed in the report.

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
- Medical-advertising rules in force at deployment time.
- Exact shape of the per-group plus overall calculation result.
- Stack: database, hosting, admin authentication provider, test runner.

Input materials needed:
- Actual policy texts with clause, page, revision, and effective dates; the original comparison image; the hospital's price list and procedure codes; the revised `design.pen` after Pencil saves it.
