# Template Data Explorer renders through inert resolvers

Two template link helpers queue vault writes on their first invocation: an annotation's excerpt-image link queues an attachment copy, and a child-note link queues a note import with a minted, frozen path. The Template Data Explorer therefore never builds its context with the live resolvers — it supplies display-only implementations of the same resolver interfaces (`NoteResolvers`/`AnnotationResolvers`): side-effect-free helpers evaluate to their real rendered output, while the two import-queueing helpers resolve to their existing targets when already imported and to labeled inert placeholders otherwise, minting and queueing nothing. Browsing must be side-effect-free; the rejected alternatives were calling the live helpers (browsing an item would silently import files into the vault) and showing opaque function nodes (hides link resolution, the most useful information the explorer offers a template author).

Tag the substitute for a side-effecting helper with the reason the
Explorer shows. A missing excerpt image that the live path would import
stays a placeholder. Use the real file-link signature in the test
adapter. The fixture walks enumerable properties and calls zero-argument
helpers, tracking visited objects because an Annotation can refer to
its parent Item. This checks the same data access the display performs.
[Inert resolvers](../../packages/workbench/src/explorer/inert-resolvers.ts) · [Resolver tests](../../packages/workbench/src/explorer/inert-resolvers.test.ts)

The native Template Data loader resolves the Indexed Key and builds
the data graph without write side effects. The Obsidian adapter supplies
services to the inert resolver core. Built-in Annotation examples
carry serialized roots and descriptors together for the same renderer.
