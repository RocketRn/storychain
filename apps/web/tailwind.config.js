/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        "tg-bg": "var(--tg-bg)",
        "tg-text": "var(--tg-text)",
        "tg-hint": "var(--tg-hint)",
        "tg-link": "var(--tg-link)",
        "tg-button": "var(--tg-button)",
        "tg-button-text": "var(--tg-button-text)",
        "tg-secondary": "var(--tg-secondary-bg)",
        "tg-destructive": "var(--tg-destructive)",
      },
    },
  },
  plugins: [],
};
