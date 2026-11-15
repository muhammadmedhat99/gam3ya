import { ImageResponse } from "next/og";

/**
 * The app mark from the design (stacked coins on brand petrol), rendered as PNG.
 * `padding` leaves the safe zone for maskable icons.
 */
export function appIconResponse(size: number, { maskable = false, rounded = false } = {}) {
  const inner = Math.round(size * (maskable ? 0.5 : 0.62));
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0E6474",
          borderRadius: rounded ? Math.round(size * 0.22) : 0,
        }}
      >
        <svg
          width={inner}
          height={inner}
          viewBox="0 0 24 24"
          fill="none"
          stroke="#FFFFFF"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <ellipse cx="12" cy="6" rx="7" ry="3" />
          <path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6" />
          <path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" />
        </svg>
      </div>
    ),
    { width: size, height: size },
  );
}
