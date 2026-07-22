import rss from "@astrojs/rss";
import type { APIContext } from "astro";
import { getAlbumSummaries } from "../lib/albums/catalog";
import { getFolderTitle, getImageUrl } from "../lib/constants";

export const prerender = true;

const escapeHtml = (value: string) => value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

export async function GET({ site }: APIContext) {
    if (!site) {
        throw new Error("RSS requires the site URL in astro.config.mjs");
    }

    const albums = (await getAlbumSummaries())
        .filter((album) => Boolean(album.publishedAt))
        .sort((a, b) => {
            const dateDifference = Date.parse(b.publishedAt!) - Date.parse(a.publishedAt!);
            return dateDifference || a.slug.localeCompare(b.slug);
        });

    return rss({
        title: "RIVERBED",
        description: "RIVERBED photography albums",
        site,
        items: albums.map((album) => {
            const folder = album.folder;
            const resolvedCoverKey = album.cover.assetKey;
            const coverUrl = getImageUrl(resolvedCoverKey);
            const info = album.info?.trim();

            return {
                title: album.title,
                description: info || getFolderTitle(folder),
                pubDate: new Date(`${album.publishedAt}T00:00:00Z`),
                link: `/${album.slug}`,
                categories: [getFolderTitle(folder)],
                content: [
                    `<p><img src="${escapeHtml(coverUrl)}" alt="${escapeHtml(album.title)}" /></p>`,
                    info ? `<p>${escapeHtml(info)}</p>` : "",
                ].join(""),
            };
        }),
        customData: "<language>zh-TW</language>",
    });
}
