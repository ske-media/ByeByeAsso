import { getPublicEvent } from "@kroov/domain/events";
import {
  formatRangeFr,
  formatTimeFr,
  instantToWallClock,
  NotFoundError,
  wallClockDateString,
  wallClockTimeString,
} from "@kroov/domain/kernel";
import { getPublicVolunteering } from "@kroov/domain/volunteers";
import { Alert, Button } from "@kroov/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppPublicShell } from "@/components/public-shell";
import { currentSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { ApplyForm } from "./apply-form";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ orgSlug: string; eventSlug: string }>;
}): Promise<Metadata> {
  const { orgSlug, eventSlug } = await params;
  try {
    const event = await getPublicEvent(db(), orgSlug, eventSlug);
    return { title: `Bénévoles · ${event.title}`, robots: { index: false } };
  } catch {
    return { title: "Événement introuvable" };
  }
}

/** Écrans 37–38 — Candidature bénévole. */
export default async function PublicVolunteerPage({
  params,
}: {
  params: Promise<{ orgSlug: string; eventSlug: string }>;
}) {
  const { orgSlug, eventSlug } = await params;
  let event: Awaited<ReturnType<typeof getPublicEvent>>;
  try {
    event = await getPublicEvent(db(), orgSlug, eventSlug);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const [volunteering, session] = await Promise.all([
    getPublicVolunteering(db(), event.organization.id, event.id),
    currentSession(),
  ]);
  const tz = event.timezone;
  const nameParts = (session?.user.name ?? "").trim().split(/\s+/);
  const s = instantToWallClock(event.startsAt, tz);
  const e = instantToWallClock(event.endsAt, tz);
  return (
    <AppPublicShell back={{ href: `/${orgSlug}/${eventSlug}`, label: "Retour à l'événement" }}>
      <div className="py-6">
        <p className="text-eyebrow font-extrabold uppercase text-muted">{event.organization.name}</p>
        <h1 className="mt-2 text-[36px] font-black leading-[1.04] tracking-[-1.4px]">
          Donner un coup
          <br />
          de main.
        </h1>
        <p className="mt-2 text-[13px] text-muted">
          {event.title} · {formatRangeFr(event.startsAt, event.endsAt, tz)}
        </p>
        <div className="mt-5">
          {!volunteering.open ? (
            <>
              <Alert tone="info" heading="Candidatures fermées">
                {volunteering.closedReason ?? "Le recrutement n'est pas ouvert."}
              </Alert>
              <div className="mt-4">
                <Button asChild variant="secondary">
                  <Link href={`/${orgSlug}/${eventSlug}`}>Retour à l'événement</Link>
                </Button>
              </div>
            </>
          ) : (
            <ApplyForm
              organizationSlug={orgSlug}
              eventSlug={eventSlug}
              timezone={tz}
              defaults={{
                email: session?.user.email ?? "",
                firstName: nameParts[0] ?? "",
                lastName: nameParts.slice(1).join(" "),
              }}
              eventDays={{
                startsDate: wallClockDateString(s),
                startsTime: wallClockTimeString(s),
                endsDate: wallClockDateString(e),
                endsTime: wallClockTimeString(e),
              }}
              positions={volunteering.positions.map((p) => ({
                id: p.id,
                name: p.name,
                teamName: p.teamName,
                description: p.description,
                minAge: p.minAge,
                skills: p.skills,
                shiftsLabel:
                  p.shifts.length === 0
                    ? "Créneaux à venir"
                    : `${p.shifts.length} créneau${p.shifts.length > 1 ? "x" : ""} : ${p.shifts
                        .slice(0, 3)
                        .map((sh) => `${formatTimeFr(sh.startsAt, tz)}–${formatTimeFr(sh.endsAt, tz)}`)
                        .join(", ")}${p.shifts.length > 3 ? "…" : ""}`,
              }))}
              skills={volunteering.skills}
              questions={volunteering.questions}
            />
          )}
        </div>
      </div>
    </AppPublicShell>
  );
}
