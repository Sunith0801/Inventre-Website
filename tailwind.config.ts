import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx,mdx}", "./components/**/*.{ts,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: "#0A0A0A",
          50: "#F7F7F6",
          100: "#EDECE8",
          200: "#D9D7D0",
          300: "#B8B5AB",
          400: "#8A8678",
          500: "#5C5950",
          600: "#3D3B35",
          700: "#26241F",
          800: "#16140F",
          900: "#0A0A0A",
        },
        cream: {
          DEFAULT: "#FAF7F2",
          50: "#FDFBF8",
          100: "#FAF7F2",
          200: "#F2EDE3",
        },
        brand: {
          DEFAULT: "#E47127",
          50: "#FEF3EC",
          100: "#FCE2D0",
          200: "#F9C49F",
          300: "#F2A26C",
          400: "#EB8845",
          500: "#E47127",
          600: "#C45A18",
          700: "#9A4513",
          800: "#6E3110",
          900: "#451E0A",
        },
      },
      fontFamily: {
        display: ["var(--font-jakarta)", "ui-sans-serif", "system-ui"],
        sans: ["var(--font-jakarta)", "ui-sans-serif", "system-ui"],
      },
      fontSize: {
        "display-xl": ["clamp(2.75rem, 6.2vw, 5.5rem)", { lineHeight: "1.02", letterSpacing: "-0.035em" }],
        "display-lg": ["clamp(2rem, 4.5vw, 4rem)", { lineHeight: "1.05", letterSpacing: "-0.03em" }],
        "display-md": ["clamp(1.6rem, 3.2vw, 2.6rem)", { lineHeight: "1.1", letterSpacing: "-0.025em" }],
      },
      borderRadius: { "4xl": "2rem" },
      transitionTimingFunction: {
        "out-expo": "cubic-bezier(0.16, 1, 0.3, 1)",
        "out-natural": "cubic-bezier(0.32, 0.72, 0, 1)",
      },
      keyframes: {
        marquee: {
          from: { transform: "translateX(0)" },
          to: { transform: "translateX(-50%)" },
        },
      },
      animation: {
        marquee: "marquee 40s linear infinite",
      },
    },
  },
  plugins: [],
};

export default config;
