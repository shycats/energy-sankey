import {
  mdiBattery,
  mdiBattery10,
  mdiBattery20,
  mdiBattery30,
  mdiBattery40,
  mdiBattery50,
  mdiBattery60,
  mdiBattery70,
  mdiBattery80,
  mdiBattery90,
  mdiBatteryAlertVariantOutline,
  mdiBatteryCharging10,
  mdiBatteryCharging100,
  mdiBatteryCharging20,
  mdiBatteryCharging30,
  mdiBatteryCharging40,
  mdiBatteryCharging50,
  mdiBatteryCharging60,
  mdiBatteryCharging70,
  mdiBatteryCharging80,
  mdiBatteryCharging90,
  mdiBatteryChargingOutline,
  mdiBatteryUnknown,
} from "@mdi/js";

const BATTERY_ICONS: Record<number, string> = {
  10: mdiBattery10,
  20: mdiBattery20,
  30: mdiBattery30,
  40: mdiBattery40,
  50: mdiBattery50,
  60: mdiBattery60,
  70: mdiBattery70,
  80: mdiBattery80,
  90: mdiBattery90,
  100: mdiBattery,
};

const BATTERY_CHARGING_ICONS: Record<number, string> = {
  10: mdiBatteryCharging10,
  20: mdiBatteryCharging20,
  30: mdiBatteryCharging30,
  40: mdiBatteryCharging40,
  50: mdiBatteryCharging50,
  60: mdiBatteryCharging60,
  70: mdiBatteryCharging70,
  80: mdiBatteryCharging80,
  90: mdiBatteryCharging90,
  100: mdiBatteryCharging100,
};

/**
 * Returns the SVG path of the battery icon for a state of charge (0-100),
 * in 10% steps. Mirrors Home Assistant's own battery level icons
 * (frontend src/common/entity/battery_icon.ts).
 */
export function batteryLevelIcon(level: number, charging: boolean): string {
  if (isNaN(level)) {
    return mdiBatteryUnknown;
  }
  const rounded = Math.min(100, Math.max(0, Math.round(level / 10) * 10));
  if (charging) {
    return rounded >= 10
      ? BATTERY_CHARGING_ICONS[rounded]
      : mdiBatteryChargingOutline;
  }
  if (level <= 5) {
    return mdiBatteryAlertVariantOutline;
  }
  return BATTERY_ICONS[Math.max(10, rounded)];
}
