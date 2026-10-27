import type { Role } from "@kroov/auth";

/** French labels for system roles (shared by organizer pages). */
export const ROLE_LABELS: Record<Role, string> = {
  owner: "Propriétaire",
  organization_admin: "Administrateur",
  event_manager: "Responsable événement",
  volunteer_manager: "Responsable bénévoles",
  marketing_manager: "Marketing",
  ticketing_manager: "Billetterie et finances",
  scanner: "Contrôle d'accès",
};

export const ROLE_HELP: Record<Role, string> = {
  owner: "Tout, y compris l'abonnement et les coordonnées bancaires.",
  organization_admin: "Tout sauf l'abonnement et les coordonnées bancaires.",
  event_manager: "Crée, modifie et publie les événements.",
  volunteer_manager: "Candidatures et planning des bénévoles.",
  marketing_manager: "Segments et campagnes.",
  ticketing_manager: "Commandes, remboursements, adhésions, exports.",
  scanner: "Scanne les billets de l'événement attribué.",
};

export function roleLabel(role: string): string {
  return (ROLE_LABELS as Record<string, string>)[role] ?? role;
}
