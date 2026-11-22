import type { E2eIssue, E2eIssues } from "#e2e-report";

export type FakeIssue = E2eIssue & { state: "open" | "closed" };

export function fakeIssues(existing: readonly FakeIssue[] = []) {
  const issues = [...existing];
  const created: { title: string; body: string; label: string }[] = [];
  const comments: { number: number; body: string }[] = [];
  const repositories = new Set<string>();
  const client: E2eIssues = {
    listOpen: (repository) => {
      repositories.add(repository);
      return Promise.resolve(
        issues
          .filter(({ state }) => state === "open")
          .map(({ number, title, url, body }) => ({
            number,
            title,
            url,
            body,
          })),
      );
    },
    create: (repository, issue) => {
      repositories.add(repository);
      created.push(issue);
      const number = 100 + created.length;
      const url = `https://github.com/${repository}/issues/${number}`;
      issues.push({ ...issue, number, url, state: "open" });
      return Promise.resolve(url);
    },
    comment: (repository, number, body) => {
      repositories.add(repository);
      comments.push({ number, body });
      return Promise.resolve();
    },
  };
  const change = (number: number, to: Partial<FakeIssue>) => {
    const at = issues.findIndex((issue) => issue.number === number);
    issues[at] = { ...issues[at]!, ...to };
  };
  return { client, created, comments, repositories, change };
}
