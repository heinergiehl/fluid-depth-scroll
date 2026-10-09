// Font files for WebGL text (troika-three-text reads .woff, not .woff2). Vite turns the imports
// into hashed asset URLs; the same families are loaded for HTML through CSS.
import sansRegular from "@fontsource/inter-tight/files/inter-tight-latin-400-normal.woff?url"
import sansMedium from "@fontsource/inter-tight/files/inter-tight-latin-500-normal.woff?url"
import sansSemibold from "@fontsource/inter-tight/files/inter-tight-latin-600-normal.woff?url"
import serifItalic from "@fontsource/instrument-serif/files/instrument-serif-latin-400-italic.woff?url"

export const FONTS = {
  sans: sansRegular,
  sansMedium,
  sansSemibold,
  serifItalic,
} as const

export type FontName = keyof typeof FONTS
