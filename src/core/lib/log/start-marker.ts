/**
 * The line HAProxy logs once its config has loaded, before any traffic, so it
 * is always the proxy log's first line. The parsers read it to tell a log that
 * starts at the beginning from one whose head has rotated away.
 *
 * Written by `common/files/s6-rc.d/haproxy/data/start-marker.lua`, which
 * cannot import this, so a change here is a change there.
 */
export const PROXY_START_MARKER = "buildcage haproxy starting";
