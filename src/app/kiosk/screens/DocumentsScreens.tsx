import { useState } from 'react';
import { Badge } from '../components/Badge';
import { SingleDocumentList, UnknownDocumentList } from '../components/DocumentList';
import { Icon } from '../components/icons';
import { Pager } from '../components/Pager';
import { SheetScreen } from '../components/SheetScreen';
import { useKiosk } from '../runtime/kiosk-context';
import { COPY } from '../view/copy';
import { buildDocumentsView, groupOfPage, pageOfDocuments, pageSizeFor } from '../view/documents-view';
import type { DocumentsView } from '../view/documents-view';
import { SheetFooter, SheetUnavailable } from './SheetFooter';

// 필요 서류 K07_Documents · K07_Documents_Unknown (SPEC-REIMBURSEMENT-001 M6 S3b, 디자인 `F19r1B`·`J6jAj`·`CL4xk`·`mZDkv`, DD-06·DD-12, AC-007g·h·i, AC-014c·e·g·h·i, AC-010e).
//  - 계산이 끝난 결과(정상·보장 제외)에서만 들어온다. 어느 화면(원인 있음/모름)인지는 상태 기계가 원인으로 정하고 이 화면은 같은 구성요소로 둘을 그린다(보기 모양이 원인으로 모드를 정한다).
//  - 서류 줄은 응답의 값이다. 규칙을 쓸 수 없거나(RULES_UNAVAILABLE) 목록의 모양이 맞지 않으면 목록 대신 안내 문구이고, 빈 목록도 지어낸 서류도 그리지 않는다. 동작은 그대로다(AC-007g, plan.md §E #18).
//  - 쪽 나눔: 큰 글자 보기에서 줄을 나눠 "이전 목록 / 다음 목록" 으로 잇는다(DD-06·DD-12). 쪽의 위치는 이 화면 안의 표시 상태다(환자 입력이 아니고 저장·전송하지 않으며 화면을 떠나면 사라진다).
//    위치는 "보던 첫 줄의 순번"이라 큰 글자를 켜고 꺼도 보던 줄이 보이는 쪽에 머문다. 줄은 빠지거나 반복되지 않고 체크·사유가 그대로다.
//  - 문의 번호·전화·링크·접수 직원 호출 단추는 없다. "접수 직원에게 문의해 주세요"는 안내 문구일 뿐이다.

export interface DocumentsBodyProps {
  readonly view: DocumentsView;
  readonly landscape: boolean;
  readonly pageSize: number;
  /** 보던 첫 줄의 순번(0 부터). */
  readonly offset: number;
  readonly onOffset: (offset: number) => void;
}

/** 훅이 없는 본문: 쪽 위치를 받아 그린다(시험이 DOM 없이 단추를 부른다). */
export function DocumentsBody({ view, landscape, pageSize, offset, onOffset }: DocumentsBodyProps) {
  const page = pageOfDocuments(view.entries, offset, pageSize);
  const groups = groupOfPage(page.items);
  const first = groups[0];
  const pager =
    page.pageCount > 1 ? (
      <div className="kiosk-sheet__pager">
        <Pager
          label={COPY.documents.pagerLabel}
          pageIndex={page.pageIndex}
          pageCount={page.pageCount}
          hasPrev={page.hasPrev}
          hasNext={page.hasNext}
          onPrev={() => {
            onOffset((page.pageIndex - 1) * pageSize);
          }}
          onNext={() => {
            onOffset((page.pageIndex + 1) * pageSize);
          }}
        />
      </div>
    ) : undefined;
  return (
    <SheetScreen
      kind={view.unknownCause ? 'documents-unknown' : 'documents'}
      barLabel={COPY.documents.barLabel}
      badge={<Badge tone="warn">{COPY.documents.badge}</Badge>}
      title={COPY.documents.title}
      subtitle={view.available && !landscape ? (view.unknownCause ? COPY.documents.subtitleUnknown : COPY.documents.subtitleSingle) : undefined}
      condition={landscape ? view.compactLine : undefined}
      testData={view.testData}
      pager={pager}
      footer={<SheetFooter />}
    >
      {landscape ? null : (
        <dl className="kiosk-conditions" data-kiosk-block>
          <div className="kiosk-conditions__row">
            <dt>{COPY.documents.claimKey}</dt>
            <dd>{view.claimBasis}</dd>
          </div>
          <div className="kiosk-conditions__row">
            <dt>{COPY.documents.treatmentsKey}</dt>
            <dd>{view.treatmentSummary}</dd>
          </div>
        </dl>
      )}
      {!view.available ? (
        <section className="kiosk-docs-unavailable" role="note" data-kiosk-block data-docs-unavailable>
          <Icon name="info" size={40} />
          <div className="kiosk-docs-unavailable__text">
            <h2 className="kiosk-docs-unavailable__title">{COPY.documents.unavailable.title}</h2>
            <p className="kiosk-docs-unavailable__body">{COPY.documents.unavailable.body}</p>
          </div>
        </section>
      ) : (
        <>
          {view.unknownCause ? <UnknownDocumentList groups={groups} headExtra={landscape ? COPY.documents.subtitleUnknown : undefined} /> : first === undefined ? null : <SingleDocumentList group={first} />}
          <p className="kiosk-docs__hint">{view.hint}</p>
        </>
      )}
    </SheetScreen>
  );
}

function DocumentsScreen() {
  const { state } = useKiosk();
  const [offset, setOffset] = useState(0);
  const view = buildDocumentsView(state);
  if (view === null) return <SheetUnavailable title={COPY.result.unavailable.title} body={COPY.result.unavailable.body} />;
  // 쪽을 넘기면 본문을 맨 위로 돌린다: 앞 쪽을 아래까지 읽던 스크롤 위치가 새 쪽의 첫 줄을 가리지 않게 한다.
  const turn = (next: number): void => {
    setOffset(next);
    document.querySelector('.kiosk-sheet__body')?.scrollTo({ top: 0 });
  };
  return <DocumentsBody view={view} landscape={state.display.orientation === 'LANDSCAPE'} pageSize={pageSizeFor(state.display, view.unknownCause)} offset={offset} onOffset={turn} />;
}

export function K07Documents() {
  return <DocumentsScreen />;
}

export function K07DocumentsUnknown() {
  return <DocumentsScreen />;
}
