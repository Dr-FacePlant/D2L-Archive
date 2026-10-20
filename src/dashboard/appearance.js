// How the dashboard looks (Settings > Appearance): Light, Dark or Match my
// computer, an accent color, and a background. Loaded in
// <head> before anything paints, so a dark theme never flashes white first:
// app.js keeps the choices in chrome.storage and copies them to localStorage,
// which this file can read right away.
(function initAppearance(global) {
  const dash = global.D2LDashboard ||= {};

  const MIRROR_KEY = "studentArchiveAppearance";
  const THEMES = Object.freeze({ light: "Light", dark: "Dark", system: "Match my computer" });
  const ACCENTS = Object.freeze({ blue: "Blue", green: "Green", purple: "Purple", rose: "Rose", orange: "Orange", teal: "Teal" });
  const BACKGROUNDS = Object.freeze({ default: "Default", sky: "Sky", mint: "Mint", lavender: "Lavender", sand: "Sand", slate: "Slate" });
  const GLASS_MIN = 45;
  // A picture is veiled this much with the page color. Text never sits right
  // on it: cards, the top bar, the menu and the frosted strips behind page
  // titles carry it, and they turn as solid as each picture needs.
  const PICTURE_VEIL = 0.2;
  const DEFAULTS = Object.freeze({ theme: "light", accent: "blue", background: "default", glass: 100, wallpaper: null });

  // Colors the readability math needs; test-dashboard-appearance.mjs checks
  // they match dashboard.css. On a background, secondary text and links take
  // their deeper shade (--ink-4 and each accent's --link-hover), and the
  // weakest of those must still reach 4.5:1 everywhere text can sit.
  const GROUND = Object.freeze({ light: "#F5F7F9", dark: "#0F1318" });
  const SURFACE = Object.freeze({ light: "#FFFFFF", dark: "#171C23" });
  const WEAKEST_TEXT = Object.freeze({
    light: Object.freeze(["#4B5563", "#0849A8", "#075234", "#4B2299", "#8A173C", "#7F3700", "#074E5B"]),
    dark: Object.freeze(["#AAB4C1", "#9CC3FF", "#7FDCAE", "#CDB8FF", "#FFB1CA", "#FFC08F", "#82DCE8"])
  });

  const rgb = (hex) => {
    const n = Number.parseInt(String(hex).slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const channel = (value) => {
    const v = value / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  function contrast(a, b) {
    const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (light + 0.05) / (dark + 0.05);
  }
  // `amount` of color a laid over color b, mixed the way the browser does.
  const mix = (a, b, amount) => a.map((value, i) => value * amount + b[i] * (1 - amount));

  // How solid (in %) cards must be over a picture so every kind of text on
  // them stays readable. `pixels` are [r, g, b] samples of the blurred copy
  // the cards show; rounded up to the slider's 5% steps.
  function glassFor(pixels, mode) {
    const ground = rgb(GROUND[mode] || GROUND.light);
    const surface = rgb(SURFACE[mode] || SURFACE.light);
    const texts = (WEAKEST_TEXT[mode] || WEAKEST_TEXT.light).map(rgb);
    const readable = (color) => texts.every((text) => contrast(text, color) >= 4.5);
    let need = GLASS_MIN / 100;
    for (const pixel of pixels) {
      const page = mix(ground, pixel, PICTURE_VEIL);
      if (readable(mix(surface, page, need))) continue;
      let low = need;
      let high = 1;
      while (high - low > 0.002) {
        const middle = (low + high) / 2;
        if (readable(mix(surface, page, middle))) high = middle;
        else low = middle;
      }
      need = high;
    }
    return Math.min(100, Math.ceil((need * 100 - 1e-9) / 5) * 5);
  }

  function normalize(value) {
    const look = { ...DEFAULTS, ...(value && typeof value === "object" ? value : {}) };
    if (!Object.hasOwn(THEMES, look.theme)) look.theme = DEFAULTS.theme;
    if (!Object.hasOwn(ACCENTS, look.accent)) look.accent = DEFAULTS.accent;
    // Wallpaper and card-transparency settings from older versions are ignored.
    if (!Object.hasOwn(BACKGROUNDS, look.background)) look.background = DEFAULTS.background;
    look.glass = 100;
    look.wallpaper = null;
    return look;
  }

  const prefersDark = () => global.matchMedia?.("(prefers-color-scheme: dark)").matches === true;
  const modeFor = (theme) => (theme === "dark" || (theme === "system" && prefersDark()) ? "dark" : "light");

  // The lowest see-through setting this look allows in a theme.
  function glassFloor(value, mode = modeFor(normalize(value).theme)) {
    return 100;
  }

  let current = normalize(null);

  function apply(value, root = global.document?.documentElement) {
    const look = normalize(value);
    current = look;
    if (!root) return look;
    const mode = modeFor(look.theme);
    root.dataset.mode = mode;
    root.dataset.accent = look.accent;
    root.dataset.background = look.background;
    const glass = 100;
    root.removeAttribute("data-glass");
    root.style.setProperty("--glass-pct", `${glass}%`);
    root.style.setProperty("--scrim-pct", look.background === "image" ? `${Math.round(PICTURE_VEIL * 100)}%` : "0%");
    return look;
  }

  function mirror(look) {
    try {
      global.localStorage?.setItem(MIRROR_KEY, JSON.stringify(normalize(look)));
    } catch {
      // Private windows can refuse storage; the page still applies the look after loading.
    }
  }

  function remembered() {
    try {
      return JSON.parse(global.localStorage?.getItem(MIRROR_KEY) || "null");
    } catch {
      return null;
    }
  }

  if (global.document) {
    apply(remembered());
    global.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
      if (current.theme === "system") apply(current);
    });
  }

  Object.assign(dash, {
    appearance: Object.freeze({
      THEMES, ACCENTS, BACKGROUNDS, GLASS_MIN, PICTURE_VEIL, DEFAULTS, GROUND, SURFACE, WEAKEST_TEXT,
      normalize, apply, mirror, modeFor, glassFloor, contrast, rgb, mix, glassFor,
      current: () => current
    })
  });
})(globalThis);
