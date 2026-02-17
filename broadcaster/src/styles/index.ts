/**
 * Style registry — imports all styles and provides lookup.
 */

import { CommentaryStyle, StyleDefinition } from "../types.js";
import { esportsStyle } from "./esports.js";
import { warCorrespondentStyle } from "./war-correspondent.js";
import { skippyStyle } from "./skippy.js";
import { documentaryStyle } from "./documentary.js";

export const STYLES: Record<CommentaryStyle, StyleDefinition> = {
  esports: esportsStyle,
  war_correspondent: warCorrespondentStyle,
  skippy_trash_talk: skippyStyle,
  documentary: documentaryStyle,
};

export function getStyle(name: string): StyleDefinition {
  const style = STYLES[name as CommentaryStyle];
  if (!style) {
    const valid = Object.keys(STYLES).join(", ");
    throw new Error(`Unknown commentary style "${name}". Valid styles: ${valid}`);
  }
  return style;
}

export { esportsStyle, warCorrespondentStyle, skippyStyle, documentaryStyle };
