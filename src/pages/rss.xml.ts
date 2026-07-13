import rss from "@astrojs/rss";
import { getCollection } from "astro:content";
import type { APIContext } from "astro";
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

    const albums = (await getCollection("albums", ({ data }) => Boolean(data.publishedAt)))
        .sort((a, b) => {
            const dateDifference = b.data.publishedAt!.getTime() - a.data.publishedAt!.getTime();
            return dateDifference || a.slug.localeCompare(b.slug);
        });

    return rss({
        title: "RIVERBED",
        description: "RIVERBED photography albums",
        site,
        items: albums.map((album) => {
            const folder = album.slug.split("/")[0];
            const resolvedCoverKey = album.data.coverKey.includes("/")
                ? album.data.coverKey
                : `${album.slug}/${album.data.coverKey}`;
            const coverUrl = getImageUrl(resolvedCoverKey);
            const info = album.data.info?.trim();

            return {
                title: album.data.title,
                description: info || getFolderTitle(folder),
                pubDate: album.data.publishedAt,
                link: `/${album.slug}`,
                categories: [getFolderTitle(folder)],
                content: [
                    `<p><img src="${escapeHtml(coverUrl)}" alt="${escapeHtml(album.data.title)}" /></p>`,
                    info ? `<p>${escapeHtml(info)}</p>` : "",
                ].join(""),
            };
        }),
        customData: "<language>zh-TW</language>",
    });
}
