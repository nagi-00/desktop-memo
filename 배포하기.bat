@echo off
chcp 65001 > nul

:: ── 관리자 권한 확인 및 자동 상승 ──────────────────────────
net session >nul 2>&1
if %errorLevel% neq 0 (
  echo  관리자 권한으로 재실행합니다...
  powershell -Command "Start-Process '%~dpnx0' -Verb RunAs -WorkingDirectory '%~dp0'"
  exit
)

:: ── 작업 폴더를 bat 파일 위치로 고정 ───────────────────────
cd /d "%~dp0"

echo.
echo  ╔══════════════════════════════════════╗
echo  ║     nagi memo — 빌드 시작           ║
echo  ╚══════════════════════════════════════╝
echo.

:: 코드 서명 스킵 (개인용 앱 — 인증서 없음)
set WIN_CSC_LINK=
set CSC_LINK=
set CSC_KEY_PASSWORD=

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
