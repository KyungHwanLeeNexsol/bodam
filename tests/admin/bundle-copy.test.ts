import { describe, expect, it } from 'vitest';
import { BUNDLE_COPY, SCOPE_COPY } from '../../src/app/admin/bundle-copy';

// 묶음 게시·규칙 사용 범위 화면이 분명히 말해야 하는 것: 게시는 병원에 적용되지 않는다 · 지정은 병원 한 곳씩이다 · 거절 문장에 서버 코드가 나오지 않는다.

describe('묶음 게시 문구', () => {
  it('화면 머리말과 게시 안내 모두 "게시해도 어느 병원에도 바로 적용되지 않는다"고 말한다', () => {
    expect(BUNDLE_COPY.note).toContain('어느 병원에도 바로 적용되지 않습니다');
    expect(BUNDLE_COPY.note).toContain('플랫폼 운영자');
    expect(BUNDLE_COPY.publishHintReady).toContain('어느 병원에도 바로 적용되지는 않습니다');
    expect(BUNDLE_COPY.publishedNotApplied('X')).toContain('아직 어느 병원에도 적용되지 않았습니다');
  });

  it('후보 목록 안내는 승인이 검토 기록일 뿐 환자 화면 반영이 아니라고 말한다', () => {
    expect(BUNDLE_COPY.candidatesNote).toContain('환자 화면에 반영되지 않습니다');
  });

  it('승인 뒤 바뀐 매핑의 경고는 게시하면 서버가 거절한다고 분명히 말한다', () => {
    expect(BUNDLE_COPY.staleWarning).toContain('서버가 거절합니다');
  });

  it('서버 사유 네 가지 문장에는 코드 글자가 없고 서로 다르다', () => {
    const entries = Object.entries(BUNDLE_COPY.conflict);
    expect(entries.map(([code]) => code).sort()).toEqual(['BASE_BUNDLE_NOT_ACTIVE', 'MAPPING_ALREADY_IN_BASE', 'MAPPING_CONFLICT', 'PREVIEW_REQUIRED']);
    for (const [code, text] of entries) {
      expect(text, code).not.toContain(code);
    }
    expect(new Set(entries.map(([, text]) => text)).size).toBe(4);
  });

  it('게시 거절 문장은 아무것도 게시되지 않았고 어느 병원의 규칙도 바뀌지 않았다고 말한다', () => {
    expect(BUNDLE_COPY.nothingPublished).toContain('아무것도 게시되지 않았');
    expect(BUNDLE_COPY.nothingPublished).toContain('어느 병원의 규칙도 바뀌지 않았');
  });
});

describe('규칙 사용 범위 문구', () => {
  it('머리말은 병원 한 곳씩만 바꾸고 한꺼번에 적용하는 기능이 없다고 말한다', () => {
    expect(SCOPE_COPY.note).toContain('병원 한 곳씩만');
    expect(SCOPE_COPY.note).toContain('한꺼번에 적용하는 기능은 없습니다');
  });

  it('SCOPE_CHANGED 안내는 화면을 불러온 뒤 현재 적용본이 바뀌었고 다시 불러왔다는 말이다', () => {
    expect(SCOPE_COPY.failure.scopeChanged).toContain('현재 적용본이 화면을 불러온 뒤 다른 곳에서 바뀌었습니다');
    expect(SCOPE_COPY.failure.scopeChanged).toContain('다시 불러왔으니');
    expect(SCOPE_COPY.failure.scopeChanged).not.toContain('SCOPE_CHANGED');
  });

  it('지정 성공 안내는 다른 병원이 바뀌지 않았다고 말한다', () => {
    expect(SCOPE_COPY.assigned('병원', '묶음')).toContain('다른 병원은 바뀌지 않았습니다');
  });
});
