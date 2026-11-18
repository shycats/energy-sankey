import {
  CSSResultGroup,
  LitElement,
  TemplateResult,
  css,
  html,
  nothing,
  svg,
} from "lit";

import {
  mdiTransmissionTower,
  mdiHelpRhombus,
  mdiBatteryCharging,
  mdiBattery,
} from "@mdi/js";
import { customElement, property } from "lit/decorators.js";
import { batteryLevelIcon } from "./utils/battery-icon";

/**
 * Notes on graphical layout:
 *
 * The diagram contains elements that are fixed aspect ratio on the left,
 * and variable aspect ratio on the right. This is because the split of
 * renewables into two directions doesn't tend to stretch well and still
 * look good.
 *
 * The right side of the diagram shows the rates fanning out to consumers,
 * and this is much more easy to stretch. Changing the aspec ratio does not
 * adversely affect the diagram.
 *
 * The overall SVG is designed to fit within a bounding box, of 500px less
 * two 16px margins. Some experimentation with the value of
 * SVG_LHS_VISIBLE_WIDTH is needed to get the best fit.
 *
 * With the SVG_LHS_VISIBLE_WIDTH set, a scaling factor is automatically
 * calculated, and all other graphical elements are scaled by this factor.
 *
 * All other items in the diagram are an arbitrary scale, which is
 * multiplied by the scaling factor.
 *
 */

const TERMINATOR_BLOCK_LENGTH = 50;
const GENERATION_FAN_OUT_HORIZONTAL_GAP = 50;
const CONSUMERS_FAN_OUT_VERTICAL_GAP = 50;
const BATTERIES_FAN_OUT_VERTICAL_GAP = 70;
const CONSUMER_LABEL_HEIGHT = 50;
const TARGET_SCALED_TRUNK_WIDTH = 90;
const PAD_MULTIPLIER = 1.8;

const GEN_COLOR = "#0d6a04";
const GRID_IN_COLOR = "#920e83";
const BATT_IN_COLOR = "#01f4fc";

// The below two lengths must add up to 100.
const CONSUMER_BLEND_LENGTH = 80;
const CONSUMER_BLEND_LENGTH_PRE_FAN_OUT = 20;

const GRID_BLEND_LENGTH = 30;
const BATTERY_BLEND_LENGTH = 30;

const ARROW_HEAD_LENGTH = 10;
const TEXT_PADDING = 8;
const FONT_SIZE_PX = 16;
const ICON_SIZE_PX = 24;

const GEN_ORIGIN_X = 150;

const SVG_LHS_VISIBLE_WIDTH = 110;

export const PAD_ANTIALIAS = 0.5;

const ZERO_CHECK_TOLERANCE = 0.1;

const UNTRACKED_ID = "untracked";
const OTHER_ID = "other";

export interface ElecRoute {
  id?: string;
  text?: string;
  rate: number;
  /**
   * Either raw SVG path data (e.g. from @mdi/js) or an icon name such as
   * "mdi:solar-power". Icon names can only be resolved by subclasses that
   * have access to an icon registry (see HaElecSankey); the base class
   * ignores them.
   */
  icon?: string;
  /** Optional extra value shown above the route's icon. */
  topValue?: LabelTopValue;
  /**
   * Consumers only: CSS colour for this consumer's branch and value,
   * replacing the blended source colour.
   */
  color?: string;
  /** Draw a rounded outline around this route's label. */
  outline?: boolean;
}

/** True if `icon` is an icon name ("prefix:name") rather than SVG path data. */
export function isIconName(icon: string | undefined): boolean {
  return !!icon && /^[a-z0-9_-]+:[a-z0-9_-]+$/i.test(icon);
}

export interface ElecRoutePair {
  in: ElecRoute;
  out: ElecRoute;
  /** Battery state of charge in percent (0-100), if known. */
  soc?: number;
  /** Id of the entity providing `soc` (made clickable by subclasses). */
  socId?: string;
  /** CSS colour for this battery's discharge flow and value. */
  color?: string;
  /** Draw a rounded outline around this battery's label. */
  outline?: boolean;
}

/**
 * A value shown above a label's icon, e.g. a battery's state of charge or a
 * user-chosen entity's state. Numbers are formatted by the renderer (with
 * `unit` appended); strings are shown as given.
 */
export interface LabelTopValue {
  value: number | string;
  unit?: string;
  /** Entity id, made clickable (more-info) by subclasses. */
  id?: string;
}

function debugPoint(x: number, y: number, label: string): TemplateResult {
  return svg`
    <circle cx="${x}" cy="${y}" r="3" fill="#22DDDD" />
    <text x="${x - 13}" y="${y - 6}" font-size="10px">${label}</text>
`;
}

// Color mixing from here: https://stackoverflow.com/a/76752232
function hex2dec(hex: string) {
  const matched = hex.replace("#", "").match(/.{2}/g);
  if (!matched) throw new Error("Invalid hex string");
  return matched.map((n) => parseInt(n, 16));
}

function rgb2hex(r: number, g: number, b: number) {
  r = Math.round(r);
  g = Math.round(g);
  b = Math.round(b);
  r = Math.min(r, 255);
  g = Math.min(g, 255);
  b = Math.min(b, 255);
  return "#" + [r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("");
}

export function mixHexes(hex1: string, hex2: string, ratio: number = 0.5) {
  if (ratio > 1 || ratio < 0) {
    throw new Error("Invalid ratio: " + ratio);
  }
  const [r1, g1, b1] = hex2dec(hex1);
  const [r2, g2, b2] = hex2dec(hex2);
  const r = Math.round(r1 * ratio + r2 * (1 - ratio));
  const g = Math.round(g1 * ratio + g2 * (1 - ratio));
  const b = Math.round(b1 * ratio + b2 * (1 - ratio));
  return rgb2hex(r, g, b);
}
// End of color mixing code from SO.

export function mix3Hexes(
  hex1: string,
  hex2: string,
  hex3: string,
  ratio1: number,
  ratio2: number,
  ratio3: number
) {
  [ratio1, ratio2, ratio3].forEach((ratio) => {
    if (ratio > 1.0 || ratio < 0) {
      throw new Error("Invalid ratio: " + ratio);
    }
  });
  const [r1, g1, b1] = hex2dec(hex1);
  const [r2, g2, b2] = hex2dec(hex2);
  const [r3, g3, b3] = hex2dec(hex3);
  const r = Math.round(r1 * ratio1 + r2 * ratio2 + r3 * ratio3);
  const g = Math.round(g1 * ratio1 + g2 * ratio2 + g3 * ratio3);
  const b = Math.round(b1 * ratio1 + b2 * ratio2 + b3 * ratio3);
  return rgb2hex(r, g, b);
}

/**
 * Calculates the intersection point of two lines defined by their endpoints.
 * i.e. if the lines are defined by
 * (x1, y1) -> (x2, y2) and (x3, y3) -> (x4, y4),
 * As long as the two lines are not parallel, the function will return the
 * extrapolated intersection point of where the line x1,y1 -> x2,y2 intersects
 * the line x3,y3 -> x4,y4.
 */
function line_intersect(x1, y1, x2, y2, x3, y3, x4, y4) {
  // Based on https://stackoverflow.com/a/38977789

  const denom = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
  if (denom === 0) {
    // eslint-disable-next-line no-console
    console.warn("Warning: Lines do not intersect.");
    return null;
  }
  const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denom;
  const ub = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / denom;
  const x = x1 + ua * (x2 - x1);
  const y = y1 + ua * (y2 - y1);
  const seg1 = ua >= 0 && ua <= 1;
  const seg2 = ub >= 0 && ub <= 1;
  return [x, y, seg1, seg2];
}

/**
 * Draws a flow based on the corners of the start and end.
 * Rather than draw a curve between two points, this function takes the
 * corners of a large stripe between two end lines, and constructs a 4-corner
 * bezier shape to join them. This is useful for creating a flow map where
 * there are significant changes in direction but we don't want curves to
 * overlap.
 * An extreme fan-out a spread out list could result in significant overlap
 * if this were to be constructed with curves of constant width.
 */
function renderFlowByCorners(
  startLX: number,
  startLY: number,
  startRX: number,
  startRY: number,
  endLX: number,
  endLY: number,
  endRX: number,
  endRY: number,
  classname: string = "",
  color: string | null = null
): TemplateResult {
  // Don't attempt to draw curves for very narrow lines
  if (
    Math.sqrt((startLX - startLY) ** 2 + (startRX - startRY) ** 2) < 1 ||
    Math.sqrt((endLX - endLY) ** 2 + (endRX - endRY) ** 2) < 1
  ) {
    return svg``;
  }

  // Find points to make a line along the the half way fold
  // between the start and the end ('Mirror' line).
  const pointAX = (startLX + endLX) / 2;
  const pointAY = (startLY + endLY) / 2;
  const pointBX = (startRX + endRX) / 2;
  const pointBY = (startRY + endRY) / 2;
  // The bezier points are defined by the intersection between:
  // - the lines perpendicular to the ends
  // - the mirror line.
  const ret1 = line_intersect(
    startLX,
    startLY,
    startLX - (startRY - startLY),
    startLY - (startLX - startRX),
    pointAX,
    pointAY,
    pointBX,
    pointBY
  );
  const ret2 = line_intersect(
    endLX,
    endLY,
    endLX + (endRY - endLY),
    endLY + (endLX - endRX),
    pointAX,
    pointAY,
    pointBX,
    pointBY
  );

  const ret3 = line_intersect(
    endRX,
    endRY,
    endRX + (endRY - endLY),
    endRY + (endLX - endRX),
    pointAX,
    pointAY,
    pointBX,
    pointBY
  );
  const ret4 = line_intersect(
    startRX,
    startRY,
    startRX - (startRY - startLY),
    startRY - (startLX - startRX),
    pointAX,
    pointAY,
    pointBX,
    pointBY
  );
  if (ret1 == null || ret2 == null || ret3 == null || ret4 == null) {
    // eslint-disable-next-line no-console
    console.warn("Warning: render flow failed.");
    return svg``;
  }
  const [bezierStartLX, bezierStartLY, ,] = ret1;
  const [bezierEndLX, bezierEndLY, ,] = ret2;
  const [bezierEndRX, bezierEndRY, ,] = ret3;
  const [bezierStartRX, bezierStartRY, ,] = ret4;
  const fillspec = color ? "fill:" + color : "";
  const svg_ret = svg`
  <path
      class="flow ${classname}"
      d="M ${startLX},${startLY}
      C ${bezierStartLX},${bezierStartLY} ${bezierEndLX},${bezierEndLY} ${endLX},${endLY}
      L ${endRX},${endRY}
      C ${bezierEndRX},${bezierEndRY} ${bezierStartRX},${bezierStartRY} ${startRX},${startRY} Z"
      style="${fillspec}"
  />
`;
  return svg_ret;
}

export function renderRect(
  x: number,
  y: number,
  width: number,
  height: number,
  classname: string,
  color: string | null = null
): TemplateResult {
  const styleString = color ? `fill:${color};fill-opacity:1` : "";
  return svg`
  <rect
  class=${classname}
  x="${x}"
  y="${y}"
  height="${height}"
  width="${width}"
  style=${styleString}
  />`;
}

/**
 * Generic render for rects where flow blends from one colour to another.
 */
function renderBlendRect(
  startLX: number,
  startLY: number,
  startRX: number,
  startRY: number,
  endLX: number,
  endLY: number,
  endRX: number,
  endRY: number,
  startColor: string,
  endColor: string,
  id: string
): TemplateResult | symbol {
  if (
    !(
      (startLX == startRX && endLX == endRX) ||
      (startLY == startRY && endLY == endRY)
    )
  ) {
    console.error(
      "Unsupported blend flow dimensions - only horiz/vert are implemented."
    );
    return nothing;
  }
  const horizontal: boolean = startLX == startRX;
  let height, width;
  let x1, y1, x2, y2;
  if (horizontal) {
    height = Math.abs(startLY - startRY);
    width = Math.abs(startLX - endLX);
    y1 = "0%";
    y2 = "0%";
    x1 = startLX < endLX ? "0%" : "100%"; // Left to right.
    x2 = startLX < endLX ? "100%" : "0%"; // Rigth to left.
  } else {
    height = Math.abs(startLY - endLY);
    width = Math.abs(startLX - startRX);
    x1 = "0%";
    x2 = "0%";
    y1 = startLY < endLY ? "0%" : "100%"; // Top to bottom.
    y2 = startLY < endLY ? "100%" : "0%"; // Bottom to top.
  }
  const topLeftX = Math.min(startLX, startRX, endLX, endRX);
  const topLeftY = Math.min(startLY, startRY, endLY, endRY);
  const svgRet = svg`
    <defs>
      <linearGradient id="${id}_grad" x1=${x1} y1=${y1} x2=${x2} y2=${y2}>
        <stop offset="0%" style="stop-color:${startColor};stop-opacity:1" />
        <stop offset="100%" style="stop-color:${endColor};stop-opacity:1" />
      </linearGradient>
    </defs>
    <rect
      id="${id}"
      x="${topLeftX}"
      y="${topLeftY}"
      height="${height}"
      width="${width}"
      fill="url(#${id}_grad)"
      style="fill-opacity:1"
    />
  `;
  return svgRet;
}
/**
 * Sorts ElecRoute objects by their rate in ascending or descending order.
 */
function sortRoutesByRate(
  routes: { [id: string]: ElecRoute },
  ascending: boolean
): {
  [id: string]: ElecRoute;
} {
  const routesSorted = Object.values(routes).sort((a, b) => {
    return ascending
      ? (a.rate || 0) - (b.rate || 0)
      : (b.rate || 0) - (a.rate || 0);
  });
  let ret: { [id: string]: ElecRoute } = {};
  for (const val of routesSorted) {
    if (!val.id) {
      console.warn("Skipping route without id:", val);
      continue;
    }
    ret[val.id] = val;
  }
  return ret;
}

function sortRoutesByRateDescending(routes: { [id: string]: ElecRoute }): {
  [id: string]: ElecRoute;
} {
  return sortRoutesByRate(routes, false);
}

function sortRoutesByRateAscending(routes: { [id: string]: ElecRoute }): {
  [id: string]: ElecRoute;
} {
  return sortRoutesByRate(routes, true);
}
/**
 * Creates a flow map graphic showing the flow of electricity.
 *
 * In general, the aim of this class is to display a coherent and informative
 * visual representation of the flow of electricity. If a strange occurence
 * occurs, such as consumption exceeding total input power, the class should
 * attempt to display a sensible visual, including phantom sources or
 * consumers to convey a complete diagram.
 *
 * The reason for this is that the class is likely to receive asynchronous
 * updates from different sensors. It must display a glitch-free best
 * approximation of the reality until more information becomes available.
 *
 * Internally, the class deliberately avoids making reference to power or
 * energy because it can be used for either. By populating with
 * power (W) values it represents power flow. By populating with energy (kWh)
 * values it represents the energy flow over a period of time.
 * 'rate' is used as a generic variable name that can be power/energy.
 *
 * Architecture note:
 * While written for home assistant, this class deliberately makes no reference
 * to HA and is decoupled from it. It is designed to be subclassed within HA.
 *
 * The block of code below is useful when debugging the svg layouts.

* function debugPoint(x: number, y: number, label: string): TemplateResult {
 *   return svg`
 *     <circle cx="${x}" cy="${y}" r="3" fill="#22DDDD" />
 *     <text x="${x - 13}" y="${y - 6}" font-size="10px">${label}</text>
 * `;
 * }
 * ${debugPoint(x0, y0, "x0,y0")}
*  ${debugPoint(x1 - 20, y1, "x1,y1")}
*  ${debugPoint(x2 - 20, y2, "x2,y2")}
*  ${debugPoint(x10, y10, "x10,y10")}
*  ${debugPoint(x1 - 20, y5, "x1,y5")}
*  ${debugPoint(x1 - 20, y4, "x1,y4")}
*  ${debugPoint(x14, y0, "x14,y0")} ${debugPoint(x15, y0, "x15,y0")}
*  ${debugPoint(x16, y0, "x16,y0")} ${debugPoint(x10, y2, "x10,y2")}
*  ${debugPoint(x10, y11, "x10,y11")}
*  ${debugPoint(x10, y5, "x10,y5")}
*  ${debugPoint(x10, y13, "x10,y13")}
*  ${debugPoint(x17, y17, "x17,y17")}
*  ${debugPoint(x14, y17, "x14,y17")}
*  ${debugPoint(x15, y17, "x15,y17")}
*  ${debugPoint(x20, y17, "x20,y17")}
*  ${debugPoint(x21, y17, "x21,y17")}
 */

@customElement("elec-sankey")
export class ElecSankey extends LitElement {
  // Extras can be added in to the left of the consumer arrow by
  // extending this class and overriding extrasLength.
  static extrasLength = 0;

  @property()
  public unit: string = "kWh";

  @property({ attribute: false })
  public generationInRoutes: { [id: string]: ElecRoute } = {};

  @property({ attribute: false })
  public gridInRoute?: ElecRoute;

  @property({ attribute: false })
  public gridOutRoute?: ElecRoute;

  @property({ attribute: false })
  public consumerRoutes: { [id: string]: ElecRoute } = {};

  @property({ attribute: false })
  public batteryRoutes: { [id: string]: ElecRoutePair } = {};

  @property({ attribute: false })
  public maxConsumerBranches: number = 0;

  @property({ attribute: false })
  public hideConsumersBelow: number = 0;

  @property({ attribute: false })
  public batteryChargeOnlyFromGeneration: boolean = false;

  /**
   * Assume batteries charge from generation first, and only from the grid for
   * whatever generation can't cover. Suits DC-coupled batteries behind a
   * hybrid inverter, where grid import alongside surplus generation is going
   * to consumers, not batteries. Ignored if batteryChargeOnlyFromGeneration.
   */
  @property({ attribute: false })
  public batteryChargeFromGenerationFirst: boolean = false;

  /**
   * For bidirectional labels (grid, batteries), show a single net value in
   * the direction of flow instead of separate in and out values. Suits
   * instantaneous power, where flow can only go one way at a time. Energy
   * over a period can legitimately flow both ways, so this defaults to off.
   * Implemented by HaElecSankey's label rendering.
   */
  @property({ attribute: false })
  public netBidirectionalValues: boolean = false;

  /**
   * Rate drawn at full trunk width. Below it the scale is fixed, so smaller
   * rates draw thinner lines; above it (or when unset) the diagram scales
   * automatically so the widest trunk is always full width.
   */
  @property({ attribute: false })
  public maxRate?: number;

  /** Show the total consumption above the converging (blended) trunk. */
  @property({ attribute: false })
  public showConsumptionTotal: boolean = false;

  /** Total of all consumers incl. untracked; set by _recalculate(). */
  protected _consumerTotalRate: number = 0;

  /** Optional icon for the untracked ("Untracked"/"Home") consumer. */
  @property({ attribute: false })
  public untrackedIcon?: string;

  /**
   * Icon for the "unknown source" generation shown when generation must be
   * inferred to balance the diagram. Defaults to a question mark. Its colour
   * comes from the --unknown-source-color CSS variable (grey by default).
   */
  @property({ attribute: false })
  public unknownSourceIcon?: string;

  private _rateToWidthMultplier: number = 0.2;

  /** The multiplier auto-scaling would use, i.e. ignoring maxRate. */
  private _autoRateToWidthMultiplier: number = 0.2;

  private _phantomGridInRoute?: ElecRoute;

  private _phantomGenerationInRoute?: ElecRoute;

  private _untrackedConsumerRoute: ElecRoute = {
    id: undefined,
    text: "Untracked",
    rate: 0,
  };

  private _gridExport: number = 0;

  private _batteriesToGridRate: number = 0;

  private _batteriesToConsumersRate: number = 0;

  private _gridToBatteriesRate: number = 0;

  private _gridToConsumersRate: number = 0;

  private _generationToBatteriesRate: number = 0;

  private _generationToGridRate: number = 0;

  private _generationToConsumersRate: number = 0;

  protected _localize = (key: string, fallBack?: string) => {
    // This is a simple localizer that can be overridden by the parent class.
    return fallBack || key;
  };

  private _generationTrackedTotal(): number {
    let totalGen = 0;
    for (const key in this.generationInRoutes) {
      if (Object.prototype.hasOwnProperty.call(this.generationInRoutes, key)) {
        totalGen += this.generationInRoutes[key].rate || 0;
      }
    }
    return totalGen;
  }

  private _generationPhantom(): number {
    return this._phantomGenerationInRoute
      ? this._phantomGenerationInRoute.rate
      : 0;
  }

  private _generationTotal(): number {
    return this._generationTrackedTotal() + this._generationPhantom();
  }

  private _gridImport(excludePhantom: boolean = false): number {
    if (this.gridInRoute) {
      return this.gridInRoute.rate > 0 ? this.gridInRoute.rate : 0;
    } else if (this.gridOutRoute) {
      return this.gridOutRoute.rate < 0 ? -this.gridOutRoute.rate : 0;
    } else if (!excludePhantom && this._phantomGridInRoute) {
      return this._phantomGridInRoute.rate;
    }
    return 0;
  }

  private _consumerTrackedTotal(): number {
    let total = 0;
    for (const id in this.consumerRoutes) {
      if (Object.prototype.hasOwnProperty.call(this.consumerRoutes, id)) {
        total += this.consumerRoutes[id].rate || 0;
      }
    }
    return total;
  }

  private _batteryOutTotal(): number {
    /**
     * Battery rate out of the electrical system (i.e. charging).
     */
    let total = 0;
    for (const id in this.batteryRoutes) {
      if (Object.prototype.hasOwnProperty.call(this.batteryRoutes, id)) {
        const inRate = this.batteryRoutes[id].in.rate || 0;
        const outRate = this.batteryRoutes[id].out.rate || 0;
        if (outRate > 0) {
          total += outRate;
        } else if (outRate < 0) {
          total -= inRate;
        }
      }
    }
    return total;
  }

  private _batteryInTotal(): number {
    /**
     * Battery rate in to the electrical system (i.e. discharging)
     */
    let total = 0;
    for (const id in this.batteryRoutes) {
      if (Object.prototype.hasOwnProperty.call(this.batteryRoutes, id)) {
        const inRate = this.batteryRoutes[id].in.rate || 0;
        const outRate = this.batteryRoutes[id].out.rate || 0;
        if (inRate > 0) {
          total += inRate;
        } else if (outRate < 0) {
          total -= outRate;
        }
      }
    }
    return total;
  }

  private _recalculate() {
    /**
     * Note that it is not 100% possible to fully determine the actual flow of
     * electrons in all secenarios.
     *
     * The goal of this strategy is to present a viable diagram given the
     * input data, with a leaning in specific directions where there is
     * uncertainty. The most complex version is for energy flow, which can
     * accumulate in both directions for certain flows (grid, batteries etc).
     * The calculation is based on energy. Power flow is a simpler case, with
     * each flow only possible to be in or out (not both), but they are both
     * calculated using the same algorithm, documented inline below.
     */
    const gridImport = this._gridImport(true);

    // Determine the grid import and export
    if (this.gridOutRoute) {
      this._gridExport =
        this.gridOutRoute.rate > 0 ? this.gridOutRoute.rate : 0;
    } else if (this.gridInRoute) {
      this._gridExport = this.gridInRoute.rate < 0 ? -this.gridInRoute.rate : 0;
    } else {
      this._gridExport = 0;
    }

    const generationTrackedTotal = this._generationTrackedTotal();
    const consumerTrackedTotal = this._consumerTrackedTotal();
    const batteryInTotal = this._batteryInTotal();
    const batteriesOutTotal = this._batteryOutTotal();

    // Balance the books.
    let phantomGridIn = 0;
    let phantomGeneration = 0;
    let untrackedConsumer = 0;
    let batteriesToGridTemp = 0;
    let generationToGridTemp = 0;
    let gridToBatteriesTemp = 0;
    let generationToBatteriesTemp = 0;
    let gridToConsumersTemp = 0;
    // Check if we are exporting more than we are generating plus flowing from
    // batteries.
    let x = this._gridExport - generationTrackedTotal - batteryInTotal;
    if (x > 0) {
      // If this is the case, we create a phantom generation source
      // of sufficient value to balance the equation, and assume that all
      // battery power is going to the grid.
      phantomGeneration = x;
      batteriesToGridTemp = batteryInTotal;
    } else {
      // If we aren't exporting more than generating + discharging, the diagram
      // is provisionally viable without a phantom generation source.
      // *For now* we assume the maximum possible split of battery rate that
      // could go the grid is going to the grid, the rest goes to consumers.
      if (this._gridExport > batteryInTotal) {
        batteriesToGridTemp = batteryInTotal;
      } else {
        batteriesToGridTemp = this._gridExport;
      }
    }
    // Whatever battery out is not going to the grid must be going to consumers.
    let batteriesToConsumersTemp = batteryInTotal - batteriesToGridTemp;

    // The user can specify that their batteries are only charged from
    // generation.
    if (this.batteryChargeOnlyFromGeneration) {
      // In this case, we assume that all the flow into the
      // batteries is coming from generation, and the grid is not contributing
      // at all.
      gridToBatteriesTemp = 0;
      generationToBatteriesTemp = batteriesOutTotal;
    } else if (this.batteryChargeFromGenerationFirst) {
      // Generation (less whatever of it is being exported) charges the
      // batteries first; the grid only makes up any shortfall. Anything the
      // grid can't cover either is left to the phantom generation below.
      const generationToGridMin =
        this._gridExport > batteryInTotal
          ? this._gridExport - batteryInTotal
          : 0;
      const generationAvailable = Math.max(
        0,
        generationTrackedTotal - generationToGridMin
      );
      const shortfall = Math.max(0, batteriesOutTotal - generationAvailable);
      gridToBatteriesTemp = Math.min(gridImport, shortfall);
      generationToBatteriesTemp = batteriesOutTotal - gridToBatteriesTemp;
    } else {
      // Otherwise, we proceed on the basis that the full flow into the battery
      // is coming from the grid (as far as the grid input allows). If there is
      // more flow coming into the batteries than the grid would allow, we
      // assume that the additional flow is coming from generation.
      if (gridImport > batteriesOutTotal) {
        gridToBatteriesTemp = batteriesOutTotal;
      } else {
        gridToBatteriesTemp = gridImport;
        generationToBatteriesTemp = batteriesOutTotal - gridToBatteriesTemp;
      }
    }
    // If we have exceeded the total generation by doing this, we must
    // recalculate the phantom generation source.
    x =
      this._gridExport +
      generationToBatteriesTemp -
      (generationTrackedTotal + gridToBatteriesTemp + batteryInTotal);
    if (x > 0) {
      phantomGeneration = x;
    }

    // All grid input that is not going to batteries must be going to
    // consumers, so we calculate that next.
    gridToConsumersTemp = gridImport - gridToBatteriesTemp;

    // If we are exporting more than is coming from the batteries, we
    // must be generating this amount. We don't know whether it is phantom
    // or real yet.
    if (this._gridExport > batteryInTotal) {
      generationToGridTemp = this._gridExport - batteryInTotal;
    } else {
      generationToGridTemp = 0;
    }

    // Now that we have generation to grid & generation to batteries, the
    // remaining generation must be going to consumers, so we calculate that.
    let generationToConsumersTemp =
      generationTrackedTotal - generationToGridTemp - generationToBatteriesTemp;

    // Clip negative values.
    if (generationToConsumersTemp < 0) {
      generationToConsumersTemp = 0;
    }
    // If the generation to (grid + batteries + consumers) is more than
    // the total generation, we need to recalulate the phantom generation
    // source.
    x =
      generationToGridTemp +
      generationToBatteriesTemp +
      generationToConsumersTemp -
      generationTrackedTotal;
    if (x > 0) {
      phantomGeneration = x;
    }

    // The three items add together to give the consumer total.
    let consumerTotalA =
      generationToConsumersTemp +
      gridToConsumersTemp +
      batteriesToConsumersTemp;

    // Do we have an excess of consumption?
    x = consumerTrackedTotal - consumerTotalA;
    if (x > ZERO_CHECK_TOLERANCE) {
      // There is an unknown energy source.
      if (this.gridInRoute === undefined && this.gridOutRoute === undefined) {
        // If we aren't tracking grid sources, create a phantom one.
        phantomGridIn = x;
        gridToConsumersTemp = x;
        consumerTotalA =
          generationToConsumersTemp +
          gridToConsumersTemp +
          batteriesToConsumersTemp;
      }
    }

    // If the generation to (grid + batteries + consumers) is more than
    // the total generation, we need to recalulate the phantom generation
    // source again
    x =
      generationToGridTemp +
      generationToBatteriesTemp +
      generationToConsumersTemp -
      generationTrackedTotal;
    if (x > ZERO_CHECK_TOLERANCE) {
      phantomGeneration = x;
      // generationToConsumersTemp =
      //   generationTrackedTotal +
      //   phantomGeneration -
      //   (generationToGridTemp + generationToBatteriesTemp);
    }

    if (this._gridExport > batteryInTotal) {
      generationToGridTemp = this._gridExport - batteryInTotal;
    } else {
      generationToGridTemp = 0;
    }

    consumerTotalA =
      generationToConsumersTemp +
      gridToConsumersTemp +
      batteriesToConsumersTemp;

    // If we are still sending more to consumers than we are tracking, we must
    // have untracked consumers (which will almost always be the case).
    x = consumerTotalA - consumerTrackedTotal;
    if (x > 0) {
      // In this case, calculate the size of the untracked consumer.
      untrackedConsumer = x;
    } else {
      // Conversely, if we are consuming more than we are sending to consumers,
      // we have not balanced the books - there must be more generation, so add
      // add to the generationToConsumers flow path.
      generationToConsumersTemp += -x;
      // ... and recalculate the phantom generation.
      phantomGeneration =
        generationToConsumersTemp +
        generationToBatteriesTemp +
        generationToGridTemp -
        generationTrackedTotal;
    }

    this._phantomGridInRoute =
      phantomGridIn > 0
        ? {
            text: "Unknown source",
            icon: mdiHelpRhombus,
            rate: phantomGridIn,
          }
        : undefined;
    this._phantomGenerationInRoute =
      phantomGeneration > 0.01
        ? {
            text: "Unknown source",
            icon: this.unknownSourceIcon || mdiHelpRhombus,
            rate: phantomGeneration,
          }
        : undefined;
    // if we aren't tracking any consumers, use the word 'Home'
    const untrackedName =
      consumerTrackedTotal !== 0
        ? this._localize("untracked", "Untracked")
        : this._localize("home", "Home");
    this._untrackedConsumerRoute = {
      id: UNTRACKED_ID,
      text: untrackedName,
      rate: untrackedConsumer > 0 ? untrackedConsumer : 0,
      icon: this.untrackedIcon,
    };

    /**
     * Calculate and update a scaling factor to make the UI look sensible.
     * Since there is no limit to the value of input/output rates, the scaling
     * needs to be dynamic. This function calculates the scaling factor based
     * on a sensible maximum 'trunk' width.
     */
    const genTotal = generationTrackedTotal + phantomGeneration;
    const gridInTotal =
      gridImport +
      (this._phantomGridInRoute ? this._phantomGridInRoute.rate : 0);
    const consumerTotal =
      consumerTrackedTotal +
      (this._untrackedConsumerRoute ? this._untrackedConsumerRoute.rate : 0);
    this._consumerTotalRate = consumerTotal;

    this._batteriesToGridRate = batteriesToGridTemp;
    this._batteriesToConsumersRate = batteriesToConsumersTemp;
    const batteriesTotal = batteriesToGridTemp + batteriesToConsumersTemp;

    this._generationToConsumersRate = generationToConsumersTemp;
    this._generationToBatteriesRate = generationToBatteriesTemp;
    this._generationToGridRate = generationToGridTemp;

    this._gridToBatteriesRate = gridToBatteriesTemp;
    this._gridToConsumersRate = gridToConsumersTemp;

    const widest_trunk = Math.max(
      genTotal,
      gridInTotal,
      consumerTotal,
      batteriesTotal,
      1.0
    );
    this._autoRateToWidthMultiplier = TARGET_SCALED_TRUNK_WIDTH / widest_trunk;
    this._rateToWidthMultplier =
      TARGET_SCALED_TRUNK_WIDTH /
      Math.max(widest_trunk, this.maxRate && this.maxRate > 0 ? this.maxRate : 0);
  }

  private _rateToWidth(rate: number): number {
    const value = rate * this._rateToWidthMultplier;
    return value > 1 ? value : 1;
  }

  private _generationInFlowWidth(): number {
    const total = this._generationTrackedTotal() + this._generationPhantom();
    if (total === 0) {
      return 0;
    }
    return this._rateToWidth(total);
  }

  private _generationToConsumersFlowWidth(): number {
    if (
      this._generationToConsumersRate == 0 &&
      !this.generationInRoutes.length
    ) {
      return 0;
    }
    const rate = this._generationToConsumersRate;
    return rate ? this._rateToWidth(rate) : 0;
  }

  private _generationToGridFlowWidth(): number {
    const rate = this._generationToGridRate;
    return rate ? this._rateToWidth(rate) : 0;
  }

  private _gridOutFlowWidth(): number {
    const rate = this._gridExport;
    return rate ? this._rateToWidth(rate) : 0;
  }

  private _gridToConsumersFlowWidth(): number {
    const rate = this._gridToConsumersRate;
    return rate ? this._rateToWidth(rate) : 0;
  }

  private _batteriesToGridFlowWidth(): number {
    const rate = this._batteriesToGridRate;
    return rate ? this._rateToWidth(rate) : 0;
  }

  private _batteryToConsumersFlowWidth(): number {
    const rate = this._batteriesToConsumersRate;
    return rate ? this._rateToWidth(rate) : 0;
  }

  private _generationToBatteryFlowWidth(): number {
    const rate = this._generationToBatteriesRate;
    return rate ? this._rateToWidth(rate) : 0;
  }

  private _gridToBatteriesFlowWidth(): number {
    const rate = this._gridToBatteriesRate;
    return rate ? this._rateToWidth(rate) : 0;
  }

  private _genColor(): string {
    return this._cssVarAsHex("--generation-color", GEN_COLOR);
  }

  private _gridColor(): string {
    return this._cssVarAsHex("--grid-in-color", GRID_IN_COLOR);
  }

  private _battColor(): string {
    return this._cssVarAsHex("--batt-in-color", BATT_IN_COLOR);
  }

  private _hexCache = new Map<string, string>();

  /**
   * Reads a colour custom property and returns it as #rrggbb. The blending
   * maths needs hex, but the property may hold any CSS colour (e.g. "red",
   * "rgb(...)", or a user-configured colour), so non-hex values are resolved
   * by the browser via a hidden probe element.
   */
  private _cssVarAsHex(name: string, fallback: string): string {
    const value = getComputedStyle(this).getPropertyValue(name).trim();
    if (!value) {
      return fallback;
    }
    if (/^#[0-9a-f]{6}$/i.test(value)) {
      return value;
    }
    const cached = this._hexCache.get(value);
    if (cached) {
      return cached;
    }
    const probe = document.createElement("span");
    probe.style.display = "none";
    probe.style.color = value;
    if (!probe.style.color) {
      return fallback; // Not a valid CSS colour.
    }
    const parent = this.renderRoot || document.body;
    parent.appendChild(probe);
    const rgb = getComputedStyle(probe).color.match(/\d+(\.\d+)?/g);
    probe.remove();
    const hex =
      rgb && rgb.length >= 3
        ? rgb2hex(Number(rgb[0]), Number(rgb[1]), Number(rgb[2]))
        : fallback;
    this._hexCache.set(value, hex);
    return hex;
  }

  protected _generateLabelDiv(
    _id: string | undefined,
    icon: string | undefined,
    _name: string | undefined,
    valueA: number,
    valueB: number | undefined = undefined,
    _valueAColor: string | undefined = undefined,
    _valueBColor: string | undefined = undefined,
    _displayClass: string | undefined = undefined,
    _: boolean = true,
    topValue: LabelTopValue | undefined = undefined,
    outline: boolean = false
  ): TemplateResult {
    const valueARounded = Math.round(valueA * 10) / 10;
    const valueBRounded = valueB ? Math.round(valueB * 10) / 10 : undefined;

    return html`<div class="label ${outline ? "outlined" : ""}">
      ${topValue
        ? html`${typeof topValue.value === "number"
              ? Math.round(topValue.value)
              : topValue.value}${topValue.unit ?? ""}<br />`
        : nothing}
      ${icon && !isIconName(icon)
        ? svg`<svg x="0" y="0" height=${ICON_SIZE_PX}>
              <path d=${icon} />
            </svg>
            <br />`
        : nothing}${valueBRounded
        ? html`
            OUT ${valueBRounded} ${this.unit}<br />
            IN ${valueARounded} ${this.unit}
          `
        : html`${_name}<br />${valueARounded} ${this.unit} `}
    </div> `;
  }

  /**
   * Custom icon if set; otherwise a level icon when the state of charge is
   * known, or a plain charging/idle battery icon when it isn't.
   */
  protected _batteryIcon(batt: ElecRoutePair): string {
    // batt.out is power going into the battery, i.e. charging.
    const charging = batt.out.rate > 0;
    if (batt.in.icon) {
      return batt.in.icon;
    }
    if (batt.soc !== undefined) {
      return batteryLevelIcon(batt.soc, charging);
    }
    return charging ? mdiBatteryCharging : mdiBattery;
  }

  protected _generationToConsumersRadius(): number {
    return 50 + this._generationToConsumersFlowWidth();
  }

  protected renderGenerationToConsumersFlow(
    x0: number,
    y0: number,
    x15: number,
    x16: number,
    x1: number,
    y1: number,
    y2: number,
    svgScaleX: number
  ): [TemplateResult[] | symbol[], TemplateResult | symbol] {
    const totalGenWidth = this._generationInFlowWidth();
    const genToConsWidth = this._generationToConsumersFlowWidth();
    const genFanOutGap = GENERATION_FAN_OUT_HORIZONTAL_GAP / svgScaleX;
    if (genToConsWidth === 0 && !Object.keys(this.generationInRoutes)) {
      return [[nothing], nothing];
    }
    const count =
      Object.keys(this.generationInRoutes).length +
      (this._phantomGenerationInRoute !== undefined ? 1 : 0);
    const fanOutWidth = totalGenWidth + (count - 1) * genFanOutGap;
    let xA = x0 + totalGenWidth / 2 - fanOutWidth / 2;
    let xB = x0;
    const svgArray: TemplateResult[] = [];
    const divArray: TemplateResult[] = [];

    const startTerminatorY = 0;
    let phantomRate = 0;
    const routes = structuredClone(this.generationInRoutes);
    if (this._phantomGenerationInRoute !== undefined) {
      routes.phantom = this._phantomGenerationInRoute;
      phantomRate = this._phantomGenerationInRoute.rate;
    }
    let i = 0;
    // eslint-disable-next-line guard-for-in
    for (const key in routes) {
      if (Object.prototype.hasOwnProperty.call(routes, key)) {
        // const friendlyName = routes.text;
        let width = 0;
        const rate = routes[key].rate || 0; // Handle undefined (NaN) rates.
        const flowClass =
          key === "phantom" && routes[key] === this._phantomGenerationInRoute
            ? "unknown-source"
            : "generation";
        // Most of the time, if the rate is zero, we don't want to draw it.
        // Exception is if we have a >0 phantom source.
        if (rate || phantomRate > 0) {
          width = this._rateToWidth(rate);
          svgArray.push(
            renderFlowByCorners(
              xA + width,
              startTerminatorY,
              xA,
              startTerminatorY,
              xB + width,
              startTerminatorY + TERMINATOR_BLOCK_LENGTH,
              xB,
              startTerminatorY + TERMINATOR_BLOCK_LENGTH,
              flowClass
            )
          );
          svgArray.push(
            svg`
            <polygon points="${xA + width},${startTerminatorY}
            ${xA},${startTerminatorY},
            ${xA + width / 2},${startTerminatorY + ARROW_HEAD_LENGTH}"
            class="tint"/>
          `
          );
        }

        const midX = xA + width / 2;
        const LABEL_WIDTH = 72;
        const icon = routes[key].icon;
        const id = routes[key].id || undefined;
        if (icon) {
          divArray.push(
            html`<div
              class="label elecroute-label-horiz"
              style="left: ${midX * svgScaleX -
              (i * LABEL_WIDTH) /
                2}px; flex-basis: ${LABEL_WIDTH}px; margin: 0 0 0 ${-LABEL_WIDTH /
              2}px;"
            >
              ${this._generateLabelDiv(
                id,
                icon,
                undefined,
                rate,
                undefined,
                undefined,
                undefined,
                flowClass,
                true,
                routes[key].topValue,
                routes[key].outline
              )}
            </div>`
          );
        }
        xA += width + genFanOutGap;
        xB += width;
      }
      i++;
    }

    const generatedFlowPath2 =
      genToConsWidth > 0
        ? renderFlowByCorners(
            x16,
            y0 - PAD_ANTIALIAS,
            x15,
            y0 - PAD_ANTIALIAS,
            x1,
            y1,
            x1,
            y2,
            "generation"
          )
        : svg``;
    const svgRet = svg`
    ${svgArray}
    ${generatedFlowPath2}
    `;
    return [divArray, svgRet];
  }

  protected renderGenerationToGridFlow(
    x0: number,
    y0: number,
    x11: number,
    y10: number,
    svgScaleX: number
  ): TemplateResult {
    const arrow_head_length = ARROW_HEAD_LENGTH / svgScaleX;
    const width = this._generationToGridFlowWidth();
    if (width === 0) {
      return svg``;
    }
    const generatedFlowPath = renderFlowByCorners(
      x0 + width,
      y0,
      x0,
      y0,
      x11,
      y10 + width,
      x11,
      y10,
      "generation"
    );

    return svg`
    ${generatedFlowPath}
    ${renderRect(
      arrow_head_length,
      y10,
      x11 - arrow_head_length,
      width,
      "generation"
    )}
  `;
  }

  protected renderGridOutFlowArrow(
    x10: number,
    y10: number,
    y2: number,
    svgScaleX: number,
    color: string
  ): TemplateResult | symbol {
    const arrow_head_length = ARROW_HEAD_LENGTH / svgScaleX;
    if (this._gridOutFlowWidth() === 0) {
      return nothing;
    }
    return svg`
    <polygon
      class="grid-out-arrow"
      points="${x10},${y10}
      ${x10},${y2}
      ${x10 - arrow_head_length},${(y10 + y2) / 2}"
      style="${color ? `fill:${color};fill-opacity:1` : ``}"
    />
  `;
  }
  protected renderGenerationToBatteriesFlow(
    x14: number,
    x15: number,
    y0: number,
    y17: number
  ): TemplateResult | symbol {
    if (this._generationToBatteryFlowWidth() === 0) {
      return nothing;
    }

    return svg`
    <rect
      class="generation"
      x="${x14}"
      y="${y0}"
      height="${y17 - y0}"
      width="${x15 - x14}"
    />
    `;
  }

  protected renderGridInFlow(
    y2: number,
    y13: number,
    y10: number,
    svgScaleX: number
  ): [TemplateResult | symbol, TemplateResult | symbol] {
    const gridRoute =
      this.gridInRoute ||
      this.gridOutRoute ||
      this._phantomGridInRoute ||
      undefined;
    if (!gridRoute) {
      return [nothing, nothing];
    }
    const arrow_head_length = ARROW_HEAD_LENGTH / svgScaleX;
    const in_width = y13 - y2;

    const rateA = this._gridImport();
    const rateB = this._gridExport;

    const midY = (y10 + y13) / 2;
    const divHeight = ICON_SIZE_PX + TEXT_PADDING + FONT_SIZE_PX * 2;
    const hasGridExport =
      Object.keys(this.batteryRoutes).length > 0 ||
      Object.keys(this.generationInRoutes).length > 0;
    const divRet = html`<div
      width=${ICON_SIZE_PX * 2}
      class="label elecroute-label-grid"
      style="left: 0px; height:${divHeight}px;
      top: ${midY * svgScaleX}px; margin: ${-divHeight / 2}px 0 0 0px;"
    >
      ${this._generateLabelDiv(
        gridRoute.id,
        gridRoute.icon || mdiTransmissionTower,
        undefined,
        rateA,
        rateB,
        undefined,
        undefined,
        "grid",
        hasGridExport,
        gridRoute.topValue,
        gridRoute.outline
      )}
    </div>`;

    const svgRet = svg`
    <rect
      class="grid"
      id="grid-in-rect"
      x="${0}"
      y="${y2}"
      height="${in_width}"
      width="${arrow_head_length}"
    />
    <polygon points="${0},${y2}
    ${0},${y2 + in_width}
    ${arrow_head_length},${y2 + in_width / 2}"
    class="tint"/>
  `;
    return [divRet, svgRet];
  }

  protected renderGridToConsumersFlow(
    x10: number,
    y2: number,
    y5: number,
    x1: number
  ): TemplateResult | symbol {
    if (this._gridToConsumersFlowWidth() === 0) {
      return nothing;
    }
    return svg`
    <rect
      class="grid"
      id="grid-to-cons-rect"
      x="${x10}"
      y="${y2}"
      height="${y5 - y2}"
      width="${x1 - x10}"
    />`;
  }

  protected renderGridToBatteriesFlow(
    x10: number,
    y5: number,
    y13: number,
    x17: number,
    y17: number,
    x14: number
  ): TemplateResult | symbol {
    if (this._gridToBatteriesFlowWidth() === 0) {
      return nothing;
    }
    return renderFlowByCorners(x10, y5, x10, y13, x14, y17, x17, y17, "grid");
  }

  protected renderBatteriesToConsumersFlow(
    x1: number,
    y5: number,
    y4: number,
    x20: number,
    x21: number,
    y17: number
  ): TemplateResult | symbol {
    if (this._batteryToConsumersFlowWidth() === 0) {
      return nothing;
    }
    return renderFlowByCorners(x20, y17, x21, y17, x1, y5, x1, y4, "battery");
  }

  protected renderBatteriesToGridFlow(
    x15: number,
    y17: number,
    x20: number,
    x11: number,
    y2: number,
    y11: number
  ): TemplateResult | symbol {
    if (this._batteriesToGridFlowWidth() === 0) {
      return nothing;
    }
    return renderFlowByCorners(
      x15,
      y17,
      x20,
      y17,
      x11,
      y2,
      x11,
      y11,
      "battery"
    );
  }

  protected renderGenToGridBlendFlow(
    x10: number,
    y10: number,
    x11: number,
    y11: number,
    endColor: string
  ): TemplateResult | symbol {
    if (!this._generationToGridFlowWidth()) {
      return nothing;
    }
    return renderBlendRect(
      x11,
      y11,
      x11,
      y10,
      x10,
      y11,
      x10,
      y10,
      this._genColor(),
      endColor,
      "gen-grid-out-blend-rect"
    );
  }

  protected renderBatteriesToGridBlendFlow(
    x10: number,
    y11: number,
    x11: number,
    y2: number,
    endColor: string
  ): TemplateResult | symbol {
    if (!this._batteriesToGridFlowWidth()) {
      return nothing;
    }
    return renderBlendRect(
      x11,
      y2,
      x11,
      y11,
      x10,
      y2,
      x10,
      y11,
      this._battColor(),
      endColor,
      "batt-grid-out-blend-rect"
    );
  }
  protected renderGenInBlendFlow(
    y1: number,
    y2: number,
    endColor: string
  ): TemplateResult | symbol {
    if (!this._generationToConsumersFlowWidth()) {
      return nothing;
    }
    return renderBlendRect(
      0,
      y1,
      0,
      y2,
      CONSUMER_BLEND_LENGTH + 1,
      y1,
      CONSUMER_BLEND_LENGTH + 1,
      y2,
      this._genColor(),
      endColor,
      "gen-in-blend-rect"
    );
  }

  protected renderGridInBlendFlow(
    y2: number,
    y5: number,
    endColor: string
  ): TemplateResult | symbol {
    return renderBlendRect(
      0,
      y2,
      0,
      y5,
      CONSUMER_BLEND_LENGTH + 1,
      y2,
      CONSUMER_BLEND_LENGTH + 1,
      y5,
      this._gridColor(),
      endColor,
      "grid-in-blend-rect"
    );
  }

  protected renderBatteriesToConsumersBlendFlow(
    y5: number,
    y4: number,
    endColor: string
  ): TemplateResult | symbol {
    if (this._batteryToConsumersFlowWidth() === 0) {
      return nothing;
    }

    return renderBlendRect(
      0,
      y5,
      0,
      y4,
      CONSUMER_BLEND_LENGTH + 1,
      y5,
      CONSUMER_BLEND_LENGTH + 1,
      y4,
      this._battColor(),
      endColor,
      "batt-in-blend-rect"
    );
  }

  /**
   * Total consumption label, placed just above the top (y1) of the
   * converging trunk in the middle section and coloured like the trunk.
   */
  protected _renderConsumptionTotal(
    y1: number,
    svgScaleX: number,
    color: string
  ): TemplateResult | symbol {
    if (!this.showConsumptionTotal) {
      return nothing;
    }
    return html`<div
      class="consumption-total"
      style="top: ${y1 * svgScaleX}px; color: ${color};"
    >
      ${this._formatTotal(this._consumerTotalRate)}
    </div>`;
  }

  /** Formats the total consumption; subclasses may localise it. */
  protected _formatTotal(rate: number): TemplateResult | string {
    return `${Math.round(rate)} ${this.unit}`;
  }

  protected _renderBlendedFlowPreFanOut(
    y1: number,
    y4: number,
    color: string
  ): TemplateResult {
    const svgRet = svg`
    <rect
      id="blended-flow-pre-fan-out-rect"
      x=${CONSUMER_BLEND_LENGTH}
      y="${y1}"
      height="${y4 - y1}"
      width="${CONSUMER_BLEND_LENGTH_PRE_FAN_OUT + 1}"
      style="fill:${color};fill-opacity:1"
    />
  `;
    return svgRet;
  }

  protected _getExtrasLength(): number {
    return (<typeof ElecSankey>this.constructor).extrasLength;
  }

  protected _insertExtras(
    _topLeftX: number,
    _topLeftY: number,
    _width: number,
    _color: string,
    _route: ElecRoute
  ): TemplateResult {
    return svg``;
  }

  protected _renderConsumerFlow(
    topLeftX: number,
    topLeftY: number,
    topRightX: number,
    topRightY: number,
    consumer: ElecRoute,
    color: string,
    svgScaleX: number,
    count: number = 1
  ): [
    TemplateResult,
    TemplateResult,
    TemplateResult,
    TemplateResult,
    number,
    number,
  ] {
    // A consumer's own colour replaces the blended source colour.
    color = consumer.color || color;
    const width = this._rateToWidth(consumer.rate);
    const xEnd = topRightX;
    const yEnd = topRightY + width / 2;
    const svgFlow = renderFlowByCorners(
      topLeftX,
      topLeftY,
      topLeftX,
      topLeftY + width,
      topRightX + PAD_ANTIALIAS,
      topRightY,
      topRightX + PAD_ANTIALIAS,
      topRightY + width,
      "consumer",
      color
    );
    const extrasLength = this._getExtrasLength();
    const svgExtras = this._insertExtras(
      topRightX,
      topRightY,
      width,
      color,
      consumer
    );

    const id = [UNTRACKED_ID, OTHER_ID].includes(consumer.id ?? "")
      ? undefined
      : consumer.id;
    const divHeight = CONSUMER_LABEL_HEIGHT;
    const divRet = html`<div
      class="label elecroute-label-consumer"
      style="height:${divHeight}px;
      top: ${yEnd * svgScaleX -
      (count * divHeight) / 2}px; margin: ${-divHeight / 2}px 0 0 0;"
    >
      ${this._generateLabelDiv(
        id,
        consumer.icon,
        consumer.text,
        consumer.rate,
        undefined,
        consumer.color,
        undefined,
        undefined,
        true,
        undefined,
        consumer.outline
      )}
    </div>`;

    const svgArrow = svg`
      <polygon points="${extrasLength},${yEnd - width / 2}
        ${extrasLength},${yEnd + width / 2}
        ${extrasLength + ARROW_HEAD_LENGTH},${yEnd}"
        style="fill:${color}" />
    `;

    const bottomLeftY = topLeftY + (consumer.rate !== 0 ? width : 0);
    const bottomRightY = topRightY + width;
    return [divRet, svgFlow, svgExtras, svgArrow, bottomLeftY, bottomRightY];
  }

  private _getGroupedConsumerRoutes(): { [id: string]: ElecRoute } {
    let consumerRoutes: { [id: string]: ElecRoute } =
      sortRoutesByRateDescending(this.consumerRoutes);

    let groupedConsumer: ElecRoute = {
      id: OTHER_ID,
      text: this._localize("other", "Other"),
      rate: 0,
    };
    let groupedConsumerExists = false;

    if (this.hideConsumersBelow > 0) {
      for (const key in consumerRoutes) {
        let rate = consumerRoutes[key].rate || 0; // Treat undef/NaN as 0
        if (rate < this.hideConsumersBelow) {
          groupedConsumer.rate += rate;
          groupedConsumerExists = true;
          delete consumerRoutes[key];
        }
      }
    }

    if (this.maxConsumerBranches !== 0) {
      const numConsumerRoutes = Object.keys(consumerRoutes).length;
      if (numConsumerRoutes > this.maxConsumerBranches - 1) {
        let otherCount = numConsumerRoutes + 2 - this.maxConsumerBranches;
        const ascendingConsumerRoutes =
          sortRoutesByRateAscending(consumerRoutes);
        for (const route of Object.values(ascendingConsumerRoutes)) {
          if (otherCount > 0) {
            groupedConsumer.rate += route.rate || 0;
            groupedConsumerExists = true;
            if (route.id) {
              delete consumerRoutes[route.id];
            }
            otherCount--;
          }
        }
      }
    }
    // Re-sort the consumer routes - deleting can break the order (issue #128).
    consumerRoutes = sortRoutesByRateDescending(consumerRoutes);
    if (groupedConsumerExists) {
      consumerRoutes[groupedConsumer.id!] = groupedConsumer;
    }
    return consumerRoutes;
  }

  protected _renderConsumerFlows(
    y1: number,
    y4: number,
    color: string,
    svgScaleX: number
  ): [
    Array<TemplateResult>,
    Array<TemplateResult>,
    Array<TemplateResult>,
    Array<TemplateResult>,
    number,
  ] {
    const divRetArray: Array<TemplateResult> = [];
    const svgFlowArray: Array<TemplateResult> = [];
    const svgExtraArray: Array<TemplateResult> = [];
    const svgArrowArray: Array<TemplateResult> = [];
    const xLeft = 0;
    const xRight = 100;
    let i = 0;
    const consumerRoutes = this._getGroupedConsumerRoutes();
    const count = Object.keys(consumerRoutes).length;
    const gap = CONSUMERS_FAN_OUT_VERTICAL_GAP / svgScaleX;
    const total_height = y4 - y1 + count * gap;
    let yLeft = y1;
    let yRight = (y1 + y4) / 2 - total_height / 2;
    if (yRight < TEXT_PADDING) {
      yRight = TEXT_PADDING;
    }
    let svgFlow: TemplateResult;
    let divRow: TemplateResult;
    let svgExtra: TemplateResult;
    let svgArrow: TemplateResult;

    for (const key in consumerRoutes) {
      if (Object.prototype.hasOwnProperty.call(consumerRoutes, key)) {
        [divRow, svgFlow, svgExtra, svgArrow, yLeft, yRight] =
          this._renderConsumerFlow(
            xLeft,
            yLeft,
            xRight,
            yRight,
            consumerRoutes[key],
            color,
            svgScaleX,
            i++
          );
        divRetArray.push(divRow);
        svgFlowArray.push(svgFlow);
        svgExtraArray.push(svgExtra);
        svgArrowArray.push(svgArrow);
        yRight += gap;
      }
    }

    [divRow, svgFlow, svgExtra, svgArrow, yLeft, yRight] =
      this._renderConsumerFlow(
        xLeft,
        yLeft,
        xRight,
        yRight,
        this._untrackedConsumerRoute,
        color,
        svgScaleX,
        i++
      );
    divRetArray.push(divRow);
    svgFlowArray.push(svgFlow);
    svgExtraArray.push(svgExtra);
    svgArrowArray.push(svgArrow);
    return [
      divRetArray,
      svgFlowArray,
      svgExtraArray,
      svgArrowArray,
      yRight + CONSUMER_LABEL_HEIGHT / 2,
    ];
  }

  protected renderBatteriesInOutFlow(
    x1: number,
    x17: number,
    x14: number,
    x15: number,
    x21: number,
    y17: number,
    y18: number,
    svgScaleX
  ): [Array<TemplateResult | symbol>, TemplateResult | symbol, number] {
    // Bottom layer
    const svgRetArray: Array<TemplateResult | symbol> = [];
    // Top layer
    const svgRetArray2: Array<TemplateResult | symbol> = [];
    const divRetArray: Array<TemplateResult | symbol> = [];
    // @todo if batteries aren't present, skip.
    const gap = BATTERIES_FAN_OUT_VERTICAL_GAP / svgScaleX;
    const arrow_head_length = ARROW_HEAD_LENGTH / svgScaleX;
    const gridColor = this._gridColor();
    const genColor = this._genColor();

    const ratio = x14 - x17 < 1 ? 0 : (x14 - x17) / (x15 - x17);
    const battOutBlendColor = mixHexes(gridColor, genColor, ratio);
    if (this._gridToBatteriesFlowWidth() !== 0) {
      svgRetArray.push(
        renderBlendRect(
          x14,
          y17,
          x17,
          y17,
          x14,
          y18,
          x17,
          y18,
          gridColor,
          battOutBlendColor,
          "grid-to-batt-blend"
        )
      );
    }
    if (this._generationToBatteryFlowWidth() !== 0) {
      svgRetArray.push(
        renderBlendRect(
          x15,
          y17,
          x14,
          y17,
          x15,
          y18,
          x14,
          y18,
          genColor,
          battOutBlendColor,
          "gen-to-batt-blend"
        )
      );
    }
    if (this._batteryInTotal() > 0) {
      svgRetArray.push(renderRect(x15, y17, x21 - x15, y18 - y17, "battery"));
    }

    const batteryRoutes: { [id: string]: ElecRoutePair } = this.batteryRoutes;
    const divHeight = ICON_SIZE_PX + TEXT_PADDING + FONT_SIZE_PX * 2;

    let xA: number = x21;
    let yA: number = y18;

    let xB: number = x15;
    let count = 0;

    let curvePadTemp = 0;
    for (const key in batteryRoutes) {
      if (!Object.prototype.hasOwnProperty.call(batteryRoutes, key)) {
        console.error("error fetching battery route: " + key);
        continue;
      }
      const batt = batteryRoutes[key];
      const widthOut = batt.out.rate > 0 ? this._rateToWidth(batt.out.rate) : 0;
      const widthIn = batt.in.rate > 0 ? this._rateToWidth(batt.in.rate) : 0;
      curvePadTemp = x1 - x21;
      if (widthIn > 0) {
        svgRetArray.push(
          renderFlowByCorners(
            xA,
            yA,
            xA - widthIn,
            yA,
            x1,
            yA + curvePadTemp,
            x1,
            yA + curvePadTemp + widthIn,
            "battery",
            batt.color || null
          )
        );
        svgRetArray.push(
          svg`
          <polygon points="${x1},${yA + curvePadTemp}
          ${x1 - arrow_head_length},${yA + curvePadTemp + widthIn / 2},
          ${x1},${yA + curvePadTemp + widthIn}"
          class="tint"/>`
        );
        xA -= widthIn;
      }
      if (xA - x15 > 1) {
        svgRetArray.push(
          renderRect(x15, yA, xA - x15, gap + widthOut + widthIn, "battery")
        );
      }
      if (widthOut > 0) {
        svgRetArray2.push(
          renderFlowByCorners(
            xB,
            yA,
            xB - widthOut,
            yA,
            x1 - arrow_head_length,
            yA + curvePadTemp + widthIn,
            x1 - arrow_head_length,
            yA + curvePadTemp + widthIn + widthOut,
            "battery",
            battOutBlendColor
          )
        );
        svgRetArray.push(
          svg`
          <polygon points="${x1 - arrow_head_length},${
            yA + curvePadTemp + widthIn
          }
          ${x1},${yA + curvePadTemp + widthIn + widthOut / 2},
          ${x1 - arrow_head_length},${yA + curvePadTemp + widthIn + widthOut}"
          style="fill:${battOutBlendColor}" />`
        );
        xB -= widthOut;
      }
      if (xB - x17 > 1) {
        svgRetArray.push(
          renderRect(
            x17,
            yA,
            xB - x17,
            gap + widthOut + widthIn,
            "battery-in",
            battOutBlendColor
          )
        );
      }

      divRetArray.push(
        html`<div
          class="label elecroute-label-battery"
          style="height:${divHeight}px;
            top: ${
              (yA + curvePadTemp + (widthOut + widthIn) / 2) * svgScaleX -
              (count * divHeight) / 2
            }px; margin: ${-divHeight / 2}px 0 0 0;"
        >
            ${this._generateLabelDiv(
              batt.in.id,
              this._batteryIcon(batt),
              "",
              batt.out.rate,
              batt.in.rate,
              batt.out.rate > 0 ? battOutBlendColor : undefined,
              batt.color,
              "battery",
              true,
              batt.soc !== undefined
                ? { value: batt.soc, unit: "%", id: batt.socId }
                : undefined,
              batt.outline
            )}
          </div>
        </div>`
      );
      count += 1;

      yA += gap + widthOut + widthIn;
    }

    return [
      divRetArray,
      svg`
      ${svgRetArray}
      ${svgRetArray2}
      `,
      yA - gap + curvePadTemp + divHeight / 2,
    ];
  }

  protected _gridBlendRatio(): number {
    if (!this.gridInRoute) {
      return 0;
    }
    const grid = this.gridInRoute.rate > 0 ? this.gridInRoute.rate : 0;
    const renewable =
      this._generationTrackedTotal() +
      this._generationPhantom() -
      this._gridExport;
    const ratio = grid / (grid + renewable);
    if (ratio < 0) {
      return 0;
    }
    if (ratio > 1) {
      return 1;
    }
    return ratio;
  }

  protected _toConsumersBlendColor(
    genToConsFlow: number,
    gridToConsFlow: number,
    battToConsFlow: number
  ): string {
    const total = genToConsFlow + gridToConsFlow + battToConsFlow;
    if (total === 0) {
      return this._gridColor();
    }
    return mix3Hexes(
      this._genColor(),
      this._gridColor(),
      this._battColor(),
      genToConsFlow / total,
      gridToConsFlow / total,
      battToConsFlow / total
    );
  }

  protected _gridOutBlendColor(
    genToGridFlow: number,
    battToGridFlow: number
  ): string {
    return mixHexes(
      this._genColor(),
      this._battColor(),
      genToGridFlow / (genToGridFlow + battToGridFlow)
    );
  }

  protected _toBatteriesBlendColor(
    gridToBattFlow: number,
    genToBattFlow: number
  ): string {
    return mixHexes(
      this._gridColor(),
      this._battColor(),
      gridToBattFlow / (gridToBattFlow + genToBattFlow)
    );
  }

  protected _calc_xy(): [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    string,
    string,
    string,
  ] {
    const widthGenToConsumers = this._generationToConsumersFlowWidth();
    const widthGenToGrid = this._generationToGridFlowWidth();
    const widthGenToBatteries = this._generationToBatteryFlowWidth();
    const widthBatteriesToGrid = this._batteriesToGridFlowWidth();
    const widthGridToBatteries = this._gridToBatteriesFlowWidth();
    const widthBatteriesToConsumers = this._batteryToConsumersFlowWidth();
    const widthGridToConsumers = this._gridToConsumersFlowWidth();

    const mostLeft = Math.min(-widthGenToGrid, -widthGridToBatteries);
    const mostRight =
      widthGenToBatteries +
      Math.max(
        widthGenToConsumers,
        widthBatteriesToGrid + widthBatteriesToConsumers
      );
    const width = mostRight - mostLeft;
    const padX =
      Math.max(
        widthGenToGrid,
        widthGenToConsumers,
        widthGridToBatteries,
        widthBatteriesToConsumers,
        30
      ) * PAD_MULTIPLIER;
    const midX = ARROW_HEAD_LENGTH + GRID_BLEND_LENGTH + width / 2 + padX;

    const x0 =
      ARROW_HEAD_LENGTH + GRID_BLEND_LENGTH + widthGenToGrid >
      widthGridToBatteries
        ? midX - width / 2
        : midX - width / 2 + widthGridToBatteries - widthGenToGrid;
    const y0 = TERMINATOR_BLOCK_LENGTH;

    const y1 =
      TERMINATOR_BLOCK_LENGTH +
      Math.max(
        padX,
        widthGenToConsumers,
        padX + widthGenToGrid + widthBatteriesToGrid - widthGenToConsumers,
        widthGenToGrid * 2 + widthBatteriesToGrid - widthGenToConsumers
      );
    const x1: number = midX + width / 2 + padX;

    const y2: number = y1 + widthGenToConsumers;

    const y5 = y2 + widthGridToConsumers;
    const y10 = y2 - this._generationToGridFlowWidth() - widthBatteriesToGrid;

    const gridOutBlendColor = this._gridOutBlendColor(
      widthGenToGrid,
      widthBatteriesToGrid
    );
    const toConsumersBlendColor = this._toConsumersBlendColor(
      widthGenToConsumers,
      widthGridToConsumers,
      widthBatteriesToConsumers
    );
    const toBatteriesBlendColor = this._toBatteriesBlendColor(
      widthGridToBatteries,
      widthGenToBatteries
    );
    return [
      x0,
      y0,
      x1,
      y1,
      y2,
      y5,
      y10,
      gridOutBlendColor,
      toConsumersBlendColor,
      toBatteriesBlendColor,
    ];
  }

  protected render(): TemplateResult {
    this._recalculate();
    let minHeightPx = 0;
    if (this._rateToWidthMultplier < this._autoRateToWidthMultiplier) {
      // Below maxRate the lines are drawn thinner than full scale, which
      // would also make the diagram shorter. To keep the card a constant
      // size, lay it out once at full scale (as auto-scaling would) just to
      // measure its height, then reserve that height for the real diagram.
      const actual = this._rateToWidthMultplier;
      this._rateToWidthMultplier = this._autoRateToWidthMultiplier;
      minHeightPx = this._renderLayout()[1];
      this._rateToWidthMultplier = actual;
    }
    return this._renderLayout(minHeightPx)[0];
  }

  /**
   * Lays out and renders the diagram at the current scale. Returns the
   * template and the diagram's height in px. `minHeightPx` pads the diagram
   * (blank space at the bottom) up to at least that height.
   */
  private _renderLayout(minHeightPx: number = 0): [TemplateResult, number] {
    const [
      x0,
      y0,
      x1,
      y1,
      y2,
      y5,
      y10,
      gridOutBlendColor,
      toConsumersBlendColor,
      toBatteriesBlendColor, // TODO refactor this
    ] = this._calc_xy();

    const svgCanvasWidth = x1;
    const svgVisibleWidth = SVG_LHS_VISIBLE_WIDTH;
    const svgScaleX = svgVisibleWidth / svgCanvasWidth;
    const x10 = ARROW_HEAD_LENGTH / svgScaleX;
    const x11 = x10 + GRID_BLEND_LENGTH;

    const generationToGridFlowSvg = this.renderGenerationToGridFlow(
      x0,
      y0,
      x11,
      y10,
      svgScaleX
    );
    const gridOutArrowSvg = this.renderGridOutFlowArrow(
      x10,
      y10,
      y2,
      svgScaleX,
      gridOutBlendColor
    );

    const genInBlendFlowSvg = this.renderGenInBlendFlow(
      y1,
      y2,
      toConsumersBlendColor
    );

    const gridInBlendFlowSvg = this.renderGridInBlendFlow(
      y2,
      y5,
      toConsumersBlendColor
    );

    const y11 = y2 - this._batteriesToGridFlowWidth();
    const y13 = y5 + this._gridToBatteriesFlowWidth();

    const y17 = y13 + (y10 - y0);

    const x14 = x0 + this._generationToGridFlowWidth();
    const x15 = x14 + this._generationToBatteryFlowWidth();
    const x16 = x15 + this._generationToConsumersFlowWidth();
    const x17 = x14 - this._gridToBatteriesFlowWidth();
    const x20 = x15 + this._batteriesToGridFlowWidth();
    const x21 = x20 + this._batteryToConsumersFlowWidth();

    const y4 = y5 + this._batteryToConsumersFlowWidth();
    const y18 = y17 + BATTERY_BLEND_LENGTH;

    const genToGridBlendSvg = this.renderGenToGridBlendFlow(
      x10,
      y10,
      x11,
      y11,
      gridOutBlendColor
    );
    const [gridInDiv, gridInFlowSvg] = this.renderGridInFlow(
      y2,
      y13,
      y10,
      svgScaleX
    );
    const gridToConsumersFlowSvg = this.renderGridToConsumersFlow(
      x10,
      y2,
      y5,
      x1
    );

    const genToBattFlowSvg = this.renderGenerationToBatteriesFlow(
      x14,
      x15,
      y0,
      y17
    );
    const [genInFlowDiv, genInFlowSvg] = this.renderGenerationToConsumersFlow(
      x0,
      y0,
      x15,
      x16,
      x1,
      y1,
      y2,
      svgScaleX
    );
    const [
      consOutFlowsDiv,
      consOutFlowsSvg,
      consOutExtrasSvg,
      consOutArrowsSvg,
      y8,
    ] = this._renderConsumerFlows(y1, y4, toConsumersBlendColor, svgScaleX);
    const gridToBattFlowSvg = this.renderGridToBatteriesFlow(
      x10,
      y5,
      y13,
      x17,
      y17,
      x14
    );
    const battToConsFlowSvg = this.renderBatteriesToConsumersFlow(
      x1,
      y5,
      y4,
      x20,
      x21,
      y17
    );
    const battToGridFlowSvg = this.renderBatteriesToGridFlow(
      x15,
      y17,
      x20,
      x11,
      y2,
      y11
    );
    const battToGridBlendFlowSvg = this.renderBatteriesToGridBlendFlow(
      x10,
      y11,
      x11,
      y2,
      gridOutBlendColor
    );
    const [batteriesFlowInOutDiv, battInOutBlendSvg, y22] =
      this.renderBatteriesInOutFlow(
        x1,
        x17,
        x14,
        x15,
        x21,
        y17,
        y18,
        svgScaleX
      );

    const battToConsBlendFlowSvg = this.renderBatteriesToConsumersBlendFlow(
      y5,
      y4,
      toConsumersBlendColor
    );

    const blendedFlowPreFanOut = this._renderBlendedFlowPreFanOut(
      y1,
      y4,
      toConsumersBlendColor
    );
    const ymax = Math.max(y4, y8, y22 + 30, minHeightPx / svgScaleX);
    const arrowBoxWidth = ARROW_HEAD_LENGTH + this._getExtrasLength();
    // Consumer labels with an icon need extra room for it beside the text.
    const hasConsumerIcons =
      !!this.untrackedIcon ||
      Object.values(this.consumerRoutes).some((route) => !!route.icon);
    const hasOutlines =
      !!this.gridInRoute?.outline ||
      !!this.gridOutRoute?.outline ||
      Object.values(this.generationInRoutes).some((r) => r.outline) ||
      Object.values(this.consumerRoutes).some((r) => r.outline) ||
      Object.values(this.batteryRoutes).some((b) => b.outline);
    return [
      html`<div class="card-content ${hasOutlines ? "has-outlines" : ""}">
      <div class="col1 container">
        <div class="col1top padding"></div>
        ${gridInDiv}
      </div>
      <div class="col2 container">
        <div class="col2top container">${genInFlowDiv}</div>
        <div class="col2bottom container">
          <div class="sankey-left">
            <svg
              viewBox="0 0 ${svgCanvasWidth} ${ymax}"
              width="100%"
              style="min-width: ${svgVisibleWidth}px"
              height=${ymax * svgScaleX}
              preserveAspectRatio="none"
            >
              ${genInFlowSvg} ${generationToGridFlowSvg} ${genToGridBlendSvg}
              ${gridOutArrowSvg} ${genToBattFlowSvg} ${gridToBattFlowSvg}
              ${battToGridBlendFlowSvg} ${gridInFlowSvg}
              ${gridToConsumersFlowSvg} ${battToConsFlowSvg}
              ${battToGridFlowSvg} ${battInOutBlendSvg}
            </svg>
          </div>
          <div class="sankey-mid">
            <div class="layer-wrapper">
              <div class="sankey-mid-svg" width="100%">
                <svg
                  viewBox="0 0 100 ${ymax}"
                  width="100%"
                  height=${ymax * svgScaleX}
                  preserveAspectRatio="none"
                >
                  ${genInBlendFlowSvg} ${gridInBlendFlowSvg}
                  ${battToConsBlendFlowSvg} ${blendedFlowPreFanOut}
                </svg>
              </div>
              <div class="sankey-mid-labels">
                ${batteriesFlowInOutDiv}
                ${this._renderConsumptionTotal(
                  y1,
                  svgScaleX,
                  toConsumersBlendColor
                )}
              </div>
            </div>
          </div>
          <div class="sankey-right">
            <svg
              viewBox="0 0 100 ${ymax}"
              width="100%"
              height=${ymax * svgScaleX}
              preserveAspectRatio="none"
            >
              ${consOutFlowsSvg}
            </svg>
          </div>
          <div class="sankey-far-right">
            <svg
              viewBox="0 0 ${arrowBoxWidth} ${ymax}"
              width="100%"
              style="min-width: ${arrowBoxWidth}px"
              height=${ymax * svgScaleX}
              preserveAspectRatio="none"
            >
              ${consOutExtrasSvg} ${consOutArrowsSvg}
            </svg>
          </div>
        </div>
      </div>
      <div class="col3 container ${hasConsumerIcons ? "has-icons" : ""}">
        <div class="col3top padding"></div>
        ${consOutFlowsDiv}
      </div>
    </div>`,
      ymax * svgScaleX,
    ];
  }

  static get styles(): CSSResultGroup {
    return css`
      .card-content {
        position: relative;
        direction: ltr;
        display: flex;
      }
      .col1 {
        flex: 1;
        min-width: 60px;
        max-width: 120px;
      }
      .col1top {
        height: 60px;
      }
      .col2 {
        justify-content: left;
        flex-grow: 1;
      }
      .col2top {
        height: 60px;
        display: flex;
        justify-content: left;
      }
      .col2bottom {
        display: flex;
        justify-content: left;
      }
      .sankey-left {
        flex: 1;
        flex-grow: 0;
      }
      .sankey-mid {
        flex: 1;
        flex-grow: 1;
        min-width: 20px;
        position: relative;
      }
      .layer-wrapper {
        position: relative;
        width: 100%;
        height: 100%;
      }
      .sankey-mid-labels {
        width: 100%;
        height: 100%;
        position: absolute;
      }
      /*
       * Sits centred above the trunk; may overhang a narrow middle section.
       * translate(-50%, -100%) puts its bottom-centre on (50%, top).
       */
      .consumption-total {
        position: absolute;
        left: 50%;
        transform: translate(-50%, -100%);
        padding-bottom: 2px;
        white-space: nowrap;
        font-size: 12px;
        font-weight: 500;
        pointer-events: none;
        /*
         * On narrow cards the middle section is thinner than the text, so
         * it can overhang neighbouring flows. A thin card-coloured halo
         * around the glyphs keeps it readable without blanking out a block
         * of the diagram.
         */
        --halo: var(--ha-card-background, var(--card-background-color, #fff));
        text-shadow:
          0 0 2px var(--halo),
          0 0 2px var(--halo),
          0 0 1px var(--halo);
      }
      .sankey-mid-svg {
        width: 100%;
        height: 100%;
        position: absolute;
      }
      .sankey-right {
        flex: 1;
        flex-grow: 2;
        min-width: 40px;
      }
      .sankey-far-right {
        flex: 1;
        flex-grow: 0;
        min-width: ${this.extrasLength + ARROW_HEAD_LENGTH}px;
      }
      /*
       * Consumer label column. It grows with the card up to max-width, taking
       * room from the stretchable fan-out (.sankey-right). The widths can be
       * overridden with the CSS variables below (e.g. via card-mod).
       */
      .col3 {
        flex: 1;
        min-width: var(--elec-sankey-consumer-label-min-width, 85px);
        max-width: var(--elec-sankey-consumer-label-max-width, 140px);
        padding: 0px 12px 0px 0px;
      }
      .col3.has-icons {
        /* Add the width of a 24px icon plus its 4px margin. */
        min-width: calc(
          var(--elec-sankey-consumer-label-min-width, 85px) + 15px
        );
        max-width: calc(
          var(--elec-sankey-consumer-label-max-width, 140px) + 15px
        );
      }
      .col3top {
        height: 60px;
      }
      .label {
        flex: 1;
        position: relative;
        font-size: 10px;
      }
      .elecroute-label-grid {
        display: flex;
        /* The div is centred on the grid flow; centre its content too. */
        align-items: center;
        text-align: center;
      }
      .elecroute-label-battery {
        display: flex;
        /* The div is centred on the battery flow; centre its content too. */
        align-items: center;
        min-width: 60px;
        padding-left: 6px;
        text-align: center;
      }
      /*
       * Size the inner label to its content so the icon and value centre on
       * each other, while the block itself stays at the left, next to the
       * battery flow.
       */
      .elecroute-label-battery > .label {
        flex: 0 0 auto;
      }
      /*
       * Optional rounded outline around a label. The label shrinks to its
       * content (instead of filling its column) so the outline hugs it.
       * Colour and radius can be themed with the CSS variables below.
       */
      .label.outlined {
        flex: 0 1 auto;
        min-width: 0;
        box-sizing: border-box;
        border: 1px solid
          var(--elec-sankey-outline-color, var(--divider-color, #8888));
        border-radius: var(--elec-sankey-outline-radius, 8px);
        padding: 3px 6px;
      }
      /* Grid and generation labels are centred in their space. */
      .elecroute-label-grid > .label.outlined,
      .elecroute-label-horiz > .label.outlined {
        margin: 0 auto;
      }
      .elecroute-label-horiz > .label.outlined {
        align-self: center;
      }
      /* Battery values must not wrap (the label sits beside the flow). */
      .elecroute-label-battery > .label.outlined {
        flex: 0 0 auto;
      }
      /*
       * Outlines add height, so give the top strip (generation labels, and
       * the matching spacers above the grid and consumer columns) more room.
       * All three must stay equal to keep labels aligned with the flows.
       */
      .card-content.has-outlines .col1top,
      .card-content.has-outlines .col2top,
      .card-content.has-outlines .col3top {
        height: 68px;
      }
      .elecroute-label-horiz {
        display: flex;
        flex: 0 0 auto;
        flex-grow: 0;
        flex-shrink: 0;
        text-align: center;
      }
      .elecroute-label-consumer {
        display: flex;
        align-items: center;
        text-align: left;
        flex-grow: 0;
        flex-shrink: 0;
        justify-content: left;
        padding-left: 6px;
        white-space: pre;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      svg {
        rect {
          stroke: none;
          stroke-width: 0;
        }
        path {
          stroke: none;
          stroke-width: 0;
        }
        path.grid {
          fill: var(--grid-in-color, #920e83);
        }
        path.battery {
          fill: var(--batt-in-color, #01f4fc);
        }
        polygon {
          stroke: none;
        }
        polygon.generation {
          fill: var(--generation-color, #0d6a04);
        }
        polygon.grid {
          fill: var(--grid-in-color, #920e83);
        }
        path.unknown-source {
          fill: var(--unknown-source-color, #8c8c8c);
        }
        polygon.tint {
          fill: #000000;
          opacity: 0.2;
        }
        path.generation {
          fill: var(--generation-color, #0d6a04);
          stroke: var(--generation-color, #0d6a04);
          stroke-width: 0;
        }
        rect.generation {
          fill: var(--generation-color, #0d6a04);
          stroke-width: 0;
        }
        rect.grid {
          fill: var(--grid-in-color, #920e83);
        }
        rect.battery {
          fill: var(--batt-in-color, #01f4fc);
        }
      }
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "elec-sankey": ElecSankey;
  }
}
