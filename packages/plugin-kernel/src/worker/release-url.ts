export const releaseOrigin = (repository: string): string =>
  `github.com/${repository}`;

export const resourceReleaseUrl = (
  repository: string,
  pluginVersion: string,
): string =>
  `https://${releaseOrigin(repository)}/releases/download/res-${pluginVersion}`;
