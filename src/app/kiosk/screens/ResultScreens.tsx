import { AmountCard } from '../components/AmountCard';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { NoticeBar } from '../components/NoticeBar';
import { ExclusionPanel, HoldPanel } from '../components/ResultPanel';
import { ResultActions } from '../components/ResultActions';
import { ResultBar } from '../components/ResultBar';
import { ScrollRegion } from '../components/ScrollRegion';
import { StatusBody } from '../components/StatusBody';
import { TestDataNotice } from '../components/TestDataNotice';
import { useKiosk } from '../runtime/kiosk-context';
import { COPY } from '../view/copy';
import { buildResultView } from '../view/result-view';
import type { ResultKind, ResultView } from '../view/result-view';

// 결과 화면 셋 (SPEC-REIMBURSEMENT-001 M6 S3a, 디자인 K04_Result `TJoQ2`·K04_Result_NotCovered `XxmHQ`·L_K04_Result `n3WXk`, DD-07·DD-12·DD-21·DD-22, AC-013a~f).
//  - 정상(ESTIMATED)·보장 제외(ESTIMATED_WITH_EXCLUSIONS): 세 금액 카드, 결과 문구 원칙 + 공통 안내, 여섯 동작. 보장 제외는 제외 항목·사유 패널이 더해진다.
//    디자인의 "보장 제외 가정" 표 한 줄은 패널이 같은 내용(이름·금액·사유)을 더 자세히 보여 주므로 따로 두지 않는다: 한 화면에 들어가는 높이를 아낀다.
//  - 보류(ON_HOLD): 디자인 프레임이 없어 같은 부품으로 구성했다(파생). 병원 결제액만 숫자이고 나머지 둘은 "확인 필요"다. 보류 줄은 환자용 분류로 묶이고
//    결과 문구 원칙 대신 개인 계약 조건 문장 하나만 쓴다. 동작은 넷이다(서류 확인·계산 근거 없음).
//  - 금액은 모두 응답의 값이다(buildResultView). 화면에 보험 계산이 없고, 값이 없는 금액이 0원이 되는 길이 없다.
//  - 가로형은 같은 DOM 이고 세로형의 "보험 조건" 표 대신 한 줄 요약을 쓴다(디자인 L_K04_Result). 큰 글자 보기는 글자·버튼 크기만 키우고 동작·금액·문구는 그대로이며, 넘치면 본문이 스크롤된다.
//  - 겹침창(ResetConfirm·TimeoutDialog)이 열려 있어도 이 화면은 계속 그려진다: 요청 결말이 겹침창 위에 도착하면 밑 화면이 바뀐다(DD-07 표 1).

function ConditionRows({ view }: { readonly view: ResultView }) {
  return (
    <dl className="kiosk-conditions" data-kiosk-block>
      {view.insuranceLabel === null ? null : (
        <div className="kiosk-conditions__row">
          <dt>{COPY.result.conditionInsurance}</dt>
          <dd>{view.insuranceLabel}</dd>
        </div>
      )}
      <div className="kiosk-conditions__row">
        <dt>{COPY.result.conditionTreatments}</dt>
        <dd>{view.treatmentSummary}</dd>
      </div>
    </dl>
  );
}

function ResultBadges({ kind }: { readonly kind: ResultKind }) {
  if (kind === 'HOLD') return <Badge tone="warn">{COPY.result.badgeHold}</Badge>;
  return (
    <>
      <Badge tone="warn">{COPY.result.badgeExample}</Badge>
      {kind === 'NOT_COVERED' ? <Badge>{COPY.result.badgePartlyExcluded}</Badge> : null}
    </>
  );
}

function ResultScreen({ kind }: { readonly kind: ResultKind }) {
  const { state, send } = useKiosk();
  const view = buildResultView(state, kind);
  const landscape = state.display.orientation === 'LANDSCAPE';
  if (view === null) return <ResultUnavailable />;

  // 정상·보장 제외는 결과 문구 원칙 + 공통 안내, 보류는 개인 계약 조건 문장 하나(DD-07). 세 금액의 이름·보조 설명은 모든 결과 화면에서 같다(기획서 §4).
  const notice = kind === 'HOLD' ? [COPY.result.personalContract] : [COPY.result.principle, `${COPY.result.commonLead} ${COPY.result.personalContract}`];

  return (
    <div className="kiosk-result" data-result={kind === 'NORMAL' ? 'normal' : kind === 'NOT_COVERED' ? 'not-covered' : 'hold'}>
      {view.testData ? <TestDataNotice /> : null}
      <ResultBar label={COPY.result.barLabel} badge={<ResultBadges kind={kind} />} />
      <ScrollRegion className="kiosk-result__body">
        <div className="kiosk-result__head">
          <h1 className="kiosk-result__title" tabIndex={-1} data-kiosk-primary>
            {COPY.result.title}
          </h1>
          {landscape ? <p className="kiosk-result__condition-line">{view.compactCondition}</p> : null}
        </div>
        {landscape ? null : <ConditionRows view={view} />}
        <div className="kiosk-amounts">
          <AmountCard tone="hospital" amount={view.hospital} extra={landscape ? null : view.hospital.split} />
          <div className="kiosk-amounts__row">
            <AmountCard tone="payout" amount={view.payout} />
            <AmountCard tone="after" amount={view.afterPayout} />
          </div>
        </div>
        <div className="kiosk-result__panels">
          {kind === 'NOT_COVERED' ? <ExclusionPanel exclusions={view.exclusions} notes={view.exclusionNotes} /> : null}
          {kind === 'HOLD' ? <HoldPanel groups={view.holdGroups} /> : null}
          <NoticeBar paragraphs={notice} result />
        </div>
      </ScrollRegion>
      <ResultActions
        actions={view.actions}
        onAction={(event) => {
          send(event);
        }}
      />
    </div>
  );
}

/** 저장된 응답이 없거나 결과 종류가 화면과 맞지 않을 때(일어나지 않는 상태의 방어): 0원이나 빈 결과를 그리지 않고 "처음으로"만 둔다. */
function ResultUnavailable() {
  const { send } = useKiosk();
  return (
    <div className="kiosk-result kiosk-result--unavailable" data-result="unavailable">
      <StatusBody icon="circle-alert" tone="warn" title={COPY.result.unavailable.title} body={COPY.result.unavailable.body} />
      <div className="kiosk-status__actions">
        <Button
          variant="secondary"
          block
          icon="rotate-ccw"
          onClick={() => {
            send({ type: 'REQUEST_HOME' });
          }}
        >
          {COPY.buttons.home}
        </Button>
      </div>
    </div>
  );
}

export function K04Result() {
  return <ResultScreen kind="NORMAL" />;
}

export function K04ResultNotCovered() {
  return <ResultScreen kind="NOT_COVERED" />;
}

export function K04ResultHold() {
  return <ResultScreen kind="HOLD" />;
}
