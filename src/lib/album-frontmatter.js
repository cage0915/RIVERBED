/**
 * @typedef {{ coverKey: string; coverZoom: number; coverOffset: { x: number; y: number } }} AlbumCoverConfig
 */

/**
 * @param {string} content
 * @param {AlbumCoverConfig} config
 */
export function applyAlbumCoverConfig(content, config) {
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) {
        throw new Error('Frontmatter not found');
    }

    const originalFrontmatter = frontmatterMatch[1];
    const remainingLines = originalFrontmatter
        .split('\n')
        .filter((line) => !/^(coverKey|coverZoom|coverOffset):/.test(line));

    remainingLines.push(`coverKey: "${config.coverKey}"`);
    remainingLines.push(`coverZoom: ${config.coverZoom}`);
    remainingLines.push(`coverOffset: { x: ${config.coverOffset.x}, y: ${config.coverOffset.y} }`);

    const nextFrontmatter = `---\n${remainingLines.join('\n')}\n---`;
    return content.replace(frontmatterMatch[0], nextFrontmatter);
}