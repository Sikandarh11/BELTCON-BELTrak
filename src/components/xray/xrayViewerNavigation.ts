import type { XrayImageView } from "@/types/xray";

export function normalizeXrayImages(images: readonly XrayImageView[]): XrayImageView[] {
  return images
    .map((image, index) => ({
      ...image,
      id: image.id.trim() || `view-${index + 1}`,
      label: image.label.trim() || `View ${index + 1}`,
      url: image.url.trim(),
    }))
    .filter((image) => image.url.length > 0);
}

export function getXrayImageKey(image: XrayImageView): string {
  return `${image.id}:${image.url}`;
}

export function getXrayImageSignature(images: readonly XrayImageView[]): string {
  return images.map(getXrayImageKey).join("|");
}

export function getNextXrayImageIndex(current: number, imageCount: number): number {
  return imageCount === 0 ? 0 : (current + 1) % imageCount;
}

export function getPreviousXrayImageIndex(current: number, imageCount: number): number {
  return imageCount === 0 ? 0 : (current - 1 + imageCount) % imageCount;
}

export function getNextWorkingXrayImageIndex(
  images: readonly XrayImageView[],
  current: number,
  failedImageIds: ReadonlySet<string>,
): number {
  if (images.length === 0) return 0;

  for (let offset = 1; offset < images.length; offset += 1) {
    const candidate = (current + offset) % images.length;
    if (!failedImageIds.has(getXrayImageKey(images[candidate]))) {
      return candidate;
    }
  }

  return current;
}
