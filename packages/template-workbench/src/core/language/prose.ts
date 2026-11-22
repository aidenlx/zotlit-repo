export function appendProse(parent: Element, text: string): void {
  const doc = parent.ownerDocument;
  text.split("`").forEach((part, at) => {
    if (part === "") return;
    if (at % 2 === 0) parent.append(part);
    else parent.appendChild(doc.createElement("code")).textContent = part;
  });
}
