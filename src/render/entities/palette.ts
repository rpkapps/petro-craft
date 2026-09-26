// Shared art-direction palette for every entity model: warm industrial tones, company orange accent,
// hazard yellow and a family of steel greys. Colours are sRGB hex values (converted when baked).

export const C = {
  // company & safety
  ORANGE: 0xff8a1f,
  ORANGE_DARK: 0xc9661a,
  HAZARD: 0xf2c230,
  HAZARD_DARK: 0x2b2b2b,
  RED: 0xc8322a,
  RED_DARK: 0x8e241f,
  FIRE_RED: 0xd2231c,
  // steel
  STEEL: 0x8b939a,
  STEEL_LIGHT: 0xb9c0c6,
  STEEL_DARK: 0x4f565d,
  GUNMETAL: 0x363b40,
  GALV: 0xa7adb0,
  RUST: 0x8a4c2c,
  // paints
  WHITE: 0xe9e6de,
  CREAM: 0xd8cfbb,
  SAND: 0xc9b48a,
  BEIGE: 0xb8a784,
  GREEN: 0x4d7a4b,
  OLIVE: 0x6d7244,
  TEAL: 0x3e7f82,
  BLUE: 0x2f5f8f,
  SKY_BLUE: 0x6fa5cf,
  NAVY: 0x243a55,
  PURPLE: 0x5b4a82,
  // materials
  CONCRETE: 0x9d988e,
  CONCRETE_DARK: 0x77736b,
  ASPHALT: 0x34363a,
  GRAVEL: 0x837c70,
  RUBBER: 0x1d1e20,
  BLACK: 0x26282b,
  WOOD: 0x8a6a45,
  INSULATION: 0xc7c9c4,
  GLASS: 0x3a5068,
  GLASS_DARK: 0x28323d,
  PANEL: 0x1f3552,
  SKIN: 0xd9a37a,
  SKIN_DARK: 0x9a6a48,
  // liquids
  WATER: 0x3f7f96,
  BRINE: 0x5a8a82,
  OIL: 0x1b140e,
  AMBER: 0xd9a13a,
  CRUDE_PIPE: 0x3a2a1c,
  // lights
  LAMP_WARM: 0xffd79a,
  LAMP_WHITE: 0xf4f6ff,
  LAMP_RED: 0xff2a1a,
  LAMP_GREEN: 0x3cff7a,
  LAMP_AMBER: 0xffa21f,
  HOT: 0xff7a1a,
} as const;

/** Worker hard-hat colours by role flavour. */
export const HAT_COLORS = [0xf4f1ea, 0xf2c230, 0xff8a1f, 0x3a78c9, 0xf4f1ea, 0xf2c230];
