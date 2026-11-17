import { describe, expect, it } from 'vitest';
import { extractModuleRefs, tokenize } from './source-scan';

// M6 에서 src/app 에 .tsx 가 생겨 어휘 분석기가 JSX 를 읽어야 한다. JSX 닫는 태그(`</div>`)의 `/` 를 정규식 시작으로 읽으면 줄이 바뀐 정규식으로 닫힌 실패한다.
// 어휘 분석기는 JSX 를 이해하지 않는다: `<` 바로 뒤의 `/` 를 나눗셈 기호로 둘 뿐이며, 이 시험은 그 한 가지 약속과 그것이 가져오기 추출을 해치지 않음을 고정한다.

describe('JSX 닫는 태그', () => {
  it('</div> 의 / 는 정규식으로 읽지 않고 가져오기를 그대로 찾는다', () => {
    const source = "import { A } from './a';\nexport function C() {\n  return (\n    <div>\n      <span>글</span>\n    </div>\n  );\n}\n";
    expect(() => tokenize(source)).not.toThrow();
    expect(extractModuleRefs(tokenize(source)).map((ref) => ref.specifier)).toEqual(['./a']);
  });

  it('여는 태그 속성과 자기 닫는 태그(<Icon />)도 읽는다', () => {
    const source = 'const x = <Icon name="a" size={3} />;\nconst y = <Icon name="b" />;\n';
    expect(() => tokenize(source)).not.toThrow();
  });

  it('정규식 리터럴은 여전히 정규식으로 읽는다 (대조군: 대입 뒤, 안에 < 와 > 가 있어도)', () => {
    const tokens = tokenize('const r = /a<b>/g;\nconst q = 1;');
    expect(tokens.filter((token) => token.kind === 'regex').map((token) => token.text)).toEqual(['/a<b>/g']);
  });
});
