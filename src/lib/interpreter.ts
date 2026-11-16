import type { BindKey, Bindings, GameAction, RawEvent, Slot } from './types';

export interface InterpreterConfig {
  holdSkillMs: number;
  holdAttackMs: number;
}

interface Pending {
  t0: number;
  fired: boolean;
}

const SWAP_KEYS: BindKey[] = ['swap1', 'swap2', 'swap3', 'swap4'];

/**
 * Turns raw key and mouse events into in-game actions.
 *
 * It only sees input, never the game: a swap the game refused (swap cooldown, locked
 * animation) still counts as a swap here. Pressing the same slot again is ignored, so the
 * active character converges back to the truth on the next press.
 */
export class Interpreter {
  active: Slot;
  private held = new Set<string>();
  private skill: Pending | null = null;
  private attack: Pending | null = null;

  constructor(
    private bindings: Bindings,
    private cfg: InterpreterConfig,
    initial: Slot,
    private emit: (a: GameAction) => void,
  ) {
    this.active = initial;
  }

  feed(ev: RawEvent): void {
    this.advance(ev.t);
    if (ev.down) {
      if (this.held.has(ev.code)) return; // keyboard auto-repeat
      this.held.add(ev.code);
      this.onDown(ev.code, ev.t);
    } else {
      this.held.delete(ev.code);
      this.onUp(ev.code, ev.t);
    }
  }

  /** Fires hold actions whose threshold has passed. Safe to call as often as you like. */
  advance(now: number): void {
    if (this.skill && !this.skill.fired && now - this.skill.t0 >= this.cfg.holdSkillMs) {
      this.skill.fired = true;
      this.emit({ type: 'skillHold', slot: this.active, t: this.skill.t0 + this.cfg.holdSkillMs });
    }
    if (this.attack && !this.attack.fired && now - this.attack.t0 >= this.cfg.holdAttackMs) {
      this.attack.fired = true;
      this.emit({ type: 'ca', slot: this.active, t: this.attack.t0 + this.cfg.holdAttackMs });
    }
  }

  private is(key: BindKey, code: string): boolean {
    return this.bindings[key].includes(code);
  }

  private modHeld(): boolean {
    return this.bindings.burstMod.some((c) => this.held.has(c));
  }

  private onDown(code: string, t: number): void {
    for (let i = 0; i < 4; i++) {
      if (!this.is(SWAP_KEYS[i], code)) continue;
      const slot = i as Slot;
      const alt = this.modHeld();
      if (this.active !== slot) {
        this.active = slot;
        this.emit({ type: 'swap', slot, t });
      }
      if (alt) this.emit({ type: 'burst', slot, t, viaAlt: true });
      return;
    }
    if (this.is('skill', code)) this.skill = { t0: t, fired: false };
    else if (this.is('burst', code)) this.emit({ type: 'burst', slot: this.active, t });
    else if (this.is('attack', code)) this.attack = { t0: t, fired: false };
    else if (this.is('dash', code)) this.emit({ type: 'dash', slot: this.active, t });
    else if (this.is('jump', code)) this.emit({ type: 'jump', slot: this.active, t });
  }

  private onUp(code: string, t: number): void {
    if (this.skill && this.is('skill', code)) {
      if (!this.skill.fired) this.emit({ type: 'skill', slot: this.active, t });
      this.skill = null;
    } else if (this.attack && this.is('attack', code)) {
      if (!this.attack.fired) this.emit({ type: 'na', slot: this.active, t });
      this.attack = null;
    }
  }
}
