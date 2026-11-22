export declare function fingerprint(char: {
  offset: number;
  c: string;
  u: string;
  rect: readonly number[];
  inlineRect: readonly number[];
  rotation: number;
  baseline: number;
  fontSize: number;
  fontName: string;
  spaceAfter?: boolean;
  wordBreakAfter?: boolean;
  lineBreakAfter?: boolean;
  paragraphBreakAfter?: boolean;
  ignorable?: boolean;
}): string;
