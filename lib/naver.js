// 네이버 폼과 통신하는 부분 (서버에서만 실행)
// 네이버 폼 화면(form.naver.com)이 브라우저에서 하는 요청을 그대로 따라 합니다.

const API = 'https://survey-api.naver.com/api/form/surveys';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

export const ID_RE = /^[A-Za-z0-9_-]{5,40}$/;

function headers(id, extra = {}) {
  return {
    accept: 'application/json, text/plain, */*',
    'accept-language': 'ko-KR,ko;q=0.9',
    origin: 'https://form.naver.com',
    referer: `https://form.naver.com/response/${id}`,
    'user-agent': UA,
    ...extra,
  };
}

export class UserError extends Error {}

// 붙여 넣은 링크에서 설문 고유번호를 찾습니다.
// 지원: https://form.naver.com/response/XXXX, https://naver.me/XXXX, 고유번호만
export async function resolveSurveyId(input) {
  const text = String(input || '').trim();
  let m = text.match(/form\.naver\.com\/response\/([A-Za-z0-9_-]+)/);
  if (m) return m[1];

  m = text.match(/^(?:https?:\/\/)?naver\.me\/([A-Za-z0-9]+)\/?$/);
  if (m) {
    let url = `https://naver.me/${m[1]}`;
    for (let i = 0; i < 5; i++) {
      const r = await fetch(url, { redirect: 'manual', headers: { 'user-agent': UA } });
      const loc = r.headers.get('location');
      if (!loc) break;
      url = new URL(loc, url).href;
      const mm = url.match(/form\.naver\.com\/response\/([A-Za-z0-9_-]+)/);
      if (mm) return mm[1];
    }
    throw new UserError('이 naver.me 링크가 네이버 폼으로 연결되지 않아요. 링크를 다시 확인해 주세요.');
  }

  if (ID_RE.test(text)) return text;
  throw new UserError('네이버 폼 링크를 알아볼 수 없어요. 설문 링크를 그대로 붙여 넣어 주세요.');
}

// 설문 정보(문항, 선택지, taToken)를 받아 옵니다.
export async function fetchSurvey(id, ignoreCount = true) {
  if (!ID_RE.test(id)) throw new UserError('설문 고유번호 형식이 올바르지 않아요.');
  const r = await fetch(`${API}/${id}/access?ignoreCount=${ignoreCount}`, { headers: headers(id) });
  if (r.status === 404) throw new UserError('설문을 찾을 수 없어요. 삭제됐거나 링크가 잘못됐을 수 있어요.');
  if (!r.ok) throw new UserError(`네이버 폼이 설문 정보를 주지 않았어요 (상태 코드 ${r.status}). 설문이 마감됐거나 로그인이 필요한 설문일 수 있어요.`);
  return r.json();
}

// 브라우저처럼 네이버가 준 쿠키를 기억했다가 다음 요청에 돌려줍니다.
class CookieJar {
  constructor() { this.map = new Map(); }
  take(res) {
    const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    for (const c of list) {
      const pair = c.split(';')[0];
      const eq = pair.indexOf('=');
      if (eq > 0) this.map.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }
  header() { return [...this.map].map(([k, v]) => `${k}=${v}`).join('; '); }
}

async function call(jar, url, opts, id, extra = {}) {
  const cookie = jar.header();
  const r = await fetch(url, { ...opts, headers: headers(id, { ...(cookie ? { cookie } : {}), ...extra }) });
  jar.take(r);
  return r;
}

// 응답 1건 제출: 실제 화면과 같은 순서로 (설문 열기 → 제출 가능 확인 → 제출)
export async function submitOne(id, items) {
  const jar = new CookieJar();
  const steps = [];

  const a = await call(jar, `${API}/${id}/access?ignoreCount=false`, {}, id);
  steps.push(`설문 열기 ${a.status}`);
  if (!a.ok) throw new UserError(`설문을 여는 단계에서 막혔어요 (상태 코드 ${a.status}).`);
  const survey = await a.json();
  if (!survey.taToken) throw new UserError('제출에 필요한 값(taToken)을 받지 못했어요. 네이버 폼 방식이 바뀌었을 수 있어요.');

  const st = await call(jar, `${API}/${id}/answers/status`, {}, id);
  const stBody = await st.text();
  steps.push(`제출 가능 확인 ${st.status} ${stBody.slice(0, 120)}`);

  const r = await call(jar, `${API}/${id}/answers`, {
    method: 'POST',
    body: JSON.stringify({ items, taToken: survey.taToken, extras: null }),
  }, id, { 'content-type': 'application/json' });
  const body = await r.text();
  steps.push(`제출 ${r.status} ${body.slice(0, 300)}`);
  steps.push(`쿠키 ${jar.map.size}개`);

  if (!r.ok) {
    const err = new UserError(`네이버 폼이 응답을 받지 않았어요 (상태 코드 ${r.status}). ${body.slice(0, 200)}`);
    err.steps = steps;
    throw err;
  }
  // 상태 코드는 200이어도 내용에 오류가 담겨 오는 경우 잡기
  try {
    const j = JSON.parse(body);
    if (j && (j.error || j.errorCode || (j.code && !/^(0|200|SUCCESS|OK)$/i.test(String(j.code))))) {
      const err = new UserError(`네이버 폼이 오류를 알려 왔어요: ${body.slice(0, 200)}`);
      err.steps = steps;
      throw err;
    }
  } catch (e) {
    if (e instanceof UserError) throw e;
  }
  return { steps, body };
}

// 화면에 필요한 정보만 골라서 정리합니다.
export const SUPPORTED = ['CHOICE', 'LONG_TEXT', 'SHORT_TEXT', 'TEXT'];

export function normalizeSurvey(raw, id) {
  const questions = [];
  let branching = false;
  for (const page of raw.pages || []) {
    for (const q of page.questions || []) {
      const items = (q.items || []).map((it) => ({ id: it.id, value: it.value }));
      if ((q.items || []).some((it) => it.skipOffset != null)) branching = true;
      questions.push({
        id: q.id,
        title: q.title || '(제목 없음)',
        type: q.type,
        required: !!q.options?.required,
        multiSelect: !!q.options?.multiSelect,
        supported: SUPPORTED.includes(q.type),
        items,
      });
    }
  }
  return {
    id,
    title: raw.title || '(제목 없는 설문)',
    status: raw.status,
    allowMultipleResponses: raw.options?.allowMultipleResponses !== false,
    restricted: raw.restricted != null,
    pageCount: (raw.pages || []).length,
    branching,
    questions,
  };
}

// 접속 코드 확인 (Vercel 환경 변수 ACCESS_CODE를 정한 경우에만)
export function checkAccess(req) {
  const code = process.env.ACCESS_CODE;
  if (!code) return true;
  return req.headers['x-access-code'] === code;
}
