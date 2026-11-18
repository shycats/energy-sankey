import { mdiClose, mdiDrag, mdiPencil } from "@mdi/js";
import type { CSSResultGroup } from "lit";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat";
import { fireEvent } from "../../../common/dom/fire_event";
import { computeStateName } from "../../../common/entity/compute_state_name";
import "../../../components/ha-textfield";
import type { HaEntityPicker } from "../../../components/entity/ha-entity-picker";
import type { HomeAssistant } from "../../../types";
import type { EntityConfig, LovelaceRowConfig } from "../entity-rows/types";

declare global {
  interface HASSDomEvents {
    "entities-changed": {
      entities: LovelaceRowConfig[];
    };
  }
}

@customElement("elec-sankey-hui-entities-card-row-editor")
export class HuiEntitiesCardRowEditor extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @property({ attribute: false }) public entities?: LovelaceRowConfig[];

  @property() public includeDeviceClasses?: string[];

  @property() public label?: string;

  @property() public subLabel?: string;

  /** When set, each row shows a text field for a custom display name. */
  @property({ type: Boolean }) public showNameField = false;

  @property() public nameLabel?: string;

  /** When set, each row shows an icon picker for a custom icon. */
  @property({ type: Boolean }) public showIconField = false;

  @property() public iconLabel?: string;

  /** When set, each row shows a picker for a battery state of charge sensor. */
  @property({ type: Boolean }) public showSocField = false;

  @property() public socLabel?: string;

  /** When set, each row shows a text field for a colour (CSS or template). */
  @property({ type: Boolean }) public showColorField = false;

  @property() public colorLabel?: string;

  /** When set, each row shows a toggle for an outline around its label. */
  @property({ type: Boolean }) public showOutlineField = false;

  @property() public outlineLabel?: string;

  private _entityKeys = new WeakMap<LovelaceRowConfig, string>();

  private _getKey(action: LovelaceRowConfig) {
    if (!this._entityKeys.has(action)) {
      this._entityKeys.set(action, Math.random().toString());
    }

    return this._entityKeys.get(action)!;
  }

  protected render() {
    if (!this.entities || !this.hass) {
      return nothing;
    }
    const deviceClassesFilter = this.includeDeviceClasses
      ? '["' + this.includeDeviceClasses?.join('","') + '"]'
      : "";

    return html`
      <h3>
        ${this.label ||
      `${this.hass!.localize(
        "ui.panel.lovelace.editor.card.generic.entities"
      )} (${this.hass!.localize(
        "ui.panel.lovelace.editor.card.config.required"
      )})`}
      </h3>
      <ha-sortable handle-selector=".handle" @item-moved=${this._rowMoved}>
        <div class="entities">
          ${repeat(
        this.entities,
        (entityConf) => this._getKey(entityConf),
        (entityConf, index) => html`
              <div class="entity">
                <div class="handle">
                  <ha-svg-icon .path=${mdiDrag}></ha-svg-icon>
                </div>
                ${entityConf.type
            ? html`
                      <div class="special-row">
                        <div>
                          <span>
                            ${this.hass!.localize(
              `ui.panel.lovelace.editor.card.entities.entity_row.${entityConf.type}`
            )}
                          </span>
                          <span class="secondary"
                            >${this.hass!.localize(
              "ui.panel.lovelace.editor.card.entities.edit_special_row"
            )}</span
                          >
                        </div>
                      </div>
                    `
            : html`
                      <div class="entity-fields">
                        <ha-entity-picker
                          allow-custom-entity
                          include-device-classes=${deviceClassesFilter}
                          hideClearIcon
                          label=${this.subLabel || nothing}
                          .hass=${this.hass}
                          .value=${(entityConf as EntityConfig).entity}
                          .index=${index}
                          @value-changed=${this._valueChanged}
                        ></ha-entity-picker>
                        ${this.showNameField
                          ? this._renderNameField(
                              entityConf as EntityConfig,
                              index
                            )
                          : nothing}
                        ${this.showIconField
                          ? this._renderIconField(
                              entityConf as EntityConfig,
                              index
                            )
                          : nothing}
                        ${this.showSocField
                          ? this._renderSocField(
                              entityConf as EntityConfig,
                              index
                            )
                          : nothing}
                        ${this.showColorField
                          ? this._renderColorField(
                              entityConf as EntityConfig,
                              index
                            )
                          : nothing}
                        ${this.showOutlineField
                          ? this._renderOutlineField(
                              entityConf as EntityConfig,
                              index
                            )
                          : nothing}
                      </div>
                    `}
                <ha-icon-button
                  .label=${this.hass!.localize(
              "ui.components.entity.entity-picker.clear"
            )}
                  .path=${mdiClose}
                  class="remove-icon"
                  .index=${index}
                  @click=${this._removeRow}
                ></ha-icon-button>
              </div>
            `
      )}
        </div>
      </ha-sortable>
      <ha-entity-picker
        class="add-entity"
        include-device-classes=${deviceClassesFilter}
        label=${this.subLabel || nothing}
        .hass=${this.hass}
        @value-changed=${this._addEntity}
      ></ha-entity-picker>
    `;
  }

  private _renderNameField(entityConf: EntityConfig, index: number) {
    const stateObj = entityConf.entity
      ? this.hass!.states[entityConf.entity]
      : undefined;
    return html`
      <ha-textfield
        class="name-field"
        .label=${this.nameLabel || "Name"}
        .placeholder=${stateObj ? computeStateName(stateObj) : ""}
        .value=${entityConf.name || ""}
        .index=${index}
        @change=${this._nameChanged}
      ></ha-textfield>
    `;
  }

  private _renderIconField(entityConf: EntityConfig, index: number) {
    // A nested <ha-form> is used (rather than <ha-icon-picker> directly)
    // because ha-form is always defined in the card editor, and it lazily
    // loads the icon selector itself.
    return html`
      <ha-form
        class="icon-field"
        .hass=${this.hass}
        .data=${{ entity: entityConf.entity, icon: entityConf.icon }}
        .schema=${[
          {
            name: "icon",
            selector: { icon: {} },
            context: { icon_entity: "entity" },
          },
        ]}
        .computeLabel=${() => this.iconLabel || "Icon"}
        .index=${index}
        @value-changed=${this._iconChanged}
      ></ha-form>
    `;
  }

  private _renderSocField(entityConf: EntityConfig, index: number) {
    return html`
      <ha-form
        class="soc-field"
        .hass=${this.hass}
        .data=${{ soc_entity: (entityConf as any).soc_entity }}
        .schema=${[
          {
            name: "soc_entity",
            selector: { entity: { domain: "sensor", device_class: "battery" } },
          },
        ]}
        .computeLabel=${() => this.socLabel || "State of charge"}
        .index=${index}
        @value-changed=${this._socChanged}
      ></ha-form>
    `;
  }

  private _renderColorField(entityConf: EntityConfig, index: number) {
    // A plain text field (not a colour picker) so templates can be entered.
    // Saved on "change" for the same focus reason as the name field.
    return html`
      <ha-textfield
        class="color-field"
        .label=${this.colorLabel || "Color"}
        .placeholder=${"#ff9800, red or {{ template }}"}
        .value=${(entityConf as any).color || ""}
        .index=${index}
        @change=${this._colorChanged}
      ></ha-textfield>
    `;
  }

  private _renderOutlineField(entityConf: EntityConfig, index: number) {
    return html`
      <ha-form
        class="outline-field"
        .hass=${this.hass}
        .data=${{ outline: !!(entityConf as any).outline }}
        .schema=${[{ name: "outline", selector: { boolean: {} } }]}
        .computeLabel=${() => this.outlineLabel || "Outline"}
        .index=${index}
        @value-changed=${this._outlineChanged}
      ></ha-form>
    `;
  }

  private _outlineChanged(ev: CustomEvent): void {
    ev.stopPropagation();
    const index = (ev.currentTarget as any).index;
    const newConfigEntities = this.entities!.concat();
    const newRow: any = { ...newConfigEntities[index] };
    if (ev.detail.value?.outline) {
      newRow.outline = true;
    } else {
      delete newRow.outline;
    }
    newConfigEntities[index] = newRow;
    fireEvent(this, "entities-changed", { entities: newConfigEntities });
  }

  private _colorChanged(ev: Event): void {
    const target = ev.target as HTMLInputElement & { index: number };
    const color = target.value.trim();
    const newConfigEntities = this.entities!.concat();
    const newRow: any = { ...newConfigEntities[target.index] };
    if (color) {
      newRow.color = color;
    } else {
      delete newRow.color;
    }
    newConfigEntities[target.index] = newRow;
    fireEvent(this, "entities-changed", { entities: newConfigEntities });
  }

  private _socChanged(ev: CustomEvent): void {
    ev.stopPropagation();
    const index = (ev.currentTarget as any).index;
    const socEntity = ev.detail.value?.soc_entity;
    const newConfigEntities = this.entities!.concat();
    const newRow: any = { ...newConfigEntities[index] };
    if (socEntity) {
      newRow.soc_entity = socEntity;
    } else {
      delete newRow.soc_entity;
    }
    newConfigEntities[index] = newRow;
    fireEvent(this, "entities-changed", { entities: newConfigEntities });
  }

  private _iconChanged(ev: CustomEvent): void {
    ev.stopPropagation();
    const index = (ev.currentTarget as any).index;
    const icon = ev.detail.value?.icon;
    const newConfigEntities = this.entities!.concat();
    const newRow = { ...(newConfigEntities[index] as EntityConfig) };
    if (icon) {
      newRow.icon = icon;
    } else {
      delete newRow.icon;
    }
    newConfigEntities[index] = newRow;
    fireEvent(this, "entities-changed", { entities: newConfigEntities });
  }

  private _nameChanged(ev: Event): void {
    // Use "change" rather than "input": each update replaces the row object,
    // which re-creates the row and would steal focus while typing.
    const target = ev.target as HTMLInputElement & { index: number };
    const index = target.index;
    const name = target.value.trim();
    const newConfigEntities = this.entities!.concat();
    const newRow = { ...(newConfigEntities[index] as EntityConfig) };
    if (name) {
      newRow.name = name;
    } else {
      delete newRow.name;
    }
    newConfigEntities[index] = newRow;
    fireEvent(this, "entities-changed", { entities: newConfigEntities });
  }

  private async _addEntity(ev: CustomEvent): Promise<void> {
    const value = ev.detail.value;
    if (value === "") {
      return;
    }
    const newConfigEntities = this.entities!.concat({
      entity: value as string,
    });
    (ev.target as HaEntityPicker).value = "";
    fireEvent(this, "entities-changed", { entities: newConfigEntities });
  }

  private _rowMoved(ev: CustomEvent): void {
    ev.stopPropagation();
    const { oldIndex, newIndex } = ev.detail;

    const newEntities = this.entities!.concat();

    newEntities.splice(newIndex, 0, newEntities.splice(oldIndex, 1)[0]);

    fireEvent(this, "entities-changed", { entities: newEntities });
  }

  private _removeRow(ev: CustomEvent): void {
    const index = (ev.currentTarget as any).index;
    const newConfigEntities = this.entities!.concat();

    newConfigEntities.splice(index, 1);

    fireEvent(this, "entities-changed", { entities: newConfigEntities });
  }

  private _valueChanged(ev: CustomEvent): void {
    const value = ev.detail.value;
    const index = (ev.target as any).index;
    const newConfigEntities = this.entities!.concat();

    if (value === "" || value === undefined) {
      newConfigEntities.splice(index, 1);
    } else {
      newConfigEntities[index] = {
        ...newConfigEntities[index],
        entity: value!,
      };
    }

    fireEvent(this, "entities-changed", { entities: newConfigEntities });
  }

  private _editRow(ev: CustomEvent): void {
    const index = (ev.currentTarget as any).index;
    fireEvent(this, "edit-detail-element", {
      subElementConfig: {
        index,
        type: "row",
        elementConfig: this.entities![index],
      },
    });
  }

  static get styles(): CSSResultGroup {
    return css`
      ha-entity-picker {
        margin-top: 8px;
      }
      .add-entity {
        display: block;
        margin-left: 31px;
        margin-right: 71px;
        margin-inline-start: 31px;
        margin-inline-end: 71px;
        direction: var(--direction);
      }
      .entity {
        display: flex;
        align-items: center;
      }

      .entity .handle {
        padding-right: 8px;
        cursor: move; /* fallback if grab cursor is unsupported */
        cursor: grab;
        padding-inline-end: 8px;
        padding-inline-start: initial;
        direction: var(--direction);
      }
      .entity .handle > * {
        pointer-events: none;
      }

      .entity ha-entity-picker {
        flex-grow: 1;
      }

      .entity-fields {
        display: flex;
        flex-direction: column;
        flex-grow: 1;
      }

      .entity-fields ha-entity-picker {
        display: block;
      }

      .name-field,
      .color-field {
        display: block;
        margin-top: 8px;
        margin-bottom: 8px;
      }

      .icon-field,
      .soc-field,
      .outline-field {
        display: block;
        margin-bottom: 8px;
      }

      .special-row {
        height: 60px;
        font-size: 16px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-grow: 1;
      }

      .special-row div {
        display: flex;
        flex-direction: column;
      }

      .remove-icon,
      .edit-icon {
        --mdc-icon-button-size: 36px;
        color: var(--secondary-text-color);
      }

      .secondary {
        font-size: 12px;
        color: var(--secondary-text-color);
      }
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "elec-sankey-hui-entities-card-row-editor": HuiEntitiesCardRowEditor;
  }
}
