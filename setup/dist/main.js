"use strict";

var node_child_process = require("node:child_process"), node_path = require("node:path"), node_url = require("node:url"), _documentCurrentScript = "undefined" != typeof document ? document.currentScript : null;

function buildRules(rulesInput) {
  return (rulesInput?.trim().split(/\s+/).filter(Boolean) ?? []).map(convertRule);
}

function convertRule(rule) {
  if (rule.startsWith("~")) {
    const regex = rule.slice(1);
    try {
      new RegExp(regex);
    } catch (e) {
      throw new Error(`Invalid regex in rule "${rule}": ${e.message}`);
    }
    return regex;
  }
  return `^${function(pattern) {
    if (!/^[^:]+:(?:\d+|\*)$/.test(pattern)) throw new Error(`Invalid pattern "${pattern}"`);
    const [domain, port] = pattern.split(":"), portRegex = "*" === port ? "\\d+" : port;
    return `${function(domain) {
      const regexParts = domain.split(".").map(part => {
        if ("**" === part) return ".+";
        if ("*" === part) return "[^.]+";
        if (part.includes("*")) throw new Error(`Invalid wildcard in "${domain}": part "${part}" mixes "*" with other characters`);
        return part.replace(/[.+^$()[\]{}|\\]/g, "\\$&").replace(/\?/g, "[^.]");
      });
      return regexParts.join("\\.");
    }(domain)}:${portRegex}`;
  }(rule)}$`;
}

const __dirname$1 = node_path.dirname(node_url.fileURLToPath("undefined" == typeof document ? require("url").pathToFileURL(__filename).href : _documentCurrentScript && "SCRIPT" === _documentCurrentScript.tagName.toUpperCase() && _documentCurrentScript.src || new URL("main.js", document.baseURI).href)), composeFile = node_path.join(__dirname$1, "../compose.yml");

function logRules(label, rules) {
  console.log(`${label} rules:${0 === rules.length ? " (none)" : ""}`);
  for (const r of rules) console.log(`  ${r}`);
}

!function() {
  const env = process.env, image = function({imageInput: imageInput, versionInput: versionInput, actionRepository: actionRepository, actionRef: actionRef}) {
    const repository = (imageInput || `ghcr.io/${actionRepository}`).toLowerCase(), tag = function(repository, {versionInput: versionInput, actionRef: actionRef}) {
      if (versionInput) return versionInput;
      if (actionRef) {
        const tag = /^[0-9a-f]{40}$/i.test(actionRef) ? `sha-${actionRef.toLowerCase()}` : actionRef.startsWith("v") ? actionRef.slice(1) : actionRef;
        try {
          return node_child_process.execFileSync("docker", [ "manifest", "inspect", `${repository}:${tag}` ], {
            stdio: "pipe"
          }), tag;
        } catch {}
      }
      return "1";
    }(repository, {
      versionInput: versionInput,
      actionRef: actionRef
    });
    return {
      repository: repository,
      tag: tag
    };
  }({
    imageInput: env.INPUT_BUILDCAGE_IMAGE,
    versionInput: env.INPUT_BUILDCAGE_VERSION,
    actionRepository: env.GITHUB_ACTION_REPOSITORY,
    actionRef: env.GITHUB_ACTION_REF
  });
  let rules;
  console.log(`buildcage image: ${image.repository}:${image.tag}`);
  try {
    rules = function({httpsRulesInput: httpsRulesInput, httpRulesInput: httpRulesInput, ipRulesInput: ipRulesInput}) {
      const httpsRules = httpsRulesInput?.trim().split(/\s+/).filter(Boolean) ?? [], httpRules = httpRulesInput?.trim().split(/\s+/).filter(Boolean) ?? [], ipRules = ipRulesInput?.trim().split(/\s+/).filter(Boolean) ?? [];
      return buildRules(httpsRulesInput), buildRules(httpRulesInput), buildRules(ipRulesInput), 
      {
        httpsRules: httpsRules,
        httpRules: httpRules,
        ipRules: ipRules
      };
    }({
      httpsRulesInput: env.INPUT_ALLOWED_HTTPS_RULES,
      httpRulesInput: env.INPUT_ALLOWED_HTTP_RULES,
      ipRulesInput: env.INPUT_ALLOWED_IP_RULES
    });
  } catch (e) {
    console.log(`::error::${e.message}`), process.exit(1);
  }
  console.log("::group::Configured ACL Rules"), logRules("HTTPS", rules.httpsRules), 
  logRules("HTTP", rules.httpRules), logRules("IP", rules.ipRules), console.log("::endgroup::");
  const composeEnv = {
    ...env,
    BUILDER_NAME: env.INPUT_BUILDER_NAME || "buildcage",
    PROXY_MODE: env.INPUT_PROXY_MODE || "restrict",
    ALLOWED_HTTPS_RULES: rules.httpsRules.join("\n"),
    ALLOWED_HTTP_RULES: rules.httpRules.join("\n"),
    ALLOWED_IP_RULES: rules.ipRules.join("\n"),
    BUILDCAGE_IMAGE: image.repository,
    BUILDCAGE_VERSION: image.tag
  };
  node_child_process.execFileSync("docker", [ "compose", "-f", composeFile, "down" ], {
    stdio: "inherit",
    env: composeEnv
  }), node_child_process.execFileSync("docker", [ "compose", "-f", composeFile, "up", "-d", "--pull", "always", "--no-build", "--wait" ], {
    stdio: "inherit",
    env: composeEnv
  });
}();
