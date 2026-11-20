/** @jsxImportSource preact */
import type { FailureReason } from "#/core/types.ts";
import type { ReaderStringKey } from "#/generated/strings.ts";
import { useAtomValue } from "@effect/atom-react";
import type { JSX } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";

import { Icon } from "./controls.tsx";

import { useChrome } from "#/core/chrome/model.ts";

const FAILURES: Readonly<Record<FailureReason, ReaderStringKey>> = {
  unreadable: "pdf_reader_error_unreadable",
  invalid: "pdf_reader_error_invalid",
  "password-cancelled": "pdf_reader_error_password_cancelled",
  "engine-disposed": "pdf_reader_error_engine_disposed",
};

const OVERLAY =
  "zpr:absolute zpr:inset-0 zpr:z-20 zpr:flex zpr:flex-col zpr:items-center zpr:justify-center zpr:gap-2 zpr:bg-background zpr:p-4 zpr:text-center zpr:text-foreground";

function PasswordPrompt(props: { readonly retry: boolean }): JSX.Element {
  const { host, actions } = useChrome();
  const input = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    element.value = "";
    element.focus();
  }, [props.retry]);
  return (
    <form
      data-zpr-part="password"
      data-retry={props.retry ? "" : undefined}
      className={OVERLAY}
      onSubmit={(event) => {
        event.preventDefault();
        actions.submitPassword(input.current?.value ?? "");
      }}
    >
      <span className="zpr:text-muted">
        <Icon name="lucide-lock" />
      </span>
      <p className="zpr:text-base zpr:font-semibold">
        {host.t("pdf_reader_password_title")}
      </p>
      <p
        data-zpr-part="password-message"
        className="zpr:text-sm zpr:text-muted zpr:data-retry:text-error"
        data-retry={props.retry ? "" : undefined}
      >
        {host.t(
          props.retry
            ? "pdf_reader_password_invalid"
            : "pdf_reader_password_prompt",
        )}
      </p>
      <input
        ref={input}
        type="password"
        data-zpr-part="password-input"
        aria-label={host.t("pdf_reader_password_label")}
        autocomplete="off"
      />
      <span className="zpr:flex zpr:gap-2">
        <button type="submit" data-zpr-part="password-open">
          {host.t("pdf_reader_password_open")}
        </button>
        <button
          type="button"
          data-zpr-part="password-cancel"
          onClick={() => actions.cancelPassword()}
        >
          {host.t("pdf_reader_password_cancel")}
        </button>
      </span>
    </form>
  );
}

export function Overlays(): JSX.Element | null {
  const { host, state } = useChrome();
  const { status, failure, passwordRetry } = useAtomValue(state);
  if (status === "password") return <PasswordPrompt retry={passwordRetry} />;
  if (status === "failed" && failure) {
    return (
      <div
        role="alert"
        data-zpr-part="error"
        data-reason={failure.reason}
        className={OVERLAY}
      >
        <span className="zpr:text-muted">
          <Icon name="lucide-file-x" />
        </span>
        <p className="zpr:text-sm zpr:text-muted">
          {host.t(FAILURES[failure.reason])}
        </p>
      </div>
    );
  }
  return null;
}
