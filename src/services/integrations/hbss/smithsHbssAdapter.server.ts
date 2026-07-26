import type { HbssAdapter } from "./hbssAdapter";
import { HbssConfigurationError } from "./hbssErrors";

const NOT_CONFIGURED_MESSAGE =
  "Smiths HBSS adapter is not configured. Vendor ICD or SDK documentation is required.";

function notConfigured(): never {
  throw new HbssConfigurationError(NOT_CONFIGURED_MESSAGE);
}

export const smithsHbssAdapter: HbssAdapter = {
  name: "SMITHS_HBSS",

  async getScanByBhsUid() {
    return notConfigured();
  },

  async healthCheck() {
    return notConfigured();
  },
};
