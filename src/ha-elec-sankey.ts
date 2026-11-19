import { customElement, property } from "lit/decorators.js";

import { CSSResultArray, TemplateResult, css, html, nothing } from "lit";
import { mdiArrowLeft, mdiArrowRight } from "@mdi/js";
import { ElecSankey, isIconName, LabelTopValue } from "./elec-sankey";
import { HomeAssistant } from "./ha/types";
import { formatNumber } from "./ha/common/number/format_number";

import { fireEvent } from "./ha/common/dom/fire_event";
import { setupCustomlocalize } from "./localize";

// Additional items from frontend src/dialogs/more-info/ha-more-info-dialog.ts
type View = "info" | "history" | "settings" | "related";

export interface MoreInfoDialogParams {
  entityId: string | null;
  view?: View;
  /** @deprecated Use `view` instead */
  tab?: View;
}

declare global {
  // for fire event
  interface HASSDomEvents {
    "hass-more-info": MoreInfoDialogParams;
  }
}
// end of additional items from frontend src/dialogs/more-info/ha-more-info-dialog.ts

@customElement("ha-elec-sankey")
export class HaElecSankey extends ElecSankey {
  @property({ attribute: false }) public hass!: HomeAssistant;

  private _localizer: (key: string) => string = (key: string): string => {
    return key;
  };

  private _localizerIsSetup = false;

  protected _localize = (key: string): string => {
    if (!this._localizerIsSetup) {
      this._localizer = setupCustomlocalize(this.hass);
      this._localizerIsSetup = true;
    }
    // The low level card ElecSankey doesn't know anything about the card
    // prefix, so we need to add it here.
    if (!key.startsWith("card.")) {
      key = "card.generic." + key;
    }
    return this._localizer(key);
  };

  protected _generateLabelDiv(
    id: string | undefined,
    icon: string | undefined,
    _name: string | undefined,
    valueA: number,
    valueB: number | undefined,
    valueAColor: string | undefined = undefined,
    valueBColor: string | undefined = undefined,
    displayClass: string | undefined = undefined,
    showLeftValue: boolean = true,
    topValue: LabelTopValue | undefined = undefined,
    outline: boolean = false,
  ): TemplateResult {
    const _id = id || "";
    // With a name (consumers), the icon goes to the side of the name and
    // value; otherwise (grid, generation, battery) it sits above the values.
    const sideIcon = !!(icon && _name);
    const iconHtml = !icon
      ? nothing
      : isIconName(icon)
        ? html`<ha-icon id=${_id} .icon=${icon}></ha-icon>`
        : html`<ha-svg-icon id=${_id} .path=${icon}></ha-svg-icon>`;
    const numFractionDigits = this.unit === "kWh" ? 1 : 0;
    const body = this._generateLabelBody(
      _id,
      _name,
      valueA,
      valueB,
      valueAColor,
      valueBColor,
      displayClass,
      showLeftValue,
      numFractionDigits,
    );
    // Shown above the icon. Its own id lets a click open the more-info
    // dialog of that value's entity (e.g. the battery level sensor).
    let topText: string | undefined;
    if (topValue) {
      topText =
        typeof topValue.value === "number"
          ? formatNumber(Math.round(topValue.value), this.hass.locale)
          : topValue.value;
      if (topValue.unit) {
        topText += `\u00a0${topValue.unit}`;
      }
    }
    const topValueHtml =
      topText !== undefined
        ? html`<span class="top-value" id=${topValue!.id || _id}
              >${topText}</span
            ><br />`
        : nothing;
    // prettier-ignore
    return html`<div
      class="label ${id ? "label-action-clickable " : ""}${sideIcon ? "label-side-icon " : ""}${outline ? "outlined " : ""}${displayClass}"
      id=${_id}
      @click=${id ? this._handleMoreInfo : nothing}
    >${sideIcon
        ? html`${iconHtml}<div class="label-text" id=${_id}>${body}</div>`
        : html`${topValueHtml}${iconHtml}${body}`}</div>`;
  }

  private _generateLabelBody(
    _id: string,
    _name: string | undefined,
    valueA: number,
    valueB: number | undefined,
    valueAColor: string | undefined,
    valueBColor: string | undefined,
    displayClass: string | undefined,
    showLeftValue: boolean,
    numFractionDigits: number,
  ): TemplateResult {
    const format = (value: number) =>
      formatNumber(value, this.hass.locale, {
        maximumFractionDigits: numFractionDigits,
      });
    const directionSpan = (
      direction: "left" | "right",
      value: number,
      color: string | undefined,
    ) =>
      // prettier-ignore
      html`<span
        class="direction${direction} ${displayClass}"
        style=${color ? `color:${color}` : nothing}
        id=${_id}
      ><ha-svg-icon
          id=${_id}
          class="small"
          .path=${direction === "left" ? mdiArrowLeft : mdiArrowRight}
        ></ha-svg-icon>${format(value)}&nbsp;${this.unit}</span>`;

    let values: TemplateResult;
    if (valueB === undefined) {
      // Like bidirectional values at 0, a value that rounds to zero is shown
      // in the neutral text colour rather than its flow colour.
      const isZero = Number(valueA.toFixed(numFractionDigits)) === 0;
      values = html`<br /><span
          class="value ${isZero ? "" : (displayClass ?? "")}"
          style=${valueAColor && !isZero ? `color:${valueAColor}` : nothing}
          id=${_id}
          >${format(valueA)}&nbsp;${this.unit}</span
        >`;
    } else if (this.netBidirectionalValues) {
      // Single value: valueA is flow to the right (e.g. grid import,
      // battery charging), valueB to the left (grid export, discharging).
      const net = valueA - valueB;
      const rounded = Number(net.toFixed(numFractionDigits));
      values =
        rounded > 0
          ? html`<br />${directionSpan("right", net, valueAColor)}`
          : rounded < 0
            ? html`<br />${directionSpan("left", -net, valueBColor)}`
            : html`<br />${format(0)}&nbsp;${this.unit}`;
    } else {
      values = html`<br />${showLeftValue
          ? directionSpan("left", valueB, valueBColor)
          : nothing}<br />${directionSpan("right", valueA, valueAColor)}`;
    }
    return html`${_name || nothing}${values}`;
  }

  protected _formatTotal(rate: number): string {
    const numFractionDigits = this.unit === "kWh" ? 1 : 0;
    return `${formatNumber(rate, this.hass.locale, {
      maximumFractionDigits: numFractionDigits,
    })}\u00a0${this.unit}`;
  }

  private _handleMoreInfo(e: MouseEvent) {
    const div = e.target as HTMLDivElement;
    fireEvent(this, "hass-more-info", {
      entityId: div.id,
    });
  }

  static get styles(): CSSResultArray {
    return [
      super.styles,
      css`
        ha-card:focus {
          outline: none;
        }
        .card-header {
          padding-bottom: 0;
        }
        .name {
          text-align: center;
          line-height: initial;
          color: var(--primary-text-color);
          width: 100%;
          font-size: 15px;
          margin-top: 8px;
        }
        .label {
          font-size: 12px;
        }
        .label-action-clickable {
          cursor: pointer;
        }
        ha-svg-icon {
          --icon-primary-color: var(--icon-primary-color);
        }
        ha-svg-icon.small {
          --mdc-icon-size: 12px;
        }
        .label-side-icon {
          display: flex;
          align-items: center;
        }
        .label-side-icon > ha-icon,
        .label-side-icon > ha-svg-icon {
          flex-shrink: 0;
          margin-inline-end: 4px;
        }
        .label-side-icon > .label-text {
          overflow: hidden;
          text-overflow: ellipsis;
        }
        /* Value colours follow their flow colours (configurable per card). */
        .directionright.grid {
          color: var(--grid-in-color, var(--energy-grid-consumption-color));
        }
        .directionleft.grid {
          color: var(--energy-grid-return-color);
        }
        /* Same colour as the generation flow. */
        .value.generation {
          color: var(--generation-color, #0d6a04);
        }
        .value.unknown-source {
          color: var(--unknown-source-color, #8c8c8c);
        }
        .directionleft.battery {
          color: var(--batt-in-color, var(--energy-battery-out-color));
        }
      `,
    ];
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "ha-elec-sankey": HaElecSankey;
  }
}
