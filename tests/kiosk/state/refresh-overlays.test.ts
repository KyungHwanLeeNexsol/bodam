import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { selectTimeoutDialog } from '../../../src/app/kiosk/state/idle';
import { canRequestEstimate } from '../../../src/app/kiosk/state/selectors';
import type { OverlayKind } from '../../../src/app/kiosk/state/session-store';
import { REFRESH_TIMEOUT_MS, catalogBody, errorBody, startKiosk } from '../../fixtures/kiosk/transport.fixture';
import type { Kiosk, KioskOptions } from '../../fixtures/kiosk/transport.fixture';
import { SECOND, flush, resolveBoth, startRefreshing, stateOf, withoutKidney } from './refresh-helpers';
import type { Refreshing } from './refresh-helpers';

// 겹침창이 열려 있는 동안 도착하는 자료 갱신 결과 (design.md DD-07 "겹침창이 열려 있는 동안 도착하는 요청 결말" 표 2, DD-09 "자료 갱신 생명주기" 규칙 5·6).
// 증거: AC-020h (unit 부분. e2e 는 M6). 무조작 정책은 K03_Treatments(입력 단계)가 경고 100초·초기화 120초다. 갱신 시간 제한은 시험마다 주입한다.

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

type Overlay = Exclude<OverlayKind, 'NONE'>;
const OVERLAYS: Overlay[] = ['RESET_CONFIRM', 'TIMEOUT_DIALOG'];

interface Scene {
  readonly kiosk: Kiosk;
  readonly refreshing: Refreshing;
}

/** 갱신이 진행 중인(RUNNING) 4단계 위에 겹침창을 연다. ResetConfirm 은 "처음으로"로, TimeoutDialog 는 경고 시각(100초)까지 기다려서 연다. */
async function openOver(overlay: Overlay, options: KioskOptions = {}): Promise<Scene> {
  const kiosk = startKiosk(options);
  const refreshing = await startRefreshing(kiosk);
  if (overlay === 'RESET_CONFIRM') kiosk.controller.dispatch({ type: 'REQUEST_HOME' });
  else await vi.advanceTimersByTimeAsync(100 * SECOND);
  expect(stateOf(kiosk).overlay.kind).toBe(overlay);
  expect(stateOf(kiosk).refreshState).toBe('RUNNING');
  return { kiosk, refreshing };
}

const dismiss = (kiosk: Kiosk, overlay: Overlay): void => {
  kiosk.controller.dispatch({ type: overlay === 'RESET_CONFIRM' ? 'CANCEL_RESET' : 'CONTINUE_USING' });
};

interface Arrival {
  readonly name: string;
  readonly refreshState: 'NONE' | 'FAILED';
  readonly buttonEnabled: boolean;
  readonly arrive: (scene: Scene) => Promise<void>;
}

const ARRIVALS: Arrival[] = [
  { name: '성공 (catalog 와 options 둘 다 도착)', refreshState: 'NONE', buttonEnabled: true, arrive: async (scene) => { await resolveBoth(scene.refreshing, withoutKidney()); } },
  { name: '실패 (한쪽 500)', refreshState: 'FAILED', buttonEnabled: false, arrive: async (scene) => { scene.refreshing.optionsCall.respond(500, errorBody('INTERNAL_ERROR')); await flush(); } },
  { name: '실패 (연결 실패)', refreshState: 'FAILED', buttonEnabled: false, arrive: async (scene) => { scene.refreshing.catalogCall.fail(); await flush(); } },
  {
    name: '시간 제한 도달',
    refreshState: 'FAILED',
    buttonEnabled: false,
    // 갱신 시간 제한 타이머의 콜백이 돌았을 때와 같다 (시간 제한을 실제로 흘려 보내는 시험은 아래 절이 한다)
    arrive: async (scene) => { scene.kiosk.controller.dispatch({ type: 'REFRESH_EXPIRED', refreshId: scene.refreshing.refreshId }); },
  },
];

const MATRIX = OVERLAYS.flatMap((overlay) => ARRIVALS.map((arrival) => [overlay, arrival.name, arrival] as const));

describe('표 2: 겹침창이 열려 있는 동안 갱신 결과가 도착한다 — 밑 화면에 곧바로 반영되고 겹침창은 열린 채 그대로다', () => {
  it.each(MATRIX)('%s 위에서 %s', async (overlay, _name, arrival) => {
    const scene = await openOver(overlay);
    const { kiosk } = scene;
    const before = stateOf(kiosk);
    const dialogBefore = selectTimeoutDialog(before, performance.now());
    const timers = vi.getTimerCount();

    await arrival.arrive(scene);

    const state = stateOf(kiosk);
    expect(state.refreshState).toBe(arrival.refreshState);
    expect(state.activeRefresh).toBeNull();
    expect(state.screen).toBe('K03_Treatments');
    expect(canRequestEstimate(state)).toBe(arrival.buttonEnabled);
    // 겹침창은 자동으로 닫히거나 확인되지 않고, 열린 TimeoutDialog 의 초기화 시각은 움직이지 않는다
    expect(state.overlay).toEqual(before.overlay);
    if (overlay === 'TIMEOUT_DIALOG') expect(selectTimeoutDialog(state, performance.now())).toEqual(dialogBefore);
    // 갱신 결과는 무조작 시간을 다시 세지 않는다. sessionId 는 그대로다
    expect(state.lastInteractionAt).toBe(before.lastInteractionAt);
    expect(state.sessionId).toBe(before.sessionId);
    // 갱신 시간 제한 타이머가 풀렸다 (무조작 타이머만 남는다)
    expect(vi.getTimerCount()).toBe(timers - 1);
    // 성공이면 선택에서 뺀 치료로 inputRevision 이 한 번 오르고, 실패이면 자료·선택이 그대로다
    if (arrival.refreshState === 'NONE') {
      expect(state.inputRevision).toBe(before.inputRevision + 1);
      expect(state.clinic.versions.catalogVersion).toBe('TEST_FIXTURE_CATALOG_V2');
    } else {
      expect(state.inputRevision).toBe(before.inputRevision);
      expect(state.clinic).toBe(before.clinic);
      expect(state.inputs).toBe(before.inputs);
    }

    // 닫으면 갱신 전의 상태가 아니라 최신 갱신 상태가 드러난다
    dismiss(kiosk, overlay);
    const closed = stateOf(kiosk);
    expect(closed.overlay.kind).toBe('NONE');
    expect(closed.refreshState).toBe(arrival.refreshState);
    expect(closed.screen).toBe('K03_Treatments');
    expect(canRequestEstimate(closed)).toBe(arrival.buttonEnabled);
    kiosk.dispose();
  });
});

describe('표 2: 환자가 겹침창을 먼저 닫고 나서 결과가 도착한다 — 끝 상태가 같다', () => {
  it.each(MATRIX)('%s 를 닫은 뒤 %s', async (overlay, _name, arrival) => {
    const scene = await openOver(overlay);
    const { kiosk } = scene;
    dismiss(kiosk, overlay);
    // 닫은 직후에는 아직 갱신 중이다: 확인 버튼은 비활성
    expect(stateOf(kiosk).refreshState).toBe('RUNNING');
    expect(canRequestEstimate(stateOf(kiosk))).toBe(false);
    const touched = stateOf(kiosk).lastInteractionAt;
    await arrival.arrive(scene);
    const state = stateOf(kiosk);
    expect(state.refreshState).toBe(arrival.refreshState);
    expect(canRequestEstimate(state)).toBe(arrival.buttonEnabled);
    expect(state.overlay.kind).toBe('NONE');
    expect(state.lastInteractionAt).toBe(touched);
    kiosk.dispose();
  });
});

describe('표 2: 아직 도착하지 않았다 (RUNNING)', () => {
  it.each(OVERLAYS)('%s 위에서 아직 바뀌는 것이 없다. 닫아도 갱신 중이라 확인 버튼은 비활성이다', async (overlay) => {
    const { kiosk } = await openOver(overlay);
    const before = stateOf(kiosk);
    expect(canRequestEstimate(before)).toBe(false);
    dismiss(kiosk, overlay);
    const closed = stateOf(kiosk);
    expect(closed.refreshState).toBe('RUNNING');
    expect(closed.activeRefresh).toBe(before.activeRefresh);
    expect(canRequestEstimate(closed)).toBe(false);
    kiosk.dispose();
  });
});

describe('표 2: 확정된 초기화가 먼저이면 도착한 갱신 결과는 버려지고, 반대 순서이면 반영된 내용이 세션 삭제와 함께 지워진다', () => {
  it.each(OVERLAYS)('%s: 초기화를 확정한 뒤 성공이 도착해도 K00_Start 가 그대로다', async (overlay) => {
    const { kiosk, refreshing } = await openOver(overlay);
    kiosk.controller.dispatch({ type: 'REQUEST_HOME' });
    if (overlay === 'RESET_CONFIRM') kiosk.controller.dispatch({ type: 'CONFIRM_RESET' });
    const fresh = stateOf(kiosk);
    expect(fresh.screen).toBe('K00_Start');
    await resolveBoth(refreshing, withoutKidney());
    expect(stateOf(kiosk)).toBe(fresh);
    expect(fresh.clinic.versions.catalogVersion).toBe('TEST_FIXTURE_CATALOG_V1');
    kiosk.dispose();
  });

  it.each(OVERLAYS)('%s: 성공이 먼저 반영된 뒤 초기화하면 반영된 선택·안내가 지워지고 K00_Start 다', async (overlay) => {
    const { kiosk, refreshing } = await openOver(overlay);
    await resolveBoth(refreshing, withoutKidney());
    expect(stateOf(kiosk).refreshNotice).not.toBeNull();
    kiosk.controller.dispatch({ type: 'REQUEST_HOME' });
    if (overlay === 'RESET_CONFIRM') kiosk.controller.dispatch({ type: 'CONFIRM_RESET' });
    const fresh = stateOf(kiosk);
    expect(fresh.screen).toBe('K00_Start');
    expect(fresh.inputs.treatmentIds).toEqual([]);
    expect(fresh.refreshNotice).toBeNull();
    kiosk.dispose();
  });
});

describe('표 2: 무조작 시간과 갱신', () => {
  it('갱신의 시작·성공·실패·시간 초과는 무조작 시간을 다시 세지 않지만, 인라인 "다시 시도" 터치는 다시 센다 (규칙 6)', async () => {
    const kiosk = startKiosk({ refreshTimeoutMs: REFRESH_TIMEOUT_MS });
    await startRefreshing(kiosk);
    const touched = stateOf(kiosk).lastInteractionAt;
    await vi.advanceTimersByTimeAsync(REFRESH_TIMEOUT_MS);
    expect(stateOf(kiosk).refreshState).toBe('FAILED');
    expect(stateOf(kiosk).lastInteractionAt).toBe(touched);
    kiosk.controller.dispatch({ type: 'RETRY_REFRESH' });
    const retryTouch = stateOf(kiosk).lastInteractionAt;
    expect(retryTouch).toBe(performance.now());
    expect(retryTouch).toBeGreaterThan(touched);
    // 경고는 다시 센 시각부터 100초 뒤다
    await vi.advanceTimersByTimeAsync(100 * SECOND - 1);
    expect(stateOf(kiosk).overlay.kind).toBe('NONE');
    await vi.advanceTimersByTimeAsync(1);
    expect(stateOf(kiosk).overlay.kind).toBe('TIMEOUT_DIALOG');
    kiosk.dispose();
  });

  it('TimeoutDialog 가 열린 채 초기화 시각이 되면 갱신 결과를 기다리지 않고 K00_Start 다 (갱신이 초기화를 늦추지 않는다)', async () => {
    const { kiosk, refreshing } = await openOver('TIMEOUT_DIALOG');
    await vi.advanceTimersByTimeAsync(20 * SECOND);
    expect(stateOf(kiosk).screen).toBe('K00_Start');
    expect(vi.getTimerCount()).toBe(0);
    await resolveBoth(refreshing, catalogBody());
    expect(stateOf(kiosk).screen).toBe('K00_Start');
    expect(refreshing.optionsCall.init.signal.aborted).toBe(true);
    kiosk.dispose();
  });
});

