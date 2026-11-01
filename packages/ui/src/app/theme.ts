import { theme, type ThemeConfig } from "antd";
import type { GetAntdThemeConfig } from "antd-style";

/** antd CSS variables are `--kx-ant-*`; `--kx-*` belongs to Tailwind (prefix "kx"). */
export const ANTD_CSS_VAR_PREFIX = "kx-ant";

const shared: ThemeConfig["token"] = {
  colorPrimary: "#fa8c16",
  // Square corners everywhere; the size variants are pinned so none derive a radius.
  borderRadius: 0,
  borderRadiusXS: 0,
  borderRadiusSM: 0,
  borderRadiusLG: 0,
  borderRadiusOuter: 0,
  fontFamily: "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
};

// VS Code Monokai's charcoal surfaces, warm foreground, and syntax accents.
const monokai: ThemeConfig["token"] = {
  colorPrimary: "#a6e22e",
  colorInfo: "#66d9ef",
  colorSuccess: "#a6e22e",
  colorWarning: "#e6db74",
  colorError: "#f92672",
  colorBgBase: "#272822",
  colorBgLayout: "#1e1f1c",
  colorBgContainer: "#272822",
  colorBgElevated: "#34352f",
  colorBgSpotlight: "#414339",
  colorTextBase: "#f8f8f2",
  colorText: "#f8f8f2",
  colorTextSecondary: "#c2c2b5",
  colorTextTertiary: "#a6a596",
  colorTextQuaternary: "#88846f",
  colorBorder: "#414339",
  colorBorderSecondary: "#3e3d32",
  colorFill: "#75715e66",
  colorFillSecondary: "#75715e4d",
  colorFillTertiary: "#75715e33",
  colorFillQuaternary: "#75715e1f",
};

/**
 * Theme without an algorithm: antd-style's ThemeProvider prepends the light or dark
 * algorithm for the resolved appearance, so setting one here would apply it twice.
 */
export const getAntdTheme: GetAntdThemeConfig = (appearance) => ({
  token: appearance === "dark" ? { ...shared, ...monokai } : shared,
  ...(appearance === "dark"
    ? {
        components: {
          Button: { primaryColor: "#1e1f1c" },
          Tree: {
            directoryNodeSelectedBg: "#414339",
            directoryNodeSelectedColor: "#f8f8f2",
            nodeSelectedBg: "#414339",
            nodeSelectedColor: "#f8f8f2",
          },
        },
      }
    : {}),
  cssVar: { prefix: ANTD_CSS_VAR_PREFIX, key: `kushex-${appearance}` },
});

/** Complete themes for a bare antd ConfigProvider (tests, tooling). */
export const lightTheme: ThemeConfig = {
  ...getAntdTheme("light"),
  algorithm: theme.defaultAlgorithm,
};

export const darkTheme: ThemeConfig = {
  ...getAntdTheme("dark"),
  algorithm: theme.darkAlgorithm,
};
