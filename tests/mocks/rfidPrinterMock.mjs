import { createMockOperation, resetOperations } from "./mockOperation.mjs";

export function createRfidPrinterMock(overrides = {}) {
  const printer = {
    printTag: createMockOperation(
      "rfidPrinter.printTag",
      overrides.printTag ??
        (async (job) => ({ status: "PRINTED", jobId: job.jobId ?? "PRINT-P1-001" })),
    ),
    cancel: createMockOperation("rfidPrinter.cancel", overrides.cancel ?? (async () => true)),
  };
  printer.reset = () => resetOperations(printer);
  return printer;
}
