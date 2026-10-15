# ResearchBasedApp

**MoveKit**은 논문에서 사용한 SHA-256 비교 절차를 실제 ZIP 전송 흐름에 적용한 웹 앱입니다.

> 「모바일 애플리케이션 보안 분석 보고서 — Unity 기반 Android 게임의 로컬 데이터 보호 및 기기 간 이식 가능성 분석」에서 확인한 데이터 이식 전후 해시 비교 방법을 사용해, 기기 간 백업을 옮기는 사용자가 전송 전후 ZIP 파일의 바이트 동일성을 확인하도록 돕습니다.

## 앱 사용

배포된 앱: <https://move-kit-data-transfer.db-1270.chatgpt.site>

1. 보내는 기기에서 ZIP을 선택하고 8자 이상의 암호를 설정합니다.
2. 발급된 전송 코드와 암호를 받는 기기에 전달합니다.
3. 받는 기기에서 코드와 암호를 입력하고 SHA-256 일치 결과를 확인한 뒤 ZIP을 저장합니다.

## 논문 결과의 적용

논문에서 S22+와 Tab S6 Lite의 자료를 비교하고 SHA-256을 사용한 분석 절차를, 사용자가 고른 ZIP의 전송 전후 바이트 동일성 확인에 적용했습니다. 앱은 일치하는 경우에만 다운로드를 허용합니다. SHA-256 비교는 파일의 전송 전후 동일성을 확인할 뿐, 파일의 악성 여부나 데이터의 안전성을 판단하지 않습니다. 앱은 Android의 보호된 앱 데이터 영역에 접근하거나 권한 제한을 우회하지 않습니다.

## 데이터 처리

- 브라우저에서 ZIP을 AES-GCM으로 암호화한 뒤 암호문만 서버에 전송합니다.
- 암호는 브라우저 안에서만 사용합니다. 서버로 보내지 않습니다.
- 전송 코드는 파일을 찾기 위한 식별자이며 복호화 암호를 대신하지 않습니다.
- 코드는 발급 후 30분이 지나면 사용할 수 없습니다. 만료 후 파일 접근이 차단되며, 저장소의 물리 삭제는 후속 정리 작업에서 반영됩니다.
- ZIP 최대 크기는 20 MiB입니다.
- 실 개인정보, 인증정보, 비밀키가 든 파일은 업로드하지 마십시오.

## 프로젝트 구성

- `app/index.html`: 브라우저 화면과 클라이언트 측 암호화·해시 비교
- `worker/index.js`: 업로드·다운로드 API 및 임시 저장소 처리
- `scripts/build.sh`: HTML을 Worker 모듈에 포함해 빌드
- `scripts/test-worker.mjs`: Worker API의 로컬 검증
- `확인방법.md`: 사용자 흐름 확인 절차
- `AI_와_나의_판단_3줄.md`: AI 협업과 직접 판단 내역

## 로컬 빌드 및 검증

필요 환경: Python 3, Node.js 18 이상.

```bash
bash scripts/build.sh
node --check dist/server/index.js
node scripts/validate-artifact.mjs
node scripts/test-worker.mjs
```

검증은 메모리 기반 임시 저장소를 사용하며 실제 파일이나 개인정보를 전송하지 않습니다. 정적 파일 서버만으로는 전송 API가 작동하지 않습니다.

## Cloudflare Worker 배포 구성 예시

Worker 배포에는 Cloudflare R2 버킷 바인딩 `BUCKET`이 필요합니다. Cloudflare 계정과 R2 버킷은 사용자가 별도로 준비해야 합니다.

1. `wrangler.toml.example`을 `wrangler.toml`로 복사합니다.
2. `bucket_name`을 실제 R2 버킷명으로 바꿉니다.
3. Wrangler 인증을 완료하고 다음 명령을 실행합니다.

```bash
npx wrangler deploy
```

앱에는 계정 토큰, API 키, 비밀번호를 저장하지 않습니다. `wrangler.toml.example`의 버킷명은 안내용 자리표시자이며 배포 전 실제 버킷명으로 교체해야 합니다.
