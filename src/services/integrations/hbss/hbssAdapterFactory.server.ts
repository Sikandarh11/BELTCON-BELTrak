import type { HbssAdapter } from "./hbssAdapter";
import { mockHbssAdapter } from "./mockHbssAdapter.server";
import { smithsHbssAdapter } from "./smithsHbssAdapter.server";

export function createHbssAdapter(): HbssAdapter {
  const configuredAdapter = process.env.HBSS_ADAPTER;

  switch (configuredAdapter) {
    case "mock":
      return mockHbssAdapter;

    case "smiths":
      return smithsHbssAdapter;

    default:
      throw new Error(`Unsupported HBSS adapter: ${configuredAdapter}`);
  }
}
