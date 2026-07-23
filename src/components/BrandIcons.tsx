import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number | string };

export function CodexMark({ size = 24, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M12 2.8c1.55 0 2.94.8 3.73 2.02a4.08 4.08 0 0 1 4.2 4.05c0 .6-.13 1.18-.37 1.7a4.08 4.08 0 0 1-1.38 6.78 4.09 4.09 0 0 1-6.18 2.27 4.09 4.09 0 0 1-6.18-2.27 4.08 4.08 0 0 1-1.38-6.78 4.08 4.08 0 0 1 3.83-5.75A4.42 4.42 0 0 1 12 2.8Z" />
      <path d="m8.3 8.8 2.35 3.15-2.35 3.2M13.1 15.15h3.25" />
    </svg>
  );
}

export function DeviceLinkIcon({ size = 24, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <rect x="2.25" y="5" width="13.5" height="9.25" rx="1.35" />
      <path d="M1.5 17h14.8M6.6 14.25h4.8" />
      <rect x="17.25" y="7.1" width="5.25" height="11.8" rx="1.35" />
      <path d="M19.25 16.7h1.25" />
    </svg>
  );
}
