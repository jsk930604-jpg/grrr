# GitHub Actions Setup (PC Off Automation)

이 프로젝트는 GitHub Actions로 평일 16:30(KST) 자동 실행됩니다.

## 1) GitHub에 코드 푸시
- 이 폴더를 GitHub 리포지토리에 푸시합니다.
- 워크플로 파일: `.github/workflows/daily-alert.yml`

## 2) Repository Secrets 등록
GitHub 리포지토리 > Settings > Secrets and variables > Actions > New repository secret

필수 시크릿:
- `KIS_APP_KEY`
- `KIS_APP_SECRET`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

## 3) Actions 활성화 확인
- Repository > Actions 탭에서 워크플로가 활성화되어 있는지 확인
- 필요 시 `Daily Swing Alert` 워크플로에서 수동 실행( Run workflow )로 테스트

## 4) 실행 시각
- 현재 스케줄: 평일 16:30 KST (UTC cron: `30 7 * * 1-5`)

## 참고
- PC가 꺼져 있어도 GitHub 서버에서 실행됩니다.
- 워크플로 실패 시 Actions 로그에서 원인을 확인할 수 있습니다.