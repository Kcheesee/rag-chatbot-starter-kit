import type { ReactElement } from "react";

import { WidgetChat } from "./widget-chat";

/**
 * The page served inside the embeddable widget's iframe.
 *
 * Reading `searchParams` on the server keeps this a dynamic route (no Suspense
 * dance) and passes the host's theming down to the client chat. Which host pages
 * may embed this route is enforced by middleware (CSP frame-ancestors from
 * WIDGET_ALLOWED_ORIGINS).
 */
export default function WidgetPage({
  searchParams,
}: {
  searchParams: { name?: string; color?: string };
}): ReactElement {
  return (
    <WidgetChat name={searchParams.name ?? "Assistant"} color={searchParams.color ?? "#1d4ed8"} />
  );
}
