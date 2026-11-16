// The listening model (Parakeet-Realtime-EOU-120M, int8) one 160 ms piece at a time. Each run takes
// 2560 samples (16 kHz, mono, floats from -1 to 1) plus the memory the model keeps between pieces,
// and returns the word pieces it heard and whether it heard the speaker finish ("end of utterance").
// When it hears the end it writes fresh memory into its outputs, so carrying the outputs forward is also
// how it starts over. This runs in a worker (listen-worker.js); `ort` is onnxruntime-web, passed in.
(function initVoiceEouEngine(global) {
  const dash = global.D2LDashboard ||= {};

  const PIECE = 2560, BLANK = 1026, END_OF_UTTERANCE = 1024, END_OF_BREAK = 1025;
  const LOG_MEL_ZERO = Math.log(Math.fround(2 ** -24));

  function createEouEngine({ ort, session, vocabText }) {
    const vocab = String(vocabText).split("\n");
    if (vocab.at(-1) === "") vocab.pop();
    const fresh = () => ({
      audio_cache: new ort.Tensor("float32", new Float32Array(160), [160]),
      mel_cache: new ort.Tensor("float32", new Float32Array(128 * 9).fill(LOG_MEL_ZERO), [1, 128, 9]),
      cache_last_channel: new ort.Tensor("float32", new Float32Array(17 * 70 * 512), [1, 17, 70, 512]),
      cache_last_time: new ort.Tensor("float32", new Float32Array(17 * 512 * 8), [1, 17, 512, 8]),
      cache_last_channel_len: new ort.Tensor("int64", new BigInt64Array([0n]), [1]),
      pred_h: new ort.Tensor("float32", new Float32Array(640), [1, 640]),
      pred_c: new ort.Tensor("float32", new Float32Array(640), [1, 640]),
      last_token: new ort.Tensor("int64", new BigInt64Array([BigInt(BLANK)]), [1])
    });
    let memory = fresh();

    async function run(audio) {
      if (audio.length !== PIECE) throw new Error(`The listener takes ${PIECE} samples at a time, not ${audio.length}.`);
      const out = await session.run({ ...memory, audio: new ort.Tensor("float32", audio, [PIECE]) });
      for (const name of Object.keys(memory)) memory[name] = out[`${name}_out`];
      const words = [];
      let ended = false;
      const count = Number(out.num_tokens.data[0]);
      for (let i = 0; i < count; i += 1) {
        const token = Number(out.tokens.data[i]);
        if (token === END_OF_UTTERANCE || token === END_OF_BREAK) ended = true;
        else if (vocab[token] !== undefined) words.push(vocab[token]);
      }
      return { words, ended };
    }

    // Forget what was heard before: the next piece starts a new utterance.
    function reset() { memory = fresh(); }

    // The first run is slow (the runtime sets itself up), so do it before anyone is speaking.
    async function warm() { await run(new Float32Array(PIECE)); reset(); }

    return { run, reset, warm };
  }

  dash.createEouEngine = createEouEngine;
  dash.EOU_PIECE_SAMPLES = PIECE;
})(globalThis);
