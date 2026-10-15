// All icons of the app, drawn on a 20px grid with a 1.5px stroke.

import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 18, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const ComposeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9 3.5H5.5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V11" />
    <path d="M14.6 2.9a1.4 1.4 0 0 1 2 2L10 11.5l-2.6.6.6-2.6z" />
  </Icon>
);

export const SidebarIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.75" y="3.75" width="14.5" height="12.5" rx="2.5" />
    <path d="M7.75 3.75v12.5" />
  </Icon>
);

export const GlobeIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="10" cy="10" r="7" />
    <path d="M3 10h14M10 3c2 2.2 2.9 4.6 2.9 7s-.9 4.8-2.9 7c-2-2.2-2.9-4.6-2.9-7S8 5.2 10 3z" />
  </Icon>
);

export const PaperclipIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m15.5 9.5-5.6 5.6a3.5 3.5 0 0 1-5-5L10.8 4a2.3 2.3 0 0 1 3.3 3.3L8.3 13.1a1.2 1.2 0 0 1-1.7-1.7l5.3-5.3" />
  </Icon>
);

export const ArrowUpIcon = (p: IconProps) => (
  <Icon {...p} strokeWidth={1.8}>
    <path d="M10 15v-10M6 9l4-4 4 4" />
  </Icon>
);

export const StopIcon = (p: IconProps) => (
  <Icon {...p} stroke="none">
    <rect x="6.5" y="6.5" width="7" height="7" rx="1.75" fill="currentColor" />
  </Icon>
);

export const ChevronDownIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m6 8 4 4 4-4" />
  </Icon>
);

export const ChevronRightIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m8 6 4 4-4 4" />
  </Icon>
);

export const TrashIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 6h12M8 6V4.5h4V6M5.5 6l.7 9.2a1.5 1.5 0 0 0 1.5 1.3h4.6a1.5 1.5 0 0 0 1.5-1.3L14.5 6" />
  </Icon>
);

export const GearIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M15.69 8.43 L17.61 8.85 L17.61 11.15 L15.69 11.57 L15.13 12.91 L16.2 14.57 L14.57 16.2 L12.91 15.13 L11.57 15.69 L11.15 17.61 L8.85 17.61 L8.43 15.69 L7.09 15.13 L5.43 16.2 L3.8 14.57 L4.87 12.91 L4.31 11.57 L2.39 11.15 L2.39 8.85 L4.31 8.43 L4.87 7.09 L3.8 5.43 L5.43 3.8 L7.09 4.87 L8.43 4.31 L8.85 2.39 L11.15 2.39 L11.57 4.31 L12.91 4.87 L14.57 3.8 L16.2 5.43 L15.13 7.09Z" />
    <circle cx="10" cy="10" r="2.4" />
  </Icon>
);

export const RetryIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M16 10a6 6 0 1 1-1.8-4.3" />
    <path d="M16.2 3.2v3.5h-3.5" />
  </Icon>
);

export const PencilIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M13.3 3.7a1.8 1.8 0 0 1 2.6 2.6l-9 9-3.4.8.8-3.4z" />
    <path d="m11.8 5.2 2.6 2.6" />
  </Icon>
);

export const TerminalIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.75" y="3.75" width="14.5" height="12.5" rx="2.25" />
    <path d="m6 8 2.25 2L6 12M10.5 12.5H14" />
  </Icon>
);

export const PinIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7.5 3.5h5M8.5 3.5v4.2L5.8 11h8.4l-2.7-3.3V3.5M10 11v5.5" />
  </Icon>
);

export const FolderIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.75 6.25a2 2 0 0 1 2-2h3.1l1.8 1.9h5.6a2 2 0 0 1 2 2v6.6a2 2 0 0 1-2 2H4.75a2 2 0 0 1-2-2z" />
  </Icon>
);

export const PlusIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10 4.5v11M4.5 10h11" />
  </Icon>
);

export const CloseIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m5.5 5.5 9 9M14.5 5.5l-9 9" />
  </Icon>
);

export const CopyIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="7" y="7" width="9.5" height="9.5" rx="2" />
    <path d="M13 7V5.5a2 2 0 0 0-2-2H5.5a2 2 0 0 0-2 2V11a2 2 0 0 0 2 2H7" />
  </Icon>
);

export const CheckIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m4.5 10.5 3.5 3.5 7.5-8" />
  </Icon>
);

export const SearchIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="9" cy="9" r="5.5" />
    <path d="m13 13 4 4" />
  </Icon>
);

export const SparkIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10 2.5c.5 3.8 3.7 7 7.5 7.5-3.8.5-7 3.7-7.5 7.5-.5-3.8-3.7-7-7.5-7.5 3.8-.5 7-3.7 7.5-7.5z" />
  </Icon>
);

export const AlertIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="10" cy="10" r="7" />
    <path d="M10 6.5v4M10 13.5v.01" />
  </Icon>
);

export const DocumentIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M11.5 2.75H6a2 2 0 0 0-2 2v10.5a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7.25z" />
    <path d="M11.5 2.75v4.5H16" />
  </Icon>
);

export const KeyIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="7" cy="13" r="3.5" />
    <path d="m9.5 10.5 7-7M14 6l2 2M12 8l1.5 1.5" />
  </Icon>
);
