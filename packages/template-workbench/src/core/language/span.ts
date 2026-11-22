export interface Span {
  readonly from: number;
  readonly to: number;
}

export interface PlacedFault {
  readonly text: string;
  readonly span: Span;
}
