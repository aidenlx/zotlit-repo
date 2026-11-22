import { Context } from "effect";

export class AnnotationViewReveal extends Context.Service<
  AnnotationViewReveal,
  {
    readonly cardShown: (annotationKey: string) => boolean;
    readonly revealAnnotation: (annotationKey: string) => void;
  }
>()("zotlit/annotations/AnnotationViewReveal") {}
