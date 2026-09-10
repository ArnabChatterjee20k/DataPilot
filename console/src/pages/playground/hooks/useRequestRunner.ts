import { useCallback, useState } from "react";

import { sendAdHocRequest, sendRequest, type RequestSpecModel } from "@/lib/sdk";
import { errorMessage } from "@/lib/errors";
import type { RequestDraft, Tab } from "../store/store";
import { useTabsStore } from "../store/store";
import { useSaveRequest } from "./useSavedRequests";

/** A request tab's draft, in the shape the API expects. */
export function toSpec(draft: RequestDraft): RequestSpecModel {
  const body =
    draft.body_type === "form"
      ? safeRows(draft.body)
      : draft.body_type === "none"
        ? ""
        : draft.body;

  return {
    name: draft.name,
    method: draft.method,
    path: draft.path,
    params: draft.params.filter((row) => row.key.trim()),
    headers: draft.headers.filter((row) => row.key.trim()),
    body_type: draft.body_type,
    body,
    auth: draft.auth.type === "none" ? null : draft.auth,
  };
}

function safeRows(body: string) {
  try {
    const parsed = JSON.parse(body || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function useRequestRunner(tab: Tab) {
  const setRequestResult = useTabsStore((state) => state.setRequestResult);
  const recordRequestRun = useTabsStore((state) => state.recordRequestRun);
  const updateTab = useTabsStore((state) => state.updateTab);
  const result = useTabsStore((state) => state.requestResults[tab.id]);
  const saveRequest = useSaveRequest(tab.connectionId);

  const [isSending, setIsSending] = useState(false);

  const send = useCallback(async () => {
    if (!tab.request) return;

    const draft = tab.request;
    const spec = toSpec(draft);
    setIsSending(true);
    try {
      // a tab with no connection sends against the absolute URL it carries,
      // which is what makes trying one URL not require creating a connection
      const response = tab.connectionId
        ? await sendRequest({
            path: { connection_id: tab.connectionId },
            body: spec,
            throwOnError: true,
          })
        : await sendAdHocRequest({ body: spec, throwOnError: true });

      const ranAt = Date.now();
      setRequestResult(tab.id, { result: response.data, ranAt });
      recordRequestRun({
        connectionId: tab.connectionId,
        request: draft,
        method: draft.method,
        url: response.data?.request?.url,
        status: response.data?.response?.status,
        elapsedMs: response.data?.response?.elapsed_ms,
        size: response.data?.response?.size,
        ranAt,
      });
    } catch (error) {
      const ranAt = Date.now();
      const message = errorMessage(error, "Could not send the request");
      setRequestResult(tab.id, { error: message, ranAt });
      // a run that failed is the one most worth finding again
      recordRequestRun({
        connectionId: tab.connectionId,
        request: draft,
        method: draft.method,
        error: message,
        ranAt,
      });
    } finally {
      setIsSending(false);
    }
  }, [tab.connectionId, tab.request, tab.id, setRequestResult, recordRequestRun]);

  const save = useCallback(async () => {
    // a saved request lives under a connection; the button is disabled
    // without one, so there is nothing to explain here
    if (!tab.connectionId || !tab.request) return;
    const saved = await saveRequest.mutateAsync({
      requestId: tab.requestId,
      spec: toSpec(tab.request),
    });
    // a newly saved request adopts its id, so saving again updates rather than
    // creating a second copy
    if (saved?.uid && !tab.requestId) updateTab(tab.id, { requestId: saved.uid });
  }, [tab.connectionId, tab.request, tab.requestId, tab.id, saveRequest, updateTab]);

  return { result, isSending, isSaving: saveRequest.isPending, send, save };
}
