import { randomBytes } from 'node:crypto';

// 초대 토큰 만들기: 32바이트 난수(256비트)를 base64url 43자로 출력한다. 서버의 BODAM_BETA_INVITE_TOKENS 에 넣고(쉼표로 여러 개),
// 같은 값을 초대 링크 https://<공개 주소>/beta/enter#t=<토큰> 으로 검토자에게 전한다. 토큰은 저장소·로그·보고서에 남기지 않는다.
process.stdout.write(`${randomBytes(32).toString('base64url')}\n`);
