import { useId, useRef } from 'react';
import { TreatmentCard } from '../components/ChoiceCards';
import { InputScreen } from '../components/InputScreen';
import { Pager } from '../components/Pager';
import { RefreshNotice } from '../components/RefreshNotice';
import type { RefreshNoticeState } from '../components/RefreshNotice';
import { ScrollRegion } from '../components/ScrollRegion';
import { SelectionSummaryBar, SelectionSummaryPanel, SelectionTotalLine } from '../components/SelectionSummary';
import { useKiosk } from '../runtime/kiosk-context';
import { canRequestEstimate, selectRefresh, selectTotals, selectTreatmentPage } from '../state/selectors';
import { COPY } from '../view/copy';
import { StepFooter } from './StepFooter';

// 4/4 치료 선택 K03_Treatments (디자인 K03_Treatments_Empty/_Selected/_Page2, L_K03_Treatments, 큰 글자 보기는 한 쪽 2개: DD-12).
//  - 치료 카드는 여러 장을 고를 수 있고(체크박스) 다시 누르면 해제만 된다(수량 없음, AC-012e). 쪽 넘김은 선택을 건드리지 않고 계산 요청이 없다(AC-014d).
//  - 합계는 전부 선택자 selectTotals 의 값이다. 이 파일에는 금액 덧셈이 없다(AC-019c).
//  - 자료 갱신(409·422 뒤, DD-09)은 이 화면 안에서 보인다: 진행 중에는 치료 카드·"이전"·확인 버튼이 잠기고, 실패하면 인라인 "다시 시도"가 갱신을 먼저 실행하며, 성공해도
//    결과로 가지 않고 환자가 "예상 부담액 확인"을 다시 눌러야 한다(AC-020b~i). "처음으로"·쪽 넘김·큰 글자 보기는 갱신 중에도 동작한다(BRIEF D5).
//  - 화면의 잠금은 UI 층이다. 상태 기계가 잠금을 거치지 않은 입력 변경을 받아 갱신을 취소하는 방어(AC-020g 3)는 따로 있고 여기서 건드리지 않는다.

export function K03Treatments() {
  const { state, send, read } = useKiosk();
  const refresh = selectRefresh(state);
  const page = selectTreatmentPage(state);
  const totals = selectTotals(state);
  const canConfirm = canRequestEstimate(state);
  const landscape = state.display.orientation === 'LANDSCAPE';
  const noticeRef = useRef<HTMLDivElement>(null);
  const reasonId = useId();

  const notice: RefreshNoticeState | null = refresh.running
    ? { kind: 'running' }
    : refresh.failed
      ? {
          kind: 'failed',
          onRetry: () => {
            // 보내는 순간의 상태로 다시 확인한다(실패 상태일 때만 의미가 있다). 재시도는 계산이 아니라 갱신이다.
            if (read((current) => selectRefresh(current).canRetry)) send({ type: 'RETRY_REFRESH' });
            noticeRef.current?.focus();
          },
        }
      : refresh.notice !== null && refresh.notice.removed.length > 0
        ? { kind: 'removed', names: refresh.notice.removed.map((entry) => entry.displayName) }
        : null;

  // 확인 버튼이 비활성인 이유: 치료를 고르지 않았을 때는 디자인의 안내 문장이고, 갱신 때문이면 위의 갱신 안내가 이유를 말한다.
  const emptyReason = !canConfirm && totals.selectedCount === 0 && !refresh.running && !refresh.failed;

  return (
    <InputScreen
      step={4}
      kind="treatments"
      title={COPY.input.treatments.title}
      subtitle={COPY.input.treatments.subtitle}
      notice={notice === null ? null : <RefreshNotice ref={noticeRef} notice={notice} />}
      // 부속 영역의 순서: 선택 패널(가로) → 확인 버튼이 꺼진 이유 → 선택 유지 안내. 이유 문장이 가로 큰 글자에서 왼쪽 열이 스크롤되어도 가려지지 않게 위에 둔다.
      aside={
        <>
          {landscape ? <SelectionSummaryPanel totals={totals} /> : null}
          {emptyReason ? (
            <p id={reasonId} className="kiosk-input__reason">
              {COPY.input.treatments.emptyHint}
            </p>
          ) : null}
          <p className="kiosk-input__hint">{COPY.input.treatments.keepHint}</p>
        </>
      }
      footer={
        <>
          {landscape ? null : <SelectionSummaryBar totals={totals} />}
          <StepFooter
            primaryLabel={COPY.input.treatments.confirm}
            primaryDisabled={!canConfirm}
            describedBy={emptyReason ? reasonId : undefined}
            previousLocked={refresh.locked}
            lead={landscape ? <SelectionTotalLine totals={totals} /> : undefined}
            onPrimary={() => {
              send({ type: 'REQUEST_ESTIMATE' });
            }}
          />
        </>
      }
    >
      {page.items.length === 0 ? (
        <p className="kiosk-input__empty">{COPY.input.treatments.noneAvailable}</p>
      ) : (
        <ScrollRegion role="group" aria-label={COPY.input.treatments.title} className="kiosk-input__list">
          {page.items.map(({ treatment, selected }) => (
            <TreatmentCard
              key={treatment.treatmentId}
              treatment={treatment}
              selected={selected}
              locked={refresh.locked}
              onToggle={() => {
                // 카드를 누른 순간의 상태로 잠금을 한 번 더 확인한다(AC-020i). 잠긴 동안은 사건을 보내지 않는다.
                if (read((current) => selectRefresh(current).locked)) return;
                send({ type: 'TOGGLE_TREATMENT', treatmentId: treatment.treatmentId });
              }}
            />
          ))}
        </ScrollRegion>
      )}
      <Pager
        pageIndex={page.pageIndex}
        pageCount={page.pageCount}
        hasPrev={page.hasPrev}
        hasNext={page.hasNext}
        onPrev={() => {
          send({ type: 'TREATMENTS_PREV_PAGE' });
        }}
        onNext={() => {
          send({ type: 'TREATMENTS_NEXT_PAGE' });
        }}
      />
    </InputScreen>
  );
}
