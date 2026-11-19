import { LovelaceCardConfig } from "./ha/data/lovelace/config/card";

interface ElecFlowCardConfig extends LovelaceCardConfig {
  title?: string;
  hide_small_consumers?: boolean;
  battery_charge_only_from_generation?: boolean;
  battery_charge_from_generation_first?: boolean;
}

export interface EnergyElecFlowCardConfig extends ElecFlowCardConfig {
  collection_key?: string; // @todo this might not be needed.
}

export interface PowerFlowCardEntityConfig {
  entity: string;
  name?: string;
  /** Icon name, e.g. "mdi:dishwasher". */
  icon?: string;
  /** Batteries only: state of charge sensor (percent). */
  soc_entity?: string;
  /** CSS colour or Jinja template for this entity's flow and value. */
  color?: string;
  /** Draw a rounded outline around this entity's label. */
  outline?: boolean;
}

export interface PowerFlowCardConfig extends ElecFlowCardConfig {
  power_from_grid_entity?: string;
  power_to_grid_entity?: string;
  generation_entity?: string;
  independent_grid_in_out?: boolean;
  /** Hide consumers whose power is 0 W, negative or not a number. */
  hide_zero_consumers?: boolean;
  /** Show total consumption above the converging part of the diagram. */
  show_total_consumption?: boolean;
  /**
   * Power (W) drawn at full line thickness. Lower totals draw thinner lines;
   * higher totals scale automatically. Unset: always scale automatically.
   */
  max_power?: number;
  /** Icon name overriding the default grid icon. */
  grid_icon?: string;
  /** Icon name overriding the default generation icon. */
  generation_icon?: string;
  /** Icon name for the "Untracked" (or "Home") consumer. */
  untracked_icon?: string;
  /** Any entity whose state is shown above the grid icon. */
  grid_secondary_entity?: string;
  /** Any entity whose state is shown above the generation icon. */
  generation_secondary_entity?: string;
  /** CSS colour or Jinja template for the grid flow and value. */
  grid_color?: string;
  /** CSS colour or Jinja template for the generation flow and value. */
  generation_color?: string;
  /** Icon name for the inferred "unknown source" of generation. */
  unknown_source_icon?: string;
  /** CSS colour or Jinja template for the "unknown source" flow and value. */
  unknown_source_color?: string;
  /** Count any unknown generation as grid import instead of showing it. */
  unknown_source_to_grid?: boolean;
  /** Draw a rounded outline around the grid label. */
  grid_outline?: boolean;
  /** Draw a rounded outline around the generation label. */
  generation_outline?: boolean;
  consumer_entities: PowerFlowCardEntityConfig[];
  battery_entities?: PowerFlowCardEntityConfig[];
}
