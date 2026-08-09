/**
 * Route group for pages that came in with the trip-pipeline work (currently
 * just /globe). The FIELD NOTES pages own their own chrome, so this layout
 * stays a pass-through.
 */
export default function AppLayout({ children }: LayoutProps<"/">) {
  return <>{children}</>;
}
