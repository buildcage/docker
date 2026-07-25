Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
//#region \0rolldown/runtime.js
var __create = Object.create, __defProp = Object.defineProperty, __getOwnPropDesc = Object.getOwnPropertyDescriptor, __getOwnPropNames = Object.getOwnPropertyNames, __getProtoOf = Object.getPrototypeOf, __hasOwnProp = Object.prototype.hasOwnProperty, __commonJSMin = (cb, mod) => () => (mod || (cb((mod = { exports: {} }).exports, mod), cb = null), mod.exports), __copyProps = (to, from, except, desc) => {
	if (from && typeof from == "object" || typeof from == "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) key = keys[i], !__hasOwnProp.call(to, key) && key !== except && __defProp(to, key, {
		get: ((k) => from[k]).bind(null, key),
		enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
	});
	return to;
}, __toESM = (mod, isNodeMode, target) => (target = mod == null ? {} : __create(__getProtoOf(mod)), __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
	value: mod,
	enumerable: !0
}) : target, mod));
//#endregion
let node_child_process = require("node:child_process"), node_fs = require("node:fs"), node_path = require("node:path");
node_path = __toESM(node_path, 1);
let node_url = require("node:url"), node_os = require("node:os");
node_os = __toESM(node_os, 1);
let node_crypto = require("node:crypto");
//#region core/lib/provenance/image-ref.ts
function resolveBuildcageImageRef({ imageDigest, actionRepository }) {
	return `${`ghcr.io/${actionRepository}`.toLowerCase()}@${imageDigest}`;
}
//#endregion
//#region core/lib/general/action-error.ts
/**
* Base class for an action's own "intentional" errors — a caught failure
* whose message is safe to print directly via ::error::, as opposed to an
* unexpected one. A top-level catch checks `instanceof ActionError`.
* `name` is derived from `new.target`, so a subclass needs no constructor
* of its own to get its own name.
*/
var ActionError = class extends Error {
	code;
	constructor(message, code) {
		super(message), this.name = new.target.name, this.code = code;
	}
}, VerifyImageError = class extends Error {
	code;
	constructor(message, code) {
		super(message), this.name = "VerifyImageError", this.code = code;
	}
}, ProvenanceError = class extends ActionError {};
//#endregion
//#region core/lib/general/error-message.ts
/**
* Safely extract a message from a caught value of unknown shape — a plain
* `Error` most of the time, but `catch` doesn't guarantee that.
*/
function errorMessage(e) {
	return e instanceof Error ? e.message : String(e);
}
//#endregion
//#region core/lib/provenance/oci-registry.ts
/**
* oci-registry.ts — OCI registry I/O helpers
*
* All errors are thrown as VerifyImageError (see errors.ts).
* Callers do not need to catch and re-wrap; just let them propagate.
*/
const BUNDLE_MEDIA_TYPE = "application/vnd.dev.sigstore.bundle.v0.3+json";
/**
* Read the base64 Basic-auth credential for ghcr.io from Docker's config.json.
* Returns the raw `auth` string (base64) if found, or null if not logged in.
* Credential helpers (credsStore/credHelpers) are not supported — only direct
* base64 auth written by `docker login` / `docker/login-action` is detected.
*/
function readGhcrBasicAuth(_env = process.env, _readFileSync = node_fs.readFileSync) {
	try {
		let configDir = _env.DOCKER_CONFIG ?? node_path.default.join(node_os.default.homedir(), ".docker"), config = JSON.parse(_readFileSync(node_path.default.join(configDir, "config.json"), "utf8"));
		for (let [key, value] of Object.entries(config.auths ?? {})) if (key.replace(/^https?:\/\//, "").replace(/\/$/, "") === "ghcr.io" && typeof value.auth == "string" && value.auth) return value.auth;
		return null;
	} catch {
		return null;
	}
}
/**
* Fetch the manifest digest for a container image tag via the OCI registry API.
* Uses HEAD /v2/{repo}/manifests/{tag} and reads the Docker-Content-Digest header.
*
* Throws VerifyImageError(NOT_FOUND) when the tag does not exist.
* Throws VerifyImageError(TRANSIENT) on network or 5xx errors.
*/
async function fetchManifestDigest(registry, repo, tag, token, _fetch = fetch) {
	let url = `https://${registry}/v2/${repo}/manifests/${tag}`, headers = {
		Authorization: `Bearer ${token}`,
		Accept: ["application/vnd.oci.image.index.v1+json", "application/vnd.docker.distribution.manifest.list.v2+json"].join(", ")
	};
	try {
		let resp = await _fetch(url, {
			method: "HEAD",
			headers
		});
		if (resp.status === 404) throw new VerifyImageError(`Docker image not found: ${registry}/${repo}:${tag}. Make sure the action ref corresponds to a published release.`, "NOT_FOUND");
		if (resp.status >= 500) throw new VerifyImageError(`Transient error fetching manifest for ${registry}/${repo}:${tag}: HTTP ${resp.status}`, "TRANSIENT");
		if (resp.status === 401 || resp.status === 403) throw new VerifyImageError(`Registry denied access to manifest for ${registry}/${repo}:${tag}: HTTP ${resp.status}. For private repositories, ensure the runner is authenticated to the registry.`, "TRANSIENT");
		if (!resp.ok) throw new VerifyImageError(`Failed to fetch manifest for ${registry}/${repo}:${tag}: HTTP ${resp.status}`, "TRANSIENT");
		let digest = resp.headers.get("Docker-Content-Digest");
		if (!digest) throw new VerifyImageError(`No digest in manifest response for ${registry}/${repo}:${tag}`, "TRANSIENT");
		return digest;
	} catch (err) {
		throw err instanceof VerifyImageError ? err : new VerifyImageError(`Transient error fetching manifest digest for ${registry}/${repo}:${tag}: ${errorMessage(err)}`, "TRANSIENT");
	}
}
/**
* Fetch a pull token via Docker Token Authentication.
*
* If Docker credentials for the registry are available (basicAuth from
* readGhcrBasicAuth), uses Basic auth directly — no anonymous attempt.
* Otherwise falls back to anonymous access (public packages).
*/
async function fetchRegistryToken(registry, repo, basicAuth, _fetch = fetch) {
	let url = `https://${registry}/token?scope=repository:${repo}:pull&service=${registry}`;
	if (basicAuth) try {
		let resp = await _fetch(url, { headers: { Authorization: `Basic ${basicAuth}` } });
		if (resp.status >= 500) throw new VerifyImageError(`Transient error from ${registry} token endpoint: HTTP ${resp.status}`, "TRANSIENT");
		if (resp.ok) return (await resp.json()).token;
		throw new VerifyImageError(`Registry authentication failed: HTTP ${resp.status}. The credentials in Docker config may be expired — run \`docker login ${registry}\` again.`, "TOKEN_ERROR");
	} catch (err) {
		throw err instanceof VerifyImageError ? err : new VerifyImageError(`Transient error fetching registry token: ${errorMessage(err)}`, "TRANSIENT");
	}
	try {
		let resp = await _fetch(url);
		if (resp.status >= 500) throw new VerifyImageError(`Transient error from ${registry} token endpoint: HTTP ${resp.status}`, "TRANSIENT");
		if (resp.ok) return (await resp.json()).token;
		throw new VerifyImageError(`Failed to get registry token: HTTP ${resp.status}. The package may be private. Run \`docker login ${registry}\` (or use docker/login-action with 'packages: read') before this action.`, "TOKEN_ERROR");
	} catch (err) {
		throw err instanceof VerifyImageError ? err : new VerifyImageError(`Transient error fetching registry token: ${errorMessage(err)}`, "TRANSIENT");
	}
}
/**
* Pull the Sigstore Bundle from the OCI registry.
* Tries the OCI 1.1 Referrers API first; falls back to the sha256-<hex> tag scheme.
*
* Throws VerifyImageError(NOT_FOUND) when no bundle exists for this digest.
* Throws VerifyImageError(TRANSIENT) on network or 5xx errors.
*/
async function fetchBundle(registry, repo, digest, token, _fetch = fetch) {
	let api = `https://${registry}/v2/${repo}`, headers = { Authorization: `Bearer ${token}` };
	try {
		let refResp = await _fetch(`${api}/referrers/${digest}?artifactType=application%2Fvnd.dev.sigstore.bundle.v0.3%2Bjson`, { headers });
		if (refResp.status >= 500) throw new VerifyImageError(`Transient error from referrers API: HTTP ${refResp.status}`, "TRANSIENT");
		if (refResp.ok) {
			let manifest = ((await refResp.json()).manifests ?? []).find((m) => m.artifactType === BUNDLE_MEDIA_TYPE);
			if (manifest) return fetchBundleFromManifestDigest(api, manifest.digest, headers, _fetch);
		}
	} catch (err) {
		throw err instanceof VerifyImageError ? err : new VerifyImageError(`Transient error fetching referrers: ${errorMessage(err)}`, "TRANSIENT");
	}
	let fallbackTag = digest.replace(":", "-");
	try {
		let tagResp = await _fetch(`${api}/manifests/${fallbackTag}`, { headers: {
			...headers,
			Accept: ["application/vnd.oci.image.index.v1+json", "application/vnd.oci.image.manifest.v1+json"].join(", ")
		} });
		if (tagResp.status === 404 || tagResp.status === 400) throw new VerifyImageError(`No Sigstore bundle found for digest ${digest}. The image may not have been signed with --new-bundle-format.`, "NOT_FOUND");
		if (tagResp.status >= 500) throw new VerifyImageError(`Transient error from fallback tag API: HTTP ${tagResp.status}`, "TRANSIENT");
		if (tagResp.status === 401 || tagResp.status === 403) throw new VerifyImageError(`Registry denied access to fallback tag: HTTP ${tagResp.status}. For private repositories, ensure the runner is authenticated to the registry.`, "TRANSIENT");
		if (!tagResp.ok) throw new VerifyImageError(`Unexpected error fetching fallback tag: HTTP ${tagResp.status}`, "NOT_FOUND");
		let tagManifest = await tagResp.json();
		if (Array.isArray(tagManifest.manifests)) {
			for (let m of tagManifest.manifests) {
				if (m.mediaType !== "application/vnd.oci.image.manifest.v1+json") continue;
				if (m.artifactType === BUNDLE_MEDIA_TYPE) return fetchBundleFromManifestDigest(api, m.digest, headers, _fetch);
				let subResp = await _fetch(`${api}/manifests/${m.digest}`, { headers: {
					...headers,
					Accept: "application/vnd.oci.image.manifest.v1+json"
				} });
				if (!subResp.ok) continue;
				let sub = await subResp.json();
				if (sub.artifactType !== BUNDLE_MEDIA_TYPE) continue;
				let layer = (sub.layers ?? []).find((l) => l.mediaType === BUNDLE_MEDIA_TYPE);
				if (layer) return fetchBundleBlob(api, layer.digest, headers, _fetch);
			}
			throw new VerifyImageError(`No Sigstore bundle found for digest ${digest}. The image may not have been signed with --new-bundle-format.`, "NOT_FOUND");
		}
		let layer = (tagManifest.layers ?? []).find((l) => l.mediaType === BUNDLE_MEDIA_TYPE);
		if (!layer) throw new VerifyImageError(`No Sigstore bundle found for digest ${digest}. The image may not have been signed with --new-bundle-format.`, "NOT_FOUND");
		return fetchBundleBlob(api, layer.digest, headers, _fetch);
	} catch (err) {
		throw err instanceof VerifyImageError ? err : new VerifyImageError(`Transient error fetching fallback tag: ${errorMessage(err)}`, "TRANSIENT");
	}
}
async function fetchBundleFromManifestDigest(api, manifestDigest, headers, _fetch = fetch) {
	try {
		let resp = await _fetch(`${api}/manifests/${manifestDigest}`, { headers: {
			...headers,
			Accept: "application/vnd.oci.image.manifest.v1+json"
		} });
		if (resp.status >= 500) throw new VerifyImageError(`Transient error fetching bundle manifest: HTTP ${resp.status}`, "TRANSIENT");
		if (resp.status === 401 || resp.status === 403) throw new VerifyImageError(`Registry denied access to bundle manifest: HTTP ${resp.status}`, "TRANSIENT");
		if (!resp.ok) throw new VerifyImageError(`Failed to fetch bundle manifest: HTTP ${resp.status}`, "TRANSIENT");
		let layer = ((await resp.json()).layers ?? []).find((l) => l.mediaType === BUNDLE_MEDIA_TYPE);
		if (!layer) throw new VerifyImageError("No Sigstore bundle layer found in bundle manifest", "NOT_FOUND");
		return fetchBundleBlob(api, layer.digest, headers, _fetch);
	} catch (err) {
		throw err instanceof VerifyImageError ? err : new VerifyImageError(`Transient error fetching bundle manifest: ${errorMessage(err)}`, "TRANSIENT");
	}
}
async function fetchBundleBlob(api, blobDigest, headers, _fetch = fetch) {
	try {
		let resp = await _fetch(`${api}/blobs/${blobDigest}`, { headers });
		if (resp.status >= 500) throw new VerifyImageError(`Transient error fetching bundle blob: HTTP ${resp.status}`, "TRANSIENT");
		if (resp.status === 401 || resp.status === 403) throw new VerifyImageError(`Registry denied access fetching bundle blob: HTTP ${resp.status}. For private repositories, ensure the runner is authenticated to the registry.`, "TRANSIENT");
		if (!resp.ok) throw new VerifyImageError(`Failed to fetch bundle blob: HTTP ${resp.status}`, "NOT_FOUND");
		return resp.json();
	} catch (err) {
		throw err instanceof VerifyImageError ? err : new VerifyImageError(`Transient error fetching bundle blob: ${errorMessage(err)}`, "TRANSIENT");
	}
}
//#endregion
//#region node_modules/.pnpm/@sigstore+protobuf-specs@0.5.1/node_modules/@sigstore/protobuf-specs/dist/__generated__/envelope.js
var require_envelope = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.Signature = exports.Envelope = void 0, exports.Envelope = {
		fromJSON(object) {
			return {
				payload: isSet(object.payload) ? Buffer.from(bytesFromBase64(object.payload)) : Buffer.alloc(0),
				payloadType: isSet(object.payloadType) ? globalThis.String(object.payloadType) : "",
				signatures: globalThis.Array.isArray(object?.signatures) ? object.signatures.map((e) => exports.Signature.fromJSON(e)) : []
			};
		},
		toJSON(message) {
			let obj = {};
			return message.payload.length !== 0 && (obj.payload = base64FromBytes(message.payload)), message.payloadType !== "" && (obj.payloadType = message.payloadType), message.signatures?.length && (obj.signatures = message.signatures.map((e) => exports.Signature.toJSON(e))), obj;
		}
	}, exports.Signature = {
		fromJSON(object) {
			return {
				sig: isSet(object.sig) ? Buffer.from(bytesFromBase64(object.sig)) : Buffer.alloc(0),
				keyid: isSet(object.keyid) ? globalThis.String(object.keyid) : ""
			};
		},
		toJSON(message) {
			let obj = {};
			return message.sig.length !== 0 && (obj.sig = base64FromBytes(message.sig)), message.keyid !== "" && (obj.keyid = message.keyid), obj;
		}
	};
	function bytesFromBase64(b64) {
		return Uint8Array.from(globalThis.Buffer.from(b64, "base64"));
	}
	function base64FromBytes(arr) {
		return globalThis.Buffer.from(arr).toString("base64");
	}
	function isSet(value) {
		return value != null;
	}
})), require_timestamp$3 = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.Timestamp = void 0, exports.Timestamp = {
		fromJSON(object) {
			return {
				seconds: isSet(object.seconds) ? globalThis.String(object.seconds) : "0",
				nanos: isSet(object.nanos) ? globalThis.Number(object.nanos) : 0
			};
		},
		toJSON(message) {
			let obj = {};
			return message.seconds !== "0" && (obj.seconds = message.seconds), message.nanos !== 0 && (obj.nanos = Math.round(message.nanos)), obj;
		}
	};
	function isSet(value) {
		return value != null;
	}
})), require_sigstore_common = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.TimeRange = exports.X509CertificateChain = exports.SubjectAlternativeName = exports.X509Certificate = exports.DistinguishedName = exports.ObjectIdentifierValuePair = exports.ObjectIdentifier = exports.PublicKeyIdentifier = exports.PublicKey = exports.RFC3161SignedTimestamp = exports.LogId = exports.MessageSignature = exports.HashOutput = exports.SubjectAlternativeNameType = exports.PublicKeyDetails = exports.HashAlgorithm = void 0, exports.hashAlgorithmFromJSON = hashAlgorithmFromJSON, exports.hashAlgorithmToJSON = hashAlgorithmToJSON, exports.publicKeyDetailsFromJSON = publicKeyDetailsFromJSON, exports.publicKeyDetailsToJSON = publicKeyDetailsToJSON, exports.subjectAlternativeNameTypeFromJSON = subjectAlternativeNameTypeFromJSON, exports.subjectAlternativeNameTypeToJSON = subjectAlternativeNameTypeToJSON;
	let timestamp_1 = require_timestamp$3();
	/**
	* Only a subset of the secure hash standard algorithms are supported.
	* See <https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.180-4.pdf> for more
	* details.
	* UNSPECIFIED SHOULD not be used, primary reason for inclusion is to force
	* any proto JSON serialization to emit the used hash algorithm, as default
	* option is to *omit* the default value of an enum (which is the first
	* value, represented by '0'.
	*/
	var HashAlgorithm;
	(function(HashAlgorithm) {
		/**
		* SHA3_384 - Used for LMS
		*
		* @deprecated
		*/
		HashAlgorithm[HashAlgorithm.HASH_ALGORITHM_UNSPECIFIED = 0] = "HASH_ALGORITHM_UNSPECIFIED", HashAlgorithm[HashAlgorithm.SHA2_256 = 1] = "SHA2_256", HashAlgorithm[HashAlgorithm.SHA2_384 = 2] = "SHA2_384", HashAlgorithm[HashAlgorithm.SHA2_512 = 3] = "SHA2_512", HashAlgorithm[HashAlgorithm.SHA3_256 = 4] = "SHA3_256", HashAlgorithm[HashAlgorithm.SHA3_384 = 5] = "SHA3_384";
	})(HashAlgorithm || (exports.HashAlgorithm = HashAlgorithm = {}));
	function hashAlgorithmFromJSON(object) {
		switch (object) {
			case 0:
			case "HASH_ALGORITHM_UNSPECIFIED": return HashAlgorithm.HASH_ALGORITHM_UNSPECIFIED;
			case 1:
			case "SHA2_256": return HashAlgorithm.SHA2_256;
			case 2:
			case "SHA2_384": return HashAlgorithm.SHA2_384;
			case 3:
			case "SHA2_512": return HashAlgorithm.SHA2_512;
			case 4:
			case "SHA3_256": return HashAlgorithm.SHA3_256;
			case 5:
			case "SHA3_384": return HashAlgorithm.SHA3_384;
			default: throw new globalThis.Error("Unrecognized enum value " + object + " for enum HashAlgorithm");
		}
	}
	function hashAlgorithmToJSON(object) {
		switch (object) {
			case HashAlgorithm.HASH_ALGORITHM_UNSPECIFIED: return "HASH_ALGORITHM_UNSPECIFIED";
			case HashAlgorithm.SHA2_256: return "SHA2_256";
			case HashAlgorithm.SHA2_384: return "SHA2_384";
			case HashAlgorithm.SHA2_512: return "SHA2_512";
			case HashAlgorithm.SHA3_256: return "SHA3_256";
			case HashAlgorithm.SHA3_384: return "SHA3_384";
			default: throw new globalThis.Error("Unrecognized enum value " + object + " for enum HashAlgorithm");
		}
	}
	/**
	* Details of a specific public key, capturing the the key encoding method,
	* and signature algorithm.
	*
	* PublicKeyDetails captures the public key/hash algorithm combinations
	* recommended in the Sigstore ecosystem.
	*
	* This is modelled as a linear set as we want to provide a small number of
	* opinionated options instead of allowing every possible permutation.
	*
	* Any changes to this enum MUST be reflected in the algorithm registry.
	*
	* See: <https://github.com/sigstore/architecture-docs/blob/main/algorithm-registry.md>
	*
	* To avoid the possibility of contradicting formats such as PKCS1 with
	* ED25519 the valid permutations are listed as a linear set instead of a
	* cartesian set (i.e one combined variable instead of two, one for encoding
	* and one for the signature algorithm).
	*/
	var PublicKeyDetails;
	(function(PublicKeyDetails) {
		PublicKeyDetails[PublicKeyDetails.PUBLIC_KEY_DETAILS_UNSPECIFIED = 0] = "PUBLIC_KEY_DETAILS_UNSPECIFIED", PublicKeyDetails[PublicKeyDetails.PKCS1_RSA_PKCS1V5 = 1] = "PKCS1_RSA_PKCS1V5", PublicKeyDetails[PublicKeyDetails.PKCS1_RSA_PSS = 2] = "PKCS1_RSA_PSS", PublicKeyDetails[PublicKeyDetails.PKIX_RSA_PKCS1V5 = 3] = "PKIX_RSA_PKCS1V5", PublicKeyDetails[PublicKeyDetails.PKIX_RSA_PSS = 4] = "PKIX_RSA_PSS", PublicKeyDetails[PublicKeyDetails.PKIX_RSA_PKCS1V15_2048_SHA256 = 9] = "PKIX_RSA_PKCS1V15_2048_SHA256", PublicKeyDetails[PublicKeyDetails.PKIX_RSA_PKCS1V15_3072_SHA256 = 10] = "PKIX_RSA_PKCS1V15_3072_SHA256", PublicKeyDetails[PublicKeyDetails.PKIX_RSA_PKCS1V15_4096_SHA256 = 11] = "PKIX_RSA_PKCS1V15_4096_SHA256", PublicKeyDetails[PublicKeyDetails.PKIX_RSA_PSS_2048_SHA256 = 16] = "PKIX_RSA_PSS_2048_SHA256", PublicKeyDetails[PublicKeyDetails.PKIX_RSA_PSS_3072_SHA256 = 17] = "PKIX_RSA_PSS_3072_SHA256", PublicKeyDetails[PublicKeyDetails.PKIX_RSA_PSS_4096_SHA256 = 18] = "PKIX_RSA_PSS_4096_SHA256", PublicKeyDetails[PublicKeyDetails.PKIX_ECDSA_P256_HMAC_SHA_256 = 6] = "PKIX_ECDSA_P256_HMAC_SHA_256", PublicKeyDetails[PublicKeyDetails.PKIX_ECDSA_P256_SHA_256 = 5] = "PKIX_ECDSA_P256_SHA_256", PublicKeyDetails[PublicKeyDetails.PKIX_ECDSA_P384_SHA_384 = 12] = "PKIX_ECDSA_P384_SHA_384", PublicKeyDetails[PublicKeyDetails.PKIX_ECDSA_P521_SHA_512 = 13] = "PKIX_ECDSA_P521_SHA_512", PublicKeyDetails[PublicKeyDetails.PKIX_ED25519 = 7] = "PKIX_ED25519", PublicKeyDetails[PublicKeyDetails.PKIX_ED25519_PH = 8] = "PKIX_ED25519_PH", PublicKeyDetails[PublicKeyDetails.PKIX_ECDSA_P384_SHA_256 = 19] = "PKIX_ECDSA_P384_SHA_256", PublicKeyDetails[PublicKeyDetails.PKIX_ECDSA_P521_SHA_256 = 20] = "PKIX_ECDSA_P521_SHA_256", PublicKeyDetails[PublicKeyDetails.LMS_SHA256 = 14] = "LMS_SHA256", PublicKeyDetails[PublicKeyDetails.LMOTS_SHA256 = 15] = "LMOTS_SHA256", PublicKeyDetails[PublicKeyDetails.ML_DSA_44 = 23] = "ML_DSA_44", PublicKeyDetails[PublicKeyDetails.ML_DSA_65 = 21] = "ML_DSA_65", PublicKeyDetails[PublicKeyDetails.ML_DSA_87 = 22] = "ML_DSA_87";
	})(PublicKeyDetails || (exports.PublicKeyDetails = PublicKeyDetails = {}));
	function publicKeyDetailsFromJSON(object) {
		switch (object) {
			case 0:
			case "PUBLIC_KEY_DETAILS_UNSPECIFIED": return PublicKeyDetails.PUBLIC_KEY_DETAILS_UNSPECIFIED;
			case 1:
			case "PKCS1_RSA_PKCS1V5": return PublicKeyDetails.PKCS1_RSA_PKCS1V5;
			case 2:
			case "PKCS1_RSA_PSS": return PublicKeyDetails.PKCS1_RSA_PSS;
			case 3:
			case "PKIX_RSA_PKCS1V5": return PublicKeyDetails.PKIX_RSA_PKCS1V5;
			case 4:
			case "PKIX_RSA_PSS": return PublicKeyDetails.PKIX_RSA_PSS;
			case 9:
			case "PKIX_RSA_PKCS1V15_2048_SHA256": return PublicKeyDetails.PKIX_RSA_PKCS1V15_2048_SHA256;
			case 10:
			case "PKIX_RSA_PKCS1V15_3072_SHA256": return PublicKeyDetails.PKIX_RSA_PKCS1V15_3072_SHA256;
			case 11:
			case "PKIX_RSA_PKCS1V15_4096_SHA256": return PublicKeyDetails.PKIX_RSA_PKCS1V15_4096_SHA256;
			case 16:
			case "PKIX_RSA_PSS_2048_SHA256": return PublicKeyDetails.PKIX_RSA_PSS_2048_SHA256;
			case 17:
			case "PKIX_RSA_PSS_3072_SHA256": return PublicKeyDetails.PKIX_RSA_PSS_3072_SHA256;
			case 18:
			case "PKIX_RSA_PSS_4096_SHA256": return PublicKeyDetails.PKIX_RSA_PSS_4096_SHA256;
			case 6:
			case "PKIX_ECDSA_P256_HMAC_SHA_256": return PublicKeyDetails.PKIX_ECDSA_P256_HMAC_SHA_256;
			case 5:
			case "PKIX_ECDSA_P256_SHA_256": return PublicKeyDetails.PKIX_ECDSA_P256_SHA_256;
			case 12:
			case "PKIX_ECDSA_P384_SHA_384": return PublicKeyDetails.PKIX_ECDSA_P384_SHA_384;
			case 13:
			case "PKIX_ECDSA_P521_SHA_512": return PublicKeyDetails.PKIX_ECDSA_P521_SHA_512;
			case 7:
			case "PKIX_ED25519": return PublicKeyDetails.PKIX_ED25519;
			case 8:
			case "PKIX_ED25519_PH": return PublicKeyDetails.PKIX_ED25519_PH;
			case 19:
			case "PKIX_ECDSA_P384_SHA_256": return PublicKeyDetails.PKIX_ECDSA_P384_SHA_256;
			case 20:
			case "PKIX_ECDSA_P521_SHA_256": return PublicKeyDetails.PKIX_ECDSA_P521_SHA_256;
			case 14:
			case "LMS_SHA256": return PublicKeyDetails.LMS_SHA256;
			case 15:
			case "LMOTS_SHA256": return PublicKeyDetails.LMOTS_SHA256;
			case 23:
			case "ML_DSA_44": return PublicKeyDetails.ML_DSA_44;
			case 21:
			case "ML_DSA_65": return PublicKeyDetails.ML_DSA_65;
			case 22:
			case "ML_DSA_87": return PublicKeyDetails.ML_DSA_87;
			default: throw new globalThis.Error("Unrecognized enum value " + object + " for enum PublicKeyDetails");
		}
	}
	function publicKeyDetailsToJSON(object) {
		switch (object) {
			case PublicKeyDetails.PUBLIC_KEY_DETAILS_UNSPECIFIED: return "PUBLIC_KEY_DETAILS_UNSPECIFIED";
			case PublicKeyDetails.PKCS1_RSA_PKCS1V5: return "PKCS1_RSA_PKCS1V5";
			case PublicKeyDetails.PKCS1_RSA_PSS: return "PKCS1_RSA_PSS";
			case PublicKeyDetails.PKIX_RSA_PKCS1V5: return "PKIX_RSA_PKCS1V5";
			case PublicKeyDetails.PKIX_RSA_PSS: return "PKIX_RSA_PSS";
			case PublicKeyDetails.PKIX_RSA_PKCS1V15_2048_SHA256: return "PKIX_RSA_PKCS1V15_2048_SHA256";
			case PublicKeyDetails.PKIX_RSA_PKCS1V15_3072_SHA256: return "PKIX_RSA_PKCS1V15_3072_SHA256";
			case PublicKeyDetails.PKIX_RSA_PKCS1V15_4096_SHA256: return "PKIX_RSA_PKCS1V15_4096_SHA256";
			case PublicKeyDetails.PKIX_RSA_PSS_2048_SHA256: return "PKIX_RSA_PSS_2048_SHA256";
			case PublicKeyDetails.PKIX_RSA_PSS_3072_SHA256: return "PKIX_RSA_PSS_3072_SHA256";
			case PublicKeyDetails.PKIX_RSA_PSS_4096_SHA256: return "PKIX_RSA_PSS_4096_SHA256";
			case PublicKeyDetails.PKIX_ECDSA_P256_HMAC_SHA_256: return "PKIX_ECDSA_P256_HMAC_SHA_256";
			case PublicKeyDetails.PKIX_ECDSA_P256_SHA_256: return "PKIX_ECDSA_P256_SHA_256";
			case PublicKeyDetails.PKIX_ECDSA_P384_SHA_384: return "PKIX_ECDSA_P384_SHA_384";
			case PublicKeyDetails.PKIX_ECDSA_P521_SHA_512: return "PKIX_ECDSA_P521_SHA_512";
			case PublicKeyDetails.PKIX_ED25519: return "PKIX_ED25519";
			case PublicKeyDetails.PKIX_ED25519_PH: return "PKIX_ED25519_PH";
			case PublicKeyDetails.PKIX_ECDSA_P384_SHA_256: return "PKIX_ECDSA_P384_SHA_256";
			case PublicKeyDetails.PKIX_ECDSA_P521_SHA_256: return "PKIX_ECDSA_P521_SHA_256";
			case PublicKeyDetails.LMS_SHA256: return "LMS_SHA256";
			case PublicKeyDetails.LMOTS_SHA256: return "LMOTS_SHA256";
			case PublicKeyDetails.ML_DSA_44: return "ML_DSA_44";
			case PublicKeyDetails.ML_DSA_65: return "ML_DSA_65";
			case PublicKeyDetails.ML_DSA_87: return "ML_DSA_87";
			default: throw new globalThis.Error("Unrecognized enum value " + object + " for enum PublicKeyDetails");
		}
	}
	var SubjectAlternativeNameType;
	(function(SubjectAlternativeNameType) {
		/**
		* OTHER_NAME - OID 1.3.6.1.4.1.57264.1.7
		* See https://github.com/sigstore/fulcio/blob/main/docs/oid-info.md#1361415726417--othername-san
		* for more details.
		*/
		SubjectAlternativeNameType[SubjectAlternativeNameType.SUBJECT_ALTERNATIVE_NAME_TYPE_UNSPECIFIED = 0] = "SUBJECT_ALTERNATIVE_NAME_TYPE_UNSPECIFIED", SubjectAlternativeNameType[SubjectAlternativeNameType.EMAIL = 1] = "EMAIL", SubjectAlternativeNameType[SubjectAlternativeNameType.URI = 2] = "URI", SubjectAlternativeNameType[SubjectAlternativeNameType.OTHER_NAME = 3] = "OTHER_NAME";
	})(SubjectAlternativeNameType || (exports.SubjectAlternativeNameType = SubjectAlternativeNameType = {}));
	function subjectAlternativeNameTypeFromJSON(object) {
		switch (object) {
			case 0:
			case "SUBJECT_ALTERNATIVE_NAME_TYPE_UNSPECIFIED": return SubjectAlternativeNameType.SUBJECT_ALTERNATIVE_NAME_TYPE_UNSPECIFIED;
			case 1:
			case "EMAIL": return SubjectAlternativeNameType.EMAIL;
			case 2:
			case "URI": return SubjectAlternativeNameType.URI;
			case 3:
			case "OTHER_NAME": return SubjectAlternativeNameType.OTHER_NAME;
			default: throw new globalThis.Error("Unrecognized enum value " + object + " for enum SubjectAlternativeNameType");
		}
	}
	function subjectAlternativeNameTypeToJSON(object) {
		switch (object) {
			case SubjectAlternativeNameType.SUBJECT_ALTERNATIVE_NAME_TYPE_UNSPECIFIED: return "SUBJECT_ALTERNATIVE_NAME_TYPE_UNSPECIFIED";
			case SubjectAlternativeNameType.EMAIL: return "EMAIL";
			case SubjectAlternativeNameType.URI: return "URI";
			case SubjectAlternativeNameType.OTHER_NAME: return "OTHER_NAME";
			default: throw new globalThis.Error("Unrecognized enum value " + object + " for enum SubjectAlternativeNameType");
		}
	}
	exports.HashOutput = {
		fromJSON(object) {
			return {
				algorithm: isSet(object.algorithm) ? hashAlgorithmFromJSON(object.algorithm) : 0,
				digest: isSet(object.digest) ? Buffer.from(bytesFromBase64(object.digest)) : Buffer.alloc(0)
			};
		},
		toJSON(message) {
			let obj = {};
			return message.algorithm !== 0 && (obj.algorithm = hashAlgorithmToJSON(message.algorithm)), message.digest.length !== 0 && (obj.digest = base64FromBytes(message.digest)), obj;
		}
	}, exports.MessageSignature = {
		fromJSON(object) {
			return {
				messageDigest: isSet(object.messageDigest) ? exports.HashOutput.fromJSON(object.messageDigest) : void 0,
				signature: isSet(object.signature) ? Buffer.from(bytesFromBase64(object.signature)) : Buffer.alloc(0)
			};
		},
		toJSON(message) {
			let obj = {};
			return message.messageDigest !== void 0 && (obj.messageDigest = exports.HashOutput.toJSON(message.messageDigest)), message.signature.length !== 0 && (obj.signature = base64FromBytes(message.signature)), obj;
		}
	}, exports.LogId = {
		fromJSON(object) {
			return { keyId: isSet(object.keyId) ? Buffer.from(bytesFromBase64(object.keyId)) : Buffer.alloc(0) };
		},
		toJSON(message) {
			let obj = {};
			return message.keyId.length !== 0 && (obj.keyId = base64FromBytes(message.keyId)), obj;
		}
	}, exports.RFC3161SignedTimestamp = {
		fromJSON(object) {
			return { signedTimestamp: isSet(object.signedTimestamp) ? Buffer.from(bytesFromBase64(object.signedTimestamp)) : Buffer.alloc(0) };
		},
		toJSON(message) {
			let obj = {};
			return message.signedTimestamp.length !== 0 && (obj.signedTimestamp = base64FromBytes(message.signedTimestamp)), obj;
		}
	}, exports.PublicKey = {
		fromJSON(object) {
			return {
				rawBytes: isSet(object.rawBytes) ? Buffer.from(bytesFromBase64(object.rawBytes)) : void 0,
				keyDetails: isSet(object.keyDetails) ? publicKeyDetailsFromJSON(object.keyDetails) : 0,
				validFor: isSet(object.validFor) ? exports.TimeRange.fromJSON(object.validFor) : void 0
			};
		},
		toJSON(message) {
			let obj = {};
			return message.rawBytes !== void 0 && (obj.rawBytes = base64FromBytes(message.rawBytes)), message.keyDetails !== 0 && (obj.keyDetails = publicKeyDetailsToJSON(message.keyDetails)), message.validFor !== void 0 && (obj.validFor = exports.TimeRange.toJSON(message.validFor)), obj;
		}
	}, exports.PublicKeyIdentifier = {
		fromJSON(object) {
			return { hint: isSet(object.hint) ? globalThis.String(object.hint) : "" };
		},
		toJSON(message) {
			let obj = {};
			return message.hint !== "" && (obj.hint = message.hint), obj;
		}
	}, exports.ObjectIdentifier = {
		fromJSON(object) {
			return { id: globalThis.Array.isArray(object?.id) ? object.id.map((e) => globalThis.Number(e)) : [] };
		},
		toJSON(message) {
			let obj = {};
			return message.id?.length && (obj.id = message.id.map((e) => Math.round(e))), obj;
		}
	}, exports.ObjectIdentifierValuePair = {
		fromJSON(object) {
			return {
				oid: isSet(object.oid) ? exports.ObjectIdentifier.fromJSON(object.oid) : void 0,
				value: isSet(object.value) ? Buffer.from(bytesFromBase64(object.value)) : Buffer.alloc(0)
			};
		},
		toJSON(message) {
			let obj = {};
			return message.oid !== void 0 && (obj.oid = exports.ObjectIdentifier.toJSON(message.oid)), message.value.length !== 0 && (obj.value = base64FromBytes(message.value)), obj;
		}
	}, exports.DistinguishedName = {
		fromJSON(object) {
			return {
				organization: isSet(object.organization) ? globalThis.String(object.organization) : "",
				commonName: isSet(object.commonName) ? globalThis.String(object.commonName) : ""
			};
		},
		toJSON(message) {
			let obj = {};
			return message.organization !== "" && (obj.organization = message.organization), message.commonName !== "" && (obj.commonName = message.commonName), obj;
		}
	}, exports.X509Certificate = {
		fromJSON(object) {
			return { rawBytes: isSet(object.rawBytes) ? Buffer.from(bytesFromBase64(object.rawBytes)) : Buffer.alloc(0) };
		},
		toJSON(message) {
			let obj = {};
			return message.rawBytes.length !== 0 && (obj.rawBytes = base64FromBytes(message.rawBytes)), obj;
		}
	}, exports.SubjectAlternativeName = {
		fromJSON(object) {
			return {
				type: isSet(object.type) ? subjectAlternativeNameTypeFromJSON(object.type) : 0,
				identity: isSet(object.regexp) ? {
					$case: "regexp",
					regexp: globalThis.String(object.regexp)
				} : isSet(object.value) ? {
					$case: "value",
					value: globalThis.String(object.value)
				} : void 0
			};
		},
		toJSON(message) {
			let obj = {};
			return message.type !== 0 && (obj.type = subjectAlternativeNameTypeToJSON(message.type)), message.identity?.$case === "regexp" ? obj.regexp = message.identity.regexp : message.identity?.$case === "value" && (obj.value = message.identity.value), obj;
		}
	}, exports.X509CertificateChain = {
		fromJSON(object) {
			return { certificates: globalThis.Array.isArray(object?.certificates) ? object.certificates.map((e) => exports.X509Certificate.fromJSON(e)) : [] };
		},
		toJSON(message) {
			let obj = {};
			return message.certificates?.length && (obj.certificates = message.certificates.map((e) => exports.X509Certificate.toJSON(e))), obj;
		}
	}, exports.TimeRange = {
		fromJSON(object) {
			return {
				start: isSet(object.start) ? fromJsonTimestamp(object.start) : void 0,
				end: isSet(object.end) ? fromJsonTimestamp(object.end) : void 0
			};
		},
		toJSON(message) {
			let obj = {};
			return message.start !== void 0 && (obj.start = message.start.toISOString()), message.end !== void 0 && (obj.end = message.end.toISOString()), obj;
		}
	};
	function bytesFromBase64(b64) {
		return Uint8Array.from(globalThis.Buffer.from(b64, "base64"));
	}
	function base64FromBytes(arr) {
		return globalThis.Buffer.from(arr).toString("base64");
	}
	function fromTimestamp(t) {
		let millis = (globalThis.Number(t.seconds) || 0) * 1e3;
		return millis += (t.nanos || 0) / 1e6, new globalThis.Date(millis);
	}
	function fromJsonTimestamp(o) {
		return o instanceof globalThis.Date ? o : typeof o == "string" ? new globalThis.Date(o) : fromTimestamp(timestamp_1.Timestamp.fromJSON(o));
	}
	function isSet(value) {
		return value != null;
	}
})), require_sigstore_rekor = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.TransparencyLogEntry = exports.InclusionPromise = exports.InclusionProof = exports.Checkpoint = exports.KindVersion = void 0;
	let sigstore_common_1 = require_sigstore_common();
	exports.KindVersion = {
		fromJSON(object) {
			return {
				kind: isSet(object.kind) ? globalThis.String(object.kind) : "",
				version: isSet(object.version) ? globalThis.String(object.version) : ""
			};
		},
		toJSON(message) {
			let obj = {};
			return message.kind !== "" && (obj.kind = message.kind), message.version !== "" && (obj.version = message.version), obj;
		}
	}, exports.Checkpoint = {
		fromJSON(object) {
			return { envelope: isSet(object.envelope) ? globalThis.String(object.envelope) : "" };
		},
		toJSON(message) {
			let obj = {};
			return message.envelope !== "" && (obj.envelope = message.envelope), obj;
		}
	}, exports.InclusionProof = {
		fromJSON(object) {
			return {
				logIndex: isSet(object.logIndex) ? globalThis.String(object.logIndex) : "0",
				rootHash: isSet(object.rootHash) ? Buffer.from(bytesFromBase64(object.rootHash)) : Buffer.alloc(0),
				treeSize: isSet(object.treeSize) ? globalThis.String(object.treeSize) : "0",
				hashes: globalThis.Array.isArray(object?.hashes) ? object.hashes.map((e) => Buffer.from(bytesFromBase64(e))) : [],
				checkpoint: isSet(object.checkpoint) ? exports.Checkpoint.fromJSON(object.checkpoint) : void 0
			};
		},
		toJSON(message) {
			let obj = {};
			return message.logIndex !== "0" && (obj.logIndex = message.logIndex), message.rootHash.length !== 0 && (obj.rootHash = base64FromBytes(message.rootHash)), message.treeSize !== "0" && (obj.treeSize = message.treeSize), message.hashes?.length && (obj.hashes = message.hashes.map((e) => base64FromBytes(e))), message.checkpoint !== void 0 && (obj.checkpoint = exports.Checkpoint.toJSON(message.checkpoint)), obj;
		}
	}, exports.InclusionPromise = {
		fromJSON(object) {
			return { signedEntryTimestamp: isSet(object.signedEntryTimestamp) ? Buffer.from(bytesFromBase64(object.signedEntryTimestamp)) : Buffer.alloc(0) };
		},
		toJSON(message) {
			let obj = {};
			return message.signedEntryTimestamp.length !== 0 && (obj.signedEntryTimestamp = base64FromBytes(message.signedEntryTimestamp)), obj;
		}
	}, exports.TransparencyLogEntry = {
		fromJSON(object) {
			return {
				logIndex: isSet(object.logIndex) ? globalThis.String(object.logIndex) : "0",
				logId: isSet(object.logId) ? sigstore_common_1.LogId.fromJSON(object.logId) : void 0,
				kindVersion: isSet(object.kindVersion) ? exports.KindVersion.fromJSON(object.kindVersion) : void 0,
				integratedTime: isSet(object.integratedTime) ? globalThis.String(object.integratedTime) : "0",
				inclusionPromise: isSet(object.inclusionPromise) ? exports.InclusionPromise.fromJSON(object.inclusionPromise) : void 0,
				inclusionProof: isSet(object.inclusionProof) ? exports.InclusionProof.fromJSON(object.inclusionProof) : void 0,
				canonicalizedBody: isSet(object.canonicalizedBody) ? Buffer.from(bytesFromBase64(object.canonicalizedBody)) : Buffer.alloc(0)
			};
		},
		toJSON(message) {
			let obj = {};
			return message.logIndex !== "0" && (obj.logIndex = message.logIndex), message.logId !== void 0 && (obj.logId = sigstore_common_1.LogId.toJSON(message.logId)), message.kindVersion !== void 0 && (obj.kindVersion = exports.KindVersion.toJSON(message.kindVersion)), message.integratedTime !== "0" && (obj.integratedTime = message.integratedTime), message.inclusionPromise !== void 0 && (obj.inclusionPromise = exports.InclusionPromise.toJSON(message.inclusionPromise)), message.inclusionProof !== void 0 && (obj.inclusionProof = exports.InclusionProof.toJSON(message.inclusionProof)), message.canonicalizedBody.length !== 0 && (obj.canonicalizedBody = base64FromBytes(message.canonicalizedBody)), obj;
		}
	};
	function bytesFromBase64(b64) {
		return Uint8Array.from(globalThis.Buffer.from(b64, "base64"));
	}
	function base64FromBytes(arr) {
		return globalThis.Buffer.from(arr).toString("base64");
	}
	function isSet(value) {
		return value != null;
	}
})), require_sigstore_bundle = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.Bundle = exports.VerificationMaterial = exports.TimestampVerificationData = void 0;
	let envelope_1 = require_envelope(), sigstore_common_1 = require_sigstore_common(), sigstore_rekor_1 = require_sigstore_rekor();
	exports.TimestampVerificationData = {
		fromJSON(object) {
			return { rfc3161Timestamps: globalThis.Array.isArray(object?.rfc3161Timestamps) ? object.rfc3161Timestamps.map((e) => sigstore_common_1.RFC3161SignedTimestamp.fromJSON(e)) : [] };
		},
		toJSON(message) {
			let obj = {};
			return message.rfc3161Timestamps?.length && (obj.rfc3161Timestamps = message.rfc3161Timestamps.map((e) => sigstore_common_1.RFC3161SignedTimestamp.toJSON(e))), obj;
		}
	}, exports.VerificationMaterial = {
		fromJSON(object) {
			return {
				content: isSet(object.publicKey) ? {
					$case: "publicKey",
					publicKey: sigstore_common_1.PublicKeyIdentifier.fromJSON(object.publicKey)
				} : isSet(object.x509CertificateChain) ? {
					$case: "x509CertificateChain",
					x509CertificateChain: sigstore_common_1.X509CertificateChain.fromJSON(object.x509CertificateChain)
				} : isSet(object.certificate) ? {
					$case: "certificate",
					certificate: sigstore_common_1.X509Certificate.fromJSON(object.certificate)
				} : void 0,
				tlogEntries: globalThis.Array.isArray(object?.tlogEntries) ? object.tlogEntries.map((e) => sigstore_rekor_1.TransparencyLogEntry.fromJSON(e)) : [],
				timestampVerificationData: isSet(object.timestampVerificationData) ? exports.TimestampVerificationData.fromJSON(object.timestampVerificationData) : void 0
			};
		},
		toJSON(message) {
			let obj = {};
			return message.content?.$case === "publicKey" ? obj.publicKey = sigstore_common_1.PublicKeyIdentifier.toJSON(message.content.publicKey) : message.content?.$case === "x509CertificateChain" ? obj.x509CertificateChain = sigstore_common_1.X509CertificateChain.toJSON(message.content.x509CertificateChain) : message.content?.$case === "certificate" && (obj.certificate = sigstore_common_1.X509Certificate.toJSON(message.content.certificate)), message.tlogEntries?.length && (obj.tlogEntries = message.tlogEntries.map((e) => sigstore_rekor_1.TransparencyLogEntry.toJSON(e))), message.timestampVerificationData !== void 0 && (obj.timestampVerificationData = exports.TimestampVerificationData.toJSON(message.timestampVerificationData)), obj;
		}
	}, exports.Bundle = {
		fromJSON(object) {
			return {
				mediaType: isSet(object.mediaType) ? globalThis.String(object.mediaType) : "",
				verificationMaterial: isSet(object.verificationMaterial) ? exports.VerificationMaterial.fromJSON(object.verificationMaterial) : void 0,
				content: isSet(object.messageSignature) ? {
					$case: "messageSignature",
					messageSignature: sigstore_common_1.MessageSignature.fromJSON(object.messageSignature)
				} : isSet(object.dsseEnvelope) ? {
					$case: "dsseEnvelope",
					dsseEnvelope: envelope_1.Envelope.fromJSON(object.dsseEnvelope)
				} : void 0
			};
		},
		toJSON(message) {
			let obj = {};
			return message.mediaType !== "" && (obj.mediaType = message.mediaType), message.verificationMaterial !== void 0 && (obj.verificationMaterial = exports.VerificationMaterial.toJSON(message.verificationMaterial)), message.content?.$case === "messageSignature" ? obj.messageSignature = sigstore_common_1.MessageSignature.toJSON(message.content.messageSignature) : message.content?.$case === "dsseEnvelope" && (obj.dsseEnvelope = envelope_1.Envelope.toJSON(message.content.dsseEnvelope)), obj;
		}
	};
	function isSet(value) {
		return value != null;
	}
})), require_sigstore_trustroot = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.ClientTrustConfig = exports.ServiceConfiguration = exports.Service = exports.SigningConfig = exports.TrustedRoot = exports.CertificateAuthority = exports.TransparencyLogInstance = exports.ServiceSelector = void 0, exports.serviceSelectorFromJSON = serviceSelectorFromJSON, exports.serviceSelectorToJSON = serviceSelectorToJSON;
	let sigstore_common_1 = require_sigstore_common();
	/**
	* ServiceSelector specifies how a client SHOULD select a set of
	* Services to connect to. A client SHOULD throw an error if
	* the value is SERVICE_SELECTOR_UNDEFINED.
	*/
	var ServiceSelector;
	(function(ServiceSelector) {
		/**
		* EXACT - Clients SHOULD select a specific number of Services based on
		* supported API version and validity window, using the provided
		* `count`. It is up to the client implementation to decide how to
		* select the Service, e.g. random or round-robin.
		*/
		ServiceSelector[ServiceSelector.SERVICE_SELECTOR_UNDEFINED = 0] = "SERVICE_SELECTOR_UNDEFINED", ServiceSelector[ServiceSelector.ALL = 1] = "ALL", ServiceSelector[ServiceSelector.ANY = 2] = "ANY", ServiceSelector[ServiceSelector.EXACT = 3] = "EXACT";
	})(ServiceSelector || (exports.ServiceSelector = ServiceSelector = {}));
	function serviceSelectorFromJSON(object) {
		switch (object) {
			case 0:
			case "SERVICE_SELECTOR_UNDEFINED": return ServiceSelector.SERVICE_SELECTOR_UNDEFINED;
			case 1:
			case "ALL": return ServiceSelector.ALL;
			case 2:
			case "ANY": return ServiceSelector.ANY;
			case 3:
			case "EXACT": return ServiceSelector.EXACT;
			default: throw new globalThis.Error("Unrecognized enum value " + object + " for enum ServiceSelector");
		}
	}
	function serviceSelectorToJSON(object) {
		switch (object) {
			case ServiceSelector.SERVICE_SELECTOR_UNDEFINED: return "SERVICE_SELECTOR_UNDEFINED";
			case ServiceSelector.ALL: return "ALL";
			case ServiceSelector.ANY: return "ANY";
			case ServiceSelector.EXACT: return "EXACT";
			default: throw new globalThis.Error("Unrecognized enum value " + object + " for enum ServiceSelector");
		}
	}
	exports.TransparencyLogInstance = {
		fromJSON(object) {
			return {
				baseUrl: isSet(object.baseUrl) ? globalThis.String(object.baseUrl) : "",
				hashAlgorithm: isSet(object.hashAlgorithm) ? (0, sigstore_common_1.hashAlgorithmFromJSON)(object.hashAlgorithm) : 0,
				publicKey: isSet(object.publicKey) ? sigstore_common_1.PublicKey.fromJSON(object.publicKey) : void 0,
				logId: isSet(object.logId) ? sigstore_common_1.LogId.fromJSON(object.logId) : void 0,
				checkpointKeyId: isSet(object.checkpointKeyId) ? sigstore_common_1.LogId.fromJSON(object.checkpointKeyId) : void 0,
				operator: isSet(object.operator) ? globalThis.String(object.operator) : ""
			};
		},
		toJSON(message) {
			let obj = {};
			return message.baseUrl !== "" && (obj.baseUrl = message.baseUrl), message.hashAlgorithm !== 0 && (obj.hashAlgorithm = (0, sigstore_common_1.hashAlgorithmToJSON)(message.hashAlgorithm)), message.publicKey !== void 0 && (obj.publicKey = sigstore_common_1.PublicKey.toJSON(message.publicKey)), message.logId !== void 0 && (obj.logId = sigstore_common_1.LogId.toJSON(message.logId)), message.checkpointKeyId !== void 0 && (obj.checkpointKeyId = sigstore_common_1.LogId.toJSON(message.checkpointKeyId)), message.operator !== "" && (obj.operator = message.operator), obj;
		}
	}, exports.CertificateAuthority = {
		fromJSON(object) {
			return {
				subject: isSet(object.subject) ? sigstore_common_1.DistinguishedName.fromJSON(object.subject) : void 0,
				uri: isSet(object.uri) ? globalThis.String(object.uri) : "",
				certChain: isSet(object.certChain) ? sigstore_common_1.X509CertificateChain.fromJSON(object.certChain) : void 0,
				validFor: isSet(object.validFor) ? sigstore_common_1.TimeRange.fromJSON(object.validFor) : void 0,
				operator: isSet(object.operator) ? globalThis.String(object.operator) : ""
			};
		},
		toJSON(message) {
			let obj = {};
			return message.subject !== void 0 && (obj.subject = sigstore_common_1.DistinguishedName.toJSON(message.subject)), message.uri !== "" && (obj.uri = message.uri), message.certChain !== void 0 && (obj.certChain = sigstore_common_1.X509CertificateChain.toJSON(message.certChain)), message.validFor !== void 0 && (obj.validFor = sigstore_common_1.TimeRange.toJSON(message.validFor)), message.operator !== "" && (obj.operator = message.operator), obj;
		}
	}, exports.TrustedRoot = {
		fromJSON(object) {
			return {
				mediaType: isSet(object.mediaType) ? globalThis.String(object.mediaType) : "",
				tlogs: globalThis.Array.isArray(object?.tlogs) ? object.tlogs.map((e) => exports.TransparencyLogInstance.fromJSON(e)) : [],
				certificateAuthorities: globalThis.Array.isArray(object?.certificateAuthorities) ? object.certificateAuthorities.map((e) => exports.CertificateAuthority.fromJSON(e)) : [],
				ctlogs: globalThis.Array.isArray(object?.ctlogs) ? object.ctlogs.map((e) => exports.TransparencyLogInstance.fromJSON(e)) : [],
				timestampAuthorities: globalThis.Array.isArray(object?.timestampAuthorities) ? object.timestampAuthorities.map((e) => exports.CertificateAuthority.fromJSON(e)) : []
			};
		},
		toJSON(message) {
			let obj = {};
			return message.mediaType !== "" && (obj.mediaType = message.mediaType), message.tlogs?.length && (obj.tlogs = message.tlogs.map((e) => exports.TransparencyLogInstance.toJSON(e))), message.certificateAuthorities?.length && (obj.certificateAuthorities = message.certificateAuthorities.map((e) => exports.CertificateAuthority.toJSON(e))), message.ctlogs?.length && (obj.ctlogs = message.ctlogs.map((e) => exports.TransparencyLogInstance.toJSON(e))), message.timestampAuthorities?.length && (obj.timestampAuthorities = message.timestampAuthorities.map((e) => exports.CertificateAuthority.toJSON(e))), obj;
		}
	}, exports.SigningConfig = {
		fromJSON(object) {
			return {
				mediaType: isSet(object.mediaType) ? globalThis.String(object.mediaType) : "",
				caUrls: globalThis.Array.isArray(object?.caUrls) ? object.caUrls.map((e) => exports.Service.fromJSON(e)) : [],
				oidcUrls: globalThis.Array.isArray(object?.oidcUrls) ? object.oidcUrls.map((e) => exports.Service.fromJSON(e)) : [],
				rekorTlogUrls: globalThis.Array.isArray(object?.rekorTlogUrls) ? object.rekorTlogUrls.map((e) => exports.Service.fromJSON(e)) : [],
				rekorTlogConfig: isSet(object.rekorTlogConfig) ? exports.ServiceConfiguration.fromJSON(object.rekorTlogConfig) : void 0,
				tsaUrls: globalThis.Array.isArray(object?.tsaUrls) ? object.tsaUrls.map((e) => exports.Service.fromJSON(e)) : [],
				tsaConfig: isSet(object.tsaConfig) ? exports.ServiceConfiguration.fromJSON(object.tsaConfig) : void 0
			};
		},
		toJSON(message) {
			let obj = {};
			return message.mediaType !== "" && (obj.mediaType = message.mediaType), message.caUrls?.length && (obj.caUrls = message.caUrls.map((e) => exports.Service.toJSON(e))), message.oidcUrls?.length && (obj.oidcUrls = message.oidcUrls.map((e) => exports.Service.toJSON(e))), message.rekorTlogUrls?.length && (obj.rekorTlogUrls = message.rekorTlogUrls.map((e) => exports.Service.toJSON(e))), message.rekorTlogConfig !== void 0 && (obj.rekorTlogConfig = exports.ServiceConfiguration.toJSON(message.rekorTlogConfig)), message.tsaUrls?.length && (obj.tsaUrls = message.tsaUrls.map((e) => exports.Service.toJSON(e))), message.tsaConfig !== void 0 && (obj.tsaConfig = exports.ServiceConfiguration.toJSON(message.tsaConfig)), obj;
		}
	}, exports.Service = {
		fromJSON(object) {
			return {
				url: isSet(object.url) ? globalThis.String(object.url) : "",
				majorApiVersion: isSet(object.majorApiVersion) ? globalThis.Number(object.majorApiVersion) : 0,
				validFor: isSet(object.validFor) ? sigstore_common_1.TimeRange.fromJSON(object.validFor) : void 0,
				operator: isSet(object.operator) ? globalThis.String(object.operator) : ""
			};
		},
		toJSON(message) {
			let obj = {};
			return message.url !== "" && (obj.url = message.url), message.majorApiVersion !== 0 && (obj.majorApiVersion = Math.round(message.majorApiVersion)), message.validFor !== void 0 && (obj.validFor = sigstore_common_1.TimeRange.toJSON(message.validFor)), message.operator !== "" && (obj.operator = message.operator), obj;
		}
	}, exports.ServiceConfiguration = {
		fromJSON(object) {
			return {
				selector: isSet(object.selector) ? serviceSelectorFromJSON(object.selector) : 0,
				count: isSet(object.count) ? globalThis.Number(object.count) : 0
			};
		},
		toJSON(message) {
			let obj = {};
			return message.selector !== 0 && (obj.selector = serviceSelectorToJSON(message.selector)), message.count !== 0 && (obj.count = Math.round(message.count)), obj;
		}
	}, exports.ClientTrustConfig = {
		fromJSON(object) {
			return {
				mediaType: isSet(object.mediaType) ? globalThis.String(object.mediaType) : "",
				trustedRoot: isSet(object.trustedRoot) ? exports.TrustedRoot.fromJSON(object.trustedRoot) : void 0,
				signingConfig: isSet(object.signingConfig) ? exports.SigningConfig.fromJSON(object.signingConfig) : void 0
			};
		},
		toJSON(message) {
			let obj = {};
			return message.mediaType !== "" && (obj.mediaType = message.mediaType), message.trustedRoot !== void 0 && (obj.trustedRoot = exports.TrustedRoot.toJSON(message.trustedRoot)), message.signingConfig !== void 0 && (obj.signingConfig = exports.SigningConfig.toJSON(message.signingConfig)), obj;
		}
	};
	function isSet(value) {
		return value != null;
	}
})), require_sigstore_verification = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.Input = exports.Artifact = exports.ArtifactVerificationOptions_ObserverTimestampOptions = exports.ArtifactVerificationOptions_TlogIntegratedTimestampOptions = exports.ArtifactVerificationOptions_TimestampAuthorityOptions = exports.ArtifactVerificationOptions_CtlogOptions = exports.ArtifactVerificationOptions_TlogOptions = exports.ArtifactVerificationOptions = exports.PublicKeyIdentities = exports.CertificateIdentities = exports.CertificateIdentity = void 0;
	let sigstore_bundle_1 = require_sigstore_bundle(), sigstore_common_1 = require_sigstore_common(), sigstore_trustroot_1 = require_sigstore_trustroot();
	exports.CertificateIdentity = {
		fromJSON(object) {
			return {
				issuer: isSet(object.issuer) ? globalThis.String(object.issuer) : "",
				san: isSet(object.san) ? sigstore_common_1.SubjectAlternativeName.fromJSON(object.san) : void 0,
				oids: globalThis.Array.isArray(object?.oids) ? object.oids.map((e) => sigstore_common_1.ObjectIdentifierValuePair.fromJSON(e)) : []
			};
		},
		toJSON(message) {
			let obj = {};
			return message.issuer !== "" && (obj.issuer = message.issuer), message.san !== void 0 && (obj.san = sigstore_common_1.SubjectAlternativeName.toJSON(message.san)), message.oids?.length && (obj.oids = message.oids.map((e) => sigstore_common_1.ObjectIdentifierValuePair.toJSON(e))), obj;
		}
	}, exports.CertificateIdentities = {
		fromJSON(object) {
			return { identities: globalThis.Array.isArray(object?.identities) ? object.identities.map((e) => exports.CertificateIdentity.fromJSON(e)) : [] };
		},
		toJSON(message) {
			let obj = {};
			return message.identities?.length && (obj.identities = message.identities.map((e) => exports.CertificateIdentity.toJSON(e))), obj;
		}
	}, exports.PublicKeyIdentities = {
		fromJSON(object) {
			return { publicKeys: globalThis.Array.isArray(object?.publicKeys) ? object.publicKeys.map((e) => sigstore_common_1.PublicKey.fromJSON(e)) : [] };
		},
		toJSON(message) {
			let obj = {};
			return message.publicKeys?.length && (obj.publicKeys = message.publicKeys.map((e) => sigstore_common_1.PublicKey.toJSON(e))), obj;
		}
	}, exports.ArtifactVerificationOptions = {
		fromJSON(object) {
			return {
				signers: isSet(object.certificateIdentities) ? {
					$case: "certificateIdentities",
					certificateIdentities: exports.CertificateIdentities.fromJSON(object.certificateIdentities)
				} : isSet(object.publicKeys) ? {
					$case: "publicKeys",
					publicKeys: exports.PublicKeyIdentities.fromJSON(object.publicKeys)
				} : void 0,
				tlogOptions: isSet(object.tlogOptions) ? exports.ArtifactVerificationOptions_TlogOptions.fromJSON(object.tlogOptions) : void 0,
				ctlogOptions: isSet(object.ctlogOptions) ? exports.ArtifactVerificationOptions_CtlogOptions.fromJSON(object.ctlogOptions) : void 0,
				tsaOptions: isSet(object.tsaOptions) ? exports.ArtifactVerificationOptions_TimestampAuthorityOptions.fromJSON(object.tsaOptions) : void 0,
				integratedTsOptions: isSet(object.integratedTsOptions) ? exports.ArtifactVerificationOptions_TlogIntegratedTimestampOptions.fromJSON(object.integratedTsOptions) : void 0,
				observerOptions: isSet(object.observerOptions) ? exports.ArtifactVerificationOptions_ObserverTimestampOptions.fromJSON(object.observerOptions) : void 0
			};
		},
		toJSON(message) {
			let obj = {};
			return message.signers?.$case === "certificateIdentities" ? obj.certificateIdentities = exports.CertificateIdentities.toJSON(message.signers.certificateIdentities) : message.signers?.$case === "publicKeys" && (obj.publicKeys = exports.PublicKeyIdentities.toJSON(message.signers.publicKeys)), message.tlogOptions !== void 0 && (obj.tlogOptions = exports.ArtifactVerificationOptions_TlogOptions.toJSON(message.tlogOptions)), message.ctlogOptions !== void 0 && (obj.ctlogOptions = exports.ArtifactVerificationOptions_CtlogOptions.toJSON(message.ctlogOptions)), message.tsaOptions !== void 0 && (obj.tsaOptions = exports.ArtifactVerificationOptions_TimestampAuthorityOptions.toJSON(message.tsaOptions)), message.integratedTsOptions !== void 0 && (obj.integratedTsOptions = exports.ArtifactVerificationOptions_TlogIntegratedTimestampOptions.toJSON(message.integratedTsOptions)), message.observerOptions !== void 0 && (obj.observerOptions = exports.ArtifactVerificationOptions_ObserverTimestampOptions.toJSON(message.observerOptions)), obj;
		}
	}, exports.ArtifactVerificationOptions_TlogOptions = {
		fromJSON(object) {
			return {
				threshold: isSet(object.threshold) ? globalThis.Number(object.threshold) : 0,
				performOnlineVerification: isSet(object.performOnlineVerification) ? globalThis.Boolean(object.performOnlineVerification) : !1,
				disable: isSet(object.disable) ? globalThis.Boolean(object.disable) : !1
			};
		},
		toJSON(message) {
			let obj = {};
			return message.threshold !== 0 && (obj.threshold = Math.round(message.threshold)), message.performOnlineVerification !== !1 && (obj.performOnlineVerification = message.performOnlineVerification), message.disable !== !1 && (obj.disable = message.disable), obj;
		}
	}, exports.ArtifactVerificationOptions_CtlogOptions = {
		fromJSON(object) {
			return {
				threshold: isSet(object.threshold) ? globalThis.Number(object.threshold) : 0,
				disable: isSet(object.disable) ? globalThis.Boolean(object.disable) : !1
			};
		},
		toJSON(message) {
			let obj = {};
			return message.threshold !== 0 && (obj.threshold = Math.round(message.threshold)), message.disable !== !1 && (obj.disable = message.disable), obj;
		}
	}, exports.ArtifactVerificationOptions_TimestampAuthorityOptions = {
		fromJSON(object) {
			return {
				threshold: isSet(object.threshold) ? globalThis.Number(object.threshold) : 0,
				disable: isSet(object.disable) ? globalThis.Boolean(object.disable) : !1
			};
		},
		toJSON(message) {
			let obj = {};
			return message.threshold !== 0 && (obj.threshold = Math.round(message.threshold)), message.disable !== !1 && (obj.disable = message.disable), obj;
		}
	}, exports.ArtifactVerificationOptions_TlogIntegratedTimestampOptions = {
		fromJSON(object) {
			return {
				threshold: isSet(object.threshold) ? globalThis.Number(object.threshold) : 0,
				disable: isSet(object.disable) ? globalThis.Boolean(object.disable) : !1
			};
		},
		toJSON(message) {
			let obj = {};
			return message.threshold !== 0 && (obj.threshold = Math.round(message.threshold)), message.disable !== !1 && (obj.disable = message.disable), obj;
		}
	}, exports.ArtifactVerificationOptions_ObserverTimestampOptions = {
		fromJSON(object) {
			return {
				threshold: isSet(object.threshold) ? globalThis.Number(object.threshold) : 0,
				disable: isSet(object.disable) ? globalThis.Boolean(object.disable) : !1
			};
		},
		toJSON(message) {
			let obj = {};
			return message.threshold !== 0 && (obj.threshold = Math.round(message.threshold)), message.disable !== !1 && (obj.disable = message.disable), obj;
		}
	}, exports.Artifact = {
		fromJSON(object) {
			return { data: isSet(object.artifactUri) ? {
				$case: "artifactUri",
				artifactUri: globalThis.String(object.artifactUri)
			} : isSet(object.artifact) ? {
				$case: "artifact",
				artifact: Buffer.from(bytesFromBase64(object.artifact))
			} : isSet(object.artifactDigest) ? {
				$case: "artifactDigest",
				artifactDigest: sigstore_common_1.HashOutput.fromJSON(object.artifactDigest)
			} : void 0 };
		},
		toJSON(message) {
			let obj = {};
			return message.data?.$case === "artifactUri" ? obj.artifactUri = message.data.artifactUri : message.data?.$case === "artifact" ? obj.artifact = base64FromBytes(message.data.artifact) : message.data?.$case === "artifactDigest" && (obj.artifactDigest = sigstore_common_1.HashOutput.toJSON(message.data.artifactDigest)), obj;
		}
	}, exports.Input = {
		fromJSON(object) {
			return {
				artifactTrustRoot: isSet(object.artifactTrustRoot) ? sigstore_trustroot_1.TrustedRoot.fromJSON(object.artifactTrustRoot) : void 0,
				artifactVerificationOptions: isSet(object.artifactVerificationOptions) ? exports.ArtifactVerificationOptions.fromJSON(object.artifactVerificationOptions) : void 0,
				bundle: isSet(object.bundle) ? sigstore_bundle_1.Bundle.fromJSON(object.bundle) : void 0,
				artifact: isSet(object.artifact) ? exports.Artifact.fromJSON(object.artifact) : void 0
			};
		},
		toJSON(message) {
			let obj = {};
			return message.artifactTrustRoot !== void 0 && (obj.artifactTrustRoot = sigstore_trustroot_1.TrustedRoot.toJSON(message.artifactTrustRoot)), message.artifactVerificationOptions !== void 0 && (obj.artifactVerificationOptions = exports.ArtifactVerificationOptions.toJSON(message.artifactVerificationOptions)), message.bundle !== void 0 && (obj.bundle = sigstore_bundle_1.Bundle.toJSON(message.bundle)), message.artifact !== void 0 && (obj.artifact = exports.Artifact.toJSON(message.artifact)), obj;
		}
	};
	function bytesFromBase64(b64) {
		return Uint8Array.from(globalThis.Buffer.from(b64, "base64"));
	}
	function base64FromBytes(arr) {
		return globalThis.Buffer.from(arr).toString("base64");
	}
	function isSet(value) {
		return value != null;
	}
})), require_dist$6 = /* @__PURE__ */ __commonJSMin(((exports) => {
	var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
		k2 === void 0 && (k2 = k);
		var desc = Object.getOwnPropertyDescriptor(m, k);
		(!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) && (desc = {
			enumerable: !0,
			get: function() {
				return m[k];
			}
		}), Object.defineProperty(o, k2, desc);
	}) : (function(o, m, k, k2) {
		k2 === void 0 && (k2 = k), o[k2] = m[k];
	})), __exportStar = exports && exports.__exportStar || function(m, exports$2) {
		for (var p in m) p !== "default" && !Object.prototype.hasOwnProperty.call(exports$2, p) && __createBinding(exports$2, m, p);
	};
	Object.defineProperty(exports, "__esModule", { value: !0 }), __exportStar(require_envelope(), exports), __exportStar(require_sigstore_bundle(), exports), __exportStar(require_sigstore_common(), exports), __exportStar(require_sigstore_rekor(), exports), __exportStar(require_sigstore_trustroot(), exports), __exportStar(require_sigstore_verification(), exports);
})), require_bundle$1 = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.BUNDLE_V03_MEDIA_TYPE = exports.BUNDLE_V03_LEGACY_MEDIA_TYPE = exports.BUNDLE_V02_MEDIA_TYPE = exports.BUNDLE_V01_MEDIA_TYPE = void 0, exports.isBundleWithCertificateChain = isBundleWithCertificateChain, exports.isBundleWithPublicKey = isBundleWithPublicKey, exports.isBundleWithMessageSignature = isBundleWithMessageSignature, exports.isBundleWithDsseEnvelope = isBundleWithDsseEnvelope, exports.BUNDLE_V01_MEDIA_TYPE = "application/vnd.dev.sigstore.bundle+json;version=0.1", exports.BUNDLE_V02_MEDIA_TYPE = "application/vnd.dev.sigstore.bundle+json;version=0.2", exports.BUNDLE_V03_LEGACY_MEDIA_TYPE = "application/vnd.dev.sigstore.bundle+json;version=0.3", exports.BUNDLE_V03_MEDIA_TYPE = "application/vnd.dev.sigstore.bundle.v0.3+json";
	function isBundleWithCertificateChain(b) {
		return b.verificationMaterial.content.$case === "x509CertificateChain";
	}
	function isBundleWithPublicKey(b) {
		return b.verificationMaterial.content.$case === "publicKey";
	}
	function isBundleWithMessageSignature(b) {
		return b.content.$case === "messageSignature";
	}
	function isBundleWithDsseEnvelope(b) {
		return b.content.$case === "dsseEnvelope";
	}
})), require_build = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.toMessageSignatureBundle = toMessageSignatureBundle, exports.toDSSEBundle = toDSSEBundle;
	let protobuf_specs_1 = require_dist$6(), bundle_1 = require_bundle$1();
	function toMessageSignatureBundle(options) {
		return {
			mediaType: options.certificateChain ? bundle_1.BUNDLE_V02_MEDIA_TYPE : bundle_1.BUNDLE_V03_MEDIA_TYPE,
			content: {
				$case: "messageSignature",
				messageSignature: {
					messageDigest: {
						algorithm: protobuf_specs_1.HashAlgorithm.SHA2_256,
						digest: options.digest
					},
					signature: options.signature
				}
			},
			verificationMaterial: toVerificationMaterial(options)
		};
	}
	function toDSSEBundle(options) {
		return {
			mediaType: options.certificateChain ? bundle_1.BUNDLE_V02_MEDIA_TYPE : bundle_1.BUNDLE_V03_MEDIA_TYPE,
			content: {
				$case: "dsseEnvelope",
				dsseEnvelope: toEnvelope(options)
			},
			verificationMaterial: toVerificationMaterial(options)
		};
	}
	function toEnvelope(options) {
		return {
			payloadType: options.artifactType,
			payload: options.artifact,
			signatures: [toSignature(options)]
		};
	}
	function toSignature(options) {
		return {
			keyid: options.keyHint || "",
			sig: options.signature
		};
	}
	function toVerificationMaterial(options) {
		return {
			content: toKeyContent(options),
			tlogEntries: [],
			timestampVerificationData: { rfc3161Timestamps: [] }
		};
	}
	function toKeyContent(options) {
		return options.certificate ? options.certificateChain ? {
			$case: "x509CertificateChain",
			x509CertificateChain: { certificates: [{ rawBytes: options.certificate }] }
		} : {
			$case: "certificate",
			certificate: { rawBytes: options.certificate }
		} : {
			$case: "publicKey",
			publicKey: { hint: options.keyHint || "" }
		};
	}
})), require_error$6 = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.ValidationError = void 0, exports.ValidationError = class extends Error {
		fields;
		constructor(message, fields) {
			super(message), this.fields = fields;
		}
	};
})), require_validate = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.assertBundle = assertBundle, exports.assertBundleV01 = assertBundleV01, exports.isBundleV01 = isBundleV01, exports.assertBundleV02 = assertBundleV02, exports.assertBundleLatest = assertBundleLatest;
	let error_1 = require_error$6();
	function assertBundle(b) {
		let invalidValues = validateBundleBase(b);
		if (invalidValues.length > 0) throw new error_1.ValidationError("invalid bundle", invalidValues);
	}
	function assertBundleV01(b) {
		let invalidValues = [];
		if (invalidValues.push(...validateBundleBase(b)), invalidValues.push(...validateInclusionPromise(b)), invalidValues.length > 0) throw new error_1.ValidationError("invalid v0.1 bundle", invalidValues);
	}
	function isBundleV01(b) {
		try {
			return assertBundleV01(b), !0;
		} catch {
			return !1;
		}
	}
	function assertBundleV02(b) {
		let invalidValues = [];
		if (invalidValues.push(...validateBundleBase(b)), invalidValues.push(...validateInclusionProof(b)), invalidValues.length > 0) throw new error_1.ValidationError("invalid v0.2 bundle", invalidValues);
	}
	function assertBundleLatest(b) {
		let invalidValues = [];
		if (invalidValues.push(...validateBundleBase(b)), invalidValues.push(...validateInclusionProof(b)), invalidValues.push(...validateNoCertificateChain(b)), invalidValues.length > 0) throw new error_1.ValidationError("invalid bundle", invalidValues);
	}
	function validateBundleBase(b) {
		let invalidValues = [];
		if ((b.mediaType === void 0 || !b.mediaType.match(/^application\/vnd\.dev\.sigstore\.bundle\+json;version=\d\.\d/) && !b.mediaType.match(/^application\/vnd\.dev\.sigstore\.bundle\.v\d\.\d\+json/)) && invalidValues.push("mediaType"), b.content === void 0) invalidValues.push("content");
		else switch (b.content.$case) {
			case "messageSignature":
				b.content.messageSignature.messageDigest === void 0 ? invalidValues.push("content.messageSignature.messageDigest") : b.content.messageSignature.messageDigest.digest.length === 0 && invalidValues.push("content.messageSignature.messageDigest.digest"), b.content.messageSignature.signature.length === 0 && invalidValues.push("content.messageSignature.signature");
				break;
			case "dsseEnvelope":
				b.content.dsseEnvelope.payload.length === 0 && invalidValues.push("content.dsseEnvelope.payload"), b.content.dsseEnvelope.signatures.length === 1 ? b.content.dsseEnvelope.signatures[0].sig.length === 0 && invalidValues.push("content.dsseEnvelope.signatures[0].sig") : invalidValues.push("content.dsseEnvelope.signatures");
				break;
		}
		if (b.verificationMaterial === void 0) invalidValues.push("verificationMaterial");
		else {
			if (b.verificationMaterial.content === void 0) invalidValues.push("verificationMaterial.content");
			else switch (b.verificationMaterial.content.$case) {
				case "x509CertificateChain":
					b.verificationMaterial.content.x509CertificateChain.certificates.length === 0 && invalidValues.push("verificationMaterial.content.x509CertificateChain.certificates"), b.verificationMaterial.content.x509CertificateChain.certificates.forEach((cert, i) => {
						cert.rawBytes.length === 0 && invalidValues.push(`verificationMaterial.content.x509CertificateChain.certificates[${i}].rawBytes`);
					});
					break;
				case "certificate":
					b.verificationMaterial.content.certificate.rawBytes.length === 0 && invalidValues.push("verificationMaterial.content.certificate.rawBytes");
					break;
			}
			b.verificationMaterial.tlogEntries === void 0 ? invalidValues.push("verificationMaterial.tlogEntries") : b.verificationMaterial.tlogEntries.length > 0 && b.verificationMaterial.tlogEntries.forEach((entry, i) => {
				entry.logId === void 0 && invalidValues.push(`verificationMaterial.tlogEntries[${i}].logId`), entry.kindVersion === void 0 && invalidValues.push(`verificationMaterial.tlogEntries[${i}].kindVersion`);
			});
		}
		return invalidValues;
	}
	function validateInclusionPromise(b) {
		let invalidValues = [];
		return b.verificationMaterial && b.verificationMaterial.tlogEntries?.length > 0 && b.verificationMaterial.tlogEntries.forEach((entry, i) => {
			entry.inclusionPromise === void 0 && invalidValues.push(`verificationMaterial.tlogEntries[${i}].inclusionPromise`);
		}), invalidValues;
	}
	function validateInclusionProof(b) {
		let invalidValues = [];
		return b.verificationMaterial && b.verificationMaterial.tlogEntries?.length > 0 && b.verificationMaterial.tlogEntries.forEach((entry, i) => {
			entry.inclusionProof === void 0 ? invalidValues.push(`verificationMaterial.tlogEntries[${i}].inclusionProof`) : entry.inclusionProof.checkpoint === void 0 && invalidValues.push(`verificationMaterial.tlogEntries[${i}].inclusionProof.checkpoint`);
		}), invalidValues;
	}
	function validateNoCertificateChain(b) {
		let invalidValues = [];
		return b.verificationMaterial?.content?.$case === "x509CertificateChain" && invalidValues.push("verificationMaterial.content.$case"), invalidValues;
	}
})), require_serialized = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.envelopeToJSON = exports.envelopeFromJSON = exports.bundleToJSON = exports.bundleFromJSON = void 0;
	let protobuf_specs_1 = require_dist$6(), bundle_1 = require_bundle$1(), validate_1 = require_validate();
	exports.bundleFromJSON = (obj) => {
		let bundle = protobuf_specs_1.Bundle.fromJSON(obj);
		switch (bundle.mediaType) {
			case bundle_1.BUNDLE_V01_MEDIA_TYPE:
				(0, validate_1.assertBundleV01)(bundle);
				break;
			case bundle_1.BUNDLE_V02_MEDIA_TYPE:
				(0, validate_1.assertBundleV02)(bundle);
				break;
			default:
				(0, validate_1.assertBundleLatest)(bundle);
				break;
		}
		return bundle;
	}, exports.bundleToJSON = (bundle) => protobuf_specs_1.Bundle.toJSON(bundle), exports.envelopeFromJSON = (obj) => protobuf_specs_1.Envelope.fromJSON(obj), exports.envelopeToJSON = (envelope) => protobuf_specs_1.Envelope.toJSON(envelope);
})), require_dist$5 = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.isBundleV01 = exports.assertBundleV02 = exports.assertBundleV01 = exports.assertBundleLatest = exports.assertBundle = exports.envelopeToJSON = exports.envelopeFromJSON = exports.bundleToJSON = exports.bundleFromJSON = exports.ValidationError = exports.isBundleWithPublicKey = exports.isBundleWithMessageSignature = exports.isBundleWithDsseEnvelope = exports.isBundleWithCertificateChain = exports.BUNDLE_V03_MEDIA_TYPE = exports.BUNDLE_V03_LEGACY_MEDIA_TYPE = exports.BUNDLE_V02_MEDIA_TYPE = exports.BUNDLE_V01_MEDIA_TYPE = exports.toMessageSignatureBundle = exports.toDSSEBundle = void 0;
	var build_1 = require_build();
	Object.defineProperty(exports, "toDSSEBundle", {
		enumerable: !0,
		get: function() {
			return build_1.toDSSEBundle;
		}
	}), Object.defineProperty(exports, "toMessageSignatureBundle", {
		enumerable: !0,
		get: function() {
			return build_1.toMessageSignatureBundle;
		}
	});
	var bundle_1 = require_bundle$1();
	Object.defineProperty(exports, "BUNDLE_V01_MEDIA_TYPE", {
		enumerable: !0,
		get: function() {
			return bundle_1.BUNDLE_V01_MEDIA_TYPE;
		}
	}), Object.defineProperty(exports, "BUNDLE_V02_MEDIA_TYPE", {
		enumerable: !0,
		get: function() {
			return bundle_1.BUNDLE_V02_MEDIA_TYPE;
		}
	}), Object.defineProperty(exports, "BUNDLE_V03_LEGACY_MEDIA_TYPE", {
		enumerable: !0,
		get: function() {
			return bundle_1.BUNDLE_V03_LEGACY_MEDIA_TYPE;
		}
	}), Object.defineProperty(exports, "BUNDLE_V03_MEDIA_TYPE", {
		enumerable: !0,
		get: function() {
			return bundle_1.BUNDLE_V03_MEDIA_TYPE;
		}
	}), Object.defineProperty(exports, "isBundleWithCertificateChain", {
		enumerable: !0,
		get: function() {
			return bundle_1.isBundleWithCertificateChain;
		}
	}), Object.defineProperty(exports, "isBundleWithDsseEnvelope", {
		enumerable: !0,
		get: function() {
			return bundle_1.isBundleWithDsseEnvelope;
		}
	}), Object.defineProperty(exports, "isBundleWithMessageSignature", {
		enumerable: !0,
		get: function() {
			return bundle_1.isBundleWithMessageSignature;
		}
	}), Object.defineProperty(exports, "isBundleWithPublicKey", {
		enumerable: !0,
		get: function() {
			return bundle_1.isBundleWithPublicKey;
		}
	});
	var error_1 = require_error$6();
	Object.defineProperty(exports, "ValidationError", {
		enumerable: !0,
		get: function() {
			return error_1.ValidationError;
		}
	});
	var serialized_1 = require_serialized();
	Object.defineProperty(exports, "bundleFromJSON", {
		enumerable: !0,
		get: function() {
			return serialized_1.bundleFromJSON;
		}
	}), Object.defineProperty(exports, "bundleToJSON", {
		enumerable: !0,
		get: function() {
			return serialized_1.bundleToJSON;
		}
	}), Object.defineProperty(exports, "envelopeFromJSON", {
		enumerable: !0,
		get: function() {
			return serialized_1.envelopeFromJSON;
		}
	}), Object.defineProperty(exports, "envelopeToJSON", {
		enumerable: !0,
		get: function() {
			return serialized_1.envelopeToJSON;
		}
	});
	var validate_1 = require_validate();
	Object.defineProperty(exports, "assertBundle", {
		enumerable: !0,
		get: function() {
			return validate_1.assertBundle;
		}
	}), Object.defineProperty(exports, "assertBundleLatest", {
		enumerable: !0,
		get: function() {
			return validate_1.assertBundleLatest;
		}
	}), Object.defineProperty(exports, "assertBundleV01", {
		enumerable: !0,
		get: function() {
			return validate_1.assertBundleV01;
		}
	}), Object.defineProperty(exports, "assertBundleV02", {
		enumerable: !0,
		get: function() {
			return validate_1.assertBundleV02;
		}
	}), Object.defineProperty(exports, "isBundleV01", {
		enumerable: !0,
		get: function() {
			return validate_1.isBundleV01;
		}
	});
})), require_appdata = /* @__PURE__ */ __commonJSMin(((exports) => {
	var __importDefault = exports && exports.__importDefault || function(mod) {
		return mod && mod.__esModule ? mod : { default: mod };
	};
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.appDataPath = appDataPath;
	let os_1$1 = __importDefault(require("os")), path_1$2 = __importDefault(require("path"));
	function appDataPath(name) {
		let homedir = os_1$1.default.homedir();
		switch (process.platform) {
			/* istanbul ignore next */
			case "darwin": {
				let appSupport = path_1$2.default.join(homedir, "Library", "Application Support");
				return path_1$2.default.join(appSupport, name);
			}
			/* istanbul ignore next */
			case "win32": {
				let localAppData = process.env.LOCALAPPDATA || path_1$2.default.join(homedir, "AppData", "Local");
				return path_1$2.default.join(localAppData, name, "Data");
			}
			/* istanbul ignore next */
			default: {
				let localData = process.env.XDG_DATA_HOME || path_1$2.default.join(homedir, ".local", "share");
				return path_1$2.default.join(localData, name);
			}
		}
	}
})), require_error$5 = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.UnsupportedAlgorithmError = exports.CryptoError = exports.LengthOrHashMismatchError = exports.UnsignedMetadataError = exports.RepositoryError = exports.ValueError = void 0, exports.ValueError = class extends Error {};
	var RepositoryError = class extends Error {};
	exports.RepositoryError = RepositoryError, exports.UnsignedMetadataError = class extends RepositoryError {}, exports.LengthOrHashMismatchError = class extends RepositoryError {};
	var CryptoError = class extends Error {};
	exports.CryptoError = CryptoError, exports.UnsupportedAlgorithmError = class extends CryptoError {};
})), require_guard = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.isDefined = isDefined, exports.isObject = isObject, exports.isStringArray = isStringArray, exports.isObjectArray = isObjectArray, exports.isStringRecord = isStringRecord, exports.isObjectRecord = isObjectRecord;
	function isDefined(val) {
		return val !== void 0;
	}
	function isObject(value) {
		return typeof value == "object" && !!value;
	}
	function isStringArray(value) {
		return Array.isArray(value) && value.every((v) => typeof v == "string");
	}
	function isObjectArray(value) {
		return Array.isArray(value) && value.every(isObject);
	}
	function isStringRecord(value) {
		return typeof value == "object" && !!value && Object.keys(value).every((k) => typeof k == "string") && Object.values(value).every((v) => typeof v == "string");
	}
	function isObjectRecord(value) {
		return typeof value == "object" && !!value && Object.keys(value).every((k) => typeof k == "string") && Object.values(value).every((v) => typeof v == "object" && !!v);
	}
})), require_lib$1 = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	function canonicalize(object) {
		let buffer = [];
		if (typeof object == "string") buffer.push(canonicalizeString(object));
		else if (typeof object == "boolean") buffer.push(JSON.stringify(object));
		else if (Number.isInteger(object)) buffer.push(JSON.stringify(object));
		else if (object === null) buffer.push(JSON.stringify(object));
		else if (Array.isArray(object)) {
			buffer.push("[");
			let first = !0;
			object.forEach((element) => {
				first || buffer.push(","), first = !1, buffer.push(canonicalize(element));
			}), buffer.push("]");
		} else if (typeof object == "object") {
			buffer.push("{");
			let first = !0;
			Object.keys(object).sort().forEach((property) => {
				first || buffer.push(","), first = !1, buffer.push(canonicalizeString(property)), buffer.push(":"), buffer.push(canonicalize(object[property]));
			}), buffer.push("}");
		} else throw TypeError("cannot encode " + object.toString());
		return buffer.join("");
	}
	function canonicalizeString(string) {
		return "\"" + string.replace(/\\/g, "\\\\").replace(/"/g, "\\\"") + "\"";
	}
	module.exports = { canonicalize };
})), require_verify = /* @__PURE__ */ __commonJSMin(((exports) => {
	var __importDefault = exports && exports.__importDefault || function(mod) {
		return mod && mod.__esModule ? mod : { default: mod };
	};
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.verifySignature = void 0;
	let canonical_json_1 = require_lib$1(), crypto_1$4 = __importDefault(require("crypto"));
	exports.verifySignature = (metaDataSignedData, key, signature) => {
		let canonicalData = Buffer.from((0, canonical_json_1.canonicalize)(metaDataSignedData));
		return crypto_1$4.default.verify(void 0, canonicalData, key, Buffer.from(signature, "hex"));
	};
})), require_utils = /* @__PURE__ */ __commonJSMin(((exports) => {
	var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
		k2 === void 0 && (k2 = k);
		var desc = Object.getOwnPropertyDescriptor(m, k);
		(!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) && (desc = {
			enumerable: !0,
			get: function() {
				return m[k];
			}
		}), Object.defineProperty(o, k2, desc);
	}) : (function(o, m, k, k2) {
		k2 === void 0 && (k2 = k), o[k2] = m[k];
	})), __setModuleDefault = exports && exports.__setModuleDefault || (Object.create ? (function(o, v) {
		Object.defineProperty(o, "default", {
			enumerable: !0,
			value: v
		});
	}) : function(o, v) {
		o.default = v;
	}), __importStar = exports && exports.__importStar || (function() {
		var ownKeys = function(o) {
			return ownKeys = Object.getOwnPropertyNames || function(o) {
				var ar = [];
				for (var k in o) Object.prototype.hasOwnProperty.call(o, k) && (ar[ar.length] = k);
				return ar;
			}, ownKeys(o);
		};
		return function(mod) {
			if (mod && mod.__esModule) return mod;
			var result = {};
			if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) k[i] !== "default" && __createBinding(result, mod, k[i]);
			return __setModuleDefault(result, mod), result;
		};
	})();
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.crypto = exports.guard = void 0, exports.guard = __importStar(require_guard()), exports.crypto = __importStar(require_verify());
})), require_base = /* @__PURE__ */ __commonJSMin(((exports) => {
	var __importDefault = exports && exports.__importDefault || function(mod) {
		return mod && mod.__esModule ? mod : { default: mod };
	};
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.Signed = exports.MetadataKind = void 0, exports.isMetadataKind = isMetadataKind;
	let util_1$10 = __importDefault(require("util")), error_1 = require_error$5(), utils_1 = require_utils(), SPECIFICATION_VERSION = [
		"1",
		"0",
		"31"
	];
	var MetadataKind;
	(function(MetadataKind) {
		MetadataKind.Root = "root", MetadataKind.Timestamp = "timestamp", MetadataKind.Snapshot = "snapshot", MetadataKind.Targets = "targets";
	})(MetadataKind || (exports.MetadataKind = MetadataKind = {}));
	function isMetadataKind(value) {
		return typeof value == "string" && Object.values(MetadataKind).includes(value);
	}
	exports.Signed = class Signed {
		specVersion;
		expires;
		version;
		unrecognizedFields;
		constructor(options) {
			this.specVersion = options.specVersion || SPECIFICATION_VERSION.join(".");
			let specList = this.specVersion.split(".");
			if (!(specList.length === 2 || specList.length === 3) || !specList.every((item) => isNumeric(item))) throw new error_1.ValueError("Failed to parse specVersion");
			if (specList[0] != SPECIFICATION_VERSION[0]) throw new error_1.ValueError("Unsupported specVersion");
			this.expires = options.expires, this.version = options.version, this.unrecognizedFields = options.unrecognizedFields || {};
		}
		equals(other) {
			return other instanceof Signed && this.specVersion === other.specVersion && this.expires === other.expires && this.version === other.version && util_1$10.default.isDeepStrictEqual(this.unrecognizedFields, other.unrecognizedFields);
		}
		isExpired(referenceTime) {
			return referenceTime ||= /* @__PURE__ */ new Date(), referenceTime >= new Date(this.expires);
		}
		static commonFieldsFromJSON(data) {
			let { spec_version, expires, version, ...rest } = data;
			if (!utils_1.guard.isDefined(spec_version)) throw new error_1.ValueError("spec_version is not defined");
			if (typeof spec_version != "string") throw TypeError("spec_version must be a string");
			if (!utils_1.guard.isDefined(expires)) throw new error_1.ValueError("expires is not defined");
			if (typeof expires != "string") throw TypeError("expires must be a string");
			if (!utils_1.guard.isDefined(version)) throw new error_1.ValueError("version is not defined");
			if (typeof version != "number") throw TypeError("version must be a number");
			return {
				specVersion: spec_version,
				expires,
				version,
				unrecognizedFields: rest
			};
		}
	};
	function isNumeric(str) {
		return !isNaN(Number(str));
	}
})), require_file = /* @__PURE__ */ __commonJSMin(((exports) => {
	var __importDefault = exports && exports.__importDefault || function(mod) {
		return mod && mod.__esModule ? mod : { default: mod };
	};
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.TargetFile = exports.MetaFile = void 0;
	let crypto_1$3 = __importDefault(require("crypto")), util_1$9 = __importDefault(require("util")), error_1 = require_error$5(), utils_1 = require_utils();
	exports.MetaFile = class MetaFile {
		version;
		length;
		hashes;
		unrecognizedFields;
		constructor(opts) {
			if (opts.version <= 0) throw new error_1.ValueError("Metafile version must be at least 1");
			opts.length !== void 0 && validateLength(opts.length), this.version = opts.version, this.length = opts.length, this.hashes = opts.hashes, this.unrecognizedFields = opts.unrecognizedFields || {};
		}
		equals(other) {
			return other instanceof MetaFile && this.version === other.version && this.length === other.length && util_1$9.default.isDeepStrictEqual(this.hashes, other.hashes) && util_1$9.default.isDeepStrictEqual(this.unrecognizedFields, other.unrecognizedFields);
		}
		verify(data) {
			if (this.length !== void 0 && data.length !== this.length) throw new error_1.LengthOrHashMismatchError(`Expected length ${this.length} but got ${data.length}`);
			this.hashes && Object.entries(this.hashes).forEach(([key, value]) => {
				let hash;
				try {
					hash = crypto_1$3.default.createHash(key);
				} catch {
					throw new error_1.LengthOrHashMismatchError(`Hash algorithm ${key} not supported`);
				}
				let observedHash = hash.update(data).digest("hex");
				if (observedHash !== value) throw new error_1.LengthOrHashMismatchError(`Expected hash ${value} but got ${observedHash}`);
			});
		}
		toJSON() {
			let json = {
				version: this.version,
				...this.unrecognizedFields
			};
			return this.length !== void 0 && (json.length = this.length), this.hashes && (json.hashes = this.hashes), json;
		}
		static fromJSON(data) {
			let { version, length, hashes, ...rest } = data;
			if (typeof version != "number") throw TypeError("version must be a number");
			if (utils_1.guard.isDefined(length) && typeof length != "number") throw TypeError("length must be a number");
			if (utils_1.guard.isDefined(hashes) && !utils_1.guard.isStringRecord(hashes)) throw TypeError("hashes must be string keys and values");
			return new MetaFile({
				version,
				length,
				hashes,
				unrecognizedFields: rest
			});
		}
	}, exports.TargetFile = class TargetFile {
		length;
		path;
		hashes;
		unrecognizedFields;
		constructor(opts) {
			validateLength(opts.length), this.length = opts.length, this.path = opts.path, this.hashes = opts.hashes, this.unrecognizedFields = opts.unrecognizedFields || {};
		}
		get custom() {
			let custom = this.unrecognizedFields.custom;
			return !custom || Array.isArray(custom) || typeof custom != "object" ? {} : custom;
		}
		equals(other) {
			return other instanceof TargetFile && this.length === other.length && this.path === other.path && util_1$9.default.isDeepStrictEqual(this.hashes, other.hashes) && util_1$9.default.isDeepStrictEqual(this.unrecognizedFields, other.unrecognizedFields);
		}
		async verify(stream) {
			let observedLength = 0, digests = Object.keys(this.hashes).reduce((acc, key) => {
				try {
					acc[key] = crypto_1$3.default.createHash(key);
				} catch {
					throw new error_1.LengthOrHashMismatchError(`Hash algorithm ${key} not supported`);
				}
				return acc;
			}, {});
			for await (let chunk of stream) observedLength += chunk.length, Object.values(digests).forEach((digest) => {
				digest.update(chunk);
			});
			if (observedLength !== this.length) throw new error_1.LengthOrHashMismatchError(`Expected length ${this.length} but got ${observedLength}`);
			Object.entries(digests).forEach(([key, value]) => {
				let expected = this.hashes[key], actual = value.digest("hex");
				if (actual !== expected) throw new error_1.LengthOrHashMismatchError(`Expected hash ${expected} but got ${actual}`);
			});
		}
		toJSON() {
			return {
				length: this.length,
				hashes: this.hashes,
				...this.unrecognizedFields
			};
		}
		static fromJSON(path, data) {
			let { length, hashes, ...rest } = data;
			if (typeof length != "number") throw TypeError("length must be a number");
			if (!utils_1.guard.isStringRecord(hashes)) throw TypeError("hashes must have string keys and values");
			return new TargetFile({
				length,
				path,
				hashes,
				unrecognizedFields: rest
			});
		}
	};
	function validateLength(length) {
		if (length < 0) throw new error_1.ValueError("Length must be at least 0");
	}
})), require_oid$1 = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.encodeOIDString = encodeOIDString;
	function encodeOIDString(oid) {
		let parts = oid.split("."), first = parseInt(parts[0], 10) * 40 + parseInt(parts[1], 10), rest = [];
		parts.slice(2).forEach((part) => {
			let bytes = encodeVariableLengthInteger(parseInt(part, 10));
			rest.push(...bytes);
		});
		let der = Buffer.from([first, ...rest]);
		return Buffer.from([
			6,
			der.length,
			...der
		]);
	}
	function encodeVariableLengthInteger(value) {
		let bytes = [], mask = 0;
		for (; value > 0;) bytes.unshift(value & 127 | mask), value >>= 7, mask = 128;
		return bytes;
	}
})), require_key$2 = /* @__PURE__ */ __commonJSMin(((exports) => {
	var __importDefault = exports && exports.__importDefault || function(mod) {
		return mod && mod.__esModule ? mod : { default: mod };
	};
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.getPublicKey = getPublicKey;
	let crypto_1$2 = __importDefault(require("crypto")), error_1 = require_error$5(), oid_1 = require_oid$1(), PEM_HEADER = "-----BEGIN PUBLIC KEY-----";
	function getPublicKey(keyInfo) {
		switch (keyInfo.keyType) {
			case "rsa": return getRSAPublicKey(keyInfo);
			case "ed25519": return getED25519PublicKey(keyInfo);
			case "ecdsa":
			case "ecdsa-sha2-nistp256":
			case "ecdsa-sha2-nistp384": return getECDCSAPublicKey(keyInfo);
			default: throw new error_1.UnsupportedAlgorithmError(`Unsupported key type: ${keyInfo.keyType}`);
		}
	}
	function getRSAPublicKey(keyInfo) {
		if (!keyInfo.keyVal.startsWith(PEM_HEADER)) throw new error_1.CryptoError("Invalid key format");
		let key = crypto_1$2.default.createPublicKey(keyInfo.keyVal);
		switch (keyInfo.scheme) {
			case "rsassa-pss-sha256": return {
				key,
				padding: crypto_1$2.default.constants.RSA_PKCS1_PSS_PADDING
			};
			default: throw new error_1.UnsupportedAlgorithmError(`Unsupported RSA scheme: ${keyInfo.scheme}`);
		}
	}
	function getED25519PublicKey(keyInfo) {
		let key;
		if (keyInfo.keyVal.startsWith(PEM_HEADER)) key = crypto_1$2.default.createPublicKey(keyInfo.keyVal);
		else {
			if (!isHex(keyInfo.keyVal)) throw new error_1.CryptoError("Invalid key format");
			key = crypto_1$2.default.createPublicKey({
				key: ed25519.hexToDER(keyInfo.keyVal),
				format: "der",
				type: "spki"
			});
		}
		return { key };
	}
	function getECDCSAPublicKey(keyInfo) {
		let key;
		if (keyInfo.keyVal.startsWith(PEM_HEADER)) key = crypto_1$2.default.createPublicKey(keyInfo.keyVal);
		else {
			if (!isHex(keyInfo.keyVal)) throw new error_1.CryptoError("Invalid key format");
			key = crypto_1$2.default.createPublicKey({
				key: ecdsa.hexToDER(keyInfo.keyVal),
				format: "der",
				type: "spki"
			});
		}
		return { key };
	}
	let ed25519 = { hexToDER: (hex) => {
		let key = Buffer.from(hex, "hex"), oid = (0, oid_1.encodeOIDString)("1.3.101.112"), elements = Buffer.concat([Buffer.concat([
			Buffer.from([48]),
			Buffer.from([oid.length]),
			oid
		]), Buffer.concat([
			Buffer.from([3]),
			Buffer.from([key.length + 1]),
			Buffer.from([0]),
			key
		])]);
		return Buffer.concat([
			Buffer.from([48]),
			Buffer.from([elements.length]),
			elements
		]);
	} }, ecdsa = { hexToDER: (hex) => {
		let key = Buffer.from(hex, "hex"), bitString = Buffer.concat([
			Buffer.from([3]),
			Buffer.from([key.length + 1]),
			Buffer.from([0]),
			key
		]), oids = Buffer.concat([(0, oid_1.encodeOIDString)("1.2.840.10045.2.1"), (0, oid_1.encodeOIDString)("1.2.840.10045.3.1.7")]), oidSequence = Buffer.concat([
			Buffer.from([48]),
			Buffer.from([oids.length]),
			oids
		]);
		return Buffer.concat([
			Buffer.from([48]),
			Buffer.from([oidSequence.length + bitString.length]),
			oidSequence,
			bitString
		]);
	} }, isHex = (key) => /^[0-9a-fA-F]+$/.test(key);
})), require_key$1 = /* @__PURE__ */ __commonJSMin(((exports) => {
	var __importDefault = exports && exports.__importDefault || function(mod) {
		return mod && mod.__esModule ? mod : { default: mod };
	};
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.Key = void 0;
	let util_1$8 = __importDefault(require("util")), error_1 = require_error$5(), utils_1 = require_utils(), key_1 = require_key$2();
	exports.Key = class Key {
		keyID;
		keyType;
		scheme;
		keyVal;
		unrecognizedFields;
		constructor(options) {
			let { keyID, keyType, scheme, keyVal, unrecognizedFields } = options;
			this.keyID = keyID, this.keyType = keyType, this.scheme = scheme, this.keyVal = keyVal, this.unrecognizedFields = unrecognizedFields || {};
		}
		verifySignature(metadata) {
			let signature = metadata.signatures[this.keyID];
			if (!signature) throw new error_1.UnsignedMetadataError("no signature for key found in metadata");
			if (!this.keyVal.public) throw new error_1.UnsignedMetadataError("no public key found");
			let publicKey = (0, key_1.getPublicKey)({
				keyType: this.keyType,
				scheme: this.scheme,
				keyVal: this.keyVal.public
			}), signedData = metadata.signed.toJSON();
			try {
				if (!utils_1.crypto.verifySignature(signedData, publicKey, signature.sig)) throw new error_1.UnsignedMetadataError(`failed to verify ${this.keyID} signature`);
			} catch (error) {
				throw error instanceof error_1.UnsignedMetadataError ? error : new error_1.UnsignedMetadataError(`failed to verify ${this.keyID} signature`);
			}
		}
		equals(other) {
			return other instanceof Key && this.keyID === other.keyID && this.keyType === other.keyType && this.scheme === other.scheme && util_1$8.default.isDeepStrictEqual(this.keyVal, other.keyVal) && util_1$8.default.isDeepStrictEqual(this.unrecognizedFields, other.unrecognizedFields);
		}
		toJSON() {
			return {
				keytype: this.keyType,
				scheme: this.scheme,
				keyval: this.keyVal,
				...this.unrecognizedFields
			};
		}
		static fromJSON(keyID, data) {
			let { keytype, scheme, keyval, ...rest } = data;
			if (typeof keytype != "string") throw TypeError("keytype must be a string");
			if (typeof scheme != "string") throw TypeError("scheme must be a string");
			if (!utils_1.guard.isStringRecord(keyval)) throw TypeError("keyval must be a string record");
			return new Key({
				keyID,
				keyType: keytype,
				scheme,
				keyVal: keyval,
				unrecognizedFields: rest
			});
		}
	};
})), require_commonjs$2 = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.range = exports.balanced = void 0, exports.balanced = (a, b, str) => {
		let ma = a instanceof RegExp ? maybeMatch(a, str) : a, mb = b instanceof RegExp ? maybeMatch(b, str) : b, r = ma !== null && mb != null && (0, exports.range)(ma, mb, str);
		return r && {
			start: r[0],
			end: r[1],
			pre: str.slice(0, r[0]),
			body: str.slice(r[0] + ma.length, r[1]),
			post: str.slice(r[1] + mb.length)
		};
	};
	let maybeMatch = (reg, str) => {
		let m = str.match(reg);
		return m ? m[0] : null;
	};
	exports.range = (a, b, str) => {
		let begs, beg, left, right, result, ai = str.indexOf(a), bi = str.indexOf(b, ai + 1), i = ai;
		if (ai >= 0 && bi > 0) {
			if (a === b) return [ai, bi];
			for (begs = [], left = str.length; i >= 0 && !result;) {
				if (i === ai) begs.push(i), ai = str.indexOf(a, i + 1);
				else if (begs.length === 1) {
					let r = begs.pop();
					r !== void 0 && (result = [r, bi]);
				} else beg = begs.pop(), beg !== void 0 && beg < left && (left = beg, right = bi), bi = str.indexOf(b, i + 1);
				i = ai < bi && ai >= 0 ? ai : bi;
			}
			begs.length && right !== void 0 && (result = [left, right]);
		}
		return result;
	};
})), require_commonjs$1 = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.EXPANSION_MAX = void 0, exports.expand = expand;
	let balanced_match_1 = require_commonjs$2(), escSlash = "\0SLASH" + Math.random() + "\0", escOpen = "\0OPEN" + Math.random() + "\0", escClose = "\0CLOSE" + Math.random() + "\0", escComma = "\0COMMA" + Math.random() + "\0", escPeriod = "\0PERIOD" + Math.random() + "\0", escSlashPattern = new RegExp(escSlash, "g"), escOpenPattern = new RegExp(escOpen, "g"), escClosePattern = new RegExp(escClose, "g"), escCommaPattern = new RegExp(escComma, "g"), escPeriodPattern = new RegExp(escPeriod, "g"), slashPattern = /\\\\/g, openPattern = /\\{/g, closePattern = /\\}/g, commaPattern = /\\,/g, periodPattern = /\\\./g;
	exports.EXPANSION_MAX = 1e5;
	function numeric(str) {
		return isNaN(str) ? str.charCodeAt(0) : parseInt(str, 10);
	}
	function escapeBraces(str) {
		return str.replace(slashPattern, escSlash).replace(openPattern, escOpen).replace(closePattern, escClose).replace(commaPattern, escComma).replace(periodPattern, escPeriod);
	}
	function unescapeBraces(str) {
		return str.replace(escSlashPattern, "\\").replace(escOpenPattern, "{").replace(escClosePattern, "}").replace(escCommaPattern, ",").replace(escPeriodPattern, ".");
	}
	/**
	* Basically just str.split(","), but handling cases
	* where we have nested braced sections, which should be
	* treated as individual members, like {a,{b,c},d}
	*/
	function parseCommaParts(str) {
		if (!str) return [""];
		let parts = [], m = (0, balanced_match_1.balanced)("{", "}", str);
		if (!m) return str.split(",");
		let { pre, body, post } = m, p = pre.split(",");
		p[p.length - 1] += "{" + body + "}";
		let postParts = parseCommaParts(post);
		return post.length && (p[p.length - 1] += postParts.shift(), p.push.apply(p, postParts)), parts.push.apply(parts, p), parts;
	}
	function expand(str, options = {}) {
		if (!str) return [];
		let { max = exports.EXPANSION_MAX } = options;
		return str.slice(0, 2) === "{}" && (str = "\\{\\}" + str.slice(2)), expand_(escapeBraces(str), max, !0).map(unescapeBraces);
	}
	function embrace(str) {
		return "{" + str + "}";
	}
	function isPadded(el) {
		return /^-?0\d/.test(el);
	}
	function lte(i, y) {
		return i <= y;
	}
	function gte(i, y) {
		return i >= y;
	}
	function expand_(str, max, isTop) {
		/** @type {string[]} */
		let expansions = [], m = (0, balanced_match_1.balanced)("{", "}", str);
		if (!m) return [str];
		let pre = m.pre, post = m.post.length ? expand_(m.post, max, !1) : [""];
		if (/\$$/.test(m.pre)) for (let k = 0; k < post.length && k < max; k++) {
			let expansion = pre + "{" + m.body + "}" + post[k];
			expansions.push(expansion);
		}
		else {
			let isNumericSequence = /^-?\d+\.\.-?\d+(?:\.\.-?\d+)?$/.test(m.body), isAlphaSequence = /^[a-zA-Z]\.\.[a-zA-Z](?:\.\.-?\d+)?$/.test(m.body), isSequence = isNumericSequence || isAlphaSequence, isOptions = m.body.indexOf(",") >= 0;
			if (!isSequence && !isOptions) return m.post.match(/,(?!,).*\}/) ? (str = m.pre + "{" + m.body + escClose + m.post, expand_(str, max, !0)) : [str];
			let n;
			if (isSequence) n = m.body.split(/\.\./);
			else if (n = parseCommaParts(m.body), n.length === 1 && n[0] !== void 0 && (n = expand_(n[0], max, !1).map(embrace), n.length === 1)) return post.map((p) => m.pre + n[0] + p);
			let N;
			if (isSequence && n[0] !== void 0 && n[1] !== void 0) {
				let x = numeric(n[0]), y = numeric(n[1]), width = Math.max(n[0].length, n[1].length), incr = n.length === 3 && n[2] !== void 0 ? Math.max(Math.abs(numeric(n[2])), 1) : 1, test = lte;
				y < x && (incr *= -1, test = gte);
				let pad = n.some(isPadded);
				N = [];
				for (let i = x; test(i, y) && N.length < max; i += incr) {
					let c;
					if (isAlphaSequence) c = String.fromCharCode(i), c === "\\" && (c = "");
					else if (c = String(i), pad) {
						let need = width - c.length;
						if (need > 0) {
							let z = Array(need + 1).join("0");
							c = i < 0 ? "-" + z + c.slice(1) : z + c;
						}
					}
					N.push(c);
				}
			} else {
				N = [];
				for (let j = 0; j < n.length; j++) N.push.apply(N, expand_(n[j], max, !1));
			}
			for (let j = 0; j < N.length; j++) for (let k = 0; k < post.length && expansions.length < max; k++) {
				let expansion = pre + N[j] + post[k];
				(!isTop || isSequence || expansion) && expansions.push(expansion);
			}
		}
		return expansions;
	}
})), require_assert_valid_pattern = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.assertValidPattern = void 0, exports.assertValidPattern = (pattern) => {
		if (typeof pattern != "string") throw TypeError("invalid pattern");
		if (pattern.length > 65536) throw TypeError("pattern is too long");
	};
})), require_brace_expressions = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.parseClass = void 0;
	let posixClasses = {
		"[:alnum:]": ["\\p{L}\\p{Nl}\\p{Nd}", !0],
		"[:alpha:]": ["\\p{L}\\p{Nl}", !0],
		"[:ascii:]": ["\\x00-\\x7f", !1],
		"[:blank:]": ["\\p{Zs}\\t", !0],
		"[:cntrl:]": ["\\p{Cc}", !0],
		"[:digit:]": ["\\p{Nd}", !0],
		"[:graph:]": [
			"\\p{Z}\\p{C}",
			!0,
			!0
		],
		"[:lower:]": ["\\p{Ll}", !0],
		"[:print:]": ["\\p{C}", !0],
		"[:punct:]": ["\\p{P}", !0],
		"[:space:]": ["\\p{Z}\\t\\r\\n\\v\\f", !0],
		"[:upper:]": ["\\p{Lu}", !0],
		"[:word:]": ["\\p{L}\\p{Nl}\\p{Nd}\\p{Pc}", !0],
		"[:xdigit:]": ["A-Fa-f0-9", !1]
	}, braceEscape = (s) => s.replace(/[[\]\\-]/g, "\\$&"), regexpEscape = (s) => s.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&"), rangesToString = (ranges) => ranges.join("");
	exports.parseClass = (glob, position) => {
		let pos = position;
		/* c8 ignore start */
		if (glob.charAt(pos) !== "[") throw Error("not in a brace expression");
		/* c8 ignore stop */
		let ranges = [], negs = [], i = pos + 1, sawStart = !1, uflag = !1, escaping = !1, negate = !1, endPos = pos, rangeStart = "";
		WHILE: for (; i < glob.length;) {
			let c = glob.charAt(i);
			if ((c === "!" || c === "^") && i === pos + 1) {
				negate = !0, i++;
				continue;
			}
			if (c === "]" && sawStart && !escaping) {
				endPos = i + 1;
				break;
			}
			if (sawStart = !0, c === "\\" && !escaping) {
				escaping = !0, i++;
				continue;
			}
			if (c === "[" && !escaping) {
				for (let [cls, [unip, u, neg]] of Object.entries(posixClasses)) if (glob.startsWith(cls, i)) {
					if (rangeStart) return [
						"$.",
						!1,
						glob.length - pos,
						!0
					];
					i += cls.length, neg ? negs.push(unip) : ranges.push(unip), uflag ||= u;
					continue WHILE;
				}
			}
			if (escaping = !1, rangeStart) {
				c > rangeStart ? ranges.push(braceEscape(rangeStart) + "-" + braceEscape(c)) : c === rangeStart && ranges.push(braceEscape(c)), rangeStart = "", i++;
				continue;
			}
			if (glob.startsWith("-]", i + 1)) {
				ranges.push(braceEscape(c + "-")), i += 2;
				continue;
			}
			if (glob.startsWith("-", i + 1)) {
				rangeStart = c, i += 2;
				continue;
			}
			ranges.push(braceEscape(c)), i++;
		}
		if (endPos < i) return [
			"",
			!1,
			0,
			!1
		];
		if (!ranges.length && !negs.length) return [
			"$.",
			!1,
			glob.length - pos,
			!0
		];
		if (negs.length === 0 && ranges.length === 1 && /^\\?.$/.test(ranges[0]) && !negate) {
			let r = ranges[0].length === 2 ? ranges[0].slice(-1) : ranges[0];
			return [
				regexpEscape(r),
				!1,
				endPos - pos,
				!1
			];
		}
		let sranges = "[" + (negate ? "^" : "") + rangesToString(ranges) + "]", snegs = "[" + (negate ? "" : "^") + rangesToString(negs) + "]";
		return [
			ranges.length && negs.length ? "(" + sranges + "|" + snegs + ")" : ranges.length ? sranges : snegs,
			uflag,
			endPos - pos,
			!0
		];
	};
})), require_unescape = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.unescape = void 0, exports.unescape = (s, { windowsPathsNoEscape = !1, magicalBraces = !0 } = {}) => magicalBraces ? windowsPathsNoEscape ? s.replace(/\[([^/\\])\]/g, "$1") : s.replace(/((?!\\).|^)\[([^/\\])\]/g, "$1$2").replace(/\\([^/])/g, "$1") : windowsPathsNoEscape ? s.replace(/\[([^/\\{}])\]/g, "$1") : s.replace(/((?!\\).|^)\[([^/\\{}])\]/g, "$1$2").replace(/\\([^/{}])/g, "$1");
})), require_ast = /* @__PURE__ */ __commonJSMin(((exports) => {
	var _a;
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.AST = void 0;
	let brace_expressions_js_1 = require_brace_expressions(), unescape_js_1 = require_unescape(), types = /* @__PURE__ */ new Set([
		"!",
		"?",
		"+",
		"*",
		"@"
	]), isExtglobType = (c) => types.has(c), isExtglobAST = (c) => isExtglobType(c.type), adoptionMap = /* @__PURE__ */ new Map([
		["!", ["@"]],
		["?", ["?", "@"]],
		["@", ["@"]],
		["*", [
			"*",
			"+",
			"?",
			"@"
		]],
		["+", ["+", "@"]]
	]), adoptionWithSpaceMap = /* @__PURE__ */ new Map([
		["!", ["?"]],
		["@", ["?"]],
		["+", ["?", "*"]]
	]), adoptionAnyMap = /* @__PURE__ */ new Map([
		["!", ["?", "@"]],
		["?", ["?", "@"]],
		["@", ["?", "@"]],
		["*", [
			"*",
			"+",
			"?",
			"@"
		]],
		["+", [
			"+",
			"@",
			"?",
			"*"
		]]
	]), usurpMap = /* @__PURE__ */ new Map([
		["!", /* @__PURE__ */ new Map([["!", "@"]])],
		["?", /* @__PURE__ */ new Map([["*", "*"], ["+", "*"]])],
		["@", /* @__PURE__ */ new Map([
			["!", "!"],
			["?", "?"],
			["@", "@"],
			["*", "*"],
			["+", "+"]
		])],
		["+", /* @__PURE__ */ new Map([["?", "*"], ["*", "*"]])]
	]), startNoDot = "(?!\\.)", addPatternStart = /* @__PURE__ */ new Set(["[", "."]), justDots = /* @__PURE__ */ new Set(["..", "."]), reSpecials = /* @__PURE__ */ new Set("().*{}+?[]^$\\!"), regExpEscape = (s) => s.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&"), starNoEmpty = "[^/]+?", ID = 0;
	var AST = class {
		type;
		#root;
		#hasMagic;
		#uflag = !1;
		#parts = [];
		#parent;
		#parentIndex;
		#negs;
		#filledNegs = !1;
		#options;
		#toString;
		#emptyExt = !1;
		id = ++ID;
		get depth() {
			return (this.#parent?.depth ?? -1) + 1;
		}
		[Symbol.for("nodejs.util.inspect.custom")]() {
			return {
				"@@type": "AST",
				id: this.id,
				type: this.type,
				root: this.#root.id,
				parent: this.#parent?.id,
				depth: this.depth,
				partsLength: this.#parts.length,
				parts: this.#parts
			};
		}
		constructor(type, parent, options = {}) {
			this.type = type, type && (this.#hasMagic = !0), this.#parent = parent, this.#root = this.#parent ? this.#parent.#root : this, this.#options = this.#root === this ? options : this.#root.#options, this.#negs = this.#root === this ? [] : this.#root.#negs, type === "!" && !this.#root.#filledNegs && this.#negs.push(this), this.#parentIndex = this.#parent ? this.#parent.#parts.length : 0;
		}
		get hasMagic() {
			/* c8 ignore start */
			if (this.#hasMagic !== void 0) return this.#hasMagic;
			/* c8 ignore stop */
			for (let p of this.#parts) if (typeof p != "string" && (p.type || p.hasMagic)) return this.#hasMagic = !0;
			return this.#hasMagic;
		}
		toString() {
			return this.#toString === void 0 ? this.type ? this.#toString = this.type + "(" + this.#parts.map((p) => String(p)).join("|") + ")" : this.#toString = this.#parts.map((p) => String(p)).join("") : this.#toString;
		}
		#fillNegs() {
			/* c8 ignore start */
			if (this !== this.#root) throw Error("should only call on root");
			if (this.#filledNegs) return this;
			this.toString(), this.#filledNegs = !0;
			let n;
			for (; n = this.#negs.pop();) {
				if (n.type !== "!") continue;
				let p = n, pp = p.#parent;
				for (; pp;) {
					for (let i = p.#parentIndex + 1; !pp.type && i < pp.#parts.length; i++) for (let part of n.#parts) {
						/* c8 ignore start */
						if (typeof part == "string") throw Error("string part in extglob AST??");
						/* c8 ignore stop */
						part.copyIn(pp.#parts[i]);
					}
					p = pp, pp = p.#parent;
				}
			}
			return this;
		}
		push(...parts) {
			for (let p of parts) if (p !== "") {
				/* c8 ignore start */
				if (typeof p != "string" && !(p instanceof _a && p.#parent === this)) throw Error("invalid part: " + p);
				/* c8 ignore stop */
				this.#parts.push(p);
			}
		}
		toJSON() {
			let ret = this.type === null ? this.#parts.slice().map((p) => typeof p == "string" ? p : p.toJSON()) : [this.type, ...this.#parts.map((p) => p.toJSON())];
			return this.isStart() && !this.type && ret.unshift([]), this.isEnd() && (this === this.#root || this.#root.#filledNegs && this.#parent?.type === "!") && ret.push({}), ret;
		}
		isStart() {
			if (this.#root === this) return !0;
			if (!this.#parent?.isStart()) return !1;
			if (this.#parentIndex === 0) return !0;
			let p = this.#parent;
			for (let i = 0; i < this.#parentIndex; i++) {
				let pp = p.#parts[i];
				if (!(pp instanceof _a && pp.type === "!")) return !1;
			}
			return !0;
		}
		isEnd() {
			if (this.#root === this || this.#parent?.type === "!") return !0;
			if (!this.#parent?.isEnd()) return !1;
			if (!this.type) return this.#parent?.isEnd();
			/* c8 ignore start */
			let pl = this.#parent ? this.#parent.#parts.length : 0;
			/* c8 ignore stop */
			return this.#parentIndex === pl - 1;
		}
		copyIn(part) {
			typeof part == "string" ? this.push(part) : this.push(part.clone(this));
		}
		clone(parent) {
			let c = new _a(this.type, parent);
			for (let p of this.#parts) c.copyIn(p);
			return c;
		}
		static #parseAST(str, ast, pos, opt, extDepth) {
			let maxDepth = opt.maxExtglobRecursion ?? 2, escaping = !1, inBrace = !1, braceStart = -1, braceNeg = !1;
			if (ast.type === null) {
				let i = pos, acc = "";
				for (; i < str.length;) {
					let c = str.charAt(i++);
					if (escaping || c === "\\") {
						escaping = !escaping, acc += c;
						continue;
					}
					if (inBrace) {
						i === braceStart + 1 ? (c === "^" || c === "!") && (braceNeg = !0) : c === "]" && !(i === braceStart + 2 && braceNeg) && (inBrace = !1), acc += c;
						continue;
					} else if (c === "[") {
						inBrace = !0, braceStart = i, braceNeg = !1, acc += c;
						continue;
					}
					if (!opt.noext && isExtglobType(c) && str.charAt(i) === "(" && extDepth <= maxDepth) {
						ast.push(acc), acc = "";
						let ext = new _a(c, ast);
						i = _a.#parseAST(str, ext, i, opt, extDepth + 1), ast.push(ext);
						continue;
					}
					acc += c;
				}
				return ast.push(acc), i;
			}
			let i = pos + 1, part = new _a(null, ast), parts = [], acc = "";
			for (; i < str.length;) {
				let c = str.charAt(i++);
				if (escaping || c === "\\") {
					escaping = !escaping, acc += c;
					continue;
				}
				if (inBrace) {
					i === braceStart + 1 ? (c === "^" || c === "!") && (braceNeg = !0) : c === "]" && !(i === braceStart + 2 && braceNeg) && (inBrace = !1), acc += c;
					continue;
				} else if (c === "[") {
					inBrace = !0, braceStart = i, braceNeg = !1, acc += c;
					continue;
				}
				/* c8 ignore stop */
				if (!opt.noext && isExtglobType(c) && str.charAt(i) === "(" && (extDepth <= maxDepth || ast && ast.#canAdoptType(c))) {
					let depthAdd = ast && ast.#canAdoptType(c) ? 0 : 1;
					part.push(acc), acc = "";
					let ext = new _a(c, part);
					part.push(ext), i = _a.#parseAST(str, ext, i, opt, extDepth + depthAdd);
					continue;
				}
				if (c === "|") {
					part.push(acc), acc = "", parts.push(part), part = new _a(null, ast);
					continue;
				}
				if (c === ")") return acc === "" && ast.#parts.length === 0 && (ast.#emptyExt = !0), part.push(acc), acc = "", ast.push(...parts, part), i;
				acc += c;
			}
			return ast.type = null, ast.#hasMagic = void 0, ast.#parts = [str.substring(pos - 1)], i;
		}
		#canAdoptWithSpace(child) {
			return this.#canAdopt(child, adoptionWithSpaceMap);
		}
		#canAdopt(child, map = adoptionMap) {
			if (!child || typeof child != "object" || child.type !== null || child.#parts.length !== 1 || this.type === null) return !1;
			let gc = child.#parts[0];
			return !gc || typeof gc != "object" || gc.type === null ? !1 : this.#canAdoptType(gc.type, map);
		}
		#canAdoptType(c, map = adoptionAnyMap) {
			return !!map.get(this.type)?.includes(c);
		}
		#adoptWithSpace(child, index) {
			let gc = child.#parts[0], blank = new _a(null, gc, this.options);
			blank.#parts.push(""), gc.push(blank), this.#adopt(child, index);
		}
		#adopt(child, index) {
			let gc = child.#parts[0];
			this.#parts.splice(index, 1, ...gc.#parts);
			for (let p of gc.#parts) typeof p == "object" && (p.#parent = this);
			this.#toString = void 0;
		}
		#canUsurpType(c) {
			return !!usurpMap.get(this.type)?.has(c);
		}
		#canUsurp(child) {
			if (!child || typeof child != "object" || child.type !== null || child.#parts.length !== 1 || this.type === null || this.#parts.length !== 1) return !1;
			let gc = child.#parts[0];
			return !gc || typeof gc != "object" || gc.type === null ? !1 : this.#canUsurpType(gc.type);
		}
		#usurp(child) {
			let m = usurpMap.get(this.type), gc = child.#parts[0], nt = m?.get(gc.type);
			/* c8 ignore start - impossible */
			if (!nt) return !1;
			/* c8 ignore stop */
			this.#parts = gc.#parts;
			for (let p of this.#parts) typeof p == "object" && (p.#parent = this);
			this.type = nt, this.#toString = void 0, this.#emptyExt = !1;
		}
		static fromGlob(pattern, options = {}) {
			let ast = new _a(null, void 0, options);
			return _a.#parseAST(pattern, ast, 0, options, 0), ast;
		}
		toMMPattern() {
			/* c8 ignore start */
			if (this !== this.#root) return this.#root.toMMPattern();
			/* c8 ignore stop */
			let glob = this.toString(), [re, body, hasMagic, uflag] = this.toRegExpSource();
			if (!(hasMagic || this.#hasMagic || this.#options.nocase && !this.#options.nocaseMagicOnly && glob.toUpperCase() !== glob.toLowerCase())) return body;
			let flags = (this.#options.nocase ? "i" : "") + (uflag ? "u" : "");
			return Object.assign(RegExp(`^${re}$`, flags), {
				_src: re,
				_glob: glob
			});
		}
		get options() {
			return this.#options;
		}
		toRegExpSource(allowDot) {
			let dot = allowDot ?? !!this.#options.dot;
			if (this.#root === this && (this.#flatten(), this.#fillNegs()), !isExtglobAST(this)) {
				let noEmpty = this.isStart() && this.isEnd() && !this.#parts.some((s) => typeof s != "string"), src = this.#parts.map((p) => {
					let [re, _, hasMagic, uflag] = typeof p == "string" ? _a.#parseGlob(p, this.#hasMagic, noEmpty) : p.toRegExpSource(allowDot);
					return this.#hasMagic = this.#hasMagic || hasMagic, this.#uflag = this.#uflag || uflag, re;
				}).join(""), start = "";
				if (this.isStart() && typeof this.#parts[0] == "string" && !(this.#parts.length === 1 && justDots.has(this.#parts[0]))) {
					let aps = addPatternStart, needNoTrav = dot && aps.has(src.charAt(0)) || src.startsWith("\\.") && aps.has(src.charAt(2)) || src.startsWith("\\.\\.") && aps.has(src.charAt(4)), needNoDot = !dot && !allowDot && aps.has(src.charAt(0));
					start = needNoTrav ? "(?!(?:^|/)\\.\\.?(?:$|/))" : needNoDot ? startNoDot : "";
				}
				let end = "";
				return this.isEnd() && this.#root.#filledNegs && this.#parent?.type === "!" && (end = "(?:$|\\/)"), [
					start + src + end,
					(0, unescape_js_1.unescape)(src),
					this.#hasMagic = !!this.#hasMagic,
					this.#uflag
				];
			}
			let repeated = this.type === "*" || this.type === "+", start = this.type === "!" ? "(?:(?!(?:" : "(?:", body = this.#partsToRegExp(dot);
			if (this.isStart() && this.isEnd() && !body && this.type !== "!") {
				let s = this.toString(), me = this;
				return me.#parts = [s], me.type = null, me.#hasMagic = void 0, [
					s,
					(0, unescape_js_1.unescape)(this.toString()),
					!1,
					!1
				];
			}
			let bodyDotAllowed = !repeated || allowDot || dot ? "" : this.#partsToRegExp(!0);
			bodyDotAllowed === body && (bodyDotAllowed = ""), bodyDotAllowed && (body = `(?:${body})(?:${bodyDotAllowed})*?`);
			let final = "";
			if (this.type === "!" && this.#emptyExt) final = (this.isStart() && !dot ? startNoDot : "") + starNoEmpty;
			else {
				let close = this.type === "!" ? "))" + (this.isStart() && !dot && !allowDot ? startNoDot : "") + "[^/]*?)" : this.type === "@" ? ")" : this.type === "?" ? ")?" : this.type === "+" && bodyDotAllowed ? ")" : this.type === "*" && bodyDotAllowed ? ")?" : `)${this.type}`;
				final = start + body + close;
			}
			return [
				final,
				(0, unescape_js_1.unescape)(body),
				this.#hasMagic = !!this.#hasMagic,
				this.#uflag
			];
		}
		#flatten() {
			if (isExtglobAST(this)) {
				let iterations = 0, done = !1;
				do {
					done = !0;
					for (let i = 0; i < this.#parts.length; i++) {
						let c = this.#parts[i];
						typeof c == "object" && (c.#flatten(), this.#canAdopt(c) ? (done = !1, this.#adopt(c, i)) : this.#canAdoptWithSpace(c) ? (done = !1, this.#adoptWithSpace(c, i)) : this.#canUsurp(c) && (done = !1, this.#usurp(c)));
					}
				} while (!done && ++iterations < 10);
			} else for (let p of this.#parts) typeof p == "object" && p.#flatten();
			this.#toString = void 0;
		}
		#partsToRegExp(dot) {
			return this.#parts.map((p) => {
				/* c8 ignore start */
				if (typeof p == "string") throw Error("string type in extglob ast??");
				/* c8 ignore stop */
				let [re, _, _hasMagic, uflag] = p.toRegExpSource(dot);
				return this.#uflag = this.#uflag || uflag, re;
			}).filter((p) => !(this.isStart() && this.isEnd()) || !!p).join("|");
		}
		static #parseGlob(glob, hasMagic, noEmpty = !1) {
			let escaping = !1, re = "", uflag = !1, inStar = !1;
			for (let i = 0; i < glob.length; i++) {
				let c = glob.charAt(i);
				if (escaping) {
					escaping = !1, re += (reSpecials.has(c) ? "\\" : "") + c;
					continue;
				}
				if (c === "*") {
					if (inStar) continue;
					inStar = !0, re += noEmpty && /^[*]+$/.test(glob) ? starNoEmpty : "[^/]*?", hasMagic = !0;
					continue;
				} else inStar = !1;
				if (c === "\\") {
					i === glob.length - 1 ? re += "\\\\" : escaping = !0;
					continue;
				}
				if (c === "[") {
					let [src, needUflag, consumed, magic] = (0, brace_expressions_js_1.parseClass)(glob, i);
					if (consumed) {
						re += src, uflag ||= needUflag, i += consumed - 1, hasMagic ||= magic;
						continue;
					}
				}
				if (c === "?") {
					re += "[^/]", hasMagic = !0;
					continue;
				}
				re += regExpEscape(c);
			}
			return [
				re,
				(0, unescape_js_1.unescape)(glob),
				!!hasMagic,
				uflag
			];
		}
	};
	exports.AST = AST, _a = AST;
})), require_escape = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.escape = void 0, exports.escape = (s, { windowsPathsNoEscape = !1, magicalBraces = !1 } = {}) => magicalBraces ? windowsPathsNoEscape ? s.replace(/[?*()[\]{}]/g, "[$&]") : s.replace(/[?*()[\]\\{}]/g, "\\$&") : windowsPathsNoEscape ? s.replace(/[?*()[\]]/g, "[$&]") : s.replace(/[?*()[\]\\]/g, "\\$&");
})), require_commonjs = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.unescape = exports.escape = exports.AST = exports.Minimatch = exports.match = exports.makeRe = exports.braceExpand = exports.defaults = exports.filter = exports.GLOBSTAR = exports.sep = exports.minimatch = void 0;
	let brace_expansion_1 = require_commonjs$1(), assert_valid_pattern_js_1 = require_assert_valid_pattern(), ast_js_1 = require_ast(), escape_js_1 = require_escape(), unescape_js_1 = require_unescape();
	exports.minimatch = (p, pattern, options = {}) => ((0, assert_valid_pattern_js_1.assertValidPattern)(pattern), !options.nocomment && pattern.charAt(0) === "#" ? !1 : new Minimatch(pattern, options).match(p));
	let starDotExtRE = /^\*+([^+@!?*[(]*)$/, starDotExtTest = (ext) => (f) => !f.startsWith(".") && f.endsWith(ext), starDotExtTestDot = (ext) => (f) => f.endsWith(ext), starDotExtTestNocase = (ext) => (ext = ext.toLowerCase(), (f) => !f.startsWith(".") && f.toLowerCase().endsWith(ext)), starDotExtTestNocaseDot = (ext) => (ext = ext.toLowerCase(), (f) => f.toLowerCase().endsWith(ext)), starDotStarRE = /^\*+\.\*+$/, starDotStarTest = (f) => !f.startsWith(".") && f.includes("."), starDotStarTestDot = (f) => f !== "." && f !== ".." && f.includes("."), dotStarRE = /^\.\*+$/, dotStarTest = (f) => f !== "." && f !== ".." && f.startsWith("."), starRE = /^\*+$/, starTest = (f) => f.length !== 0 && !f.startsWith("."), starTestDot = (f) => f.length !== 0 && f !== "." && f !== "..", qmarksRE = /^\?+([^+@!?*[(]*)?$/, qmarksTestNocase = ([$0, ext = ""]) => {
		let noext = qmarksTestNoExt([$0]);
		return ext ? (ext = ext.toLowerCase(), (f) => noext(f) && f.toLowerCase().endsWith(ext)) : noext;
	}, qmarksTestNocaseDot = ([$0, ext = ""]) => {
		let noext = qmarksTestNoExtDot([$0]);
		return ext ? (ext = ext.toLowerCase(), (f) => noext(f) && f.toLowerCase().endsWith(ext)) : noext;
	}, qmarksTestDot = ([$0, ext = ""]) => {
		let noext = qmarksTestNoExtDot([$0]);
		return ext ? (f) => noext(f) && f.endsWith(ext) : noext;
	}, qmarksTest = ([$0, ext = ""]) => {
		let noext = qmarksTestNoExt([$0]);
		return ext ? (f) => noext(f) && f.endsWith(ext) : noext;
	}, qmarksTestNoExt = ([$0]) => {
		let len = $0.length;
		return (f) => f.length === len && !f.startsWith(".");
	}, qmarksTestNoExtDot = ([$0]) => {
		let len = $0.length;
		return (f) => f.length === len && f !== "." && f !== "..";
	}, defaultPlatform = typeof process == "object" && process ? typeof process.env == "object" && process.env && process.env.__MINIMATCH_TESTING_PLATFORM__ || process.platform : "posix", path = {
		win32: { sep: "\\" },
		posix: { sep: "/" }
	};
	exports.sep = defaultPlatform === "win32" ? path.win32.sep : path.posix.sep, exports.minimatch.sep = exports.sep, exports.GLOBSTAR = Symbol("globstar **"), exports.minimatch.GLOBSTAR = exports.GLOBSTAR, exports.filter = (pattern, options = {}) => (p) => (0, exports.minimatch)(p, pattern, options), exports.minimatch.filter = exports.filter;
	let ext = (a, b = {}) => Object.assign({}, a, b);
	exports.defaults = (def) => {
		if (!def || typeof def != "object" || !Object.keys(def).length) return exports.minimatch;
		let orig = exports.minimatch;
		return Object.assign((p, pattern, options = {}) => orig(p, pattern, ext(def, options)), {
			Minimatch: class extends orig.Minimatch {
				constructor(pattern, options = {}) {
					super(pattern, ext(def, options));
				}
				static defaults(options) {
					return orig.defaults(ext(def, options)).Minimatch;
				}
			},
			AST: class extends orig.AST {
				/* c8 ignore start */
				constructor(type, parent, options = {}) {
					super(type, parent, ext(def, options));
				}
				/* c8 ignore stop */
				static fromGlob(pattern, options = {}) {
					return orig.AST.fromGlob(pattern, ext(def, options));
				}
			},
			unescape: (s, options = {}) => orig.unescape(s, ext(def, options)),
			escape: (s, options = {}) => orig.escape(s, ext(def, options)),
			filter: (pattern, options = {}) => orig.filter(pattern, ext(def, options)),
			defaults: (options) => orig.defaults(ext(def, options)),
			makeRe: (pattern, options = {}) => orig.makeRe(pattern, ext(def, options)),
			braceExpand: (pattern, options = {}) => orig.braceExpand(pattern, ext(def, options)),
			match: (list, pattern, options = {}) => orig.match(list, pattern, ext(def, options)),
			sep: orig.sep,
			GLOBSTAR: exports.GLOBSTAR
		});
	}, exports.minimatch.defaults = exports.defaults, exports.braceExpand = (pattern, options = {}) => ((0, assert_valid_pattern_js_1.assertValidPattern)(pattern), options.nobrace || !/\{(?:(?!\{).)*\}/.test(pattern) ? [pattern] : (0, brace_expansion_1.expand)(pattern, { max: options.braceExpandMax })), exports.minimatch.braceExpand = exports.braceExpand, exports.makeRe = (pattern, options = {}) => new Minimatch(pattern, options).makeRe(), exports.minimatch.makeRe = exports.makeRe, exports.match = (list, pattern, options = {}) => {
		let mm = new Minimatch(pattern, options);
		return list = list.filter((f) => mm.match(f)), mm.options.nonull && !list.length && list.push(pattern), list;
	}, exports.minimatch.match = exports.match;
	let globMagic = /[?*]|[+@!]\(.*?\)|\[|\]/, regExpEscape = (s) => s.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
	var Minimatch = class {
		options;
		set;
		pattern;
		windowsPathsNoEscape;
		nonegate;
		negate;
		comment;
		empty;
		preserveMultipleSlashes;
		partial;
		globSet;
		globParts;
		nocase;
		isWindows;
		platform;
		windowsNoMagicRoot;
		maxGlobstarRecursion;
		regexp;
		constructor(pattern, options = {}) {
			(0, assert_valid_pattern_js_1.assertValidPattern)(pattern), options ||= {}, this.options = options, this.maxGlobstarRecursion = options.maxGlobstarRecursion ?? 200, this.pattern = pattern, this.platform = options.platform || defaultPlatform, this.isWindows = this.platform === "win32", this.windowsPathsNoEscape = !!options.windowsPathsNoEscape || options.allowWindowsEscape === !1, this.windowsPathsNoEscape && (this.pattern = this.pattern.replace(/\\/g, "/")), this.preserveMultipleSlashes = !!options.preserveMultipleSlashes, this.regexp = null, this.negate = !1, this.nonegate = !!options.nonegate, this.comment = !1, this.empty = !1, this.partial = !!options.partial, this.nocase = !!this.options.nocase, this.windowsNoMagicRoot = options.windowsNoMagicRoot === void 0 ? !!(this.isWindows && this.nocase) : options.windowsNoMagicRoot, this.globSet = [], this.globParts = [], this.set = [], this.make();
		}
		hasMagic() {
			if (this.options.magicalBraces && this.set.length > 1) return !0;
			for (let pattern of this.set) for (let part of pattern) if (typeof part != "string") return !0;
			return !1;
		}
		debug(..._) {}
		make() {
			let pattern = this.pattern, options = this.options;
			if (!options.nocomment && pattern.charAt(0) === "#") {
				this.comment = !0;
				return;
			}
			if (!pattern) {
				this.empty = !0;
				return;
			}
			this.parseNegate(), this.globSet = [...new Set(this.braceExpand())], options.debug && (this.debug = (...args) => console.error(...args)), this.debug(this.pattern, this.globSet);
			let rawGlobParts = this.globSet.map((s) => this.slashSplit(s));
			this.globParts = this.preprocess(rawGlobParts), this.debug(this.pattern, this.globParts);
			let set = this.globParts.map((s, _, __) => {
				if (this.isWindows && this.windowsNoMagicRoot) {
					let isUNC = s[0] === "" && s[1] === "" && (s[2] === "?" || !globMagic.test(s[2])) && !globMagic.test(s[3]), isDrive = /^[a-z]:/i.test(s[0]);
					if (isUNC) return [...s.slice(0, 4), ...s.slice(4).map((ss) => this.parse(ss))];
					if (isDrive) return [s[0], ...s.slice(1).map((ss) => this.parse(ss))];
				}
				return s.map((ss) => this.parse(ss));
			});
			if (this.debug(this.pattern, set), this.set = set.filter((s) => s.indexOf(!1) === -1), this.isWindows) for (let i = 0; i < this.set.length; i++) {
				let p = this.set[i];
				p[0] === "" && p[1] === "" && this.globParts[i][2] === "?" && typeof p[3] == "string" && /^[a-z]:$/i.test(p[3]) && (p[2] = "?");
			}
			this.debug(this.pattern, this.set);
		}
		preprocess(globParts) {
			if (this.options.noglobstar) for (let partset of globParts) for (let j = 0; j < partset.length; j++) partset[j] === "**" && (partset[j] = "*");
			let { optimizationLevel = 1 } = this.options;
			return optimizationLevel >= 2 ? (globParts = this.firstPhasePreProcess(globParts), globParts = this.secondPhasePreProcess(globParts)) : globParts = optimizationLevel >= 1 ? this.levelOneOptimize(globParts) : this.adjascentGlobstarOptimize(globParts), globParts;
		}
		adjascentGlobstarOptimize(globParts) {
			return globParts.map((parts) => {
				let gs = -1;
				for (; (gs = parts.indexOf("**", gs + 1)) !== -1;) {
					let i = gs;
					for (; parts[i + 1] === "**";) i++;
					i !== gs && parts.splice(gs, i - gs);
				}
				return parts;
			});
		}
		levelOneOptimize(globParts) {
			return globParts.map((parts) => (parts = parts.reduce((set, part) => {
				let prev = set[set.length - 1];
				return part === "**" && prev === "**" ? set : part === ".." && prev && prev !== ".." && prev !== "." && prev !== "**" ? (set.pop(), set) : (set.push(part), set);
			}, []), parts.length === 0 ? [""] : parts));
		}
		levelTwoFileOptimize(parts) {
			Array.isArray(parts) || (parts = this.slashSplit(parts));
			let didSomething = !1;
			do {
				if (didSomething = !1, !this.preserveMultipleSlashes) {
					for (let i = 1; i < parts.length - 1; i++) {
						let p = parts[i];
						i === 1 && p === "" && parts[0] === "" || (p === "." || p === "") && (didSomething = !0, parts.splice(i, 1), i--);
					}
					parts[0] === "." && parts.length === 2 && (parts[1] === "." || parts[1] === "") && (didSomething = !0, parts.pop());
				}
				let dd = 0;
				for (; (dd = parts.indexOf("..", dd + 1)) !== -1;) {
					let p = parts[dd - 1];
					p && p !== "." && p !== ".." && p !== "**" && !(this.isWindows && /^[a-z]:$/i.test(p)) && (didSomething = !0, parts.splice(dd - 1, 2), dd -= 2);
				}
			} while (didSomething);
			return parts.length === 0 ? [""] : parts;
		}
		firstPhasePreProcess(globParts) {
			let didSomething = !1;
			do {
				didSomething = !1;
				for (let parts of globParts) {
					let gs = -1;
					for (; (gs = parts.indexOf("**", gs + 1)) !== -1;) {
						let gss = gs;
						for (; parts[gss + 1] === "**";) gss++;
						gss > gs && parts.splice(gs + 1, gss - gs);
						let next = parts[gs + 1], p = parts[gs + 2], p2 = parts[gs + 3];
						if (next !== ".." || !p || p === "." || p === ".." || !p2 || p2 === "." || p2 === "..") continue;
						didSomething = !0, parts.splice(gs, 1);
						let other = parts.slice(0);
						other[gs] = "**", globParts.push(other), gs--;
					}
					if (!this.preserveMultipleSlashes) {
						for (let i = 1; i < parts.length - 1; i++) {
							let p = parts[i];
							i === 1 && p === "" && parts[0] === "" || (p === "." || p === "") && (didSomething = !0, parts.splice(i, 1), i--);
						}
						parts[0] === "." && parts.length === 2 && (parts[1] === "." || parts[1] === "") && (didSomething = !0, parts.pop());
					}
					let dd = 0;
					for (; (dd = parts.indexOf("..", dd + 1)) !== -1;) {
						let p = parts[dd - 1];
						if (p && p !== "." && p !== ".." && p !== "**") {
							didSomething = !0;
							let splin = dd === 1 && parts[dd + 1] === "**" ? ["."] : [];
							parts.splice(dd - 1, 2, ...splin), parts.length === 0 && parts.push(""), dd -= 2;
						}
					}
				}
			} while (didSomething);
			return globParts;
		}
		secondPhasePreProcess(globParts) {
			for (let i = 0; i < globParts.length - 1; i++) for (let j = i + 1; j < globParts.length; j++) {
				let matched = this.partsMatch(globParts[i], globParts[j], !this.preserveMultipleSlashes);
				if (matched) {
					globParts[i] = [], globParts[j] = matched;
					break;
				}
			}
			return globParts.filter((gs) => gs.length);
		}
		partsMatch(a, b, emptyGSMatch = !1) {
			let ai = 0, bi = 0, result = [], which = "";
			for (; ai < a.length && bi < b.length;) if (a[ai] === b[bi]) result.push(which === "b" ? b[bi] : a[ai]), ai++, bi++;
			else if (emptyGSMatch && a[ai] === "**" && b[bi] === a[ai + 1]) result.push(a[ai]), ai++;
			else if (emptyGSMatch && b[bi] === "**" && a[ai] === b[bi + 1]) result.push(b[bi]), bi++;
			else if (a[ai] === "*" && b[bi] && (this.options.dot || !b[bi].startsWith(".")) && b[bi] !== "**") {
				if (which === "b") return !1;
				which = "a", result.push(a[ai]), ai++, bi++;
			} else if (b[bi] === "*" && a[ai] && (this.options.dot || !a[ai].startsWith(".")) && a[ai] !== "**") {
				if (which === "a") return !1;
				which = "b", result.push(b[bi]), ai++, bi++;
			} else return !1;
			return a.length === b.length && result;
		}
		parseNegate() {
			if (this.nonegate) return;
			let pattern = this.pattern, negate = !1, negateOffset = 0;
			for (let i = 0; i < pattern.length && pattern.charAt(i) === "!"; i++) negate = !negate, negateOffset++;
			negateOffset && (this.pattern = pattern.slice(negateOffset)), this.negate = negate;
		}
		matchOne(file, pattern, partial = !1) {
			let fileStartIndex = 0, patternStartIndex = 0;
			if (this.isWindows) {
				let fileDrive = typeof file[0] == "string" && /^[a-z]:$/i.test(file[0]), fileUNC = !fileDrive && file[0] === "" && file[1] === "" && file[2] === "?" && /^[a-z]:$/i.test(file[3]), patternDrive = typeof pattern[0] == "string" && /^[a-z]:$/i.test(pattern[0]), patternUNC = !patternDrive && pattern[0] === "" && pattern[1] === "" && pattern[2] === "?" && typeof pattern[3] == "string" && /^[a-z]:$/i.test(pattern[3]), fdi = fileUNC ? 3 : fileDrive ? 0 : void 0, pdi = patternUNC ? 3 : patternDrive ? 0 : void 0;
				if (typeof fdi == "number" && typeof pdi == "number") {
					let [fd, pd] = [file[fdi], pattern[pdi]];
					fd.toLowerCase() === pd.toLowerCase() && (pattern[pdi] = fd, patternStartIndex = pdi, fileStartIndex = fdi);
				}
			}
			let { optimizationLevel = 1 } = this.options;
			return optimizationLevel >= 2 && (file = this.levelTwoFileOptimize(file)), pattern.includes(exports.GLOBSTAR) ? this.#matchGlobstar(file, pattern, partial, fileStartIndex, patternStartIndex) : this.#matchOne(file, pattern, partial, fileStartIndex, patternStartIndex);
		}
		#matchGlobstar(file, pattern, partial, fileIndex, patternIndex) {
			let firstgs = pattern.indexOf(exports.GLOBSTAR, patternIndex), lastgs = pattern.lastIndexOf(exports.GLOBSTAR), [head, body, tail] = partial ? [
				pattern.slice(patternIndex, firstgs),
				pattern.slice(firstgs + 1),
				[]
			] : [
				pattern.slice(patternIndex, firstgs),
				pattern.slice(firstgs + 1, lastgs),
				pattern.slice(lastgs + 1)
			];
			if (head.length) {
				let fileHead = file.slice(fileIndex, fileIndex + head.length);
				if (!this.#matchOne(fileHead, head, partial, 0, 0)) return !1;
				fileIndex += head.length, patternIndex += head.length;
			}
			let fileTailMatch = 0;
			if (tail.length) {
				if (tail.length + fileIndex > file.length) return !1;
				let tailStart = file.length - tail.length;
				if (this.#matchOne(file, tail, partial, tailStart, 0)) fileTailMatch = tail.length;
				else {
					if (file[file.length - 1] !== "" || fileIndex + tail.length === file.length || (tailStart--, !this.#matchOne(file, tail, partial, tailStart, 0))) return !1;
					fileTailMatch = tail.length + 1;
				}
			}
			if (!body.length) {
				let sawSome = !!fileTailMatch;
				for (let i = fileIndex; i < file.length - fileTailMatch; i++) {
					let f = String(file[i]);
					if (sawSome = !0, f === "." || f === ".." || !this.options.dot && f.startsWith(".")) return !1;
				}
				return partial || sawSome;
			}
			let bodySegments = [[[], 0]], currentBody = bodySegments[0], nonGsParts = 0, nonGsPartsSums = [0];
			for (let b of body) b === exports.GLOBSTAR ? (nonGsPartsSums.push(nonGsParts), currentBody = [[], 0], bodySegments.push(currentBody)) : (currentBody[0].push(b), nonGsParts++);
			let i = bodySegments.length - 1, fileLength = file.length - fileTailMatch;
			for (let b of bodySegments) b[1] = fileLength - (nonGsPartsSums[i--] + b[0].length);
			return !!this.#matchGlobStarBodySections(file, bodySegments, fileIndex, 0, partial, 0, !!fileTailMatch);
		}
		#matchGlobStarBodySections(file, bodySegments, fileIndex, bodyIndex, partial, globStarDepth, sawTail) {
			let bs = bodySegments[bodyIndex];
			if (!bs) {
				for (let i = fileIndex; i < file.length; i++) {
					sawTail = !0;
					let f = file[i];
					if (f === "." || f === ".." || !this.options.dot && f.startsWith(".")) return !1;
				}
				return sawTail;
			}
			let [body, after] = bs;
			for (; fileIndex <= after;) {
				if (this.#matchOne(file.slice(0, fileIndex + body.length), body, partial, fileIndex, 0) && globStarDepth < this.maxGlobstarRecursion) {
					let sub = this.#matchGlobStarBodySections(file, bodySegments, fileIndex + body.length, bodyIndex + 1, partial, globStarDepth + 1, sawTail);
					if (sub !== !1) return sub;
				}
				let f = file[fileIndex];
				if (f === "." || f === ".." || !this.options.dot && f.startsWith(".")) return !1;
				fileIndex++;
			}
			return partial || null;
		}
		#matchOne(file, pattern, partial, fileIndex, patternIndex) {
			let fi, pi, pl, fl;
			for (fi = fileIndex, pi = patternIndex, fl = file.length, pl = pattern.length; fi < fl && pi < pl; fi++, pi++) {
				this.debug("matchOne loop");
				let p = pattern[pi], f = file[fi];
				/* c8 ignore start */
				if (this.debug(pattern, p, f), p === !1 || p === exports.GLOBSTAR) return !1;
				/* c8 ignore stop */
				let hit;
				if (typeof p == "string" ? (hit = f === p, this.debug("string match", p, f, hit)) : (hit = p.test(f), this.debug("pattern match", p, f, hit)), !hit) return !1;
			}
			if (fi === fl && pi === pl) return !0;
			if (fi === fl) return partial;
			if (pi === pl) return fi === fl - 1 && file[fi] === "";
			throw Error("wtf?");
			/* c8 ignore stop */
		}
		braceExpand() {
			return (0, exports.braceExpand)(this.pattern, this.options);
		}
		parse(pattern) {
			(0, assert_valid_pattern_js_1.assertValidPattern)(pattern);
			let options = this.options;
			if (pattern === "**") return exports.GLOBSTAR;
			if (pattern === "") return "";
			let m, fastTest = null;
			(m = pattern.match(starRE)) ? fastTest = options.dot ? starTestDot : starTest : (m = pattern.match(starDotExtRE)) ? fastTest = (options.nocase ? options.dot ? starDotExtTestNocaseDot : starDotExtTestNocase : options.dot ? starDotExtTestDot : starDotExtTest)(m[1]) : (m = pattern.match(qmarksRE)) ? fastTest = (options.nocase ? options.dot ? qmarksTestNocaseDot : qmarksTestNocase : options.dot ? qmarksTestDot : qmarksTest)(m) : (m = pattern.match(starDotStarRE)) ? fastTest = options.dot ? starDotStarTestDot : starDotStarTest : (m = pattern.match(dotStarRE)) && (fastTest = dotStarTest);
			let re = ast_js_1.AST.fromGlob(pattern, this.options).toMMPattern();
			return fastTest && typeof re == "object" && Reflect.defineProperty(re, "test", { value: fastTest }), re;
		}
		makeRe() {
			if (this.regexp || this.regexp === !1) return this.regexp;
			let set = this.set;
			if (!set.length) return this.regexp = !1, this.regexp;
			let options = this.options, twoStar = options.noglobstar ? "[^/]*?" : options.dot ? "(?:(?!(?:\\/|^)(?:\\.{1,2})($|\\/)).)*?" : "(?:(?!(?:\\/|^)\\.).)*?", flags = new Set(options.nocase ? ["i"] : []), re = set.map((pattern) => {
				let pp = pattern.map((p) => {
					if (p instanceof RegExp) for (let f of p.flags.split("")) flags.add(f);
					return typeof p == "string" ? regExpEscape(p) : p === exports.GLOBSTAR ? exports.GLOBSTAR : p._src;
				});
				pp.forEach((p, i) => {
					let next = pp[i + 1], prev = pp[i - 1];
					p !== exports.GLOBSTAR || prev === exports.GLOBSTAR || (prev === void 0 ? next !== void 0 && next !== exports.GLOBSTAR ? pp[i + 1] = "(?:\\/|" + twoStar + "\\/)?" + next : pp[i] = twoStar : next === void 0 ? pp[i - 1] = prev + "(?:\\/|\\/" + twoStar + ")?" : next !== exports.GLOBSTAR && (pp[i - 1] = prev + "(?:\\/|\\/" + twoStar + "\\/)" + next, pp[i + 1] = exports.GLOBSTAR));
				});
				let filtered = pp.filter((p) => p !== exports.GLOBSTAR);
				if (this.partial && filtered.length >= 1) {
					let prefixes = [];
					for (let i = 1; i <= filtered.length; i++) prefixes.push(filtered.slice(0, i).join("/"));
					return "(?:" + prefixes.join("|") + ")";
				}
				return filtered.join("/");
			}).join("|"), [open, close] = set.length > 1 ? ["(?:", ")"] : ["", ""];
			re = "^" + open + re + close + "$", this.partial && (re = "^(?:\\/|" + open + re.slice(1, -1) + close + ")$"), this.negate && (re = "^(?!" + re + ").+$");
			try {
				this.regexp = new RegExp(re, [...flags].join(""));
			} catch {
				this.regexp = !1;
			}
			/* c8 ignore stop */
			return this.regexp;
		}
		slashSplit(p) {
			return this.preserveMultipleSlashes ? p.split("/") : this.isWindows && /^\/\/[^/]+/.test(p) ? ["", ...p.split(/\/+/)] : p.split(/\/+/);
		}
		match(f, partial = this.partial) {
			if (this.debug("match", f, this.pattern), this.comment) return !1;
			if (this.empty) return f === "";
			if (f === "/" && partial) return !0;
			let options = this.options;
			this.isWindows && (f = f.split("\\").join("/"));
			let ff = this.slashSplit(f);
			this.debug(this.pattern, "split", ff);
			let set = this.set;
			this.debug(this.pattern, "set", set);
			let filename = ff[ff.length - 1];
			if (!filename) for (let i = ff.length - 2; !filename && i >= 0; i--) filename = ff[i];
			for (let pattern of set) {
				let file = ff;
				if (options.matchBase && pattern.length === 1 && (file = [filename]), this.matchOne(file, pattern, partial)) return options.flipNegate ? !0 : !this.negate;
			}
			return !options.flipNegate && this.negate;
		}
		static defaults(def) {
			return exports.minimatch.defaults(def).Minimatch;
		}
	};
	exports.Minimatch = Minimatch;
	/* c8 ignore start */
	var ast_js_2 = require_ast();
	Object.defineProperty(exports, "AST", {
		enumerable: !0,
		get: function() {
			return ast_js_2.AST;
		}
	});
	var escape_js_2 = require_escape();
	Object.defineProperty(exports, "escape", {
		enumerable: !0,
		get: function() {
			return escape_js_2.escape;
		}
	});
	var unescape_js_2 = require_unescape();
	Object.defineProperty(exports, "unescape", {
		enumerable: !0,
		get: function() {
			return unescape_js_2.unescape;
		}
	}), exports.minimatch.AST = ast_js_1.AST, exports.minimatch.Minimatch = Minimatch, exports.minimatch.escape = escape_js_1.escape, exports.minimatch.unescape = unescape_js_1.unescape;
})), require_role = /* @__PURE__ */ __commonJSMin(((exports) => {
	var __importDefault = exports && exports.__importDefault || function(mod) {
		return mod && mod.__esModule ? mod : { default: mod };
	};
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.SuccinctRoles = exports.DelegatedRole = exports.Role = exports.TOP_LEVEL_ROLE_NAMES = void 0;
	let crypto_1$1 = __importDefault(require("crypto")), minimatch_1 = require_commonjs(), util_1$7 = __importDefault(require("util")), error_1 = require_error$5(), utils_1 = require_utils();
	exports.TOP_LEVEL_ROLE_NAMES = [
		"root",
		"targets",
		"snapshot",
		"timestamp"
	];
	/**
	* Container that defines which keys are required to sign roles metadata.
	*
	* Role defines how many keys are required to successfully sign the roles
	* metadata, and which keys are accepted.
	*/
	var Role = class Role {
		keyIDs;
		threshold;
		unrecognizedFields;
		constructor(options) {
			let { keyIDs, threshold, unrecognizedFields } = options;
			if (hasDuplicates(keyIDs)) throw new error_1.ValueError("duplicate key IDs found");
			if (threshold < 1) throw new error_1.ValueError("threshold must be at least 1");
			this.keyIDs = keyIDs, this.threshold = threshold, this.unrecognizedFields = unrecognizedFields || {};
		}
		equals(other) {
			return other instanceof Role && this.threshold === other.threshold && util_1$7.default.isDeepStrictEqual(this.keyIDs, other.keyIDs) && util_1$7.default.isDeepStrictEqual(this.unrecognizedFields, other.unrecognizedFields);
		}
		toJSON() {
			return {
				keyids: this.keyIDs,
				threshold: this.threshold,
				...this.unrecognizedFields
			};
		}
		static fromJSON(data) {
			let { keyids, threshold, ...rest } = data;
			if (!utils_1.guard.isStringArray(keyids)) throw TypeError("keyids must be an array");
			if (typeof threshold != "number") throw TypeError("threshold must be a number");
			return new Role({
				keyIDs: keyids,
				threshold,
				unrecognizedFields: rest
			});
		}
	};
	exports.Role = Role;
	function hasDuplicates(array) {
		return new Set(array).size !== array.length;
	}
	exports.DelegatedRole = class DelegatedRole extends Role {
		name;
		terminating;
		paths;
		pathHashPrefixes;
		constructor(opts) {
			super(opts);
			let { name, terminating, paths, pathHashPrefixes } = opts;
			if (this.name = name, this.terminating = terminating, opts.paths && opts.pathHashPrefixes) throw new error_1.ValueError("paths and pathHashPrefixes are mutually exclusive");
			this.paths = paths, this.pathHashPrefixes = pathHashPrefixes;
		}
		equals(other) {
			return other instanceof DelegatedRole && super.equals(other) && this.name === other.name && this.terminating === other.terminating && util_1$7.default.isDeepStrictEqual(this.paths, other.paths) && util_1$7.default.isDeepStrictEqual(this.pathHashPrefixes, other.pathHashPrefixes);
		}
		isDelegatedPath(targetFilepath) {
			if (this.paths) return this.paths.some((pathPattern) => isTargetInPathPattern(targetFilepath, pathPattern));
			if (this.pathHashPrefixes) {
				let pathHash = crypto_1$1.default.createHash("sha256").update(targetFilepath).digest("hex");
				return this.pathHashPrefixes.some((pathHashPrefix) => pathHash.startsWith(pathHashPrefix));
			}
			return !1;
		}
		toJSON() {
			let json = {
				...super.toJSON(),
				name: this.name,
				terminating: this.terminating
			};
			return this.paths && (json.paths = this.paths), this.pathHashPrefixes && (json.path_hash_prefixes = this.pathHashPrefixes), json;
		}
		static fromJSON(data) {
			let { keyids, threshold, name, terminating, paths, path_hash_prefixes, ...rest } = data;
			if (!utils_1.guard.isStringArray(keyids)) throw TypeError("keyids must be an array of strings");
			if (typeof threshold != "number") throw TypeError("threshold must be a number");
			if (typeof name != "string") throw TypeError("name must be a string");
			if (typeof terminating != "boolean") throw TypeError("terminating must be a boolean");
			if (utils_1.guard.isDefined(paths) && !utils_1.guard.isStringArray(paths)) throw TypeError("paths must be an array of strings");
			if (utils_1.guard.isDefined(path_hash_prefixes) && !utils_1.guard.isStringArray(path_hash_prefixes)) throw TypeError("path_hash_prefixes must be an array of strings");
			return new DelegatedRole({
				keyIDs: keyids,
				threshold,
				name,
				terminating,
				paths,
				pathHashPrefixes: path_hash_prefixes,
				unrecognizedFields: rest
			});
		}
	};
	let zip = (a, b) => a.map((k, i) => [k, b[i]]);
	function isTargetInPathPattern(target, pattern) {
		let targetParts = target.split("/"), patternParts = pattern.split("/");
		return patternParts.length == targetParts.length && zip(targetParts, patternParts).every(([targetPart, patternPart]) => (0, minimatch_1.minimatch)(targetPart, patternPart));
	}
	exports.SuccinctRoles = class SuccinctRoles extends Role {
		bitLength;
		namePrefix;
		numberOfBins;
		suffixLen;
		constructor(opts) {
			super(opts);
			let { bitLength, namePrefix } = opts;
			if (bitLength <= 0 || bitLength > 32) throw new error_1.ValueError("bitLength must be between 1 and 32");
			this.bitLength = bitLength, this.namePrefix = namePrefix, this.numberOfBins = 2 ** bitLength, this.suffixLen = (this.numberOfBins - 1).toString(16).length;
		}
		equals(other) {
			return other instanceof SuccinctRoles && super.equals(other) && this.bitLength === other.bitLength && this.namePrefix === other.namePrefix;
		}
		/***
		* Calculates the name of the delegated role responsible for 'target_filepath'.
		*
		* The target at path ''target_filepath' is assigned to a bin by casting
		* the left-most 'bit_length' of bits of the file path hash digest to
		* int, using it as bin index between 0 and '2**bit_length - 1'.
		*
		* Args:
		*  target_filepath: URL path to a target file, relative to a base
		*  targets URL.
		*/
		getRoleForTarget(targetFilepath) {
			let hashBytes = crypto_1$1.default.createHash("sha256").update(targetFilepath).digest().subarray(0, 4), shiftValue = 32 - this.bitLength, suffix = (hashBytes.readUInt32BE() >>> shiftValue).toString(16).padStart(this.suffixLen, "0");
			return `${this.namePrefix}-${suffix}`;
		}
		*getRoles() {
			for (let i = 0; i < this.numberOfBins; i++) {
				let suffix = i.toString(16).padStart(this.suffixLen, "0");
				yield `${this.namePrefix}-${suffix}`;
			}
		}
		/***
		* Determines whether the given ``role_name`` is in one of
		* the delegated roles that ``SuccinctRoles`` represents.
		*
		* Args:
		*  role_name: The name of the role to check against.
		*/
		isDelegatedRole(roleName) {
			let desiredPrefix = this.namePrefix + "-";
			if (!roleName.startsWith(desiredPrefix)) return !1;
			let suffix = roleName.slice(desiredPrefix.length, roleName.length);
			if (suffix.length != this.suffixLen || !suffix.match(/^[0-9a-fA-F]+$/)) return !1;
			let num = parseInt(suffix, 16);
			return 0 <= num && num < this.numberOfBins;
		}
		toJSON() {
			return {
				...super.toJSON(),
				bit_length: this.bitLength,
				name_prefix: this.namePrefix
			};
		}
		static fromJSON(data) {
			let { keyids, threshold, bit_length, name_prefix, ...rest } = data;
			if (!utils_1.guard.isStringArray(keyids)) throw TypeError("keyids must be an array of strings");
			if (typeof threshold != "number") throw TypeError("threshold must be a number");
			if (typeof bit_length != "number") throw TypeError("bit_length must be a number");
			if (typeof name_prefix != "string") throw TypeError("name_prefix must be a string");
			return new SuccinctRoles({
				keyIDs: keyids,
				threshold,
				bitLength: bit_length,
				namePrefix: name_prefix,
				unrecognizedFields: rest
			});
		}
	};
})), require_root = /* @__PURE__ */ __commonJSMin(((exports) => {
	var __importDefault = exports && exports.__importDefault || function(mod) {
		return mod && mod.__esModule ? mod : { default: mod };
	};
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.Root = void 0;
	let util_1$6 = __importDefault(require("util")), base_1 = require_base(), error_1 = require_error$5(), key_1 = require_key$1(), role_1 = require_role(), utils_1 = require_utils();
	exports.Root = class Root extends base_1.Signed {
		type = base_1.MetadataKind.Root;
		keys;
		roles;
		consistentSnapshot;
		constructor(options) {
			if (super(options), this.keys = options.keys || {}, this.consistentSnapshot = options.consistentSnapshot ?? !0, !options.roles) this.roles = role_1.TOP_LEVEL_ROLE_NAMES.reduce((acc, role) => ({
				...acc,
				[role]: new role_1.Role({
					keyIDs: [],
					threshold: 1
				})
			}), {});
			else {
				let roleNames = new Set(Object.keys(options.roles));
				if (!role_1.TOP_LEVEL_ROLE_NAMES.every((role) => roleNames.has(role))) throw new error_1.ValueError("missing top-level role");
				this.roles = options.roles;
			}
		}
		addKey(key, role) {
			if (!this.roles[role]) throw new error_1.ValueError(`role ${role} does not exist`);
			this.roles[role].keyIDs.includes(key.keyID) || this.roles[role].keyIDs.push(key.keyID), this.keys[key.keyID] = key;
		}
		equals(other) {
			return other instanceof Root && super.equals(other) && this.consistentSnapshot === other.consistentSnapshot && util_1$6.default.isDeepStrictEqual(this.keys, other.keys) && util_1$6.default.isDeepStrictEqual(this.roles, other.roles);
		}
		toJSON() {
			return {
				_type: this.type,
				spec_version: this.specVersion,
				version: this.version,
				expires: this.expires,
				keys: keysToJSON(this.keys),
				roles: rolesToJSON(this.roles),
				consistent_snapshot: this.consistentSnapshot,
				...this.unrecognizedFields
			};
		}
		static fromJSON(data) {
			let { unrecognizedFields, ...commonFields } = base_1.Signed.commonFieldsFromJSON(data), { keys, roles, consistent_snapshot, ...rest } = unrecognizedFields;
			if (typeof consistent_snapshot != "boolean") throw TypeError("consistent_snapshot must be a boolean");
			return new Root({
				...commonFields,
				keys: keysFromJSON(keys),
				roles: rolesFromJSON(roles),
				consistentSnapshot: consistent_snapshot,
				unrecognizedFields: rest
			});
		}
	};
	function keysToJSON(keys) {
		return Object.entries(keys).reduce((acc, [keyID, key]) => ({
			...acc,
			[keyID]: key.toJSON()
		}), {});
	}
	function rolesToJSON(roles) {
		return Object.entries(roles).reduce((acc, [roleName, role]) => ({
			...acc,
			[roleName]: role.toJSON()
		}), {});
	}
	function keysFromJSON(data) {
		let keys;
		if (utils_1.guard.isDefined(data)) {
			if (!utils_1.guard.isObjectRecord(data)) throw TypeError("keys must be an object");
			keys = Object.entries(data).reduce((acc, [keyID, keyData]) => ({
				...acc,
				[keyID]: key_1.Key.fromJSON(keyID, keyData)
			}), {});
		}
		return keys;
	}
	function rolesFromJSON(data) {
		let roles;
		if (utils_1.guard.isDefined(data)) {
			if (!utils_1.guard.isObjectRecord(data)) throw TypeError("roles must be an object");
			roles = Object.entries(data).reduce((acc, [roleName, roleData]) => ({
				...acc,
				[roleName]: role_1.Role.fromJSON(roleData)
			}), {});
		}
		return roles;
	}
})), require_signature = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.Signature = void 0, exports.Signature = class Signature {
		keyID;
		sig;
		constructor(options) {
			let { keyID, sig } = options;
			this.keyID = keyID, this.sig = sig;
		}
		toJSON() {
			return {
				keyid: this.keyID,
				sig: this.sig
			};
		}
		static fromJSON(data) {
			let { keyid, sig } = data;
			if (typeof keyid != "string") throw TypeError("keyid must be a string");
			if (typeof sig != "string") throw TypeError("sig must be a string");
			return new Signature({
				keyID: keyid,
				sig
			});
		}
	};
})), require_snapshot = /* @__PURE__ */ __commonJSMin(((exports) => {
	var __importDefault = exports && exports.__importDefault || function(mod) {
		return mod && mod.__esModule ? mod : { default: mod };
	};
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.Snapshot = void 0;
	let util_1$5 = __importDefault(require("util")), base_1 = require_base(), file_1 = require_file(), utils_1 = require_utils();
	exports.Snapshot = class Snapshot extends base_1.Signed {
		type = base_1.MetadataKind.Snapshot;
		meta;
		constructor(opts) {
			super(opts), this.meta = opts.meta || { "targets.json": new file_1.MetaFile({ version: 1 }) };
		}
		equals(other) {
			return other instanceof Snapshot && super.equals(other) && util_1$5.default.isDeepStrictEqual(this.meta, other.meta);
		}
		toJSON() {
			return {
				_type: this.type,
				meta: metaToJSON(this.meta),
				spec_version: this.specVersion,
				version: this.version,
				expires: this.expires,
				...this.unrecognizedFields
			};
		}
		static fromJSON(data) {
			let { unrecognizedFields, ...commonFields } = base_1.Signed.commonFieldsFromJSON(data), { meta, ...rest } = unrecognizedFields;
			return new Snapshot({
				...commonFields,
				meta: metaFromJSON(meta),
				unrecognizedFields: rest
			});
		}
	};
	function metaToJSON(meta) {
		return Object.entries(meta).reduce((acc, [path, metadata]) => ({
			...acc,
			[path]: metadata.toJSON()
		}), {});
	}
	function metaFromJSON(data) {
		let meta;
		if (utils_1.guard.isDefined(data)) if (utils_1.guard.isObjectRecord(data)) meta = Object.entries(data).reduce((acc, [path, metadata]) => ({
			...acc,
			[path]: file_1.MetaFile.fromJSON(metadata)
		}), {});
		else throw TypeError("meta field is malformed");
		return meta;
	}
})), require_delegations = /* @__PURE__ */ __commonJSMin(((exports) => {
	var __importDefault = exports && exports.__importDefault || function(mod) {
		return mod && mod.__esModule ? mod : { default: mod };
	};
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.Delegations = void 0;
	let util_1$4 = __importDefault(require("util")), error_1 = require_error$5(), key_1 = require_key$1(), role_1 = require_role(), utils_1 = require_utils();
	exports.Delegations = class Delegations {
		keys;
		roles;
		unrecognizedFields;
		succinctRoles;
		constructor(options) {
			if (this.keys = options.keys, this.unrecognizedFields = options.unrecognizedFields || {}, options.roles && Object.keys(options.roles).some((roleName) => role_1.TOP_LEVEL_ROLE_NAMES.includes(roleName))) throw new error_1.ValueError("Delegated role name conflicts with top-level role name");
			this.succinctRoles = options.succinctRoles, this.roles = options.roles;
		}
		equals(other) {
			return other instanceof Delegations && util_1$4.default.isDeepStrictEqual(this.keys, other.keys) && util_1$4.default.isDeepStrictEqual(this.roles, other.roles) && util_1$4.default.isDeepStrictEqual(this.unrecognizedFields, other.unrecognizedFields) && util_1$4.default.isDeepStrictEqual(this.succinctRoles, other.succinctRoles);
		}
		*rolesForTarget(targetPath) {
			if (this.roles) for (let role of Object.values(this.roles)) role.isDelegatedPath(targetPath) && (yield {
				role: role.name,
				terminating: role.terminating
			});
			else this.succinctRoles && (yield {
				role: this.succinctRoles.getRoleForTarget(targetPath),
				terminating: !0
			});
		}
		toJSON() {
			let json = {
				keys: keysToJSON(this.keys),
				...this.unrecognizedFields
			};
			return this.roles ? json.roles = rolesToJSON(this.roles) : this.succinctRoles && (json.succinct_roles = this.succinctRoles.toJSON()), json;
		}
		static fromJSON(data) {
			let { keys, roles, succinct_roles, ...unrecognizedFields } = data, succinctRoles;
			return utils_1.guard.isObject(succinct_roles) && (succinctRoles = role_1.SuccinctRoles.fromJSON(succinct_roles)), new Delegations({
				keys: keysFromJSON(keys),
				roles: rolesFromJSON(roles),
				unrecognizedFields,
				succinctRoles
			});
		}
	};
	function keysToJSON(keys) {
		return Object.entries(keys).reduce((acc, [keyId, key]) => ({
			...acc,
			[keyId]: key.toJSON()
		}), {});
	}
	function rolesToJSON(roles) {
		return Object.values(roles).map((role) => role.toJSON());
	}
	function keysFromJSON(data) {
		if (!utils_1.guard.isObjectRecord(data)) throw TypeError("keys is malformed");
		return Object.entries(data).reduce((acc, [keyID, keyData]) => ({
			...acc,
			[keyID]: key_1.Key.fromJSON(keyID, keyData)
		}), {});
	}
	function rolesFromJSON(data) {
		let roleMap;
		if (utils_1.guard.isDefined(data)) {
			if (!utils_1.guard.isObjectArray(data)) throw TypeError("roles is malformed");
			roleMap = data.reduce((acc, role) => {
				let delegatedRole = role_1.DelegatedRole.fromJSON(role);
				return {
					...acc,
					[delegatedRole.name]: delegatedRole
				};
			}, {});
		}
		return roleMap;
	}
})), require_targets = /* @__PURE__ */ __commonJSMin(((exports) => {
	var __importDefault = exports && exports.__importDefault || function(mod) {
		return mod && mod.__esModule ? mod : { default: mod };
	};
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.Targets = void 0;
	let util_1$3 = __importDefault(require("util")), base_1 = require_base(), delegations_1 = require_delegations(), file_1 = require_file(), utils_1 = require_utils();
	exports.Targets = class Targets extends base_1.Signed {
		type = base_1.MetadataKind.Targets;
		targets;
		delegations;
		constructor(options) {
			super(options), this.targets = options.targets || {}, this.delegations = options.delegations;
		}
		addTarget(target) {
			this.targets[target.path] = target;
		}
		equals(other) {
			return other instanceof Targets && super.equals(other) && util_1$3.default.isDeepStrictEqual(this.targets, other.targets) && util_1$3.default.isDeepStrictEqual(this.delegations, other.delegations);
		}
		toJSON() {
			let json = {
				_type: this.type,
				spec_version: this.specVersion,
				version: this.version,
				expires: this.expires,
				targets: targetsToJSON(this.targets),
				...this.unrecognizedFields
			};
			return this.delegations && (json.delegations = this.delegations.toJSON()), json;
		}
		static fromJSON(data) {
			let { unrecognizedFields, ...commonFields } = base_1.Signed.commonFieldsFromJSON(data), { targets, delegations, ...rest } = unrecognizedFields;
			return new Targets({
				...commonFields,
				targets: targetsFromJSON(targets),
				delegations: delegationsFromJSON(delegations),
				unrecognizedFields: rest
			});
		}
	};
	function targetsToJSON(targets) {
		return Object.entries(targets).reduce((acc, [path, target]) => ({
			...acc,
			[path]: target.toJSON()
		}), {});
	}
	function targetsFromJSON(data) {
		let targets;
		if (utils_1.guard.isDefined(data)) if (utils_1.guard.isObjectRecord(data)) targets = Object.entries(data).reduce((acc, [path, target]) => ({
			...acc,
			[path]: file_1.TargetFile.fromJSON(path, target)
		}), {});
		else throw TypeError("targets must be an object");
		return targets;
	}
	function delegationsFromJSON(data) {
		let delegations;
		if (utils_1.guard.isDefined(data)) if (utils_1.guard.isObject(data)) delegations = delegations_1.Delegations.fromJSON(data);
		else throw TypeError("delegations must be an object");
		return delegations;
	}
})), require_timestamp$2 = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.Timestamp = void 0;
	let base_1 = require_base(), file_1 = require_file(), utils_1 = require_utils();
	exports.Timestamp = class Timestamp extends base_1.Signed {
		type = base_1.MetadataKind.Timestamp;
		snapshotMeta;
		constructor(options) {
			super(options), this.snapshotMeta = options.snapshotMeta || new file_1.MetaFile({ version: 1 });
		}
		equals(other) {
			return other instanceof Timestamp && super.equals(other) && this.snapshotMeta.equals(other.snapshotMeta);
		}
		toJSON() {
			return {
				_type: this.type,
				spec_version: this.specVersion,
				version: this.version,
				expires: this.expires,
				meta: { "snapshot.json": this.snapshotMeta.toJSON() },
				...this.unrecognizedFields
			};
		}
		static fromJSON(data) {
			let { unrecognizedFields, ...commonFields } = base_1.Signed.commonFieldsFromJSON(data), { meta, ...rest } = unrecognizedFields;
			return new Timestamp({
				...commonFields,
				snapshotMeta: snapshotMetaFromJSON(meta),
				unrecognizedFields: rest
			});
		}
	};
	function snapshotMetaFromJSON(data) {
		let snapshotMeta;
		if (utils_1.guard.isDefined(data)) {
			let snapshotData = data["snapshot.json"];
			if (!utils_1.guard.isDefined(snapshotData) || !utils_1.guard.isObject(snapshotData)) throw TypeError("missing snapshot.json in meta");
			snapshotMeta = file_1.MetaFile.fromJSON(snapshotData);
		}
		return snapshotMeta;
	}
})), require_metadata = /* @__PURE__ */ __commonJSMin(((exports) => {
	var __importDefault = exports && exports.__importDefault || function(mod) {
		return mod && mod.__esModule ? mod : { default: mod };
	};
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.Metadata = void 0;
	let canonical_json_1 = require_lib$1(), util_1$2 = __importDefault(require("util")), base_1 = require_base(), error_1 = require_error$5(), root_1 = require_root(), signature_1 = require_signature(), snapshot_1 = require_snapshot(), targets_1 = require_targets(), timestamp_1 = require_timestamp$2(), utils_1 = require_utils();
	exports.Metadata = class Metadata {
		signed;
		signatures;
		unrecognizedFields;
		constructor(signed, signatures, unrecognizedFields) {
			this.signed = signed, this.signatures = signatures || {}, this.unrecognizedFields = unrecognizedFields || {};
		}
		sign(signer, append = !0) {
			let signature = signer(Buffer.from((0, canonical_json_1.canonicalize)(this.signed.toJSON())));
			append || (this.signatures = {}), this.signatures[signature.keyID] = signature;
		}
		verifyDelegate(delegatedRole, delegatedMetadata) {
			let role, keys = {};
			switch (this.signed.type) {
				case base_1.MetadataKind.Root:
					keys = this.signed.keys, role = this.signed.roles[delegatedRole];
					break;
				case base_1.MetadataKind.Targets:
					if (!this.signed.delegations) throw new error_1.ValueError(`No delegations found for ${delegatedRole}`);
					keys = this.signed.delegations.keys, this.signed.delegations.roles ? role = this.signed.delegations.roles[delegatedRole] : this.signed.delegations.succinctRoles && this.signed.delegations.succinctRoles.isDelegatedRole(delegatedRole) && (role = this.signed.delegations.succinctRoles);
					break;
				default: throw TypeError("invalid metadata type");
			}
			if (!role) throw new error_1.ValueError(`no delegation found for ${delegatedRole}`);
			let signingKeys = /* @__PURE__ */ new Set();
			if (role.keyIDs.forEach((keyID) => {
				let key = keys[keyID];
				if (key) try {
					key.verifySignature(delegatedMetadata), signingKeys.add(key.keyID);
				} catch {}
			}), signingKeys.size < role.threshold) throw new error_1.UnsignedMetadataError(`${delegatedRole} was signed by ${signingKeys.size}/${role.threshold} keys`);
		}
		equals(other) {
			return other instanceof Metadata && this.signed.equals(other.signed) && util_1$2.default.isDeepStrictEqual(this.signatures, other.signatures) && util_1$2.default.isDeepStrictEqual(this.unrecognizedFields, other.unrecognizedFields);
		}
		toJSON() {
			return {
				signatures: Object.values(this.signatures).map((signature) => signature.toJSON()),
				signed: this.signed.toJSON(),
				...this.unrecognizedFields
			};
		}
		static fromJSON(type, data) {
			let { signed, signatures, ...rest } = data;
			if (!utils_1.guard.isDefined(signed) || !utils_1.guard.isObject(signed)) throw TypeError("signed is not defined");
			if (type !== signed._type) throw new error_1.ValueError(`expected '${type}', got ${signed._type}`);
			if (!utils_1.guard.isObjectArray(signatures)) throw TypeError("signatures is not an array");
			let signedObj;
			switch (type) {
				case base_1.MetadataKind.Root:
					signedObj = root_1.Root.fromJSON(signed);
					break;
				case base_1.MetadataKind.Timestamp:
					signedObj = timestamp_1.Timestamp.fromJSON(signed);
					break;
				case base_1.MetadataKind.Snapshot:
					signedObj = snapshot_1.Snapshot.fromJSON(signed);
					break;
				case base_1.MetadataKind.Targets:
					signedObj = targets_1.Targets.fromJSON(signed);
					break;
				default: throw TypeError("invalid metadata type");
			}
			let sigMap = {};
			return signatures.forEach((sigData) => {
				let sig = signature_1.Signature.fromJSON(sigData);
				if (sigMap[sig.keyID]) throw new error_1.ValueError(`multiple signatures found for keyid: ${sig.keyID}`);
				sigMap[sig.keyID] = sig;
			}), new Metadata(signedObj, sigMap, rest);
		}
	};
})), require_dist$4 = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.Timestamp = exports.Targets = exports.Snapshot = exports.Signature = exports.Root = exports.Metadata = exports.Key = exports.TargetFile = exports.MetaFile = exports.ValueError = exports.MetadataKind = void 0;
	var base_1 = require_base();
	Object.defineProperty(exports, "MetadataKind", {
		enumerable: !0,
		get: function() {
			return base_1.MetadataKind;
		}
	});
	var error_1 = require_error$5();
	Object.defineProperty(exports, "ValueError", {
		enumerable: !0,
		get: function() {
			return error_1.ValueError;
		}
	});
	var file_1 = require_file();
	Object.defineProperty(exports, "MetaFile", {
		enumerable: !0,
		get: function() {
			return file_1.MetaFile;
		}
	}), Object.defineProperty(exports, "TargetFile", {
		enumerable: !0,
		get: function() {
			return file_1.TargetFile;
		}
	});
	var key_1 = require_key$1();
	Object.defineProperty(exports, "Key", {
		enumerable: !0,
		get: function() {
			return key_1.Key;
		}
	});
	var metadata_1 = require_metadata();
	Object.defineProperty(exports, "Metadata", {
		enumerable: !0,
		get: function() {
			return metadata_1.Metadata;
		}
	});
	var root_1 = require_root();
	Object.defineProperty(exports, "Root", {
		enumerable: !0,
		get: function() {
			return root_1.Root;
		}
	});
	var signature_1 = require_signature();
	Object.defineProperty(exports, "Signature", {
		enumerable: !0,
		get: function() {
			return signature_1.Signature;
		}
	});
	var snapshot_1 = require_snapshot();
	Object.defineProperty(exports, "Snapshot", {
		enumerable: !0,
		get: function() {
			return snapshot_1.Snapshot;
		}
	});
	var targets_1 = require_targets();
	Object.defineProperty(exports, "Targets", {
		enumerable: !0,
		get: function() {
			return targets_1.Targets;
		}
	});
	var timestamp_1 = require_timestamp$2();
	Object.defineProperty(exports, "Timestamp", {
		enumerable: !0,
		get: function() {
			return timestamp_1.Timestamp;
		}
	});
})), require_ms = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/**
	* Helpers.
	*/
	var s = 1e3, m = s * 60, h = m * 60, d = h * 24, w = d * 7, y = d * 365.25;
	/**
	* Parse or format the given `val`.
	*
	* Options:
	*
	*  - `long` verbose formatting [false]
	*
	* @param {String|Number} val
	* @param {Object} [options]
	* @throws {Error} throw an error if val is not a non-empty string or a number
	* @return {String|Number}
	* @api public
	*/
	module.exports = function(val, options) {
		options ||= {};
		var type = typeof val;
		if (type === "string" && val.length > 0) return parse(val);
		if (type === "number" && isFinite(val)) return options.long ? fmtLong(val) : fmtShort(val);
		throw Error("val is not a non-empty string or a valid number. val=" + JSON.stringify(val));
	};
	/**
	* Parse the given `str` and return milliseconds.
	*
	* @param {String} str
	* @return {Number}
	* @api private
	*/
	function parse(str) {
		if (str = String(str), !(str.length > 100)) {
			var match = /^(-?(?:\d+)?\.?\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)?$/i.exec(str);
			if (match) {
				var n = parseFloat(match[1]);
				switch ((match[2] || "ms").toLowerCase()) {
					case "years":
					case "year":
					case "yrs":
					case "yr":
					case "y": return n * y;
					case "weeks":
					case "week":
					case "w": return n * w;
					case "days":
					case "day":
					case "d": return n * d;
					case "hours":
					case "hour":
					case "hrs":
					case "hr":
					case "h": return n * h;
					case "minutes":
					case "minute":
					case "mins":
					case "min":
					case "m": return n * m;
					case "seconds":
					case "second":
					case "secs":
					case "sec":
					case "s": return n * s;
					case "milliseconds":
					case "millisecond":
					case "msecs":
					case "msec":
					case "ms": return n;
					default: return;
				}
			}
		}
	}
	/**
	* Short format for `ms`.
	*
	* @param {Number} ms
	* @return {String}
	* @api private
	*/
	function fmtShort(ms) {
		var msAbs = Math.abs(ms);
		return msAbs >= d ? Math.round(ms / d) + "d" : msAbs >= h ? Math.round(ms / h) + "h" : msAbs >= m ? Math.round(ms / m) + "m" : msAbs >= s ? Math.round(ms / s) + "s" : ms + "ms";
	}
	/**
	* Long format for `ms`.
	*
	* @param {Number} ms
	* @return {String}
	* @api private
	*/
	function fmtLong(ms) {
		var msAbs = Math.abs(ms);
		return msAbs >= d ? plural(ms, msAbs, d, "day") : msAbs >= h ? plural(ms, msAbs, h, "hour") : msAbs >= m ? plural(ms, msAbs, m, "minute") : msAbs >= s ? plural(ms, msAbs, s, "second") : ms + " ms";
	}
	/**
	* Pluralization helper.
	*/
	function plural(ms, msAbs, n, name) {
		var isPlural = msAbs >= n * 1.5;
		return Math.round(ms / n) + " " + name + (isPlural ? "s" : "");
	}
})), require_common = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/**
	* This is the common logic for both the Node.js and web browser
	* implementations of `debug()`.
	*/
	function setup(env) {
		/**
		* Map of special "%n" handling functions, for the debug "format" argument.
		*
		* Valid key names are a single, lower or upper-case letter, i.e. "n" and "N".
		*/
		createDebug.debug = createDebug, createDebug.default = createDebug, createDebug.coerce = coerce, createDebug.disable = disable, createDebug.enable = enable, createDebug.enabled = enabled, createDebug.humanize = require_ms(), createDebug.destroy = destroy, Object.keys(env).forEach((key) => {
			createDebug[key] = env[key];
		}), createDebug.names = [], createDebug.skips = [], createDebug.formatters = {};
		/**
		* Selects a color for a debug namespace
		* @param {String} namespace The namespace string for the debug instance to be colored
		* @return {Number|String} An ANSI color code for the given namespace
		* @api private
		*/
		function selectColor(namespace) {
			let hash = 0;
			for (let i = 0; i < namespace.length; i++) hash = (hash << 5) - hash + namespace.charCodeAt(i), hash |= 0;
			return createDebug.colors[Math.abs(hash) % createDebug.colors.length];
		}
		createDebug.selectColor = selectColor;
		/**
		* Create a debugger with the given `namespace`.
		*
		* @param {String} namespace
		* @return {Function}
		* @api public
		*/
		function createDebug(namespace) {
			let prevTime, enableOverride = null, namespacesCache, enabledCache;
			function debug(...args) {
				if (!debug.enabled) return;
				let self = debug, curr = Number(/* @__PURE__ */ new Date());
				self.diff = curr - (prevTime || curr), self.prev = prevTime, self.curr = curr, prevTime = curr, args[0] = createDebug.coerce(args[0]), typeof args[0] != "string" && args.unshift("%O");
				let index = 0;
				args[0] = args[0].replace(/%([a-zA-Z%])/g, (match, format) => {
					if (match === "%%") return "%";
					index++;
					let formatter = createDebug.formatters[format];
					if (typeof formatter == "function") {
						let val = args[index];
						match = formatter.call(self, val), args.splice(index, 1), index--;
					}
					return match;
				}), createDebug.formatArgs.call(self, args), (self.log || createDebug.log).apply(self, args);
			}
			return debug.namespace = namespace, debug.useColors = createDebug.useColors(), debug.color = createDebug.selectColor(namespace), debug.extend = extend, debug.destroy = createDebug.destroy, Object.defineProperty(debug, "enabled", {
				enumerable: !0,
				configurable: !1,
				get: () => enableOverride === null ? (namespacesCache !== createDebug.namespaces && (namespacesCache = createDebug.namespaces, enabledCache = createDebug.enabled(namespace)), enabledCache) : enableOverride,
				set: (v) => {
					enableOverride = v;
				}
			}), typeof createDebug.init == "function" && createDebug.init(debug), debug;
		}
		function extend(namespace, delimiter) {
			let newDebug = createDebug(this.namespace + (delimiter === void 0 ? ":" : delimiter) + namespace);
			return newDebug.log = this.log, newDebug;
		}
		/**
		* Enables a debug mode by namespaces. This can include modes
		* separated by a colon and wildcards.
		*
		* @param {String} namespaces
		* @api public
		*/
		function enable(namespaces) {
			createDebug.save(namespaces), createDebug.namespaces = namespaces, createDebug.names = [], createDebug.skips = [];
			let split = (typeof namespaces == "string" ? namespaces : "").trim().replace(/\s+/g, ",").split(",").filter(Boolean);
			for (let ns of split) ns[0] === "-" ? createDebug.skips.push(ns.slice(1)) : createDebug.names.push(ns);
		}
		/**
		* Checks if the given string matches a namespace template, honoring
		* asterisks as wildcards.
		*
		* @param {String} search
		* @param {String} template
		* @return {Boolean}
		*/
		function matchesTemplate(search, template) {
			let searchIndex = 0, templateIndex = 0, starIndex = -1, matchIndex = 0;
			for (; searchIndex < search.length;) if (templateIndex < template.length && (template[templateIndex] === search[searchIndex] || template[templateIndex] === "*")) template[templateIndex] === "*" ? (starIndex = templateIndex, matchIndex = searchIndex, templateIndex++) : (searchIndex++, templateIndex++);
			else if (starIndex !== -1) templateIndex = starIndex + 1, matchIndex++, searchIndex = matchIndex;
			else return !1;
			for (; templateIndex < template.length && template[templateIndex] === "*";) templateIndex++;
			return templateIndex === template.length;
		}
		/**
		* Disable debug output.
		*
		* @return {String} namespaces
		* @api public
		*/
		function disable() {
			let namespaces = [...createDebug.names, ...createDebug.skips.map((namespace) => "-" + namespace)].join(",");
			return createDebug.enable(""), namespaces;
		}
		/**
		* Returns true if the given mode name is enabled, false otherwise.
		*
		* @param {String} name
		* @return {Boolean}
		* @api public
		*/
		function enabled(name) {
			for (let skip of createDebug.skips) if (matchesTemplate(name, skip)) return !1;
			for (let ns of createDebug.names) if (matchesTemplate(name, ns)) return !0;
			return !1;
		}
		/**
		* Coerce `val`.
		*
		* @param {Mixed} val
		* @return {Mixed}
		* @api private
		*/
		function coerce(val) {
			return val instanceof Error ? val.stack || val.message : val;
		}
		/**
		* XXX DO NOT USE. This is a temporary stub function.
		* XXX It WILL be removed in the next major release.
		*/
		function destroy() {
			console.warn("Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`.");
		}
		return createDebug.enable(createDebug.load()), createDebug;
	}
	module.exports = setup;
})), require_browser = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/**
	* Colors.
	*/
	exports.formatArgs = formatArgs, exports.save = save, exports.load = load, exports.useColors = useColors, exports.storage = localstorage(), exports.destroy = (() => {
		let warned = !1;
		return () => {
			warned || (warned = !0, console.warn("Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`."));
		};
	})(), exports.colors = /* @__PURE__ */ "#0000CC.#0000FF.#0033CC.#0033FF.#0066CC.#0066FF.#0099CC.#0099FF.#00CC00.#00CC33.#00CC66.#00CC99.#00CCCC.#00CCFF.#3300CC.#3300FF.#3333CC.#3333FF.#3366CC.#3366FF.#3399CC.#3399FF.#33CC00.#33CC33.#33CC66.#33CC99.#33CCCC.#33CCFF.#6600CC.#6600FF.#6633CC.#6633FF.#66CC00.#66CC33.#9900CC.#9900FF.#9933CC.#9933FF.#99CC00.#99CC33.#CC0000.#CC0033.#CC0066.#CC0099.#CC00CC.#CC00FF.#CC3300.#CC3333.#CC3366.#CC3399.#CC33CC.#CC33FF.#CC6600.#CC6633.#CC9900.#CC9933.#CCCC00.#CCCC33.#FF0000.#FF0033.#FF0066.#FF0099.#FF00CC.#FF00FF.#FF3300.#FF3333.#FF3366.#FF3399.#FF33CC.#FF33FF.#FF6600.#FF6633.#FF9900.#FF9933.#FFCC00.#FFCC33".split(".");
	/**
	* Currently only WebKit-based Web Inspectors, Firefox >= v31,
	* and the Firebug extension (any Firefox version) are known
	* to support "%c" CSS customizations.
	*
	* TODO: add a `localStorage` variable to explicitly enable/disable colors
	*/
	function useColors() {
		if (typeof window < "u" && window.process && (window.process.type === "renderer" || window.process.__nwjs)) return !0;
		if (typeof navigator < "u" && navigator.userAgent && navigator.userAgent.toLowerCase().match(/(edge|trident)\/(\d+)/)) return !1;
		let m;
		return typeof document < "u" && document.documentElement && document.documentElement.style && document.documentElement.style.WebkitAppearance || typeof window < "u" && window.console && (window.console.firebug || window.console.exception && window.console.table) || typeof navigator < "u" && navigator.userAgent && (m = navigator.userAgent.toLowerCase().match(/firefox\/(\d+)/)) && parseInt(m[1], 10) >= 31 || typeof navigator < "u" && navigator.userAgent && navigator.userAgent.toLowerCase().match(/applewebkit\/(\d+)/);
	}
	/**
	* Colorize log arguments if enabled.
	*
	* @api public
	*/
	function formatArgs(args) {
		if (args[0] = (this.useColors ? "%c" : "") + this.namespace + (this.useColors ? " %c" : " ") + args[0] + (this.useColors ? "%c " : " ") + "+" + module.exports.humanize(this.diff), !this.useColors) return;
		let c = "color: " + this.color;
		args.splice(1, 0, c, "color: inherit");
		let index = 0, lastC = 0;
		args[0].replace(/%[a-zA-Z%]/g, (match) => {
			match !== "%%" && (index++, match === "%c" && (lastC = index));
		}), args.splice(lastC, 0, c);
	}
	/**
	* Invokes `console.debug()` when available.
	* No-op when `console.debug` is not a "function".
	* If `console.debug` is not available, falls back
	* to `console.log`.
	*
	* @api public
	*/
	exports.log = console.debug || console.log || (() => {});
	/**
	* Save `namespaces`.
	*
	* @param {String} namespaces
	* @api private
	*/
	function save(namespaces) {
		try {
			namespaces ? exports.storage.setItem("debug", namespaces) : exports.storage.removeItem("debug");
		} catch {}
	}
	/**
	* Load `namespaces`.
	*
	* @return {String} returns the previously persisted debug modes
	* @api private
	*/
	function load() {
		let r;
		try {
			r = exports.storage.getItem("debug") || exports.storage.getItem("DEBUG");
		} catch {}
		return !r && typeof process < "u" && "env" in process && (r = process.env.DEBUG), r;
	}
	/**
	* Localstorage attempts to return the localstorage.
	*
	* This is necessary because safari throws
	* when a user disables cookies/localstorage
	* and you attempt to access it.
	*
	* @return {LocalStorage}
	* @api private
	*/
	function localstorage() {
		try {
			return localStorage;
		} catch {}
	}
	module.exports = require_common()(exports);
	let { formatters } = module.exports;
	/**
	* Map %j to `JSON.stringify()`, since no Web Inspectors do that by default.
	*/
	formatters.j = function(v) {
		try {
			return JSON.stringify(v);
		} catch (error) {
			return "[UnexpectedJSONParseError]: " + error.message;
		}
	};
})), require_node = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/**
	* Module dependencies.
	*/
	let tty = require("tty"), util = require("util");
	/**
	* Colors.
	*/
	exports.init = init, exports.log = log, exports.formatArgs = formatArgs, exports.save = save, exports.load = load, exports.useColors = useColors, exports.destroy = util.deprecate(() => {}, "Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`."), exports.colors = [
		6,
		2,
		3,
		4,
		5,
		1
	];
	try {
		let supportsColor = require("supports-color");
		supportsColor && (supportsColor.stderr || supportsColor).level >= 2 && (exports.colors = [
			20,
			21,
			26,
			27,
			32,
			33,
			38,
			39,
			40,
			41,
			42,
			43,
			44,
			45,
			56,
			57,
			62,
			63,
			68,
			69,
			74,
			75,
			76,
			77,
			78,
			79,
			80,
			81,
			92,
			93,
			98,
			99,
			112,
			113,
			128,
			129,
			134,
			135,
			148,
			149,
			160,
			161,
			162,
			163,
			164,
			165,
			166,
			167,
			168,
			169,
			170,
			171,
			172,
			173,
			178,
			179,
			184,
			185,
			196,
			197,
			198,
			199,
			200,
			201,
			202,
			203,
			204,
			205,
			206,
			207,
			208,
			209,
			214,
			215,
			220,
			221
		]);
	} catch {}
	/**
	* Build up the default `inspectOpts` object from the environment variables.
	*
	*   $ DEBUG_COLORS=no DEBUG_DEPTH=10 DEBUG_SHOW_HIDDEN=enabled node script.js
	*/
	exports.inspectOpts = Object.keys(process.env).filter((key) => /^debug_/i.test(key)).reduce((obj, key) => {
		let prop = key.substring(6).toLowerCase().replace(/_([a-z])/g, (_, k) => k.toUpperCase()), val = process.env[key];
		return val = /^(yes|on|true|enabled)$/i.test(val) ? !0 : /^(no|off|false|disabled)$/i.test(val) ? !1 : val === "null" ? null : Number(val), obj[prop] = val, obj;
	}, {});
	/**
	* Is stdout a TTY? Colored output is enabled when `true`.
	*/
	function useColors() {
		return "colors" in exports.inspectOpts ? !!exports.inspectOpts.colors : tty.isatty(process.stderr.fd);
	}
	/**
	* Adds ANSI color escape codes if enabled.
	*
	* @api public
	*/
	function formatArgs(args) {
		let { namespace: name, useColors } = this;
		if (useColors) {
			let c = this.color, colorCode = "\x1B[3" + (c < 8 ? c : "8;5;" + c), prefix = `  ${colorCode};1m${name} \u001B[0m`;
			args[0] = prefix + args[0].split("\n").join("\n" + prefix), args.push(colorCode + "m+" + module.exports.humanize(this.diff) + "\x1B[0m");
		} else args[0] = getDate() + name + " " + args[0];
	}
	function getDate() {
		return exports.inspectOpts.hideDate ? "" : (/* @__PURE__ */ new Date()).toISOString() + " ";
	}
	/**
	* Invokes `util.formatWithOptions()` with the specified arguments and writes to stderr.
	*/
	function log(...args) {
		return process.stderr.write(util.formatWithOptions(exports.inspectOpts, ...args) + "\n");
	}
	/**
	* Save `namespaces`.
	*
	* @param {String} namespaces
	* @api private
	*/
	function save(namespaces) {
		namespaces ? process.env.DEBUG = namespaces : delete process.env.DEBUG;
	}
	/**
	* Load `namespaces`.
	*
	* @return {String} returns the previously persisted debug modes
	* @api private
	*/
	function load() {
		return process.env.DEBUG;
	}
	/**
	* Init logic for `debug` instances.
	*
	* Create a new `inspectOpts` object in case `useColors` is set
	* differently for a particular `debug` instance.
	*/
	function init(debug) {
		debug.inspectOpts = {};
		let keys = Object.keys(exports.inspectOpts);
		for (let i = 0; i < keys.length; i++) debug.inspectOpts[keys[i]] = exports.inspectOpts[keys[i]];
	}
	module.exports = require_common()(exports);
	let { formatters } = module.exports;
	/**
	* Map %O to `util.inspect()`, allowing multiple lines if needed.
	*/
	formatters.o = function(v) {
		return this.inspectOpts.colors = this.useColors, util.inspect(v, this.inspectOpts).split("\n").map((str) => str.trim()).join(" ");
	}, formatters.O = function(v) {
		return this.inspectOpts.colors = this.useColors, util.inspect(v, this.inspectOpts);
	};
})), require_src = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/**
	* Detect Electron renderer / nwjs process, which is node, but we should
	* treat as a browser.
	*/
	typeof process > "u" || process.type === "renderer" || process.browser === !0 || process.__nwjs ? module.exports = require_browser() : module.exports = require_node();
})), require_error$4 = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.DownloadHTTPError = exports.DownloadLengthMismatchError = exports.DownloadError = exports.ExpiredMetadataError = exports.EqualVersionError = exports.BadVersionError = exports.RepositoryError = exports.PersistError = exports.RuntimeError = exports.ValueError = void 0, exports.ValueError = class extends Error {}, exports.RuntimeError = class extends Error {}, exports.PersistError = class extends Error {};
	var RepositoryError = class extends Error {};
	exports.RepositoryError = RepositoryError;
	var BadVersionError = class extends RepositoryError {};
	exports.BadVersionError = BadVersionError, exports.EqualVersionError = class extends BadVersionError {}, exports.ExpiredMetadataError = class extends RepositoryError {};
	var DownloadError = class extends Error {};
	exports.DownloadError = DownloadError, exports.DownloadLengthMismatchError = class extends DownloadError {}, exports.DownloadHTTPError = class extends DownloadError {
		statusCode;
		constructor(message, statusCode) {
			super(message), this.statusCode = statusCode;
		}
	};
})), require_tmpfile = /* @__PURE__ */ __commonJSMin(((exports) => {
	var __importDefault = exports && exports.__importDefault || function(mod) {
		return mod && mod.__esModule ? mod : { default: mod };
	};
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.withTempFile = void 0;
	let promises_1 = __importDefault(require("fs/promises")), os_1 = __importDefault(require("os")), path_1$1 = __importDefault(require("path"));
	exports.withTempFile = async (handler) => withTempDir(async (dir) => handler(path_1$1.default.join(dir, "tempfile")));
	let withTempDir = async (handler) => {
		let tmpDir = await promises_1.default.realpath(os_1.default.tmpdir()), dir = await promises_1.default.mkdtemp(tmpDir + path_1$1.default.sep);
		try {
			return await handler(dir);
		} finally {
			await promises_1.default.rm(dir, {
				force: !0,
				recursive: !0,
				maxRetries: 3
			});
		}
	};
})), require_retry = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	module.exports = { RetryOperation: class {
		#attempts = 1;
		#cachedTimeouts = null;
		#errors = [];
		#fn = null;
		#maxRetryTime;
		#operationStart = null;
		#originalTimeouts;
		#timeouts;
		#timer = null;
		#unref;
		constructor(timeouts, options = {}) {
			this.#originalTimeouts = [...timeouts], this.#timeouts = [...timeouts], this.#unref = options.unref, this.#maxRetryTime = options.maxRetryTime || Infinity, options.forever && (this.#cachedTimeouts = [...this.#timeouts]);
		}
		get timeouts() {
			return [...this.#timeouts];
		}
		get errors() {
			return [...this.#errors];
		}
		get attempts() {
			return this.#attempts;
		}
		get mainError() {
			let mainError = null;
			if (this.#errors.length) {
				let mainErrorCount = 0, counts = {};
				for (let i = 0; i < this.#errors.length; i++) {
					let error = this.#errors[i], { message } = error;
					counts[message] || (counts[message] = 0), counts[message]++, counts[message] >= mainErrorCount && (mainError = error, mainErrorCount = counts[message]);
				}
			}
			return mainError;
		}
		reset() {
			this.#attempts = 1, this.#timeouts = [...this.#originalTimeouts];
		}
		stop() {
			this.#timer && clearTimeout(this.#timer), this.#timeouts = [], this.#cachedTimeouts = null;
		}
		retry(err) {
			if (this.#errors.push(err), (/* @__PURE__ */ new Date()).getTime() - this.#operationStart >= this.#maxRetryTime) return this.#errors.unshift(/* @__PURE__ */ Error("RetryOperation timeout occurred")), !1;
			let timeout = this.#timeouts.shift();
			if (timeout === void 0) if (this.#cachedTimeouts) this.#errors.pop(), timeout = this.#cachedTimeouts.at(-1);
			else return !1;
			return this.#timer = setTimeout(() => {
				this.#attempts++, this.#fn(this.#attempts);
			}, timeout), this.#unref && this.#timer.unref(), !0;
		}
		attempt(fn) {
			this.#fn = fn, this.#operationStart = (/* @__PURE__ */ new Date()).getTime(), this.#fn(this.#attempts);
		}
	} };
})), require_lib = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	let { RetryOperation } = require_retry(), createTimeout = (attempt, opts) => Math.min(Math.round((1 + (opts.randomize ? Math.random() : 0)) * Math.max(opts.minTimeout, 1) * opts.factor ** +attempt), opts.maxTimeout), isRetryError = (err) => err?.code === "EPROMISERETRY" && Object.hasOwn(err, "retried");
	module.exports = { promiseRetry: async (fn, options = {}) => {
		let timeouts = [];
		if (options instanceof Array) timeouts = [...options];
		else {
			options.retries === Infinity && (options.forever = !0, delete options.retries);
			let opts = {
				retries: 10,
				factor: 2,
				minTimeout: 1 * 1e3,
				maxTimeout: Infinity,
				randomize: !1,
				...options
			};
			if (opts.minTimeout > opts.maxTimeout) throw Error("minTimeout is greater than maxTimeout");
			if (opts.retries) {
				for (let i = 0; i < opts.retries; i++) timeouts.push(createTimeout(i, opts));
				timeouts.sort((a, b) => a - b);
			} else options.forever && timeouts.push(createTimeout(0, opts));
		}
		let operation = new RetryOperation(timeouts, {
			forever: options.forever,
			unref: options.unref,
			maxRetryTime: options.maxRetryTime
		});
		return new Promise(function(resolve, reject) {
			operation.attempt(async (number) => {
				try {
					return resolve(await fn((err) => {
						throw Object.assign(/* @__PURE__ */ Error("Retrying"), {
							code: "EPROMISERETRY",
							retried: err
						});
					}, number, operation));
				} catch (err) {
					if (!isRetryError(err)) return reject(err);
					if (!operation.retry(err.retried || /* @__PURE__ */ Error())) return reject(err.retried);
				}
			});
		});
	} };
})), require_fetcher = /* @__PURE__ */ __commonJSMin(((exports) => {
	var __importDefault = exports && exports.__importDefault || function(mod) {
		return mod && mod.__esModule ? mod : { default: mod };
	};
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.DefaultFetcher = exports.BaseFetcher = void 0;
	let debug_1 = __importDefault(require_src()), fs_1$2 = __importDefault(require("fs")), util_1$1 = __importDefault(require("util")), error_1 = require_error$4(), tmpfile_1 = require_tmpfile(), promise_retry_1 = require_lib(), log = (0, debug_1.default)("tuf:fetch");
	var BaseFetcher = class {
		async downloadFile(url, maxLength, handler) {
			return (0, tmpfile_1.withTempFile)(async (tmpFile) => {
				let reader = await this.fetch(url), numberOfBytesReceived = 0, fileStream = fs_1$2.default.createWriteStream(tmpFile), streamReader = reader.getReader();
				try {
					for (;;) {
						let { done, value: chunk } = await streamReader.read();
						if (done) break;
						if (numberOfBytesReceived += chunk.length, numberOfBytesReceived > maxLength) throw new error_1.DownloadLengthMismatchError("Max length reached");
						await writeBufferToStream(fileStream, Buffer.from(chunk));
					}
				} finally {
					streamReader.releaseLock(), await util_1$1.default.promisify(fileStream.close).bind(fileStream)();
				}
				return handler(tmpFile);
			});
		}
		async downloadBytes(url, maxLength) {
			return this.downloadFile(url, maxLength, async (file) => {
				let stream = fs_1$2.default.createReadStream(file), chunks = [];
				for await (let chunk of stream) chunks.push(chunk);
				return Buffer.concat(chunks);
			});
		}
	};
	exports.BaseFetcher = BaseFetcher, exports.DefaultFetcher = class extends BaseFetcher {
		userAgent;
		timeout;
		retry;
		constructor(options = {}) {
			if (super(), this.userAgent = options.userAgent, this.timeout = options.timeout, options.retry === !0) this.retry = { forever: !0 };
			else if (options.retry === !1 || options.retry === void 0) this.retry = void 0;
			else if (typeof options.retry == "number") {
				if (options.retry < 0) throw Error("Retry count must be non-negative number");
				this.retry = { retries: options.retry };
			} else this.retry = options.retry;
		}
		async fetch(url) {
			let shouldRetry = this.retry !== void 0;
			return (0, promise_retry_1.promiseRetry)(async (retry, number) => {
				log("GET %s (attempt %d)", url, number);
				let response;
				try {
					response = await fetch(url, {
						headers: { "User-Agent": this.userAgent || "" },
						signal: this.timeout ? AbortSignal.timeout(this.timeout) : void 0
					});
				} catch (error) {
					let err = error instanceof Error ? error : Error(String(error));
					if (shouldRetry) return retry(err);
					throw err;
				}
				if (!response.ok || !response.body) {
					let err = new error_1.DownloadHTTPError("Failed to download", response.status);
					if (shouldRetry && response.status >= 500 && response.status < 600) return retry(err);
					throw err;
				}
				return response.body;
			}, this.retry);
		}
	};
	let writeBufferToStream = async (stream, buffer) => new Promise((resolve, reject) => {
		stream.write(buffer, (err) => {
			err && reject(err), resolve(!0);
		});
	});
})), require_package$1 = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	module.exports = {
		name: "tuf-js",
		version: "6.0.0",
		description: "JavaScript implementation of The Update Framework (TUF)",
		main: "dist/index.js",
		types: "dist/index.d.ts",
		scripts: {
			build: "tsc --build tsconfig.build.json",
			clean: "rm -rf dist && rm tsconfig.build.tsbuildinfo",
			test: "jest"
		},
		repository: {
			type: "git",
			url: "git+https://github.com/theupdateframework/tuf-js.git"
		},
		files: ["dist"],
		keywords: [
			"tuf",
			"security",
			"update"
		],
		author: "bdehamer@github.com",
		license: "MIT",
		bugs: { url: "https://github.com/theupdateframework/tuf-js/issues" },
		homepage: "https://github.com/theupdateframework/tuf-js/tree/main/packages/client#readme",
		devDependencies: {
			"@tufjs/repo-mock": "5.0.0",
			"@types/debug": "^4.1.13",
			"@types/retry": "^0.12.5"
		},
		dependencies: {
			"@gar/promise-retry": "^1.0.3",
			"@tufjs/models": "5.0.0",
			debug: "^4.4.3"
		},
		engines: { node: "^22.22.2 || ^24.15.0 || >=26.0.0" }
	};
})), require_config = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.defaultConfig = void 0, exports.defaultConfig = {
		maxRootRotations: 256,
		maxDelegations: 32,
		rootMaxLength: 512e3,
		timestampMaxLength: 16384,
		snapshotMaxLength: 2e6,
		targetsMaxLength: 5e6,
		prefixTargetsWithHash: !0,
		fetchTimeout: 1e5,
		fetchRetries: void 0,
		fetchRetry: 2,
		userAgent: ""
	};
})), require_store = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.TrustedMetadataStore = void 0;
	let models_1 = require_dist$4(), error_1 = require_error$4();
	exports.TrustedMetadataStore = class {
		trustedSet = {};
		referenceTime;
		constructor(rootData) {
			this.referenceTime = /* @__PURE__ */ new Date(), this.loadTrustedRoot(rootData);
		}
		get root() {
			if (!this.trustedSet.root) throw ReferenceError("No trusted root metadata");
			return this.trustedSet.root;
		}
		get timestamp() {
			return this.trustedSet.timestamp;
		}
		get snapshot() {
			return this.trustedSet.snapshot;
		}
		get targets() {
			return this.trustedSet.targets;
		}
		getRole(name) {
			return this.trustedSet[name];
		}
		updateRoot(bytesBuffer) {
			let data = JSON.parse(bytesBuffer.toString("utf8")), newRoot = models_1.Metadata.fromJSON(models_1.MetadataKind.Root, data);
			if (newRoot.signed.type != models_1.MetadataKind.Root) throw new error_1.RepositoryError(`Expected 'root', got ${newRoot.signed.type}`);
			if (this.root.verifyDelegate(models_1.MetadataKind.Root, newRoot), newRoot.signed.version != this.root.signed.version + 1) throw new error_1.BadVersionError(`Expected version ${this.root.signed.version + 1}, got ${newRoot.signed.version}`);
			return newRoot.verifyDelegate(models_1.MetadataKind.Root, newRoot), this.trustedSet.root = newRoot, newRoot;
		}
		updateTimestamp(bytesBuffer) {
			if (this.snapshot) throw new error_1.RuntimeError("Cannot update timestamp after snapshot");
			if (this.root.signed.isExpired(this.referenceTime)) throw new error_1.ExpiredMetadataError("Final root.json is expired");
			let data = JSON.parse(bytesBuffer.toString("utf8")), newTimestamp = models_1.Metadata.fromJSON(models_1.MetadataKind.Timestamp, data);
			if (newTimestamp.signed.type != models_1.MetadataKind.Timestamp) throw new error_1.RepositoryError(`Expected 'timestamp', got ${newTimestamp.signed.type}`);
			if (this.root.verifyDelegate(models_1.MetadataKind.Timestamp, newTimestamp), this.timestamp) {
				if (newTimestamp.signed.version < this.timestamp.signed.version) throw new error_1.BadVersionError(`New timestamp version ${newTimestamp.signed.version} is less than current version ${this.timestamp.signed.version}`);
				if (newTimestamp.signed.version === this.timestamp.signed.version) throw new error_1.EqualVersionError(`New timestamp version ${newTimestamp.signed.version} is equal to current version ${this.timestamp.signed.version}`);
				let snapshotMeta = this.timestamp.signed.snapshotMeta, newSnapshotMeta = newTimestamp.signed.snapshotMeta;
				if (newSnapshotMeta.version < snapshotMeta.version) throw new error_1.BadVersionError(`New snapshot version ${newSnapshotMeta.version} is less than current version ${snapshotMeta.version}`);
			}
			return this.trustedSet.timestamp = newTimestamp, this.checkFinalTimestamp(), newTimestamp;
		}
		updateSnapshot(bytesBuffer, trusted = !1) {
			if (!this.timestamp) throw new error_1.RuntimeError("Cannot update snapshot before timestamp");
			if (this.targets) throw new error_1.RuntimeError("Cannot update snapshot after targets");
			this.checkFinalTimestamp();
			let snapshotMeta = this.timestamp.signed.snapshotMeta;
			trusted || snapshotMeta.verify(bytesBuffer);
			let data = JSON.parse(bytesBuffer.toString("utf8")), newSnapshot = models_1.Metadata.fromJSON(models_1.MetadataKind.Snapshot, data);
			if (newSnapshot.signed.type != models_1.MetadataKind.Snapshot) throw new error_1.RepositoryError(`Expected 'snapshot', got ${newSnapshot.signed.type}`);
			return this.root.verifyDelegate(models_1.MetadataKind.Snapshot, newSnapshot), this.snapshot && Object.entries(this.snapshot.signed.meta).forEach(([fileName, fileInfo]) => {
				let newFileInfo = newSnapshot.signed.meta[fileName];
				if (!newFileInfo) throw new error_1.RepositoryError(`Missing file ${fileName} in new snapshot`);
				if (newFileInfo.version < fileInfo.version) throw new error_1.BadVersionError(`New version ${newFileInfo.version} of ${fileName} is less than current version ${fileInfo.version}`);
			}), this.trustedSet.snapshot = newSnapshot, this.checkFinalSnapsnot(), newSnapshot;
		}
		updateDelegatedTargets(bytesBuffer, roleName, delegatorName) {
			if (!this.snapshot) throw new error_1.RuntimeError("Cannot update delegated targets before snapshot");
			this.checkFinalSnapsnot();
			let delegator = this.trustedSet[delegatorName];
			if (!delegator) throw new error_1.RuntimeError(`No trusted ${delegatorName} metadata`);
			let meta = this.snapshot.signed.meta?.[`${roleName}.json`];
			if (!meta) throw new error_1.RepositoryError(`Missing ${roleName}.json in snapshot`);
			meta.verify(bytesBuffer);
			let data = JSON.parse(bytesBuffer.toString("utf8")), newDelegate = models_1.Metadata.fromJSON(models_1.MetadataKind.Targets, data);
			if (newDelegate.signed.type != models_1.MetadataKind.Targets) throw new error_1.RepositoryError(`Expected 'targets', got ${newDelegate.signed.type}`);
			delegator.verifyDelegate(roleName, newDelegate);
			let version = newDelegate.signed.version;
			if (version != meta.version) throw new error_1.BadVersionError(`Version ${version} of ${roleName} does not match snapshot version ${meta.version}`);
			if (newDelegate.signed.isExpired(this.referenceTime)) throw new error_1.ExpiredMetadataError(`${roleName}.json is expired`);
			this.trustedSet[roleName] = newDelegate;
		}
		loadTrustedRoot(bytesBuffer) {
			let data = JSON.parse(bytesBuffer.toString("utf8")), root = models_1.Metadata.fromJSON(models_1.MetadataKind.Root, data);
			if (root.signed.type != models_1.MetadataKind.Root) throw new error_1.RepositoryError(`Expected 'root', got ${root.signed.type}`);
			root.verifyDelegate(models_1.MetadataKind.Root, root), this.trustedSet.root = root;
		}
		checkFinalTimestamp() {
			if (!this.timestamp) throw ReferenceError("No trusted timestamp metadata");
			if (this.timestamp.signed.isExpired(this.referenceTime)) throw new error_1.ExpiredMetadataError("Final timestamp.json is expired");
		}
		checkFinalSnapsnot() {
			if (!this.snapshot) throw ReferenceError("No trusted snapshot metadata");
			if (!this.timestamp) throw ReferenceError("No trusted timestamp metadata");
			if (this.snapshot.signed.isExpired(this.referenceTime)) throw new error_1.ExpiredMetadataError("snapshot.json is expired");
			let snapshotMeta = this.timestamp.signed.snapshotMeta;
			if (this.snapshot.signed.version !== snapshotMeta.version) throw new error_1.BadVersionError("Snapshot version doesn't match timestamp");
		}
	};
})), require_url = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.join = join;
	let url_1 = require("url");
	function join(base, path) {
		return new url_1.URL(ensureTrailingSlash(base) + removeLeadingSlash(path)).toString();
	}
	function ensureTrailingSlash(path) {
		return path.endsWith("/") ? path : path + "/";
	}
	function removeLeadingSlash(path) {
		return path.startsWith("/") ? path.slice(1) : path;
	}
})), require_updater = /* @__PURE__ */ __commonJSMin(((exports) => {
	var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
		k2 === void 0 && (k2 = k);
		var desc = Object.getOwnPropertyDescriptor(m, k);
		(!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) && (desc = {
			enumerable: !0,
			get: function() {
				return m[k];
			}
		}), Object.defineProperty(o, k2, desc);
	}) : (function(o, m, k, k2) {
		k2 === void 0 && (k2 = k), o[k2] = m[k];
	})), __setModuleDefault = exports && exports.__setModuleDefault || (Object.create ? (function(o, v) {
		Object.defineProperty(o, "default", {
			enumerable: !0,
			value: v
		});
	}) : function(o, v) {
		o.default = v;
	}), __importStar = exports && exports.__importStar || (function() {
		var ownKeys = function(o) {
			return ownKeys = Object.getOwnPropertyNames || function(o) {
				var ar = [];
				for (var k in o) Object.prototype.hasOwnProperty.call(o, k) && (ar[ar.length] = k);
				return ar;
			}, ownKeys(o);
		};
		return function(mod) {
			if (mod && mod.__esModule) return mod;
			var result = {};
			if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) k[i] !== "default" && __createBinding(result, mod, k[i]);
			return __setModuleDefault(result, mod), result;
		};
	})(), __importDefault = exports && exports.__importDefault || function(mod) {
		return mod && mod.__esModule ? mod : { default: mod };
	};
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.Updater = void 0;
	let models_1 = require_dist$4(), debug_1 = __importDefault(require_src()), fs = __importStar(require("fs")), path = __importStar(require("path")), package_json_1 = require_package$1(), config_1 = require_config(), error_1 = require_error$4(), fetcher_1 = require_fetcher(), store_1 = require_store(), url = __importStar(require_url()), log = (0, debug_1.default)("tuf:cache");
	exports.Updater = class {
		dir;
		metadataBaseUrl;
		targetDir;
		targetBaseUrl;
		forceCache;
		trustedSet;
		config;
		fetcher;
		constructor(options) {
			let { metadataDir, metadataBaseUrl, targetDir, targetBaseUrl, fetcher, config } = options;
			this.dir = metadataDir, this.metadataBaseUrl = metadataBaseUrl, this.targetDir = targetDir, this.targetBaseUrl = targetBaseUrl, this.forceCache = options.forceCache ?? !1;
			let data = this.loadLocalMetadata(models_1.MetadataKind.Root);
			this.trustedSet = new store_1.TrustedMetadataStore(data), this.config = {
				...config_1.defaultConfig,
				...config
			};
			let userAgent = config?.userAgent ? `${config.userAgent} tuf-js/${package_json_1.version}` : `tuf-js/${package_json_1.version}`;
			this.fetcher = fetcher || new fetcher_1.DefaultFetcher({
				userAgent,
				timeout: this.config.fetchTimeout,
				retry: this.config.fetchRetries ?? this.config.fetchRetry
			});
		}
		async refresh() {
			if (this.forceCache) try {
				await this.loadTimestamp({ checkRemote: !1 });
			} catch {
				await this.loadRoot(), await this.loadTimestamp();
			}
			else await this.loadRoot(), await this.loadTimestamp();
			await this.loadSnapshot(), await this.loadTargets(models_1.MetadataKind.Targets, models_1.MetadataKind.Root);
		}
		async getTargetInfo(targetPath) {
			return this.trustedSet.targets || await this.refresh(), this.preorderDepthFirstWalk(targetPath);
		}
		async downloadTarget(targetInfo, filePath, targetBaseUrl) {
			let targetPath = filePath || this.generateTargetPath(targetInfo);
			if (!targetBaseUrl) {
				if (!this.targetBaseUrl) throw new error_1.ValueError("Target base URL not set");
				targetBaseUrl = this.targetBaseUrl;
			}
			let targetFilePath = targetInfo.path;
			if (this.trustedSet.root.signed.consistentSnapshot && this.config.prefixTargetsWithHash) {
				let hashes = Object.values(targetInfo.hashes), { dir, base } = path.parse(targetFilePath), filename = `${hashes[0]}.${base}`;
				targetFilePath = dir ? `${dir}/${filename}` : filename;
			}
			let targetUrl = url.join(targetBaseUrl, targetFilePath);
			return await this.fetcher.downloadFile(targetUrl, targetInfo.length, async (fileName) => {
				await targetInfo.verify(fs.createReadStream(fileName)), log("WRITE %s", targetPath), fs.copyFileSync(fileName, targetPath);
			}), targetPath;
		}
		async findCachedTarget(targetInfo, filePath) {
			filePath ||= this.generateTargetPath(targetInfo);
			try {
				if (fs.existsSync(filePath)) return await targetInfo.verify(fs.createReadStream(filePath)), filePath;
			} catch {
				return;
			}
		}
		loadLocalMetadata(fileName) {
			let filePath = path.join(this.dir, `${fileName}.json`);
			return log("READ %s", filePath), fs.readFileSync(filePath);
		}
		async loadRoot() {
			let lowerBound = this.trustedSet.root.signed.version + 1, upperBound = lowerBound + this.config.maxRootRotations;
			for (let version = lowerBound; version < upperBound; version++) {
				let rootUrl = url.join(this.metadataBaseUrl, `${version}.root.json`);
				try {
					let bytesData = await this.fetcher.downloadBytes(rootUrl, this.config.rootMaxLength);
					this.trustedSet.updateRoot(bytesData), this.persistMetadata(models_1.MetadataKind.Root, bytesData);
				} catch (error) {
					if (error instanceof error_1.DownloadHTTPError && [403, 404].includes(error.statusCode)) break;
					throw error;
				}
			}
		}
		async loadTimestamp({ checkRemote } = { checkRemote: !0 }) {
			try {
				let data = this.loadLocalMetadata(models_1.MetadataKind.Timestamp);
				if (this.trustedSet.updateTimestamp(data), !checkRemote) return;
			} catch {}
			let timestampUrl = url.join(this.metadataBaseUrl, "timestamp.json"), bytesData = await this.fetcher.downloadBytes(timestampUrl, this.config.timestampMaxLength);
			try {
				this.trustedSet.updateTimestamp(bytesData);
			} catch (error) {
				if (error instanceof error_1.EqualVersionError) return;
				throw error;
			}
			this.persistMetadata(models_1.MetadataKind.Timestamp, bytesData);
		}
		async loadSnapshot() {
			try {
				let data = this.loadLocalMetadata(models_1.MetadataKind.Snapshot);
				this.trustedSet.updateSnapshot(data, !0);
			} catch (error) {
				if (!this.trustedSet.timestamp) throw ReferenceError("No timestamp metadata", { cause: error });
				let snapshotMeta = this.trustedSet.timestamp.signed.snapshotMeta, maxLength = snapshotMeta.length || this.config.snapshotMaxLength, version = this.trustedSet.root.signed.consistentSnapshot ? snapshotMeta.version : void 0, snapshotUrl = url.join(this.metadataBaseUrl, version ? `${version}.snapshot.json` : "snapshot.json");
				try {
					let bytesData = await this.fetcher.downloadBytes(snapshotUrl, maxLength);
					this.trustedSet.updateSnapshot(bytesData), this.persistMetadata(models_1.MetadataKind.Snapshot, bytesData);
				} catch (error) {
					throw new error_1.RuntimeError(`Unable to load snapshot metadata error ${error}`);
				}
			}
		}
		async loadTargets(role, parentRole) {
			if (this.trustedSet.getRole(role)) return this.trustedSet.getRole(role);
			try {
				let buffer = this.loadLocalMetadata(role);
				this.trustedSet.updateDelegatedTargets(buffer, role, parentRole);
			} catch (error) {
				if (!this.trustedSet.snapshot) throw ReferenceError("No snapshot metadata", { cause: error });
				let metaInfo = this.trustedSet.snapshot.signed.meta[`${role}.json`], maxLength = metaInfo.length || this.config.targetsMaxLength, version = this.trustedSet.root.signed.consistentSnapshot ? metaInfo.version : void 0, encodedRole = encodeURIComponent(role), metadataUrl = url.join(this.metadataBaseUrl, version ? `${version}.${encodedRole}.json` : `${encodedRole}.json`);
				try {
					let bytesData = await this.fetcher.downloadBytes(metadataUrl, maxLength);
					this.trustedSet.updateDelegatedTargets(bytesData, role, parentRole), this.persistMetadata(role, bytesData);
				} catch (error) {
					throw new error_1.RuntimeError(`Unable to load targets error ${error}`);
				}
			}
			return this.trustedSet.getRole(role);
		}
		async preorderDepthFirstWalk(targetPath) {
			let delegationsToVisit = [{
				roleName: models_1.MetadataKind.Targets,
				parentRoleName: models_1.MetadataKind.Root
			}], visitedRoleNames = /* @__PURE__ */ new Set();
			for (; visitedRoleNames.size <= this.config.maxDelegations && delegationsToVisit.length > 0;) {
				let { roleName, parentRoleName } = delegationsToVisit.pop();
				if (visitedRoleNames.has(roleName)) continue;
				let targets = (await this.loadTargets(roleName, parentRoleName))?.signed;
				if (!targets) continue;
				let target = targets.targets?.[targetPath];
				if (target) return target;
				if (visitedRoleNames.add(roleName), targets.delegations) {
					let childRolesToVisit = [], rolesForTarget = targets.delegations.rolesForTarget(targetPath);
					for (let { role: childName, terminating } of rolesForTarget) if (childRolesToVisit.push({
						roleName: childName,
						parentRoleName: roleName
					}), terminating) {
						delegationsToVisit.splice(0);
						break;
					}
					childRolesToVisit.reverse(), delegationsToVisit.push(...childRolesToVisit);
				}
			}
		}
		generateTargetPath(targetInfo) {
			if (!this.targetDir) throw new error_1.ValueError("Target directory not set");
			let filePath = encodeURIComponent(targetInfo.path);
			return path.join(this.targetDir, filePath);
		}
		persistMetadata(metaDataName, bytesData) {
			let encodedName = encodeURIComponent(metaDataName);
			try {
				let filePath = path.join(this.dir, `${encodedName}.json`);
				log("WRITE %s", filePath), fs.writeFileSync(filePath, bytesData.toString("utf8"));
			} catch (error) {
				throw new error_1.PersistError(`Failed to persist metadata ${encodedName} error: ${error}`);
			}
		}
	};
})), require_dist$3 = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.Updater = exports.BaseFetcher = exports.TargetFile = void 0;
	var models_1 = require_dist$4();
	Object.defineProperty(exports, "TargetFile", {
		enumerable: !0,
		get: function() {
			return models_1.TargetFile;
		}
	});
	var fetcher_1 = require_fetcher();
	Object.defineProperty(exports, "BaseFetcher", {
		enumerable: !0,
		get: function() {
			return fetcher_1.BaseFetcher;
		}
	});
	var updater_1 = require_updater();
	Object.defineProperty(exports, "Updater", {
		enumerable: !0,
		get: function() {
			return updater_1.Updater;
		}
	});
})), require_package = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	module.exports = {
		name: "@sigstore/tuf",
		version: "5.0.0",
		description: "Client for the Sigstore TUF repository",
		main: "dist/index.js",
		types: "dist/index.d.ts",
		scripts: {
			clean: "shx rm -rf dist *.tsbuildinfo",
			build: "tsc --build",
			test: "jest"
		},
		files: ["dist", "seeds.json"],
		author: "bdehamer@github.com",
		license: "Apache-2.0",
		repository: {
			type: "git",
			url: "git+https://github.com/sigstore/sigstore-js.git"
		},
		bugs: { url: "https://github.com/sigstore/sigstore-js/issues" },
		homepage: "https://github.com/sigstore/sigstore-js/tree/main/packages/tuf#readme",
		publishConfig: { provenance: !0 },
		devDependencies: {
			"@sigstore/jest": "^0.0.0",
			"@tufjs/repo-mock": "^5.0.0",
			"@types/make-fetch-happen": "^10.0.4"
		},
		dependencies: {
			"@sigstore/protobuf-specs": "^0.5.0",
			"tuf-js": "^6.0.0"
		},
		engines: { node: "^22.22.2 || ^24.15.0 || >=26.0.0" }
	};
})), require_error$3 = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.TUFError = void 0, exports.TUFError = class extends Error {
		code;
		cause;
		constructor({ code, message, cause }) {
			super(message), this.code = code, this.cause = cause, this.name = this.constructor.name;
		}
	};
})), require_target = /* @__PURE__ */ __commonJSMin(((exports) => {
	var __importDefault = exports && exports.__importDefault || function(mod) {
		return mod && mod.__esModule ? mod : { default: mod };
	};
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.readTarget = readTarget;
	let fs_1$1 = __importDefault(require("fs")), error_1 = require_error$3();
	async function readTarget(tuf, targetPath) {
		let path = await getTargetPath(tuf, targetPath);
		return new Promise((resolve, reject) => {
			fs_1$1.default.readFile(path, "utf-8", (err, data) => {
				err ? reject(new error_1.TUFError({
					code: "TUF_READ_TARGET_ERROR",
					message: `error reading target ${path}`,
					cause: err
				})) : resolve(data);
			});
		});
	}
	async function getTargetPath(tuf, target) {
		let targetInfo;
		try {
			targetInfo = await tuf.getTargetInfo(target);
		} catch (err) {
			throw new error_1.TUFError({
				code: "TUF_REFRESH_METADATA_ERROR",
				message: "error refreshing TUF metadata",
				cause: err
			});
		}
		if (!targetInfo) throw new error_1.TUFError({
			code: "TUF_FIND_TARGET_ERROR",
			message: `target ${target} not found`
		});
		let path = await tuf.findCachedTarget(targetInfo);
		if (!path) try {
			path = await tuf.downloadTarget(targetInfo);
		} catch (err) {
			throw new error_1.TUFError({
				code: "TUF_DOWNLOAD_TARGET_ERROR",
				message: `error downloading target ${path}`,
				cause: err
			});
		}
		return path;
	}
})), require_seeds = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	module.exports = { "https://tuf-repo-cdn.sigstore.dev": {
		"root.json": "ewogInNpZ25hdHVyZXMiOiBbCiAgewogICAia2V5aWQiOiAiZTcxYTU0ZDU0MzgzNWJhODZhZGFkOTQ2MDM3OWM3NjQxZmI4NzI2ZDE2NGVhNzY2ODAxYTFjNTIyYWJhN2VhMiIsCiAgICJzaWciOiAiMzA0NTAyMjEwMGVhMmYzNzRmNDA5ODEwZTJkYjk1MDc0OWQ5Y2ZlZDA5YTE1YjZhNWUyNWYzZDVmZmQwNzk5NDU5ZDdiZWUxNjcwMjIwMjhkM2FjZGRlNmRiZDUwMzRjZmFkMjIyZDMxYjQxMDkwZWUyMTg5NGUyYzQ2Y2I4OTc0MTk4YWIwMzc3ZGI0NCIKICB9LAogIHsKICAgImtleWlkIjogIjIyZjRjYWVjNmQ4ZTZmOTU1NWFmNjZiM2Q0YzNjYjA2YTNiYjIzZmRjN2UzOWM5MTZjNjFmNDYyZTZmNTJiMDYiLAogICAic2lnIjogIjMwNDQwMjIwN2ViYjI0ZTMyMzdlNDcwNjkxZDc4NzU5MDNhNzc1NGQwZWYyYWU3ZTdiNTAyNGE3ODg4YzlhMzhhNTJkZWVjZDAyMjA2ZWQ1YWQxYzZmNGZhYjQ2OTk1ODQzYWI2YjIzZjk0MjBjNWE0Y2Y2Y2UxY2IyY2IyYTZmYzJlODdlMmVmM2UxIgogIH0sCiAgewogICAia2V5aWQiOiAiNjE2NDM4MzgxMjViNDQwYjQwZGI2OTQyZjVjYjVhMzFjMGRjMDQzNjgzMTZlYjJhYWE1OGI5NTkwNGE1ODIyMiIsCiAgICJzaWciOiAiMzA0NjAyMjEwMDg5ZDlkZmQ4ZTEwNmNjOTU4MDg4YTRkYTNjOGNmNzI1NGFiNmY2NWE5NjQ3ZDM3YWRhNzMwZWY0NzYzYzUxNjMwMjIxMDBkODgyZWU3NDQ2MTViZTc5ODYxZTIxNGUxZWViOWUxZWRkZjZhMWUyMDNhMjAxYjRjNWQwM2Y1MjI0ZDcxZDE2IgogIH0sCiAgewogICAia2V5aWQiOiAiYTY4N2U1YmY0ZmFiODJiMGVlNThkNDZlMDVjOTUzNTE0NWEyYzlhZmI0NThmNDNkNDJiNDVjYTBmZGNlMmE3MCIsCiAgICJzaWciOiAiMzA0NTAyMjEwMDg4YmQ0Yjg4ZTgzZjU4NmNlNTY4ZDI3ZDA0MjE0YzRhYjNmZDE4OTQxNzhlZjAxNTMwM2Q1NmFmYTkzOTIwNTMwMjIwNTUzOGViYWI5Mzg3NmFiYjkwNzVhZDc3MTE0YmZmMjhhMGQ3OWE3Y2MyMjliNTM0YTBjNWNlZDU1MjZiNDhlNyIKICB9LAogIHsKICAgImtleWlkIjogIjE4M2U2NGYzNzY3MGRjMTNjYTBkMjg5OTVhMzA1M2YzNzQwOTU0ZGRjZTQ0MzIxYTQxZTQ2NTM0Y2Y0NGU2MzIiLAogICAic2lnIjogIjMwNDUwMjIxMDBmMzViMDdlOTM4ZDQ5NDljYWY4MmU2OWU4NmNjOWRiM2I2OWI2ZGJjNjc0MGMxZjM0M2QwNjg5M2Y5OTZmYmViMDIyMDAxZTg0N2Q4MTYyNTlhOTZhNDllNDI3NzlhMjM1MGRhYjk3YjcxYzhhZTdlMjZiMjM4MGM2ZmE3ZjU4MTMxYjMiCiAgfQogXSwKICJzaWduZWQiOiB7CiAgIl90eXBlIjogInJvb3QiLAogICJjb25zaXN0ZW50X3NuYXBzaG90IjogdHJ1ZSwKICAiZXhwaXJlcyI6ICIyMDI2LTExLTIwVDEzOjU4OjE4WiIsCiAgImtleXMiOiB7CiAgICIwYzg3NDMyYzNiZjA5ZmQ5OTE4OWZkYzMyZmE1ZWFlZGY0ZTRhNWZhYzdiYWI3M2ZhMDRhMmUwZmM2NGFmNmY1IjogewogICAgImtleWlkX2hhc2hfYWxnb3JpdGhtcyI6IFsKICAgICAic2hhMjU2IiwKICAgICAic2hhNTEyIgogICAgXSwKICAgICJrZXl0eXBlIjogImVjZHNhIiwKICAgICJrZXl2YWwiOiB7CiAgICAgInB1YmxpYyI6ICItLS0tLUJFR0lOIFBVQkxJQyBLRVktLS0tLVxuTUZrd0V3WUhLb1pJemowQ0FRWUlLb1pJemowREFRY0RRZ0FFV1JpR3I1K2orM0o1U3NIK1p0cjVuRTJIMndPN1xuQlYrbk8zczkzZ0xjYTE4cVRPekhZMW9XeUFHRHlrTVNzR1RVQlN0OUQrQW4wS2ZLc0QybWZTTTQyUT09XG4tLS0tLUVORCBQVUJMSUMgS0VZLS0tLS1cbiIKICAgIH0sCiAgICAic2NoZW1lIjogImVjZHNhLXNoYTItbmlzdHAyNTYiLAogICAgIngtdHVmLW9uLWNpLW9ubGluZS11cmkiOiAiZ2Nwa21zOnByb2plY3RzL3NpZ3N0b3JlLXJvb3Qtc2lnbmluZy9sb2NhdGlvbnMvZ2xvYmFsL2tleVJpbmdzL3Jvb3QvY3J5cHRvS2V5cy90aW1lc3RhbXAvY3J5cHRvS2V5VmVyc2lvbnMvMSIKICAgfSwKICAgIjE4M2U2NGYzNzY3MGRjMTNjYTBkMjg5OTVhMzA1M2YzNzQwOTU0ZGRjZTQ0MzIxYTQxZTQ2NTM0Y2Y0NGU2MzIiOiB7CiAgICAia2V5dHlwZSI6ICJlY2RzYSIsCiAgICAia2V5dmFsIjogewogICAgICJwdWJsaWMiOiAiLS0tLS1CRUdJTiBQVUJMSUMgS0VZLS0tLS1cbk1Ga3dFd1lIS29aSXpqMENBUVlJS29aSXpqMERBUWNEUWdBRU14cFBPSkNJWjVvdEc0MTA2ZkdKc2VFUWkzVjlcbnBrTVlRNHV5VjlUajFNN1dIWEl5TEcramtmdnVHMGdsUTFKWmJSWlpCVjNnQVI0c29qZEdISVNlb3c9PVxuLS0tLS1FTkQgUFVCTElDIEtFWS0tLS0tXG4iCiAgICB9LAogICAgInNjaGVtZSI6ICJlY2RzYS1zaGEyLW5pc3RwMjU2IiwKICAgICJ4LXR1Zi1vbi1jaS1rZXlvd25lciI6ICJAbGFuY2UiCiAgIH0sCiAgICIyMmY0Y2FlYzZkOGU2Zjk1NTVhZjY2YjNkNGMzY2IwNmEzYmIyM2ZkYzdlMzljOTE2YzYxZjQ2MmU2ZjUyYjA2IjogewogICAgImtleWlkX2hhc2hfYWxnb3JpdGhtcyI6IFsKICAgICAic2hhMjU2IiwKICAgICAic2hhNTEyIgogICAgXSwKICAgICJrZXl0eXBlIjogImVjZHNhIiwKICAgICJrZXl2YWwiOiB7CiAgICAgInB1YmxpYyI6ICItLS0tLUJFR0lOIFBVQkxJQyBLRVktLS0tLVxuTUZrd0V3WUhLb1pJemowQ0FRWUlLb1pJemowREFRY0RRZ0FFekJ6Vk9tSENQb2pNVkxTSTM2NFdpaVY4TlByRFxuNklnUnhWbGlza3ovdit5M0pFUjVtY1ZHY09ObGlEY1dNQzVKMmxmSG1qUE5QaGI0SDd4bThMemZTQT09XG4tLS0tLUVORCBQVUJMSUMgS0VZLS0tLS1cbiIKICAgIH0sCiAgICAic2NoZW1lIjogImVjZHNhLXNoYTItbmlzdHAyNTYiLAogICAgIngtdHVmLW9uLWNpLWtleW93bmVyIjogIkBzYW50aWFnb3RvcnJlcyIKICAgfSwKICAgIjYxNjQzODM4MTI1YjQ0MGI0MGRiNjk0MmY1Y2I1YTMxYzBkYzA0MzY4MzE2ZWIyYWFhNThiOTU5MDRhNTgyMjIiOiB7CiAgICAia2V5aWRfaGFzaF9hbGdvcml0aG1zIjogWwogICAgICJzaGEyNTYiLAogICAgICJzaGE1MTIiCiAgICBdLAogICAgImtleXR5cGUiOiAiZWNkc2EiLAogICAgImtleXZhbCI6IHsKICAgICAicHVibGljIjogIi0tLS0tQkVHSU4gUFVCTElDIEtFWS0tLS0tXG5NRmt3RXdZSEtvWkl6ajBDQVFZSUtvWkl6ajBEQVFjRFFnQUVpbmlrU3NBUW1Za05lSDVlWXEvQ25JekxhYWNPXG54bFNhYXdRRE93cUt5L3RDcXhxNXh4UFNKYzIxSzRXSWhzOUd5T2tLZnp1ZVkzR0lMemNNSlo0Y1d3PT1cbi0tLS0tRU5EIFBVQkxJQyBLRVktLS0tLVxuIgogICAgfSwKICAgICJzY2hlbWUiOiAiZWNkc2Etc2hhMi1uaXN0cDI1NiIsCiAgICAieC10dWYtb24tY2kta2V5b3duZXIiOiAiQGJvYmNhbGxhd2F5IgogICB9LAogICAiYTY4N2U1YmY0ZmFiODJiMGVlNThkNDZlMDVjOTUzNTE0NWEyYzlhZmI0NThmNDNkNDJiNDVjYTBmZGNlMmE3MCI6IHsKICAgICJrZXlpZF9oYXNoX2FsZ29yaXRobXMiOiBbCiAgICAgInNoYTI1NiIsCiAgICAgInNoYTUxMiIKICAgIF0sCiAgICAia2V5dHlwZSI6ICJlY2RzYSIsCiAgICAia2V5dmFsIjogewogICAgICJwdWJsaWMiOiAiLS0tLS1CRUdJTiBQVUJMSUMgS0VZLS0tLS1cbk1Ga3dFd1lIS29aSXpqMENBUVlJS29aSXpqMERBUWNEUWdBRTBnaHJoOTJMdzFZcjNpZEdWNVdxQ3RNREI4Q3hcbitEOGhkQzR3MlpMTklwbFZSb1ZHTHNrWWEzZ2hlTXlPamlKOGtQaTE1YVEyLy83UCtvajdVdkpQR3c9PVxuLS0tLS1FTkQgUFVCTElDIEtFWS0tLS0tXG4iCiAgICB9LAogICAgInNjaGVtZSI6ICJlY2RzYS1zaGEyLW5pc3RwMjU2IiwKICAgICJ4LXR1Zi1vbi1jaS1rZXlvd25lciI6ICJAam9zaHVhZ2wiCiAgIH0sCiAgICJlNzFhNTRkNTQzODM1YmE4NmFkYWQ5NDYwMzc5Yzc2NDFmYjg3MjZkMTY0ZWE3NjY4MDFhMWM1MjJhYmE3ZWEyIjogewogICAgImtleWlkX2hhc2hfYWxnb3JpdGhtcyI6IFsKICAgICAic2hhMjU2IiwKICAgICAic2hhNTEyIgogICAgXSwKICAgICJrZXl0eXBlIjogImVjZHNhIiwKICAgICJrZXl2YWwiOiB7CiAgICAgInB1YmxpYyI6ICItLS0tLUJFR0lOIFBVQkxJQyBLRVktLS0tLVxuTUZrd0V3WUhLb1pJemowQ0FRWUlLb1pJemowREFRY0RRZ0FFRVhzejNTWlhGYjhqTVY0Mmo2cEpseWpialI4S1xuTjNCd29jZXhxNkxNSWI1cXNXS09RdkxOMTZOVWVmTGM0SHN3T291bVJzVlZhYWpTcFFTNmZvYmtSdz09XG4tLS0tLUVORCBQVUJMSUMgS0VZLS0tLS1cbiIKICAgIH0sCiAgICAic2NoZW1lIjogImVjZHNhLXNoYTItbmlzdHAyNTYiLAogICAgIngtdHVmLW9uLWNpLWtleW93bmVyIjogIkBtbm02NzgiCiAgIH0KICB9LAogICJyb2xlcyI6IHsKICAgInJvb3QiOiB7CiAgICAia2V5aWRzIjogWwogICAgICJlNzFhNTRkNTQzODM1YmE4NmFkYWQ5NDYwMzc5Yzc2NDFmYjg3MjZkMTY0ZWE3NjY4MDFhMWM1MjJhYmE3ZWEyIiwKICAgICAiMjJmNGNhZWM2ZDhlNmY5NTU1YWY2NmIzZDRjM2NiMDZhM2JiMjNmZGM3ZTM5YzkxNmM2MWY0NjJlNmY1MmIwNiIsCiAgICAgIjYxNjQzODM4MTI1YjQ0MGI0MGRiNjk0MmY1Y2I1YTMxYzBkYzA0MzY4MzE2ZWIyYWFhNThiOTU5MDRhNTgyMjIiLAogICAgICJhNjg3ZTViZjRmYWI4MmIwZWU1OGQ0NmUwNWM5NTM1MTQ1YTJjOWFmYjQ1OGY0M2Q0MmI0NWNhMGZkY2UyYTcwIiwKICAgICAiMTgzZTY0ZjM3NjcwZGMxM2NhMGQyODk5NWEzMDUzZjM3NDA5NTRkZGNlNDQzMjFhNDFlNDY1MzRjZjQ0ZTYzMiIKICAgIF0sCiAgICAidGhyZXNob2xkIjogMwogICB9LAogICAic25hcHNob3QiOiB7CiAgICAia2V5aWRzIjogWwogICAgICIwYzg3NDMyYzNiZjA5ZmQ5OTE4OWZkYzMyZmE1ZWFlZGY0ZTRhNWZhYzdiYWI3M2ZhMDRhMmUwZmM2NGFmNmY1IgogICAgXSwKICAgICJ0aHJlc2hvbGQiOiAxLAogICAgIngtdHVmLW9uLWNpLWV4cGlyeS1wZXJpb2QiOiAzNjUwLAogICAgIngtdHVmLW9uLWNpLXNpZ25pbmctcGVyaW9kIjogMzY1CiAgIH0sCiAgICJ0YXJnZXRzIjogewogICAgImtleWlkcyI6IFsKICAgICAiZTcxYTU0ZDU0MzgzNWJhODZhZGFkOTQ2MDM3OWM3NjQxZmI4NzI2ZDE2NGVhNzY2ODAxYTFjNTIyYWJhN2VhMiIsCiAgICAgIjIyZjRjYWVjNmQ4ZTZmOTU1NWFmNjZiM2Q0YzNjYjA2YTNiYjIzZmRjN2UzOWM5MTZjNjFmNDYyZTZmNTJiMDYiLAogICAgICI2MTY0MzgzODEyNWI0NDBiNDBkYjY5NDJmNWNiNWEzMWMwZGMwNDM2ODMxNmViMmFhYTU4Yjk1OTA0YTU4MjIyIiwKICAgICAiYTY4N2U1YmY0ZmFiODJiMGVlNThkNDZlMDVjOTUzNTE0NWEyYzlhZmI0NThmNDNkNDJiNDVjYTBmZGNlMmE3MCIsCiAgICAgIjE4M2U2NGYzNzY3MGRjMTNjYTBkMjg5OTVhMzA1M2YzNzQwOTU0ZGRjZTQ0MzIxYTQxZTQ2NTM0Y2Y0NGU2MzIiCiAgICBdLAogICAgInRocmVzaG9sZCI6IDMKICAgfSwKICAgInRpbWVzdGFtcCI6IHsKICAgICJrZXlpZHMiOiBbCiAgICAgIjBjODc0MzJjM2JmMDlmZDk5MTg5ZmRjMzJmYTVlYWVkZjRlNGE1ZmFjN2JhYjczZmEwNGEyZTBmYzY0YWY2ZjUiCiAgICBdLAogICAgInRocmVzaG9sZCI6IDEsCiAgICAieC10dWYtb24tY2ktZXhwaXJ5LXBlcmlvZCI6IDcsCiAgICAieC10dWYtb24tY2ktc2lnbmluZy1wZXJpb2QiOiA2CiAgIH0KICB9LAogICJzcGVjX3ZlcnNpb24iOiAiMS4wIiwKICAidmVyc2lvbiI6IDE1LAogICJ4LXR1Zi1vbi1jaS1leHBpcnktcGVyaW9kIjogMTk3LAogICJ4LXR1Zi1vbi1jaS1zaWduaW5nLXBlcmlvZCI6IDQ2CiB9Cn0=",
		targets: {
			"trusted_root.json": "ewogICJtZWRpYVR5cGUiOiAiYXBwbGljYXRpb24vdm5kLmRldi5zaWdzdG9yZS50cnVzdGVkcm9vdCtqc29uO3ZlcnNpb249MC4xIiwKICAidGxvZ3MiOiBbCiAgICB7CiAgICAgICJiYXNlVXJsIjogImh0dHBzOi8vcmVrb3Iuc2lnc3RvcmUuZGV2IiwKICAgICAgImhhc2hBbGdvcml0aG0iOiAiU0hBMl8yNTYiLAogICAgICAicHVibGljS2V5IjogewogICAgICAgICJyYXdCeXRlcyI6ICJNRmt3RXdZSEtvWkl6ajBDQVFZSUtvWkl6ajBEQVFjRFFnQUUyRzJZKzJ0YWJkVFY1QmNHaUJJeDBhOWZBRndya0JibUxTR3RrczRMM3FYNnlZWTB6dWZCbmhDOFVyL2l5NTVHaFdQLzlBL2JZMkxoQzMwTTkrUll0dz09IiwKICAgICAgICAia2V5RGV0YWlscyI6ICJQS0lYX0VDRFNBX1AyNTZfU0hBXzI1NiIsCiAgICAgICAgInZhbGlkRm9yIjogewogICAgICAgICAgInN0YXJ0IjogIjIwMjEtMDEtMTJUMTE6NTM6MjdaIgogICAgICAgIH0KICAgICAgfSwKICAgICAgImxvZ0lkIjogewogICAgICAgICJrZXlJZCI6ICJ3Tkk5YXRRR2x6K1ZXZk82TFJ5Z0g0UVVmWS84VzRSRndpVDVpNVdSZ0IwPSIKICAgICAgfQogICAgfSwKICAgIHsKICAgICAgImJhc2VVcmwiOiAiaHR0cHM6Ly9sb2cyMDI1LTEucmVrb3Iuc2lnc3RvcmUuZGV2IiwKICAgICAgImhhc2hBbGdvcml0aG0iOiAiU0hBMl8yNTYiLAogICAgICAicHVibGljS2V5IjogewogICAgICAgICJyYXdCeXRlcyI6ICJNQ293QlFZREsyVndBeUVBdDhybHAxa25Hd2pmYmNYQVlQWUFrbjBYaUx6MXg4TzR0MFlrRWhpZTI0ND0iLAogICAgICAgICJrZXlEZXRhaWxzIjogIlBLSVhfRUQyNTUxOSIsCiAgICAgICAgInZhbGlkRm9yIjogewogICAgICAgICAgInN0YXJ0IjogIjIwMjUtMDktMjNUMDA6MDA6MDBaIgogICAgICAgIH0KICAgICAgfSwKICAgICAgImxvZ0lkIjogewogICAgICAgICJrZXlJZCI6ICJ6eEdaRlZ2ZDBGRW1qUjhXckZ3TWRjQUo5dnRhWS9RWGY0NFkxd1VlUDZBPSIKICAgICAgfQogICAgfQogIF0sCiAgImNlcnRpZmljYXRlQXV0aG9yaXRpZXMiOiBbCiAgICB7CiAgICAgICJzdWJqZWN0IjogewogICAgICAgICJvcmdhbml6YXRpb24iOiAic2lnc3RvcmUuZGV2IiwKICAgICAgICAiY29tbW9uTmFtZSI6ICJzaWdzdG9yZSIKICAgICAgfSwKICAgICAgInVyaSI6ICJodHRwczovL2Z1bGNpby5zaWdzdG9yZS5kZXYiLAogICAgICAiY2VydENoYWluIjogewogICAgICAgICJjZXJ0aWZpY2F0ZXMiOiBbCiAgICAgICAgICB7CiAgICAgICAgICAgICJyYXdCeXRlcyI6ICJNSUlCK0RDQ0FYNmdBd0lCQWdJVE5Wa0Rab0Npb2ZQRHN5N2RmbTZnZUxidWh6QUtCZ2dxaGtqT1BRUURBekFxTVJVd0V3WURWUVFLRXd4emFXZHpkRzl5WlM1a1pYWXhFVEFQQmdOVkJBTVRDSE5wWjNOMGIzSmxNQjRYRFRJeE1ETXdOekF6TWpBeU9Wb1hEVE14TURJeU16QXpNakF5T1Zvd0tqRVZNQk1HQTFVRUNoTU1jMmxuYzNSdmNtVXVaR1YyTVJFd0R3WURWUVFERXdoemFXZHpkRzl5WlRCMk1CQUdCeXFHU000OUFnRUdCU3VCQkFBaUEySUFCTFN5QTdJaTVrK3BOTzhaRVdZMHlsZW1XRG93T2tOYTNrTCtHWkU1WjVHV2VoTDkvQTliUk5BM1JicnNaNWkwSmNhc3RhUkw3U3A1ZnAvakQ1ZHhxYy9VZFRWbmx2UzE2YW4rMllmc3dlL1F1TG9sUlVDcmNPRTIrMmlBNSt0emQ2Tm1NR1F3RGdZRFZSMFBBUUgvQkFRREFnRUdNQklHQTFVZEV3RUIvd1FJTUFZQkFmOENBUUV3SFFZRFZSME9CQllFRk1qRkhRQkJtaVFwTWxFazZ3MnVTdTFLQnRQc01COEdBMVVkSXdRWU1CYUFGTWpGSFFCQm1pUXBNbEVrNncydVN1MUtCdFBzTUFvR0NDcUdTTTQ5QkFNREEyZ0FNR1VDTUg4bGlXSmZNdWk2dlhYQmhqRGdZNE13c2xtTi9USnhWZS84M1dyRm9td21OZjA1NnkxWDQ4RjljNG0zYTNvelhBSXhBS2pSYXk1L2FqL2pzS0tHSWttUWF0akk4dXVwSHIvK0N4RnZhSldtcFlxTmtMREdSVSs5b3J6aDVoSTJScmN1YVE9PSIKICAgICAgICAgIH0KICAgICAgICBdCiAgICAgIH0sCiAgICAgICJ2YWxpZEZvciI6IHsKICAgICAgICAic3RhcnQiOiAiMjAyMS0wMy0wN1QwMzoyMDoyOVoiLAogICAgICAgICJlbmQiOiAiMjAyMi0xMi0zMVQyMzo1OTo1OS45OTlaIgogICAgICB9CiAgICB9LAogICAgewogICAgICAic3ViamVjdCI6IHsKICAgICAgICAib3JnYW5pemF0aW9uIjogInNpZ3N0b3JlLmRldiIsCiAgICAgICAgImNvbW1vbk5hbWUiOiAic2lnc3RvcmUiCiAgICAgIH0sCiAgICAgICJ1cmkiOiAiaHR0cHM6Ly9mdWxjaW8uc2lnc3RvcmUuZGV2IiwKICAgICAgImNlcnRDaGFpbiI6IHsKICAgICAgICAiY2VydGlmaWNhdGVzIjogWwogICAgICAgICAgewogICAgICAgICAgICAicmF3Qnl0ZXMiOiAiTUlJQ0dqQ0NBYUdnQXdJQkFnSVVBTG5WaVZmblUwYnJKYXNtUmtIcm4vVW5mYVF3Q2dZSUtvWkl6ajBFQXdNd0tqRVZNQk1HQTFVRUNoTU1jMmxuYzNSdmNtVXVaR1YyTVJFd0R3WURWUVFERXdoemFXZHpkRzl5WlRBZUZ3MHlNakEwTVRNeU1EQTJNVFZhRncwek1URXdNRFV4TXpVMk5UaGFNRGN4RlRBVEJnTlZCQW9UREhOcFozTjBiM0psTG1SbGRqRWVNQndHQTFVRUF4TVZjMmxuYzNSdmNtVXRhVzUwWlhKdFpXUnBZWFJsTUhZd0VBWUhLb1pJemowQ0FRWUZLNEVFQUNJRFlnQUU4UlZTL3lzSCtOT3Z1RFp5UEladGlsZ1VGOU5sYXJZcEFkOUhQMXZCQkgxVTVDVjc3TFNTN3MwWmlING5FN0h2N3B0UzZMdnZSL1NUazc5OExWZ016TGxKNEhlSWZGM3RIU2FleExjWXBTQVNyMWtTME4vUmdCSnovOWpXQ2lYbm8zc3dlVEFPQmdOVkhROEJBZjhFQkFNQ0FRWXdFd1lEVlIwbEJBd3dDZ1lJS3dZQkJRVUhBd013RWdZRFZSMFRBUUgvQkFnd0JnRUIvd0lCQURBZEJnTlZIUTRFRmdRVTM5UHB6MVlrRVpiNXFOanBLRldpeGk0WVpEOHdId1lEVlIwakJCZ3dGb0FVV01BZVg1RkZwV2FwZXN5UW9aTWkwQ3JGeGZvd0NnWUlLb1pJemowRUF3TURad0F3WkFJd1BDc1FLNERZaVpZRFBJYURpNUhGS25meFh4NkFTU1ZtRVJmc3luWUJpWDJYNlNKUm5aVTg0LzlEWmRuRnZ2eG1BakJPdDZRcEJsYzRKLzBEeHZrVENxcGNsdnppTDZCQ0NQbmpkbElCM1B1M0J4c1BteWdVWTdJaTJ6YmRDZGxpaW93PSIKICAgICAgICAgIH0sCiAgICAgICAgICB7CiAgICAgICAgICAgICJyYXdCeXRlcyI6ICJNSUlCOXpDQ0FYeWdBd0lCQWdJVUFMWk5BUEZkeEhQd2plRGxvRHd5WUNoQU8vNHdDZ1lJS29aSXpqMEVBd013S2pFVk1CTUdBMVVFQ2hNTWMybG5jM1J2Y21VdVpHVjJNUkV3RHdZRFZRUURFd2h6YVdkemRHOXlaVEFlRncweU1URXdNRGN4TXpVMk5UbGFGdzB6TVRFd01EVXhNelUyTlRoYU1Db3hGVEFUQmdOVkJBb1RESE5wWjNOMGIzSmxMbVJsZGpFUk1BOEdBMVVFQXhNSWMybG5jM1J2Y21Vd2RqQVFCZ2NxaGtqT1BRSUJCZ1VyZ1FRQUlnTmlBQVQ3WGVGVDRyYjNQUUd3UzRJYWp0TGszL09sbnBnYW5nYUJjbFlwc1lCcjVpKzR5bkIwN2NlYjNMUDBPSU9aZHhleFg2OWM1aVZ1eUpSUStIejA1eWkrVUYzdUJXQWxIcGlTNXNoMCtIMkdIRTdTWHJrMUVDNW0xVHIxOUw5Z2c5MmpZekJoTUE0R0ExVWREd0VCL3dRRUF3SUJCakFQQmdOVkhSTUJBZjhFQlRBREFRSC9NQjBHQTFVZERnUVdCQlJZd0I1ZmtVV2xacWw2ekpDaGt5TFFLc1hGK2pBZkJnTlZIU01FR0RBV2dCUll3QjVma1VXbFpxbDZ6SkNoa3lMUUtzWEYrakFLQmdncWhrak9QUVFEQXdOcEFEQm1BakVBajFuSGVYWnArMTNOV0JOYStFRHNEUDhHMVdXZzF0Q01XUC9XSFBxcGFWbzBqaHN3ZU5GWmdTczBlRTd3WUk0cUFqRUEyV0I5b3Q5OHNJa29GM3ZaWWRkMy9WdFdCNWI5VE5NZWE3SXgvc3RKNVRmY0xMZUFCTEU0Qk5KT3NRNHZuQkhKIgogICAgICAgICAgfQogICAgICAgIF0KICAgICAgfSwKICAgICAgInZhbGlkRm9yIjogewogICAgICAgICJzdGFydCI6ICIyMDIyLTA0LTEzVDIwOjA2OjE1WiIKICAgICAgfQogICAgfQogIF0sCiAgImN0bG9ncyI6IFsKICAgIHsKICAgICAgImJhc2VVcmwiOiAiaHR0cHM6Ly9jdGZlLnNpZ3N0b3JlLmRldi90ZXN0IiwKICAgICAgImhhc2hBbGdvcml0aG0iOiAiU0hBMl8yNTYiLAogICAgICAicHVibGljS2V5IjogewogICAgICAgICJyYXdCeXRlcyI6ICJNRmt3RXdZSEtvWkl6ajBDQVFZSUtvWkl6ajBEQVFjRFFnQUViZndSK1JKdWRYc2NnUkJScEtYMVhGRHkzUHl1ZER4ei9TZm5SaTFmVDhla3BmQmQyTzF1b3o3anIzWjhuS3p4QTY5RVVRK2VGQ0ZJM3pldWJQV1U3dz09IiwKICAgICAgICAia2V5RGV0YWlscyI6ICJQS0lYX0VDRFNBX1AyNTZfU0hBXzI1NiIsCiAgICAgICAgInZhbGlkRm9yIjogewogICAgICAgICAgInN0YXJ0IjogIjIwMjEtMDMtMTRUMDA6MDA6MDBaIiwKICAgICAgICAgICJlbmQiOiAiMjAyMi0xMC0zMVQyMzo1OTo1OS45OTlaIgogICAgICAgIH0KICAgICAgfSwKICAgICAgImxvZ0lkIjogewogICAgICAgICJrZXlJZCI6ICJDR0NTOENoUy8yaEYwZEZySjRTY1JXY1lyQlk5d3pqU2JlYThJZ1kyYjNJPSIKICAgICAgfQogICAgfSwKICAgIHsKICAgICAgImJhc2VVcmwiOiAiaHR0cHM6Ly9jdGZlLnNpZ3N0b3JlLmRldi8yMDIyIiwKICAgICAgImhhc2hBbGdvcml0aG0iOiAiU0hBMl8yNTYiLAogICAgICAicHVibGljS2V5IjogewogICAgICAgICJyYXdCeXRlcyI6ICJNRmt3RXdZSEtvWkl6ajBDQVFZSUtvWkl6ajBEQVFjRFFnQUVpUFNsRmkwQ21GVGZFakNVcUY5SHVDRWNZWE5LQWFZYWxJSm1CWjh5eWV6UGpUcWh4cktCcE1uYW9jVnRMSkJJMWVNM3VYblF6UUdBSmRKNGdzOUZ5dz09IiwKICAgICAgICAia2V5RGV0YWlscyI6ICJQS0lYX0VDRFNBX1AyNTZfU0hBXzI1NiIsCiAgICAgICAgInZhbGlkRm9yIjogewogICAgICAgICAgInN0YXJ0IjogIjIwMjItMTAtMjBUMDA6MDA6MDBaIgogICAgICAgIH0KICAgICAgfSwKICAgICAgImxvZ0lkIjogewogICAgICAgICJrZXlJZCI6ICIzVDB3YXNiSEVUSmpHUjRjbVdjM0FxSktYcmplUEszL2g0cHlnQzhwN280PSIKICAgICAgfQogICAgfQogIF0sCiAgInRpbWVzdGFtcEF1dGhvcml0aWVzIjogWwogICAgewogICAgICAic3ViamVjdCI6IHsKICAgICAgICAib3JnYW5pemF0aW9uIjogInNpZ3N0b3JlLmRldiIsCiAgICAgICAgImNvbW1vbk5hbWUiOiAic2lnc3RvcmUtdHNhLXNlbGZzaWduZWQiCiAgICAgIH0sCiAgICAgICJ1cmkiOiAiaHR0cHM6Ly90aW1lc3RhbXAuc2lnc3RvcmUuZGV2L2FwaS92MS90aW1lc3RhbXAiLAogICAgICAiY2VydENoYWluIjogewogICAgICAgICJjZXJ0aWZpY2F0ZXMiOiBbCiAgICAgICAgICB7CiAgICAgICAgICAgICJyYXdCeXRlcyI6ICJNSUlDRURDQ0FaYWdBd0lCQWdJVU9oTlVMd3lRWWU2OHdVTXZ5NHFPaXlvaml3d3dDZ1lJS29aSXpqMEVBd013T1RFVk1CTUdBMVVFQ2hNTWMybG5jM1J2Y21VdVpHVjJNU0F3SGdZRFZRUURFeGR6YVdkemRHOXlaUzEwYzJFdGMyVnNabk5wWjI1bFpEQWVGdzB5TlRBME1EZ3dOalU1TkROYUZ3MHpOVEEwTURZd05qVTVORE5hTUM0eEZUQVRCZ05WQkFvVERITnBaM04wYjNKbExtUmxkakVWTUJNR0ExVUVBeE1NYzJsbmMzUnZjbVV0ZEhOaE1IWXdFQVlIS29aSXpqMENBUVlGSzRFRUFDSURZZ0FFNHJhMlo4aEtOaWcyVDlrRmpDQVRvR0czMGpreStXUXYzQnpMK21LdmgxU0tOUi9Vd3V3c2ZOQ2c0c3J5b1lBZDhFNmlzb3ZWQTNNNGFvTmRtOVFEaTUwWjhuVEV5dnFnZkRQdFRJd1hJdGZpVy9BRmYxVjd1d2tia0FvajB4eGNvMm93YURBT0JnTlZIUThCQWY4RUJBTUNCNEF3SFFZRFZSME9CQllFRkluOWVVT0h6OUJsUnNNQ1JzY3NjMXQ5dE9zRE1COEdBMVVkSXdRWU1CYUFGSmpzQWU5L3UxSC8xSlVlYjRxSW1GTUhpYzYvTUJZR0ExVWRKUUVCL3dRTU1Bb0dDQ3NHQVFVRkJ3TUlNQW9HQ0NxR1NNNDlCQU1EQTJnQU1HVUNNRHRwc1YvNkthTzBxeUYvVU1zWDJhU1VYS1FGZG9HVHB0UUdjMGZ0cTFjc3VsSFBHRzZkc215TU5kM0pCK0czRVFJeEFPYWp2QmNqcEptS2I0TnYrMlRhb2o4VWM1K2I2aWg2RlhDQ0tyYVNxdXBlMDd6cXN3TWNYSlRlMWNFeHZIdnZsdz09IgogICAgICAgICAgfSwKICAgICAgICAgIHsKICAgICAgICAgICAgInJhd0J5dGVzIjogIk1JSUI5ekNDQVh5Z0F3SUJBZ0lVVjdmMEdMRE9vRXpJaDhMWFNXODBPSmlVcDE0d0NnWUlLb1pJemowRUF3TXdPVEVWTUJNR0ExVUVDaE1NYzJsbmMzUnZjbVV1WkdWMk1TQXdIZ1lEVlFRREV4ZHphV2R6ZEc5eVpTMTBjMkV0YzJWc1puTnBaMjVsWkRBZUZ3MHlOVEEwTURnd05qVTVORE5hRncwek5UQTBNRFl3TmpVNU5ETmFNRGt4RlRBVEJnTlZCQW9UREhOcFozTjBiM0psTG1SbGRqRWdNQjRHQTFVRUF4TVhjMmxuYzNSdmNtVXRkSE5oTFhObGJHWnphV2R1WldRd2RqQVFCZ2NxaGtqT1BRSUJCZ1VyZ1FRQUlnTmlBQVFVUU50ZlJUL291M1lBVGE2d0Iva0tUZTcwY2ZKd3lSSUJvdk1udDhSY0pwaC9DT0U4MnV5UzZGbXBwTExMMVZCUEdjUGZwUVBZSk5Yeld3aThpY3doS1E2Vy9RZTJoM29lYkJiMkZIcHdOSkRxbytUTWFDL3RkZmt2L0VsSkI3MmpSVEJETUE0R0ExVWREd0VCL3dRRUF3SUJCakFTQmdOVkhSTUJBZjhFQ0RBR0FRSC9BZ0VBTUIwR0ExVWREZ1FXQkJTWTdBSHZmN3RSLzlTVkhtK0tpSmhUQjRuT3Z6QUtCZ2dxaGtqT1BRUURBd05wQURCbUFqRUF3R0VHcmZHWlIxY2VuMVI4L0RUVk1JOTQzTHNzWm1KUnREcC9pN1NmR0htR1JQNmdSYnVqOXZPSzNiNjdaMFFRQWpFQXVUMkg2NzNMUUVhSFRjeVFTWnJrcDRtWDdXd2ttRitzVmJrWVk1bVhOK1JNSDEzS1VFSEhPcUFTYWVtWVdLL0UiCiAgICAgICAgICB9CiAgICAgICAgXQogICAgICB9LAogICAgICAidmFsaWRGb3IiOiB7CiAgICAgICAgInN0YXJ0IjogIjIwMjUtMDctMDRUMDA6MDA6MDBaIgogICAgICB9CiAgICB9CiAgXQp9Cg==",
			"registry.npmjs.org%2Fkeys.json": "ewogICAgImtleXMiOiBbCiAgICAgICAgewogICAgICAgICAgICAia2V5SWQiOiAiU0hBMjU2OmpsM2J3c3d1ODBQampva0NnaDBvMnc1YzJVNExoUUFFNTdnajljejFrekEiLAogICAgICAgICAgICAia2V5VXNhZ2UiOiAibnBtOnNpZ25hdHVyZXMiLAogICAgICAgICAgICAicHVibGljS2V5IjogewogICAgICAgICAgICAgICAgInJhd0J5dGVzIjogIk1Ga3dFd1lIS29aSXpqMENBUVlJS29aSXpqMERBUWNEUWdBRTFPbGIzek1BRkZ4WEtIaUlrUU81Y0ozWWhsNWk2VVBwK0lodXRlQkpidUhjQTVVb2dLbzBFV3RsV3dXNktTYUtvVE5FWUw3SmxDUWlWbmtoQmt0VWdnPT0iLAogICAgICAgICAgICAgICAgImtleURldGFpbHMiOiAiUEtJWF9FQ0RTQV9QMjU2X1NIQV8yNTYiLAogICAgICAgICAgICAgICAgInZhbGlkRm9yIjogewogICAgICAgICAgICAgICAgICAgICJzdGFydCI6ICIxOTk5LTAxLTAxVDAwOjAwOjAwLjAwMFoiLAogICAgICAgICAgICAgICAgICAgICJlbmQiOiAiMjAyNS0wMS0yOVQwMDowMDowMC4wMDBaIgogICAgICAgICAgICAgICAgfQogICAgICAgICAgICB9CiAgICAgICAgfSwKICAgICAgICB7CiAgICAgICAgICAgICJrZXlJZCI6ICJTSEEyNTY6amwzYndzd3U4MFBqam9rQ2doMG8ydzVjMlU0TGhRQUU1N2dqOWN6MWt6QSIsCiAgICAgICAgICAgICJrZXlVc2FnZSI6ICJucG06YXR0ZXN0YXRpb25zIiwKICAgICAgICAgICAgInB1YmxpY0tleSI6IHsKICAgICAgICAgICAgICAgICJyYXdCeXRlcyI6ICJNRmt3RXdZSEtvWkl6ajBDQVFZSUtvWkl6ajBEQVFjRFFnQUUxT2xiM3pNQUZGeFhLSGlJa1FPNWNKM1lobDVpNlVQcCtJaHV0ZUJKYnVIY0E1VW9nS28wRVd0bFd3VzZLU2FLb1RORVlMN0psQ1FpVm5raEJrdFVnZz09IiwKICAgICAgICAgICAgICAgICJrZXlEZXRhaWxzIjogIlBLSVhfRUNEU0FfUDI1Nl9TSEFfMjU2IiwKICAgICAgICAgICAgICAgICJ2YWxpZEZvciI6IHsKICAgICAgICAgICAgICAgICAgICAic3RhcnQiOiAiMjAyMi0xMi0wMVQwMDowMDowMC4wMDBaIiwKICAgICAgICAgICAgICAgICAgICAiZW5kIjogIjIwMjUtMDEtMjlUMDA6MDA6MDAuMDAwWiIKICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgfQogICAgICAgIH0sCiAgICAgICAgewogICAgICAgICAgICAia2V5SWQiOiAiU0hBMjU2OkRoUTh3UjVBUEJ2RkhMRi8rVGMrQVl2UE9kVHBjSURxT2h4c0JIUndDN1UiLAogICAgICAgICAgICAia2V5VXNhZ2UiOiAibnBtOnNpZ25hdHVyZXMiLAogICAgICAgICAgICAicHVibGljS2V5IjogewogICAgICAgICAgICAgICAgInJhd0J5dGVzIjogIk1Ga3dFd1lIS29aSXpqMENBUVlJS29aSXpqMERBUWNEUWdBRVk2WWE3VysrN2FVUHp2TVRyZXpINlljeDNjK0hPS1lDY05HeWJKWlNDSnEvZmQ3UWE4dXVBS3RkSWtVUXRRaUVLRVJoQW1FNWxNTUpoUDhPa0RPYTJnPT0iLAogICAgICAgICAgICAgICAgImtleURldGFpbHMiOiAiUEtJWF9FQ0RTQV9QMjU2X1NIQV8yNTYiLAogICAgICAgICAgICAgICAgInZhbGlkRm9yIjogewogICAgICAgICAgICAgICAgICAgICJzdGFydCI6ICIyMDI1LTAxLTEzVDAwOjAwOjAwLjAwMFoiCiAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgIH0KICAgICAgICB9LAogICAgICAgIHsKICAgICAgICAgICAgImtleUlkIjogIlNIQTI1NjpEaFE4d1I1QVBCdkZITEYvK1RjK0FZdlBPZFRwY0lEcU9oeHNCSFJ3QzdVIiwKICAgICAgICAgICAgImtleVVzYWdlIjogIm5wbTphdHRlc3RhdGlvbnMiLAogICAgICAgICAgICAicHVibGljS2V5IjogewogICAgICAgICAgICAgICAgInJhd0J5dGVzIjogIk1Ga3dFd1lIS29aSXpqMENBUVlJS29aSXpqMERBUWNEUWdBRVk2WWE3VysrN2FVUHp2TVRyZXpINlljeDNjK0hPS1lDY05HeWJKWlNDSnEvZmQ3UWE4dXVBS3RkSWtVUXRRaUVLRVJoQW1FNWxNTUpoUDhPa0RPYTJnPT0iLAogICAgICAgICAgICAgICAgImtleURldGFpbHMiOiAiUEtJWF9FQ0RTQV9QMjU2X1NIQV8yNTYiLAogICAgICAgICAgICAgICAgInZhbGlkRm9yIjogewogICAgICAgICAgICAgICAgICAgICJzdGFydCI6ICIyMDI1LTAxLTEzVDAwOjAwOjAwLjAwMFoiCiAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgIH0KICAgICAgICB9CiAgICBdCn0K"
		}
	} };
})), require_client = /* @__PURE__ */ __commonJSMin(((exports) => {
	var __importDefault = exports && exports.__importDefault || function(mod) {
		return mod && mod.__esModule ? mod : { default: mod };
	};
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.TUFClient = void 0;
	let fs_1 = __importDefault(require("fs")), path_1 = __importDefault(require("path")), tuf_js_1 = require_dist$3(), _1 = require_dist$2(), package_json_1 = require_package(), target_1 = require_target(), TARGETS_DIR_NAME = "targets";
	exports.TUFClient = class {
		updater;
		constructor(options) {
			let url = new URL(options.mirrorURL), repoName = encodeURIComponent(url.host + url.pathname.replace(/\/$/, "")), cachePath = path_1.default.join(options.cachePath, repoName);
			initTufCache(cachePath), seedCache({
				cachePath,
				mirrorURL: options.mirrorURL,
				tufRootPath: options.rootPath,
				forceInit: options.forceInit
			}), this.updater = initClient({
				mirrorURL: options.mirrorURL,
				cachePath,
				forceCache: options.forceCache,
				retry: options.retry,
				timeout: options.timeout
			});
		}
		async refresh() {
			return this.updater.refresh();
		}
		getTarget(targetName) {
			return (0, target_1.readTarget)(this.updater, targetName);
		}
	};
	function initTufCache(cachePath) {
		let targetsPath = path_1.default.join(cachePath, TARGETS_DIR_NAME);
		/* istanbul ignore else */
		fs_1.default.existsSync(cachePath) || fs_1.default.mkdirSync(cachePath, { recursive: !0 }), fs_1.default.existsSync(targetsPath) || fs_1.default.mkdirSync(targetsPath);
	}
	function seedCache({ cachePath, mirrorURL, tufRootPath, forceInit }) {
		let cachedRootPath = path_1.default.join(cachePath, "root.json");
		/* istanbul ignore else */
		if (!fs_1.default.existsSync(cachedRootPath) || forceInit) if (tufRootPath) fs_1.default.copyFileSync(tufRootPath, cachedRootPath);
		else {
			let repoSeed = require_seeds()[mirrorURL];
			if (!repoSeed) throw new _1.TUFError({
				code: "TUF_INIT_CACHE_ERROR",
				message: `No root.json found for mirror: ${mirrorURL}`
			});
			fs_1.default.writeFileSync(cachedRootPath, Buffer.from(repoSeed["root.json"], "base64")), Object.entries(repoSeed.targets).forEach(([targetName, target]) => {
				fs_1.default.writeFileSync(path_1.default.join(cachePath, TARGETS_DIR_NAME, targetName), Buffer.from(target, "base64"));
			});
		}
	}
	function initClient(options) {
		let config = {
			fetchTimeout: options.timeout,
			fetchRetry: options.retry,
			userAgent: `${encodeURIComponent(package_json_1.name)}/${package_json_1.version}`
		};
		return new tuf_js_1.Updater({
			metadataBaseUrl: options.mirrorURL,
			targetBaseUrl: `${options.mirrorURL}/targets`,
			metadataDir: options.cachePath,
			targetDir: path_1.default.join(options.cachePath, TARGETS_DIR_NAME),
			forceCache: options.forceCache,
			config
		});
	}
})), require_dist$2 = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.TUFError = exports.DEFAULT_MIRROR_URL = void 0, exports.getTrustedRoot = getTrustedRoot, exports.initTUF = initTUF;
	let protobuf_specs_1 = require_dist$6(), appdata_1 = require_appdata(), client_1 = require_client();
	exports.DEFAULT_MIRROR_URL = "https://tuf-repo-cdn.sigstore.dev";
	let DEFAULT_RETRY = { retries: 2 };
	async function getTrustedRoot(options = {}) {
		let trustedRoot = await createClient(options).getTarget("trusted_root.json");
		return protobuf_specs_1.TrustedRoot.fromJSON(JSON.parse(trustedRoot));
	}
	async function initTUF(options = {}) {
		let client = createClient(options);
		return client.refresh().then(() => client);
	}
	function createClient(options) {
		/* istanbul ignore next */
		return new client_1.TUFClient({
			cachePath: options.cachePath || (0, appdata_1.appDataPath)("sigstore-js"),
			rootPath: options.rootPath,
			mirrorURL: options.mirrorURL || exports.DEFAULT_MIRROR_URL,
			retry: options.retry ?? DEFAULT_RETRY,
			timeout: options.timeout ?? 5e3,
			forceCache: options.forceCache ?? !1,
			forceInit: options.forceInit ?? options.force ?? !1
		});
	}
	var error_1 = require_error$3();
	Object.defineProperty(exports, "TUFError", {
		enumerable: !0,
		get: function() {
			return error_1.TUFError;
		}
	});
})), require_stream = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.ByteStream = void 0;
	var StreamError = class extends Error {};
	exports.ByteStream = class ByteStream {
		static BLOCK_SIZE = 1024;
		buf;
		view;
		start = 0;
		constructor(buffer) {
			buffer ? (this.buf = buffer, this.view = Buffer.from(buffer)) : (this.buf = Buffer.alloc(0), this.view = Buffer.from(this.buf));
		}
		get buffer() {
			return this.view.subarray(0, this.start);
		}
		get length() {
			return this.view.byteLength;
		}
		get position() {
			return this.start;
		}
		seek(position) {
			this.start = position;
		}
		slice(start, len) {
			let end = start + len;
			if (end > this.length) throw new StreamError("request past end of buffer");
			return this.view.subarray(start, end);
		}
		appendChar(char) {
			this.ensureCapacity(1), this.view[this.start] = char, this.start += 1;
		}
		appendUint16(num) {
			this.ensureCapacity(2);
			let value = new Uint16Array([num]), view = new Uint8Array(value.buffer);
			this.view[this.start] = view[1], this.view[this.start + 1] = view[0], this.start += 2;
		}
		appendUint24(num) {
			this.ensureCapacity(3);
			let value = new Uint32Array([num]), view = new Uint8Array(value.buffer);
			this.view[this.start] = view[2], this.view[this.start + 1] = view[1], this.view[this.start + 2] = view[0], this.start += 3;
		}
		appendView(view) {
			this.ensureCapacity(view.length), this.view.set(view, this.start), this.start += view.length;
		}
		getBlock(size) {
			if (size <= 0) return Buffer.alloc(0);
			if (this.start + size > this.view.length) throw Error("request past end of buffer");
			let result = this.view.subarray(this.start, this.start + size);
			return this.start += size, result;
		}
		getUint8() {
			return this.getBlock(1)[0];
		}
		getUint16() {
			let block = this.getBlock(2);
			return block[0] << 8 | block[1];
		}
		ensureCapacity(size) {
			if (this.start + size > this.view.byteLength) {
				let blockSize = ByteStream.BLOCK_SIZE + (size > ByteStream.BLOCK_SIZE ? size : 0);
				this.realloc(this.view.byteLength + blockSize);
			}
		}
		realloc(size) {
			let newArray = Buffer.alloc(size), newView = Buffer.from(newArray);
			newView.set(this.view), this.buf = newArray, this.view = newView;
		}
	};
})), require_error$2 = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.ASN1TypeError = exports.ASN1ParseError = void 0, exports.ASN1ParseError = class extends Error {}, exports.ASN1TypeError = class extends Error {};
})), require_length = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.decodeLength = decodeLength, exports.encodeLength = encodeLength;
	let error_1 = require_error$2();
	function decodeLength(stream) {
		let buf = stream.getUint8();
		if (!(buf & 128)) return buf;
		let byteCount = buf & 127;
		if (byteCount > 6) throw new error_1.ASN1ParseError("length exceeds 6 byte limit");
		let len = 0;
		for (let i = 0; i < byteCount; i++) {
			let byte = stream.getUint8();
			if (i === 0 && byte === 0) throw new error_1.ASN1ParseError("non-minimal length encoding");
			len = len * 256 + byte;
		}
		if (len === 0) throw new error_1.ASN1ParseError("indefinite length encoding not supported");
		if (len < 128) throw new error_1.ASN1ParseError("non-minimal length encoding");
		return len;
	}
	function encodeLength(len) {
		if (len < 128) return Buffer.from([len]);
		let val = BigInt(len), bytes = [];
		for (; val > 0n;) bytes.unshift(Number(val & 255n)), val >>= 8n;
		return Buffer.from([128 | bytes.length, ...bytes]);
	}
})), require_parse = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.parseInteger = parseInteger, exports.parseStringASCII = parseStringASCII, exports.parseTime = parseTime, exports.parseOID = parseOID, exports.parseBoolean = parseBoolean, exports.parseBitString = parseBitString;
	let error_1 = require_error$2(), RE_TIME_SHORT_YEAR = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\.\d{3})?Z$/, RE_TIME_LONG_YEAR = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\.\d{3})?Z$/;
	function parseInteger(buf) {
		let pos = 0, end = buf.length, val = buf[pos], neg = val > 127, pad = neg ? 255 : 0;
		for (; val == pad && ++pos < end;) val = buf[pos];
		if (end - pos === 0) return BigInt(neg ? -1 : 0);
		val = neg ? val - 256 : val;
		let n = BigInt(val);
		for (let i = pos + 1; i < end; ++i) n = n * BigInt(256) + BigInt(buf[i]);
		return n;
	}
	function parseStringASCII(buf) {
		return buf.toString("ascii");
	}
	function parseTime(buf, shortYear) {
		let timeStr = parseStringASCII(buf), m = shortYear ? RE_TIME_SHORT_YEAR.exec(timeStr) : RE_TIME_LONG_YEAR.exec(timeStr);
		if (!m) throw Error("invalid time");
		if (shortYear) {
			let year = Number(m[1]);
			year += year >= 50 ? 1900 : 2e3, m[1] = year.toString();
		}
		return /* @__PURE__ */ new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`);
	}
	function parseOID(buf) {
		let pos = 0, end = buf.length, n = buf[pos++], oid = `${Math.floor(n / 40)}.${n % 40}`, val = 0n;
		for (; pos < end; ++pos) n = buf[pos], val = (val << 7n) + BigInt(n & 127), n & 128 || (oid += `.${val}`, val = 0n);
		return oid;
	}
	function parseBoolean(buf) {
		if (buf.length !== 1) throw new error_1.ASN1ParseError("invalid boolean");
		switch (buf[0]) {
			case 0: return !1;
			case 255: return !0;
			default: throw new error_1.ASN1ParseError("invalid boolean");
		}
	}
	function parseBitString(buf) {
		let unused = buf[0];
		if (unused > 7) throw new error_1.ASN1ParseError("invalid bit string");
		let end = buf.length, bits = [];
		for (let i = 1; i < end; ++i) {
			let byte = buf[i], skip = i === end - 1 ? unused : 0;
			for (let j = 7; j >= skip; --j) bits.push(byte >> j & 1);
		}
		return bits;
	}
})), require_tag = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.ASN1Tag = void 0;
	let error_1 = require_error$2(), UNIVERSAL_TAG = {
		BOOLEAN: 1,
		INTEGER: 2,
		BIT_STRING: 3,
		OCTET_STRING: 4,
		OBJECT_IDENTIFIER: 6,
		SEQUENCE: 16,
		SET: 17,
		PRINTABLE_STRING: 19,
		UTC_TIME: 23,
		GENERALIZED_TIME: 24
	}, TAG_CLASS = {
		UNIVERSAL: 0,
		APPLICATION: 1,
		CONTEXT_SPECIFIC: 2,
		PRIVATE: 3
	};
	exports.ASN1Tag = class {
		number;
		constructed;
		class;
		constructor(enc) {
			if (this.number = enc & 31, this.constructed = (enc & 32) == 32, this.class = enc >> 6, this.number === 31) throw new error_1.ASN1ParseError("long form tags not supported");
			if (this.class === TAG_CLASS.UNIVERSAL && this.number === 0) throw new error_1.ASN1ParseError("unsupported tag 0x00");
		}
		isUniversal() {
			return this.class === TAG_CLASS.UNIVERSAL;
		}
		isContextSpecific(num) {
			let res = this.class === TAG_CLASS.CONTEXT_SPECIFIC;
			return num === void 0 ? res : res && this.number === num;
		}
		isBoolean() {
			return this.isUniversal() && this.number === UNIVERSAL_TAG.BOOLEAN;
		}
		isInteger() {
			return this.isUniversal() && this.number === UNIVERSAL_TAG.INTEGER;
		}
		isBitString() {
			return this.isUniversal() && this.number === UNIVERSAL_TAG.BIT_STRING;
		}
		isOctetString() {
			return this.isUniversal() && this.number === UNIVERSAL_TAG.OCTET_STRING;
		}
		isOID() {
			return this.isUniversal() && this.number === UNIVERSAL_TAG.OBJECT_IDENTIFIER;
		}
		isUTCTime() {
			return this.isUniversal() && this.number === UNIVERSAL_TAG.UTC_TIME;
		}
		isGeneralizedTime() {
			return this.isUniversal() && this.number === UNIVERSAL_TAG.GENERALIZED_TIME;
		}
		toDER() {
			return this.number | (this.constructed ? 32 : 0) | this.class << 6;
		}
	};
})), require_obj = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.ASN1Obj = void 0;
	let stream_1 = require_stream(), error_1 = require_error$2(), length_1 = require_length(), parse_1 = require_parse(), tag_1 = require_tag();
	var ASN1Obj = class {
		tag;
		subs;
		value;
		constructor(tag, value, subs) {
			this.tag = tag, this.value = value, this.subs = subs;
		}
		static parseBuffer(buf) {
			let stream = new stream_1.ByteStream(buf), obj = parseStream(stream);
			if (stream.position !== stream.length) throw new error_1.ASN1ParseError("invalid trailing data");
			return obj;
		}
		toDER() {
			let valueStream = new stream_1.ByteStream();
			if (this.subs.length > 0) for (let sub of this.subs) valueStream.appendView(sub.toDER());
			else valueStream.appendView(this.value);
			let value = valueStream.buffer, obj = new stream_1.ByteStream();
			return obj.appendChar(this.tag.toDER()), obj.appendView((0, length_1.encodeLength)(value.length)), obj.appendView(value), obj.buffer;
		}
		toBoolean() {
			if (!this.tag.isBoolean()) throw new error_1.ASN1TypeError("not a boolean");
			return (0, parse_1.parseBoolean)(this.value);
		}
		toInteger() {
			if (!this.tag.isInteger()) throw new error_1.ASN1TypeError("not an integer");
			return (0, parse_1.parseInteger)(this.value);
		}
		toOID() {
			if (!this.tag.isOID()) throw new error_1.ASN1TypeError("not an OID");
			return (0, parse_1.parseOID)(this.value);
		}
		toDate() {
			switch (!0) {
				case this.tag.isUTCTime(): return (0, parse_1.parseTime)(this.value, !0);
				case this.tag.isGeneralizedTime(): return (0, parse_1.parseTime)(this.value, !1);
				default: throw new error_1.ASN1TypeError("not a date");
			}
		}
		toBitString() {
			if (!this.tag.isBitString()) throw new error_1.ASN1TypeError("not a bit string");
			return (0, parse_1.parseBitString)(this.value);
		}
	};
	exports.ASN1Obj = ASN1Obj;
	function parseStream(stream, depth = 0) {
		if (depth > 100) throw new error_1.ASN1ParseError("maximum nesting depth exceeded");
		let tag = new tag_1.ASN1Tag(stream.getUint8()), len = (0, length_1.decodeLength)(stream), value = stream.slice(stream.position, len), start = stream.position, subs = [];
		if (tag.constructed) subs = collectSubs(stream, len, depth);
		else if (tag.isOctetString()) try {
			subs = collectSubs(stream, len, depth);
		} catch {}
		return subs.length === 0 && stream.seek(start + len), new ASN1Obj(tag, value, subs);
	}
	function collectSubs(stream, len, depth) {
		let end = stream.position + len;
		/* istanbul ignore if */
		if (end > stream.length) throw new error_1.ASN1ParseError("invalid length");
		let subs = [];
		for (; stream.position < end;) subs.push(parseStream(stream, depth + 1));
		if (stream.position !== end) throw new error_1.ASN1ParseError("invalid length");
		return subs;
	}
})), require_asn1 = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.ASN1Obj = void 0;
	var obj_1 = require_obj();
	Object.defineProperty(exports, "ASN1Obj", {
		enumerable: !0,
		get: function() {
			return obj_1.ASN1Obj;
		}
	});
})), require_crypto = /* @__PURE__ */ __commonJSMin(((exports) => {
	var __importDefault = exports && exports.__importDefault || function(mod) {
		return mod && mod.__esModule ? mod : { default: mod };
	};
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.createPublicKey = createPublicKey, exports.digest = digest, exports.verify = verify, exports.bufferEqual = bufferEqual;
	let crypto_1 = __importDefault(require("crypto"));
	function createPublicKey(key, type = "spki") {
		return typeof key == "string" ? key.startsWith("-----") ? crypto_1.default.createPublicKey(key) : crypto_1.default.createPublicKey({
			key: Buffer.from(key, "base64"),
			format: "der",
			type
		}) : crypto_1.default.createPublicKey({
			key,
			format: "der",
			type
		});
	}
	function digest(algorithm, ...data) {
		let hash = crypto_1.default.createHash(algorithm);
		for (let d of data) hash.update(d);
		return hash.digest();
	}
	function verify(data, key, signature, algorithm) {
		try {
			return crypto_1.default.verify(algorithm, data, key, signature);
		} catch {
			/* istanbul ignore next */
			return !1;
		}
	}
	function bufferEqual(a, b) {
		try {
			return crypto_1.default.timingSafeEqual(a, b);
		} catch {
			/* istanbul ignore next */
			return !1;
		}
	}
})), require_dsse$3 = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.preAuthEncoding = preAuthEncoding;
	function preAuthEncoding(payloadType, payload) {
		let typeBytes = Buffer.from(payloadType, "utf-8");
		return Buffer.concat([
			Buffer.from(`DSSEv1 ${typeBytes.length} `, "ascii"),
			typeBytes,
			Buffer.from(` ${payload.length} `, "ascii"),
			payload
		]);
	}
})), require_encoding = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.base64Encode = base64Encode, exports.base64Decode = base64Decode;
	let BASE64_ENCODING = "base64", UTF8_ENCODING = "utf-8";
	function base64Encode(str) {
		return Buffer.from(str, UTF8_ENCODING).toString(BASE64_ENCODING);
	}
	function base64Decode(str) {
		return Buffer.from(str, BASE64_ENCODING).toString(UTF8_ENCODING);
	}
})), require_json = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.canonicalize = canonicalize;
	function canonicalize(object) {
		let buffer = "";
		if (typeof object != "object" || !object || object.toJSON != null) buffer += JSON.stringify(object);
		else if (Array.isArray(object)) {
			buffer += "[";
			let first = !0;
			object.forEach((element) => {
				first || (buffer += ","), first = !1, buffer += canonicalize(element);
			}), buffer += "]";
		} else {
			buffer += "{";
			let first = !0;
			Object.keys(object).sort().forEach((property) => {
				first || (buffer += ","), first = !1, buffer += JSON.stringify(property), buffer += ":", buffer += canonicalize(object[property]);
			}), buffer += "}";
		}
		return buffer;
	}
})), require_pem = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.toDER = toDER, exports.fromDER = fromDER;
	let PEM_HEADER = /-----BEGIN (.*)-----/, PEM_FOOTER = /-----END (.*)-----/;
	function toDER(certificate) {
		let der = "";
		return certificate.split("\n").forEach((line) => {
			line.match(PEM_HEADER) || line.match(PEM_FOOTER) || (der += line);
		}), Buffer.from(der, "base64");
	}
	function fromDER(certificate, type = "CERTIFICATE") {
		let lines = certificate.toString("base64").match(/.{1,64}/g) || "";
		return [
			`-----BEGIN ${type}-----`,
			...lines,
			`-----END ${type}-----`
		].join("\n").concat("\n");
	}
})), require_oid = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.SHA2_HASH_ALGOS = exports.RSA_SIGNATURE_ALGOS = exports.ECDSA_SIGNATURE_ALGOS = void 0, exports.ECDSA_SIGNATURE_ALGOS = {
		"1.2.840.10045.4.3.1": "sha224",
		"1.2.840.10045.4.3.2": "sha256",
		"1.2.840.10045.4.3.3": "sha384",
		"1.2.840.10045.4.3.4": "sha512"
	}, exports.RSA_SIGNATURE_ALGOS = {
		"1.2.840.113549.1.1.14": "sha224",
		"1.2.840.113549.1.1.11": "sha256",
		"1.2.840.113549.1.1.12": "sha384",
		"1.2.840.113549.1.1.13": "sha512"
	}, exports.SHA2_HASH_ALGOS = {
		"2.16.840.1.101.3.4.2.1": "sha256",
		"2.16.840.1.101.3.4.2.2": "sha384",
		"2.16.840.1.101.3.4.2.3": "sha512"
	};
})), require_error$1 = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.RFC3161TimestampVerificationError = void 0, exports.RFC3161TimestampVerificationError = class extends Error {};
})), require_tstinfo = /* @__PURE__ */ __commonJSMin(((exports) => {
	var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
		k2 === void 0 && (k2 = k);
		var desc = Object.getOwnPropertyDescriptor(m, k);
		(!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) && (desc = {
			enumerable: !0,
			get: function() {
				return m[k];
			}
		}), Object.defineProperty(o, k2, desc);
	}) : (function(o, m, k, k2) {
		k2 === void 0 && (k2 = k), o[k2] = m[k];
	})), __setModuleDefault = exports && exports.__setModuleDefault || (Object.create ? (function(o, v) {
		Object.defineProperty(o, "default", {
			enumerable: !0,
			value: v
		});
	}) : function(o, v) {
		o.default = v;
	}), __importStar = exports && exports.__importStar || (function() {
		var ownKeys = function(o) {
			return ownKeys = Object.getOwnPropertyNames || function(o) {
				var ar = [];
				for (var k in o) Object.prototype.hasOwnProperty.call(o, k) && (ar[ar.length] = k);
				return ar;
			}, ownKeys(o);
		};
		return function(mod) {
			if (mod && mod.__esModule) return mod;
			var result = {};
			if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) k[i] !== "default" && __createBinding(result, mod, k[i]);
			return __setModuleDefault(result, mod), result;
		};
	})();
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.TSTInfo = void 0;
	let crypto = __importStar(require_crypto()), oid_1 = require_oid(), error_1 = require_error$1();
	exports.TSTInfo = class {
		root;
		constructor(asn1) {
			this.root = asn1;
		}
		get version() {
			return this.root.subs[0].toInteger();
		}
		get genTime() {
			return this.root.subs[4].toDate();
		}
		get messageImprintHashAlgorithm() {
			let oid = this.messageImprintObj.subs[0].subs[0].toOID();
			return oid_1.SHA2_HASH_ALGOS[oid];
		}
		get messageImprintHashedMessage() {
			return this.messageImprintObj.subs[1].value;
		}
		get raw() {
			return this.root.toDER();
		}
		verify(data) {
			let digest = crypto.digest(this.messageImprintHashAlgorithm, data);
			if (!crypto.bufferEqual(digest, this.messageImprintHashedMessage)) throw new error_1.RFC3161TimestampVerificationError("message imprint does not match artifact");
		}
		get messageImprintObj() {
			return this.root.subs[2];
		}
	};
})), require_timestamp$1 = /* @__PURE__ */ __commonJSMin(((exports) => {
	var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
		k2 === void 0 && (k2 = k);
		var desc = Object.getOwnPropertyDescriptor(m, k);
		(!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) && (desc = {
			enumerable: !0,
			get: function() {
				return m[k];
			}
		}), Object.defineProperty(o, k2, desc);
	}) : (function(o, m, k, k2) {
		k2 === void 0 && (k2 = k), o[k2] = m[k];
	})), __setModuleDefault = exports && exports.__setModuleDefault || (Object.create ? (function(o, v) {
		Object.defineProperty(o, "default", {
			enumerable: !0,
			value: v
		});
	}) : function(o, v) {
		o.default = v;
	}), __importStar = exports && exports.__importStar || (function() {
		var ownKeys = function(o) {
			return ownKeys = Object.getOwnPropertyNames || function(o) {
				var ar = [];
				for (var k in o) Object.prototype.hasOwnProperty.call(o, k) && (ar[ar.length] = k);
				return ar;
			}, ownKeys(o);
		};
		return function(mod) {
			if (mod && mod.__esModule) return mod;
			var result = {};
			if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) k[i] !== "default" && __createBinding(result, mod, k[i]);
			return __setModuleDefault(result, mod), result;
		};
	})();
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.RFC3161Timestamp = void 0;
	let asn1_1 = require_asn1(), crypto = __importStar(require_crypto()), oid_1 = require_oid(), error_1 = require_error$1(), tstinfo_1 = require_tstinfo();
	exports.RFC3161Timestamp = class RFC3161Timestamp {
		root;
		constructor(asn1) {
			this.root = asn1;
		}
		static parse(der) {
			let asn1 = asn1_1.ASN1Obj.parseBuffer(der);
			return new RFC3161Timestamp(asn1);
		}
		get status() {
			return this.pkiStatusInfoObj.subs[0].toInteger();
		}
		get contentType() {
			return this.contentTypeObj.toOID();
		}
		get eContentType() {
			return this.eContentTypeObj.toOID();
		}
		get signingTime() {
			return this.tstInfo.genTime;
		}
		get signerIssuer() {
			return this.signerSidObj.subs[0].value;
		}
		get signerSerialNumber() {
			return this.signerSidObj.subs[1].value;
		}
		get signerDigestAlgorithm() {
			let oid = this.signerDigestAlgorithmObj.subs[0].toOID();
			return oid_1.SHA2_HASH_ALGOS[oid];
		}
		get signatureAlgorithm() {
			let oid = this.signatureAlgorithmObj.subs[0].toOID();
			return oid_1.ECDSA_SIGNATURE_ALGOS[oid];
		}
		get signatureValue() {
			return this.signatureValueObj.value;
		}
		get tstInfo() {
			return new tstinfo_1.TSTInfo(this.eContentObj.subs[0].subs[0]);
		}
		verify(data, publicKey) {
			if (!this.timeStampTokenObj) throw new error_1.RFC3161TimestampVerificationError("timeStampToken is missing");
			if (this.contentType !== "1.2.840.113549.1.7.2") throw new error_1.RFC3161TimestampVerificationError(`incorrect content type: ${this.contentType}`);
			if (this.eContentType !== "1.2.840.113549.1.9.16.1.4") throw new error_1.RFC3161TimestampVerificationError(`incorrect encapsulated content type: ${this.eContentType}`);
			this.tstInfo.verify(data), this.verifyMessageDigest(), this.verifySignature(publicKey);
		}
		verifyMessageDigest() {
			let tstInfoDigest = crypto.digest(this.signerDigestAlgorithm, this.tstInfo.raw), expectedDigest = this.messageDigestAttributeObj.subs[1].subs[0].value;
			if (!crypto.bufferEqual(tstInfoDigest, expectedDigest)) throw new error_1.RFC3161TimestampVerificationError("signed data does not match tstInfo");
		}
		verifySignature(key) {
			let signedAttrs = this.signedAttrsObj.toDER();
			if (signedAttrs[0] = 49, !crypto.verify(signedAttrs, key, this.signatureValue, this.signatureAlgorithm)) throw new error_1.RFC3161TimestampVerificationError("signature verification failed");
		}
		get pkiStatusInfoObj() {
			return this.root.subs[0];
		}
		get timeStampTokenObj() {
			return this.root.subs[1];
		}
		get contentTypeObj() {
			return this.timeStampTokenObj.subs[0];
		}
		get signedDataObj() {
			return this.timeStampTokenObj.subs.find((sub) => sub.tag.isContextSpecific(0)).subs[0];
		}
		get encapContentInfoObj() {
			return this.signedDataObj.subs[2];
		}
		get signerInfosObj() {
			let sd = this.signedDataObj;
			return sd.subs[sd.subs.length - 1];
		}
		get signerInfoObj() {
			return this.signerInfosObj.subs[0];
		}
		get eContentTypeObj() {
			return this.encapContentInfoObj.subs[0];
		}
		get eContentObj() {
			return this.encapContentInfoObj.subs[1];
		}
		get signedAttrsObj() {
			return this.signerInfoObj.subs.find((sub) => sub.tag.isContextSpecific(0));
		}
		get messageDigestAttributeObj() {
			return this.signedAttrsObj.subs.find((sub) => sub.subs[0].tag.isOID() && sub.subs[0].toOID() === "1.2.840.113549.1.9.4");
		}
		get signerSidObj() {
			return this.signerInfoObj.subs[1];
		}
		get signerDigestAlgorithmObj() {
			return this.signerInfoObj.subs[2];
		}
		get signatureAlgorithmObj() {
			return this.signerInfoObj.subs[4];
		}
		get signatureValueObj() {
			return this.signerInfoObj.subs[5];
		}
	};
})), require_rfc3161 = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.RFC3161Timestamp = void 0;
	var timestamp_1 = require_timestamp$1();
	Object.defineProperty(exports, "RFC3161Timestamp", {
		enumerable: !0,
		get: function() {
			return timestamp_1.RFC3161Timestamp;
		}
	});
})), require_sct$1 = /* @__PURE__ */ __commonJSMin(((exports) => {
	var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
		k2 === void 0 && (k2 = k);
		var desc = Object.getOwnPropertyDescriptor(m, k);
		(!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) && (desc = {
			enumerable: !0,
			get: function() {
				return m[k];
			}
		}), Object.defineProperty(o, k2, desc);
	}) : (function(o, m, k, k2) {
		k2 === void 0 && (k2 = k), o[k2] = m[k];
	})), __setModuleDefault = exports && exports.__setModuleDefault || (Object.create ? (function(o, v) {
		Object.defineProperty(o, "default", {
			enumerable: !0,
			value: v
		});
	}) : function(o, v) {
		o.default = v;
	}), __importStar = exports && exports.__importStar || (function() {
		var ownKeys = function(o) {
			return ownKeys = Object.getOwnPropertyNames || function(o) {
				var ar = [];
				for (var k in o) Object.prototype.hasOwnProperty.call(o, k) && (ar[ar.length] = k);
				return ar;
			}, ownKeys(o);
		};
		return function(mod) {
			if (mod && mod.__esModule) return mod;
			var result = {};
			if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) k[i] !== "default" && __createBinding(result, mod, k[i]);
			return __setModuleDefault(result, mod), result;
		};
	})();
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.SignedCertificateTimestamp = void 0;
	let crypto = __importStar(require_crypto()), stream_1 = require_stream();
	exports.SignedCertificateTimestamp = class SignedCertificateTimestamp {
		version;
		logID;
		timestamp;
		extensions;
		hashAlgorithm;
		signatureAlgorithm;
		signature;
		constructor(options) {
			this.version = options.version, this.logID = options.logID, this.timestamp = options.timestamp, this.extensions = options.extensions, this.hashAlgorithm = options.hashAlgorithm, this.signatureAlgorithm = options.signatureAlgorithm, this.signature = options.signature;
		}
		get datetime() {
			return new Date(Number(this.timestamp.readBigInt64BE()));
		}
		get algorithm() {
			switch (this.hashAlgorithm) {
				/* istanbul ignore next */
				case 0: return "none";
				/* istanbul ignore next */
				case 1: return "md5";
				/* istanbul ignore next */
				case 2: return "sha1";
				/* istanbul ignore next */
				case 3: return "sha224";
				case 4: return "sha256";
				/* istanbul ignore next */
				case 5: return "sha384";
				/* istanbul ignore next */
				case 6: return "sha512";
				/* istanbul ignore next */
				default: return "unknown";
			}
		}
		verify(preCert, key) {
			let stream = new stream_1.ByteStream();
			return stream.appendChar(this.version), stream.appendChar(0), stream.appendView(this.timestamp), stream.appendUint16(1), stream.appendView(preCert), stream.appendUint16(this.extensions.byteLength), this.extensions.byteLength > 0 && stream.appendView(this.extensions), crypto.verify(stream.buffer, key, this.signature, this.algorithm);
		}
		static parse(buf) {
			let stream = new stream_1.ByteStream(buf), version = stream.getUint8(), logID = stream.getBlock(32), timestamp = stream.getBlock(8), extenstionLength = stream.getUint16(), extensions = stream.getBlock(extenstionLength), hashAlgorithm = stream.getUint8(), signatureAlgorithm = stream.getUint8(), sigLength = stream.getUint16(), signature = stream.getBlock(sigLength);
			if (stream.position !== buf.length) throw Error("SCT buffer length mismatch");
			return new SignedCertificateTimestamp({
				version,
				logID,
				timestamp,
				extensions,
				hashAlgorithm,
				signatureAlgorithm,
				signature
			});
		}
	};
})), require_ext = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.X509SCTExtension = exports.X509SubjectKeyIDExtension = exports.X509AuthorityKeyIDExtension = exports.X509SubjectAlternativeNameExtension = exports.X509KeyUsageExtension = exports.X509BasicConstraintsExtension = exports.X509Extension = void 0;
	let stream_1 = require_stream(), sct_1 = require_sct$1();
	var X509Extension = class {
		root;
		constructor(asn1) {
			this.root = asn1;
		}
		get oid() {
			return this.root.subs[0].toOID();
		}
		get critical() {
			return this.root.subs.length === 3 && this.root.subs[1].toBoolean();
		}
		get value() {
			return this.extnValueObj.value;
		}
		get valueObj() {
			return this.extnValueObj;
		}
		get extnValueObj() {
			return this.root.subs[this.root.subs.length - 1];
		}
	};
	exports.X509Extension = X509Extension, exports.X509BasicConstraintsExtension = class extends X509Extension {
		get isCA() {
			return this.sequence.subs[0]?.toBoolean() ?? !1;
		}
		get pathLenConstraint() {
			return this.sequence.subs.length > 1 ? this.sequence.subs[1].toInteger() : void 0;
		}
		get sequence() {
			return this.extnValueObj.subs[0];
		}
	}, exports.X509KeyUsageExtension = class extends X509Extension {
		get digitalSignature() {
			return this.bitString[0] === 1;
		}
		get keyCertSign() {
			return this.bitString[5] === 1;
		}
		get crlSign() {
			return this.bitString[6] === 1;
		}
		get bitString() {
			return this.extnValueObj.subs[0].toBitString();
		}
	}, exports.X509SubjectAlternativeNameExtension = class extends X509Extension {
		get rfc822Name() {
			return this.findGeneralName(1)?.value.toString("ascii");
		}
		get uri() {
			return this.findGeneralName(6)?.value.toString("ascii");
		}
		otherName(oid) {
			let otherName = this.findGeneralName(0);
			if (otherName !== void 0 && otherName.subs[0].toOID() === oid) return otherName.subs[1].subs[0].value.toString("ascii");
		}
		findGeneralName(tag) {
			return this.generalNames.find((gn) => gn.tag.isContextSpecific(tag));
		}
		get generalNames() {
			return this.extnValueObj.subs[0].subs;
		}
	}, exports.X509AuthorityKeyIDExtension = class extends X509Extension {
		get keyIdentifier() {
			return this.findSequenceMember(0)?.value;
		}
		findSequenceMember(tag) {
			return this.sequence.subs.find((el) => el.tag.isContextSpecific(tag));
		}
		get sequence() {
			return this.extnValueObj.subs[0];
		}
	}, exports.X509SubjectKeyIDExtension = class extends X509Extension {
		get keyIdentifier() {
			return this.extnValueObj.subs[0].value;
		}
	}, exports.X509SCTExtension = class extends X509Extension {
		constructor(asn1) {
			super(asn1);
		}
		get signedCertificateTimestamps() {
			let buf = this.extnValueObj.subs[0].value, stream = new stream_1.ByteStream(buf), end = stream.getUint16() + 2, sctList = [];
			for (; stream.position < end;) {
				let sctLength = stream.getUint16(), sct = stream.getBlock(sctLength);
				sctList.push(sct_1.SignedCertificateTimestamp.parse(sct));
			}
			if (stream.position !== end) throw Error("SCT list length does not match actual length");
			return sctList;
		}
	};
})), require_cert = /* @__PURE__ */ __commonJSMin(((exports) => {
	var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
		k2 === void 0 && (k2 = k);
		var desc = Object.getOwnPropertyDescriptor(m, k);
		(!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) && (desc = {
			enumerable: !0,
			get: function() {
				return m[k];
			}
		}), Object.defineProperty(o, k2, desc);
	}) : (function(o, m, k, k2) {
		k2 === void 0 && (k2 = k), o[k2] = m[k];
	})), __setModuleDefault = exports && exports.__setModuleDefault || (Object.create ? (function(o, v) {
		Object.defineProperty(o, "default", {
			enumerable: !0,
			value: v
		});
	}) : function(o, v) {
		o.default = v;
	}), __importStar = exports && exports.__importStar || (function() {
		var ownKeys = function(o) {
			return ownKeys = Object.getOwnPropertyNames || function(o) {
				var ar = [];
				for (var k in o) Object.prototype.hasOwnProperty.call(o, k) && (ar[ar.length] = k);
				return ar;
			}, ownKeys(o);
		};
		return function(mod) {
			if (mod && mod.__esModule) return mod;
			var result = {};
			if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) k[i] !== "default" && __createBinding(result, mod, k[i]);
			return __setModuleDefault(result, mod), result;
		};
	})();
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.X509Certificate = exports.EXTENSION_OID_SCT = void 0;
	let asn1_1 = require_asn1(), crypto = __importStar(require_crypto()), oid_1 = require_oid(), pem = __importStar(require_pem()), ext_1 = require_ext();
	exports.EXTENSION_OID_SCT = "1.3.6.1.4.1.11129.2.4.2", exports.X509Certificate = class X509Certificate {
		root;
		constructor(asn1) {
			this.root = asn1;
		}
		static parse(cert) {
			let der = typeof cert == "string" ? pem.toDER(cert) : cert, asn1 = asn1_1.ASN1Obj.parseBuffer(der);
			return new X509Certificate(asn1);
		}
		get tbsCertificate() {
			return this.tbsCertificateObj;
		}
		get version() {
			return `v${(this.versionObj.subs[0].toInteger() + BigInt(1)).toString()}`;
		}
		get serialNumber() {
			return this.serialNumberObj.value;
		}
		get notBefore() {
			return this.validityObj.subs[0].toDate();
		}
		get notAfter() {
			return this.validityObj.subs[1].toDate();
		}
		get issuer() {
			return this.issuerObj.value;
		}
		get subject() {
			return this.subjectObj.value;
		}
		get publicKey() {
			return this.subjectPublicKeyInfoObj.toDER();
		}
		get signatureAlgorithm() {
			let oid = this.signatureAlgorithmObj.subs[0].toOID();
			return oid_1.RSA_SIGNATURE_ALGOS[oid] ? oid_1.RSA_SIGNATURE_ALGOS[oid] : oid_1.ECDSA_SIGNATURE_ALGOS[oid];
		}
		get signatureValue() {
			return this.signatureValueObj.value.subarray(1);
		}
		get subjectAltName() {
			let ext = this.extSubjectAltName;
			return ext?.uri || ext?.rfc822Name;
		}
		get extensions() {
			/* istanbul ignore next */
			return this.extensionsObj?.subs[0]?.subs || [];
		}
		get extKeyUsage() {
			let ext = this.findExtension("2.5.29.15");
			return ext ? new ext_1.X509KeyUsageExtension(ext) : void 0;
		}
		get extBasicConstraints() {
			let ext = this.findExtension("2.5.29.19");
			return ext ? new ext_1.X509BasicConstraintsExtension(ext) : void 0;
		}
		get extSubjectAltName() {
			let ext = this.findExtension("2.5.29.17");
			return ext ? new ext_1.X509SubjectAlternativeNameExtension(ext) : void 0;
		}
		get extAuthorityKeyID() {
			let ext = this.findExtension("2.5.29.35");
			return ext ? new ext_1.X509AuthorityKeyIDExtension(ext) : void 0;
		}
		get extSubjectKeyID() {
			let ext = this.findExtension("2.5.29.14");
			return ext ? new ext_1.X509SubjectKeyIDExtension(ext) : 			/* istanbul ignore next */ void 0;
		}
		get extSCT() {
			let ext = this.findExtension(exports.EXTENSION_OID_SCT);
			return ext ? new ext_1.X509SCTExtension(ext) : void 0;
		}
		get isCA() {
			let ca = this.extBasicConstraints?.isCA || !1;
			/* istanbul ignore next */
			return this.extKeyUsage ? ca && this.extKeyUsage.keyCertSign : ca;
		}
		extension(oid) {
			let ext = this.findExtension(oid);
			return ext ? new ext_1.X509Extension(ext) : void 0;
		}
		verify(issuerCertificate) {
			let publicKey = issuerCertificate?.publicKey || this.publicKey, key = crypto.createPublicKey(publicKey);
			return crypto.verify(this.tbsCertificate.toDER(), key, this.signatureValue, this.signatureAlgorithm);
		}
		validForDate(date) {
			return this.notBefore <= date && date <= this.notAfter;
		}
		equals(other) {
			return this.root.toDER().equals(other.root.toDER());
		}
		clone() {
			let der = this.root.toDER(), clone = Buffer.alloc(der.length);
			return der.copy(clone), X509Certificate.parse(clone);
		}
		findExtension(oid) {
			return this.extensions.find((ext) => ext.subs[0].toOID() === oid);
		}
		get tbsCertificateObj() {
			return this.root.subs[0];
		}
		get signatureAlgorithmObj() {
			return this.root.subs[1];
		}
		get signatureValueObj() {
			return this.root.subs[2];
		}
		get versionObj() {
			return this.tbsCertificateObj.subs[0];
		}
		get serialNumberObj() {
			return this.tbsCertificateObj.subs[1];
		}
		get issuerObj() {
			return this.tbsCertificateObj.subs[3];
		}
		get validityObj() {
			return this.tbsCertificateObj.subs[4];
		}
		get subjectObj() {
			return this.tbsCertificateObj.subs[5];
		}
		get subjectPublicKeyInfoObj() {
			return this.tbsCertificateObj.subs[6];
		}
		get extensionsObj() {
			return this.tbsCertificateObj.subs.find((sub) => sub.tag.isContextSpecific(3));
		}
	};
})), require_x509 = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.X509SCTExtension = exports.X509Certificate = exports.EXTENSION_OID_SCT = void 0;
	var cert_1 = require_cert();
	Object.defineProperty(exports, "EXTENSION_OID_SCT", {
		enumerable: !0,
		get: function() {
			return cert_1.EXTENSION_OID_SCT;
		}
	}), Object.defineProperty(exports, "X509Certificate", {
		enumerable: !0,
		get: function() {
			return cert_1.X509Certificate;
		}
	});
	var ext_1 = require_ext();
	Object.defineProperty(exports, "X509SCTExtension", {
		enumerable: !0,
		get: function() {
			return ext_1.X509SCTExtension;
		}
	});
})), require_dist$1 = /* @__PURE__ */ __commonJSMin(((exports) => {
	var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
		k2 === void 0 && (k2 = k);
		var desc = Object.getOwnPropertyDescriptor(m, k);
		(!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) && (desc = {
			enumerable: !0,
			get: function() {
				return m[k];
			}
		}), Object.defineProperty(o, k2, desc);
	}) : (function(o, m, k, k2) {
		k2 === void 0 && (k2 = k), o[k2] = m[k];
	})), __setModuleDefault = exports && exports.__setModuleDefault || (Object.create ? (function(o, v) {
		Object.defineProperty(o, "default", {
			enumerable: !0,
			value: v
		});
	}) : function(o, v) {
		o.default = v;
	}), __importStar = exports && exports.__importStar || (function() {
		var ownKeys = function(o) {
			return ownKeys = Object.getOwnPropertyNames || function(o) {
				var ar = [];
				for (var k in o) Object.prototype.hasOwnProperty.call(o, k) && (ar[ar.length] = k);
				return ar;
			}, ownKeys(o);
		};
		return function(mod) {
			if (mod && mod.__esModule) return mod;
			var result = {};
			if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) k[i] !== "default" && __createBinding(result, mod, k[i]);
			return __setModuleDefault(result, mod), result;
		};
	})();
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.X509SCTExtension = exports.X509Certificate = exports.EXTENSION_OID_SCT = exports.ByteStream = exports.RFC3161Timestamp = exports.pem = exports.json = exports.encoding = exports.dsse = exports.crypto = exports.ASN1Obj = void 0;
	var asn1_1 = require_asn1();
	Object.defineProperty(exports, "ASN1Obj", {
		enumerable: !0,
		get: function() {
			return asn1_1.ASN1Obj;
		}
	}), exports.crypto = __importStar(require_crypto()), exports.dsse = __importStar(require_dsse$3()), exports.encoding = __importStar(require_encoding()), exports.json = __importStar(require_json()), exports.pem = __importStar(require_pem());
	var rfc3161_1 = require_rfc3161();
	Object.defineProperty(exports, "RFC3161Timestamp", {
		enumerable: !0,
		get: function() {
			return rfc3161_1.RFC3161Timestamp;
		}
	});
	var stream_1 = require_stream();
	Object.defineProperty(exports, "ByteStream", {
		enumerable: !0,
		get: function() {
			return stream_1.ByteStream;
		}
	});
	var x509_1 = require_x509();
	Object.defineProperty(exports, "EXTENSION_OID_SCT", {
		enumerable: !0,
		get: function() {
			return x509_1.EXTENSION_OID_SCT;
		}
	}), Object.defineProperty(exports, "X509Certificate", {
		enumerable: !0,
		get: function() {
			return x509_1.X509Certificate;
		}
	}), Object.defineProperty(exports, "X509SCTExtension", {
		enumerable: !0,
		get: function() {
			return x509_1.X509SCTExtension;
		}
	});
})), require_dsse$2 = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.DSSESignatureContent = void 0;
	let core_1 = require_dist$1();
	exports.DSSESignatureContent = class {
		env;
		constructor(env) {
			this.env = env;
		}
		compareDigest(digest) {
			return core_1.crypto.bufferEqual(digest, core_1.crypto.digest("sha256", this.env.payload));
		}
		compareSignedDigest(digest) {
			return core_1.crypto.bufferEqual(digest, core_1.crypto.digest("sha256", this.preAuthEncoding));
		}
		compareSignature(signature) {
			return core_1.crypto.bufferEqual(signature, this.signature);
		}
		verifySignature(key) {
			return core_1.crypto.verify(this.preAuthEncoding, key, this.signature);
		}
		get signature() {
			return this.env.signatures.length > 0 ? this.env.signatures[0].sig : Buffer.from("");
		}
		get preAuthEncoding() {
			return core_1.dsse.preAuthEncoding(this.env.payloadType, this.env.payload);
		}
	};
})), require_message = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.MessageSignatureContent = void 0;
	let core_1 = require_dist$1(), protobuf_specs_1 = require_dist$6(), HASH_ALGORITHM_MAP = {
		[protobuf_specs_1.HashAlgorithm.HASH_ALGORITHM_UNSPECIFIED]: "sha256",
		[protobuf_specs_1.HashAlgorithm.SHA2_256]: "sha256",
		[protobuf_specs_1.HashAlgorithm.SHA2_384]: "sha384",
		[protobuf_specs_1.HashAlgorithm.SHA2_512]: "sha512",
		[protobuf_specs_1.HashAlgorithm.SHA3_256]: "sha3-256",
		[protobuf_specs_1.HashAlgorithm.SHA3_384]: "sha3-384"
	};
	exports.MessageSignatureContent = class {
		signature;
		messageDigest;
		artifact;
		hashAlgorithm;
		constructor(messageSignature, artifact) {
			this.signature = messageSignature.signature, this.messageDigest = messageSignature.messageDigest.digest, this.artifact = artifact, this.hashAlgorithm = HASH_ALGORITHM_MAP[messageSignature.messageDigest.algorithm] ?? "sha256";
		}
		compareSignature(signature) {
			return core_1.crypto.bufferEqual(signature, this.signature);
		}
		compareDigest(digest) {
			return core_1.crypto.bufferEqual(digest, this.messageDigest);
		}
		compareSignedDigest(digest) {
			return this.compareDigest(digest);
		}
		verifySignature(key) {
			return core_1.crypto.verify(this.artifact, key, this.signature, this.hashAlgorithm);
		}
	};
})), require_bundle = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.toSignedEntity = toSignedEntity, exports.signatureContent = signatureContent;
	let core_1 = require_dist$1(), dsse_1 = require_dsse$2(), message_1 = require_message();
	function toSignedEntity(bundle, artifact) {
		let { tlogEntries, timestampVerificationData } = bundle.verificationMaterial, timestamps = [];
		for (let entry of tlogEntries) entry.integratedTime && entry.integratedTime !== "0" && timestamps.push({
			$case: "transparency-log",
			tlogEntry: entry
		});
		for (let ts of timestampVerificationData?.rfc3161Timestamps ?? []) timestamps.push({
			$case: "timestamp-authority",
			timestamp: core_1.RFC3161Timestamp.parse(Buffer.from(ts.signedTimestamp))
		});
		return {
			signature: signatureContent(bundle, artifact),
			key: key(bundle),
			tlogEntries,
			timestamps
		};
	}
	function signatureContent(bundle, artifact) {
		switch (bundle.content.$case) {
			case "dsseEnvelope": return new dsse_1.DSSESignatureContent(bundle.content.dsseEnvelope);
			case "messageSignature": return new message_1.MessageSignatureContent(bundle.content.messageSignature, artifact);
		}
	}
	function key(bundle) {
		switch (bundle.verificationMaterial.content.$case) {
			case "publicKey": return {
				$case: "public-key",
				hint: bundle.verificationMaterial.content.publicKey.hint
			};
			case "x509CertificateChain": return {
				$case: "certificate",
				certificate: core_1.X509Certificate.parse(Buffer.from(bundle.verificationMaterial.content.x509CertificateChain.certificates[0].rawBytes))
			};
			case "certificate": return {
				$case: "certificate",
				certificate: core_1.X509Certificate.parse(Buffer.from(bundle.verificationMaterial.content.certificate.rawBytes))
			};
		}
	}
})), require_error = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.PolicyError = exports.VerificationError = void 0;
	var BaseError = class extends Error {
		code;
		cause;
		constructor({ code, message, cause }) {
			super(message), this.code = code, this.cause = cause, this.name = this.constructor.name;
		}
	};
	exports.VerificationError = class extends BaseError {}, exports.PolicyError = class extends BaseError {};
})), require_filter = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.filterCertAuthorities = filterCertAuthorities, exports.filterTLogAuthorities = filterTLogAuthorities;
	function filterCertAuthorities(certAuthorities, timestamp) {
		return certAuthorities.filter((ca) => ca.validFor.start <= timestamp && ca.validFor.end >= timestamp);
	}
	function filterTLogAuthorities(tlogAuthorities, criteria) {
		return tlogAuthorities.filter((tlog) => criteria.logID && !tlog.logID.equals(criteria.logID) ? !1 : tlog.validFor.start <= criteria.targetDate && criteria.targetDate <= tlog.validFor.end);
	}
})), require_trust = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.filterTLogAuthorities = exports.filterCertAuthorities = void 0, exports.toTrustMaterial = toTrustMaterial;
	let core_1 = require_dist$1(), protobuf_specs_1 = require_dist$6(), error_1 = require_error(), BEGINNING_OF_TIME = /* @__PURE__ */ new Date(0), END_OF_TIME = /* @__PURE__ */ new Date(864e13);
	var filter_1 = require_filter();
	Object.defineProperty(exports, "filterCertAuthorities", {
		enumerable: !0,
		get: function() {
			return filter_1.filterCertAuthorities;
		}
	}), Object.defineProperty(exports, "filterTLogAuthorities", {
		enumerable: !0,
		get: function() {
			return filter_1.filterTLogAuthorities;
		}
	});
	function toTrustMaterial(root, keys) {
		let keyFinder = typeof keys == "function" ? keys : keyLocator(keys);
		return {
			certificateAuthorities: root.certificateAuthorities.map(createCertAuthority),
			timestampAuthorities: root.timestampAuthorities.map(createCertAuthority),
			tlogs: root.tlogs.map(createTLogAuthority),
			ctlogs: root.ctlogs.map(createTLogAuthority),
			publicKey: keyFinder
		};
	}
	function createTLogAuthority(tlogInstance) {
		let keyDetails = tlogInstance.publicKey.keyDetails, keyType = keyDetails === protobuf_specs_1.PublicKeyDetails.PKCS1_RSA_PKCS1V5 || keyDetails === protobuf_specs_1.PublicKeyDetails.PKIX_RSA_PKCS1V5 || keyDetails === protobuf_specs_1.PublicKeyDetails.PKIX_RSA_PKCS1V15_2048_SHA256 || keyDetails === protobuf_specs_1.PublicKeyDetails.PKIX_RSA_PKCS1V15_3072_SHA256 || keyDetails === protobuf_specs_1.PublicKeyDetails.PKIX_RSA_PKCS1V15_4096_SHA256 ? "pkcs1" : "spki";
		/* istanbul ignore next */
		return {
			baseURL: tlogInstance.baseUrl,
			logID: tlogInstance.checkpointKeyId ? tlogInstance.checkpointKeyId.keyId : tlogInstance.logId.keyId,
			publicKey: core_1.crypto.createPublicKey(tlogInstance.publicKey.rawBytes, keyType),
			validFor: {
				start: tlogInstance.publicKey.validFor?.start || BEGINNING_OF_TIME,
				end: tlogInstance.publicKey.validFor?.end || END_OF_TIME
			}
		};
	}
	function createCertAuthority(ca) {
		/* istanbul ignore next */
		return {
			certChain: ca.certChain.certificates.map((cert) => core_1.X509Certificate.parse(Buffer.from(cert.rawBytes))),
			validFor: {
				start: ca.validFor?.start || BEGINNING_OF_TIME,
				end: ca.validFor?.end || END_OF_TIME
			}
		};
	}
	function keyLocator(keys) {
		return (hint) => {
			let key = (keys || {})[hint];
			if (!key) throw new error_1.VerificationError({
				code: "PUBLIC_KEY_ERROR",
				message: `key not found: ${hint}`
			});
			return {
				publicKey: core_1.crypto.createPublicKey(key.rawBytes),
				validFor: (date) => (key.validFor?.start || BEGINNING_OF_TIME) <= date && (key.validFor?.end || END_OF_TIME) >= date
			};
		};
	}
})), require_certificate = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.CertificateChainVerifier = void 0, exports.verifyCertificateChain = verifyCertificateChain;
	let error_1 = require_error(), trust_1 = require_trust();
	function verifyCertificateChain(timestamp, leaf, certificateAuthorities) {
		let cas = (0, trust_1.filterCertAuthorities)(certificateAuthorities, timestamp), error;
		for (let ca of cas) try {
			return new CertificateChainVerifier({
				trustedCerts: ca.certChain,
				untrustedCert: leaf,
				timestamp
			}).verify();
		} catch (err) {
			error = err;
		}
		throw new error_1.VerificationError({
			code: "CERTIFICATE_ERROR",
			message: "Failed to verify certificate chain",
			cause: error
		});
	}
	var CertificateChainVerifier = class {
		untrustedCert;
		trustedCerts;
		localCerts;
		timestamp;
		constructor(opts) {
			this.untrustedCert = opts.untrustedCert, this.trustedCerts = opts.trustedCerts, this.localCerts = dedupeCertificates([...opts.trustedCerts, opts.untrustedCert]), this.timestamp = opts.timestamp;
		}
		verify() {
			let certificatePath = this.sort();
			if (this.checkPath(certificatePath), !certificatePath.every((cert) => cert.validForDate(this.timestamp))) throw new error_1.VerificationError({
				code: "CERTIFICATE_ERROR",
				message: "certificate is not valid or expired at the specified date"
			});
			return certificatePath;
		}
		sort() {
			let leafCert = this.untrustedCert, paths = this.buildPaths(leafCert);
			if (paths = paths.filter((path) => path.some((cert) => this.trustedCerts.includes(cert))), paths.length === 0) throw new error_1.VerificationError({
				code: "CERTIFICATE_ERROR",
				message: "no trusted certificate path found"
			});
			return [leafCert, ...paths.reduce((prev, curr) => prev.length < curr.length ? prev : curr)].slice(0, -1);
		}
		buildPaths(certificate) {
			let paths = [], issuers = this.findIssuer(certificate);
			if (issuers.length === 0) throw new error_1.VerificationError({
				code: "CERTIFICATE_ERROR",
				message: "no valid certificate path found"
			});
			for (let i = 0; i < issuers.length; i++) {
				let issuer = issuers[i];
				if (issuer.equals(certificate)) {
					paths.push([certificate]);
					continue;
				}
				let subPaths = this.buildPaths(issuer);
				for (let j = 0; j < subPaths.length; j++) paths.push([issuer, ...subPaths[j]]);
			}
			return paths;
		}
		findIssuer(certificate) {
			let issuers = [], keyIdentifier;
			return certificate.subject.equals(certificate.issuer) && certificate.verify() ? [certificate] : (certificate.extAuthorityKeyID && (keyIdentifier = certificate.extAuthorityKeyID.keyIdentifier), this.localCerts.forEach((possibleIssuer) => {
				if (keyIdentifier && possibleIssuer.extSubjectKeyID) {
					possibleIssuer.extSubjectKeyID.keyIdentifier.equals(keyIdentifier) && issuers.push(possibleIssuer);
					return;
				}
				possibleIssuer.subject.equals(certificate.issuer) && issuers.push(possibleIssuer);
			}), issuers = issuers.filter((issuer) => {
				try {
					return certificate.verify(issuer);
				} catch {
					/* istanbul ignore next - should never error */
					return !1;
				}
			}), issuers);
		}
		checkPath(path) {
			/* istanbul ignore if */
			if (path.length < 1) throw new error_1.VerificationError({
				code: "CERTIFICATE_ERROR",
				message: "certificate chain must contain at least one certificate"
			});
			if (!path.slice(1).every((cert) => cert.isCA)) throw new error_1.VerificationError({
				code: "CERTIFICATE_ERROR",
				message: "intermediate certificate is not a CA"
			});
			for (let i = path.length - 2; i >= 0; i--)
 /* istanbul ignore if */
			if (!path[i].issuer.equals(path[i + 1].subject)) throw new error_1.VerificationError({
				code: "CERTIFICATE_ERROR",
				message: "incorrect certificate name chaining"
			});
			for (let i = 0; i < path.length; i++) {
				let cert = path[i];
				if (cert.extBasicConstraints?.isCA) {
					let pathLength = cert.extBasicConstraints.pathLenConstraint;
					if (pathLength !== void 0 && pathLength < i - 1) throw new error_1.VerificationError({
						code: "CERTIFICATE_ERROR",
						message: "path length constraint exceeded"
					});
				}
			}
		}
	};
	exports.CertificateChainVerifier = CertificateChainVerifier;
	function dedupeCertificates(certs) {
		for (let i = 0; i < certs.length; i++) for (let j = i + 1; j < certs.length; j++) certs[i].equals(certs[j]) && (certs.splice(j, 1), j--);
		return certs;
	}
})), require_sct = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.verifySCTs = verifySCTs;
	let core_1 = require_dist$1(), error_1 = require_error(), trust_1 = require_trust();
	function verifySCTs(cert, issuer, ctlogs) {
		let extSCT, clone = cert.clone();
		for (let i = 0; i < clone.extensions.length; i++) {
			let ext = clone.extensions[i];
			if (ext.subs[0].toOID() === core_1.EXTENSION_OID_SCT) {
				extSCT = new core_1.X509SCTExtension(ext), clone.extensions.splice(i, 1);
				break;
			}
		}
		/* istanbul ignore if -- too difficult to fabricate test case for this */
		if (!extSCT || extSCT.signedCertificateTimestamps.length === 0) return [];
		let preCert = new core_1.ByteStream(), issuerId = core_1.crypto.digest("sha256", issuer.publicKey);
		preCert.appendView(issuerId);
		let tbs = clone.tbsCertificate.toDER();
		return preCert.appendUint24(tbs.length), preCert.appendView(tbs), extSCT.signedCertificateTimestamps.map((sct) => {
			if (!(0, trust_1.filterTLogAuthorities)(ctlogs, {
				logID: sct.logID,
				targetDate: sct.datetime
			}).some((log) => sct.verify(preCert.buffer, log.publicKey))) throw new error_1.VerificationError({
				code: "CERTIFICATE_ERROR",
				message: "SCT verification failed"
			});
			return sct.logID;
		});
	}
})), require_key = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.verifyPublicKey = verifyPublicKey, exports.verifyCertificate = verifyCertificate;
	let core_1 = require_dist$1(), error_1 = require_error(), certificate_1 = require_certificate(), sct_1 = require_sct();
	function verifyPublicKey(hint, timestamps, trustMaterial) {
		let key = trustMaterial.publicKey(hint);
		return timestamps.forEach((timestamp) => {
			if (!key.validFor(timestamp)) throw new error_1.VerificationError({
				code: "PUBLIC_KEY_ERROR",
				message: `Public key is not valid for timestamp: ${timestamp.toISOString()}`
			});
		}), { key: key.publicKey };
	}
	function verifyCertificate(leaf, timestamps, trustMaterial) {
		let path = [];
		return timestamps.forEach((timestamp) => {
			path = (0, certificate_1.verifyCertificateChain)(timestamp, leaf, trustMaterial.certificateAuthorities);
		}), {
			scts: (0, sct_1.verifySCTs)(path[0], path[1], trustMaterial.ctlogs),
			signer: getSigner(path[0])
		};
	}
	function getSigner(cert) {
		let issuer, issuerExtension = cert.extension("1.3.6.1.4.1.57264.1.8");
		/* istanbul ignore next */
		issuer = issuerExtension ? issuerExtension.valueObj.subs?.[0]?.value.toString("ascii") : cert.extension("1.3.6.1.4.1.57264.1.1")?.value.toString("ascii");
		let oids = cert.extensions.map((ext) => ({
			oid: { id: ext.subs[0].toOID().split(".").map(Number) },
			value: ext.subs[ext.subs.length - 1].value
		})), identity = {
			extensions: { issuer },
			subjectAlternativeName: cert.subjectAltName,
			oids
		};
		return {
			key: core_1.crypto.createPublicKey(cert.publicKey),
			identity
		};
	}
})), require_policy = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.verifySubjectAlternativeName = verifySubjectAlternativeName, exports.verifyExtensions = verifyExtensions, exports.verifyOIDs = verifyOIDs;
	let error_1 = require_error();
	function verifySubjectAlternativeName(policyIdentity, signerIdentity) {
		if (signerIdentity === void 0 || !signerIdentity.match(policyIdentity)) throw new error_1.PolicyError({
			code: "UNTRUSTED_SIGNER_ERROR",
			message: `certificate identity error - expected ${policyIdentity}, got ${signerIdentity}`
		});
	}
	function verifyExtensions(policyExtensions, signerExtensions = {}) {
		let key;
		for (key in policyExtensions) if (signerExtensions[key] !== policyExtensions[key]) throw new error_1.PolicyError({
			code: "UNTRUSTED_SIGNER_ERROR",
			message: `invalid certificate extension - expected ${key}=${policyExtensions[key]}, got ${key}=${signerExtensions[key]}`
		});
	}
	function verifyOIDs(policyOIDs, signerOIDs = []) {
		for (let policyOID of policyOIDs) if (!signerOIDs.find((signerOID) => oidEquals(policyOID.oid?.id, signerOID.oid?.id) && policyOID.value.equals(signerOID.value))) {
			let oid = policyOID.oid?.id.join(".") ?? "<unknown>";
			throw new error_1.PolicyError({
				code: "UNTRUSTED_SIGNER_ERROR",
				message: `invalid certificate extension - missing OID ${oid}`
			});
		}
	}
	function oidEquals(a, b) {
		return a === void 0 || b === void 0 ? !1 : a.length === b.length && a.every((v, i) => v === b[i]);
	}
})), require_tsa = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.verifyRFC3161Timestamp = verifyRFC3161Timestamp;
	let core_1 = require_dist$1(), error_1 = require_error(), certificate_1 = require_certificate(), trust_1 = require_trust();
	function verifyRFC3161Timestamp(timestamp, data, timestampAuthorities) {
		let signingTime = timestamp.signingTime;
		if (timestampAuthorities = (0, trust_1.filterCertAuthorities)(timestampAuthorities, signingTime), timestampAuthorities = filterCAsBySerialAndIssuer(timestampAuthorities, {
			serialNumber: timestamp.signerSerialNumber,
			issuer: timestamp.signerIssuer
		}), !timestampAuthorities.some((ca) => {
			try {
				return verifyTimestampForCA(timestamp, data, ca), !0;
			} catch {
				return !1;
			}
		})) throw new error_1.VerificationError({
			code: "TIMESTAMP_ERROR",
			message: "timestamp could not be verified"
		});
	}
	function verifyTimestampForCA(timestamp, data, ca) {
		let [leaf, ...cas] = ca.certChain, signingKey = core_1.crypto.createPublicKey(leaf.publicKey), signingTime = timestamp.signingTime;
		try {
			new certificate_1.CertificateChainVerifier({
				untrustedCert: leaf,
				trustedCerts: cas,
				timestamp: signingTime
			}).verify();
		} catch {
			throw new error_1.VerificationError({
				code: "TIMESTAMP_ERROR",
				message: "invalid certificate chain"
			});
		}
		timestamp.verify(data, signingKey);
	}
	function filterCAsBySerialAndIssuer(timestampAuthorities, criteria) {
		return timestampAuthorities.filter((ca) => ca.certChain.length > 0 && core_1.crypto.bufferEqual(ca.certChain[0].serialNumber, criteria.serialNumber) && core_1.crypto.bufferEqual(ca.certChain[0].issuer, criteria.issuer));
	}
})), require_timestamp = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.getTSATimestamp = getTSATimestamp, exports.getTLogTimestamp = getTLogTimestamp;
	let tsa_1 = require_tsa();
	function getTSATimestamp(timestamp, data, timestampAuthorities) {
		return (0, tsa_1.verifyRFC3161Timestamp)(timestamp, data, timestampAuthorities), {
			type: "timestamp-authority",
			logID: timestamp.signerSerialNumber,
			timestamp: timestamp.signingTime
		};
	}
	function getTLogTimestamp(entry) {
		if (entry.inclusionPromise) return {
			type: "transparency-log",
			logID: entry.logId.keyId,
			timestamp: /* @__PURE__ */ new Date(Number(entry.integratedTime) * 1e3)
		};
	}
})), require_verifier$1 = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.Signature = exports.Verifier = exports.PublicKey = void 0;
	let sigstore_common_1 = require_sigstore_common();
	exports.PublicKey = {
		fromJSON(object) {
			return { rawBytes: isSet(object.rawBytes) ? Buffer.from(bytesFromBase64(object.rawBytes)) : Buffer.alloc(0) };
		},
		toJSON(message) {
			let obj = {};
			return message.rawBytes.length !== 0 && (obj.rawBytes = base64FromBytes(message.rawBytes)), obj;
		}
	}, exports.Verifier = {
		fromJSON(object) {
			return {
				verifier: isSet(object.publicKey) ? {
					$case: "publicKey",
					publicKey: exports.PublicKey.fromJSON(object.publicKey)
				} : isSet(object.x509Certificate) ? {
					$case: "x509Certificate",
					x509Certificate: sigstore_common_1.X509Certificate.fromJSON(object.x509Certificate)
				} : void 0,
				keyDetails: isSet(object.keyDetails) ? (0, sigstore_common_1.publicKeyDetailsFromJSON)(object.keyDetails) : 0
			};
		},
		toJSON(message) {
			let obj = {};
			return message.verifier?.$case === "publicKey" ? obj.publicKey = exports.PublicKey.toJSON(message.verifier.publicKey) : message.verifier?.$case === "x509Certificate" && (obj.x509Certificate = sigstore_common_1.X509Certificate.toJSON(message.verifier.x509Certificate)), message.keyDetails !== 0 && (obj.keyDetails = (0, sigstore_common_1.publicKeyDetailsToJSON)(message.keyDetails)), obj;
		}
	}, exports.Signature = {
		fromJSON(object) {
			return {
				content: isSet(object.content) ? Buffer.from(bytesFromBase64(object.content)) : Buffer.alloc(0),
				verifier: isSet(object.verifier) ? exports.Verifier.fromJSON(object.verifier) : void 0
			};
		},
		toJSON(message) {
			let obj = {};
			return message.content.length !== 0 && (obj.content = base64FromBytes(message.content)), message.verifier !== void 0 && (obj.verifier = exports.Verifier.toJSON(message.verifier)), obj;
		}
	};
	function bytesFromBase64(b64) {
		return Uint8Array.from(globalThis.Buffer.from(b64, "base64"));
	}
	function base64FromBytes(arr) {
		return globalThis.Buffer.from(arr).toString("base64");
	}
	function isSet(value) {
		return value != null;
	}
})), require_dsse$1 = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.DSSELogEntryV002 = exports.DSSERequestV002 = void 0;
	let envelope_1 = require_envelope(), sigstore_common_1 = require_sigstore_common(), verifier_1 = require_verifier$1();
	exports.DSSERequestV002 = {
		fromJSON(object) {
			return {
				envelope: isSet(object.envelope) ? envelope_1.Envelope.fromJSON(object.envelope) : void 0,
				verifiers: globalThis.Array.isArray(object?.verifiers) ? object.verifiers.map((e) => verifier_1.Verifier.fromJSON(e)) : []
			};
		},
		toJSON(message) {
			let obj = {};
			return message.envelope !== void 0 && (obj.envelope = envelope_1.Envelope.toJSON(message.envelope)), message.verifiers?.length && (obj.verifiers = message.verifiers.map((e) => verifier_1.Verifier.toJSON(e))), obj;
		}
	}, exports.DSSELogEntryV002 = {
		fromJSON(object) {
			return {
				payloadHash: isSet(object.payloadHash) ? sigstore_common_1.HashOutput.fromJSON(object.payloadHash) : void 0,
				signatures: globalThis.Array.isArray(object?.signatures) ? object.signatures.map((e) => verifier_1.Signature.fromJSON(e)) : []
			};
		},
		toJSON(message) {
			let obj = {};
			return message.payloadHash !== void 0 && (obj.payloadHash = sigstore_common_1.HashOutput.toJSON(message.payloadHash)), message.signatures?.length && (obj.signatures = message.signatures.map((e) => verifier_1.Signature.toJSON(e))), obj;
		}
	};
	function isSet(value) {
		return value != null;
	}
})), require_hashedrekord$1 = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.HashedRekordLogEntryV002 = exports.HashedRekordRequestV002 = void 0;
	let sigstore_common_1 = require_sigstore_common(), verifier_1 = require_verifier$1();
	exports.HashedRekordRequestV002 = {
		fromJSON(object) {
			return {
				digest: isSet(object.digest) ? Buffer.from(bytesFromBase64(object.digest)) : Buffer.alloc(0),
				signature: isSet(object.signature) ? verifier_1.Signature.fromJSON(object.signature) : void 0
			};
		},
		toJSON(message) {
			let obj = {};
			return message.digest.length !== 0 && (obj.digest = base64FromBytes(message.digest)), message.signature !== void 0 && (obj.signature = verifier_1.Signature.toJSON(message.signature)), obj;
		}
	}, exports.HashedRekordLogEntryV002 = {
		fromJSON(object) {
			return {
				data: isSet(object.data) ? sigstore_common_1.HashOutput.fromJSON(object.data) : void 0,
				signature: isSet(object.signature) ? verifier_1.Signature.fromJSON(object.signature) : void 0
			};
		},
		toJSON(message) {
			let obj = {};
			return message.data !== void 0 && (obj.data = sigstore_common_1.HashOutput.toJSON(message.data)), message.signature !== void 0 && (obj.signature = verifier_1.Signature.toJSON(message.signature)), obj;
		}
	};
	function bytesFromBase64(b64) {
		return Uint8Array.from(globalThis.Buffer.from(b64, "base64"));
	}
	function base64FromBytes(arr) {
		return globalThis.Buffer.from(arr).toString("base64");
	}
	function isSet(value) {
		return value != null;
	}
})), require_entry = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.CreateEntryRequest = exports.Spec = exports.Entry = void 0;
	let dsse_1 = require_dsse$1(), hashedrekord_1 = require_hashedrekord$1();
	exports.Entry = {
		fromJSON(object) {
			return {
				kind: isSet(object.kind) ? globalThis.String(object.kind) : "",
				apiVersion: isSet(object.apiVersion) ? globalThis.String(object.apiVersion) : "",
				spec: isSet(object.spec) ? exports.Spec.fromJSON(object.spec) : void 0
			};
		},
		toJSON(message) {
			let obj = {};
			return message.kind !== "" && (obj.kind = message.kind), message.apiVersion !== "" && (obj.apiVersion = message.apiVersion), message.spec !== void 0 && (obj.spec = exports.Spec.toJSON(message.spec)), obj;
		}
	}, exports.Spec = {
		fromJSON(object) {
			return { spec: isSet(object.hashedRekordV002) ? {
				$case: "hashedRekordV002",
				hashedRekordV002: hashedrekord_1.HashedRekordLogEntryV002.fromJSON(object.hashedRekordV002)
			} : isSet(object.dsseV002) ? {
				$case: "dsseV002",
				dsseV002: dsse_1.DSSELogEntryV002.fromJSON(object.dsseV002)
			} : void 0 };
		},
		toJSON(message) {
			let obj = {};
			return message.spec?.$case === "hashedRekordV002" ? obj.hashedRekordV002 = hashedrekord_1.HashedRekordLogEntryV002.toJSON(message.spec.hashedRekordV002) : message.spec?.$case === "dsseV002" && (obj.dsseV002 = dsse_1.DSSELogEntryV002.toJSON(message.spec.dsseV002)), obj;
		}
	}, exports.CreateEntryRequest = {
		fromJSON(object) {
			return { spec: isSet(object.hashedRekordRequestV002) ? {
				$case: "hashedRekordRequestV002",
				hashedRekordRequestV002: hashedrekord_1.HashedRekordRequestV002.fromJSON(object.hashedRekordRequestV002)
			} : isSet(object.dsseRequestV002) ? {
				$case: "dsseRequestV002",
				dsseRequestV002: dsse_1.DSSERequestV002.fromJSON(object.dsseRequestV002)
			} : void 0 };
		},
		toJSON(message) {
			let obj = {};
			return message.spec?.$case === "hashedRekordRequestV002" ? obj.hashedRekordRequestV002 = hashedrekord_1.HashedRekordRequestV002.toJSON(message.spec.hashedRekordRequestV002) : message.spec?.$case === "dsseRequestV002" && (obj.dsseRequestV002 = dsse_1.DSSERequestV002.toJSON(message.spec.dsseRequestV002)), obj;
		}
	};
	function isSet(value) {
		return value != null;
	}
})), require_v2 = /* @__PURE__ */ __commonJSMin(((exports) => {
	var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
		k2 === void 0 && (k2 = k);
		var desc = Object.getOwnPropertyDescriptor(m, k);
		(!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) && (desc = {
			enumerable: !0,
			get: function() {
				return m[k];
			}
		}), Object.defineProperty(o, k2, desc);
	}) : (function(o, m, k, k2) {
		k2 === void 0 && (k2 = k), o[k2] = m[k];
	})), __exportStar = exports && exports.__exportStar || function(m, exports$1) {
		for (var p in m) p !== "default" && !Object.prototype.hasOwnProperty.call(exports$1, p) && __createBinding(exports$1, m, p);
	};
	Object.defineProperty(exports, "__esModule", { value: !0 }), __exportStar(require_dsse$1(), exports), __exportStar(require_entry(), exports), __exportStar(require_hashedrekord$1(), exports), __exportStar(require_verifier$1(), exports);
})), require_dsse = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.DSSE_API_VERSION_V1 = void 0, exports.verifyDSSETLogBody = verifyDSSETLogBody, exports.verifyDSSETLogBodyV2 = verifyDSSETLogBodyV2;
	let error_1 = require_error();
	exports.DSSE_API_VERSION_V1 = "0.0.1";
	function verifyDSSETLogBody(tlogEntry, content) {
		switch (tlogEntry.apiVersion) {
			case exports.DSSE_API_VERSION_V1: return verifyDSSE001TLogBody(tlogEntry, content);
			default: throw new error_1.VerificationError({
				code: "TLOG_BODY_ERROR",
				message: `unsupported dsse version: ${tlogEntry.apiVersion}`
			});
		}
	}
	function verifyDSSETLogBodyV2(tlogEntry, content) {
		let spec = tlogEntry.spec?.spec;
		if (!spec) throw new error_1.VerificationError({
			code: "TLOG_BODY_ERROR",
			message: "missing dsse spec"
		});
		switch (spec.$case) {
			case "dsseV002": return verifyDSSE002TLogBody(spec.dsseV002, content);
			default: throw new error_1.VerificationError({
				code: "TLOG_BODY_ERROR",
				message: `unsupported version: ${spec.$case}`
			});
		}
	}
	function verifyDSSE001TLogBody(tlogEntry, content) {
		if (tlogEntry.spec.signatures?.length !== 1) throw new error_1.VerificationError({
			code: "TLOG_BODY_ERROR",
			message: "signature count mismatch"
		});
		let tlogSig = tlogEntry.spec.signatures[0].signature;
		if (!content.compareSignature(Buffer.from(tlogSig, "base64"))) throw new error_1.VerificationError({
			code: "TLOG_BODY_ERROR",
			message: "tlog entry signature mismatch"
		});
		let tlogHash = tlogEntry.spec.payloadHash?.value || "";
		if (!content.compareDigest(Buffer.from(tlogHash, "hex"))) throw new error_1.VerificationError({
			code: "TLOG_BODY_ERROR",
			message: "DSSE payload hash mismatch"
		});
	}
	function verifyDSSE002TLogBody(spec, content) {
		if (spec.signatures?.length !== 1) throw new error_1.VerificationError({
			code: "TLOG_BODY_ERROR",
			message: "signature count mismatch"
		});
		let tlogSig = spec.signatures[0].content;
		if (!content.compareSignature(tlogSig)) throw new error_1.VerificationError({
			code: "TLOG_BODY_ERROR",
			message: "tlog entry signature mismatch"
		});
		let tlogHash = spec.payloadHash?.digest || Buffer.from("");
		if (!content.compareDigest(tlogHash)) throw new error_1.VerificationError({
			code: "TLOG_BODY_ERROR",
			message: "DSSE payload hash mismatch"
		});
	}
})), require_hashedrekord = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.HASHEDREKORD_API_VERSION_V1 = void 0, exports.verifyHashedRekordTLogBody = verifyHashedRekordTLogBody, exports.verifyHashedRekordTLogBodyV2 = verifyHashedRekordTLogBodyV2;
	let error_1 = require_error();
	exports.HASHEDREKORD_API_VERSION_V1 = "0.0.1";
	function verifyHashedRekordTLogBody(tlogEntry, content) {
		switch (tlogEntry.apiVersion) {
			case exports.HASHEDREKORD_API_VERSION_V1: return verifyHashedrekord001TLogBody(tlogEntry, content);
			default: throw new error_1.VerificationError({
				code: "TLOG_BODY_ERROR",
				message: `unsupported hashedrekord version: ${tlogEntry.apiVersion}`
			});
		}
	}
	function verifyHashedRekordTLogBodyV2(tlogEntry, content) {
		let spec = tlogEntry.spec?.spec;
		if (!spec) throw new error_1.VerificationError({
			code: "TLOG_BODY_ERROR",
			message: "missing dsse spec"
		});
		switch (spec.$case) {
			case "hashedRekordV002": return verifyHashedrekord002TLogBody(spec.hashedRekordV002, content);
			default: throw new error_1.VerificationError({
				code: "TLOG_BODY_ERROR",
				message: `unsupported version: ${spec.$case}`
			});
		}
	}
	function verifyHashedrekord001TLogBody(tlogEntry, content) {
		let tlogSig = tlogEntry.spec.signature.content || "";
		if (!content.compareSignature(Buffer.from(tlogSig, "base64"))) throw new error_1.VerificationError({
			code: "TLOG_BODY_ERROR",
			message: "signature mismatch"
		});
		let tlogDigest = tlogEntry.spec.data.hash?.value || "";
		if (!content.compareSignedDigest(Buffer.from(tlogDigest, "hex"))) throw new error_1.VerificationError({
			code: "TLOG_BODY_ERROR",
			message: "digest mismatch"
		});
	}
	function verifyHashedrekord002TLogBody(spec, content) {
		let tlogSig = spec.signature?.content || Buffer.from("");
		if (!content.compareSignature(tlogSig)) throw new error_1.VerificationError({
			code: "TLOG_BODY_ERROR",
			message: "signature mismatch"
		});
		let tlogHash = spec.data?.digest || Buffer.from("");
		if (!content.compareSignedDigest(tlogHash)) throw new error_1.VerificationError({
			code: "TLOG_BODY_ERROR",
			message: "digest mismatch"
		});
	}
})), require_intoto = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.verifyIntotoTLogBody = verifyIntotoTLogBody;
	let error_1 = require_error();
	function verifyIntotoTLogBody(tlogEntry, content) {
		switch (tlogEntry.apiVersion) {
			case "0.0.2": return verifyIntoto002TLogBody(tlogEntry, content);
			default: throw new error_1.VerificationError({
				code: "TLOG_BODY_ERROR",
				message: `unsupported intoto version: ${tlogEntry.apiVersion}`
			});
		}
	}
	function verifyIntoto002TLogBody(tlogEntry, content) {
		if (tlogEntry.spec.content.envelope.signatures?.length !== 1) throw new error_1.VerificationError({
			code: "TLOG_BODY_ERROR",
			message: "signature count mismatch"
		});
		let tlogSig = base64Decode(tlogEntry.spec.content.envelope.signatures[0].sig);
		if (!content.compareSignature(Buffer.from(tlogSig, "base64"))) throw new error_1.VerificationError({
			code: "TLOG_BODY_ERROR",
			message: "tlog entry signature mismatch"
		});
		let tlogHash = tlogEntry.spec.content.payloadHash?.value || "";
		if (!content.compareDigest(Buffer.from(tlogHash, "hex"))) throw new error_1.VerificationError({
			code: "TLOG_BODY_ERROR",
			message: "DSSE payload hash mismatch"
		});
	}
	function base64Decode(str) {
		return Buffer.from(str, "base64").toString("utf-8");
	}
})), require_checkpoint = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.LogCheckpoint = void 0, exports.verifyCheckpoint = verifyCheckpoint;
	let core_1 = require_dist$1(), error_1 = require_error(), SIGNATURE_REGEX = /\u2014 (\S+) (\S+)\n/g;
	function verifyCheckpoint(entry, tlogs) {
		let inclusionProof = entry.inclusionProof, signedNote = SignedNote.fromString(inclusionProof.checkpoint.envelope), checkpoint = LogCheckpoint.fromString(signedNote.note);
		if (!verifySignedNote(signedNote, tlogs)) throw new error_1.VerificationError({
			code: "TLOG_INCLUSION_PROOF_ERROR",
			message: "invalid checkpoint signature"
		});
		return checkpoint;
	}
	function verifySignedNote(signedNote, tlogs) {
		let data = Buffer.from(signedNote.note, "utf-8");
		return signedNote.signatures.some((signature) => {
			let tlog = tlogs.find((tlog) => core_1.crypto.bufferEqual(tlog.logID.subarray(0, 4), signature.keyHint) && tlog.baseURL.match(signature.name));
			return tlog ? core_1.crypto.verify(data, tlog.publicKey, signature.signature) : !1;
		});
	}
	var SignedNote = class SignedNote {
		note;
		signatures;
		constructor(note, signatures) {
			this.note = note, this.signatures = signatures;
		}
		static fromString(envelope) {
			if (!envelope.includes("\n\n")) throw new error_1.VerificationError({
				code: "TLOG_INCLUSION_PROOF_ERROR",
				message: "missing checkpoint separator"
			});
			let split = envelope.indexOf("\n\n"), header = envelope.slice(0, split + 1), matches = envelope.slice(split + 2).matchAll(SIGNATURE_REGEX), signatures = Array.from(matches, (match) => {
				let [, name, signature] = match, sigBytes = Buffer.from(signature, "base64");
				if (sigBytes.length < 5) throw new error_1.VerificationError({
					code: "TLOG_INCLUSION_PROOF_ERROR",
					message: "malformed checkpoint signature"
				});
				return {
					name,
					keyHint: sigBytes.subarray(0, 4),
					signature: sigBytes.subarray(4)
				};
			});
			if (signatures.length === 0) throw new error_1.VerificationError({
				code: "TLOG_INCLUSION_PROOF_ERROR",
				message: "no signatures found in checkpoint"
			});
			return new SignedNote(header, signatures);
		}
	}, LogCheckpoint = class LogCheckpoint {
		origin;
		logSize;
		logHash;
		rest;
		constructor(origin, logSize, logHash, rest) {
			this.origin = origin, this.logSize = logSize, this.logHash = logHash, this.rest = rest;
		}
		static fromString(note) {
			let lines = note.trimEnd().split("\n");
			if (lines.length < 3) throw new error_1.VerificationError({
				code: "TLOG_INCLUSION_PROOF_ERROR",
				message: "too few lines in checkpoint header"
			});
			let origin = lines[0], logSize = BigInt(lines[1]), rootHash = Buffer.from(lines[2], "base64"), rest = lines.slice(3);
			return new LogCheckpoint(origin, logSize, rootHash, rest);
		}
	};
	exports.LogCheckpoint = LogCheckpoint;
})), require_merkle = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.verifyMerkleInclusion = verifyMerkleInclusion;
	let core_1 = require_dist$1(), error_1 = require_error(), RFC6962_LEAF_HASH_PREFIX = Buffer.from([0]), RFC6962_NODE_HASH_PREFIX = Buffer.from([1]);
	function verifyMerkleInclusion(entry, checkpoint) {
		let inclusionProof = entry.inclusionProof, logIndex = BigInt(inclusionProof.logIndex), treeSize = BigInt(checkpoint.logSize);
		if (logIndex < 0n || logIndex >= treeSize) throw new error_1.VerificationError({
			code: "TLOG_INCLUSION_PROOF_ERROR",
			message: `invalid index: ${logIndex}`
		});
		let { inner, border } = decompInclProof(logIndex, treeSize);
		if (inclusionProof.hashes.length !== inner + border) throw new error_1.VerificationError({
			code: "TLOG_INCLUSION_PROOF_ERROR",
			message: "invalid hash count"
		});
		let innerHashes = inclusionProof.hashes.slice(0, inner), borderHashes = inclusionProof.hashes.slice(inner), calculatedHash = chainBorderRight(chainInner(hashLeaf(entry.canonicalizedBody), innerHashes, logIndex), borderHashes);
		if (!core_1.crypto.bufferEqual(calculatedHash, checkpoint.logHash)) throw new error_1.VerificationError({
			code: "TLOG_INCLUSION_PROOF_ERROR",
			message: "calculated root hash does not match inclusion proof"
		});
	}
	function decompInclProof(index, size) {
		let inner = innerProofSize(index, size);
		return {
			inner,
			border: onesCount(index >> BigInt(inner))
		};
	}
	function chainInner(seed, hashes, index) {
		return hashes.reduce((acc, h, i) => index >> BigInt(i) & BigInt(1) ? hashChildren(h, acc) : hashChildren(acc, h), seed);
	}
	function chainBorderRight(seed, hashes) {
		return hashes.reduce((acc, h) => hashChildren(h, acc), seed);
	}
	function innerProofSize(index, size) {
		return bitLength(index ^ size - BigInt(1));
	}
	function onesCount(num) {
		return num.toString(2).split("1").length - 1;
	}
	function bitLength(n) {
		return n === 0n ? 0 : n.toString(2).length;
	}
	function hashChildren(left, right) {
		return core_1.crypto.digest("sha256", RFC6962_NODE_HASH_PREFIX, left, right);
	}
	function hashLeaf(leaf) {
		return core_1.crypto.digest("sha256", RFC6962_LEAF_HASH_PREFIX, leaf);
	}
})), require_set = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.verifyTLogSET = verifyTLogSET;
	let core_1 = require_dist$1(), error_1 = require_error(), trust_1 = require_trust();
	function verifyTLogSET(entry, tlogs) {
		if (!(0, trust_1.filterTLogAuthorities)(tlogs, {
			logID: entry.logId.keyId,
			targetDate: /* @__PURE__ */ new Date(Number(entry.integratedTime) * 1e3)
		}).some((tlog) => {
			let payload = toVerificationPayload(entry), data = Buffer.from(core_1.json.canonicalize(payload), "utf8"), signature = entry.inclusionPromise.signedEntryTimestamp;
			return core_1.crypto.verify(data, tlog.publicKey, signature);
		})) throw new error_1.VerificationError({
			code: "TLOG_INCLUSION_PROMISE_ERROR",
			message: "inclusion promise could not be verified"
		});
	}
	function toVerificationPayload(entry) {
		let { integratedTime, logIndex, logId, canonicalizedBody } = entry;
		return {
			body: canonicalizedBody.toString("base64"),
			integratedTime: Number(integratedTime),
			logIndex: Number(logIndex),
			logID: logId.keyId.toString("hex")
		};
	}
})), require_tlog = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.verifyTLogBody = verifyTLogBody, exports.verifyTLogInclusion = verifyTLogInclusion;
	let v2_1 = require_v2(), error_1 = require_error(), dsse_1 = require_dsse(), hashedrekord_1 = require_hashedrekord(), intoto_1 = require_intoto(), checkpoint_1 = require_checkpoint(), merkle_1 = require_merkle(), set_1 = require_set();
	function verifyTLogBody(entry, sigContent) {
		let { kind, version } = entry.kindVersion, body = JSON.parse(entry.canonicalizedBody.toString("utf8"));
		if (kind !== body.kind || version !== body.apiVersion) throw new error_1.VerificationError({
			code: "TLOG_BODY_ERROR",
			message: `kind/version mismatch - expected: ${kind}/${version}, received: ${body.kind}/${body.apiVersion}`
		});
		switch (kind) {
			case "dsse":
				if (version == dsse_1.DSSE_API_VERSION_V1) return (0, dsse_1.verifyDSSETLogBody)(body, sigContent);
				{
					let entryRekorV2 = v2_1.Entry.fromJSON(body);
					return (0, dsse_1.verifyDSSETLogBodyV2)(entryRekorV2, sigContent);
				}
			case "intoto": return (0, intoto_1.verifyIntotoTLogBody)(body, sigContent);
			case "hashedrekord":
				if (version == hashedrekord_1.HASHEDREKORD_API_VERSION_V1) return (0, hashedrekord_1.verifyHashedRekordTLogBody)(body, sigContent);
				{
					let entryRekorV2 = v2_1.Entry.fromJSON(body);
					return (0, hashedrekord_1.verifyHashedRekordTLogBodyV2)(entryRekorV2, sigContent);
				}
			/* istanbul ignore next */
			default: throw new error_1.VerificationError({
				code: "TLOG_BODY_ERROR",
				message: `unsupported kind: ${kind}`
			});
		}
	}
	function verifyTLogInclusion(entry, tlogAuthorities) {
		let inclusionVerified = !1;
		if (isTLogEntryWithInclusionPromise(entry) && ((0, set_1.verifyTLogSET)(entry, tlogAuthorities), inclusionVerified = !0), isTLogEntryWithInclusionProof(entry)) {
			let checkpoint = (0, checkpoint_1.verifyCheckpoint)(entry, tlogAuthorities);
			(0, merkle_1.verifyMerkleInclusion)(entry, checkpoint), inclusionVerified = !0;
		}
		if (!inclusionVerified) throw new error_1.VerificationError({
			code: "TLOG_MISSING_INCLUSION_ERROR",
			message: "inclusion could not be verified"
		});
	}
	function isTLogEntryWithInclusionPromise(entry) {
		return entry.inclusionPromise !== void 0;
	}
	function isTLogEntryWithInclusionProof(entry) {
		return entry.inclusionProof !== void 0;
	}
})), require_verifier = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.Verifier = void 0;
	let util_1 = require("util"), error_1 = require_error(), key_1 = require_key(), policy_1 = require_policy(), timestamp_1 = require_timestamp(), tlog_1 = require_tlog();
	exports.Verifier = class {
		trustMaterial;
		options;
		constructor(trustMaterial, options = {}) {
			this.trustMaterial = trustMaterial, this.options = {
				ctlogThreshold: options.ctlogThreshold ?? 1,
				tlogThreshold: options.tlogThreshold ?? 1,
				timestampThreshold: options.timestampThreshold ?? options.tsaThreshold ?? 1,
				tsaThreshold: 0
			};
		}
		verify(entity, policy) {
			let timestamps = this.verifyTimestamps(entity), signer = this.verifySigningKey(entity, timestamps);
			return this.verifyTLogs(entity), this.verifySignature(entity, signer), policy && this.verifyPolicy(policy, signer.identity || {}), signer;
		}
		verifyTimestamps(entity) {
			let timestamps = [];
			for (let timestamp of entity.timestamps) switch (timestamp.$case) {
				case "timestamp-authority":
					timestamps.push((0, timestamp_1.getTSATimestamp)(timestamp.timestamp, entity.signature.signature, this.trustMaterial.timestampAuthorities));
					break;
				case "transparency-log": {
					let result = (0, timestamp_1.getTLogTimestamp)(timestamp.tlogEntry);
					result && timestamps.push(result);
					break;
				}
			}
			if (containsDupes(timestamps)) throw new error_1.VerificationError({
				code: "TIMESTAMP_ERROR",
				message: "duplicate timestamp"
			});
			if (timestamps.length < this.options.timestampThreshold) throw new error_1.VerificationError({
				code: "TIMESTAMP_ERROR",
				message: `expected ${this.options.timestampThreshold} timestamps, got ${timestamps.length}`
			});
			return timestamps.map((t) => t.timestamp);
		}
		verifySigningKey({ key }, timestamps) {
			switch (key.$case) {
				case "public-key": return (0, key_1.verifyPublicKey)(key.hint, timestamps, this.trustMaterial);
				case "certificate": {
					let result = (0, key_1.verifyCertificate)(key.certificate, timestamps, this.trustMaterial);
					/* istanbul ignore next - no fixture */
					if (containsDupes(result.scts)) throw new error_1.VerificationError({
						code: "CERTIFICATE_ERROR",
						message: "duplicate SCT"
					});
					if (result.scts.length < this.options.ctlogThreshold) throw new error_1.VerificationError({
						code: "CERTIFICATE_ERROR",
						message: `expected ${this.options.ctlogThreshold} SCTs, got ${result.scts.length}`
					});
					return result.signer;
				}
			}
		}
		verifyTLogs({ signature: content, tlogEntries }) {
			let tlogCount = 0;
			if (tlogEntries.forEach((entry) => {
				tlogCount++, (0, tlog_1.verifyTLogInclusion)(entry, this.trustMaterial.tlogs), (0, tlog_1.verifyTLogBody)(entry, content);
			}), tlogCount < this.options.tlogThreshold) throw new error_1.VerificationError({
				code: "TLOG_ERROR",
				message: `expected ${this.options.tlogThreshold} tlog entries, got ${tlogCount}`
			});
		}
		verifySignature(entity, signer) {
			if (!entity.signature.verifySignature(signer.key)) throw new error_1.VerificationError({
				code: "SIGNATURE_ERROR",
				message: "signature verification failed"
			});
		}
		verifyPolicy(policy, identity) {
			/* istanbul ignore if */
			policy.subjectAlternativeName && (0, policy_1.verifySubjectAlternativeName)(policy.subjectAlternativeName, identity.subjectAlternativeName), policy.extensions && (0, policy_1.verifyExtensions)(policy.extensions, identity.extensions), policy.oids && (0, policy_1.verifyOIDs)(policy.oids, identity.oids);
		}
	};
	function containsDupes(arr) {
		for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) if ((0, util_1.isDeepStrictEqual)(arr[i], arr[j])) return !0;
		return !1;
	}
})), require_dist = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: !0 }), exports.Verifier = exports.toTrustMaterial = exports.VerificationError = exports.PolicyError = exports.toSignedEntity = void 0;
	/* istanbul ignore file */
	var bundle_1 = require_bundle();
	Object.defineProperty(exports, "toSignedEntity", {
		enumerable: !0,
		get: function() {
			return bundle_1.toSignedEntity;
		}
	});
	var error_1 = require_error();
	Object.defineProperty(exports, "PolicyError", {
		enumerable: !0,
		get: function() {
			return error_1.PolicyError;
		}
	}), Object.defineProperty(exports, "VerificationError", {
		enumerable: !0,
		get: function() {
			return error_1.VerificationError;
		}
	});
	var trust_1 = require_trust();
	Object.defineProperty(exports, "toTrustMaterial", {
		enumerable: !0,
		get: function() {
			return trust_1.toTrustMaterial;
		}
	});
	var verifier_1 = require_verifier();
	Object.defineProperty(exports, "Verifier", {
		enumerable: !0,
		get: function() {
			return verifier_1.Verifier;
		}
	});
})), import_dist = require_dist$5(), import_dist$1 = require_dist$2(), import_dist$2 = require_dist();
const derUtf8 = (s) => String.fromCharCode(12, s.length) + s;
/**
* Extract and assert the signed manifest digest from a cosign DSSE bundle.
*
* Two payload formats are supported depending on the cosign version:
*
* 1. in-toto Statement v1 (payloadType "application/vnd.in-toto+json")
*    Used by cosign --new-bundle-format (v2.4+).
*    Digest is stored in subject[].digest.sha256.
*
* 2. simple-signing (legacy cosign)
*    Digest is stored in critical.image.docker-manifest-digest.
*
* This check closes the gap between Referrers-API attribution (registry
* metadata, not cryptographic) and the actual signed content — an attacker
* with package-write access could re-attach a valid bundle to a different
* image; this assertion prevents accepting such a re-attached bundle.
*
* Exported for unit testing; callers should use verifyBundle() instead.
*/
function assertSignedDigest(bundleJson, expectedDigest) {
	let dsse = bundleJson?.dsseEnvelope, payload = dsse?.payload;
	if (!payload) throw new VerifyImageError("Bundle is not a DSSE envelope or is missing a signed payload", "VERIFY_FAILED");
	try {
		let sl = JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
		if (dsse.payloadType === "application/vnd.in-toto+json") {
			let subjects = sl?.subject ?? [];
			if (!subjects.some((s) => s?.digest?.sha256 && `sha256:${s.digest.sha256}` === expectedDigest)) throw new VerifyImageError(`Signed digest (${subjects.map((s) => s?.digest?.sha256 ? `sha256:${s.digest.sha256}` : null).filter(Boolean).join(", ") || "missing"}) does not match fetched digest (${expectedDigest}). The bundle may have been re-attached to a different image.`, "VERIFY_FAILED");
		} else {
			let signedDigest = sl?.critical?.image?.["docker-manifest-digest"];
			if (!signedDigest || signedDigest !== expectedDigest) throw new VerifyImageError(`Signed digest (${signedDigest ?? "missing"}) does not match fetched digest (${expectedDigest}). The bundle may have been re-attached to a different image.`, "VERIFY_FAILED");
		}
	} catch (err) {
		throw err instanceof VerifyImageError ? err : new VerifyImageError("Failed to parse signed payload from bundle", "VERIFY_FAILED");
	}
}
/**
* Cryptographically verify a Sigstore Bundle (DSSE format) against a policy,
* then assert that the bundle's signed manifest digest matches the fetched digest.
*
* The bundle's DSSE envelope contains its own signed payload; no external
* payload is needed for this format.
*
* Policy fields in options:
*   certificateIssuer      – expected Fulcio OIDC issuer URL
*   certificateIdentityURI – SAN URI regexp pattern string
*   certificateOIDs        – { [oid]: derUtf8EncodedValue } map
*   tlogThreshold          – minimum transparency log entries (default 1)
*   ctLogThreshold         – minimum CT log entries (default 1)
*
* expectedDigest — "sha256:<hex>" fetched from the registry;
* must match the digest inside the signed payload.
*/
async function verifyBundle(bundleJson, options, expectedDigest) {
	let verifier = new import_dist$2.Verifier((0, import_dist$2.toTrustMaterial)(await (0, import_dist$1.getTrustedRoot)()), {
		ctlogThreshold: options.ctLogThreshold,
		tlogThreshold: options.tlogThreshold
	}), policy = {};
	options.certificateIdentityURI && (policy.subjectAlternativeName = options.certificateIdentityURI), options.certificateIssuer && (policy.extensions = { issuer: options.certificateIssuer }), options.certificateOIDs && (policy.oids = Object.entries(options.certificateOIDs).map(([oid, value]) => ({
		oid: { id: oid.split(".").map(Number) },
		value: Buffer.from(value)
	})));
	let signedEntity = (0, import_dist$2.toSignedEntity)((0, import_dist.bundleFromJSON)(bundleJson));
	try {
		verifier.verify(signedEntity, policy);
	} catch (err) {
		throw new VerifyImageError(`Image provenance verification failed: ${errorMessage(err)}`, "VERIFY_FAILED");
	}
	assertSignedDigest(bundleJson, expectedDigest);
}
//#endregion
//#region core/lib/provenance/verify-image.ts
/**
* verify-image.ts — Image provenance verification helpers
*
* Verifies the Docker image's Sigstore provenance bundle.
*
* Fail-closed policy:
*   - Any failure for a verifiable ref (version tag / 40-char SHA) → throws
*     VerifyImageError; the caller (main) is responsible for printing ::error::.
*   - Unverifiable ref (branch / local ./setup) → returns null.
*/
const REGISTRY = "ghcr.io", escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/**
* Convert an action ref into the base Docker image tag, then append the
* proxy engine suffix for non-default engines. The `transparent` engine
* (default) publishes the plain version tag (e.g. `2.1.0`), matching the
* pre-multi-engine tagging scheme; `explicit` (experimental) and `proxy`
* (the buildkitd-less network-isolation proxy used by the run action)
* each publish under their own suffix (e.g. `2.1.0-explicit`,
* `2.1.0-proxy`). All three share the same Sigstore verification identity
* (same workflow, same git ref) — only the published Docker tag differs, so
* this does not affect buildVerifyOptions below.
*/
function imageTagFromRef(actionRef, proxyEngine = "transparent") {
	if (!actionRef) return "";
	let base;
	return base = /^[0-9a-f]{40}$/i.test(actionRef) ? `sha-${actionRef.toLowerCase()}` : actionRef.startsWith("v") ? actionRef.slice(1) : actionRef, proxyEngine === "explicit" || proxyEngine === "proxy" ? `${base}-${proxyEngine}` : base;
}
/**
* Build verify options encoding the expected certificate identity.
*
* The SAN URI pattern uses `(\.|$)` boundary anchors for version tags so that
* e.g. @v2.1 matches v2.1.0 and v2.1.3 but NOT v2.10.0.
*
* For SHA pins, OID 1.13 (Source Repository Digest) pins the exact commit
* while the SAN accepts any release tag.
*
* Returns null for unverifiable refs (branch names, local paths).
*/
function buildVerifyOptions({ actionRef, actionRepo }) {
	let sanPrefix = `^${escapeRegex(`https://github.com/${actionRepo}/.github/workflows/docker-publish.yml@refs/tags/`)}`, base = {
		certificateIssuer: "https://token.actions.githubusercontent.com",
		tlogThreshold: 1,
		ctLogThreshold: 1
	};
	return /^[0-9a-f]{40}$/i.test(actionRef) ? {
		...base,
		certificateIdentityURI: `${sanPrefix}v`,
		certificateOIDs: { "1.3.6.1.4.1.57264.1.13": derUtf8(actionRef.toLowerCase()) }
	} : actionRef.startsWith("v") ? {
		...base,
		certificateIdentityURI: `${sanPrefix}${escapeRegex(actionRef)}(\\.|$)`
	} : null;
}
/**
* Verify image provenance and return the verified manifest digest.
*
* Returns null for unverifiable refs (branch / local ./setup).
* On failure, throws VerifyImageError — the caller is responsible for printing
* the error message.
*
*/
async function verifyImageDigest({ actionRef, actionRepo, proxyEngine = "transparent" }) {
	let repoPath = actionRepo.toLowerCase(), verifyOptions = buildVerifyOptions({
		actionRef,
		actionRepo
	});
	if (!verifyOptions) return null;
	let tag = imageTagFromRef(actionRef, proxyEngine), regToken = await fetchRegistryToken(REGISTRY, repoPath, readGhcrBasicAuth()), digest = await fetchManifestDigest(REGISTRY, repoPath, tag, regToken);
	return await verifyBundle(await fetchBundle(REGISTRY, repoPath, digest, regToken), verifyOptions, digest), digest;
}
/**
* Like verifyImageDigest, but throws ProvenanceError (see errors.ts) instead
* of the low-level VerifyImageError, so a caller gets one already-typed
* error to catch rather than having to translate the result itself.
*
* `verifyImageDigestFn` is an injectable seam (defaults to the real
* verifyImageDigest) for unit-testing without hitting the network/sigstore.
*/
async function verifyImageDigestOrThrow({ actionRef, actionRepo, proxyEngine, verifyImageDigestFn = verifyImageDigest }) {
	let digest;
	try {
		digest = await verifyImageDigestFn({
			actionRef,
			actionRepo,
			proxyEngine
		});
	} catch (e) {
		throw e instanceof VerifyImageError ? new ProvenanceError(e.message, e.code) : new ProvenanceError(errorMessage(e), "VERIFY_FAILED");
	}
	if (digest === null) throw new ProvenanceError(`Cannot verify image provenance for ref: ${JSON.stringify(actionRef)}. Pin the action to a version tag (e.g. @v2.1.0) or a commit SHA.`, "UNVERIFIABLE_REF");
	return digest;
}
//#endregion
//#region core/lib/actions/docker-error.ts
const SLIM_RUNNER_DETECTED_PREFIX = " Detected a container-based GitHub-hosted runner image (e.g. \"ubuntu-slim\")", SLIM_RUNNER_NOTE$1 = `${SLIM_RUNNER_DETECTED_PREFIX} — these ship a Docker client with no daemon and are not supported for this action.`;
/**
* Turns a caught `docker` invocation error into an actionable message,
* pointing at the runner requirement instead of surfacing execFileSync's
* opaque "Command failed: docker ...args..." text. Deliberately doesn't
* echo `e.message` when stderr was inherited (already visible live in the
* Actions log) — only captured stderr (e.g. from a piped call) is included,
* since otherwise nothing points the reader back to it.
*/
function describeDockerFailure(e, { operation = "docker", env = process.env, exists = node_fs.existsSync } = {}) {
	let err = e && typeof e == "object" ? e : {}, slimNote = isLikelySlimRunner(env, exists) ? SLIM_RUNNER_NOTE$1 : "", whatHappened;
	if (err.code === "ENOENT") whatHappened = `The "docker" command was not found on this runner's PATH while running ${operation}.`;
	else {
		let captured = typeof err.stderr == "string" ? err.stderr.trim() : "";
		whatHappened = `${operation} failed${captured ? `: ${captured}` : " (see the Docker output above for the underlying error)"}.`;
	}
	return `${whatHappened}${slimNote} Buildcage requires a working Docker installation (client and daemon) on the runner. Lightweight runner images such as GitHub-hosted "ubuntu-slim" ship a Docker client but no daemon and are not supported for this action — use "ubuntu-latest" (or another runner with a full Docker install) instead. See docs/reference.md and docs/security.md for details.`;
}
/**
* Best-effort detection of GitHub's container-based hosted runner images
* (currently: ubuntu-slim) — these run jobs inside a container rather than
* a dedicated VM, so unlike VM-based ubuntu-latest/22.04/24.04/26.04 they
* ship a Docker client with no daemon.
*
* Not an official/documented API: ImageOS is hardcoded to "Linux" (vs.
* "ubuntu24" etc. on VM images) and /run/.containerenv is baked into the
* image at build time by GitHub's own Dockerfile
* (github.com/actions/runner-images/blob/main/images/ubuntu-slim/Dockerfile).
* Both signals could change without notice — failing to detect just falls
* back to the generic message in describeDockerFailure, so this is safe to
* get wrong.
*/
function isLikelySlimRunner(_env = process.env, _exists = node_fs.existsSync) {
	return _env.ImageOS === "Linux" && _exists("/run/.containerenv");
}
//#endregion
//#region core/lib/actions/annotation.ts
/**
* Build a GitHub Actions annotation emitter. When `enabled` is false, every
* method is a no-op — used to suppress annotations when this script isn't
* running as the real action.
*/
function createAnnotation(enabled) {
	return enabled ? {
		notice(message) {
			console.log(`::notice::${message}`);
		},
		warning(message) {
			console.log(`::warning::${message}`);
		},
		error(message) {
			console.log(`::error::${message}`);
		}
	} : {
		notice() {},
		warning() {},
		error() {}
	};
}
//#endregion
//#region core/lib/acl/wildcard-rules.ts
/**
* Rule conversion library for buildcage container.
* Converts wildcard patterns to regex strings for HAProxy ACLs.
*/
/**
* Split a whitespace-separated rules string into individual rule tokens.
*/
function splitRuleTokens(rulesInput) {
	return rulesInput?.trim().split(/\s+/).filter(Boolean) ?? [];
}
/**
* Split+validate a space-separated rules string, returning the raw
* (unconverted) rule tokens — for callers that need the original
* wildcard/~regex syntax preserved, such as known_blocked_rules.
*
* @throws {Error} if any rule has invalid wildcard/regex syntax
*/
function parseAndValidateRules(rulesInput) {
	let rules = splitRuleTokens(rulesInput);
	return rules.forEach(convertRule), rules;
}
/**
* Convert a single rule (wildcard or `~`-prefixed regex) to a regex string.
*/
function convertRule(rule) {
	if (rule.startsWith("~")) {
		let regex = rule.slice(1);
		try {
			new RegExp(regex);
		} catch (e) {
			throw Error(`Invalid regex in rule "${rule}": ${e.message}`);
		}
		return regex;
	}
	return `^${wildcardToRegex(rule)}$`;
}
/**
* Convert a domain wildcard to a regex string (without anchors or port).
*
* Supported wildcards:
*   `**` — matches one or more characters including dots
*   `*`  — matches one or more characters excluding dots
*   `?`  — matches a single character excluding dots
*
* A dot-separated part containing `*` must be exactly `*` or `**`.
*/
function domainToRegex(domain) {
	return domain.split(".").map((part) => {
		if (part === "**") return ".+";
		if (part === "*") return "[^.]+";
		if (part.includes("*")) throw Error(`Invalid wildcard in "${domain}": part "${part}" mixes "*" with other characters`);
		return part.replace(/[.+^$()[\]{}|\\]/g, "\\$&").replace(/\?/g, "[^.]");
	}).join("\\.");
}
/**
* Convert a wildcard pattern (`<domain>:<port|*>`) to a regex string (without anchors).
*/
function wildcardToRegex(pattern) {
	if (!/^[^:]+:(?:\d+|\*)$/.test(pattern)) throw Error(`Invalid pattern "${pattern}"`);
	let [domain, port] = pattern.split(":"), portRegex = port === "*" ? "\\d+" : port;
	return `${domainToRegex(domain)}:${portRegex}`;
}
//#endregion
//#region core/lib/acl/rules.ts
/**
* Thrown when an ACL rule input (allowed_https_rules/allowed_http_rules/
* allowed_ip_rules/known_blocked_rules) fails to parse — shared by the
* setup and run actions, which both accept the same rule syntax.
*/
var InvalidRulesError = class extends ActionError {};
/**
* Rethrow a rule-parser's syntax errors as an InvalidRulesError.
*/
function parseRulesOrThrow(rulesInput) {
	try {
		return parseAndValidateRules(rulesInput);
	} catch (e) {
		throw new InvalidRulesError(errorMessage(e), "INVALID_RULES");
	}
}
/**
* Build ACL rules from input strings. Rules are passed through as-is
* (wildcard format), validated eagerly.
*/
function buildACLRules({ httpsRulesInput, httpRulesInput, ipRulesInput }) {
	return {
		httpsRules: parseRulesOrThrow(httpsRulesInput),
		httpRules: parseRulesOrThrow(httpRulesInput),
		ipRules: parseRulesOrThrow(ipRulesInput)
	};
}
//#endregion
//#region run/src/lib/errors.ts
var SandboxError = class extends ActionError {};
//#endregion
//#region run/src/lib/sudo-preflight.ts
const SLIM_RUNNER_NOTE = `${SLIM_RUNNER_DETECTED_PREFIX} — these typically don't have passwordless sudo configured for this kind of privileged setup.`;
function describeSudoFailure(e, { env = process.env, exists = node_fs.existsSync } = {}) {
	let err = e && typeof e == "object" ? e : {}, captured = typeof err.stderr == "string" ? err.stderr.trim() : "";
	return `'sudo' is not available without a password on this runner.${isLikelySlimRunner(env, exists) ? SLIM_RUNNER_NOTE : ""} The run action requires a Linux runner with passwordless sudo for the isolation setup itself (network namespace, veth, iptables) — this is the default on GitHub-hosted "ubuntu-*" runners, but NOT on lightweight images such as "ubuntu-slim" or many self-hosted/minimal runners. See docs/reference.md and docs/security.md for details.${captured ? ` (${captured})` : ""}`;
}
/**
* Fails fast, before spinning up the proxy container, so a missing
* passwordless-sudo setup is never misattributed to the user's own `run:`
* command failing. Only covers the general case: a sudoers config scoped to
* a specific command (rather than blanket NOPASSWD:ALL) can pass this probe
* yet still fail runIsolated()'s later, differently-shaped invocation.
*/
function checkPasswordlessSudo() {
	try {
		(0, node_child_process.execFileSync)("sudo", ["-n", "true"], {
			encoding: "utf8",
			stdio: [
				"ignore",
				"ignore",
				"pipe"
			]
		});
	} catch (e) {
		throw new SandboxError(describeSudoFailure(e), "PASSWORDLESS_SUDO_REQUIRED");
	}
}
//#endregion
//#region run/src/lib/container.ts
/**
* Each `run` step gets its own throwaway proxy container (start -> run ->
* report -> stop) rather than reusing one across steps, so a random name
* avoids collisions across concurrent/successive steps by construction.
*/
function generateContainerName() {
	return `buildcage-proxy-${(0, node_crypto.randomBytes)(4).toString("hex")}`;
}
/**
* Distinguishes "this container doesn't exist" (docker's own wording, e.g.
* `no such object`) from "docker itself is unusable on this runner" — both
* phrasings are matched for resilience across docker CLI versions.
*/
function isContainerNotFoundError(e) {
	let err = e && typeof e == "object" ? e : {}, text = `${err.stderr ?? ""} ${err.message ?? ""}`.toLowerCase();
	return text.includes("no such object") || text.includes("no such container");
}
function getContainerPid(containerName, { exec = node_child_process.execFileSync } = {}) {
	let out;
	try {
		out = exec("docker", [
			"inspect",
			"--format",
			"{{.State.Pid}}",
			containerName
		], {
			encoding: "utf8",
			stdio: [
				"ignore",
				"pipe",
				"pipe"
			],
			env: {
				...process.env,
				LC_ALL: "C"
			}
		}).trim();
	} catch (e) {
		if (isContainerNotFoundError(e)) return null;
		throw new SandboxError(describeDockerFailure(e, { operation: "docker inspect" }), "DOCKER_UNAVAILABLE");
	}
	let pid = Number(out);
	return Number.isInteger(pid) && pid > 0 ? pid : null;
}
//#endregion
//#region core/lib/docker/container.ts
/**
* Reused as the Compose project name (separate Docker namespace from
* container names, so no collision). Passing an explicit, per-container
* project name matters when multiple steps/containers in the same job run
* concurrently: without it, Compose falls back to one shared, directory-
* derived project name, and a concurrent `up`/`down`/`ps` from a different
* step can recreate, tear down, or misidentify another step's container.
*/
function deriveProjectName(containerName) {
	return containerName;
}
function buildDockerCpArgs({ containerName, containerPath, hostPath }) {
	return [
		"cp",
		`${containerName}:${containerPath}`,
		hostPath
	];
}
//#endregion
//#region run/src/lib/compose-args.ts
function buildComposeUpArgs({ composeFile, projectName, pullPolicy }) {
	return [
		"compose",
		"-f",
		composeFile,
		"-p",
		projectName,
		"up",
		"-d",
		"--pull",
		pullPolicy,
		"--no-build",
		"--wait",
		"--quiet-pull"
	];
}
/** Build the `docker compose ... down` argv — see buildComposeUpArgs above. */
function buildComposeDownArgs({ composeFile, projectName }) {
	return [
		"compose",
		"-f",
		composeFile,
		"-p",
		projectName,
		"down"
	];
}
//#endregion
//#region run/scripts/extra-masked-proc-paths.json
var extra_masked_proc_paths_default = [
	"/proc/kallsyms",
	"/proc/kmsg",
	"/proc/sysrq-trigger"
];
//#endregion
//#region run/src/lib/isolated-exec.ts
const __dirname$1 = (0, node_path.dirname)((0, node_url.fileURLToPath)(require("url").pathToFileURL(__filename).href)), SANDBOX_SCRATCH_BASE = "/var/tmp/buildcage";
/**
* Write the user-supplied `run:` input to an executable script file.
* Routing through a file (rather than passing the command inline to a
* shell) avoids any shell-injection surface from the input string.
*/
function writeRunScript(runInput, dir) {
	let scriptPath = (0, node_path.join)(dir, "run-script.sh");
	return (0, node_fs.writeFileSync)(scriptPath, runInput.startsWith("#!") ? runInput : `#!/bin/sh\nset -e\n${runInput}\n`, { mode: 448 }), scriptPath;
}
/**
* Generate runc's own default OCI bundle config via `runc spec` (run in
* `bundleDir`, which is where it writes `config.json`). Used as the
* starting point for buildOciConfig rather than hand-writing the full
* spec from scratch, so the baseline mounts/masked-paths/rlimits stay
* exactly what runc itself considers a sane default for its own version,
* and buildOciConfig only needs to override/extend the handful of fields
* this sandbox actually cares about.
*/
function generateBaseOciSpec(runcPath, bundleDir) {
	return (0, node_child_process.execFileSync)(runcPath, ["spec"], { cwd: bundleDir }), JSON.parse((0, node_fs.readFileSync)((0, node_path.join)(bundleDir, "config.json"), "utf8"));
}
function extractRuncBootstrap({ containerName, destDir }) {
	let runcPath = (0, node_path.join)(destDir, "runc"), genSeccompProfilePath = (0, node_path.join)(destDir, "gen-seccomp-profile");
	(0, node_child_process.execFileSync)("docker", buildDockerCpArgs({
		containerName,
		containerPath: "/opt/buildcage/bin/runc",
		hostPath: runcPath
	})), (0, node_child_process.execFileSync)("docker", buildDockerCpArgs({
		containerName,
		containerPath: "/opt/buildcage/bin/gen-seccomp-profile",
		hostPath: genSeccompProfilePath
	})), (0, node_fs.chmodSync)(runcPath, 493), (0, node_fs.chmodSync)(genSeccompProfilePath, 493);
	let seccompProfile = JSON.parse((0, node_child_process.execFileSync)(genSeccompProfilePath, { encoding: "utf8" })), baseSpec = generateBaseOciSpec(runcPath, destDir);
	return (0, node_fs.rmSync)(genSeccompProfilePath), {
		runcPath,
		seccompProfile,
		baseSpec
	};
}
/**
* Pure: extract {mountPoint, fsType} for every line of raw
* /proc/self/mountinfo content. Format (space-separated fields):
*   ID PARENT-ID MAJOR:MINOR ROOT MOUNT-POINT OPTIONS [OPT-FIELDS...] - FSTYPE SOURCE SUPER-OPTIONS
* The mount point is always field 5 (index 4); the filesystem type is
* always the field right after the literal "-" separator, regardless of
* how many optional fields precede it.
*/
function parseMountinfo(mountinfoContent) {
	return mountinfoContent.split("\n").filter(Boolean).map((line) => {
		let fields = line.split(" "), dashIndex = fields.indexOf("-");
		return {
			mountPoint: fields[4],
			fsType: fields[dashIndex + 1]
		};
	});
}
/**
* Reads the real host mount table. Node runs directly on the runner host,
* not inside any namespace, so this is exactly the mount table
* run-isolated.sh's `mount --rbind /` will duplicate into rootfsBindDir a
* moment later (see buildOciConfig's readonlyPaths handling for why this
* matters).
*/
function listHostMounts() {
	return parseMountinfo((0, node_fs.readFileSync)("/proc/self/mountinfo", "utf8"));
}
/**
* Pure: given the host's real mount table, the set of paths that must stay
* writable, and the destinations runc's own base spec already declares a
* fresh mount for (see freshMountDestinationsFrom), return the host mount
* points that need to be explicitly forced read-only. This exists because
* `root.readonly` in OCI/runc only remounts the top-level rootfs mount
* point — it does *not* recursively apply to separate mount points that
* `mount --rbind /` duplicates into the sandbox's rootfs. A host mount
* point is skipped only when it exactly matches one of
* `freshMountDestinations`: runc will mount fresh content there when it
* sets up the sandbox's own further-nested namespaces, shadowing whatever
* the rbind copy swept in from the host at that path, so forcing that
* (about-to-be-overridden) copy read-only would be pointless -- and some
* pseudo-filesystems reject a read-only remount outright. Any other real
* host mount point not covered would otherwise remain fully writable
* despite the sandbox's documented read-only-outside-workdir/home/tmp/
* writable guarantee. "/" itself is excluded since root.readonly already
* covers it directly.
*/
function computeReadonlyHostMounts(hostMounts, protectedPaths, freshMountDestinations) {
	return hostMounts.filter(({ mountPoint }) => mountPoint !== "/" && !freshMountDestinations.has(mountPoint) && !protectedPaths.has(mountPoint)).map(({ mountPoint }) => mountPoint);
}
function freshMountDestinationsFrom(baseSpec) {
	return new Set(baseSpec.mounts.map((m) => m.destination));
}
const SETPRIV_CANDIDATE_PATHS = [
	"/usr/bin/setpriv",
	"/bin/setpriv",
	"/usr/sbin/setpriv",
	"/sbin/setpriv"
];
function resolveSetprivPath() {
	return SETPRIV_CANDIDATE_PATHS.find((p) => (0, node_fs.existsSync)(p)) ?? "setpriv";
}
/**
* True if `a` and `b` are the same path, or one is an ancestor directory of
* the other (path-component-wise, not a bare string prefix -- "/var/tmp/bu"
* must not count as overlapping "/var/tmp/buildcage").
*/
function pathsOverlap(a, b) {
	if (a === b) return !0;
	let withSlash = (p) => p.endsWith("/") ? p : `${p}/`;
	return a.startsWith(withSlash(b)) || b.startsWith(withSlash(a));
}
/**
* Fail closed if any writable-exception directory is, or contains, or is
* contained in, SANDBOX_SCRATCH_BASE. That directory holds the run's own
* `mount --rbind /` rootfs (see rootfsBindDir in main.ts); the writable
* exceptions are recursive bind-mounts, so any overlap would recursively
* re-expose that rootfs inside the sandbox as a second, *writable* copy of
* the whole host `/` -- the exact escape SANDBOX_SCRATCH_BASE's placement
* (outside the default writable set) exists to avoid. Only reachable via an
* explicit `writable:` input naming /var/tmp/buildcage or an ancestor of it
* (workdir/home/tmp/RUNNER_TEMP are operator/runner-controlled, not
* attacker-controlled), so this is a misconfiguration guard, not a
* hardening measure against a hostile isolated command.
*/
function assertScratchBaseNotWritable(writableDirs) {
	let overlapping = writableDirs.find((p) => pathsOverlap(p, SANDBOX_SCRATCH_BASE));
	if (overlapping) throw Error(`writable path ${JSON.stringify(overlapping)} overlaps the sandbox's own scratch directory (${SANDBOX_SCRATCH_BASE}); this would re-expose the sandboxed host filesystem read-write inside the sandbox itself. Choose a writable path outside ${SANDBOX_SCRATCH_BASE}.`);
}
function buildOciConfig(baseSpec, { uid, gid, workdir, home, runnerTemp, writablePaths = [], env, netnsPath, rootfsBindDir, resolvConfPath, seccompProfile, scriptPath, hostMounts = [] }) {
	let disableReadonly = writablePaths.includes("/"), mounts = [...baseSpec.mounts, {
		destination: "/etc/resolv.conf",
		type: "none",
		source: resolvConfPath,
		options: ["rbind", "ro"]
	}], writableDirs = [...new Set([
		workdir,
		home,
		"/tmp",
		runnerTemp,
		...writablePaths
	].filter((p) => !!p))], protectedPaths = new Set(writableDirs);
	if (!disableReadonly) {
		assertScratchBaseNotWritable(writableDirs);
		for (let p of writableDirs) mounts.push({
			destination: p,
			type: "none",
			source: p,
			options: ["rbind", "rw"]
		});
	}
	let maskedPaths = [...baseSpec.linux.maskedPaths ?? [], ...extra_masked_proc_paths_default], baseReadonlyPaths = (baseSpec.linux.readonlyPaths ?? []).filter((p) => !extra_masked_proc_paths_default.includes(p)), readonlyPaths = disableReadonly ? baseReadonlyPaths : Array.from(/* @__PURE__ */ new Set([...baseReadonlyPaths, ...computeReadonlyHostMounts(hostMounts, protectedPaths, freshMountDestinationsFrom(baseSpec))])), namespaces = baseSpec.linux.namespaces.map((ns) => ns.type === "network" ? {
		...ns,
		path: netnsPath
	} : ns);
	return {
		...baseSpec,
		root: {
			path: rootfsBindDir,
			readonly: !disableReadonly
		},
		mounts,
		process: {
			...baseSpec.process,
			terminal: !1,
			user: {
				uid,
				gid
			},
			args: [
				resolveSetprivPath(),
				"--pdeathsig=KILL",
				"--",
				scriptPath
			],
			env: Object.entries(env).filter(([, v]) => v !== void 0).map(([k, v]) => `${k}=${v}`),
			cwd: workdir || "/",
			capabilities: {
				bounding: [],
				effective: [],
				permitted: [],
				inheritable: [],
				ambient: []
			},
			noNewPrivileges: !0
		},
		linux: {
			...baseSpec.linux,
			namespaces,
			seccomp: seccompProfile,
			maskedPaths,
			readonlyPaths
		}
	};
}
/**
* Write the final OCI config to `bundleDir/config.json` (overwriting the
* `runc spec` placeholder generateBaseOciSpec left there). Mode 0600:
* `process.env` embeds the whole step environment, including any secrets
* passed via `env:`.
*/
function writeOciConfig(config, bundleDir) {
	let configPath = (0, node_path.join)(bundleDir, "config.json");
	return (0, node_fs.writeFileSync)(configPath, JSON.stringify(config), { mode: 384 }), configPath;
}
/** Write the resolv.conf bind-mount source referenced by buildOciConfig. */
function writeResolvConf(dns, dir) {
	let resolvConfPath = (0, node_path.join)(dir, "resolv.conf");
	return (0, node_fs.writeFileSync)(resolvConfPath, `nameserver ${dns}\n`, { mode: 420 }), resolvConfPath;
}
function runIsolated({ runcPath, proxyPid, bundleDir, containerId, netnsName, rootfsBindDir, gateway, dns, targetIp }) {
	let args = [
		"-n",
		"--",
		(0, node_path.join)(__dirname$1, "..", "scripts", "run-isolated.sh"),
		"--proxy-pid",
		String(proxyPid),
		"--runc",
		runcPath,
		"--bundle",
		bundleDir,
		"--container-id",
		containerId,
		"--netns-name",
		netnsName,
		"--rootfs-bind-dir",
		rootfsBindDir,
		"--gateway",
		gateway,
		"--dns",
		dns,
		"--target-ip",
		targetIp
	];
	try {
		return (0, node_child_process.execFileSync)("sudo", args, { stdio: "inherit" }), 0;
	} catch (e) {
		let status = e.status;
		return typeof status == "number" ? status : 1;
	}
}
/**
* Pure: mount points from raw /proc/self/mountinfo content that are
* nested under `dir` (including `dir` itself), deepest-path-first so a
* caller can safely unmount children before their parents.
*/
function parseMountsUnder(mountinfoContent, dir) {
	let prefix = dir.endsWith("/") ? dir : `${dir}/`;
	return parseMountinfo(mountinfoContent).map(({ mountPoint }) => mountPoint).filter((mountPoint) => mountPoint === dir || mountPoint.startsWith(prefix)).sort((a, b) => b.length - a.length);
}
/**
* Force-detaches any mount points still nested under `dir` before it's
* recursively deleted. This is the safety net for rootfsBindDir (a
* `mount --rbind /` of the entire host filesystem — see main.ts) surviving
* past run-isolated.sh's own cleanup trap: if that trap never runs (e.g.
* run-isolated.sh itself is SIGKILL'd, which bypasses traps entirely) or
* its `umount -R` fails (EBUSY), a plain recursive delete of `dir` would
* otherwise walk straight through the still-live bind-mount and delete
* the real files on the host it points at, not a sandboxed copy. `-l`
* (lazy) detaches each mount from the namespace immediately regardless of
* busy references, so this step itself can't hang or fail the way a
* normal (non-lazy) unmount could.
*/
function unmountAllUnder(dir) {
	let mountPoints;
	try {
		mountPoints = parseMountsUnder((0, node_fs.readFileSync)("/proc/self/mountinfo", "utf8"), dir);
	} catch {
		return;
	}
	for (let mountPoint of mountPoints) try {
		(0, node_child_process.execFileSync)("sudo", [
			"umount",
			"-R",
			"-l",
			mountPoint
		], { stdio: [
			"ignore",
			"ignore",
			"pipe"
		] });
	} catch (e) {
		console.log(`::warning::Failed to unmount ${mountPoint} before cleanup: ${errorMessage(e)}`);
	}
}
/**
* Removes the scratch dir, retrying on EBUSY. A lazy unmount (see
* unmountAllUnder) detaches a mount from the path-resolution tree
* immediately -- it stops appearing in /proc/self/mountinfo right away --
* but the kernel's underlying teardown of that now-orphaned mount can
* still lag behind by a short, bounded window, which can make a
* directory rmSync is about to delete spuriously report EBUSY even
* though it's no longer listed as a mountpoint at all. Resolves on the
* very next attempt after a brief wait.
*/
function removeScratchDir(dir) {
	for (let attempt = 1; attempt <= 5; attempt++) try {
		(0, node_fs.rmSync)(dir, {
			recursive: !0,
			force: !0
		});
		return;
	} catch (e) {
		if (e.code !== "EBUSY" || attempt === 5) throw e;
		Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
	}
}
/**
* Force-detach anything still mounted under `dir` (the rootfs bind-mount
* safety net — see unmountAllUnder) and then recursively remove it. Exported
* so post.ts can reclaim a scratch dir orphaned by a hard kill that bypassed
* withScratchDir's own finally. No-ops safely when `dir` doesn't exist.
*/
function cleanupScratchDir(dir) {
	unmountAllUnder(dir), removeScratchDir(dir);
}
/**
* Absolute path of the scratch dir for a given proxy container, derived
* deterministically from `containerName` (the `buildcage-proxy-` prefix
* swapped for `sandbox-`, under SANDBOX_SCRATCH_BASE). Lets the post step
* reconstruct and reclaim the exact same directory from `STATE_container_name`
* alone.
*/
function scratchDirFor(containerName) {
	return (0, node_path.join)(SANDBOX_SCRATCH_BASE, containerName.replace(/^buildcage-proxy-/, "sandbox-"));
}
/**
* Create/remove a scratch directory for this step's OCI bundle + run-script.
* With `containerName` the dir is named deterministically (scratchDirFor) so
* post.ts can reclaim it after a hard kill; without it a random mkdtemp name
* is used (unit tests). Cleaned up on every exit path that unwinds — a
* SIGKILL bypasses this finally, which is exactly what post.ts covers.
*/
function withScratchDir(fn, containerName) {
	let dir;
	(0, node_fs.mkdirSync)(SANDBOX_SCRATCH_BASE, {
		recursive: !0,
		mode: 493
	}), containerName ? (dir = scratchDirFor(containerName), cleanupScratchDir(dir), (0, node_fs.mkdirSync)(dir, {
		recursive: !0,
		mode: 448
	})) : dir = (0, node_fs.mkdtempSync)((0, node_path.join)(SANDBOX_SCRATCH_BASE, "sandbox-"));
	try {
		return fn(dir);
	} finally {
		cleanupScratchDir(dir);
	}
}
//#endregion
//#region core/lib/report/build-example.ts
const ruleTypeToParam = {
	HTTPS: "allowed_https_rules",
	HTTP: "allowed_http_rules",
	IP: "allowed_ip_rules"
};
/**
* Build a restrict-mode YAML configuration example from audited rows.
* Returns a markdown string wrapped in <details> tags, or "" if no rows.
*
* actionRef is the ref (tag or commit SHA) this action was invoked with.
*/
function buildRestrictExample(auditedRows, actionRepo, actionRef, { actionName = "setup", runCommand } = {}) {
	if (!auditedRows || auditedRows.length === 0) return "";
	let ref = /^[0-9a-f]{40}$/i.test(actionRef) ? "<sha>" : actionRef, groups = /* @__PURE__ */ new Map();
	for (let r of auditedRows) {
		let param = ruleTypeToParam[r.ruleType];
		param && (groups.has(param) || groups.set(param, []), groups.get(param).push(`${r.host}:${r.port}`));
	}
	if (groups.size === 0) return "";
	let yaml = "";
	if (yaml += "- name: Start Buildcage in restrict mode\n", yaml += `  uses: ${actionRepo}/${actionName}@${ref}\n`, yaml += "  with:\n", actionName === "run" && runCommand) {
		yaml += "    run: |\n";
		for (let line of runCommand.replace(/\r?\n$/, "").split(/\r?\n/)) yaml += `      ${line}\n`;
	}
	yaml += "    proxy_mode: restrict\n";
	for (let [param, rules] of groups) {
		yaml += `    ${param}: >-\n`;
		for (let rule of rules) yaml += `      ${rule}\n`;
	}
	let md = "\n<details>\n";
	return md += "<summary>🛡️ Switch to restrict mode</summary>\n\n", md += "```yaml\n", md += yaml, md += "```\n\n", md += "</details>\n", md;
}
//#endregion
//#region core/lib/report/known-blocked.ts
/**
* Shared logic for `known_blocked_rules`: domains expected to be blocked,
* so a matching blocked connection doesn't fail the step even when
* fail_on_blocked is true. Never sent to the container's ACL — only
* affects this action's pass/fail decision and Job Summary rendering.
*/
/**
* Tag each aggregated blocked-hosts row with `expected: boolean` — true iff
* its `host:port` matches at least one known_blocked_rules pattern.
*
* knownBlockedRules is as returned by parseAndValidateRules.
*/
function annotateKnownBlocked(blockedRows, knownBlockedRules) {
	let matchers = knownBlockedRules.map((rule) => new RegExp(convertRule(rule)));
	return blockedRows.map((row) => ({
		...row,
		expected: matchers.some((re) => re.test(`${row.host}:${row.port}`))
	}));
}
function determineBlockedOutcome({ isAudit, failOnBlocked, blockedCount, blockedRows }) {
	if (!blockedCount) return {
		level: "none",
		shouldFail: !1
	};
	if (isAudit) return {
		level: "notice",
		shouldFail: !1
	};
	let hasUnexpected = blockedRows.length === 0 || blockedRows.some((row) => !row.expected);
	return failOnBlocked && hasUnexpected ? {
		level: "error",
		shouldFail: !0
	} : {
		level: "notice",
		shouldFail: !1
	};
}
function buildBlockedMessage({ blockedCount, blockedRows, engineLabel, isAudit }) {
	let base = `${blockedCount} blocked connection(s) detected by buildcage ${engineLabel}`;
	if (isAudit) return base;
	let unexpected = blockedRows.filter((row) => !row.expected).length;
	return unexpected === blockedRows.length ? base : unexpected === 0 ? `${base}, all matched known_blocked_rules (expected)` : `${base} (${unexpected} of ${blockedRows.length} distinct blocked host(s) unmatched by known_blocked_rules)`;
}
function evaluateBlockedReport(report, { knownBlockedRules, failOnBlocked, engineLabel }) {
	let isAudit = report.mode === "audit", blockedRows = annotateKnownBlocked(report.sections?.blocked ?? [], knownBlockedRules), outcome = determineBlockedOutcome({
		isAudit,
		failOnBlocked,
		blockedCount: report.blockedCount ?? 0,
		blockedRows
	}), message = buildBlockedMessage({
		blockedCount: report.blockedCount ?? 0,
		blockedRows,
		engineLabel,
		isAudit
	});
	return {
		blockedRows,
		showExpected: knownBlockedRules.length > 0,
		outcome,
		message
	};
}
//#endregion
//#region core/lib/actions/markdown-table.ts
const ALIGN_MARKERS = {
	left: "---",
	right: "---:",
	center: ":---:"
}, alignMarker = (align) => ALIGN_MARKERS[align ?? "left"] ?? ALIGN_MARKERS.left;
/**
* Render a generic GitHub-flavored markdown table.
*/
function markdownTable(formats, rows) {
	let headers = formats.map((f) => f.title), aligns = formats.map((f) => alignMarker(f.align)), lines = [`| ${headers.join(" | ")} |`, `| ${aligns.join(" | ")} |`];
	for (let row of rows) {
		let cells = formats.map((f) => row[f.key]);
		lines.push(`| ${cells.join(" | ")} |`);
	}
	return lines.join("\n");
}
//#endregion
//#region core/lib/report/host-table.ts
/**
* Render aggregated host rows as a GitHub-flavored markdown table.
*/
function renderHostTable(rows, { showReason = !1, showExpected = !1 } = {}) {
	let formats = [{
		key: "host",
		title: "Host"
	}, {
		key: "ruleType",
		title: "Rule"
	}];
	return showReason && formats.push({
		key: "reason",
		title: "Reason"
	}), formats.push({
		key: "count",
		title: "Count",
		align: "right"
	}), showExpected && formats.push({
		key: "expected",
		title: "Expected",
		align: "center"
	}), markdownTable(formats, rows.map((r) => ({
		host: `${r.host}:${r.port}`,
		ruleType: r.ruleType,
		reason: r.reason,
		count: r.count,
		expected: r.expected ? "✅" : ""
	})));
}
//#endregion
//#region run/src/lib/report.ts
/**
* Fetch the structured HAProxy-log report from the (still-running) proxy
* container. Unlike report/src/main.ts (which supports both engines), the
* run action always runs the transparent-engine proxy stack, so this
* only ever needs core/scripts/report.js.
*/
function fetchReport(containerName) {
	let jsonOutput = (0, node_child_process.execFileSync)("docker", [
		"exec",
		containerName,
		"qjs",
		"--std",
		"-m",
		"/opt/buildcage/scripts/report.js"
	], {
		encoding: "utf8",
		stdio: [
			"ignore",
			"pipe",
			"pipe"
		]
	});
	return JSON.parse(jsonOutput);
}
function buildReportMarkdown(report, { stepLabel, actionRepo, actionRef, runCommand, blockedRows = [], showExpected = !1 } = {}) {
	let heading = `Outbound Traffic Report${stepLabel ? ` — ${stepLabel}` : ""}`;
	if (report.mode === null) return `## ${heading}\n\nNo proxy logs found.\n`;
	let isAudit = report.mode === "audit", markdown = `## ${heading} (${report.mode} mode)\n\n`;
	if (isAudit) {
		let audited = report.sections?.audited || [];
		audited.length > 0 && (markdown += "### 📋 Audited Hosts\n\n" + renderHostTable(audited) + "\n\n"), actionRepo && (markdown += buildRestrictExample(audited, actionRepo, actionRef, {
			actionName: "run",
			runCommand
		})), blockedRows.length > 0 && (markdown += "### 🚫 Blocked Hosts\n\n" + renderHostTable(blockedRows, {
			showReason: !0,
			showExpected
		}) + "\n\n");
	} else {
		let allowed = report.sections?.allowed || [];
		allowed.length > 0 && (markdown += "### ✅ Allowed Hosts\n\n" + renderHostTable(allowed) + "\n\n"), blockedRows.length > 0 && (markdown += "### 🚫 Blocked Hosts\n\n" + renderHostTable(blockedRows, {
			showReason: !0,
			showExpected
		}) + "\n\n");
	}
	return markdown;
}
function writeReport(report, { stepLabel, failOnBlocked, actionRepo, actionRef, runCommand, knownBlockedRules = [] } = {}) {
	let { blockedRows, showExpected, outcome, message } = evaluateBlockedReport(report, {
		knownBlockedRules,
		failOnBlocked: failOnBlocked ?? !1,
		engineLabel: "sandbox"
	}), markdown = buildReportMarkdown(report, {
		stepLabel,
		actionRepo,
		actionRef,
		runCommand,
		blockedRows,
		showExpected
	}), summaryFile = process.env.GITHUB_STEP_SUMMARY;
	summaryFile ? (0, node_fs.appendFileSync)(summaryFile, markdown) : console.log(markdown);
	let debugSummaryFile = process.env.BUILDCAGE_RUN_DEBUG_SUMMARY_FILE;
	debugSummaryFile && (0, node_fs.appendFileSync)(debugSummaryFile, markdown);
	let annotation = createAnnotation(!!summaryFile);
	outcome.level === "error" ? (annotation.error(message), process.exitCode = 1) : outcome.level === "notice" && annotation.notice(message);
}
//#endregion
//#region run/src/main.ts
const composeFile = (0, node_path.join)((0, node_path.dirname)((0, node_url.fileURLToPath)(require("url").pathToFileURL(__filename).href)), "../compose.yaml");
/**
* Verifies image provenance and resolves the digest-pinned image ref for
* the run action's (buildkitd-less) proxy image, published under the `-proxy`
* tag suffix (see imageTagFromRef in core/lib/provenance/verify-image.ts).
*/
async function resolveVerifiedImage({ actionRef, actionRepo }) {
	let digest = await verifyImageDigestOrThrow({
		actionRef,
		actionRepo,
		proxyEngine: "proxy"
	});
	return console.log(`Image provenance verified for ref: ${JSON.stringify(actionRef)} (digest ${digest}).`), {
		imageRef: resolveBuildcageImageRef({
			imageDigest: digest,
			actionRepository: actionRepo
		}),
		pullPolicy: "always"
	};
}
/**
* Never sent to the container's ACL — see core/lib/report/known-blocked.ts.
*/
function readKnownBlockedRules(input) {
	return parseRulesOrThrow(input);
}
/**
* Parse the `writable` input into a list of directories. Newline-separated
* (not whitespace-split like the ACL rule inputs above) since paths can
* legitimately contain spaces.
*/
function parseWritablePaths(input) {
	return input?.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) ?? [];
}
function logRules(label, rules) {
	console.log(`${label} rules:${rules.length === 0 ? " (none)" : ""}`);
	for (let r of rules) console.log(`  ${r}`);
}
async function main() {
	let env = process.env, actionRef = env.GITHUB_ACTION_REF || "v2", actionRepo = env.GITHUB_ACTION_REPOSITORY || "dash14/buildcage", runInput = env.INPUT_RUN ?? "";
	if (!runInput.trim()) throw new SandboxError("Input 'run' is required.", "MISSING_RUN");
	checkPasswordlessSudo();
	let annotation = createAnnotation(!!env.GITHUB_STEP_SUMMARY), { imageRef, pullPolicy } = await resolveVerifiedImage({
		actionRef,
		actionRepo
	});
	console.log(`buildcage-proxy image: ${imageRef}`);
	let rules = buildACLRules({
		httpsRulesInput: env.INPUT_ALLOWED_HTTPS_RULES,
		httpRulesInput: env.INPUT_ALLOWED_HTTP_RULES,
		ipRulesInput: env.INPUT_ALLOWED_IP_RULES
	}), knownBlockedRules = readKnownBlockedRules(env.INPUT_KNOWN_BLOCKED_RULES);
	console.log("::group::Configured ACL Rules"), logRules("HTTPS", rules.httpsRules), logRules("HTTP", rules.httpRules), logRules("IP", rules.ipRules), logRules("Known-blocked (informational only, not sent to proxy ACL)", knownBlockedRules), console.log("::endgroup::");
	let writablePaths = parseWritablePaths(env.INPUT_WRITABLE), containerName = generateContainerName(), projectName = deriveProjectName(containerName), stateFile = env.GITHUB_STATE;
	stateFile && ((0, node_fs.appendFileSync)(stateFile, `container_name=${containerName}\n`), (0, node_fs.appendFileSync)(stateFile, `project_name=${projectName}\n`));
	let composeEnv = {
		...env,
		PROXY_CONTAINER_NAME: containerName,
		PROXY_MODE: env.INPUT_PROXY_MODE || "restrict",
		ALLOWED_HTTPS_RULES: rules.httpsRules.join("\n"),
		ALLOWED_HTTP_RULES: rules.httpRules.join("\n"),
		ALLOWED_IP_RULES: rules.ipRules.join("\n"),
		BUILDCAGE_PROXY_IMAGE_REF: imageRef
	};
	try {
		(0, node_child_process.execFileSync)("docker", buildComposeUpArgs({
			composeFile,
			projectName,
			pullPolicy
		}), {
			stdio: "inherit",
			env: composeEnv
		});
	} catch (e) {
		throw new SandboxError(describeDockerFailure(e, { operation: "docker compose up" }), "DOCKER_UNAVAILABLE");
	}
	let exitCode = 1;
	try {
		let proxyPid = getContainerPid(containerName);
		if (proxyPid === null) throw new SandboxError(`Sandbox proxy container ${containerName} is not running.`, "PROXY_NOT_RUNNING");
		let dns = "172.20.0.1";
		exitCode = withScratchDir((dir) => {
			let runcPath, seccompProfile, baseSpec;
			try {
				({runcPath, seccompProfile, baseSpec} = extractRuncBootstrap({
					containerName,
					destDir: dir
				}));
			} catch (e) {
				throw new SandboxError(`Failed to extract runc/gen-seccomp-profile from the proxy image: ${errorMessage(e)}`, "RUNC_EXTRACT_FAILED");
			}
			let workdir = env.GITHUB_WORKSPACE || "", home = env.HOME || "", netnsName = containerName.replace(/^buildcage-proxy-/, "buildcage-sandbox-"), rootfsBindDir = (0, node_path.join)(dir, "rootfs"), config;
			try {
				let resolvConfPath = writeResolvConf(dns, dir), scriptPath = writeRunScript(runInput, dir), hostMounts = listHostMounts();
				config = buildOciConfig(baseSpec, {
					uid: process.getuid(),
					gid: process.getgid(),
					workdir,
					home,
					runnerTemp: env.RUNNER_TEMP || "",
					writablePaths,
					env,
					netnsPath: `/var/run/netns/${netnsName}`,
					rootfsBindDir,
					resolvConfPath,
					seccompProfile,
					scriptPath,
					hostMounts
				});
			} catch (e) {
				throw new SandboxError(`Failed to build the sandbox's OCI bundle: ${errorMessage(e)}`, "OCI_CONFIG_BUILD_FAILED");
			}
			return writeOciConfig(config, dir), runIsolated({
				runcPath,
				proxyPid,
				bundleDir: dir,
				containerId: containerName,
				netnsName,
				rootfsBindDir,
				gateway: "172.20.0.1",
				dns,
				targetIp: "172.20.0.101"
			});
		}, containerName);
	} finally {
		try {
			writeReport(fetchReport(containerName), {
				actionRepo,
				actionRef,
				runCommand: runInput,
				stepLabel: env.INPUT_LABEL || void 0,
				failOnBlocked: (env.INPUT_FAIL_ON_BLOCKED || "true").toLowerCase() === "true",
				knownBlockedRules
			});
		} catch (e) {
			annotation.warning(`Failed to fetch sandbox report: ${errorMessage(e)}`);
		}
		try {
			(0, node_child_process.execFileSync)("docker", buildComposeDownArgs({
				composeFile,
				projectName
			}), {
				stdio: "inherit",
				env: composeEnv
			});
		} catch (e) {
			annotation.warning(`Failed to stop the sandbox proxy container: ${describeDockerFailure(e, { operation: "docker compose down" })}`);
		}
	}
	exitCode !== 0 && (process.exitCode = exitCode);
}
process.argv[1] === (0, node_url.fileURLToPath)(require("url").pathToFileURL(__filename).href) && main().catch((err) => {
	err instanceof ActionError ? console.log(`::error::${err.message}`) : console.log(`::error::Unexpected error in sandbox: ${errorMessage(err)}`), process.exit(1);
}), exports.buildACLRules = buildACLRules, exports.buildComposeDownArgs = buildComposeDownArgs, exports.buildComposeUpArgs = buildComposeUpArgs, exports.parseWritablePaths = parseWritablePaths, exports.readKnownBlockedRules = readKnownBlockedRules;
