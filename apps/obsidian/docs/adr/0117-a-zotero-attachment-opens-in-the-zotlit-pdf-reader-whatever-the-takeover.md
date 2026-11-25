# A Zotero attachment opens in the ZotLit PDF Reader whatever the PDF takeover

While ZotLit Reader is connected, a tab or window that shows a PDF that is a resolved, Obsidian-Openable Zotero attachment shows it in the ZotLit PDF Reader, whatever opened it and whatever the Reader's "Open all PDFs" setting is. Other PDFs follow the setting. One viewer policy in ZotLit decides every PDF open: Obsidian's own opens reach it through a patch on `WorkspaceLeaf.prototype.setViewState`, and ZotLit's own opens call it directly. While the Reader is not connected, the policy answers Obsidian's PDF view for every open, and ZotLit names that view instead of leaving the choice to the view registry.

The rule follows the research task: a Zotero attachment is the PDF a researcher annotates, so it keeps the annotation tools on every path that shows it. Before this decision the viewer depended on the path. With "Open all PDFs" off, Obsidian's tab menu item "Open in new window" reopens a tab by its file (`openPopoutLeaf().openFile(file)`), the view registry answered Obsidian's PDF view, and the new window had no annotation tools (forum topic 107). The decision supersedes the first paragraph of ADR 0046's "Routing to ZotLit Reader", where a plain page link kept its view type.

## Considered Options

- **Rebind the tab menu's "Open in new window" on a ZotLit reader tab** (rejected): it fixes one gesture. The public Menu interface cannot read or replace an item, so the view would find Obsidian's item by its icon, and every other path that opens by file (the file explorer, a plain link, another plugin) keeps the old answer.
- **Replace the creator of Obsidian's `pdf` view type** (rejected): a stronger takeover. It changes nothing while "Open all PDFs" is off, which is where the failure is.
- **Route a file while a ZotLit reader tab shows it** (rejected): no Zotero lookup, but the answer depends on which tabs are open.
- **Remove the off state and always take over** (rejected): researchers who prefer Obsidian's viewer for other PDFs lose that choice.
- **Route by the Zotero attachment rule** (chosen).

## Consequences

- "Open all PDFs" off now means: Zotero attachments open in ZotLit Reader in a tab or a window, and other PDFs open in Obsidian's PDF viewer. The setting description, the "Read PDFs in ZotLit Reader" page and the glossary say so.
- Embeds, hover previews and canvas cards go through Obsidian's embed registry, not `setViewState`, so they still follow the setting alone.
- The attachment answer comes from `AttachmentResolver.resolveFile`, the one place that maps a file to its path, prefers the Attachment an open names, and reports `openable`. While the path index is still pending, the policy waits for it for at most two seconds and then answers by what it has. ZotLit warms the index when the Reader connects, so the wait occurs only for an open in the first moments after start-up.
- A request for any view type other than `pdf` passes the patch with no lookup and no wait.
- While the Reader is incompatible and its takeover is on, ZotLit's fallback used to land in the Reader's view with no ZotLit tools, under a notice that names Obsidian's PDF view. The fallback now names Obsidian's view, so the notice is true.
- The patch takes its host as an argument, so the policy and its lifetime are tested through a test host as well as through the End-to-end Run.
