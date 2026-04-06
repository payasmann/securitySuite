import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: {
          app: "#0a0c10",
          panel: "#0d1117",
          sidebar: "#060810",
          card: "#13182a",
          hover: "#1a2035",
        },
        border: {
          DEFAULT: "#1e2433",
          hover: "#2a3450",
          subtle: "#151b2b",
        },
        accent: {
          DEFAULT: "#1a6cff",
          hover: "#2d7aff",
          muted: "#1a6cff20",
        },
        status: {
          online: "#27ae60",
          alert: "#e74c3c",
          warning: "#f39c12",
          info: "#1a6cff",
        },
        text: {
          primary: "#e2e8f0",
          secondary: "#a0aec0",
          muted: "#5a6478",
        },
      },
      fontFamily: {
        mono: [
          "JetBrains Mono",
          "Fira Code",
          "Consolas",
          "Monaco",
          "monospace",
        ],
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
      fontSize: {
        "2xs": ["0.625rem", { lineHeight: "0.875rem" }],
      },
      borderRadius: {
        card: "8px",
        pill: "9999px",
      },
      spacing: {
        sidebar: "52px",
        topbar: "44px",
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "fade-in": "fadeIn 0.3s ease-in-out",
        "slide-in": "slideIn 0.3s ease-out",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideIn: {
          "0%": { transform: "translateY(-10px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
