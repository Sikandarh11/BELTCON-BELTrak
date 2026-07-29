import { create } from "zustand";

/**
 * Local interface preferences only.  BELTCON SBTS operational records belong
 * in authenticated server APIs and the TanStack Query cache, never this store.
 */
export type TableDensity = "compact" | "comfortable";
export type MapLayer = "operations" | "zones" | "readers";

interface UiPreferenceState {
  sidebarCollapsed: boolean;
  tableDensity: TableDensity;
  selectedMapLayer: MapLayer;
  simulatorPlaybackSpeed: number;
  simulatorPanelTab: "screening" | "rfid";
  setSidebarCollapsed: (sidebarCollapsed: boolean) => void;
  setTableDensity: (tableDensity: TableDensity) => void;
  setSelectedMapLayer: (selectedMapLayer: MapLayer) => void;
  setSimulatorPlaybackSpeed: (simulatorPlaybackSpeed: number) => void;
  setSimulatorPanelTab: (simulatorPanelTab: "screening" | "rfid") => void;
}

export const useAppStore = create<UiPreferenceState>((set) => ({
  sidebarCollapsed: false,
  tableDensity: "comfortable",
  selectedMapLayer: "operations",
  simulatorPlaybackSpeed: 1,
  simulatorPanelTab: "screening",
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
  setTableDensity: (tableDensity) => set({ tableDensity }),
  setSelectedMapLayer: (selectedMapLayer) => set({ selectedMapLayer }),
  setSimulatorPlaybackSpeed: (simulatorPlaybackSpeed) => set({ simulatorPlaybackSpeed }),
  setSimulatorPanelTab: (simulatorPanelTab) => set({ simulatorPanelTab }),
}));
