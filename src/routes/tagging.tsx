import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Tag, ScanLine, CheckCircle2, XCircle, Printer, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Panel, PageHeader, StatusPill } from "@/components/AppLayout";
import { bagService } from "@/services/bagService";
import { useAppStore } from "@/store/appStore";

export const Route = createFileRoute("/tagging")({
  head: () => ({ meta: [{ title: "Tagging Station · BELTrak" }] }),
  component: TaggingStation,
});

function TaggingStation() {
  const bags = useAppStore((s) => s.bags);
  const [selectedBagId, setSelectedBagId] = useState<string | null>(null);
  const [encoding, setEncoding] = useState(false);
  const [encodeResult, setEncodeResult] = useState<"idle" | "success" | "fail">("idle");
  const [manualIata, setManualIata] = useState("");

  const pendingBags = bags.filter((b) => b.status === "IDENTIFIED");
  const recentlyTagged = bags
    .filter((b) => b.status !== "IDENTIFIED" && b.epc)
    .slice(-10)
    .reverse();

  const selectedBag = selectedBagId ? bags.find((b) => b.id === selectedBagId) : null;

  function handleEncode() {
    if (!selectedBag) return;
    setEncoding(true);
    setEncodeResult("idle");

    setTimeout(() => {
      const success = Math.random() > 0.15;
      if (success) {
        const epc = `EPC-${Date.now().toString().slice(-6)}`;
        try {
          bagService.assignEpc(selectedBag.id, epc);
          setEncodeResult("success");
          toast.success(`Tag encoded: ${epc}`, {
            description: `Bag ${selectedBag.iataCode} → TAGGED`,
          });
          setTimeout(() => {
            setSelectedBagId(null);
            setEncodeResult("idle");
          }, 2000);
        } catch (err: any) {
          toast.error(err.message);
          setEncodeResult("fail");
        }
      } else {
        setEncodeResult("fail");
        toast.error("Encode failed — verify-after-write error", {
          description: "Re-encode required before bag can be released",
        });
      }
      setEncoding(false);
    }, 1500);
  }

  function handleManualLookup() {
    const bag = bags.find((b) => b.iataCode === manualIata || b.bhsUid === manualIata);
    if (bag) {
      setSelectedBagId(bag.id);
      setManualIata("");
    } else {
      toast.error(`No bag found for "${manualIata}"`);
    }
  }

  return (
    <div className="p-6">
      <PageHeader
        title="Tagging Station"
        subtitle="Encode and verify RFID tags for suspect bags"
        actions={
          <div className="flex items-center gap-3 text-[12px]">
            <span className="text-muted-foreground">
              {pendingBags.length} bag{pendingBags.length !== 1 ? "s" : ""} pending
            </span>
            <StatusPill status={pendingBags.length > 0 ? "ACTIVE" : "Online"} />
          </div>
        }
      />

      <div className="grid grid-cols-12 gap-4">
        <Panel title="Incoming Suspect Bags" className="col-span-12 lg:col-span-3">
          <div className="flex gap-1.5 mb-3">
            <input
              placeholder="Scan IATA / BHS-UID..."
              value={manualIata}
              onChange={(e) => setManualIata(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleManualLookup()}
              className="flex-1 bg-background border border-border rounded px-3 py-3 text-[14px] font-mono"
            />
            <button
              onClick={handleManualLookup}
              className="px-3 py-3 rounded border border-border hover:bg-accent"
            >
              <ScanLine className="size-3.5" />
            </button>
          </div>

          {pendingBags.length === 0 ? (
            <div className="py-8 text-center text-[12px] text-muted-foreground">
              No bags pending — waiting for suspect flags
            </div>
          ) : (
            <ul className="space-y-1.5 max-h-96 overflow-y-auto">
              {pendingBags.map((b) => (
                <li key={b.id}>
                  <button
                    onClick={() => {
                      setSelectedBagId(b.id);
                      setEncodeResult("idle");
                    }}
                    className={`w-full text-left px-4 py-4 rounded-md border text-[14px] transition-colors ${
                      selectedBagId === b.id
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-accent/50"
                    }`}
                  >
                    <div className="font-mono font-semibold">{b.iataCode}</div>
                    <div className="text-muted-foreground mt-0.5">
                      {b.flight} · {b.bhsUid}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title={selectedBag ? `Encode Tag · ${selectedBag.iataCode}` : "Encode Tag"}
          className="col-span-12 lg:col-span-5"
        >
          {selectedBag ? (
            <div className="space-y-4">
              <dl className="grid grid-cols-3 gap-y-2 text-[13px]">
                <dt className="text-muted-foreground text-[12px]">IATA Code</dt>
                <dd className="col-span-2 font-mono">{selectedBag.iataCode}</dd>
                <dt className="text-muted-foreground text-[12px]">BHS UID</dt>
                <dd className="col-span-2 font-mono">{selectedBag.bhsUid}</dd>
                <dt className="text-muted-foreground text-[12px]">Flight</dt>
                <dd className="col-span-2 font-mono">{selectedBag.flight}</dd>
                <dt className="text-muted-foreground text-[12px]">Status</dt>
                <dd className="col-span-2">
                  <StatusPill status={selectedBag.status === "IDENTIFIED" ? "ACTIVE" : "Online"} />
                </dd>
                {selectedBag.epc && (
                  <>
                    <dt className="text-muted-foreground text-[12px]">EPC</dt>
                    <dd className="col-span-2 font-mono text-success">{selectedBag.epc}</dd>
                  </>
                )}
              </dl>

              {encodeResult === "success" && (
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-md bg-success/10 border border-success/30 text-[13px] text-success">
                  <CheckCircle2 className="size-4" />
                  Tag verified — bag released to tracking
                </div>
              )}
              {encodeResult === "fail" && (
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-md bg-danger/10 border border-danger/30 text-[13px] text-danger">
                  <XCircle className="size-4" />
                  Verify-after-write FAILED — do not release bag
                </div>
              )}

              {selectedBag.status === "IDENTIFIED" && (
                <div className="flex gap-2">
                  <button
                    onClick={handleEncode}
                    disabled={encoding}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-4 rounded-md bg-primary text-primary-foreground font-medium text-[16px] disabled:opacity-50 min-h-[48px]"
                  >
                    {encoding ? (
                      <>
                        <RefreshCw className="size-4 animate-spin" />
                        Encoding...
                      </>
                    ) : encodeResult === "fail" ? (
                      <>
                        <Printer className="size-4" />
                        Re-encode Tag
                      </>
                    ) : (
                      <>
                        <Printer className="size-4" />
                        Print &amp; Encode Tag
                      </>
                    )}
                  </button>
                </div>
              )}
              {selectedBag.status === "TAGGED" && (
                <div className="text-[12px] text-success font-medium text-center py-2">
                  ✓ Tag encoded and verified — bag is in tracking
                </div>
              )}
            </div>
          ) : (
            <div className="py-12 text-center text-[13px] text-muted-foreground">
              <Tag className="size-8 mx-auto mb-2 opacity-40" />
              Select a bag from the queue or scan a barcode
            </div>
          )}
        </Panel>

        <Panel title="Recently Tagged" className="col-span-12 lg:col-span-4">
          {recentlyTagged.length === 0 ? (
            <div className="py-8 text-center text-[12px] text-muted-foreground">
              No bags tagged yet
            </div>
          ) : (
            <ul className="space-y-1.5 max-h-96 overflow-y-auto">
              {recentlyTagged.map((b) => (
                <li
                  key={b.id}
                  className="flex items-center justify-between px-3 py-2 rounded-md border border-border text-[12px]"
                >
                  <div>
                    <div className="font-mono font-semibold">{b.iataCode}</div>
                    <div className="text-muted-foreground">{b.flight}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-[11px] text-success">{b.epc}</div>
                    <StatusPill status="Online" />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}