/**
 * Firebase, server side — publishing progress frames and sending push.
 *
 * Both of these are things Supabase's free tier cannot do without either
 * spending its shared 5 GB egress (RTDB fan-out) or not existing at all (push).
 * See supabase/migrations/008 for the full reasoning on why Firebase is in this
 * stack when Postgres is the database.
 *
 * Everything here is OPTIONAL and degrades to nothing. If the service account is
 * absent, `publishProgress` and `notify` become no-ops that log once, because a
 * missing push provider must never fail a reconstruction that otherwise
 * succeeded. The job row is the source of truth; this is the courtesy layer.
 */
import "server-only";

import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
import { getMessaging } from "firebase-admin/messaging";

import { isTerminalStatus, type ReconStatus } from "../recon/status";
import { progressPath, type ProgressFrame } from "./progress";

const APP_NAME = "spark-admin";

/**
 * The service account arrives base64-encoded in one variable rather than as
 * three (project id / client email / private key). The private key is PEM and
 * contains literal newlines, which survive almost nothing — .env parsers, CI
 * secret stores, and shell export all mangle them differently, and the failure
 * mode is an opaque "Invalid PEM formatted message" at runtime. One opaque blob
 * has exactly one way to be wrong.
 */
function credentials(): { projectId: string; clientEmail: string; privateKey: string } | null {
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  if (!b64) return null;
  try {
    const json = JSON.parse(Buffer.from(b64, "base64").toString("utf8")) as {
      project_id?: string;
      client_email?: string;
      private_key?: string;
    };
    if (!json.project_id || !json.client_email || !json.private_key) return null;
    return {
      projectId: json.project_id,
      clientEmail: json.client_email,
      privateKey: json.private_key,
    };
  } catch {
    console.warn("[firebase] FIREBASE_SERVICE_ACCOUNT_B64 is not valid base64 JSON");
    return null;
  }
}

let warned = false;

function app(): App | null {
  const creds = credentials();
  if (!creds) {
    if (!warned) {
      warned = true;
      console.info(
        "[firebase] no service account configured — progress fan-out and push are disabled. " +
          "The app still works; clients fall back to polling splat_jobs.",
      );
    }
    return null;
  }
  const existing = getApps().find((a) => a.name === APP_NAME);
  if (existing) return existing;
  return initializeApp(
    {
      credential: cert(creds),
      databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
    },
    APP_NAME,
  );
}

/**
 * Publish one progress frame.
 *
 * Never throws. A failure to fan out is a cosmetic problem and must not unwind a
 * worker that has just spent a credit and produced an artifact.
 */
export async function publishProgress(
  userId: string,
  frame: Omit<ProgressFrame, "at">,
): Promise<void> {
  const a = app();
  if (!a) return;
  try {
    const ref = getDatabase(a).ref(progressPath(userId, frame.jobId));
    await ref.set({ ...frame, at: Date.now() } satisfies ProgressFrame);

    // Terminal frames self-clean. Without this the 1 GB tier accumulates one
    // dead node per job forever, and a storage limit that only bites after
    // months is the worst kind to discover.
    if (isTerminalStatus(frame.status)) {
      setTimeout(() => void ref.remove().catch(() => {}), 60_000);
    }
  } catch (err) {
    console.warn("[firebase] progress publish failed (non-fatal):", err);
  }
}

export interface PushInput {
  title: string;
  body: string;
  /** Deep link opened when the notification is tapped. */
  url: string;
  tokens: string[];
}

/**
 * Send a push, and report which tokens are dead so the caller can revoke them.
 *
 * FCM does not tell you a token has expired until you try to use it, so pruning
 * is a side effect of sending and there is no other moment to do it. Returning
 * the dead ones rather than deleting them here keeps this module free of a
 * database dependency.
 */
export async function notify(
  input: PushInput,
): Promise<{ sent: number; deadTokens: string[] }> {
  const a = app();
  if (!a || input.tokens.length === 0) return { sent: 0, deadTokens: [] };

  try {
    const res = await getMessaging(a).sendEachForMulticast({
      tokens: input.tokens,
      notification: { title: input.title, body: input.body },
      // Also in `data` so the service worker can route the click. `notification`
      // alone is rendered by the browser and does not reach our handler.
      data: { url: input.url },
      webpush: {
        fcmOptions: { link: input.url },
        notification: { icon: "/icon-192.png", requireInteraction: false },
      },
    });

    const deadTokens: string[] = [];
    res.responses.forEach((r, i) => {
      const code = r.error?.code;
      if (
        code === "messaging/registration-token-not-registered" ||
        code === "messaging/invalid-registration-token" ||
        code === "messaging/invalid-argument"
      ) {
        deadTokens.push(input.tokens[i]);
      }
    });

    return { sent: res.successCount, deadTokens };
  } catch (err) {
    console.warn("[firebase] push send failed (non-fatal):", err);
    return { sent: 0, deadTokens: [] };
  }
}

/** Copy for the one push this app sends. */
export function reconstructionDone(status: ReconStatus, title: string): {
  title: string;
  body: string;
} {
  return status === "ready"
    ? { title: "Your capture is ready", body: `“${title}” finished reconstructing.` }
    : { title: "Reconstruction failed", body: `“${title}” could not be reconstructed.` };
}
