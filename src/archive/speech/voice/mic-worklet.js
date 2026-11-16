// Runs in the audio thread (an AudioWorklet) and does one job: cut the microphone into 160 ms
// pieces (2560 samples at 16 kHz, the size the listening model takes) and post each to the page.
const PIECE = 2560;

class MicPieces extends AudioWorkletProcessor {
  constructor() {
    super();
    this.piece = new Float32Array(PIECE);
    this.filled = 0;
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    let at = 0;
    while (at < input.length) {
      const take = Math.min(input.length - at, PIECE - this.filled);
      this.piece.set(input.subarray(at, at + take), this.filled);
      this.filled += take;
      at += take;
      if (this.filled === PIECE) {
        this.port.postMessage(this.piece, [this.piece.buffer]);
        this.piece = new Float32Array(PIECE);
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor("d2l-mic-pieces", MicPieces);
