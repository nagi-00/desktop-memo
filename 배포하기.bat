@echo off
chcp 65001 > nul
echo.
echo  ╔══════════════════════════════════════╗
echo  ║     nagi memo — 빌드 시작           ║
echo  ╚══════════════════════════════════════╝
echo.

:: Node.js 확인
where node >nul 2>&1
if %errorlevel% neq 0 (
  echo  [오류] Node.js가 설치되어 있지 않습니다.
  echo  https://nodejs.org 에서 설치 후 다시 실행하세요.
  pause
  exit /b 1
)

echo  [1/3] 패키지 설치 중...
call npm install
if %errorlevel% neq 0 ( echo  [오류] npm install 실패. & pause & exit /b 1 )

echo.
echo  [2/3] 아이콘 생성 중...
call node scripts/gen-icon.js
if %errorlevel% neq 0 ( echo  [오류] 아이콘 생성 실패. & pause & exit /b 1 )

echo.
echo  [3/3] Windows 설치 파일 빌드 중... (수 분 소요)
call npm run build:win
if %errorlevel% neq 0 ( echo  [오류] 빌드 실패. & pause & exit /b 1 )

echo.
echo  ╔══════════════════════════════════════╗
echo  ║  완료! dist\ 폴더를 확인하세요.     ║
echo  ╚══════════════════════════════════════╝
echo.
explorer dist
pause
