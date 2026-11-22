import * as AsyncResult from "effect/reactivity/AsyncResult";
import { join } from "node:path/posix";
import type { IconName } from "obsidian";
import type { ReactNode } from "react";
import { useEffect, useRef } from "react";

import {
  readerStatusCopy,
  readerStatusDetail,
} from "@zotlit/annotations/obsidian/reader-connection/status.ts";
import { Button } from "@zotlit/obsidian-kit/components/obsidian/button.tsx";
import { IconButton } from "@zotlit/obsidian-kit/components/obsidian/icon-button.tsx";
import { Icon } from "@zotlit/obsidian-kit/components/obsidian/icon.tsx";
import {
  communityUrl,
  companionDocsUrl,
} from "@zotlit/obsidian-kit/docs-url.ts";
import { cn, tooltipAttrs } from "@zotlit/obsidian-kit/utils.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { CONVERTED_DEFAULT_PROFILE_DOCUMENT } from "@zotlit/templates/facade";
import { useUniqueId } from "@zotlit/ui";

import { useWelcomeActions } from "./actions.ts";
import { templateMigrationNotice } from "./migration-notice.ts";
import { useConversion, useWelcomeState } from "./model.ts";
import { bannerBadge, bannerSections } from "./presentation.ts";

import {
  blogUrl,
  changelogUrl,
  citationsDocsUrl,
  gettingStartedUrl,
  GITHUB,
  migrationGuideUrl,
  SPONSOR,
  templatesDocsUrl,
} from "#obsidian/welcome/links.ts";
import { ZotLitLockup } from "#obsidian/welcome/lockup.tsx";

type StepState = "done" | "checking" | "warn" | "todo";

function markClass(state: StepState, open: boolean): string {
  switch (state) {
    case "done":
      return "zt:border-green zt:text-green";
    case "warn":
      return "zt:border-warning zt:text-warning";
    case "checking":
      return "zt:border-link zt:text-link";
    case "todo":
      return open
        ? "zt:border-primary zt:text-link"
        : "zt:border-border zt:text-muted-foreground";
  }
}

function StepHeading({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="heading"
      aria-level={3}
      className={cn("zt:text-sm zt:font-semibold", className)}
    >
      {children}
    </div>
  );
}

const BADGE_TEXT = {
  upgraded: m.welcome_badge_upgraded,
  updated: m.welcome_badge_updated,
  "get-started": m.welcome_badge,
} satisfies Record<ReturnType<typeof bannerBadge>, () => string>;

const COLUMN =
  "zt:col-start-1 zt:w-full zt:min-w-0 zt:@min-[760px]:mx-auto zt:@min-[760px]:max-w-[40rem]";

const HANGING = "zt:-mx-[calc(--spacing(3)+1px)] zt:border zt:px-3";

function Header({ titleId }: { titleId: string }) {
  const badge = BADGE_TEXT[useWelcomeState(bannerBadge)]();
  return (
    <header
      className={cn(
        COLUMN,
        "zt:row-start-1 zt:flex zt:flex-wrap zt:content-start zt:items-center zt:gap-x-2.5 zt:gap-y-1 zt:@max-[760px]:pe-[calc(var(--icon-size)+var(--size-2-3)+var(--size-4-2))]",
      )}
    >
      <span
        id={titleId}
        role="heading"
        aria-level={2}
        className="zt:flex zt:min-h-(--zt-banner-line) zt:items-center"
      >
        <span className="zt:sr-only">ZotLit</span>
        <ZotLitLockup />
      </span>
      <span
        data-welcome-badge=""
        className="zt:rounded-full zt:border zt:border-primary zt:bg-muted zt:px-2 zt:py-0.5 zt:text-xs zt:text-foreground"
      >
        {badge}
      </span>
      <p className="zt:m-0 zt:text-sm zt:text-muted-foreground">
        {m.welcome_tagline()}
      </p>
    </header>
  );
}

function Dismiss() {
  const actions = useWelcomeActions();
  return (
    <IconButton
      icon="x"
      className="zt:col-start-1 zt:row-start-1 zt:-me-(--size-2-3) zt:self-start zt:justify-self-end zt:@min-[760px]:col-start-2"
      data-welcome-dismiss=""
      {...tooltipAttrs(m.welcome_dismiss())}
      onClick={actions.dismiss}
    />
  );
}

interface Step {
  id: string;
  state: StepState;
  title: string;
  summary?: ReactNode;
  body: ReactNode;
  action?: ReactNode;
}

const MARK_ICON: Record<Exclude<StepState, "todo">, IconName> = {
  done: "check",
  warn: "circle-alert",
  checking: "loader",
};

const ACCENT_SURFACE = {
  background: "hsla(var(--interactive-accent-hsl), 0.07)",
  borderColor: "hsla(var(--interactive-accent-hsl), 0.35)",
};

function StepRow({
  step,
  number,
  open,
}: {
  step: Step;
  number: number;
  open: boolean;
}) {
  return (
    <li
      data-welcome-step={step.state}
      data-open={open ? "" : undefined}
      className={cn(
        HANGING,
        "zt:flex zt:flex-col zt:gap-0.5 zt:rounded-lg zt:border-transparent zt:py-1.5",
      )}
      style={open ? ACCENT_SURFACE : undefined}
    >
      <div className="zt:flex zt:min-h-7 zt:items-center zt:gap-2">
        <span
          data-welcome-mark=""
          className={cn(
            "zt:flex zt:size-5 zt:shrink-0 zt:items-center zt:justify-center zt:rounded-full zt:border-2 zt:text-xs zt:font-semibold zt:tabular-nums",
            markClass(step.state, open),
          )}
        >
          {step.state === "todo" ? (
            <span aria-hidden="true">{number}</span>
          ) : (
            <Icon
              name={MARK_ICON[step.state]}
              size="xs"
              className={
                step.state === "checking"
                  ? "zt:motion-safe:animate-spin"
                  : undefined
              }
            />
          )}
        </span>
        <div className="zt:flex zt:min-w-0 zt:flex-1 zt:items-baseline zt:gap-x-2 zt:overflow-hidden zt:whitespace-nowrap">
          <StepHeading className="zt:max-w-full zt:shrink-0 zt:truncate">
            {step.title}
          </StepHeading>
          {step.state === "done" ? (
            <span className="zt:sr-only">{m.welcome_step_done()}</span>
          ) : null}
          {!open && step.summary ? (
            <span className="zt:flex zt:min-w-0 zt:items-baseline zt:gap-1.5 zt:overflow-hidden zt:text-xs zt:text-muted-foreground">
              {step.summary}
            </span>
          ) : null}
        </div>
        {step.action ? <div className="zt:shrink-0">{step.action}</div> : null}
      </div>
      {open ? (
        <div className="zt:ms-7 zt:text-sm zt:text-pretty zt:text-muted-foreground">
          {step.body}
        </div>
      ) : null}
    </li>
  );
}

function Checklist({ connect }: { connect: boolean }) {
  const connection = useWelcomeState((s) => s.connection);
  const literatureFolder = useWelcomeState((s) => s.literatureFolder);
  const folderDone = useWelcomeState((s) => s.literatureFolderExists);
  const notFound = useWelcomeState((s) => s.notFound);
  const companionInstalled = useWelcomeState((s) => s.companionInstalled);
  const readerStatus = useWelcomeState((s) => s.readerStatus);
  const actions = useWelcomeActions();
  const connected = connection.status === "connected";

  const steps: Step[] = [];
  if (connect) {
    steps.push({
      id: "connect",
      state:
        connection.status === "connected"
          ? "done"
          : connection.status === "missing"
            ? "warn"
            : "checking",
      title: m.welcome_step_connect_title(),
      summary:
        connection.status === "connected" ? (
          <>
            <code className="zt:max-w-60 zt:min-w-0 zt:shrink-[1000] zt:truncate zt:font-mono">
              {connection.path}
            </code>
            <span aria-hidden="true">·</span>
            <span className="zt:shrink-0">
              {m.welcome_step_connect_connected({
                count: connection.itemCount,
              })}
            </span>
          </>
        ) : undefined,
      body:
        connection.status === "checking" ? (
          <p className="zt:m-0 zt:motion-safe:animate-pulse">
            {m.welcome_step_connect_checking()}
          </p>
        ) : (
          <p className="zt:m-0">{m.welcome_step_connect_missing()}</p>
        ),
      action:
        connection.status === "connected" ? (
          <Button icon="settings" onClick={actions.openSettings}>
            {m.welcome_action_open_settings()}
          </Button>
        ) : connection.status === "missing" ? (
          <Button icon="folder-search" onClick={actions.locateZotero}>
            {m.welcome_action_locate()}
          </Button>
        ) : undefined,
    });
  }
  steps.push({
    id: "folder",
    state: folderDone ? "done" : "todo",
    title: m.welcome_step_folder_title(),
    summary: <span className="zt:truncate">{literatureFolder}</span>,
    body: (
      <p className="zt:m-0">
        {m.welcome_step_folder_body({ folder: literatureFolder })}
      </p>
    ),
    action: (
      <Button icon="folder" onClick={actions.pickFolder}>
        {m.welcome_action_pick_folder()}
      </Button>
    ),
  });
  steps.push({
    id: "library",
    state: connected ? "done" : "todo",
    title: m.welcome_step_library_title(),
    summary: connected ? (
      <span className="zt:truncate">{m.welcome_step_library_done()}</span>
    ) : undefined,
    body: <p className="zt:m-0">{m.welcome_step_library_body()}</p>,
    action: notFound ? undefined : (
      <Button icon="search" onClick={actions.searchLibrary}>
        {m.welcome_action_search()}
      </Button>
    ),
  });
  steps.push({
    id: "companion",
    state: companionInstalled ? "done" : "todo",
    title: m.welcome_step_companion_title(),
    summary: (
      <span className="zt:truncate">
        {companionInstalled
          ? m.welcome_step_companion_installed()
          : m.welcome_step_companion_recommended()}
      </span>
    ),
    body: <p className="zt:m-0">{m.welcome_step_companion_body()}</p>,
    action: companionInstalled ? undefined : (
      <Button
        icon="external-link"
        onClick={() => actions.openExternal(companionDocsUrl())}
      >
        {m.welcome_action_install_companion()}
      </Button>
    ),
  });
  const readerConnected = readerStatus === "connected";
  const readerCopy = readerStatusCopy(readerStatus);
  const readerAction = readerCopy.action;
  steps.push({
    id: "reader",
    state: readerConnected ? "done" : "todo",
    title: m.welcome_step_reader_title(),
    summary: (
      <span className="zt:truncate">
        {readerConnected
          ? m.welcome_step_reader_connected()
          : m.welcome_step_reader_recommended()}
      </span>
    ),
    body: <p className="zt:m-0">{readerStatusDetail(readerStatus)}</p>,
    action: readerAction ? (
      <Button
        icon="external-link"
        onClick={() => actions.openExternal(readerAction.url)}
      >
        {readerAction.label}
      </Button>
    ) : undefined,
  });
  const next = steps.findIndex((step) => step.state !== "done");

  return (
    <ol className="zt:m-0 zt:flex zt:list-none zt:flex-col zt:gap-0.5 zt:p-0">
      {steps.map((step, index) => (
        <StepRow
          key={step.id}
          step={step}
          number={index + 1}
          open={index === next}
        />
      ))}
    </ol>
  );
}

function FoldedChecklist({ connect }: { connect: boolean }) {
  const connection = useWelcomeState((s) => s.connection);
  const literatureFolder = useWelcomeState((s) => s.literatureFolder);
  const open = useWelcomeState((s) => s.stepsShown);
  const { showSteps } = useWelcomeActions();
  const stepsId = useUniqueId();
  return (
    <div className="zt:flex zt:flex-col zt:gap-0.5">
      <div
        data-welcome-setup-done=""
        className={cn(
          HANGING,
          "zt:flex zt:min-h-7 zt:items-center zt:gap-2 zt:border-transparent zt:py-1.5",
        )}
      >
        <span
          data-welcome-mark=""
          className={cn(
            "zt:flex zt:size-5 zt:shrink-0 zt:items-center zt:justify-center zt:rounded-full zt:border-2",
            markClass("done", false),
          )}
        >
          <Icon name="check" size="xs" />
        </span>
        <div className="zt:flex zt:min-w-0 zt:flex-1 zt:items-baseline zt:gap-x-2 zt:overflow-hidden zt:whitespace-nowrap">
          <span className="zt:shrink-0 zt:text-sm zt:font-semibold">
            {m.welcome_setup_done()}
          </span>
          <span className="zt:flex zt:min-w-0 zt:items-baseline zt:gap-1.5 zt:overflow-hidden zt:text-xs zt:text-muted-foreground">
            {connection.status === "connected" ? (
              <>
                <code className="zt:max-w-60 zt:min-w-0 zt:shrink-[1000] zt:truncate zt:font-mono">
                  {connection.path}
                </code>
                <span aria-hidden="true">·</span>
              </>
            ) : null}
            <span className="zt:truncate">
              {m.welcome_setup_done_folder({ folder: literatureFolder })}
            </span>
          </span>
        </div>
        <Button
          className="zt:shrink-0"
          icon={open ? "chevrons-down-up" : "chevrons-up-down"}
          aria-expanded={open}
          aria-controls={stepsId}
          onClick={() => showSteps(!open)}
        >
          {open ? m.welcome_hide_steps() : m.welcome_show_steps()}
        </Button>
      </div>
      <div id={stepsId} hidden={!open}>
        {open ? <Checklist connect={connect} /> : null}
      </div>
    </div>
  );
}

const LINK_COLOR = { color: "var(--text-normal)" };

function useOpenExternal(url: string) {
  const actions = useWelcomeActions();
  return (e: { preventDefault(): void }) => {
    e.preventDefault();
    actions.openExternal(url);
  };
}

const FOCUS_RING =
  "zt:focus-visible:ring-2 zt:focus-visible:ring-(--interactive-accent)";

function HelpTile({
  icon,
  url,
  title,
  subtitle,
  primary,
}: {
  icon: IconName;
  url: string;
  title: string;
  subtitle: string;
  primary?: boolean;
}) {
  const titleId = useUniqueId();
  const subtitleId = useUniqueId();
  return (
    <a
      href={url}
      onClick={useOpenExternal(url)}
      aria-labelledby={titleId}
      aria-describedby={subtitleId}
      data-welcome-help-tile=""
      style={{ ...LINK_COLOR, textDecoration: "none" }}
      className={cn(
        "zt:grid zt:min-w-0 zt:cursor-pointer zt:grid-cols-[auto_minmax(0,1fr)] zt:items-center zt:gap-x-2 zt:gap-y-0.5 zt:rounded-lg zt:border zt:bg-background zt:px-2.5 zt:py-1.5 zt:transition-colors zt:hover:border-(--background-modifier-border-hover) zt:hover:bg-(--background-modifier-hover)",
        FOCUS_RING,
        primary
          ? "zt:col-span-2 zt:gap-x-2.5 zt:border-primary zt:hover:border-primary"
          : "zt:content-start zt:border-border",
      )}
    >
      <span
        className={cn(
          "zt:flex zt:items-center zt:justify-center zt:rounded-md zt:bg-[hsla(var(--interactive-accent-hsl),0.14)] zt:text-link",
          primary ? "zt:row-span-2 zt:size-8" : "zt:size-6",
        )}
      >
        <Icon name={icon} size={primary ? "s" : "xs"} />
      </span>
      <span id={titleId} className="zt:truncate zt:text-sm zt:font-semibold">
        {title}
      </span>
      <span
        id={subtitleId}
        className={cn(
          "zt:text-xs zt:text-muted-foreground",
          !primary && "zt:col-span-2 zt:@max-[760px]:hidden",
        )}
      >
        {subtitle}
      </span>
    </a>
  );
}

function TextLink({ url, children }: { url: string; children: ReactNode }) {
  return (
    <a
      href={url}
      onClick={useOpenExternal(url)}
      style={{ ...LINK_COLOR, textDecorationLine: "underline" }}
      className={cn(
        "zt:inline-flex zt:cursor-pointer zt:items-center zt:gap-1 zt:rounded-sm zt:decoration-(--text-muted) zt:underline-offset-2 zt:hover:decoration-(--text-normal)",
        FOCUS_RING,
      )}
    >
      {children}
    </a>
  );
}

function HelpLinks() {
  const migrationPending = useWelcomeState((s) => s.migrationPending);
  const nameId = useUniqueId();
  return (
    <nav
      aria-labelledby={nameId}
      data-welcome-help=""
      className="zt:min-w-0 zt:@max-[760px]:mt-1 zt:@min-[760px]:col-start-2 zt:@min-[760px]:row-start-2"
    >
      <span id={nameId} className="zt:sr-only">
        {m.welcome_help_links_name()}
      </span>
      <div className="zt:grid zt:grid-cols-2 zt:gap-2">
        <HelpTile
          primary
          icon="book-open"
          url={gettingStartedUrl()}
          title={m.welcome_docs_getting_started()}
          subtitle={m.welcome_help_getting_started_subtitle()}
        />
        <HelpTile
          icon="messages-square"
          url={communityUrl()}
          title={m.welcome_link_discussions()}
          subtitle={m.welcome_help_discussions_subtitle()}
        />
        <HelpTile
          icon="star"
          url={GITHUB}
          title={m.welcome_help_github_title()}
          subtitle={m.welcome_help_github_subtitle()}
        />
        <HelpTile
          icon="layout-template"
          url={templatesDocsUrl()}
          title={m.welcome_docs_templates()}
          subtitle={m.welcome_help_templates_subtitle()}
        />
        <HelpTile
          icon="quote"
          url={citationsDocsUrl()}
          title={m.welcome_docs_citations()}
          subtitle={m.welcome_help_citations_subtitle()}
        />
      </div>
      <div className="zt:mt-2 zt:flex zt:flex-wrap zt:items-center zt:gap-x-3 zt:gap-y-1 zt:text-xs">
        <TextLink url={blogUrl()}>{m.welcome_link_blog()}</TextLink>
        <TextLink url={changelogUrl()}>{m.welcome_link_changelog()}</TextLink>
        <TextLink url={SPONSOR}>
          <Icon name="heart" size="xs" className="zt:text-pink" />
          {m.welcome_link_sponsor()}
        </TextLink>
        {migrationPending ? null : (
          <span className="zt:text-muted-foreground">
            {m.welcome_footer_migration_lead()}{" "}
            <TextLink url={migrationGuideUrl()}>
              {m.welcome_footer_migration_link()}
            </TextLink>
          </span>
        )}
      </div>
    </nav>
  );
}

function Callout({
  tone,
  title,
  action,
  children,
}: {
  tone: "accent" | "muted";
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      data-welcome-callout=""
      className={cn(
        HANGING,
        "zt:flex zt:flex-col zt:gap-0.5 zt:rounded-lg zt:py-2",
        tone === "muted" && "zt:border-border zt:bg-background",
      )}
      style={tone === "accent" ? ACCENT_SURFACE : undefined}
    >
      <div className="zt:flex zt:min-h-7 zt:flex-wrap zt:items-center zt:justify-between zt:gap-x-3 zt:gap-y-1.5">
        <StepHeading className="zt:min-w-0">{title}</StepHeading>
        {action ? <div className="zt:shrink-0">{action}</div> : null}
      </div>
      <div className="zt:text-sm zt:text-pretty zt:text-muted-foreground">
        {children}
      </div>
    </div>
  );
}

function HowItWorks({ children }: { children: ReactNode }) {
  return (
    <details className="zt:group/how zt:mt-1">
      <summary className="zt:inline-flex zt:cursor-(--cursor) zt:list-none zt:items-center zt:gap-1 zt:rounded-sm zt:text-xs zt:text-(--text-normal) zt:focus-visible:shadow-[0_0_0_var(--input-border-width-focus)_var(--background-modifier-border-focus)] zt:focus-visible:outline-none zt:[&::-webkit-details-marker]:hidden">
        <Icon
          name="right-triangle"
          size="xs"
          className="zt:shrink-0 zt:[rotate:calc(var(--direction)*-90deg)] zt:text-(--nav-collapse-icon-color) zt:group-open/how:[rotate:none]"
        />
        {m.welcome_how_it_works()}
      </summary>
      <p className="zt:mt-1 zt:mb-0">{children}</p>
    </details>
  );
}

function UpdateCallout() {
  const actions = useWelcomeActions();
  const version = useWelcomeState((s) => s.version);
  return (
    <Callout
      tone="accent"
      title={m.welcome_update_title({ version })}
      action={
        <Button icon="sparkles" onClick={actions.openReleaseNote}>
          {m.welcome_update_action()}
        </Button>
      }
    >
      {m.welcome_update_body()}
    </Callout>
  );
}

function ConversionOffer() {
  const actions = useWelcomeActions();
  const templateFolder = useWelcomeState((state) => state.templateFolder);
  const run = useConversion();
  const converting = run.waiting;
  const last = AsyncResult.isSuccess(run) && !run.waiting ? run.value : null;
  const refusal =
    last && !last.retry && last.result.outcome === "refused"
      ? templateMigrationNotice(last.result)
      : null;
  return (
    <Callout
      tone="accent"
      title={m.welcome_template_conversion_title()}
      action={
        <Button
          icon="combine"
          loading={converting}
          disabled={converting}
          onClick={actions.convertLiteratureNoteTemplates}
        >
          {m.welcome_template_conversion_action()}
        </Button>
      }
    >
      <p className="zt:m-0">{m.welcome_template_conversion_lead()}</p>
      <HowItWorks>
        {m.welcome_template_conversion_body({
          path: join(templateFolder, CONVERTED_DEFAULT_PROFILE_DOCUMENT),
        })}
      </HowItWorks>
      {refusal ? (
        <p className="zt:mt-2 zt:mb-0 zt:text-destructive" role="alert">
          {refusal}
        </p>
      ) : null}
    </Callout>
  );
}

function ConversionResult() {
  const actions = useWelcomeActions();
  const result = useWelcomeState((state) => state.templateConversionResult);
  const retrying = useConversion().waiting;
  if (!result) return null;
  const retained = result.pendingCleanup;
  return (
    <Callout
      tone="muted"
      title={m.welcome_template_conversion_completed_title()}
      action={
        retained.length > 0 ? (
          <Button
            icon="rotate-ccw"
            loading={retrying}
            disabled={retrying}
            onClick={actions.retryTemplateCleanup}
          >
            {m.welcome_template_cleanup_retry()}
          </Button>
        ) : undefined
      }
    >
      <p className="zt:m-0">
        {result.document
          ? m.welcome_template_conversion_completed_body({
              path: result.document,
              count: result.trashed,
            })
          : m.welcome_template_conversion_completed_files({
              count: result.trashed,
            })}
      </p>
      {retained.length > 0 ? (
        <>
          <p className="zt:mt-2 zt:mb-0">{m.welcome_template_cleanup_body()}</p>
          <ul className="zt:my-1 zt:flex zt:list-none zt:flex-col zt:gap-1 zt:p-0">
            {retained.map((path) => (
              <li key={path}>
                <code className="zt:rounded-sm zt:border zt:border-border zt:bg-muted zt:px-2 zt:py-0.5 zt:font-mono zt:text-xs">
                  {path}
                </code>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </Callout>
  );
}

function MigrationGuide() {
  const actions = useWelcomeActions();
  return (
    <Callout
      tone="accent"
      title={m.welcome_migration_title()}
      action={
        <Button
          icon="book-marked"
          onClick={() => actions.openExternal(migrationGuideUrl())}
        >
          {m.welcome_action_open_migration_guide()}
        </Button>
      }
    >
      {m.welcome_migration_body()}
    </Callout>
  );
}

function CompanionGuidance() {
  const actions = useWelcomeActions();
  return (
    <Callout
      tone="muted"
      title={m.welcome_companion_title()}
      action={
        <Button
          icon="external-link"
          onClick={() => actions.openExternal(companionDocsUrl())}
        >
          {m.notice_companion_install_action()}
        </Button>
      }
    >
      {m.companion_zotero_10_guidance()}
    </Callout>
  );
}

export function Welcome() {
  const shown = useWelcomeState((s) => bannerSections(s) !== null);
  const steps = useWelcomeState((s) => bannerSections(s)?.steps ?? false);

  const connect = useWelcomeState((s) => bannerSections(s)?.connect ?? false);
  const conversion = useWelcomeState(
    (s) => bannerSections(s)?.conversion ?? null,
  );
  const migration = useWelcomeState(
    (s) => bannerSections(s)?.migration ?? false,
  );
  const companion = useWelcomeState(
    (s) => bannerSections(s)?.companion ?? false,
  );
  const update = useWelcomeState((s) => bannerSections(s)?.update ?? false);
  const titleId = useUniqueId();
  const requests = useWelcomeState((s) => s.requests);
  const sectionRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (requests > 0) sectionRef.current?.focus();
  }, [requests]);
  if (!shown) return null;
  return (
    <section
      ref={sectionRef}
      aria-labelledby={titleId}
      data-welcome-banner=""
      tabIndex={-1}
      className="zt:@container zt:border-b-(length:--border-width) zt:border-(--divider-color) zt:bg-(--background-secondary) zt:px-(--size-4-6) zt:py-(--size-4-4) zt:outline-none zt:[--zt-banner-line:calc(var(--icon-size)+var(--size-2-2)*2)]"
    >
      <div className="zt:grid zt:grid-cols-1 zt:gap-y-3 zt:@min-[760px]:grid-cols-[minmax(0,1fr)_22rem] zt:@min-[760px]:gap-x-8">
        <Header titleId={titleId} />
        <Dismiss />
        <div
          data-welcome-column=""
          className={cn(
            COLUMN,
            "zt:flex zt:flex-col zt:gap-3 zt:@min-[760px]:row-start-2",
          )}
        >
          {update && <UpdateCallout />}
          {migration && <MigrationGuide />}
          {conversion === "offer" && <ConversionOffer />}
          {conversion === "result" && <ConversionResult />}
          {companion && <CompanionGuidance />}
          {steps === "open" && <Checklist connect={connect} />}
          {steps === "folded" && <FoldedChecklist connect={connect} />}
        </div>
        <HelpLinks />
      </div>
    </section>
  );
}
