// The port through which the annotation surfaces bring a card forward in the
// Annotation View, which `@zotlit/query-views` holds and fills.
import { Context } from "effect";

/**
 * The Annotation View as the capability notices and the PDF reader's marks
 * reach it: whether a view on screen already shows a card, and the reveal of
 * one Annotation's card.
 */
export class AnnotationViewReveal extends Context.Service<
  AnnotationViewReveal,
  {
    /** Whether an Annotation View on screen already shows this card. */
    readonly cardShown: (annotationKey: string) => boolean;
    /** Opens the Annotation View and brings one Annotation's card forward. */
    readonly revealAnnotation: (annotationKey: string) => void;
  }
>()("zotlit/annotations/AnnotationViewReveal") {}
