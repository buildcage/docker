import { execFileSync } from "node:child_process";

const name = process.env.INPUT_NAME || "buildcage";

execFileSync("docker", ["buildx", "rm", name], { stdio: "inherit" });
