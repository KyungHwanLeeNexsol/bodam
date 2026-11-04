import { describe, expect, it } from 'vitest';
import { ADMIN_COPY } from '../../src/app/admin/copy';

// 숨기기는 게시하면 이 화면에서 되돌릴 수 없다는 점을 화면 문구가 분명히 말하는지 본다.

describe('숨기기 안내 문구', () => {
  it('목록 안내와 미리보기의 숨김 줄 모두 "게시한 뒤에는 이 화면에서 다시 보이게 할 수 없다"고 말한다', () => {
    expect(ADMIN_COPY.hideNote).toContain('숨긴 치료는 이 화면에서 다시 보이게 할 수 없습니다');
    expect(ADMIN_COPY.readOnlyNote).toContain(ADMIN_COPY.hideNote);
    expect(ADMIN_COPY.deactivatedLine).toContain('숨긴 치료는 이 화면에서 다시 보이게 할 수 없습니다');
    expect(ADMIN_COPY.deactivatedLine).toContain('키오스크 목록에서 빠집니다');
  });

  it('치료가 하나도 없는 카탈로그의 안내는 새 치료를 추가해 다시 시작하라고 말한다', () => {
    expect(ADMIN_COPY.emptyCatalog).toContain('새 치료');
  });
});
