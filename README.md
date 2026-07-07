# 익명 타이머 채팅

Express, Socket.IO 기반의 익명 채팅 사이트입니다.

## 기능

- 입장 시 랜덤 이름과 아바타 생성
- 텍스트 메시지 전송
- PNG, JPG, GIF, WebP 사진 전송
- 메시지별 표시 시간 선택: 5초, 10초, 20초, 1분, 2분
- 시간이 지나면 모든 사용자 화면에서 메시지 삭제

## 로컬 실행

```bash
npm install
npm run dev
```

브라우저에서 `http://localhost:3000`으로 접속하세요.

## Render 배포

1. GitHub에 이 프로젝트를 올립니다.
2. Render에서 `New Web Service`를 선택합니다.
3. Build Command는 `npm install`, Start Command는 `npm start`로 설정합니다.
4. 또는 `render.yaml`을 사용해 Blueprint로 배포할 수 있습니다.
5. Render 배포 후 생성된 URL을 `public/config.js`에 입력합니다.

예시:

```js
window.CHAT_SERVER_URL = "https://your-render-app.onrender.com";
```

그 다음 Netlify에 다시 배포하세요.

```bash
netlify deploy --prod --dir=public
```

## Netlify 활용

이 프로젝트는 Socket.IO 서버가 필요하므로 전체 앱은 Render 같은 Node 서버 환경에 배포하는 것이 가장 간단합니다.

Netlify를 함께 쓰려면 Netlify에는 `public` 폴더만 정적 배포하고, Socket.IO 서버는 Render에 배포한 뒤 `public/config.js`의 서버 주소를 Render URL로 바꾸면 됩니다.

예시:

```js
window.CHAT_SERVER_URL = "https://your-render-app.onrender.com";
```

이 경우 Render의 `CLIENT_ORIGINS` 환경변수에 Netlify 사이트 주소를 넣는 것을 권장합니다. 여러 주소는 쉼표로 구분하세요.

현재 생성된 Netlify 사이트:

```text
https://anonymous-timer-chat-20260707.netlify.app
```
