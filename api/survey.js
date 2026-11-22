// GET /api/survey?url=설문링크  → 문항 목록
import { resolveSurveyId, fetchSurvey, normalizeSurvey, checkAccess, UserError } from '../lib/naver.js';

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  if (!checkAccess(req)) return res.status(401).json({ error: '접속 코드가 맞지 않아요.', needCode: true });
  try {
    const id = await resolveSurveyId(req.query.url);
    const raw = await fetchSurvey(id, true);
    return res.status(200).json(normalizeSurvey(raw, id));
  } catch (e) {
    const msg = e instanceof UserError ? e.message : '설문을 불러오다 문제가 생겼어요. 잠시 후 다시 해 주세요.';
    if (!(e instanceof UserError)) console.error(e);
    return res.status(400).json({ error: msg });
  }
}
