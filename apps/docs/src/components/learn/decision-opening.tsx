import { cn } from "@/lib/cn.ts";
import type { LessonOpeningView } from "@/lib/lesson-opening.ts";
import { localizeHref } from "@/paraglide/runtime.js";

import { textLinkClass } from "./action-classes.ts";
import { bodyClass, focusClass, titleClass } from "./lesson-mdx.tsx";
import { StepPicture } from "./step-picture.tsx";

function openingHref(href: string) {
  return href.startsWith("#") ? href : localizeHref(href);
}

export function DecisionOpening({
  opening,
  media,
}: {
  opening: LessonOpeningView;
  media: string;
}) {
  return (
    <section aria-labelledby="lesson-decision" className="grid gap-4">
      <h2
        id="lesson-decision"
        className={cn(titleClass, "font-serif font-medium text-balance")}
      >
        {opening.heading}
      </h2>
      <div className={cn(bodyClass, "grid gap-3 text-pretty")}>
        <p>{opening.job}</p>
        <p>{opening.audience}</p>
        <ul className="grid gap-2">
          {opening.difference.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p>{opening.limits}</p>
      </div>
      <figure className="grid gap-3">
        <div aria-hidden="true">
          <StepPicture
            media={media}
            n={opening.shot}
            alt=""
            active={false}
            lazy
          />
        </div>
        <figcaption className={cn(bodyClass, "text-pretty")}>
          {opening.imageAlt}
        </figcaption>
      </figure>
      <nav aria-labelledby="lesson-decision-next" className="grid gap-3">
        <p id="lesson-decision-next" className={cn(bodyClass, "text-pretty")}>
          {opening.next}
        </p>
        <ul className="grid gap-2.5">
          {opening.links.map((link) => (
            <li key={link.href} className={bodyClass}>
              <a
                href={openingHref(link.href)}
                className={cn(textLinkClass, "font-semibold", focusClass)}
              >
                {link.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </section>
  );
}
