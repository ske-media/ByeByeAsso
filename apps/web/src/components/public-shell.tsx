"use client";

import { PublicShell, type PublicShellProps } from "@kroov/ui";
import Link from "next/link";

/** Client wrapper binding Next's <Link> so server pages can use the public shell. */
export function AppPublicShell(props: Omit<PublicShellProps, "LinkComponent">) {
  return <PublicShell LinkComponent={Link} {...props} />;
}
