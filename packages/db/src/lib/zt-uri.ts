import type { ZoteroUserIdentity } from "#queries/account.ts";

export function itemUri(
  key: string,
  groupID: number | null,
  user: Pick<ZoteroUserIdentity, "userID" | "localUserKey">,
): string | null {
  const path = groupID != null ? `groups/${groupID}` : userPath(user);
  return path && `http://zotero.org/${path}/items/${key}`;
}

function userPath({
  userID,
  localUserKey,
}: Pick<ZoteroUserIdentity, "userID" | "localUserKey">): string | null {
  if (userID != null) return `users/${userID}`;
  return localUserKey == null ? null : `users/local/${localUserKey}`;
}

function slugify(username: string): string {
  return username
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9 ._-]/g, "")
    .replaceAll(" ", "_");
}

export function itemWebUrl(
  key: string,
  groupID: number | null,
  username: string | null,
): string | null {
  if (groupID != null)
    return `https://www.zotero.org/groups/${groupID}/items/${key}`;
  if (username == null) return null;
  return `https://www.zotero.org/${slugify(username)}/items/${key}`;
}
