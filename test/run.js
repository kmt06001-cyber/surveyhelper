// 테스트: 샘플 설문으로 응답 생성 로직과 서버 함수를 확인 (네이버 통신은 가짜로 대체)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeSurvey, resolveSurveyId } from '../lib/naver.js';
import { buildResponses, tally, splitTexts } from '../generate.js';

const raw = JSON.parse(readFileSync(new URL('./sample-access.json', import.meta.url)));
const s = normalizeSurvey(raw, '1yc6xKl2kk7');
assert.equal(s.questions.length, 5);
assert.deepEqual(s.questions.map((q) => q.type), ['CHOICE', 'CHOICE', 'CHOICE', 'CHOICE', 'LONG_TEXT']);

// 1) 정상: 22명, 1학년 2반 전원, 음식 15/5/2, 음료 10/10/2, 주관식 3문장(선택 문항)
const inputs = {
  2: { counts: { 2: 22 } },
  3: { counts: { 9: 22 } },
  4: { counts: { 11: 15, 12: 5, 13: 2 } },
  5: { counts: { 14: 10, 15: 10, 16: 2 } },
  7: { text: '마라탕. 떡볶이.\n돈가스' },
};
const r = buildResponses(s, 22, inputs);
assert.deepEqual(r.errors, []);
assert.equal(r.responses.length, 22);
const t = tally(s, r.responses);
assert.deepEqual(t[4], { 11: 15, 12: 5, 13: 2 });
assert.deepEqual(t[5], { 14: 10, 15: 10, 16: 2 });
assert.equal(t[2][2], 22);
assert.equal(t[7].text, 3); // 선택 문항이라 나머지 19명은 빈칸
// 실제 제출 형식과 같은지 (HAR에서 본 형식)
const sample = r.responses.find((x) => x.length === 5);
assert.deepEqual(Object.keys(sample[0]), ['questionId', 'type', 'refId', 'value']);
assert.equal(sample[4].type, 'LONG_TEXT');
assert.equal(sample[4].refId, null);
const burger = r.responses.flat().find((x) => x.refId === 11);
assert.deepEqual(burger, { questionId: 4, type: 'CHOICE', refId: 11, value: '햄버거' });

// 2) 필수 문항 합계가 틀리면 오류
const bad = buildResponses(s, 22, { ...inputs, 4: { counts: { 11: 15, 12: 5 } } });
assert.equal(bad.errors.length, 1);
assert.match(bad.errors[0], /3번.*20명/);

// 3) 필수 주관식이면 남는 학생 "없음"
const s2 = structuredClone(s); s2.questions[4].required = true;
const r2 = buildResponses(s2, 22, inputs);
const vals = r2.responses.map((x) => x.find((i) => i.questionId === 7).value);
assert.equal(vals.filter((v) => v === '없음').length, 19);

// 4) 복수 선택: 필수, 모든 학생이 1개 이상
const s3 = structuredClone(s); s3.questions[2].multiSelect = true;
const r3 = buildResponses(s3, 22, { ...inputs, 4: { counts: { 11: 12, 12: 8, 13: 6 } } });
assert.deepEqual(r3.errors, []);
for (const resp of r3.responses) assert.ok(resp.some((i) => i.questionId === 4));
const r3b = buildResponses(s3, 22, { ...inputs, 4: { counts: { 11: 10, 12: 5 } } });
assert.equal(r3b.errors.length, 1);

// 5) 지원 안 하는 필수 문항은 막기
const s4 = structuredClone(s); s4.questions.push({ id: 9, title: '날짜', type: 'DATE', required: true, supported: false, items: [] });
assert.equal(buildResponses(s4, 22, inputs).errors.length, 1);

// 6) 주관식 문장이 학생 수보다 많으면 오류
assert.equal(buildResponses(s, 2, { ...inputs, 2: { counts: { 2: 2 } }, 3: { counts: { 9: 2 } }, 4: { counts: { 11: 2 } }, 5: { counts: { 14: 2 } } }).errors.length, 1);
assert.deepEqual(splitTexts(' a. b .\n\nc '), ['a', 'b', 'c']);

// 7) 링크 해석
assert.equal(await resolveSurveyId('https://form.naver.com/response/1yc6xKl2kk7'), '1yc6xKl2kk7');
assert.equal(await resolveSurveyId('https://form.naver.com/response/1yc6xKl2kk7?x=1'), '1yc6xKl2kk7');
assert.equal(await resolveSurveyId('1yc6xKl2kk7'), '1yc6xKl2kk7');
await assert.rejects(resolveSurveyId('https://evil.example.com/x'));

// 8) 서버 함수: 가짜 fetch로 naver.me 해석 → 문항 조회 → 제출 흐름 확인
const calls = [];
globalThis.fetch = async (url, opts = {}) => {
  calls.push({ url: String(url), method: opts.method || 'GET', body: opts.body, headers: opts.headers });
  const u = String(url);
  if (u.startsWith('https://naver.me/')) return new Response(null, { status: 302, headers: { location: 'https://form.naver.com/response/1yc6xKl2kk7' } });
  if (u.includes('/access')) return Response.json(raw);
  if (u.endsWith('/answers')) return Response.json({ result: 'ok' });
  return new Response('no', { status: 500 });
};
function mockRes() {
  return { code: 0, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
}
const { default: surveyApi } = await import('../api/survey.js');
const { default: submitApi } = await import('../api/submit.js');

let res = mockRes();
await surveyApi({ query: { url: 'https://naver.me/5B0i9hpC' }, headers: {} }, res);
assert.equal(res.code, 200);
assert.equal(res.body.id, '1yc6xKl2kk7');
assert.equal(res.body.questions.length, 5);

res = mockRes();
calls.length = 0;
await submitApi({ method: 'POST', headers: {}, body: { surveyId: '1yc6xKl2kk7', items: r.responses[0] } }, res);
assert.equal(res.code, 200);
const post = calls.find((c) => c.method === 'POST');
assert.equal(post.url, 'https://survey-api.naver.com/api/form/surveys/1yc6xKl2kk7/answers');
const sent = JSON.parse(post.body);
assert.equal(sent.taToken, '5oHxaYPJQw6q6PRzZOZA8A');
assert.equal(sent.extras, null);
assert.equal(post.headers.origin, 'https://form.naver.com');

// 잘못된 입력은 거절
res = mockRes();
await submitApi({ method: 'POST', headers: {}, body: { surveyId: '../x', items: [] } }, res);
assert.equal(res.code, 400);

// 접속 코드
process.env.ACCESS_CODE = 'abc';
res = mockRes();
await surveyApi({ query: { url: '1yc6xKl2kk7' }, headers: {} }, res);
assert.equal(res.code, 401);
res = mockRes();
await surveyApi({ query: { url: '1yc6xKl2kk7' }, headers: { 'x-access-code': 'abc' } }, res);
assert.equal(res.code, 200);

console.log('모든 테스트 통과');
