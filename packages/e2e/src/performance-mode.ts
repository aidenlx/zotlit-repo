export const E2E_PERFORMANCE_ENV = "ZOTLIT_E2E_PERFORMANCE";

export function checkPerformanceBudgets(assertBudgets: () => void): void {
  if (process.env[E2E_PERFORMANCE_ENV] === "1") assertBudgets();
}
