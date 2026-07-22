export const DEV_API_ROUTES = Object.freeze({
    'delete-album-page': './src/dev-api/delete-album-page.ts',
    'edit-caption': './src/dev-api/edit-caption.ts',
    'edit-tag': './src/dev-api/edit-tag.ts',
    'get-data': './src/dev-api/get-data.ts',
    'get-folder-structure': './src/dev-api/get-folder-structure.ts',
    'get-page-structure': './src/dev-api/get-page-structure.ts',
    'get-r2-cover-assets': './src/dev-api/get-r2-cover-assets.ts',
    'import-album-photos': './src/dev-api/import-album-photos.ts',
    'mountain-contexts': './src/dev-api/mountain-contexts.ts',
    'mountain-contour-preview': './src/dev-api/mountain-contour-preview.ts',
    'mountain-cover': './src/dev-api/mountain-cover.ts',
    'mountain-lookup': './src/dev-api/mountain-lookup.ts',
    'mountain-regions': './src/dev-api/mountain-regions.ts',
    mountains: './src/dev-api/mountains.ts',
    'r2-album-plan': './src/dev-api/r2-album-plan.ts',
    'r2-global-plan': './src/dev-api/r2-global-plan.ts',
    'r2-sync-album': './src/dev-api/r2-sync-album.ts',
    'r2-trash-objects': './src/dev-api/r2-trash-objects.ts',
    'rename-photos': './src/dev-api/rename-photos.ts',
    'save-album-cover': './src/dev-api/save-album-cover.ts',
    'save-folder-order': './src/dev-api/save-folder-order.ts',
    'save-page-manager': './src/dev-api/save-page-manager.ts',
    'save-page-structure': './src/dev-api/save-page-structure.ts',
    'save-tags': './src/dev-api/save-tags.ts',
});

const requestHeaders = (headers) => {
    const result = new Headers();
    for (const [name, value] of Object.entries(headers)) {
        if (value !== undefined) {
            result.set(name, Array.isArray(value) ? value.join(', ') : value);
        }
    }
    return result;
};

const requestBody = async (request) => {
    const chunks = [];
    for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return chunks.length > 0 ? Buffer.concat(chunks) : undefined;
};

export const createDevApiPlugin = () => ({
    name: 'riverbed-dev-api-middleware',
    enforce: 'pre',
    configureServer(server) {
        server.middlewares.use(async (incoming, outgoing, next) => {
            try {
                const url = new URL(
                    incoming.url || '/',
                    `http://${incoming.headers.host || 'localhost'}`,
                );
                const name = url.pathname.match(/^\/api\/([^/]+)\/?$/)?.[1];
                const entrypoint = name ? DEV_API_ROUTES[name] : undefined;
                if (!entrypoint) return next();

                const method = (incoming.method || 'GET').toUpperCase();
                const module = await server.ssrLoadModule(
                    entrypoint.replace(/^\./, ''),
                );
                const handler = module[method] ?? module.ALL;
                if (typeof handler !== 'function') {
                    outgoing.statusCode = 405;
                    outgoing.end('Method Not Allowed');
                    return;
                }

                const body = method === 'GET' || method === 'HEAD'
                    ? undefined
                    : await requestBody(incoming);
                const request = new Request(url, {
                    method,
                    headers: requestHeaders(incoming.headers),
                    body,
                    ...(body ? { duplex: 'half' } : {}),
                });
                const response = await handler({
                    request,
                    url,
                    params: {},
                    props: {},
                    locals: {},
                });

                outgoing.statusCode = response.status;
                response.headers.forEach((value, header) => {
                    outgoing.setHeader(header, value);
                });
                if (method === 'HEAD' || !response.body) {
                    outgoing.end();
                    return;
                }
                outgoing.end(Buffer.from(await response.arrayBuffer()));
            } catch (error) {
                next(error);
            }
        });
    },
});

export default function devApiRoutes() {
    return {
        name: 'riverbed-dev-api-routes',
        hooks: {
            'astro:config:setup': ({ command, updateConfig }) => {
                if (command !== 'dev') return;
                updateConfig({ vite: { plugins: [createDevApiPlugin()] } });
            },
        },
    };
}
