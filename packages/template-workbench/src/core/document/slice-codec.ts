import { jsonLayout, jsonPosition, ruleDisplay } from "./json-source.ts";
import {
  scalarDisplay,
  scalarSource,
  scalarStyle,
  scalarToDisplay,
  scalarToSource,
} from "./scalar-source.ts";

export interface SliceCodec {
  show(stored: string, prefix: string): string;
  store(shown: string, stored: string): string;
  toStored(shown: string, stored: string, position: number): number;
  toShown(stored: string, shown: string, position: number): number;
}

export const sourceCodec: SliceCodec = {
  show: (stored) => stored,
  store: (shown) => shown,
  toStored: (_shown, _stored, position) => position,
  toShown: (_stored, _shown, position) => position,
};

export const jsonCodec: SliceCodec = {
  show: ruleDisplay,
  store: (shown) => jsonLayout(shown, false).text,
  toStored: jsonPosition,
  toShown: jsonPosition,
};

export const scalarCodec: SliceCodec = {
  show: scalarDisplay,
  store: (shown, stored) => scalarSource(shown, scalarStyle(stored)),
  toStored: scalarToSource,
  toShown: scalarToDisplay,
};
