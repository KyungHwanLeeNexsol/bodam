import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { extractModuleRefs, readSourceFiles, tokenize } from '../../boundary/source-scan';

// AC-021d 의 키오스크 쪽 증거 (S4, M7 에서 src/ 전체로 닫는다): 키오스크 소스의 가져오기 그래프에 생성형 AI·모델 SDK 와 바깥 네트워크 라이브러리가 없고,
// 의존성 목록에도 없다. 바깥으로 나가는 호출은 deps.ts 의 fetch 한 곳뿐이고(kiosk-tree.test.ts), 브라우저에서 실제로 나간 요청은 병원 API 세 종류뿐임을
// tests/e2e/kiosk/exposure.*.spec.ts 가 본다. 이 시험은 "패키지 이름" 층을 닫는다.

const REPO = fileURLToPath(new URL('../../..', import.meta.url));
const AI_OR_NETWORK_PACKAGE = /openai|anthropic|@ai-sdk|langchain|llamaindex|generative-ai|gemini|cohere|mistral|ollama|huggingface|transformers|replicate|axios|node-fetch|got$|superagent|socket\.io|ws$|sentry|datadog|segment|mixpanel|amplitude|posthog|gtag|analytics/i;

/** 소스 텍스트에서 상대 경로가 아닌 모듈 이름들. */
function externalSpecifiers(text: string): string[] {
  return extractModuleRefs(tokenize(text))
    .map((ref) => ref.specifier)
    .filter((specifier): specifier is string => specifier !== null && !specifier.startsWith('.'));
}

describe('검사기 대조군', () => {
  it('생성형 AI SDK 나 분석 도구를 가져오는 소스는 걸린다', () => {
    expect(externalSpecifiers("import OpenAI from 'openai';\nimport { track } from 'mixpanel-browser';")).toEqual(['openai', 'mixpanel-browser']);
    expect(externalSpecifiers("import OpenAI from 'openai';").filter((name) => AI_OR_NETWORK_PACKAGE.test(name))).toEqual(['openai']);
    expect(externalSpecifiers("import { useState } from 'react';\nimport { a } from './a';")).toEqual(['react']);
  });
});

describe('실제 키오스크 소스와 의존성', () => {
  const files = [...readSourceFiles(join(REPO, 'src/app/kiosk'), 'src/app/kiosk'), ...readSourceFiles(join(REPO, 'src/app'), 'src/app').filter((file) => file.path === 'src/app/layout.tsx')];

  it('가져오는 바깥 모듈은 react 와 next 뿐이다 (다른 패키지·바깥 SDK 가 없다)', () => {
    expect(files.length).toBeGreaterThan(50);
    const found = new Set<string>();
    for (const file of files) for (const specifier of externalSpecifiers(file.text)) found.add(specifier);
    expect([...found].sort()).toEqual(['next', 'react']);
  });

  it('의존성 목록(dependencies·devDependencies)에 생성형 AI·바깥 네트워크·분석 패키지가 없다', () => {
    const manifest = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const names = [...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.devDependencies ?? {})];
    expect(names.length).toBeGreaterThan(5);
    expect(names.filter((name) => AI_OR_NETWORK_PACKAGE.test(name))).toEqual([]);
    // 운영 의존성은 이 다섯뿐이다 (글꼴 패키지는 CSS 가 파일로 가리킨다).
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual(['next', 'pretendard', 'react', 'react-dom']);
  });

  it('글꼴 CSS 는 외부 주소를 쓰지 않는다 (같은 출처의 npm 패키지 파일만 가리킨다)', () => {
    const css = readFileSync(join(REPO, 'src/app/kiosk/styles/fonts.css'), 'utf8');
    const urls = [...css.matchAll(/url\(['"]?([^'")]+)['"]?\)/g)].map((match) => match[1] ?? '');
    expect(urls.length).toBe(2);
    for (const url of urls) expect(url, url).not.toMatch(/^(https?:)?\/\//);
  });
});
