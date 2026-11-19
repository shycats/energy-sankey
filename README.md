# Home Assistant Energy Sankey Cards

Energy Sankey is a collection of dashboard cards for homeassistant, dynamically displaying the flow of electrical energy and power.

This project is a Fork from the original https://github.com/davet2001/energy-sankey, it's not available in HACS, if you want to use it you have to manually install it by copying energy-sankey.js from the releases section into your Home Assistant /config/www folder and add it under the Resources section (three dots) of the Dashboards configuration in Home Assistant.

It has been modified with the following changes:

## Power card:

- Icons: grid_icon, generation_icon, untracked_icon, unknown_source_icon, and an icon on each consumer and battery is now configurable.
- Colors: grid_color, generation_color, unknown_source_color, and a color on each consumer and battery is now configurable.
- Outlines: grid_outline, generation_outline, and an outline on each entity draw a rounded border around that label is now an option.
- Values above the icon: grid_secondary_entity and generation_secondary_entity show any entity's formatted state above that icon as an option.
- Battery level: soc_entity on each battery shows a percentage, and the icon changes with the SoC.
- hide_zero_consumers: hides consumers at 0 W, negative or unavailable.
- show_total_consumption: shows total consumption above the central trunk.
- max_power: fixes the scale, so the same power is always drawn equally thick, whether it comes from the grid, generation or batteries (the left part of the diagram narrows instead of stretching). Below max_power the card keeps a constant height; flows above it draw thicker and the card grows taller, except generation well above max_power, which shrinks the diagram to fit its width. Set it to around your peak generation or consumption.
- Net values for grid and batteries: the power card now shows a single net value with a direction arrow, instead of separate in and out values.

## Both cards:

- battery_charge_from_generation_first: a new option that assumes batteries charge from generation first and from the grid only for any shortfall.
- Spacing: cards without a title get 16px of top padding.

## Renderer and layout

- elec-sankey.ts: new props for all of the above. The "unknown source" flow is now gray, themeable via --unknown-source-color. The grid and consumer label columns have fixed widths, so spare card width goes to the diagram and nothing moves as values change; override them with --elec-sankey-grid-label-width (default 70px) and --elec-sankey-consumer-label-width (default 85px, or --elec-sankey-consumer-label-min-width if set); consumer labels with icons get extra room, and outlines get a taller top strip. Battery and grid labels are now centered.
- Bug fix: renderGridInFlow was passed x10 where it should have been y10.
- ha-elec-sankey.ts: label rendering is refactored into \_generateLabelBody. Consumers show their icon beside the name, values that round to zero use the neutral text color, value colors follow the configured flow colors, and the total is formatted for the locale.

## Editors

- The row editor (hui-entities-card-row-editor.ts) can now show name, icon, battery-level, color and outline fields on each row.
- The power card editor exposes all the new options, and empty optional fields are removed from the config when cleared.
