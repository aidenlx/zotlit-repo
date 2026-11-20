# ZotLit Reader

The ZotLit Reader plugin. It shares the vocabulary of the Obsidian Plugin context (`apps/obsidian/GLOSSARY.md`) and adds these terms.

**ZotLit Reader**:
The Obsidian plugin with id `zotlit-reader` that opens vault PDFs in the ZotLit PDF Reader. It works alone, without ZotLit and without Zotero; when ZotLit is also installed, ZotLit adds its Zotero features to the Reader's view through the Reader API.
_Avoid_: reader plugin, PDF plugin, ZotLit PDF Reader (that is the reader it adds)

**PDF takeover**:
The state in which ZotLit Reader, not Obsidian's built-in PDF view, opens each PDF of the vault: in a tab, in an embed, in a hover preview and in a canvas card. It holds while the Reader's setting "Open all PDFs" is on, which it is after install.
_Avoid_: override, hijack

**Reader API**:
The versioned contract through which another plugin, the client, extends ZotLit Reader's view: the client asks for one major version and a lowest minor version, and ZotLit Reader accepts with the matching API or refuses with the majors it supports. ZotLit is the one client the product ships; the exchange of request and answer is the handshake.
_Avoid_: plugin API (Obsidian's `plugin.api`, which only the handshake makes stable), interop API, reader SDK

**Contract probe**:
A test plugin with no Zotero code that connects to ZotLit Reader as a client of the Reader API and adds its own layer to the Reader's view, so the contract is proved apart from ZotLit. It can ask for a major the Reader does not support, to prove the refusal.
_Avoid_: fake ZotLit, test client
