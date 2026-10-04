import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#13161a",
        parchment: "#faf8f4",
      },
    },
  },
} satisfies Config;
