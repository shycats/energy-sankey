import { TemplateResult, nothing, svg } from "lit";

/**
 * Flow animation: "pulses" of a lighter colour that travel along the flows
 * in the direction the power is going.
 *
 * Each straight or curved stretch of a flow registers a PulseSeg: its
 * centreline (drawn in the direction of flow), width, colour and rate. The
 * pulses are dashes along that centreline, stroked at the flow's width (and
 * clipped to the flow's shape for curves), animated by moving the dash
 * offset.
 *
 * Every pulse repeats with the same period in time, so a pulse leaving one
 * segment enters the next at the same moment. Segments are grouped into
 * chains (consecutive stretches of one flow), and the chains are given
 * phases so that the pulses line up wherever flows join or split (see
 * PulseChains). With rate scaling, a flow's pulses move faster when it
 * carries more power, which (with the period in time fixed) also spaces
 * them further apart.
 */

/** Which of the diagram's SVGs a segment is drawn in. */
/** "far" is the consumers' arrowheads (and any extras before them). */
export type PulseLayer = "lhs" | "mid" | "right" | "far";

/** A solid colour, or a linear gradient between two (in user space). */
export type PulsePaint =
  | string
  | {
      from: string;
      to: string;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
    };

export interface PulseSeg {
  /** Chain this segment belongs to, and its place in it (flow order). */
  chain: string;
  order: number;
  layer: PulseLayer;
  /** Centreline path data, in the direction of flow. */
  d: string;
  /** Stroke width (user units). */
  width: number;
  /** Outline to clip the pulses to (curves and arrowheads). */
  clip?: string;
  /** Centreline length in user units and in screen px. */
  lenUser: number;
  lenPx: number;
  /** Pulse colour (already lightened). */
  paint: PulsePaint;
  /** Pulses along the segment at any moment. Set by PulseChains. */
  cycles: number;
  /** Phase (in cycles) at the start of the segment. Set by PulseChains. */
  phase0: number;
}

/** Default spacing between pulses (px). */
export const PULSE_SPACING_PX = 80;
/** Default length of each pulse (px), independent of the spacing. */
export const PULSE_WAVE_LENGTH_PX = 48;
/** A pulse never takes more than this fraction of the gap between pulses. */
const PULSE_MAX_FILL = 0.95;
/** Base speed of the pulses (px/s), before the speed multiplier. */
export const PULSE_SPEED_PX_S = 40;
/** How far each flow's colour is lightened towards white for its pulses. */
export const PULSE_LIGHTEN = 0.5;

/**
 * A pulse is drawn as stacked dashes, widest and faintest first, so it
 * brightens towards its middle: a soft wave rather than a hard stripe.
 * frac is the dash length as a fraction of the pulse's full length.
 */
const PULSE_STEPS = 6;
const PULSE_PROFILE = Array.from({ length: PULSE_STEPS }, (_, i) => ({
  frac: 1 - (5 / 6) * (i / (PULSE_STEPS - 1)),
}));

/** Default opacity of each of the stacked dashes. */
const PULSE_STEP_OPACITY = 0.15;
/**
 * Default opacity where the first k dashes overlap (k = 1..steps): the
 * pulse's profile, from its faint edges to its middle.
 */
const PULSE_PROFILE_OPACITY = PULSE_PROFILE.map(
  (_, i) => 1 - (1 - PULSE_STEP_OPACITY) ** (i + 1),
);
/** Highest brightness multiplier accepted. */
export const PULSE_MAX_BRIGHTNESS = 3;

/**
 * How the brightness multiplier is applied. It scales the opacity of the
 * whole profile, so the edges stay softer than the middle, with each level
 * capped at fully opaque (the middle gets there at about 1.6). Beyond
 * that, the pulse colour is lightened further towards white, which helps
 * on flows whose colour is already light.
 *
 * Returns each dash's opacity (widest first) and how far to lighten.
 */
export function pulseBrightness(brightness: number): {
  opacities: number[];
  lighten: number;
} {
  const b = Math.min(PULSE_MAX_BRIGHTNESS, Math.max(0, brightness));
  const levels = PULSE_PROFILE_OPACITY.map((o) => Math.min(1, o * b));
  // Each dash's opacity such that, stacked over the ones before it, it
  // takes the pulse to its level.
  const opacities = levels.map((level, i) => {
    const below = i > 0 ? levels[i - 1] : 0;
    return below >= 1 ? 0 : 1 - (1 - level) / (1 - below);
  });
  const peak = PULSE_PROFILE_OPACITY[PULSE_PROFILE_OPACITY.length - 1];
  const fullAt = 1 / peak;
  const extra = b > fullAt ? (b - fullAt) / (PULSE_MAX_BRIGHTNESS - fullAt) : 0;
  return {
    opacities,
    lighten: PULSE_LIGHTEN + (0.9 - PULSE_LIGHTEN) * extra,
  };
}

/** Length of a cubic bezier [x0,y0,cx1,cy1,cx2,cy2,x3,y3], scaled by sx/sy. */
export function bezierLength(
  c: number[],
  sx: number = 1,
  sy: number = 1,
  steps: number = 24,
): number {
  let len = 0;
  let px = c[0];
  let py = c[1];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const d = 3 * u * t * t;
    const e = t * t * t;
    const x = a * c[0] + b * c[2] + d * c[4] + e * c[6];
    const y = a * c[1] + b * c[3] + d * c[5] + e * c[7];
    len += Math.hypot((x - px) * sx, (y - py) * sy);
    px = x;
    py = y;
  }
  return len;
}

/** Reverses a cubic bezier [x0,y0,cx1,cy1,cx2,cy2,x3,y3]. */
export function reverseBezier(c: number[]): number[] {
  return [c[6], c[7], c[4], c[5], c[2], c[3], c[0], c[1]];
}

export function bezierPath(c: number[]): string {
  return `M ${c[0]},${c[1]} C ${c[2]},${c[3]} ${c[4]},${c[5]} ${c[6]},${c[7]}`;
}

/**
 * Lightens a #rrggbb colour by moving its HSL lightness `amount` of the way
 * towards white, keeping its hue and saturation (unlike mixing with white,
 * which washes the colour out).
 */
export function lightenHex(hex: string, amount: number = PULSE_LIGHTEN) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) {
    return hex;
  }
  const r = parseInt(m[1], 16) / 255;
  const g = parseInt(m[2], 16) / 255;
  const b = parseInt(m[3], 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  let l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) {
      h = (g - b) / d + (g < b ? 6 : 0);
    } else if (max === g) {
      h = (b - r) / d + 2;
    } else {
      h = (r - g) / d + 4;
    }
    h /= 6;
  }
  l += (1 - l) * amount;
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let rr = l;
  let gg = l;
  let bb = l;
  if (s !== 0) {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    rr = hue2rgb(p, q, h + 1 / 3);
    gg = hue2rgb(p, q, h);
    bb = hue2rgb(p, q, h - 1 / 3);
  }
  return (
    "#" +
    [rr, gg, bb]
      .map((c) =>
        Math.round(Math.min(1, Math.max(0, c)) * 255)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

/**
 * The registered segments, grouped into chains, and the operations that
 * give them phases. A junction's phase is a single number (in cycles), so
 * flows meeting at a junction pulse in step there:
 * - forward: the chain starts at a known phase; returns its end phase.
 * - backward: the chain ends at a known phase; returns its start phase.
 * - fit: both ends are known (where two flows join a third that already
 *   has its phase). The chain's pulses are spaced slightly closer or wider
 *   (by at most half a pulse over the chain's length) to make it fit.
 */
export class PulseChains {
  private _chains = new Map<string, PulseSeg[]>();

  private _done = new Set<string>();

  constructor(segs: PulseSeg[]) {
    for (const seg of segs) {
      const chain = this._chains.get(seg.chain) || [];
      chain.push(seg);
      this._chains.set(seg.chain, chain);
    }
    for (const chain of this._chains.values()) {
      chain.sort((a, b) => a.order - b.order);
    }
  }

  public has(chain: string): boolean {
    return this._chains.has(chain);
  }

  /** Chains whose names start with `prefix` (e.g. one per battery). */
  public matching(prefix: string): string[] {
    return [...this._chains.keys()].filter((k) => k.startsWith(prefix));
  }

  private _cycles(chain: string): number {
    return (this._chains.get(chain) || []).reduce((a, s) => a + s.cycles, 0);
  }

  public forward(chain: string, start: number): number {
    let phase = start;
    for (const seg of this._chains.get(chain) || []) {
      seg.phase0 = phase;
      phase += seg.cycles;
    }
    this._done.add(chain);
    return phase;
  }

  public backward(chain: string, end: number): number {
    const start = end - this._cycles(chain);
    this.forward(chain, start);
    return start;
  }

  public fit(chain: string, start: number, end: number): void {
    const cycles = this._cycles(chain);
    if (cycles > 0) {
      // The nearest cycle count that lands on `end` (start + cycles must
      // equal end, give or take whole cycles).
      let delta = end - start - cycles;
      delta -= Math.round(delta);
      let adjusted = cycles + delta;
      // Never squeeze a chain down to (almost) no pulses at all.
      if (adjusted < 0.5) {
        adjusted += 1;
      }
      const k = adjusted / cycles;
      for (const seg of this._chains.get(chain) || []) {
        seg.cycles *= k;
      }
    }
    this.forward(chain, start);
  }

  /** Gives any chain not yet placed (e.g. from a subclass) phase 0. */
  public finish(): void {
    for (const chain of this._chains.keys()) {
      if (!this._done.has(chain)) {
        this.forward(chain, 0);
      }
    }
  }
}

/**
 * Renders the pulses for one SVG. Each dash carries its animation's
 * starting offset and period (user units) as data attributes, which the
 * element animates (see ElecSankey._syncPulseAnimations).
 */
export function renderPulseLayer(
  segs: PulseSeg[],
  idPrefix: string,
  waveLengthPx: number = PULSE_WAVE_LENGTH_PX,
  opacities: number[] = pulseBrightness(1).opacities,
): TemplateResult | typeof nothing {
  if (!segs.length) {
    return nothing;
  }
  const defs: TemplateResult[] = [];
  const groups: TemplateResult[] = [];
  segs.forEach((seg, i) => {
    if (!(seg.cycles > 0) || !(seg.lenUser > 0) || !(seg.width > 0)) {
      return;
    }
    const period = seg.lenUser / seg.cycles;
    let stroke: string;
    if (typeof seg.paint === "string") {
      stroke = seg.paint;
    } else {
      const id = `${idPrefix}-grad-${i}`;
      const p = seg.paint;
      defs.push(svg`
        <linearGradient
          id=${id}
          gradientUnits="userSpaceOnUse"
          x1=${p.x1}
          y1=${p.y1}
          x2=${p.x2}
          y2=${p.y2}
        >
          <stop offset="0" style="stop-color:${p.from}" />
          <stop offset="1" style="stop-color:${p.to}" />
        </linearGradient>
      `);
      stroke = `url(#${id})`;
    }
    let clip: string | typeof nothing = nothing;
    if (seg.clip) {
      const id = `${idPrefix}-clip-${i}`;
      defs.push(svg`<clipPath id=${id}><path d=${seg.clip} /></clipPath>`);
      clip = `url(#${id})`;
    }
    const phase = seg.phase0 - Math.floor(seg.phase0);
    // The pulse length is set in px; convert it to this segment's user
    // units, and keep it shorter than the gap so pulses stay separate.
    const waveLength = Math.min(
      (waveLengthPx * seg.lenUser) / seg.lenPx,
      PULSE_MAX_FILL * period,
    );
    const dashes = PULSE_PROFILE.map(({ frac }, step) => {
      const opacity = opacities[step];
      const dash = frac * waveLength;
      // Offset that centres a pulse where the phase is a whole number.
      const from = phase * period + dash / 2;
      return svg`
        <path
          class="pulse"
          d=${seg.d}
          data-from=${from}
          data-period=${period}
          style="stroke:${stroke};stroke-width:${seg.width};stroke-opacity:${opacity};stroke-dasharray:${dash} ${
            period - dash
          };stroke-dashoffset:${from}"
        />
      `;
    });
    groups.push(svg`<g clip-path=${clip}>${dashes}</g>`);
  });
  return svg`<g class="pulses"><defs>${defs}</defs>${groups}</g>`;
}
