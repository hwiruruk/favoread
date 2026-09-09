/**
 * favorbook 알라딘 프록시 — Cloudflare Worker
 *
 * 공개 CORS 프록시(allorigins, corsproxy.io 등)가 자주 죽어서
 * 자체 Cloudflare Worker로 안정적인 알라딘 API 프록시를 운영합니다.
 *
 * ────────────────────────────────────────────────────────
 * 배포 방법 (10분, 무료):
 *
 * 1. https://dash.cloudflare.com 가입 (무료)
 * 2. 좌측 메뉴 "Workers & Pages" → "Create" → "Create Worker"
 * 3. 이름 입력 (예: aladin-proxy) → "Deploy"
 * 4. "Edit code" 클릭 → 기존 코드 전체 삭제 → 이 파일 내용 붙여넣기 → "Deploy"
 * 5. 생성된 URL 복사 (예: https://aladin-proxy.your-name.workers.dev)
 *
 * 사용 방법:
 * - 에디터 좌측 ⚙️ 설정 → "Cors Proxy" 칸에 입력:
 *     https://aladin-proxy.your-name.workers.dev/?url=
 * - 저장 후 알라딘 검색 사용
 *
 * 무료 한도: Cloudflare Workers 무료 플랜은 일 10만 요청 (충분)
 * ────────────────────────────────────────────────────────
 */

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    const target = url.searchParams.get('url');
    if (!target) {
      return new Response('Missing ?url= parameter', {
        status: 400,
        headers: corsHeaders(),
      });
    }

    // 알라딘 도메인만 허용 (오남용 방지)
    if (!/^https?:\/\/(www\.)?aladin\.co\.kr\//.test(target)) {
      return new Response('Only aladin.co.kr URLs are allowed', {
        status: 403,
        headers: corsHeaders(),
      });
    }

    try {
      // 알라딘 TTBKey는 등록한 사이트의 Referer를 검사하므로
      // favorbook.co.kr Referer를 보내서 통과시킴
      const upstream = await fetch(target, {
        headers: {
          'Referer': 'https://favorbook.co.kr/',
          'User-Agent': 'Mozilla/5.0 (favorbook-proxy)',
        },
      });

      const body = await upstream.text();
      return new Response(body, {
        status: upstream.status,
        headers: {
          ...corsHeaders(),
          'Content-Type': upstream.headers.get('Content-Type') || 'text/plain; charset=utf-8',
          'Cache-Control': 'public, max-age=3600',
        },
      });
    } catch (e) {
      return new Response(`Upstream fetch failed: ${e.message}`, {
        status: 502,
        headers: corsHeaders(),
      });
    }
  },
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': '*',
  };
}
