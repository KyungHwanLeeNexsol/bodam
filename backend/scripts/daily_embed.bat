@echo off
REM 매일 자동 실행되는 임베딩 배치 스크립트
REM Windows 작업 스케줄러에 등록하여 사용
REM
REM 등록 방법:
REM 1. Win+R > taskschd.msc
REM 2. "작업 만들기" 클릭
REM 3. 이름: "Bodam Daily Embed"
REM 4. 트리거: 매일 새벽 2:00 (Gemini 쿼터 리셋 후)
REM 5. 동작: 이 파일 경로 지정
REM 6. 조건: "컴퓨터가 유휴 상태일 때만 시작" 체크 해제

cd /d C:\Users\zuge3\Documents\workspace\bodam\backend
.venv\Scripts\python.exe scripts\daily_embed.py --max-chunks 2500

echo Done: %date% %time% >> logs\daily_embed_history.log
