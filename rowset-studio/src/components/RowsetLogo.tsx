import { useId } from "react";

// Rowset Studio mark: a result set whose middle row is selected, with the
// highlighted cell as the "active" value. Kept in sync with public/favicon.svg.
export default function RowsetLogo({ size = 28, className = "" }: { size?: number; className?: string }) {
  const gradient = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role="img" aria-label="Rowset Studio" className={`rounded-[7px] ${className}`}>
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ca7550" />
          <stop offset="1" stopColor="#8c3a22" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill={`url(#${gradient})`} />
      <rect x="7" y="8.5" width="18" height="3.5" rx="1.75" fill="#fff" fillOpacity="0.5" />
      <rect x="7" y="14.25" width="11" height="3.5" rx="1.75" fill="#fff" />
      <rect x="20" y="14.25" width="5" height="3.5" rx="1.75" fill="#f2ddd0" />
      <rect x="7" y="20" width="18" height="3.5" rx="1.75" fill="#fff" fillOpacity="0.5" />
    </svg>
  );
}
