import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { RefreshCw, Send } from "lucide-react";
import { useReducer } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { BhsBagMessageV1Schema } from "@/domain/beltcon-sbts-baseline/beltconSbtsBaseline.schemas";
import { auditKeys, bagKeys, integrationKeys, taggingKeys } from "@/lib/queryKeys";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader, Panel } from "@/components/AppLayout";

type FormValues = z.infer<typeof BhsBagMessageV1Schema>;
type Workflow = {
  phase:
    | "EDITING"
    | "VALIDATING"
    | "SUBMITTING"
    | "ACCEPTED"
    | "DUPLICATE"
    | "REJECTED"
    | "CONFLICT"
    | "FAILED";
  result: SimulatorResponse | null;
};
type Action = {
  type:
    | "FORM_CHANGED"
    | "VALIDATION_STARTED"
    | "VALIDATION_FAILED"
    | "SUBMISSION_STARTED"
    | "RESULT"
    | "RESET";
  result?: SimulatorResponse;
};
interface SimulatorResponse {
  requestId?: string;
  result?: {
    outcome: string;
    bhsUid: string;
    lineId: string;
    evaluation: string | null;
    taggingEligible: boolean;
    bagId: string | null;
    integrationEventId: string | null;
    duplicate: boolean;
    acknowledgement: { outcome: string; timing: string };
  };
  error?: string;
  code?: string;
}
const initial: Workflow = { phase: "EDITING", result: null };
export function beltconBhsSimulatorReducer(state: Workflow, action: Action): Workflow {
  if (action.type === "RESET" || action.type === "FORM_CHANGED") return initial;
  if (action.type === "VALIDATION_STARTED") return { ...state, phase: "VALIDATING" };
  if (action.type === "VALIDATION_FAILED") return { ...state, phase: "EDITING" };
  if (action.type === "SUBMISSION_STARTED") return { ...state, phase: "SUBMITTING", result: null };
  const result = action.result ?? null;
  const outcome = result?.result?.outcome;
  return {
    result,
    phase:
      outcome === "ACCEPTED"
        ? "ACCEPTED"
        : outcome === "DUPLICATE"
          ? "DUPLICATE"
          : outcome === "REJECTED"
            ? "CONFLICT"
            : "FAILED",
  };
}

async function simulateMessage(message: FormValues): Promise<SimulatorResponse> {
  const response = await fetch("/api/dev/simulator/bhs/messages", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(message),
  });
  const body = (await response.json().catch(() => ({}))) as SimulatorResponse;
  if (!response.ok)
    throw Object.assign(new Error(body.error ?? "BHS simulator request failed"), { body });
  return body;
}

export function useSimulateBhsMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: simulateMessage,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: taggingKeys.all }),
        queryClient.invalidateQueries({ queryKey: bagKeys.all }),
        queryClient.invalidateQueries({ queryKey: integrationKeys.bhsEvents() }),
        queryClient.invalidateQueries({ queryKey: auditKeys.all }),
      ]);
    },
  });
}

export function BeltconBhsSimulator() {
  const [workflow, dispatch] = useReducer(beltconBhsSimulatorReducer, initial);
  const form = useForm<FormValues>({
    resolver: zodResolver(BhsBagMessageV1Schema),
    defaultValues: {
      messageType: 2001,
      trigger: 1,
      lineId: "01",
      bhsUid: "0000000001",
      evaluation: "R",
    },
  });
  const mutation = useSimulateBhsMessage();
  const onSubmit = form.handleSubmit(
    async (values) => {
      dispatch({ type: "SUBMISSION_STARTED" });
      try {
        dispatch({ type: "RESULT", result: await mutation.mutateAsync(values) });
      } catch (error) {
        dispatch({
          type: "RESULT",
          result: (error as { body?: SimulatorResponse }).body ?? {
            error: error instanceof Error ? error.message : "BHS simulator request failed",
          },
        });
      }
    },
    () => dispatch({ type: "VALIDATION_FAILED" }),
  );
  const result = workflow.result?.result;
  return (
    <div className="p-6 pt-2">
      <PageHeader
        title="BELTCON BHS Simulator"
        subtitle="Simulate semantic BHS message 2001. This does not represent Profinet connectivity."
      />
      <Panel title="BHS message 2001">
        <form
          className="grid gap-4 md:grid-cols-2"
          onSubmit={onSubmit}
          onChange={() => dispatch({ type: "FORM_CHANGED" })}
        >
          <input type="hidden" {...form.register("messageType", { valueAsNumber: true })} />
          <input type="hidden" {...form.register("trigger", { valueAsNumber: true })} />
          <label>
            <Label>BHS BagID</Label>
            <Input className="mt-1 font-mono" {...form.register("bhsUid")} />
            {form.formState.errors.bhsUid && (
              <p className="mt-1 text-xs text-danger">{form.formState.errors.bhsUid.message}</p>
            )}
          </label>
          <label>
            <Label>BHS Line ID</Label>
            <Input className="mt-1 font-mono" maxLength={2} {...form.register("lineId")} />
            {form.formState.errors.lineId && (
              <p className="mt-1 text-xs text-danger">{form.formState.errors.lineId.message}</p>
            )}
          </label>
          <label>
            <Label>Evaluation</Label>
            <select
              className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              {...form.register("evaluation")}
            >
              <option value="A">A — Accept</option>
              <option value="R">R — Reject</option>
              <option value="T">T — Timeout</option>
              <option value="N">N — No Decision</option>
              <option value="?">? — Mistrack</option>
            </select>
          </label>
          <label>
            <Label>Trigger</Label>
            <Input className="mt-1 font-mono" value="1" readOnly />
          </label>
          <div className="md:col-span-2 flex gap-2">
            <Button type="submit" disabled={mutation.isPending}>
              <Send />
              {mutation.isPending ? "Sending…" : "Send BHS message"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                form.reset();
                dispatch({ type: "RESET" });
              }}
            >
              <RefreshCw />
              Reset
            </Button>
          </div>
        </form>
      </Panel>
      {workflow.phase !== "EDITING" && workflow.phase !== "VALIDATING" ? (
        <div className="mt-4 rounded-md border border-border p-4 text-sm">
          <strong>
            {workflow.phase === "SUBMITTING"
              ? "Sending"
              : result?.duplicate
                ? "Duplicate message"
                : workflow.phase === "ACCEPTED"
                  ? "Message accepted"
                  : "Message not accepted"}
          </strong>
          {workflow.result?.error ? (
            <p className="mt-2 text-danger">{workflow.result.error}</p>
          ) : null}
          {result ? (
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
              <dt>BHS BagID</dt>
              <dd className="font-mono">{result.bhsUid}</dd>
              <dt>Line</dt>
              <dd>{result.lineId}</dd>
              <dt>Evaluation</dt>
              <dd>{result.evaluation}</dd>
              <dt>Tagging</dt>
              <dd>
                {result.taggingEligible
                  ? `Bag ${result.bagId ?? "linked"} added or linked to Tagging Queue`
                  : "Accepted — no Tagging Queue item created"}
              </dd>
              <dt>Acknowledgement</dt>
              <dd>
                {result.acknowledgement.outcome} · {result.acknowledgement.timing}
              </dd>
            </dl>
          ) : null}
          {result ? (
            <Button asChild className="mt-3" type="button" variant="outline">
              <Link to="/tagging">Open Tagging Station</Link>
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
