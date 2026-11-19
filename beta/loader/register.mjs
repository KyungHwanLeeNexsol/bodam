// `node --import ./beta/loader/register.mjs beta/server.ts` 로 쓴다. hooks.mjs 를 모듈 해석 훅으로 등록한다.
import { register } from 'node:module';

register('./hooks.mjs', import.meta.url);
