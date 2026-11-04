import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachBrowserBindings, interactionHandlers } from '../../../src/app/kiosk/runtime/use-browser-bindings';
import type { BindingHost } from '../../../src/app/kiosk/runtime/use-browser-bindings';
import { bootstrapStateOf } from '../../../src/app/kiosk/runtime/use-bootstrap';
import { LANDSCAPE_QUERY, readOrientation } from '../../../src/app/kiosk/runtime/viewport';
import { createKioskController } from '../../../src/app/kiosk/state/controller';
import type { KioskController } from '../../../src/app/kiosk/state/controller';
import { makeCatalog, makeOptions } from '../../fixtures/kiosk/clinic.fixture';

// 브라우저 연결 (BRIEF D4): 방향 관찰·페이지 복원·조작 감지가 모두 controller.dispatch 를 거친다. 가짜 창으로 실제 컨트롤러를 움직인다(가짜 시계 위에서).

interface FakeMedia {
  matches: boolean;
  readonly listeners: Set<() => void>;
  addEventListener(type: 'change', listener: () => void): void;
  removeEventListener(type: 'change', listener: () => void): void;
  change(matches: boolean): void;
}

function fakeHost(landscape: boolean) {
  const media: FakeMedia = {
    matches: landscape,
    listeners: new Set(),
    addEventListener: (_type, listener) => media.listeners.add(listener),
    removeEventListener: (_type, listener) => media.listeners.delete(listener),
    change: (matches) => {
      media.matches = matches;
      for (const listener of [...media.listeners]) listener();
    },
  };
  const pageshow = new Set<(event: { readonly persisted: boolean }) => void>();
  const queries: string[] = [];
  const host: BindingHost = {
    matchMedia: (query) => {
      queries.push(query);
      return media;
    },
    addEventListener: (_type, listener) => pageshow.add(listener),
    removeEventListener: (_type, listener) => pageshow.delete(listener),
  };
  return { host, media, pageshow, queries, show: (persisted: boolean) => [...pageshow].forEach((listener) => listener({ persisted })) };
}

let controller: KioskController;

beforeEach(() => {
  vi.useFakeTimers();
  controller = createKioskController({}, { catalog: makeCatalog(), options: makeOptions(), orientation: 'PORTRAIT' });
});

afterEach(() => {
  controller.dispose();
  vi.useRealTimers();
});

describe('방향 관찰', () => {
  it('가로 미디어 질의를 쓰고, 연결 직후 현재 방향을 한 번 맞춘다 (만든 뒤 연결 전 사이의 변화)', () => {
    const fake = fakeHost(true);
    const detach = attachBrowserBindings(controller, fake.host);
    expect(fake.queries).toEqual([LANDSCAPE_QUERY]);
    expect(controller.getState().display.orientation).toBe('LANDSCAPE');
    detach();
  });

  it('방향이 바뀔 때마다 ORIENTATION_CHANGED 로 상태가 따라간다 (선택·화면은 그대로)', () => {
    const fake = fakeHost(false);
    attachBrowserBindings(controller, fake.host);
    controller.dispatch({ type: 'START' });
    const before = controller.getState();
    fake.media.change(true);
    expect(controller.getState().display.orientation).toBe('LANDSCAPE');
    expect(controller.getState().screen).toBe('K01_Generation');
    expect(controller.getState().sessionId).toBe(before.sessionId);
    fake.media.change(false);
    expect(controller.getState().display.orientation).toBe('PORTRAIT');
  });

  it('연결을 풀면 더는 듣지 않는다', () => {
    const fake = fakeHost(false);
    const detach = attachBrowserBindings(controller, fake.host);
    expect(fake.media.listeners.size).toBe(1);
    expect(fake.pageshow.size).toBe(1);
    detach();
    expect(fake.media.listeners.size).toBe(0);
    expect(fake.pageshow.size).toBe(0);
    fake.media.change(true);
    expect(controller.getState().display.orientation).toBe('PORTRAIT');
  });
});

describe('페이지 복원 (pageshow)', () => {
  it('persisted 이면 PAGE_RESTORED: 새 sessionId 의 빈 K00_Start', () => {
    const fake = fakeHost(false);
    attachBrowserBindings(controller, fake.host);
    controller.dispatch({ type: 'START' });
    controller.dispatch({ type: 'SELECT_GENERATION', code: 'GEN2_C1' });
    const before = controller.getState();
    expect(before.inputs.generation).toBe('GEN2_C1');
    fake.show(true);
    const after = controller.getState();
    expect(after.screen).toBe('K00_Start');
    expect(after.inputs.generation).toBeNull();
    expect(after.sessionId).not.toBe(before.sessionId);
  });

  it('persisted 가 아니면(처음 열기·새로고침) 아무 일도 없다', () => {
    const fake = fakeHost(false);
    attachBrowserBindings(controller, fake.host);
    controller.dispatch({ type: 'START' });
    const before = controller.getState();
    fake.show(false);
    expect(controller.getState()).toBe(before);
  });
});

describe('조작 감지', () => {
  it('포착 단계 터치·키 입력은 INTERACTION 한 건씩 dispatch 로 보낸다 (시각을 직접 쓰지 않는다)', () => {
    const dispatch = vi.fn();
    const handlers = interactionHandlers({ dispatch } as unknown as KioskController);
    handlers.onPointerDownCapture();
    handlers.onKeyDownCapture();
    expect(dispatch.mock.calls).toEqual([[{ type: 'INTERACTION' }], [{ type: 'INTERACTION' }]]);
  });

  it('입력 화면에서는 마지막 조작 시각을 다시 센다 (reducer 가 정한다)', () => {
    controller.dispatch({ type: 'START' });
    const handlers = interactionHandlers(controller);
    const before = controller.getState().lastInteractionAt;
    vi.advanceTimersByTime(30_000);
    handlers.onPointerDownCapture();
    expect(controller.getState().lastInteractionAt).toBeGreaterThanOrEqual(before + 30_000);
  });

  it('시작 화면(K00)에서는 받아들이지 않는다 (지울 데이터가 없다)', () => {
    const handlers = interactionHandlers(controller);
    const before = controller.getState();
    handlers.onPointerDownCapture();
    expect(controller.getState()).toBe(before);
  });

  it('TimeoutDialog 가 열려 있으면 일반 조작은 거절된다 ("계속 사용할게요"만 시간을 다시 센다)', () => {
    controller.dispatch({ type: 'START' });
    vi.advanceTimersByTime(100_000);
    expect(controller.getState().overlay.kind).toBe('TIMEOUT_DIALOG');
    const opened = controller.getState();
    interactionHandlers(controller).onPointerDownCapture();
    expect(controller.getState()).toBe(opened);
  });
});

describe('뷰포트 방향 읽기와 시작 단계의 상태 대응', () => {
  it('창이 없는 환경(서버 렌더링)에서는 세로다', () => {
    expect(readOrientation()).toBe('PORTRAIT');
  });

  it('창이 있으면 가로 미디어 질의의 결과를 읽는다. matchMedia 가 없으면 세로다', () => {
    const queries: string[] = [];
    vi.stubGlobal('window', { matchMedia: (query: string) => (queries.push(query), { matches: true }) });
    expect(readOrientation()).toBe('LANDSCAPE');
    expect(queries).toEqual([LANDSCAPE_QUERY]);
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
    expect(readOrientation()).toBe('PORTRAIT');
    vi.stubGlobal('window', {});
    expect(readOrientation()).toBe('PORTRAIT');
    vi.unstubAllGlobals();
  });

  it('받기의 결말 네 가지가 화면 상태 다섯 가지 가운데 해당하는 것으로 바뀐다', () => {
    const catalog = makeCatalog();
    const options = makeOptions();
    expect(bootstrapStateOf({ kind: 'READY', catalog, options })).toEqual({ status: 'READY', catalog, options });
    expect(bootstrapStateOf({ kind: 'NO_TREATMENTS', catalog })).toEqual({ status: 'NO_TREATMENTS', catalog });
    expect(bootstrapStateOf({ kind: 'NOT_FOUND' })).toEqual({ status: 'NOT_FOUND' });
    expect(bootstrapStateOf({ kind: 'FAILED' })).toEqual({ status: 'LOAD_FAILED' });
  });
});
