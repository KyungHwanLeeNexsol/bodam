import type { ReactElement, ReactNode } from 'react';
import { ScrollRegion } from '../../../src/app/kiosk/components/ScrollRegion';

// 시험 자료(TEST_FIXTURE). 훅이 없는 함수형 화면을 DOM 없이 펼쳐 요소 트리에서 단추·입력을 찾는 도구다(BRIEF D14).
// 호출하는 시험은 react 의 useId·useRef 를 가짜로 바꿔 두어야 한다(훅은 렌더링 밖에서 못 부른다). 실제 클릭·초점은 브라우저 시험(tests/e2e)이 본다.
// ScrollRegion(S4)은 브라우저에서만 재는 훅을 쓰는 감싸개라 펼치지 않고 자식으로 내려간다: 단추·입력은 감싸개 안에서도 같은 곳에 있다(감싸개의 표시·초점은 tests/e2e/kiosk/scroll.intercept.spec.ts).

export type Elem = ReactElement<Record<string, unknown>>;

interface ForwardRefType {
  readonly render: (props: Record<string, unknown>, ref: unknown) => ReactNode;
}

function isElement(node: unknown): node is Elem {
  return node !== null && typeof node === 'object' && 'props' in node && 'type' in node;
}

/** 함수형 컴포넌트·forwardRef 를 호출해 펼치고, 호스트 요소는 자식으로 내려가며 `match` 에 맞는 요소를 모은다(맞는 요소의 안은 더 보지 않는다). */
export function walk(node: ReactNode, match: (element: Elem) => boolean, found: Elem[] = []): Elem[] {
  if (Array.isArray(node)) {
    for (const child of node as ReactNode[]) walk(child, match, found);
    return found;
  }
  if (!isElement(node)) return found;
  if (match(node)) {
    found.push(node);
    return found;
  }
  const type = node.type as unknown;
  if (type === ScrollRegion) {
    walk(node.props.children as ReactNode, match, found);
  } else if (typeof type === 'function') {
    walk((type as (props: Record<string, unknown>) => ReactNode)(node.props), match, found);
  } else if (typeof type === 'object' && type !== null && 'render' in type) {
    walk((type as ForwardRefType).render(node.props, null), match, found);
  } else {
    walk(node.props.children as ReactNode, match, found);
  }
  return found;
}

const textOfNode = (node: ReactNode): string => {
  if (Array.isArray(node)) return (node as ReactNode[]).map(textOfNode).join('');
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (!isElement(node)) return '';
  return textOfNode(node.props.children as ReactNode);
};

export interface FoundButton {
  readonly label: string;
  readonly ariaDisabled: boolean;
  readonly className: string;
  /** 호스트 <button> 의 onClick 을 부른다. 비활성 단추는 onClick 이 없어 아무 일도 없다(Button 이 그렇게 그린다). */
  readonly click: () => void;
}

/** 화면을 끝까지 펼쳐 얻은 <button> 들(Button·Pager 가 그린 것). 보이는 글자는 아이콘(svg)을 뺀 글이다. */
export function buttonsOf(root: ReactNode): FoundButton[] {
  return walk(root, (element) => element.type === 'button').map((element) => {
    const onClick = element.props.onClick as (() => void) | undefined;
    return {
      label: textOfNode(element.props.children as ReactNode).trim(),
      ariaDisabled: element.props['aria-disabled'] === true,
      className: (element.props.className as string | undefined) ?? '',
      click: () => {
        onClick?.();
      },
    };
  });
}

export interface FoundInput {
  readonly type: string;
  readonly checked: boolean;
  readonly ariaDisabled: boolean;
  readonly change: () => void;
}

/** 트리 안의 네이티브 입력(radio·checkbox)들. */
export function inputsOf(root: ReactNode): FoundInput[] {
  return walk(root, (element) => element.type === 'input').map((element) => ({
    type: element.props.type as string,
    checked: element.props.checked === true,
    ariaDisabled: element.props['aria-disabled'] === true,
    change: element.props.onChange as () => void,
  }));
}
