import { afterEach, describe, expect, it, vi } from 'vitest';
import { seoulDate, systemToday } from '../../src/app/clock';
import { getApiServices } from '../../src/app/services';

// 판정 기준일의 운영 주입 (M4.B, design.md DD-04·DD-19). src/server 는 시계를 읽지 않으므로(tests/boundary/server-imports.test.ts)
// 운영 연결(src/app/services.ts)이 시스템 날짜를 만들어 넣는다. 기준일은 한국 표준시(Asia/Seoul, UTC+9, 일광절약시간 없음)의 달력 날짜다.
// 이 파일은 src/app/services.ts 를 vi.mock 하지 않는다: 실제 운영 연결을 쓴다.

afterEach(() => {
  vi.useRealTimers();
});

describe('seoulDate: UTC 시각 -> 한국 표준시 달력 날짜 (YYYY-MM-DD)', () => {
  it.each([
    ['한국 자정 직후 (UTC 15:00)', '2026-10-14T15:00:00.000Z', '2026-10-15'],
    ['한국 자정 직전 (UTC 14:59:59.999)', '2026-10-14T14:59:59.999Z', '2026-10-14'],
    ['UTC 정오', '2026-10-15T12:00:00.000Z', '2026-10-15'],
    ['연말 경계', '2026-12-31T15:00:00.000Z', '2027-01-01'],
    ['윤년 2월 말', '2028-02-28T15:00:00.000Z', '2028-02-29'],
    ['윤년이 아닌 해의 2월 말', '2027-02-28T15:00:00.000Z', '2027-03-01'],
    ['월 경계', '2026-09-30T15:00:00.000Z', '2026-10-01'],
  ])('%s', (_label, instant, expected) => {
    expect(seoulDate(new Date(instant))).toBe(expected);
  });

  it('입력 시각을 바꾸지 않는다', () => {
    const instant = new Date('2026-10-14T15:00:00.000Z');
    seoulDate(instant);
    expect(instant.toISOString()).toBe('2026-10-14T15:00:00.000Z');
  });
});

describe('systemToday 와 운영 연결', () => {
  it('systemToday 는 지금(시스템 시계)의 한국 날짜다', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-14T15:30:00.000Z'));
    expect(systemToday()).toBe('2026-10-15');
    vi.setSystemTime(new Date('2026-10-14T14:30:00.000Z'));
    expect(systemToday()).toBe('2026-10-14');
  });

  it('운영 서비스의 today() 는 systemToday 를 쓴다: 부를 때마다 시스템 시계를 새로 읽는다', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-14T15:30:00.000Z'));
    const services = getApiServices();
    expect(services.today()).toBe('2026-10-15');
    vi.setSystemTime(new Date('2026-10-15T15:30:00.000Z'));
    expect(services.today()).toBe('2026-10-16');
  });

  it('형식은 YYYY-MM-DD 다 (엔진의 판정 기준일 형식)', () => {
    expect(systemToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
