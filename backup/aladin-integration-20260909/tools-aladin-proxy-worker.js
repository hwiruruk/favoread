/**
 * Aladin OpenAPI proxy — Cloudflare Worker
 *
 * Why: Aladin TTB OpenAPI restricts calls based on the Referer matching the
 * URL registered with the TTBKey. When the editor is hosted at favorbook.co.kr
 * (or run locally), Referer doesn't match the registered blog URL → 403
 * "Host not in allowlist". This Worker calls Aladin server-side with a spoofed
 * Referer that matches the registered URL, and returns the response with CORS
 * headers so the static editor can read it.
 *
 * Deploy:
 *   1. https://dash.cloudflare.com → Workers & Pages → Create → Worker
 *   2. Paste this file → Save and Deploy
 *   3. Settings → Variables → set
 *        ALADIN_REFERER  = https://blog.naver.com/<your-blog-id>   (the URL registered with the TTBKey)
 *        ALLOWED_ORIGIN  = https://favorbook.co.kr                  (comma-separated; include http://localhost:8765 for dev)
 *   4. Custom Domain (optional): bind to https://favorbook.co.kr/api/aladin/
 *      OR use the *.workers.dev URL Cloudflare gives you.
 *   5. In editor ⚙️ settings → CORS 프록시:
 *        https://<your-worker>.workers.dev/?url=
 *      (the trailing ?url= matters)
 *
 * Security: Origin allowlist + URL allowlist (only aladin.co.kr) prevent the
 * Worker being used as an open proxy. The TTBKey itself stays in the editor's
 * localStorage (NOT in this Worker) so anyone calling the Worker still needs
 * to provide their own ttbkey.
 */

const ALADIN_HOST = 'www.aladin.co.kr';
const ALADIN_PATH_PREFIX = '/ttb/api/';

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(request, env) });
    }

    const reqUrl = new URL(request.url);
    const target = reqUrl.searchParams.get('url');
    if (!target) {
      return json({ error: 'missing ?url= param' }, 400, request, env);
    }

    let upstream;
    try {
      upstream = new URL(target);
    } catch {
      return json({ error: 'invalid url' }, 400, request, env);
    }

    if (upstream.host !== ALADIN_HOST || !upstream.pathname.startsWith(ALADIN_PATH_PREFIX)) {
      return json({ error: 'only ' + ALADIN_HOST + ALADIN_PATH_PREFIX + '* is allowed' }, 400, request, env);
    }

    // Drop any callback param the editor adds — we want raw JSON to forward
    upstream.searchParams.delete('callback');
    upstream.searchParams.delete('Callback');

    const referer = (env && env.ALADIN_REFERER) || 'https://blog.naver.com/';
    const fetchInit = {
      method: 'GET',
      headers: {
        'Referer': referer,
        'User-Agent': 'Mozilla/5.0 (Aladin Proxy Worker)',
        'Accept': '*/*',
      },
      // No body forwarding; Aladin TTB OpenAPI is GET-only
    };

    let res;
    try {
      res = await fetch(upstream.toString(), fetchInit);
    } catch (e) {
      return json({ error: 'upstream fetch failed', detail: String(e) }, 502, request, env);
    }

    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: {
        ...corsHeaders(request, env),
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    });
  },
};

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowList = ((env && env.ALLOWED_ORIGIN) || 'https://favorbook.co.kr,http://localhost:8765')
    .split(',').map(s => s.trim()).filter(Boolean);
  const allow = allowList.includes(origin) ? origin : allowList[0];
  return {
    'access-control-allow-origin': allow,
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-allow-headers': 'Content-Type',
    'vary': 'Origin',
  };
}

function json(obj, status, request, env) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      ...corsHeaders(request, env),
      'content-type': 'application/json; charset=utf-8',
    },
  });
}
