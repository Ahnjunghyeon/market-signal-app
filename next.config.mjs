/** @type {import('next').NextConfig} */
const nextConfig = {
  // 개발용 좌측 하단 Next.js Issue/Route/Bundler 인디케이터를 숨깁니다.
  // 실제 사용자에게는 원래 프로덕션 배포에서 표시되지 않습니다.
  devIndicators: false,
  // 개발 중 PC의 네트워크 IP로 접속할 때 Next.js dev 리소스 차단 경고를 방지합니다.
  // 로컬에서만 쓰는 개발 설정이며, 배포에는 영향이 없습니다.
  allowedDevOrigins: [
    'localhost:3000',
    '127.0.0.1:3000',
    '172.16.121.222:3000',
    'http://172.16.121.222:3000'
  ]
};

export default nextConfig;
