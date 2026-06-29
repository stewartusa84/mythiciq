// Bug-report submission seam. Posts freeform text + optional screenshot attachments to the backend
// (`POST /api/bug-reports`). Screenshots are read as base64 data URLs (FileReader) so the request is a
// plain JSON body — no multipart dependency. No-op-with-error when no backend is configured, mirroring
// the discovery sync seam. The whole log never leaves the browser; only what the user types/attaches.

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL as string | undefined;

const MAX_ATTACHMENTS = 6;
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024; // matches the backend cap

export interface BugReportContext {
  appUrl?: string;
  viewport?: string;
  run?: string;
  [k: string]: unknown;
}

export interface BugReportResult {
  ok: boolean;
  id?: string;
  attachments?: number;
  rejected?: number;
  error?: string;
}

export const bugReportingEnabled = (): boolean => !!BACKEND_URL;

/** Read a File as a `data:<type>;base64,<…>` URL. */
function toDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('read failed'));
    r.readAsDataURL(file);
  });
}

export async function submitBugReport(
  message: string,
  files: File[],
  context?: BugReportContext,
): Promise<BugReportResult> {
  if (!BACKEND_URL) return { ok: false, error: 'No backend configured (set VITE_BACKEND_URL).' };
  const trimmed = message.trim();
  if (!trimmed) return { ok: false, error: 'Please describe the problem.' };

  const usable = files
    .filter((f) => f.type.startsWith('image/') && f.size <= MAX_ATTACHMENT_BYTES)
    .slice(0, MAX_ATTACHMENTS);

  let attachments: { name: string; dataUrl: string }[] = [];
  try {
    attachments = await Promise.all(usable.map(async (f) => ({ name: f.name, dataUrl: await toDataUrl(f) })));
  } catch (e) {
    return { ok: false, error: `Could not read attachment: ${e instanceof Error ? e.message : String(e)}` };
  }

  try {
    const res = await fetch(`${BACKEND_URL}/api/bug-reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: trimmed, context, attachments }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return { ok: false, error: `HTTP ${res.status}${detail ? ` — ${detail}` : ''}` };
    }
    const json = (await res.json()) as { id?: string; attachments?: number; rejected?: number };
    return { ok: true, id: json.id, attachments: json.attachments, rejected: json.rejected };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
