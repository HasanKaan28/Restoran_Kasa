export const APP_VERSION: string = __APP_VERSION__;
/**
 * The build this page came from (src/pwa/precache.ts stamps it; version.json repeats it), so an
 * open page can tell a newer deploy. Development builds have none.
 */
export const BUILD_ID: string = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';
