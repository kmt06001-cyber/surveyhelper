// 인원수 집계 → 학생 한 명씩의 응답지로 바꾸는 부분 (화면과 테스트에서 같이 씀)

export function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 주관식: 마침표(.)나 줄바꿈으로 나눈 한 문장 = 학생 한 명의 답
export function splitTexts(text) {
  return String(text || '')
    .split(/[.\n。]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const isText = (q) => q.type !== 'CHOICE';

/**
 * survey: normalizeSurvey 결과
 * n: 학생 수
 * inputs: { [questionId]: { counts: { [itemId]: 숫자 } } | { text: '...' } }
 * 반환: { errors: [문장], responses: [[items...] x n] }
 */
export function buildResponses(survey, n, inputs, rng = Math.random) {
  const errors = [];
  if (!Number.isInteger(n) || n < 1 || n > 100) {
    return { errors: ['학생 수는 1명에서 100명 사이로 넣어 주세요.'], responses: [] };
  }
  const perStudent = Array.from({ length: n }, () => []);

  survey.questions.forEach((q, idx) => {
    const label = `${idx + 1}번 "${q.title}"`;
    const input = inputs[q.id] || {};

    if (!q.supported) {
      if (q.required) errors.push(`${label}: 이 문항 형식(${q.type})은 아직 지원하지 않아서 제출할 수 없어요.`);
      return;
    }

    if (isText(q)) {
      const lines = splitTexts(input.text);
      if (lines.length > n) {
        errors.push(`${label}: 답변 문장이 ${lines.length}개로 학생 수(${n}명)보다 많아요.`);
        return;
      }
      for (let s = 0; s < n; s++) {
        const v = s < lines.length ? lines[s] : q.required ? '없음' : null;
        if (v != null) perStudent[s].push({ questionId: q.id, type: q.type, refId: null, value: v });
      }
      return;
    }

    // 객관식
    const counts = q.items.map((it) => {
      const c = Number(input.counts?.[it.id] || 0);
      return Number.isInteger(c) && c >= 0 ? c : NaN;
    });
    if (counts.some(Number.isNaN)) {
      errors.push(`${label}: 인원수는 0 이상의 정수로 넣어 주세요.`);
      return;
    }
    const total = counts.reduce((a, b) => a + b, 0);

    if (!q.multiSelect) {
      if (q.required && total !== n) {
        errors.push(`${label}: 합계가 ${total}명이에요. 필수 문항이라 정확히 ${n}명이어야 해요.`);
        return;
      }
      if (total > n) {
        errors.push(`${label}: 합계가 ${total}명으로 학생 수(${n}명)보다 많아요.`);
        return;
      }
      let pool = [];
      q.items.forEach((it, i) => {
        for (let k = 0; k < counts[i]; k++) pool.push(it);
      });
      while (pool.length < n) pool.push(null);
      pool = shuffle(pool, rng);
      pool.forEach((it, s) => {
        if (it) perStudent[s].push({ questionId: q.id, type: 'CHOICE', refId: it.id, value: it.value });
      });
      return;
    }

    // 복수 선택
    if (counts.some((c) => c > n)) {
      errors.push(`${label}: 한 선택지의 인원이 학생 수(${n}명)보다 많아요.`);
      return;
    }
    if (q.required && total < n) {
      errors.push(`${label}: 필수 문항이라 학생마다 하나 이상 골라야 해요. 선택지 인원을 모두 더해 ${n}명 이상이 되게 해 주세요.`);
      return;
    }
    const picks = Array.from({ length: n }, () => []);
    q.items.forEach((it, i) => {
      // 아직 덜 고른 학생부터 배정해서 빈 학생이 없게 함
      const order = shuffle([...Array(n).keys()], rng).sort((a, b) => picks[a].length - picks[b].length);
      order.slice(0, counts[i]).forEach((s) => picks[s].push(it));
    });
    picks.forEach((list, s) =>
      list.forEach((it) => perStudent[s].push({ questionId: q.id, type: 'CHOICE', refId: it.id, value: it.value }))
    );
  });

  if (errors.length) return { errors, responses: [] };
  if (perStudent.some((r) => r.length === 0)) {
    return { errors: ['아무 문항에도 답하지 않은 응답이 생겨요. 인원수를 확인해 주세요.'], responses: [] };
  }
  return { errors: [], responses: perStudent };
}

// 미리보기용: 만든 응답지를 다시 문항별 인원으로 세기
export function tally(survey, responses) {
  const out = {};
  for (const q of survey.questions) out[q.id] = {};
  for (const r of responses) {
    for (const it of r) {
      const key = it.refId == null ? 'text' : it.refId;
      out[it.questionId][key] = (out[it.questionId][key] || 0) + 1;
    }
  }
  return out;
}
