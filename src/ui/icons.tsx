import type { ReactNode } from "react";

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg
      className="ui-icon"
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const FoodIcon = () => (
  <Svg>
    <circle cx="8" cy="8" r="2.5" fill="currentColor" stroke="none" />
    <circle cx="8" cy="8" r="5.5" strokeDasharray="1.5 2.2" />
  </Svg>
);
export const ToxinIcon = () => (
  <Svg>
    <circle cx="8" cy="8" r="2" fill="currentColor" stroke="none" />
    <path d="M8 2v3M8 11v3M2 8h3M11 8h3M3.8 3.8l2.1 2.1M10.1 10.1l2.1 2.1M12.2 3.8l-2.1 2.1M5.9 10.1l-2.1 2.1" />
  </Svg>
);
export const EraseIcon = () => (
  <Svg>
    <path d="M6 13h7M3.2 9.8l5.6-5.6a1.4 1.4 0 0 1 2 0l1.6 1.6a1.4 1.4 0 0 1 0 2L7.6 13H5.2L3.2 11a1.4 1.4 0 0 1 0-1.2z" />
  </Svg>
);
export const SelectIcon = () => (
  <Svg>
    <path d="M4 2.5l8 5.2-3.6.9-1.9 3.3z" />
  </Svg>
);
export const PlayIcon = () => (
  <Svg>
    <path d="M5 3l8 5-8 5z" fill="currentColor" />
  </Svg>
);
export const PauseIcon = () => (
  <Svg>
    <path d="M5.5 3.5v9M10.5 3.5v9" strokeWidth="2" />
  </Svg>
);
export const ClearIcon = () => (
  <Svg>
    <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8h5.8l.6-8" />
  </Svg>
);
export const ResetIcon = () => (
  <Svg>
    <path d="M3 8a5 5 0 1 0 1.6-3.7M3 2.5v2.8h2.8" />
  </Svg>
);
export const ChevronIcon = ({ dir }: { dir: "left" | "right" | "up" | "down" }) => {
  const d = {
    left: "M10 3.5L5.5 8 10 12.5",
    right: "M6 3.5L10.5 8 6 12.5",
    up: "M3.5 10L8 5.5 12.5 10",
    down: "M3.5 6L8 10.5 12.5 6",
  }[dir];
  return (
    <Svg>
      <path d={d} />
    </Svg>
  );
};
export const MoreIcon = () => (
  <Svg>
    <circle cx="3.5" cy="8" r="1" fill="currentColor" />
    <circle cx="8" cy="8" r="1" fill="currentColor" />
    <circle cx="12.5" cy="8" r="1" fill="currentColor" />
  </Svg>
);
export const ScentIcon = () => (
  <Svg>
    <path d="M3 4.5c1.2-1.2 2.3 1.2 3.5 0s2.3 1.2 3.5 0 2.3 1.2 3 .4M3 8c1.2-1.2 2.3 1.2 3.5 0s2.3 1.2 3.5 0 2.3 1.2 3 .4M3 11.5c1.2-1.2 2.3 1.2 3.5 0s2.3 1.2 3.5 0 2.3 1.2 3 .4" />
  </Svg>
);
