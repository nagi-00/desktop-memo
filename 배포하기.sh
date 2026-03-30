#!/usr/bin/env bash
set -e

echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║     nagi memo — 빌드 시작           ║"
echo "  ╚══════════════════════════════════════╝"
echo ""

# Node.js 확인
if ! command -v node &>/dev/null; then
  echo "  [오류] Node.js가 설치되어 있지 않습니다."
  echo "  https://nodejs.org 에서 설치 후 다시 실행하세요."
  exit 1
fi

echo "  [1/3] 패키지 설치 중..."
npm install

echo ""
echo "  [2/3] 아이콘 생성 중..."
node scripts/gen-icon.js

echo ""
echo "  [3/3] AppImage 빌드 중... (수 분 소요)"
npm run build:linux

echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║  완료! dist/ 폴더를 확인하세요.     ║"
echo "  ╚══════════════════════════════════════╝"
echo ""
