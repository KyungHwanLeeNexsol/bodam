import { Badge } from '../components/Badge';
import { AssumptionPanel, ConditionRows, SourcePanel, StepsTable, TreatmentTable } from '../components/BasisTables';
import { NoticeBar } from '../components/NoticeBar';
import { ExclusionPanel } from '../components/ResultPanel';
import { SheetScreen } from '../components/SheetScreen';
import { useKiosk } from '../runtime/kiosk-context';
import { buildBasisView } from '../view/basis-view';
import { COPY } from '../view/copy';
import { SheetFooter, SheetUnavailable } from './SheetFooter';

// 계산 근거 K04_Basis_Calculation (SPEC-REIMBURSEMENT-001 M6 S3b, 디자인 `GhMYi`, DD-22·DD-11, AC-014e·f·h·i, AC-013f, AC-010e).
//  - 정상·보장 제외 결과에서만 들어온다(상태 기계). 보여 주는 것: 입력으로 확인한 것(보험 조건·치료 원인·치료 표), 가정으로 적용한 것("(가정)" 공제·한도, 약관 출처), 계산 과정, 보장 제외 결과에서 들어왔으면 제외 항목과 사유,
//    확인하지 않은 전제. 값은 모두 응답의 값이고 응답에 없는 것은 그리지 않는다. 디자인의 "디자인 예시입니다" 문장·예시 값·"규칙 ID 표시 자리" 문장은 싣지 않는다(plan.md §E #27).
//  - 가로형은 같은 DOM 이고 CSS 가 두 열로 나눈다(디자인 프레임 없음, 파생). 큰 글자 보기는 글자·여백만 키우고 넘치면 본문이 스크롤된다. "결과로 돌아가기"는 들어온 결과 종류로 돌아가고
//    방향·큰 글자는 복귀 시점의 최신 값이다(DD-11, 상태 기계가 정한다).
//  - 어떤 문구도 "환자분의 실손은 …" 같은 확인 사실 표현이 아니다. 근거 줄에서 보험 계산을 하지 않는다: 합계·지급액은 응답의 값이다.

export function K04BasisCalculation() {
  const { state } = useKiosk();
  const view = buildBasisView(state);
  const landscape = state.display.orientation === 'LANDSCAPE';
  if (view === null) return <SheetUnavailable title={COPY.basis.unavailable.title} body={COPY.basis.unavailable.body} />;
  return (
    <SheetScreen
      kind="basis"
      barLabel={COPY.basis.barLabel}
      badge={<Badge tone="warn">{COPY.result.badgeExample}</Badge>}
      title={COPY.basis.title}
      subtitle={landscape ? undefined : COPY.basis.subtitle}
      condition={landscape ? view.compactCondition : undefined}
      testData={view.testData}
      footer={<SheetFooter />}
    >
      {landscape ? null : <ConditionRows view={view} />}
      <div className="kiosk-basis__grid">
        <TreatmentTable view={view} />
        {view.groups.length === 0 ? null : <StepsTable view={view} />}
        {view.exclusions.length === 0 ? null : <ExclusionPanel exclusions={view.exclusions} notes={[]} />}
        <AssumptionPanel view={view} />
        {view.sources.length === 0 ? null : <SourcePanel sources={view.sources} />}
        <NoticeBar paragraphs={[`${COPY.result.commonLead} ${COPY.result.personalContract}`]} />
      </div>
    </SheetScreen>
  );
}
