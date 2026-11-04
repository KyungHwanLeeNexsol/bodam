import { describe, expect, it } from 'vitest';
import { Badge } from '../../../src/app/kiosk/components/Badge';
import { BottomActions } from '../../../src/app/kiosk/components/BottomActions';
import { Button } from '../../../src/app/kiosk/components/Button';
import { Card } from '../../../src/app/kiosk/components/Card';
import { KioskFrame } from '../../../src/app/kiosk/components/KioskFrame';
import { KioskHeader } from '../../../src/app/kiosk/components/KioskHeader';
import { NoticeBar } from '../../../src/app/kiosk/components/NoticeBar';
import { ResultBar } from '../../../src/app/kiosk/components/ResultBar';
import { StepIndicator } from '../../../src/app/kiosk/components/StepIndicator';
import { Icon } from '../../../src/app/kiosk/components/icons';
import { K00Start } from '../../../src/app/kiosk/screens/K00Start';
import { render, textOf } from './render';

// 공유 컴포넌트 (BRIEF D14·D15): 진짜 <button>, aria-disabled, 단계 표시의 상태·"n / 4", 상단의 서비스명·병원명·큰 글자 토글.

describe('Button', () => {
  it('진짜 <button type="button"> 이고 변형 클래스와 라벨을 가진다', () => {
    const html = render(<Button variant="primary">시작하기</Button>);
    expect(html).toContain('<button type="button" class="kiosk-button kiosk-button--primary">');
    expect(html).toContain('<span class="kiosk-button__label">시작하기</span>');
    expect(render(<Button variant="secondary">이전</Button>)).toContain('kiosk-button--secondary');
  });

  it('비활성은 disabled 속성이 아니라 aria-disabled 다 (초점을 받아 이유를 읽을 수 있다)', () => {
    const html = render(
      <Button variant="primary" disabled>
        예상 부담액 확인
      </Button>,
    );
    expect(html).toContain('aria-disabled="true"');
    expect(html).not.toMatch(/\sdisabled(=|\s|>)/);
    expect(render(<Button variant="primary">다음</Button>)).not.toContain('aria-disabled');
  });

  it('아이콘은 라벨 뒤 오른쪽 끝에 놓고 장식이라 화면 낭독기에서 숨긴다. block 은 가로 전체다', () => {
    const html = render(
      <Button variant="primary" icon="chevron-right" block>
        다음
      </Button>,
    );
    expect(html.indexOf('kiosk-button__label')).toBeLessThan(html.indexOf('<svg'));
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('kiosk-button--block');
  });

  it('data-* 와 aria-* 속성을 그대로 넘긴다', () => {
    expect(render(<Button variant="secondary" data-kiosk-initial-focus aria-describedby="why">계속</Button>)).toContain('data-kiosk-initial-focus="true"');
  });
});

describe('Card · NoticeBar · Badge · ResultBar', () => {
  it('Card: 선택되면 선택 클래스가 붙고 역할 속성을 넘길 수 있다', () => {
    expect(render(<Card>내용</Card>)).toBe('<div class="kiosk-card">내용</div>');
    expect(render(<Card className="추가">내용</Card>)).toBe('<div class="kiosk-card 추가">내용</div>');
    const selected = render(
      <Card selected role="checkbox" aria-checked>
        치료
      </Card>,
    );
    expect(selected).toContain('kiosk-card kiosk-card--selected');
    expect(selected).toContain('role="checkbox"');
  });

  it('NoticeBar: note 역할의 문장이고 링크가 없다', () => {
    const html = render(<NoticeBar>실제 지급액이 달라질 수 있습니다.</NoticeBar>);
    expect(html).toContain('role="note"');
    expect(textOf(html)).toBe('실제 지급액이 달라질 수 있습니다.');
    expect(html).not.toContain('<a');
  });

  it('Badge: 색 이름과 상관없이 글자가 뜻을 담는다', () => {
    expect(render(<Badge>급여</Badge>)).toBe('<span class="kiosk-badge">급여</span>');
    expect(render(<Badge tone="warn">예시 계산</Badge>)).toContain('kiosk-badge--warn');
    expect(render(<Badge tone="danger">통신 오류</Badge>)).toContain('kiosk-badge--danger');
    expect(render(<Badge tone="success">확인</Badge>)).toContain('kiosk-badge--success');
  });

  it('ResultBar: 왼쪽 제목과 오른쪽 배지', () => {
    const html = render(<ResultBar label="연결 상태" badge={<Badge tone="danger">통신 오류</Badge>} />);
    expect(textOf(html)).toBe('연결 상태 통신 오류');
    expect(textOf(render(<ResultBar label="예상 결과 안내" />))).toBe('예상 결과 안내');
  });

  it('BottomActions: 한 줄과 쌓는 변형', () => {
    expect(render(<BottomActions>동작</BottomActions>)).toBe('<div class="kiosk-bottom-actions">동작</div>');
    expect(render(<BottomActions stack>동작</BottomActions>)).toContain('kiosk-bottom-actions--stack');
  });

  it('아이콘: 24 격자 SVG 이고 장식이다. 모든 이름을 그릴 수 있다', () => {
    const names = ['heart-pulse', 'building-2', 'a-large-small', 'chevron-right', 'chevron-left', 'check', 'rotate-ccw', 'wifi-off', 'loader', 'shield-alert', 'circle-alert'] as const;
    for (const name of names) {
      const html = render(<Icon name={name} size={30} />);
      expect(html).toContain('viewBox="0 0 24 24"');
      expect(html).toContain('width="30"');
      expect(html).toContain('aria-hidden="true"');
    }
    expect(render(<Icon name="loader" size={10} className="kiosk-spin" />)).toContain('class="kiosk-icon kiosk-spin"');
  });
});

describe('StepIndicator', () => {
  it.each([1, 2, 3, 4] as const)('%i 단계: 지금 단계 하나만 aria-current, 앞은 완료, 뒤는 남은 단계, 끝에 "n / 4"', (step) => {
    const html = render(<StepIndicator step={step} />);
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    expect(html.match(/kiosk-steps__item--done/g)?.length ?? 0).toBe(step - 1);
    expect(html.match(/kiosk-steps__item--current/g)).toHaveLength(1);
    expect(html.match(/kiosk-steps__connector/g)).toHaveLength(3);
    expect(html).toContain(`${step} / 4`);
    expect(textOf(html)).toContain('실손보험 2 보험사 형태 3 치료 원인 4 치료 선택');
  });
});

describe('KioskHeader', () => {
  it('서비스명·서비스 설명·병원명·큰 글자 토글을 그린다. 병원명은 응답 값이다', () => {
    const html = render(<KioskHeader serviceName="보담" hospitalName="TEST_FIXTURE 시험 의원" largeText={{ pressed: false, onToggle: () => undefined }} />);
    expect(textOf(html)).toBe('보담 실손보험 예상 부담액 안내 TEST_FIXTURE 시험 의원 큰 글자 보기');
    expect(html).toContain('aria-pressed="false"');
  });

  it('켜진 토글은 aria-pressed true 와 체크 아이콘이다', () => {
    const html = render(<KioskHeader serviceName="보담" largeText={{ pressed: true, onToggle: () => undefined }} />);
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('M20 6 9 17l-5-5');
  });

  it('병원명과 토글은 없을 수 있다 (자료를 받기 전 화면)', () => {
    const html = render(<KioskHeader serviceName="보담" />);
    expect(html).not.toContain('<button');
    expect(html).not.toContain('kiosk-hospital');
  });

  it('전화 링크·외부 링크·<a> 가 없다', () => {
    const html = render(<KioskHeader serviceName="보담" hospitalName="병원" largeText={{ pressed: false, onToggle: () => undefined }} />);
    expect(html).not.toMatch(/<a[\s>]/);
    expect(html).not.toContain('href');
  });
});

describe('KioskContext 밖', () => {
  it('상태를 읽으려 하면 예외다 (화면이 컨트롤러 없이 그려지지 않는다)', () => {
    expect(() => render(<K00Start />)).toThrow('KioskContext 밖');
  });
});

describe('KioskFrame', () => {
  it('방향과 큰 글자 보기를 data 속성으로 노출한다', () => {
    expect(render(<KioskFrame orientation="PORTRAIT" largeText={false}>x</KioskFrame>)).toContain('data-orientation="portrait" data-large-text="false"');
    expect(render(<KioskFrame orientation="LANDSCAPE" largeText>x</KioskFrame>)).toContain('data-orientation="landscape" data-large-text="true"');
  });
});
