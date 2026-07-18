export const MOUNTAIN_CONTOUR_ASSET_ROOT = "/contours";

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
  return `${MOUNTAIN_CONTOUR_ASSET_ROOT}/${encodeURIComponent(region)}/${encodeURIComponent(getMountainContourAssetName(name))}.svg`;
}
