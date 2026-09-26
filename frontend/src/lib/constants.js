// Vite inlines this at build time, so changing it in a hosting dashboard needs
// a redeploy to take effect.
export const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:5001";

export const DEFAULT_LANGUAGE = "javascript";

export const LANGUAGES = [
  { value: "javascript", label: "JavaScript" },
  { value: "python", label: "Python" },
  { value: "java", label: "Java" },
  { value: "cpp", label: "C++" },
];

// Typing fires on every keystroke; peers only need to know someone is active.
export const TYPING_EMIT_INTERVAL_MS = 1000;
export const TYPING_IDLE_MS = 1500;
