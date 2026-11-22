// POST /api/open { surveyId } → 설문 열기 (taToken, 쿠키 받기)
import { openSession, checkAccess, ID_RE, UserError } from '../lib/naver.js';

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 받아요.' });
  if (!checkAccess(req)) return res.status(401).json({ error: '접속 코드가 맞지 않아요.', needCode: true });
  const { surveyId } = req.body || {};
  if (!ID_RE.test(String(surveyId || ''))) return res.status(400).json({ error: '설문 고유번호 형식이 올바르지 않아요.' });
  try {
    const o = await openSession(surveyId);
    return res.status(200).json({ ok: true, ...o });
  } catch (e) {
    const msg = e instanceof UserError ? e.message : '설문을 여는 중에 문제가 생겼어요.';
    if (!(e instanceof UserError)) console.error(e.message);
    return res.status(502).json({ ok: false, error: msg });
  }
}
