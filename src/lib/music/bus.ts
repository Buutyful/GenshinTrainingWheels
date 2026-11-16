/**
 * The music mix: drums and stabs go straight to the output; the bass and pads go through a "duck" gain
 * that the kick pulls down on every hit (sidechain pumping), and a gentle compressor sits last.
 *
 *   direct ─────────────┐
 *   ducked ─▶ duck ──────┴─▶ out (volume) ─▶ compressor ─▶ dest
 */
export class MusicBus {
  readonly direct: GainNode;
  readonly ducked: GainNode;
  readonly out: GainNode;
  private duck: GainNode;
  private comp: DynamicsCompressorNode;

  constructor(
    private ctx: BaseAudioContext,
    dest: AudioNode,
    volume = 0.8,
  ) {
    this.direct = ctx.createGain();
    this.ducked = ctx.createGain();
    this.duck = ctx.createGain();
    this.out = ctx.createGain();
    this.out.gain.value = volume;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -12;
    this.comp.knee.value = 6;
    this.comp.ratio.value = 3;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.12;
    this.direct.connect(this.out);
    this.ducked.connect(this.duck).connect(this.out);
    this.out.connect(this.comp).connect(dest);
  }

  /** Dips the tonal layers at `t` and lets them swell back, like a sidechained compressor. */
  pump(t: number, depth: number, release = 0.2): void {
    if (depth <= 0) return;
    const g = this.duck.gain;
    g.setTargetAtTime(1 - Math.min(depth, 0.95), t, 0.003);
    g.setTargetAtTime(1, t + 0.03, release / 4);
  }

  setVolume(v: number, at = this.ctx.currentTime): void {
    this.out.gain.setTargetAtTime(v, at, 0.02);
  }

  disconnect(): void {
    this.comp.disconnect();
  }
}
