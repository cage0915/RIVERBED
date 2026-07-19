/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

type R2Bucket = import("@cloudflare/workers-types").R2Bucket;

interface ImportMetaEnv {
    readonly RIVERBED: R2Bucket;
    readonly PEAKFINDER_ENABLED?: string;
    readonly R2_ACCOUNT_ID?: string;
    readonly R2_ACCESS_KEY_ID?: string;
    readonly R2_SECRET_ACCESS_KEY?: string;
    readonly R2_BUCKET?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}

declare namespace App {
    interface Locals {
        runtime: {
            env: {
                RIVERBED: R2Bucket;
                PEAKFINDER_ENABLED?: string;
            };
        };
    }
}
