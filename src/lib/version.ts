import packageJson from "../../package.json" with { type: "json" };

/** The release this build is cut for; image verification looks the release up by it. */
export const ACTION_VERSION: string = packageJson.version;
