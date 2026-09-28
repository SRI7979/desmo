import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { consoleSink, createTelemetry, supabaseSink } from "@/lib/telemetry";

/** Production telemetry for the API routes: JSON log lines plus app_events rows. */
export const routeTelemetry = createTelemetry([consoleSink(), supabaseSink(() => createAdminClient())]);
