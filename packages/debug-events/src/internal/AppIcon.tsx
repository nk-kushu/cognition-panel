import type { Icon as TablerIcon } from "@tabler/icons-react";
import { theme } from "antd";
export function AppIcon({
  icon: Icon,
  size = "md",
  label,
}: Readonly<{ icon: TablerIcon; size?: "sm" | "md" | "lg"; label?: string }>) {
  const { token } = theme.useToken();
  const px = { sm: token.fontSizeSM, md: token.fontSize, lg: token.fontSizeLG }[size];
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className="kxd:inline-flex"
    >
      <Icon size={px + 2} stroke={1.75} />
    </span>
  );
}
