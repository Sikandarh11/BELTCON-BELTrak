import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  CheckCircle2,
  CopyCheck,
  ImageOff,
  RefreshCw,
  RotateCw,
  Send,
  ShieldAlert,
  TriangleAlert,
} from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";

import { useSession } from "@/auth/SessionContext";
import { hasPermission } from "@/auth/permissions";
import { PageHeader, Panel } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  screeningSimulatorInputSchema,
  type ScreeningSimulatorInput,
} from "@/services/integrations/screening/screeningSchemas";
import { auditKeys, bagKeys, rfidKeys, taggingKeys } from "@/lib/queryKeys";
import { getMockXraySet, MOCK_XRAY_SETS } from "./mockXraySets";

type ScanState = ScreeningSimulatorInput["scanStatus"];
type ResultState =
  | "IDLE"
  | "SENDING"
  | "ACCEPTED"
  | "ACCEPTED_PENDING"
  | "ACCEPTED_MISSING"
  | "DUPLICATE"
  | "CONFLICT"
  | "FAILED";

interface SimulatorFormState {
  eventId: string;
  bhsUid: string;
  iataCode: string;
  iataOrigin: string;
  flightNo: string;
  passengerName: string;
  threatType: string;
  threatLevel: number;
  screeningStation: string;
  screeningTimestamp: string;
  externalScanId: string;
  scanStatus: ScanState;
  imageSetId: string;
}

interface SimulatorResponse {
  status?: "ACCEPTED" | "DUPLICATE";
  eventId?: string;
  bagId?: string;
  scanId?: string;
  scanStatus?: ScreeningSimulatorInput["scanStatus"] | "ARCHIVED";
  bhsUid?: string;
  error?: string;
  code?: string;
  conflictCode?: string;
}

const SCAN_STATES: readonly ScanState[] = ["AVAILABLE", "PENDING", "NOT_FOUND", "FAILED"];
const SIMULATOR_THREAT_TYPES = ["Suspect Bag", "Explosive", "Weapon", "Restricted Item"] as const;

const RESULT_DETAILS: Record<
  Exclude<ResultState, "IDLE" | "SENDING">,
  { label: string; className: string }
> = {
  ACCEPTED: {
    label: "Accepted",
    className: "border-success/30 bg-success/10 text-success",
  },
  ACCEPTED_PENDING: {
    label: "Accepted with pending image",
    className: "border-warning/30 bg-warning/10 text-warning",
  },
  ACCEPTED_MISSING: {
    label: "Accepted with missing image",
    className: "border-warning/30 bg-warning/10 text-warning",
  },
  DUPLICATE: {
    label: "Duplicate",
    className: "border-info/30 bg-info/10 text-info",
  },
  CONFLICT: {
    label: "Conflict",
    className: "border-danger/30 bg-danger/10 text-danger",
  },
  FAILED: {
    label: "Failed",
    className: "border-danger/30 bg-danger/10 text-danger",
  },
};

function createEventId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function createSequence() {
  return String(Date.now() % 10_000_000_000).padStart(10, "0");
}

function toLocalDateTime(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function createInitialForm(threatType: string): SimulatorFormState {
  const sequence = createSequence();
  return {
    eventId: createEventId(),
    bhsUid: `BHS-SIM-${sequence}`,
    iataCode: sequence,
    iataOrigin: "RUH",
    flightNo: "SV123",
    passengerName: "Simulator Passenger",
    threatType,
    threatLevel: 3,
    screeningStation: "HBSS-SIM-01",
    screeningTimestamp: toLocalDateTime(),
    externalScanId: `SCAN-SIM-${sequence}`,
    scanStatus: "AVAILABLE",
    imageSetId: MOCK_XRAY_SETS[0]?.id ?? "",
  };
}

function resultStateFor(response: SimulatorResponse): ResultState {
  if (response.status === "DUPLICATE") return "DUPLICATE";
  if (response.scanStatus === "PENDING") return "ACCEPTED_PENDING";
  if (response.scanStatus === "NOT_FOUND") return "ACCEPTED_MISSING";
  if (response.scanStatus === "FAILED") return "FAILED";
  return "ACCEPTED";
}

export function ScreeningHbssSimulator() {
  const session = useSession();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<SimulatorFormState>(() =>
    createInitialForm(SIMULATOR_THREAT_TYPES[0]),
  );
  const [resultState, setResultState] = useState<ResultState>("IDLE");
  const [response, setResponse] = useState<SimulatorResponse | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [lastSubmittedPayload, setLastSubmittedPayload] = useState<ScreeningSimulatorInput | null>(
    null,
  );

  const selectedImageSet = useMemo(() => getMockXraySet(form.imageSetId), [form.imageSetId]);
  const canUseSimulator = hasPermission(session.permissions, "simulator.use");
  const availableWithoutImages = form.scanStatus === "AVAILABLE" && !selectedImageSet;
  const sending = resultState === "SENDING";

  function updateForm<K extends keyof SimulatorFormState>(field: K, value: SimulatorFormState[K]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function createPayload(): ScreeningSimulatorInput | null {
    const timestamp = new Date(form.screeningTimestamp);
    const candidate = {
      ...form,
      screeningTimestamp: Number.isNaN(timestamp.getTime())
        ? form.screeningTimestamp
        : timestamp.toISOString(),
      imageSetId: selectedImageSet?.id ?? null,
      images:
        form.scanStatus === "AVAILABLE" && selectedImageSet
          ? selectedImageSet.images.map((image) => ({ ...image }))
          : [],
    };
    const parsed = screeningSimulatorInputSchema.safeParse(candidate);

    if (!parsed.success) {
      setValidationErrors(
        parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      );
      return null;
    }

    setValidationErrors([]);
    return parsed.data;
  }

  async function sendPayload(payload: ScreeningSimulatorInput, rememberPayload: boolean) {
    if (rememberPayload) {
      setLastSubmittedPayload(structuredClone(payload));
    }
    setResultState("SENDING");
    setResponse(null);

    try {
      const request = await fetch("/api/dev/simulator/suspect-events", {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          "x-request-id": `simulator-${payload.eventId}`,
        },
        body: JSON.stringify(payload),
      });
      const body = (await request.json()) as SimulatorResponse;
      setResponse(body);

      if (request.status === 409) {
        setResultState("CONFLICT");
        return;
      }
      if (!request.ok) {
        setResultState("FAILED");
        return;
      }

      setResultState(resultStateFor(body));
      await Promise.allSettled([
        queryClient.invalidateQueries({ queryKey: taggingKeys.all }),
        queryClient.invalidateQueries({ queryKey: bagKeys.all }),
        queryClient.invalidateQueries({ queryKey: rfidKeys.trackableBags() }),
        queryClient.invalidateQueries({ queryKey: auditKeys.all }),
      ]);
    } catch (error) {
      setResponse({
        error: error instanceof Error ? error.message : "Unable to send simulator event",
      });
      setResultState("FAILED");
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = createPayload();
    if (!payload) return;
    void sendPayload(payload, true);
  }

  function regenerateEventId() {
    updateForm("eventId", createEventId());
    setResultState("IDLE");
    setResponse(null);
    setValidationErrors([]);
  }

  return (
    <div className="p-6 pt-2">
      <PageHeader
        title="Screening/HBSS Simulator"
        subtitle="Send normalized suspect events through the server-side screening ingestion pipeline"
      />

      {!canUseSimulator ? (
        <div className="mb-4 flex gap-3 rounded-md border border-warning/30 bg-warning/10 p-3 text-[12px] text-warning">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          <div>
            Submission requires the persisted <strong>simulator.use</strong> permission and an
            enabled non-production simulator. Workspace selection does not grant it.
          </div>
        </div>
      ) : null}

      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-12 space-y-4 xl:col-span-8">
            <Panel title="Suspect event">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Event ID" htmlFor="sim-event-id" className="md:col-span-2">
                  <div className="flex gap-2">
                    <Input
                      id="sim-event-id"
                      required
                      value={form.eventId}
                      onChange={(event) => updateForm("eventId", event.target.value)}
                      className="font-mono"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={regenerateEventId}
                      aria-label="Generate new event ID"
                    >
                      <RefreshCw />
                      <span className="hidden sm:inline">Regenerate</span>
                    </Button>
                  </div>
                </Field>

                <Field label="BHS UID" htmlFor="sim-bhs-uid">
                  <Input
                    id="sim-bhs-uid"
                    required
                    value={form.bhsUid}
                    onChange={(event) => updateForm("bhsUid", event.target.value)}
                    className="font-mono"
                  />
                </Field>
                <Field label="IATA bag code" htmlFor="sim-iata-code">
                  <Input
                    id="sim-iata-code"
                    required
                    inputMode="numeric"
                    minLength={10}
                    maxLength={10}
                    pattern="\d{10}"
                    value={form.iataCode}
                    onChange={(event) => updateForm("iataCode", event.target.value)}
                    className="font-mono"
                  />
                </Field>
                <Field label="IATA origin" htmlFor="sim-iata-origin">
                  <Input
                    id="sim-iata-origin"
                    required
                    maxLength={3}
                    pattern="[A-Z]{3}"
                    value={form.iataOrigin}
                    onChange={(event) => updateForm("iataOrigin", event.target.value.toUpperCase())}
                    className="font-mono uppercase"
                  />
                </Field>
                <Field label="Flight number" htmlFor="sim-flight-no">
                  <Input
                    id="sim-flight-no"
                    required
                    value={form.flightNo}
                    onChange={(event) => updateForm("flightNo", event.target.value)}
                  />
                </Field>
                <Field label="Passenger name" htmlFor="sim-passenger-name">
                  <Input
                    id="sim-passenger-name"
                    required
                    value={form.passengerName}
                    onChange={(event) => updateForm("passengerName", event.target.value)}
                  />
                </Field>
                <Field label="Threat type" htmlFor="sim-threat-type">
                  <select
                    id="sim-threat-type"
                    required
                    value={form.threatType}
                    onChange={(event) => updateForm("threatType", event.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm"
                  >
                    {SIMULATOR_THREAT_TYPES.map((threatType) => (
                      <option key={threatType}>{threatType}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Threat level" htmlFor="sim-threat-level">
                  <select
                    id="sim-threat-level"
                    value={form.threatLevel}
                    onChange={(event) => updateForm("threatLevel", Number(event.target.value))}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm"
                  >
                    {[1, 2, 3, 4, 5].map((level) => (
                      <option key={level} value={level}>
                        {level}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Screening station" htmlFor="sim-station">
                  <Input
                    id="sim-station"
                    required
                    value={form.screeningStation}
                    onChange={(event) => updateForm("screeningStation", event.target.value)}
                  />
                </Field>
                <Field label="Screening timestamp" htmlFor="sim-screened-at">
                  <Input
                    id="sim-screened-at"
                    required
                    type="datetime-local"
                    value={form.screeningTimestamp}
                    onChange={(event) => updateForm("screeningTimestamp", event.target.value)}
                  />
                </Field>
                <Field label="External scan ID" htmlFor="sim-scan-id">
                  <Input
                    id="sim-scan-id"
                    required
                    value={form.externalScanId}
                    onChange={(event) => updateForm("externalScanId", event.target.value)}
                    className="font-mono"
                  />
                </Field>
                <Field label="Scan state" htmlFor="sim-scan-state">
                  <select
                    id="sim-scan-state"
                    value={form.scanStatus}
                    onChange={(event) => updateForm("scanStatus", event.target.value as ScanState)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm"
                  >
                    {SCAN_STATES.map((status) => (
                      <option key={status}>{status}</option>
                    ))}
                  </select>
                </Field>
              </div>
            </Panel>
          </div>

          <div className="col-span-12 space-y-4 xl:col-span-4">
            <Panel title="Static image set">
              <Field label="Image-set selection" htmlFor="sim-image-set">
                <select
                  id="sim-image-set"
                  value={form.imageSetId}
                  onChange={(event) => updateForm("imageSetId", event.target.value)}
                  disabled={MOCK_XRAY_SETS.length === 0}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm disabled:opacity-50"
                >
                  {MOCK_XRAY_SETS.length === 0 ? (
                    <option value="">No image sets registered</option>
                  ) : (
                    MOCK_XRAY_SETS.map((imageSet) => (
                      <option key={imageSet.id} value={imageSet.id}>
                        {imageSet.label}
                      </option>
                    ))
                  )}
                </select>
              </Field>

              {MOCK_XRAY_SETS.length === 0 ? (
                <div className="mt-3 flex gap-2 rounded-md border border-warning/30 bg-warning/10 p-3 text-[11px] text-warning">
                  <ImageOff className="size-4 shrink-0" />
                  Add JPG or PNG files under <code>public/mock-xray/user/&lt;set-folder&gt;/</code>,
                  then register their paths in <code>src/features/simulator/mockXraySets.ts</code>.
                </div>
              ) : null}

              {selectedImageSet ? (
                <div className="mt-4 grid grid-cols-2 gap-2">
                  {selectedImageSet.images.map((image) => (
                    <figure
                      key={image.imageId}
                      className="overflow-hidden rounded-md border border-border bg-muted/20"
                    >
                      <img
                        src={image.imageRef}
                        alt={`${selectedImageSet.label}: ${image.label}`}
                        className="aspect-video w-full object-cover"
                      />
                      <figcaption className="px-2 py-1.5 text-[10px] text-muted-foreground">
                        {image.label}
                      </figcaption>
                    </figure>
                  ))}
                </div>
              ) : null}

              <p className="mt-3 text-[11px] text-muted-foreground">
                Preview only. Files remain static and are never uploaded or encoded.
                {form.scanStatus !== "AVAILABLE"
                  ? ` Images will not be attached while scan state is ${form.scanStatus}.`
                  : ""}
              </p>
            </Panel>

            {validationErrors.length > 0 ? (
              <div
                role="alert"
                className="rounded-md border border-danger/30 bg-danger/10 p-3 text-[11px] text-danger"
              >
                <div className="mb-1 flex items-center gap-1.5 font-semibold">
                  <TriangleAlert className="size-3.5" />
                  Check the simulator fields
                </div>
                <ul className="list-disc space-y-1 pl-5">
                  {validationErrors.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <Button
              type="submit"
              className="w-full"
              disabled={sending || availableWithoutImages || !canUseSimulator}
            >
              {sending ? <RotateCw className="animate-spin" /> : <Send />}
              {sending ? "Sending" : "Mark Suspect and Send to SBTS"}
            </Button>
            {availableWithoutImages ? (
              <p className="text-center text-[11px] text-danger">
                AVAILABLE requires a registered image set.
              </p>
            ) : null}
          </div>
        </div>
      </form>

      {resultState !== "IDLE" ? (
        <SimulatorResult
          state={resultState}
          response={response}
          canResend={Boolean(lastSubmittedPayload) && !sending}
          onResend={() => {
            if (lastSubmittedPayload) {
              void sendPayload(structuredClone(lastSubmittedPayload), false);
            }
          }}
          onGenerateNew={regenerateEventId}
        />
      ) : null}
    </div>
  );
}

function Field({
  label,
  htmlFor,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <Label htmlFor={htmlFor} className="mb-1.5 block text-[11px] text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}

function SimulatorResult({
  state,
  response,
  canResend,
  onResend,
  onGenerateNew,
}: {
  state: Exclude<ResultState, "IDLE">;
  response: SimulatorResponse | null;
  canResend: boolean;
  onResend: () => void;
  onGenerateNew: () => void;
}) {
  if (state === "SENDING") {
    return (
      <div className="mt-4 flex items-center gap-2 rounded-md border border-info/30 bg-info/10 p-4 text-sm text-info">
        <RotateCw className="size-4 animate-spin" />
        Sending
      </div>
    );
  }

  const details = RESULT_DETAILS[state];
  const ResultIcon =
    state === "ACCEPTED" ||
    state === "ACCEPTED_PENDING" ||
    state === "ACCEPTED_MISSING" ||
    state === "DUPLICATE"
      ? state === "DUPLICATE"
        ? CopyCheck
        : CheckCircle2
      : TriangleAlert;

  return (
    <div className={`mt-4 rounded-md border p-4 ${details.className}`}>
      <div className="flex items-center gap-2 text-sm font-semibold">
        <ResultIcon className="size-4" />
        {details.label}
      </div>
      {response?.error ? <p className="mt-2 text-[12px]">{response.error}</p> : null}
      {response?.conflictCode ? (
        <p className="mt-1 font-mono text-[11px]">{response.conflictCode}</p>
      ) : null}

      <dl className="mt-3 grid gap-x-4 gap-y-1 text-[11px] sm:grid-cols-[auto_1fr_auto_1fr]">
        <ResultField label="Event ID" value={response?.eventId} />
        <ResultField label="Bag ID" value={response?.bagId} />
        <ResultField label="Scan ID" value={response?.scanId} />
        <ResultField label="Scan status" value={response?.scanStatus} />
        <ResultField label="BHS UID" value={response?.bhsUid} />
      </dl>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button asChild type="button" size="sm" variant="outline">
          <Link to="/tagging">Open Tagging Station</Link>
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={!canResend} onClick={onResend}>
          <RotateCw />
          Resend exact event
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onGenerateNew}>
          <RefreshCw />
          Generate new event ID
        </Button>
      </div>
    </div>
  );
}

function ResultField({ label, value }: { label: string; value?: string }) {
  return (
    <>
      <dt className="text-current/70">{label}</dt>
      <dd className="break-all font-mono">{value ?? "—"}</dd>
    </>
  );
}
