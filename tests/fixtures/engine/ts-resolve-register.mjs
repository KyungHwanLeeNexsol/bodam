// `node --import <이 파일> child-run.ts` 로 쓴다. ts-resolve-hooks.mjs 를 모듈 해석 훅으로 등록한다.
import { register } from 'node:module';

register('./ts-resolve-hooks.mjs', import.meta.url);
