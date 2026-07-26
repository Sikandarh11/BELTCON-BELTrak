import type { ScreeningImageV1 } from "@/types/screening";

export type MockXrayImage = ScreeningImageV1;

export interface MockXraySet {
  id: string;
  label: string;
  images: readonly MockXrayImage[];
}

/**
 * Static, user-supplied preview assets. These paths are sent as references
 * only; the simulator never uploads, encodes, or generates image data.
 */
export const MOCK_XRAY_SETS: readonly MockXraySet[] = [
  {
    id: "user-set-01",
    label: "User X-ray Set 01",
    images: [
      {
        imageId: "SIDE-01",
        view: "SIDE",
        label: "Side view",
        imageRef: "/mock-xray/user/set-01/side.jpg",
        mimeType: "image/jpeg",
      },
      {
        imageId: "TOP-01",
        view: "TOP",
        label: "Top view",
        imageRef: "/mock-xray/user/set-01/top.jpg",
        mimeType: "image/jpeg",
      },
      {
        imageId: "DENSITY-01",
        view: "DENSITY",
        label: "Density view",
        imageRef: "/mock-xray/user/set-01/density.jpg",
        mimeType: "image/jpeg",
      },
    ],
  },
];

export function getMockXraySet(imageSetId: string): MockXraySet | undefined {
  return MOCK_XRAY_SETS.find((imageSet) => imageSet.id === imageSetId);
}
