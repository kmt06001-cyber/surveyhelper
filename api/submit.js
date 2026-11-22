// POST /api/submit  { surveyId, items }  → 응답 1건 제출
// 화면에서 학생 수만큼 한 건씩 차례로 부릅니다.
import { submitOne, checkAccess, ID_RE, UserError } from '../lib/naver.js';

function validItems(items) {
  if (!Array.isArray(items) || items.length === 0 || items.length > 200) return false;
  return items.every(
    (it) =>
      it &&
      Number.isInteger(it.questionId) &&
      typeof it.type === 'string' &&
      it.type.length < 30 &&
      (it.refId === null || Number.isInteger(it.refId)) &&
      typeof it.value === 'string' &&
      it.value.length <= 2000
  );
}

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 받아요.' });
  if (!checkAccess(req)) return res.status(401).json({ error: '접속 코드가 맞지 않아요.', needCode: true });

  const { surveyId, items } = req.body || {};
  if (!ID_RE.test(String(surveyId || '')) || !validItems(items)) {
    return res.status(400).json({ error: '보낼 응답 형식이 올바르지 않아요.' });
  }
  // 학생 정보 보호: 응답 내용은 저장하거나 기록하지 않습니다.
  const clean = items.map(({ questionId, type, refId, value }) => ({ questionId, type, refId, value }));
  try {
    const { steps } = await submitOne(surveyId, clean);
    return res.status(200).json({ ok: true, steps });
  } catch (e) {
    const msg = e instanceof UserError ? e.message : '제출하다 문제가 생겼어요.';
    if (!(e instanceof UserError)) console.error(e.message);
    return res.status(502).json({ ok: false, error: msg, steps: e.steps || [] });
  }
}
