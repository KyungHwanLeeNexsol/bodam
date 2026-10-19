import type { Repository } from '../../src/server/repo/interfaces';

// API 통합 시험 도우미. 실제 route.ts 의 GET 을 Next.js 가 부르는 모양(요청 + params 약속)으로 부른다.

export type GetHandler = (request: Request, context: { params: Promise<{ slug: string }> }) => Promise<Response>;

export interface Called {
  status: number;
  headers: Headers;
  text: string;
  body: unknown;
}

/** GET 핸들러를 slug 로 부르고 응답을 읽는다. */
export async function callGet(handler: GetHandler, slug: string, path: string): Promise<Called> {
  const response = await handler(new Request(`http://localhost/api/clinics/${encodeURIComponent(slug)}/${path}`), { params: Promise.resolve({ slug }) });
  const text = await response.text();
  return { status: response.status, headers: response.headers, text, body: JSON.parse(text) as unknown };
}

/** JSON 값 안의 모든 객체 키(깊이 무관). 배열 요소는 따라 들어간다. */
export function collectKeys(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, out);
  } else if (value !== null && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      out.add(key);
      collectKeys(inner, out);
    }
  }
  return out;
}

/** 저장소를 감싸 지정한 읽기 메서드의 결과를 바꾼다 (서버 무결성 결함 상황을 만드는 데 쓴다). 나머지는 그대로 위임한다. */
export function repoWith<R extends Repository>(repo: R, overrides: Partial<Record<keyof Repository, (...args: never[]) => unknown>>): Repository {
  return new Proxy(repo, {
    get(target, property, receiver) {
      const override = overrides[property as keyof Repository];
      if (override !== undefined) return override;
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}
