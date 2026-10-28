"use client";

import { Alert, Badge, Button, EmptyState } from "@kroov/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition } from "react";
import { markNotificationsReadAction, setNotificationPreferencesAction } from "@/actions/operations";
import { type ActionState, idleState } from "@/lib/action-state";

export interface NotificationRow {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  href: string | null;
  readAt: string | null;
  createdAt: string;
}

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function NotificationList({
  organizationId,
  slug,
  items,
}: {
  organizationId: string;
  slug: string;
  items: NotificationRow[];
}) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<ActionState>(idleState);
  const [pending, start] = useTransition();
  const mark = (input: { all: true } | { ids: string[] }) =>
    start(async () => {
      const r = await markNotificationsReadAction(organizationId, slug, input);
      setFeedback(r);
      if (r.status === "success") router.refresh();
    });
  const unread = items.filter((n) => !n.readAt).length;
  if (items.length === 0) {
    return (
      <EmptyState
        title="Aucune notification"
        description="Les événements importants de l'organisation apparaîtront ici : candidatures, indisponibilités, campagnes, remboursements."
      />
    );
  }
  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="m-0 text-[13px] text-muted">{unread > 0 ? `${unread} non lue(s)` : "Tout est lu."}</p>
        {unread > 0 ? (
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => mark({ all: true })}>
            Tout marquer comme lu
          </Button>
        ) : null}
      </div>
      {feedback.status === "error" && feedback.message ? <Alert tone="error">{feedback.message}</Alert> : null}
      <ul className="m-0 list-none divide-y divide-border p-0">
        {items.map((n) => (
          <li key={n.id} className="flex flex-wrap items-start gap-3 py-3 text-[13px]">
            <span
              aria-hidden="true"
              className={`mt-1.5 size-2.5 shrink-0 rounded-full ${n.readAt ? "bg-border" : "bg-pink"}`}
            />
            <div className="min-w-0 flex-1">
              <span className={n.readAt ? "" : "font-bold"}>{n.title}</span>
              {!n.readAt ? (
                <Badge tone="pink" noDot className="ml-2">
                  Non lue
                </Badge>
              ) : null}
              {n.body ? <span className="block text-muted">{n.body}</span> : null}
              <span className="block text-[12px] text-muted">{fmt(n.createdAt)}</span>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {n.href ? (
                <Button asChild size="sm" variant="ghost">
                  <Link href={n.href} onClick={() => (n.readAt ? undefined : mark({ ids: [n.id] }))}>
                    Ouvrir →
                  </Link>
                </Button>
              ) : null}
              {!n.readAt ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => mark({ ids: [n.id] })}
                  aria-label={`Marquer comme lue : ${n.title}`}
                >
                  Lu
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

export function PreferencesForm({
  organizationId,
  slug,
  preferences,
}: {
  organizationId: string;
  slug: string;
  preferences: Array<{ kind: string; label: string; description: string; inApp: boolean }>;
}) {
  const [state, action, pending] = useActionState(
    setNotificationPreferencesAction.bind(null, organizationId, slug),
    idleState,
  );
  return (
    <form action={action} className="space-y-3">
      {state.status === "success" && state.message ? <Alert tone="success">{state.message}</Alert> : null}
      {state.status === "error" && state.message ? <Alert tone="error">{state.message}</Alert> : null}
      <input type="hidden" name="kinds" value={preferences.map((p) => p.kind).join(",")} />
      <ul className="m-0 list-none divide-y divide-border p-0 text-[13px]">
        {preferences.map((p) => (
          <li key={p.kind} className="flex items-start gap-3 py-3">
            <input
              id={`pref-${p.kind}`}
              type="checkbox"
              name={`pref:${p.kind}`}
              defaultChecked={p.inApp}
              className="mt-1 size-4 accent-ink"
            />
            <label htmlFor={`pref-${p.kind}`}>
              <b>{p.label}</b>
              <span className="block text-muted">{p.description}</span>
            </label>
          </li>
        ))}
      </ul>
      <Button type="submit" variant="primary" loading={pending} loadingLabel="…">
        Enregistrer mes préférences
      </Button>
    </form>
  );
}
