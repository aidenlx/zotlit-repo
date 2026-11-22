export function postProcessComment(container: HTMLElement): void {
  for (const anchor of container.querySelectorAll("a.tag")) {
    anchor.replaceWith(...anchor.childNodes);
  }
}
