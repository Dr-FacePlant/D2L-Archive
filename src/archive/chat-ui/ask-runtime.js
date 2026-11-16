// The model behind Ask, running inside this browser tab: LFM3-1.7B (4-bit, ONNX)
// on the graphics card, through Transformers.js. The model and the runtime are
// files in the extension's own folder (models/ and vendor/ask-runtime/), so the
// archive never goes anywhere. This is the only file that loads those files, and
// it only ever asks for addresses inside the extension.
(function initDashboardAskRuntime(global) {
  const dash = global.D2LDashboard ||= {};

  const MODEL_ID = "LiquidAI/LFM3-1.7B-ONNX";
  const MODEL_FILES = ["config.json", "generation_config.json", "tokenizer_config.json", "chat_template.jinja", "tokenizer.json", "onnx/model_q4f16.onnx", "onnx/model_q4f16.onnx_data"];
  const LIBRARY_PATH = "vendor/ask-runtime/transformers.bundle.js";
  const LIBRARY_FOLDER = "vendor/ask-runtime/";
  const MODEL_FOLDER = "models/";
  const PREFILL_CHUNK = 256;
  // The weights are one big file. The browser gives no size for a file inside an extension, so the
  // size is written down here: it lets the file be read straight into one buffer of the right size,
  // and a file that comes up short is a download that was cut short or another version of the model.
  const WEIGHTS_FILE = "onnx/model_q4f16.onnx_data";
  const WEIGHTS_BYTES = 1382930432;
  // It is read 64 MB at a time. Asking for the whole file in one go crashed the browser itself
  // (measured twice in Vivaldi 8.2: the main process stopped within a second); slices did not.
  const SLICE_BYTES = 64 * 1048576;
  // The share of the progress bar for reading the weights; the rest is handing them to the graphics card.
  const READING_SHARE = 0.9;

  // The GPU takes int64 inputs as BigInt arrays.
  const int64 = (values) => BigInt64Array.from(values, (value) => BigInt(value));

  function createBrowserRuntime({ baseUrl = global.document?.baseURI, gpu = global.navigator?.gpu, fetchImpl = (...args) => global.fetch(...args), importImpl = (url) => import(url), weightsBytes = WEIGHTS_BYTES, sliceBytes = SLICE_BYTES } = {}) {
    const inExtension = (path) => new URL(path, baseUrl).href;
    let loading = null;
    let loaded = null;

    // Is there a graphics card to use, and are all the model files in place?
    // The files are checked by asking for them and dropping the download right
    // after the reply starts, so nothing big is read.
    async function availability() {
      try {
        const adapter = gpu ? await gpu.requestAdapter() : null;
        if (!adapter) return { state: "no-gpu", reason: "This browser can't use the graphics card (WebGPU) for the model." };
      } catch {
        return { state: "no-gpu", reason: "This browser can't use the graphics card (WebGPU) for the model." };
      }
      const missing = [];
      await Promise.all(MODEL_FILES.map(async (file) => {
        const stop = new AbortController();
        try {
          const response = await fetchImpl(inExtension(`${MODEL_FOLDER}${MODEL_ID}/${file}`), { signal: stop.signal });
          if (!response.ok) missing.push(file);
        } catch {
          missing.push(file);
        } finally {
          stop.abort();
        }
      }));
      return missing.length ? { state: "missing", reason: `Missing model files: ${missing.join(", ")}.`, missing } : { state: "idle" };
    }

    const megabytes = (bytes) => `${Math.round(bytes / 1048576)} MB`;

    // Reads the weights straight into one buffer, a slice at a time. The library's own reader, when it
    // isn't told a size, copies everything it has read so far each time a piece arrives, which fills
    // the memory several times over (measured: more than 8 GB for this 1.4 GB file).
    async function readWeights(onFraction) {
      const weights = new Uint8Array(weightsBytes);
      const stopped = (bytes) => new Error(`${WEIGHTS_FILE} could not be read past ${megabytes(bytes)} of ${megabytes(weightsBytes)}. It was cut short or is another version. Download the model again.`);
      let loaded = 0;
      while (loaded < weightsBytes) {
        const want = Math.min(sliceBytes, weightsBytes - loaded);
        const response = await fetchImpl(inExtension(`${MODEL_FOLDER}${MODEL_ID}/${WEIGHTS_FILE}`), { headers: { Range: `bytes=${loaded}-${loaded + want - 1}` } });
        if (!response.ok || !response.body) throw stopped(loaded);
        const reader = response.body.getReader();
        let got = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (got + value.length > want) { await reader.cancel().catch(() => {}); throw stopped(loaded); }
          weights.set(value, loaded + got);
          got += value.length;
        }
        if (got !== want) throw stopped(loaded + got);
        loaded += want;
        onFraction(loaded / weightsBytes);
      }
      return weights;
    }

    async function start(onProgress) {
      const T = await importImpl(inExtension(LIBRARY_PATH));
      // The model folder is given as a path on this page's own address (/models/), because a full
      // address would be taken for a web download and refused.
      Object.assign(T.env, { allowRemoteModels: false, allowLocalModels: true, useBrowserCache: false, useWasmCache: false, localModelPath: new URL(MODEL_FOLDER, baseUrl).pathname });
      Object.assign(T.env.backends.onnx.wasm, { wasmPaths: inExtension(LIBRARY_FOLDER), numThreads: 1, proxy: false });
      const tokenizer = await T.AutoTokenizer.from_pretrained(MODEL_ID);
      // The weights are handed over already read (and the library told not to fetch them again).
      const weights = await readWeights((fraction) => onProgress?.(fraction * READING_SHARE));
      // The runtime's early pre-computing step (constant folding) is turned off. It reshaped a
      // 250 MB table on the computer side at start, which left a second copy on the graphics card
      // and grew the runtime's memory to 763 MB, memory that never shrinks. Without it (measured
      // in Vivaldi): about 1 GB less in all, the runtime's memory at 16 MB, the same speed.
      const model = await T.AutoModelForCausalLM.from_pretrained(MODEL_ID, {
        device: "webgpu", dtype: "q4f16", use_external_data_format: false,
        session_options: { externalData: [{ path: WEIGHTS_FILE.split("/").pop(), data: weights }], extra: { optimization: { disable_specified_optimizers: "ConstantFolding" } } }
      });
      const single = (text) => { const ids = tokenizer.encode(text, { add_special_tokens: false }); return ids.length === 1 ? Number(ids[0]) : null; };
      const singles = (texts) => texts.map(single).filter((id) => id !== null);
      // lookupIds are the markers that start a lookup (a tool call).
      loaded = { T, tokenizer, model, stopIds: singles(["<|im_end|>", "<|endoftext|>"]), lookupIds: singles(["<tool_call>", "<|tool_call_start|>"]) };
      onProgress?.(1);
      return loaded;
    }

    // Starts the model once; asking again joins the same start (and retries after a failure).
    function load(onProgress) {
      if (loaded) return Promise.resolve(loaded);
      loading ||= start(onProgress).catch((error) => { loading = null; throw error; });
      return loading;
    }

    // Lets the graphics card and the memory go. Waits for a start still in progress, so nothing is left half loaded.
    async function unload() {
      const pending = loading;
      loading = null;
      if (pending) await pending.catch(() => {});
      const current = loaded;
      loaded = null;
      await current?.model.dispose?.();
    }

    function need() {
      if (!loaded) throw new Error("The model isn't loaded yet.");
      return loaded;
    }

    // The chat as the model reads it: its template, with the tools described. With
    // thinking on, the text ends inside <think>, so the model thinks before it answers.
    function render(messages, tools, { thinking = true } = {}) {
      return need().tokenizer.apply_chat_template(messages, { ...(tools?.length ? { tools } : {}), tokenize: false, add_generation_prompt: true, enable_thinking: thinking });
    }

    // Text as token numbers. The template already wrote the special markers, so none are added.
    function encode(text) {
      return Array.from(need().tokenizer.encode(text, { add_special_tokens: false }), Number);
    }

    function decode(ids) {
      return need().tokenizer.decode(ids, { skip_special_tokens: false, clean_up_tokenization_spaces: false });
    }

    // One reading of the chat. The model keeps a memory of what it has read so far
    // (on the graphics card), so each step only needs the new tokens. Dispose it when done.
    function startConversation() {
      const { T, model } = need();
      const { layer_types: layers, hidden_size: hidden = 2048, conv_L_cache: convLength = 7, num_key_value_heads: heads = 4, head_dim: headSize = 128 } = model.config;
      const session = model.sessions.model;
      const tensor = (type, data, dims) => new T.Tensor(type, data, dims).ort_tensor;
      let memory = {};
      let past = 0;
      layers.forEach((kind, i) => {
        if (kind === "conv") memory[`past_conv.${i}`] = tensor("float16", new Uint16Array(hidden * convLength), [1, hidden, convLength]);
        else for (const part of ["key", "value"]) memory[`past_key_values.${i}.${part}`] = tensor("float16", new Uint16Array(0), [1, heads, 0, headSize]);
      });

      const free = () => { for (const value of Object.values(memory)) value.dispose?.(); memory = {}; };

      // Feeds in tokens, returns the scores for the next token (one per word-piece).
      async function step(tokenIds) {
        const n = tokenIds.length;
        const inputs = {
          input_ids: tensor("int64", int64(tokenIds), [1, n]),
          attention_mask: tensor("int64", int64(new Array(past + n).fill(1)), [1, past + n]),
          position_ids: tensor("int64", int64(tokenIds.map((_, j) => past + j)), [1, n]),
          logits_to_keep: tensor("int64", int64([1]), [1])
        };
        let output;
        try {
          output = await session.run({ ...inputs, ...memory });
        } finally {
          for (const value of Object.values(inputs)) value.dispose?.();
        }
        const next = {};
        for (const [name, value] of Object.entries(output)) {
          if (name !== "logits") next[name.replace("present_conv", "past_conv").replace(/^present\.(\d+)\.(key|value)$/, "past_key_values.$1.$2")] = value;
        }
        free();
        memory = next;
        past += n;
        const scores = await output.logits.getData();
        output.logits.dispose?.();
        return scores;
      }

      return { step, dispose: free };
    }

    return {
      availability,
      load,
      unload,
      render,
      encode,
      decode,
      startConversation,
      get stopIds() { return need().stopIds; },
      get lookupIds() { return need().lookupIds; },
      chunk: PREFILL_CHUNK
    };
  }

  Object.assign(dash, { createBrowserRuntime, ASK_MODEL_ID: MODEL_ID, ASK_MODEL_FILES: MODEL_FILES });
})(globalThis);
