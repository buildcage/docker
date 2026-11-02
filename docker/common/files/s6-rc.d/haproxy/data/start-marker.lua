-- Guaranteed non-decision line, so report can tell "haproxy logged nothing"
-- apart from "haproxy never started". Logged by haproxy itself once its config
-- has loaded, ahead of any traffic, and stamped with a millisecond epoch so
-- the report can show every other line's time relative to this moment.
-- The text is PROXY_START_MARKER in src/core/lib/log/start-marker.ts.
core.register_init(function()
  local now = core.now()
  core.log(core.notice, string.format("buildcage haproxy starting %d", now.sec * 1000 + now.usec // 1000))
end)
