import { pathToFileURL } from "node:url";

const src = `${process.env.ZOTLIT_ZOTERO_CHECKOUT}/reader/pdfjs/pdf.js/src/`;

const aliases = {
  "display-binary_data_factory": `${src}display/binary_data_factory.js`,
  "display-network_stream": `${src}display/stubs.js`,
  "display-node_utils": `${src}display/node_utils.js`,
};

export function resolve(specifier, context, next) {
  const target =
    aliases[specifier] ??
    (specifier.startsWith("pdfjs/")
      ? src + specifier.slice("pdfjs/".length)
      : null);
  if (target) return { url: pathToFileURL(target).href, shortCircuit: true };
  return next(specifier, context);
}
