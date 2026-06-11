type BackendVideoResponse = {
  action?: string | null;
  parameters?: Record<string, unknown>;
  confidence?: number;
  message: string;
  error?: string | null;
  original_path?: string | null;
  output_path?: string | null;
  task_id?: string | null;
};

const BACKEND_BASE_URL = process.env.NEXT_PUBLIC_CHATCUT_BACKEND_URL ?? "http://localhost:3001";

async function parseErrorMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { detail?: string; message?: string; error?: string };
    return payload.detail || payload.message || payload.error || `Request failed with status ${response.status}`;
  } catch {
    return `Request failed with status ${response.status}`;
  }
}

export async function processVideoWithBackend(
  filePath: string,
  prompt: string,
  signal?: AbortSignal
): Promise<BackendVideoResponse> {
  const response = await fetch(`${BACKEND_BASE_URL}/api/process-media`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ filePath, prompt }),
    signal,
  });

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }

  return (await response.json()) as BackendVideoResponse;
}