import type { CSSProperties } from 'react';
import { COPY } from '../view/copy';
import type { DocGroupView, DocLineView } from '../view/documents-view';
import { Icon } from './icons';

// 필요 서류 목록 (SPEC-REIMBURSEMENT-001 M6 S3b, 디자인 K07_Documents `F19r1B`·K07_Documents_Unknown `J6jAj`·L_K07_* `CL4xk`·`mZDkv`, DD-06, AC-007g·h·i).
//  - 한 줄 = 서류 이름 + (필요하면) 사유. 필요한 줄은 체크 표시 + 파란 테두리 + 굵은 이름이고, 필요 없는 줄은 빈 원 + 흐린 이름이다. 색에만 기대지 않고 체크 모양·굵기·화면 낭독기용 글("필요"/"이번 청구에는 필요하지 않음")로 구분한다.
//  - 서류 줄은 누르는 요소가 아니다(안내 목록). 사유는 응답의 문장이고 줄마다 여러 줄일 수 있다(원인 모름의 공통 줄은 두 평가의 사유가 다르면 모두 보인다).
//  - 원인 모름: 공통 묶음 + "치료 원인에 따라 추가되는 서류" 아래 상해·질병 묶음 둘(세로: 나란히, 가로: 위아래). 묶음에 줄이 없으면 그 묶음의 머리글도 없다.
//  - 가로형은 CSS 가 같은 목록을 열로 나눈다(--kiosk-doc-rows: 한 열의 줄 수). DOM 순서는 읽는 순서다.

function DocumentItem({ line }: { readonly line: DocLineView }) {
  return (
    <li className="kiosk-doc" data-kiosk-block data-doc-line={line.key} data-required={line.required ? 'true' : 'false'}>
      <span className="kiosk-doc__mark">
        <Icon name={line.required ? 'circle-check' : 'circle'} size={36} />
      </span>
      <div className="kiosk-doc__text">
        <p className="kiosk-doc__name">
          {line.name}
          <span className="kiosk-sr-only">{line.required ? COPY.sheet.required : COPY.sheet.notRequired}</span>
        </p>
        {line.reasons.map((reason, index) => (
          <p key={`${String(index)}|${reason}`} className="kiosk-doc__reason">
            {reason}
          </p>
        ))}
      </div>
    </li>
  );
}

function DocumentRows({ lines, columns }: { readonly lines: readonly DocLineView[]; readonly columns: number }) {
  const style = { '--kiosk-doc-rows': Math.max(1, Math.ceil(lines.length / columns)), '--kiosk-doc-cols': columns } as CSSProperties;
  return (
    <ul className="kiosk-doc-list" style={style}>
      {lines.map((line) => (
        <DocumentItem key={line.key} line={line} />
      ))}
    </ul>
  );
}

/** 단일 원인(K07_Documents): 한 목록. 가로형은 세 열이다. */
export function SingleDocumentList({ group }: { readonly group: DocGroupView }) {
  return (
    <section className="kiosk-docs" aria-label={COPY.documents.listHead}>
      <p className="kiosk-docs__head">{COPY.documents.listHead}</p>
      <DocumentRows lines={group.lines} columns={3} />
    </section>
  );
}

/** 원인 모름(K07_Documents_Unknown): 공통 묶음과 분기 묶음. 가로형은 공통이 왼쪽 두 열, 분기가 오른쪽 한 열이다. `headExtra` 는 가로형에서 목록 머리 줄에 이어 붙는 안내 문장이다(디자인 L_K07_Documents_Unknown 은 부제를 따로 두지 않고 한 줄로 잇는다). */
export function UnknownDocumentList({ groups, headExtra }: { readonly groups: readonly DocGroupView[]; readonly headExtra?: string | undefined }) {
  const common = groups.find((group) => group.scope === 'COMMON');
  const branches = groups.filter((group) => group.scope !== 'COMMON');
  return (
    <section className="kiosk-docs kiosk-docs--unknown" aria-label={COPY.documents.listHead}>
      <p className="kiosk-docs__head">{headExtra === undefined ? COPY.documents.listHead : `${COPY.documents.listHead} ${headExtra}`}</p>
      <div className="kiosk-doc-groups">
        {common === undefined ? null : (
          <div className="kiosk-doc-group kiosk-doc-group--common" data-doc-group="COMMON">
            <h2 className="kiosk-doc-group__head">{common.title}</h2>
            <DocumentRows lines={common.lines} columns={2} />
          </div>
        )}
        {branches.length === 0 ? null : (
          <div className="kiosk-doc-branch">
            <h2 className="kiosk-doc-group__head">{COPY.documents.branchHead}</h2>
            <div className="kiosk-doc-branch__columns">
              {branches.map((group) => (
                <div key={group.scope} className="kiosk-doc-group" data-doc-group={group.scope}>
                  <h3 className="kiosk-doc-group__subhead">{group.title}</h3>
                  <DocumentRows lines={group.lines} columns={1} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
