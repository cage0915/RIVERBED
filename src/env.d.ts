/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

type R2Bucket = import("@cloudflare/workers-types").R2Bucket;

interface ImportMetaEnv {
    readonly RIVERBED: R2Bucket;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}

declare namespace App {
    interface Locals {
        runtime: {
            env: {
                RIVERBED: R2Bucket;
            };
        };
    }
}
