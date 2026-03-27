# 브랜치 머지 가이드

현재 작업 브랜치: `work`

## 1) 로컬에서 바로 머지
```bash
git checkout main
git pull origin main
git merge work
```

충돌이 없으면:
```bash
git push origin main
```

## 2) GitHub PR로 머지 (권장)
1. `work` 브랜치를 원격에 push
2. GitHub에서 `base: main`, `compare: work`로 PR 생성
3. 리뷰 후 **Squash and merge** 또는 **Merge pull request**
4. 머지 후 브랜치 정리

## 3) 충돌 날 때
```bash
git checkout main
git pull origin main
git merge work
# 충돌 파일 수정
git add .
git commit
git push origin main
```

## 4) 머지 완료 후 정리
```bash
git branch -d work
git push origin --delete work
```

## 빠른 확인 명령어
```bash
git branch --show-current
git log --oneline --decorate -n 5
git status
```
