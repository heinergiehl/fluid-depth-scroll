// Minimal typings for the parts of troika-three-text this project uses (the package ships none).
declare module "troika-three-text" {
  import type { Color, Material, Mesh } from "three"

  export interface TextRenderInfo {
    blockBounds: [number, number, number, number]
    visibleBounds: [number, number, number, number]
  }

  export class Text extends Mesh {
    text: string
    font: string | null
    fontSize: number
    maxWidth: number
    lineHeight: number | "normal"
    letterSpacing: number
    textAlign: "left" | "right" | "center" | "justify"
    anchorX: number | "left" | "center" | "right" | string
    anchorY: number | "top" | "top-baseline" | "top-cap" | "top-ex" | "middle" | "bottom-baseline" | "bottom" | string
    color: number | string | Color | null
    colorRanges: Record<number, number | string | Color> | null
    fillOpacity: number
    outlineWidth: number | string
    outlineBlur: number | string
    outlineColor: number | string | Color
    outlineOpacity: number
    depthOffset: number
    sdfGlyphSize: number | null
    material: Material
    readonly textRenderInfo: TextRenderInfo | null
    sync(callback?: () => void): void
    dispose(): void
  }

  export function preloadFont(options: { font: string; characters?: string | string[]; sdfGlyphSize?: number }, callback: () => void): void
}
