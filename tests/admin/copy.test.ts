import { describe, expect, it } from 'vitest';
import { ADMIN_COPY } from '../../src/app/admin/copy';

// 숨기기 안내: 게시한 뒤에는 "숨긴 치료" 영역에서 다시 표시할 수 있다(초안 → 미리보기 → 게시를 다시 거친다). 이전 문구("다시 보이게 할 수 없다")가 남아 있으면 화면이 사실과 어긋난다.

describe('숨기기 안내 문구', () => {
  it('목록 안내와 미리보기의 숨김 줄 모두 "게시한 뒤에는 숨긴 치료에서 다시 표시할 수 있다"고 말한다', () => {
    expect(ADMIN_COPY.hideNote).toContain('다시 표시할 수 있습니다');
    expect(ADMIN_COPY.hideNote).toContain('숨김 취소');
    expect(ADMIN_COPY.readOnlyNote).toContain(ADMIN_COPY.hideNote);
    expect(ADMIN_COPY.deactivatedLine).toContain('다시 표시할 수 있습니다');
    expect(ADMIN_COPY.deactivatedLine).toContain('키오스크 목록에서 빠집니다');
  });

  it('더는 사실이 아닌 "다시 보이게 할 수 없다"는 문구가 어디에도 남아 있지 않다', () => {
    const text = JSON.stringify(ADMIN_COPY, (_key, value: unknown) => (typeof value === 'function' ? '' : value));
    expect(text).not.toContain('다시 보이게 할 수 없');
  });

  it('치료가 하나도 없는 카탈로그의 안내는 새 치료를 추가해 다시 시작하라고 말한다', () => {
    expect(ADMIN_COPY.emptyCatalog).toContain('새 치료');
  });
});

describe('다시 표시 안내 문구', () => {
  it('보장 승인이 아니고 검토가 남은 치료는 계속 계산 보류라고 말한다 (숨긴 치료 영역과 미리보기 모두)', () => {
    expect(ADMIN_COPY.hiddenNote).toContain('보장 승인이나 분류 변경이 아니');
    expect(ADMIN_COPY.hiddenNote).toContain('계산 보류');
    expect(ADMIN_COPY.reactivatedNote).toContain('보장 승인이 아닙니다');
    expect(ADMIN_COPY.reactivatedNote).toContain('계산 보류');
  });

  it('기본 위치(지금 보이는 치료들의 뒤)와 초안 → 미리보기 → 게시 경로를 말한다', () => {
    expect(ADMIN_COPY.hiddenNote).toContain('초안 저장 → 미리보기 → 게시');
    expect(ADMIN_COPY.hiddenNote).toContain('뒤');
  });

  it('작업 요약과 게시 이력 요약에 다시 표시 건수가 보이고, 없으면 기존 문장 그대로다', () => {
    const base = { priceChanged: 0, baseFeeChanged: 0, added: 0, hidden: 0, reordered: false };
    expect(ADMIN_COPY.workingSummary({ ...base, reshown: 2 })).toContain('다시 표시 2건');
    expect(ADMIN_COPY.workingSummary(base)).toBe('화면에서 고친 내용이 없습니다.');
    expect(ADMIN_COPY.historySummary({ added: 0, hidden: 0, reshown: 1, reordered: 0, priceChanged: 0 })).toBe('다시 표시 1건');
    expect(ADMIN_COPY.historySummary({ added: 0, hidden: 0, reordered: 0, priceChanged: 0 })).toBe('가격 변경 없음');
  });

  it('엔진이 말한 보류 사유를 사람이 읽는 말로 옮긴다 (알 수 없는 사유는 일반 문장)', () => {
    expect(ADMIN_COPY.holdReason('MAPPING_ABSENT')).toContain('매핑');
    expect(ADMIN_COPY.holdReason('CLASSIFICATION_NEEDS_REVIEW')).toContain('분류');
    expect(ADMIN_COPY.holdReason('SOMETHING_ELSE')).toBe('보장 검토가 필요합니다');
  });
});
