export const MOUNTAIN_CONTOUR_ASSET_ROOT = "/contours";
export const MOUNTAIN_CONTOUR_PUBLIC_ASSET_ROOT = "/contour-assets";

export function getMountainContourAssetName(name: string): string {
  return name
    .normalize("NFC")
    .replaceAll("/", "／")
    .replaceAll("\\", "＼");
}

export function getMountainContourAssetUrl(
  region: string,
  name: string,
): string {
  const assetName = getMountainContourAssetName(name);
  if (import.meta.env?.DEV) {
    return `${MOUNTAIN_CONTOUR_ASSET_ROOT}/${encodeURIComponent(region)}/${encodeURIComponent(assetName)}.svg`;
  }

  const bytes = new TextEncoder().encode(assetName);
  const encodedName = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${MOUNTAIN_CONTOUR_PUBLIC_ASSET_ROOT}/${encodeURIComponent(region)}/${encodedName}.svg`;
}
