// Writing an answer, one word-piece at a time. The model is passed in as `step`
// (give it some tokens, get back the scores for the next one), so this runs the
// same against the real model or a fake.
(function initDashboardAskGenerate(global) {
  const dash = global.D2LDashboard ||= {};

  // The model's recommended settings. Low temperature keeps answers steady; the
  // penalty stops it repeating itself.
  const SAMPLING = Object.freeze({ temperature: 0.1, topK: 50, repetitionPenalty: 1.1, penaltyWindow: 64 });

  // Picks the next token from the scores (one per token in the vocabulary).
  // recent holds the latest tokens, which are slightly discouraged. The scores are
  // handed back exactly as they came.
  function sampleToken(scores, recent = [], options = {}, random = Math.random) {
    const { temperature, topK, repetitionPenalty } = { ...SAMPLING, ...options };
    const restore = [];
    for (const id of new Set(recent)) {
      const score = scores[id];
      if (score === undefined) continue;
      restore.push([id, score]);
      scores[id] = score > 0 ? score / repetitionPenalty : score * repetitionPenalty;
    }
    const ids = [];
    const values = [];
    let floor = -Infinity;
    for (let id = 0; id < scores.length; id += 1) {
      const score = scores[id];
      if (!(score > floor)) continue;
      let at = values.length;
      while (at > 0 && values[at - 1] < score) at -= 1;
      ids.splice(at, 0, id);
      values.splice(at, 0, score);
      if (ids.length > topK) { ids.pop(); values.pop(); }
      if (ids.length >= topK) floor = values[values.length - 1];
    }
    for (const [id, score] of restore) scores[id] = score;
    if (!ids.length) return 0;
    if (temperature <= 0) return ids[0];
    const weights = values.map((value) => Math.exp((value - values[0]) / temperature));
    let pick = random() * weights.reduce((sum, weight) => sum + weight, 0);
    for (let i = 0; i < ids.length; i += 1) {
      pick -= weights[i];
      if (pick <= 0) return ids[i];
    }
    return ids[0];
  }

  // Reads the prompt (in chunks the model can take), then adds tokens until it
  // writes a stop token or reaches maxNewTokens. Aborting stops between tokens.
  // onToken(tokens) hears each new token. fed counts the written tokens the model
  // has read back: all of them, except the last one when the limit cut it off.
  // banIds are tokens it may not write: the next best is taken instead.
  async function generate({ step, ids, chunk = 256, maxNewTokens = 500, stopIds = [], banIds = [], sampling, signal, random, onToken }) {
    const options = { ...SAMPLING, ...sampling };
    const recent = ids.slice(-options.penaltyWindow);
    const tokens = [];
    let scores;
    const readStart = Date.now();
    for (let at = 0; at < ids.length; at += chunk) {
      signal?.throwIfAborted?.();
      scores = await step(ids.slice(at, at + chunk));
    }
    const readMs = Date.now() - readStart;
    const writeStart = Date.now();
    let stopped = false;
    let fed = 0;
    while (tokens.length < maxNewTokens) {
      for (const id of banIds) scores[id] = -Infinity;
      const next = sampleToken(scores, recent, options, random);
      if (stopIds.includes(next)) { stopped = true; break; }
      tokens.push(next);
      onToken?.(tokens);
      recent.push(next);
      if (recent.length > options.penaltyWindow) recent.shift();
      if (tokens.length >= maxNewTokens) break;
      signal?.throwIfAborted?.();
      scores = await step([next]);
      fed += 1;
    }
    const writeMs = Date.now() - writeStart;
    return { tokens, stopped, fed, readMs, writeMs, tokensPerSecond: tokens.length > 1 && writeMs > 0 ? (tokens.length - 1) / (writeMs / 1000) : 0 };
  }

  Object.assign(dash, { sampleToken, askGenerate: generate, ASK_SAMPLING: SAMPLING });
})(globalThis);
