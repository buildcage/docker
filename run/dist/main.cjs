"use strict";

var node_child_process = require("node:child_process"), node_fs = require("node:fs"), path = require("node:path"), node_url = require("node:url"), os = require("node:os"), require$$0 = require("os"), require$$1 = require("path"), require$$0$5 = require("fs"), require$$0$2 = require("util"), require$$0$1 = require("crypto"), require$$0$3 = require("tty"), require$$0$4 = require("fs/promises"), require$$0$6 = require("url"), node_crypto = require("node:crypto"), _documentCurrentScript = "undefined" != typeof document ? document.currentScript : null;

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

function resolveBuildcageImageRef({imageDigest: imageDigest, actionRepository: actionRepository}) {
  return `${`ghcr.io/${actionRepository}`.toLowerCase()}@${imageDigest}`;
}

class VerifyImageError extends Error {
  constructor(message, code) {
    super(message), this.name = "VerifyImageError", this.code = code;
  }
}

const BUNDLE_MEDIA_TYPE = "application/vnd.dev.sigstore.bundle.v0.3+json";

async function fetchBundleFromManifestDigest(api, manifestDigest, headers, _fetch = fetch) {
  try {
    const resp = await _fetch(`${api}/manifests/${manifestDigest}`, {
      headers: {
        ...headers,
        Accept: "application/vnd.oci.image.manifest.v1+json"
      }
    });
    if (resp.status >= 500) throw new VerifyImageError(`Transient error fetching bundle manifest: HTTP ${resp.status}`, "TRANSIENT");
    if (401 === resp.status || 403 === resp.status) throw new VerifyImageError(`Registry denied access to bundle manifest: HTTP ${resp.status}`, "TRANSIENT");
    if (!resp.ok) throw new VerifyImageError(`Failed to fetch bundle manifest: HTTP ${resp.status}`, "TRANSIENT");
    const layer = ((await resp.json()).layers ?? []).find(l => l.mediaType === BUNDLE_MEDIA_TYPE);
    if (!layer) throw new VerifyImageError("No Sigstore bundle layer found in bundle manifest", "NOT_FOUND");
    return fetchBundleBlob(api, layer.digest, headers, _fetch);
  } catch (err) {
    if (err instanceof VerifyImageError) throw err;
    throw new VerifyImageError(`Transient error fetching bundle manifest: ${err.message}`, "TRANSIENT");
  }
}

async function fetchBundleBlob(api, blobDigest, headers, _fetch = fetch) {
  try {
    const resp = await _fetch(`${api}/blobs/${blobDigest}`, {
      headers: headers
    });
    if (resp.status >= 500) throw new VerifyImageError(`Transient error fetching bundle blob: HTTP ${resp.status}`, "TRANSIENT");
    if (401 === resp.status || 403 === resp.status) throw new VerifyImageError(`Registry denied access fetching bundle blob: HTTP ${resp.status}. For private repositories, ensure the runner is authenticated to the registry.`, "TRANSIENT");
    if (!resp.ok) throw new VerifyImageError(`Failed to fetch bundle blob: HTTP ${resp.status}`, "NOT_FOUND");
    return resp.json();
  } catch (err) {
    if (err instanceof VerifyImageError) throw err;
    throw new VerifyImageError(`Transient error fetching bundle blob: ${err.message}`, "TRANSIENT");
  }
}

var hasRequiredEnvelope, dist$6 = {}, build = {}, dist$5 = {}, envelope = {};

function requireEnvelope() {
  return hasRequiredEnvelope || (hasRequiredEnvelope = 1, function(exports) {
    function bytesFromBase64(b64) {
      return Uint8Array.from(globalThis.Buffer.from(b64, "base64"));
    }
    function base64FromBytes(arr) {
      return globalThis.Buffer.from(arr).toString("base64");
    }
    function isSet(value) {
      return null != value;
    }
    Object.defineProperty(exports, "__esModule", {
      value: !0
    }), exports.Signature = exports.Envelope = void 0, exports.Envelope = {
      fromJSON: object => ({
        payload: isSet(object.payload) ? Buffer.from(bytesFromBase64(object.payload)) : Buffer.alloc(0),
        payloadType: isSet(object.payloadType) ? globalThis.String(object.payloadType) : "",
        signatures: globalThis.Array.isArray(object?.signatures) ? object.signatures.map(e => exports.Signature.fromJSON(e)) : []
      }),
      toJSON(message) {
        const obj = {};
        return 0 !== message.payload.length && (obj.payload = base64FromBytes(message.payload)), 
        "" !== message.payloadType && (obj.payloadType = message.payloadType), message.signatures?.length && (obj.signatures = message.signatures.map(e => exports.Signature.toJSON(e))), 
        obj;
      }
    }, exports.Signature = {
      fromJSON: object => ({
        sig: isSet(object.sig) ? Buffer.from(bytesFromBase64(object.sig)) : Buffer.alloc(0),
        keyid: isSet(object.keyid) ? globalThis.String(object.keyid) : ""
      }),
      toJSON(message) {
        const obj = {};
        return 0 !== message.sig.length && (obj.sig = base64FromBytes(message.sig)), "" !== message.keyid && (obj.keyid = message.keyid), 
        obj;
      }
    };
  }(envelope)), envelope;
}

var hasRequiredTimestamp$3, hasRequiredSigstore_common, sigstore_bundle = {}, sigstore_common = {}, timestamp$3 = {};

function requireSigstore_common() {
  return hasRequiredSigstore_common || (hasRequiredSigstore_common = 1, function(exports) {
    Object.defineProperty(exports, "__esModule", {
      value: !0
    }), exports.TimeRange = exports.X509CertificateChain = exports.SubjectAlternativeName = exports.X509Certificate = exports.DistinguishedName = exports.ObjectIdentifierValuePair = exports.ObjectIdentifier = exports.PublicKeyIdentifier = exports.PublicKey = exports.RFC3161SignedTimestamp = exports.LogId = exports.MessageSignature = exports.HashOutput = exports.SubjectAlternativeNameType = exports.PublicKeyDetails = exports.HashAlgorithm = void 0, 
    exports.hashAlgorithmFromJSON = hashAlgorithmFromJSON, exports.hashAlgorithmToJSON = hashAlgorithmToJSON, 
    exports.publicKeyDetailsFromJSON = publicKeyDetailsFromJSON, exports.publicKeyDetailsToJSON = publicKeyDetailsToJSON, 
    exports.subjectAlternativeNameTypeFromJSON = subjectAlternativeNameTypeFromJSON, 
    exports.subjectAlternativeNameTypeToJSON = subjectAlternativeNameTypeToJSON;
    const timestamp_1 = function() {
      if (hasRequiredTimestamp$3) return timestamp$3;
      function isSet(value) {
        return null != value;
      }
      return hasRequiredTimestamp$3 = 1, Object.defineProperty(timestamp$3, "__esModule", {
        value: !0
      }), timestamp$3.Timestamp = void 0, timestamp$3.Timestamp = {
        fromJSON: object => ({
          seconds: isSet(object.seconds) ? globalThis.String(object.seconds) : "0",
          nanos: isSet(object.nanos) ? globalThis.Number(object.nanos) : 0
        }),
        toJSON(message) {
          const obj = {};
          return "0" !== message.seconds && (obj.seconds = message.seconds), 0 !== message.nanos && (obj.nanos = Math.round(message.nanos)), 
          obj;
        }
      }, timestamp$3;
    }();
    var HashAlgorithm, PublicKeyDetails, SubjectAlternativeNameType;
    function hashAlgorithmFromJSON(object) {
      switch (object) {
       case 0:
       case "HASH_ALGORITHM_UNSPECIFIED":
        return HashAlgorithm.HASH_ALGORITHM_UNSPECIFIED;

       case 1:
       case "SHA2_256":
        return HashAlgorithm.SHA2_256;

       case 2:
       case "SHA2_384":
        return HashAlgorithm.SHA2_384;

       case 3:
       case "SHA2_512":
        return HashAlgorithm.SHA2_512;

       case 4:
       case "SHA3_256":
        return HashAlgorithm.SHA3_256;

       case 5:
       case "SHA3_384":
        return HashAlgorithm.SHA3_384;

       default:
        throw new globalThis.Error("Unrecognized enum value " + object + " for enum HashAlgorithm");
      }
    }
    function hashAlgorithmToJSON(object) {
      switch (object) {
       case HashAlgorithm.HASH_ALGORITHM_UNSPECIFIED:
        return "HASH_ALGORITHM_UNSPECIFIED";

       case HashAlgorithm.SHA2_256:
        return "SHA2_256";

       case HashAlgorithm.SHA2_384:
        return "SHA2_384";

       case HashAlgorithm.SHA2_512:
        return "SHA2_512";

       case HashAlgorithm.SHA3_256:
        return "SHA3_256";

       case HashAlgorithm.SHA3_384:
        return "SHA3_384";

       default:
        throw new globalThis.Error("Unrecognized enum value " + object + " for enum HashAlgorithm");
      }
    }
    function publicKeyDetailsFromJSON(object) {
      switch (object) {
       case 0:
       case "PUBLIC_KEY_DETAILS_UNSPECIFIED":
        return PublicKeyDetails.PUBLIC_KEY_DETAILS_UNSPECIFIED;

       case 1:
       case "PKCS1_RSA_PKCS1V5":
        return PublicKeyDetails.PKCS1_RSA_PKCS1V5;

       case 2:
       case "PKCS1_RSA_PSS":
        return PublicKeyDetails.PKCS1_RSA_PSS;

       case 3:
       case "PKIX_RSA_PKCS1V5":
        return PublicKeyDetails.PKIX_RSA_PKCS1V5;

       case 4:
       case "PKIX_RSA_PSS":
        return PublicKeyDetails.PKIX_RSA_PSS;

       case 9:
       case "PKIX_RSA_PKCS1V15_2048_SHA256":
        return PublicKeyDetails.PKIX_RSA_PKCS1V15_2048_SHA256;

       case 10:
       case "PKIX_RSA_PKCS1V15_3072_SHA256":
        return PublicKeyDetails.PKIX_RSA_PKCS1V15_3072_SHA256;

       case 11:
       case "PKIX_RSA_PKCS1V15_4096_SHA256":
        return PublicKeyDetails.PKIX_RSA_PKCS1V15_4096_SHA256;

       case 16:
       case "PKIX_RSA_PSS_2048_SHA256":
        return PublicKeyDetails.PKIX_RSA_PSS_2048_SHA256;

       case 17:
       case "PKIX_RSA_PSS_3072_SHA256":
        return PublicKeyDetails.PKIX_RSA_PSS_3072_SHA256;

       case 18:
       case "PKIX_RSA_PSS_4096_SHA256":
        return PublicKeyDetails.PKIX_RSA_PSS_4096_SHA256;

       case 6:
       case "PKIX_ECDSA_P256_HMAC_SHA_256":
        return PublicKeyDetails.PKIX_ECDSA_P256_HMAC_SHA_256;

       case 5:
       case "PKIX_ECDSA_P256_SHA_256":
        return PublicKeyDetails.PKIX_ECDSA_P256_SHA_256;

       case 12:
       case "PKIX_ECDSA_P384_SHA_384":
        return PublicKeyDetails.PKIX_ECDSA_P384_SHA_384;

       case 13:
       case "PKIX_ECDSA_P521_SHA_512":
        return PublicKeyDetails.PKIX_ECDSA_P521_SHA_512;

       case 7:
       case "PKIX_ED25519":
        return PublicKeyDetails.PKIX_ED25519;

       case 8:
       case "PKIX_ED25519_PH":
        return PublicKeyDetails.PKIX_ED25519_PH;

       case 19:
       case "PKIX_ECDSA_P384_SHA_256":
        return PublicKeyDetails.PKIX_ECDSA_P384_SHA_256;

       case 20:
       case "PKIX_ECDSA_P521_SHA_256":
        return PublicKeyDetails.PKIX_ECDSA_P521_SHA_256;

       case 14:
       case "LMS_SHA256":
        return PublicKeyDetails.LMS_SHA256;

       case 15:
       case "LMOTS_SHA256":
        return PublicKeyDetails.LMOTS_SHA256;

       case 23:
       case "ML_DSA_44":
        return PublicKeyDetails.ML_DSA_44;

       case 21:
       case "ML_DSA_65":
        return PublicKeyDetails.ML_DSA_65;

       case 22:
       case "ML_DSA_87":
        return PublicKeyDetails.ML_DSA_87;

       default:
        throw new globalThis.Error("Unrecognized enum value " + object + " for enum PublicKeyDetails");
      }
    }
    function publicKeyDetailsToJSON(object) {
      switch (object) {
       case PublicKeyDetails.PUBLIC_KEY_DETAILS_UNSPECIFIED:
        return "PUBLIC_KEY_DETAILS_UNSPECIFIED";

       case PublicKeyDetails.PKCS1_RSA_PKCS1V5:
        return "PKCS1_RSA_PKCS1V5";

       case PublicKeyDetails.PKCS1_RSA_PSS:
        return "PKCS1_RSA_PSS";

       case PublicKeyDetails.PKIX_RSA_PKCS1V5:
        return "PKIX_RSA_PKCS1V5";

       case PublicKeyDetails.PKIX_RSA_PSS:
        return "PKIX_RSA_PSS";

       case PublicKeyDetails.PKIX_RSA_PKCS1V15_2048_SHA256:
        return "PKIX_RSA_PKCS1V15_2048_SHA256";

       case PublicKeyDetails.PKIX_RSA_PKCS1V15_3072_SHA256:
        return "PKIX_RSA_PKCS1V15_3072_SHA256";

       case PublicKeyDetails.PKIX_RSA_PKCS1V15_4096_SHA256:
        return "PKIX_RSA_PKCS1V15_4096_SHA256";

       case PublicKeyDetails.PKIX_RSA_PSS_2048_SHA256:
        return "PKIX_RSA_PSS_2048_SHA256";

       case PublicKeyDetails.PKIX_RSA_PSS_3072_SHA256:
        return "PKIX_RSA_PSS_3072_SHA256";

       case PublicKeyDetails.PKIX_RSA_PSS_4096_SHA256:
        return "PKIX_RSA_PSS_4096_SHA256";

       case PublicKeyDetails.PKIX_ECDSA_P256_HMAC_SHA_256:
        return "PKIX_ECDSA_P256_HMAC_SHA_256";

       case PublicKeyDetails.PKIX_ECDSA_P256_SHA_256:
        return "PKIX_ECDSA_P256_SHA_256";

       case PublicKeyDetails.PKIX_ECDSA_P384_SHA_384:
        return "PKIX_ECDSA_P384_SHA_384";

       case PublicKeyDetails.PKIX_ECDSA_P521_SHA_512:
        return "PKIX_ECDSA_P521_SHA_512";

       case PublicKeyDetails.PKIX_ED25519:
        return "PKIX_ED25519";

       case PublicKeyDetails.PKIX_ED25519_PH:
        return "PKIX_ED25519_PH";

       case PublicKeyDetails.PKIX_ECDSA_P384_SHA_256:
        return "PKIX_ECDSA_P384_SHA_256";

       case PublicKeyDetails.PKIX_ECDSA_P521_SHA_256:
        return "PKIX_ECDSA_P521_SHA_256";

       case PublicKeyDetails.LMS_SHA256:
        return "LMS_SHA256";

       case PublicKeyDetails.LMOTS_SHA256:
        return "LMOTS_SHA256";

       case PublicKeyDetails.ML_DSA_44:
        return "ML_DSA_44";

       case PublicKeyDetails.ML_DSA_65:
        return "ML_DSA_65";

       case PublicKeyDetails.ML_DSA_87:
        return "ML_DSA_87";

       default:
        throw new globalThis.Error("Unrecognized enum value " + object + " for enum PublicKeyDetails");
      }
    }
    function subjectAlternativeNameTypeFromJSON(object) {
      switch (object) {
       case 0:
       case "SUBJECT_ALTERNATIVE_NAME_TYPE_UNSPECIFIED":
        return SubjectAlternativeNameType.SUBJECT_ALTERNATIVE_NAME_TYPE_UNSPECIFIED;

       case 1:
       case "EMAIL":
        return SubjectAlternativeNameType.EMAIL;

       case 2:
       case "URI":
        return SubjectAlternativeNameType.URI;

       case 3:
       case "OTHER_NAME":
        return SubjectAlternativeNameType.OTHER_NAME;

       default:
        throw new globalThis.Error("Unrecognized enum value " + object + " for enum SubjectAlternativeNameType");
      }
    }
    function subjectAlternativeNameTypeToJSON(object) {
      switch (object) {
       case SubjectAlternativeNameType.SUBJECT_ALTERNATIVE_NAME_TYPE_UNSPECIFIED:
        return "SUBJECT_ALTERNATIVE_NAME_TYPE_UNSPECIFIED";

       case SubjectAlternativeNameType.EMAIL:
        return "EMAIL";

       case SubjectAlternativeNameType.URI:
        return "URI";

       case SubjectAlternativeNameType.OTHER_NAME:
        return "OTHER_NAME";

       default:
        throw new globalThis.Error("Unrecognized enum value " + object + " for enum SubjectAlternativeNameType");
      }
    }
    function bytesFromBase64(b64) {
      return Uint8Array.from(globalThis.Buffer.from(b64, "base64"));
    }
    function base64FromBytes(arr) {
      return globalThis.Buffer.from(arr).toString("base64");
    }
    function fromJsonTimestamp(o) {
      return o instanceof globalThis.Date ? o : "string" == typeof o ? new globalThis.Date(o) : function(t) {
        let millis = 1e3 * (globalThis.Number(t.seconds) || 0);
        return millis += (t.nanos || 0) / 1e6, new globalThis.Date(millis);
      }(timestamp_1.Timestamp.fromJSON(o));
    }
    function isSet(value) {
      return null != value;
    }
    !function(HashAlgorithm) {
      HashAlgorithm[HashAlgorithm.HASH_ALGORITHM_UNSPECIFIED = 0] = "HASH_ALGORITHM_UNSPECIFIED", 
      HashAlgorithm[HashAlgorithm.SHA2_256 = 1] = "SHA2_256", HashAlgorithm[HashAlgorithm.SHA2_384 = 2] = "SHA2_384", 
      HashAlgorithm[HashAlgorithm.SHA2_512 = 3] = "SHA2_512", HashAlgorithm[HashAlgorithm.SHA3_256 = 4] = "SHA3_256", 
      HashAlgorithm[HashAlgorithm.SHA3_384 = 5] = "SHA3_384";
    }(HashAlgorithm || (exports.HashAlgorithm = HashAlgorithm = {})), function(PublicKeyDetails) {
      PublicKeyDetails[PublicKeyDetails.PUBLIC_KEY_DETAILS_UNSPECIFIED = 0] = "PUBLIC_KEY_DETAILS_UNSPECIFIED", 
      PublicKeyDetails[PublicKeyDetails.PKCS1_RSA_PKCS1V5 = 1] = "PKCS1_RSA_PKCS1V5", 
      PublicKeyDetails[PublicKeyDetails.PKCS1_RSA_PSS = 2] = "PKCS1_RSA_PSS", PublicKeyDetails[PublicKeyDetails.PKIX_RSA_PKCS1V5 = 3] = "PKIX_RSA_PKCS1V5", 
      PublicKeyDetails[PublicKeyDetails.PKIX_RSA_PSS = 4] = "PKIX_RSA_PSS", PublicKeyDetails[PublicKeyDetails.PKIX_RSA_PKCS1V15_2048_SHA256 = 9] = "PKIX_RSA_PKCS1V15_2048_SHA256", 
      PublicKeyDetails[PublicKeyDetails.PKIX_RSA_PKCS1V15_3072_SHA256 = 10] = "PKIX_RSA_PKCS1V15_3072_SHA256", 
      PublicKeyDetails[PublicKeyDetails.PKIX_RSA_PKCS1V15_4096_SHA256 = 11] = "PKIX_RSA_PKCS1V15_4096_SHA256", 
      PublicKeyDetails[PublicKeyDetails.PKIX_RSA_PSS_2048_SHA256 = 16] = "PKIX_RSA_PSS_2048_SHA256", 
      PublicKeyDetails[PublicKeyDetails.PKIX_RSA_PSS_3072_SHA256 = 17] = "PKIX_RSA_PSS_3072_SHA256", 
      PublicKeyDetails[PublicKeyDetails.PKIX_RSA_PSS_4096_SHA256 = 18] = "PKIX_RSA_PSS_4096_SHA256", 
      PublicKeyDetails[PublicKeyDetails.PKIX_ECDSA_P256_HMAC_SHA_256 = 6] = "PKIX_ECDSA_P256_HMAC_SHA_256", 
      PublicKeyDetails[PublicKeyDetails.PKIX_ECDSA_P256_SHA_256 = 5] = "PKIX_ECDSA_P256_SHA_256", 
      PublicKeyDetails[PublicKeyDetails.PKIX_ECDSA_P384_SHA_384 = 12] = "PKIX_ECDSA_P384_SHA_384", 
      PublicKeyDetails[PublicKeyDetails.PKIX_ECDSA_P521_SHA_512 = 13] = "PKIX_ECDSA_P521_SHA_512", 
      PublicKeyDetails[PublicKeyDetails.PKIX_ED25519 = 7] = "PKIX_ED25519", PublicKeyDetails[PublicKeyDetails.PKIX_ED25519_PH = 8] = "PKIX_ED25519_PH", 
      PublicKeyDetails[PublicKeyDetails.PKIX_ECDSA_P384_SHA_256 = 19] = "PKIX_ECDSA_P384_SHA_256", 
      PublicKeyDetails[PublicKeyDetails.PKIX_ECDSA_P521_SHA_256 = 20] = "PKIX_ECDSA_P521_SHA_256", 
      PublicKeyDetails[PublicKeyDetails.LMS_SHA256 = 14] = "LMS_SHA256", PublicKeyDetails[PublicKeyDetails.LMOTS_SHA256 = 15] = "LMOTS_SHA256", 
      PublicKeyDetails[PublicKeyDetails.ML_DSA_44 = 23] = "ML_DSA_44", PublicKeyDetails[PublicKeyDetails.ML_DSA_65 = 21] = "ML_DSA_65", 
      PublicKeyDetails[PublicKeyDetails.ML_DSA_87 = 22] = "ML_DSA_87";
    }(PublicKeyDetails || (exports.PublicKeyDetails = PublicKeyDetails = {})), function(SubjectAlternativeNameType) {
      SubjectAlternativeNameType[SubjectAlternativeNameType.SUBJECT_ALTERNATIVE_NAME_TYPE_UNSPECIFIED = 0] = "SUBJECT_ALTERNATIVE_NAME_TYPE_UNSPECIFIED", 
      SubjectAlternativeNameType[SubjectAlternativeNameType.EMAIL = 1] = "EMAIL", SubjectAlternativeNameType[SubjectAlternativeNameType.URI = 2] = "URI", 
      SubjectAlternativeNameType[SubjectAlternativeNameType.OTHER_NAME = 3] = "OTHER_NAME";
    }(SubjectAlternativeNameType || (exports.SubjectAlternativeNameType = SubjectAlternativeNameType = {})), 
    exports.HashOutput = {
      fromJSON: object => ({
        algorithm: isSet(object.algorithm) ? hashAlgorithmFromJSON(object.algorithm) : 0,
        digest: isSet(object.digest) ? Buffer.from(bytesFromBase64(object.digest)) : Buffer.alloc(0)
      }),
      toJSON(message) {
        const obj = {};
        return 0 !== message.algorithm && (obj.algorithm = hashAlgorithmToJSON(message.algorithm)), 
        0 !== message.digest.length && (obj.digest = base64FromBytes(message.digest)), obj;
      }
    }, exports.MessageSignature = {
      fromJSON: object => ({
        messageDigest: isSet(object.messageDigest) ? exports.HashOutput.fromJSON(object.messageDigest) : void 0,
        signature: isSet(object.signature) ? Buffer.from(bytesFromBase64(object.signature)) : Buffer.alloc(0)
      }),
      toJSON(message) {
        const obj = {};
        return void 0 !== message.messageDigest && (obj.messageDigest = exports.HashOutput.toJSON(message.messageDigest)), 
        0 !== message.signature.length && (obj.signature = base64FromBytes(message.signature)), 
        obj;
      }
    }, exports.LogId = {
      fromJSON: object => ({
        keyId: isSet(object.keyId) ? Buffer.from(bytesFromBase64(object.keyId)) : Buffer.alloc(0)
      }),
      toJSON(message) {
        const obj = {};
        return 0 !== message.keyId.length && (obj.keyId = base64FromBytes(message.keyId)), 
        obj;
      }
    }, exports.RFC3161SignedTimestamp = {
      fromJSON: object => ({
        signedTimestamp: isSet(object.signedTimestamp) ? Buffer.from(bytesFromBase64(object.signedTimestamp)) : Buffer.alloc(0)
      }),
      toJSON(message) {
        const obj = {};
        return 0 !== message.signedTimestamp.length && (obj.signedTimestamp = base64FromBytes(message.signedTimestamp)), 
        obj;
      }
    }, exports.PublicKey = {
      fromJSON: object => ({
        rawBytes: isSet(object.rawBytes) ? Buffer.from(bytesFromBase64(object.rawBytes)) : void 0,
        keyDetails: isSet(object.keyDetails) ? publicKeyDetailsFromJSON(object.keyDetails) : 0,
        validFor: isSet(object.validFor) ? exports.TimeRange.fromJSON(object.validFor) : void 0
      }),
      toJSON(message) {
        const obj = {};
        return void 0 !== message.rawBytes && (obj.rawBytes = base64FromBytes(message.rawBytes)), 
        0 !== message.keyDetails && (obj.keyDetails = publicKeyDetailsToJSON(message.keyDetails)), 
        void 0 !== message.validFor && (obj.validFor = exports.TimeRange.toJSON(message.validFor)), 
        obj;
      }
    }, exports.PublicKeyIdentifier = {
      fromJSON: object => ({
        hint: isSet(object.hint) ? globalThis.String(object.hint) : ""
      }),
      toJSON(message) {
        const obj = {};
        return "" !== message.hint && (obj.hint = message.hint), obj;
      }
    }, exports.ObjectIdentifier = {
      fromJSON: object => ({
        id: globalThis.Array.isArray(object?.id) ? object.id.map(e => globalThis.Number(e)) : []
      }),
      toJSON(message) {
        const obj = {};
        return message.id?.length && (obj.id = message.id.map(e => Math.round(e))), obj;
      }
    }, exports.ObjectIdentifierValuePair = {
      fromJSON: object => ({
        oid: isSet(object.oid) ? exports.ObjectIdentifier.fromJSON(object.oid) : void 0,
        value: isSet(object.value) ? Buffer.from(bytesFromBase64(object.value)) : Buffer.alloc(0)
      }),
      toJSON(message) {
        const obj = {};
        return void 0 !== message.oid && (obj.oid = exports.ObjectIdentifier.toJSON(message.oid)), 
        0 !== message.value.length && (obj.value = base64FromBytes(message.value)), obj;
      }
    }, exports.DistinguishedName = {
      fromJSON: object => ({
        organization: isSet(object.organization) ? globalThis.String(object.organization) : "",
        commonName: isSet(object.commonName) ? globalThis.String(object.commonName) : ""
      }),
      toJSON(message) {
        const obj = {};
        return "" !== message.organization && (obj.organization = message.organization), 
        "" !== message.commonName && (obj.commonName = message.commonName), obj;
      }
    }, exports.X509Certificate = {
      fromJSON: object => ({
        rawBytes: isSet(object.rawBytes) ? Buffer.from(bytesFromBase64(object.rawBytes)) : Buffer.alloc(0)
      }),
      toJSON(message) {
        const obj = {};
        return 0 !== message.rawBytes.length && (obj.rawBytes = base64FromBytes(message.rawBytes)), 
        obj;
      }
    }, exports.SubjectAlternativeName = {
      fromJSON: object => ({
        type: isSet(object.type) ? subjectAlternativeNameTypeFromJSON(object.type) : 0,
        identity: isSet(object.regexp) ? {
          $case: "regexp",
          regexp: globalThis.String(object.regexp)
        } : isSet(object.value) ? {
          $case: "value",
          value: globalThis.String(object.value)
        } : void 0
      }),
      toJSON(message) {
        const obj = {};
        return 0 !== message.type && (obj.type = subjectAlternativeNameTypeToJSON(message.type)), 
        "regexp" === message.identity?.$case ? obj.regexp = message.identity.regexp : "value" === message.identity?.$case && (obj.value = message.identity.value), 
        obj;
      }
    }, exports.X509CertificateChain = {
      fromJSON: object => ({
        certificates: globalThis.Array.isArray(object?.certificates) ? object.certificates.map(e => exports.X509Certificate.fromJSON(e)) : []
      }),
      toJSON(message) {
        const obj = {};
        return message.certificates?.length && (obj.certificates = message.certificates.map(e => exports.X509Certificate.toJSON(e))), 
        obj;
      }
    }, exports.TimeRange = {
      fromJSON: object => ({
        start: isSet(object.start) ? fromJsonTimestamp(object.start) : void 0,
        end: isSet(object.end) ? fromJsonTimestamp(object.end) : void 0
      }),
      toJSON(message) {
        const obj = {};
        return void 0 !== message.start && (obj.start = message.start.toISOString()), void 0 !== message.end && (obj.end = message.end.toISOString()), 
        obj;
      }
    };
  }(sigstore_common)), sigstore_common;
}

var hasRequiredSigstore_rekor, hasRequiredSigstore_bundle, sigstore_rekor = {};

function requireSigstore_rekor() {
  return hasRequiredSigstore_rekor || (hasRequiredSigstore_rekor = 1, function(exports) {
    Object.defineProperty(exports, "__esModule", {
      value: !0
    }), exports.TransparencyLogEntry = exports.InclusionPromise = exports.InclusionProof = exports.Checkpoint = exports.KindVersion = void 0;
    const sigstore_common_1 = requireSigstore_common();
    function bytesFromBase64(b64) {
      return Uint8Array.from(globalThis.Buffer.from(b64, "base64"));
    }
    function base64FromBytes(arr) {
      return globalThis.Buffer.from(arr).toString("base64");
    }
    function isSet(value) {
      return null != value;
    }
    exports.KindVersion = {
      fromJSON: object => ({
        kind: isSet(object.kind) ? globalThis.String(object.kind) : "",
        version: isSet(object.version) ? globalThis.String(object.version) : ""
      }),
      toJSON(message) {
        const obj = {};
        return "" !== message.kind && (obj.kind = message.kind), "" !== message.version && (obj.version = message.version), 
        obj;
      }
    }, exports.Checkpoint = {
      fromJSON: object => ({
        envelope: isSet(object.envelope) ? globalThis.String(object.envelope) : ""
      }),
      toJSON(message) {
        const obj = {};
        return "" !== message.envelope && (obj.envelope = message.envelope), obj;
      }
    }, exports.InclusionProof = {
      fromJSON: object => ({
        logIndex: isSet(object.logIndex) ? globalThis.String(object.logIndex) : "0",
        rootHash: isSet(object.rootHash) ? Buffer.from(bytesFromBase64(object.rootHash)) : Buffer.alloc(0),
        treeSize: isSet(object.treeSize) ? globalThis.String(object.treeSize) : "0",
        hashes: globalThis.Array.isArray(object?.hashes) ? object.hashes.map(e => Buffer.from(bytesFromBase64(e))) : [],
        checkpoint: isSet(object.checkpoint) ? exports.Checkpoint.fromJSON(object.checkpoint) : void 0
      }),
      toJSON(message) {
        const obj = {};
        return "0" !== message.logIndex && (obj.logIndex = message.logIndex), 0 !== message.rootHash.length && (obj.rootHash = base64FromBytes(message.rootHash)), 
        "0" !== message.treeSize && (obj.treeSize = message.treeSize), message.hashes?.length && (obj.hashes = message.hashes.map(e => base64FromBytes(e))), 
        void 0 !== message.checkpoint && (obj.checkpoint = exports.Checkpoint.toJSON(message.checkpoint)), 
        obj;
      }
    }, exports.InclusionPromise = {
      fromJSON: object => ({
        signedEntryTimestamp: isSet(object.signedEntryTimestamp) ? Buffer.from(bytesFromBase64(object.signedEntryTimestamp)) : Buffer.alloc(0)
      }),
      toJSON(message) {
        const obj = {};
        return 0 !== message.signedEntryTimestamp.length && (obj.signedEntryTimestamp = base64FromBytes(message.signedEntryTimestamp)), 
        obj;
      }
    }, exports.TransparencyLogEntry = {
      fromJSON: object => ({
        logIndex: isSet(object.logIndex) ? globalThis.String(object.logIndex) : "0",
        logId: isSet(object.logId) ? sigstore_common_1.LogId.fromJSON(object.logId) : void 0,
        kindVersion: isSet(object.kindVersion) ? exports.KindVersion.fromJSON(object.kindVersion) : void 0,
        integratedTime: isSet(object.integratedTime) ? globalThis.String(object.integratedTime) : "0",
        inclusionPromise: isSet(object.inclusionPromise) ? exports.InclusionPromise.fromJSON(object.inclusionPromise) : void 0,
        inclusionProof: isSet(object.inclusionProof) ? exports.InclusionProof.fromJSON(object.inclusionProof) : void 0,
        canonicalizedBody: isSet(object.canonicalizedBody) ? Buffer.from(bytesFromBase64(object.canonicalizedBody)) : Buffer.alloc(0)
      }),
      toJSON(message) {
        const obj = {};
        return "0" !== message.logIndex && (obj.logIndex = message.logIndex), void 0 !== message.logId && (obj.logId = sigstore_common_1.LogId.toJSON(message.logId)), 
        void 0 !== message.kindVersion && (obj.kindVersion = exports.KindVersion.toJSON(message.kindVersion)), 
        "0" !== message.integratedTime && (obj.integratedTime = message.integratedTime), 
        void 0 !== message.inclusionPromise && (obj.inclusionPromise = exports.InclusionPromise.toJSON(message.inclusionPromise)), 
        void 0 !== message.inclusionProof && (obj.inclusionProof = exports.InclusionProof.toJSON(message.inclusionProof)), 
        0 !== message.canonicalizedBody.length && (obj.canonicalizedBody = base64FromBytes(message.canonicalizedBody)), 
        obj;
      }
    };
  }(sigstore_rekor)), sigstore_rekor;
}

function requireSigstore_bundle() {
  return hasRequiredSigstore_bundle || (hasRequiredSigstore_bundle = 1, function(exports) {
    Object.defineProperty(exports, "__esModule", {
      value: !0
    }), exports.Bundle = exports.VerificationMaterial = exports.TimestampVerificationData = void 0;
    const envelope_1 = requireEnvelope(), sigstore_common_1 = requireSigstore_common(), sigstore_rekor_1 = requireSigstore_rekor();
    function isSet(value) {
      return null != value;
    }
    exports.TimestampVerificationData = {
      fromJSON: object => ({
        rfc3161Timestamps: globalThis.Array.isArray(object?.rfc3161Timestamps) ? object.rfc3161Timestamps.map(e => sigstore_common_1.RFC3161SignedTimestamp.fromJSON(e)) : []
      }),
      toJSON(message) {
        const obj = {};
        return message.rfc3161Timestamps?.length && (obj.rfc3161Timestamps = message.rfc3161Timestamps.map(e => sigstore_common_1.RFC3161SignedTimestamp.toJSON(e))), 
        obj;
      }
    }, exports.VerificationMaterial = {
      fromJSON: object => ({
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
        tlogEntries: globalThis.Array.isArray(object?.tlogEntries) ? object.tlogEntries.map(e => sigstore_rekor_1.TransparencyLogEntry.fromJSON(e)) : [],
        timestampVerificationData: isSet(object.timestampVerificationData) ? exports.TimestampVerificationData.fromJSON(object.timestampVerificationData) : void 0
      }),
      toJSON(message) {
        const obj = {};
        return "publicKey" === message.content?.$case ? obj.publicKey = sigstore_common_1.PublicKeyIdentifier.toJSON(message.content.publicKey) : "x509CertificateChain" === message.content?.$case ? obj.x509CertificateChain = sigstore_common_1.X509CertificateChain.toJSON(message.content.x509CertificateChain) : "certificate" === message.content?.$case && (obj.certificate = sigstore_common_1.X509Certificate.toJSON(message.content.certificate)), 
        message.tlogEntries?.length && (obj.tlogEntries = message.tlogEntries.map(e => sigstore_rekor_1.TransparencyLogEntry.toJSON(e))), 
        void 0 !== message.timestampVerificationData && (obj.timestampVerificationData = exports.TimestampVerificationData.toJSON(message.timestampVerificationData)), 
        obj;
      }
    }, exports.Bundle = {
      fromJSON: object => ({
        mediaType: isSet(object.mediaType) ? globalThis.String(object.mediaType) : "",
        verificationMaterial: isSet(object.verificationMaterial) ? exports.VerificationMaterial.fromJSON(object.verificationMaterial) : void 0,
        content: isSet(object.messageSignature) ? {
          $case: "messageSignature",
          messageSignature: sigstore_common_1.MessageSignature.fromJSON(object.messageSignature)
        } : isSet(object.dsseEnvelope) ? {
          $case: "dsseEnvelope",
          dsseEnvelope: envelope_1.Envelope.fromJSON(object.dsseEnvelope)
        } : void 0
      }),
      toJSON(message) {
        const obj = {};
        return "" !== message.mediaType && (obj.mediaType = message.mediaType), void 0 !== message.verificationMaterial && (obj.verificationMaterial = exports.VerificationMaterial.toJSON(message.verificationMaterial)), 
        "messageSignature" === message.content?.$case ? obj.messageSignature = sigstore_common_1.MessageSignature.toJSON(message.content.messageSignature) : "dsseEnvelope" === message.content?.$case && (obj.dsseEnvelope = envelope_1.Envelope.toJSON(message.content.dsseEnvelope)), 
        obj;
      }
    };
  }(sigstore_bundle)), sigstore_bundle;
}

var hasRequiredSigstore_trustroot, sigstore_trustroot = {};

function requireSigstore_trustroot() {
  return hasRequiredSigstore_trustroot || (hasRequiredSigstore_trustroot = 1, function(exports) {
    Object.defineProperty(exports, "__esModule", {
      value: !0
    }), exports.ClientTrustConfig = exports.ServiceConfiguration = exports.Service = exports.SigningConfig = exports.TrustedRoot = exports.CertificateAuthority = exports.TransparencyLogInstance = exports.ServiceSelector = void 0, 
    exports.serviceSelectorFromJSON = serviceSelectorFromJSON, exports.serviceSelectorToJSON = serviceSelectorToJSON;
    const sigstore_common_1 = requireSigstore_common();
    var ServiceSelector;
    function serviceSelectorFromJSON(object) {
      switch (object) {
       case 0:
       case "SERVICE_SELECTOR_UNDEFINED":
        return ServiceSelector.SERVICE_SELECTOR_UNDEFINED;

       case 1:
       case "ALL":
        return ServiceSelector.ALL;

       case 2:
       case "ANY":
        return ServiceSelector.ANY;

       case 3:
       case "EXACT":
        return ServiceSelector.EXACT;

       default:
        throw new globalThis.Error("Unrecognized enum value " + object + " for enum ServiceSelector");
      }
    }
    function serviceSelectorToJSON(object) {
      switch (object) {
       case ServiceSelector.SERVICE_SELECTOR_UNDEFINED:
        return "SERVICE_SELECTOR_UNDEFINED";

       case ServiceSelector.ALL:
        return "ALL";

       case ServiceSelector.ANY:
        return "ANY";

       case ServiceSelector.EXACT:
        return "EXACT";

       default:
        throw new globalThis.Error("Unrecognized enum value " + object + " for enum ServiceSelector");
      }
    }
    function isSet(value) {
      return null != value;
    }
    !function(ServiceSelector) {
      ServiceSelector[ServiceSelector.SERVICE_SELECTOR_UNDEFINED = 0] = "SERVICE_SELECTOR_UNDEFINED", 
      ServiceSelector[ServiceSelector.ALL = 1] = "ALL", ServiceSelector[ServiceSelector.ANY = 2] = "ANY", 
      ServiceSelector[ServiceSelector.EXACT = 3] = "EXACT";
    }(ServiceSelector || (exports.ServiceSelector = ServiceSelector = {})), exports.TransparencyLogInstance = {
      fromJSON: object => ({
        baseUrl: isSet(object.baseUrl) ? globalThis.String(object.baseUrl) : "",
        hashAlgorithm: isSet(object.hashAlgorithm) ? (0, sigstore_common_1.hashAlgorithmFromJSON)(object.hashAlgorithm) : 0,
        publicKey: isSet(object.publicKey) ? sigstore_common_1.PublicKey.fromJSON(object.publicKey) : void 0,
        logId: isSet(object.logId) ? sigstore_common_1.LogId.fromJSON(object.logId) : void 0,
        checkpointKeyId: isSet(object.checkpointKeyId) ? sigstore_common_1.LogId.fromJSON(object.checkpointKeyId) : void 0,
        operator: isSet(object.operator) ? globalThis.String(object.operator) : ""
      }),
      toJSON(message) {
        const obj = {};
        return "" !== message.baseUrl && (obj.baseUrl = message.baseUrl), 0 !== message.hashAlgorithm && (obj.hashAlgorithm = (0, 
        sigstore_common_1.hashAlgorithmToJSON)(message.hashAlgorithm)), void 0 !== message.publicKey && (obj.publicKey = sigstore_common_1.PublicKey.toJSON(message.publicKey)), 
        void 0 !== message.logId && (obj.logId = sigstore_common_1.LogId.toJSON(message.logId)), 
        void 0 !== message.checkpointKeyId && (obj.checkpointKeyId = sigstore_common_1.LogId.toJSON(message.checkpointKeyId)), 
        "" !== message.operator && (obj.operator = message.operator), obj;
      }
    }, exports.CertificateAuthority = {
      fromJSON: object => ({
        subject: isSet(object.subject) ? sigstore_common_1.DistinguishedName.fromJSON(object.subject) : void 0,
        uri: isSet(object.uri) ? globalThis.String(object.uri) : "",
        certChain: isSet(object.certChain) ? sigstore_common_1.X509CertificateChain.fromJSON(object.certChain) : void 0,
        validFor: isSet(object.validFor) ? sigstore_common_1.TimeRange.fromJSON(object.validFor) : void 0,
        operator: isSet(object.operator) ? globalThis.String(object.operator) : ""
      }),
      toJSON(message) {
        const obj = {};
        return void 0 !== message.subject && (obj.subject = sigstore_common_1.DistinguishedName.toJSON(message.subject)), 
        "" !== message.uri && (obj.uri = message.uri), void 0 !== message.certChain && (obj.certChain = sigstore_common_1.X509CertificateChain.toJSON(message.certChain)), 
        void 0 !== message.validFor && (obj.validFor = sigstore_common_1.TimeRange.toJSON(message.validFor)), 
        "" !== message.operator && (obj.operator = message.operator), obj;
      }
    }, exports.TrustedRoot = {
      fromJSON: object => ({
        mediaType: isSet(object.mediaType) ? globalThis.String(object.mediaType) : "",
        tlogs: globalThis.Array.isArray(object?.tlogs) ? object.tlogs.map(e => exports.TransparencyLogInstance.fromJSON(e)) : [],
        certificateAuthorities: globalThis.Array.isArray(object?.certificateAuthorities) ? object.certificateAuthorities.map(e => exports.CertificateAuthority.fromJSON(e)) : [],
        ctlogs: globalThis.Array.isArray(object?.ctlogs) ? object.ctlogs.map(e => exports.TransparencyLogInstance.fromJSON(e)) : [],
        timestampAuthorities: globalThis.Array.isArray(object?.timestampAuthorities) ? object.timestampAuthorities.map(e => exports.CertificateAuthority.fromJSON(e)) : []
      }),
      toJSON(message) {
        const obj = {};
        return "" !== message.mediaType && (obj.mediaType = message.mediaType), message.tlogs?.length && (obj.tlogs = message.tlogs.map(e => exports.TransparencyLogInstance.toJSON(e))), 
        message.certificateAuthorities?.length && (obj.certificateAuthorities = message.certificateAuthorities.map(e => exports.CertificateAuthority.toJSON(e))), 
        message.ctlogs?.length && (obj.ctlogs = message.ctlogs.map(e => exports.TransparencyLogInstance.toJSON(e))), 
        message.timestampAuthorities?.length && (obj.timestampAuthorities = message.timestampAuthorities.map(e => exports.CertificateAuthority.toJSON(e))), 
        obj;
      }
    }, exports.SigningConfig = {
      fromJSON: object => ({
        mediaType: isSet(object.mediaType) ? globalThis.String(object.mediaType) : "",
        caUrls: globalThis.Array.isArray(object?.caUrls) ? object.caUrls.map(e => exports.Service.fromJSON(e)) : [],
        oidcUrls: globalThis.Array.isArray(object?.oidcUrls) ? object.oidcUrls.map(e => exports.Service.fromJSON(e)) : [],
        rekorTlogUrls: globalThis.Array.isArray(object?.rekorTlogUrls) ? object.rekorTlogUrls.map(e => exports.Service.fromJSON(e)) : [],
        rekorTlogConfig: isSet(object.rekorTlogConfig) ? exports.ServiceConfiguration.fromJSON(object.rekorTlogConfig) : void 0,
        tsaUrls: globalThis.Array.isArray(object?.tsaUrls) ? object.tsaUrls.map(e => exports.Service.fromJSON(e)) : [],
        tsaConfig: isSet(object.tsaConfig) ? exports.ServiceConfiguration.fromJSON(object.tsaConfig) : void 0
      }),
      toJSON(message) {
        const obj = {};
        return "" !== message.mediaType && (obj.mediaType = message.mediaType), message.caUrls?.length && (obj.caUrls = message.caUrls.map(e => exports.Service.toJSON(e))), 
        message.oidcUrls?.length && (obj.oidcUrls = message.oidcUrls.map(e => exports.Service.toJSON(e))), 
        message.rekorTlogUrls?.length && (obj.rekorTlogUrls = message.rekorTlogUrls.map(e => exports.Service.toJSON(e))), 
        void 0 !== message.rekorTlogConfig && (obj.rekorTlogConfig = exports.ServiceConfiguration.toJSON(message.rekorTlogConfig)), 
        message.tsaUrls?.length && (obj.tsaUrls = message.tsaUrls.map(e => exports.Service.toJSON(e))), 
        void 0 !== message.tsaConfig && (obj.tsaConfig = exports.ServiceConfiguration.toJSON(message.tsaConfig)), 
        obj;
      }
    }, exports.Service = {
      fromJSON: object => ({
        url: isSet(object.url) ? globalThis.String(object.url) : "",
        majorApiVersion: isSet(object.majorApiVersion) ? globalThis.Number(object.majorApiVersion) : 0,
        validFor: isSet(object.validFor) ? sigstore_common_1.TimeRange.fromJSON(object.validFor) : void 0,
        operator: isSet(object.operator) ? globalThis.String(object.operator) : ""
      }),
      toJSON(message) {
        const obj = {};
        return "" !== message.url && (obj.url = message.url), 0 !== message.majorApiVersion && (obj.majorApiVersion = Math.round(message.majorApiVersion)), 
        void 0 !== message.validFor && (obj.validFor = sigstore_common_1.TimeRange.toJSON(message.validFor)), 
        "" !== message.operator && (obj.operator = message.operator), obj;
      }
    }, exports.ServiceConfiguration = {
      fromJSON: object => ({
        selector: isSet(object.selector) ? serviceSelectorFromJSON(object.selector) : 0,
        count: isSet(object.count) ? globalThis.Number(object.count) : 0
      }),
      toJSON(message) {
        const obj = {};
        return 0 !== message.selector && (obj.selector = serviceSelectorToJSON(message.selector)), 
        0 !== message.count && (obj.count = Math.round(message.count)), obj;
      }
    }, exports.ClientTrustConfig = {
      fromJSON: object => ({
        mediaType: isSet(object.mediaType) ? globalThis.String(object.mediaType) : "",
        trustedRoot: isSet(object.trustedRoot) ? exports.TrustedRoot.fromJSON(object.trustedRoot) : void 0,
        signingConfig: isSet(object.signingConfig) ? exports.SigningConfig.fromJSON(object.signingConfig) : void 0
      }),
      toJSON(message) {
        const obj = {};
        return "" !== message.mediaType && (obj.mediaType = message.mediaType), void 0 !== message.trustedRoot && (obj.trustedRoot = exports.TrustedRoot.toJSON(message.trustedRoot)), 
        void 0 !== message.signingConfig && (obj.signingConfig = exports.SigningConfig.toJSON(message.signingConfig)), 
        obj;
      }
    };
  }(sigstore_trustroot)), sigstore_trustroot;
}

var hasRequiredSigstore_verification, hasRequiredDist$6, sigstore_verification = {};

function requireSigstore_verification() {
  return hasRequiredSigstore_verification || (hasRequiredSigstore_verification = 1, 
  function(exports) {
    Object.defineProperty(exports, "__esModule", {
      value: !0
    }), exports.Input = exports.Artifact = exports.ArtifactVerificationOptions_ObserverTimestampOptions = exports.ArtifactVerificationOptions_TlogIntegratedTimestampOptions = exports.ArtifactVerificationOptions_TimestampAuthorityOptions = exports.ArtifactVerificationOptions_CtlogOptions = exports.ArtifactVerificationOptions_TlogOptions = exports.ArtifactVerificationOptions = exports.PublicKeyIdentities = exports.CertificateIdentities = exports.CertificateIdentity = void 0;
    const sigstore_bundle_1 = requireSigstore_bundle(), sigstore_common_1 = requireSigstore_common(), sigstore_trustroot_1 = requireSigstore_trustroot();
    function isSet(value) {
      return null != value;
    }
    exports.CertificateIdentity = {
      fromJSON: object => ({
        issuer: isSet(object.issuer) ? globalThis.String(object.issuer) : "",
        san: isSet(object.san) ? sigstore_common_1.SubjectAlternativeName.fromJSON(object.san) : void 0,
        oids: globalThis.Array.isArray(object?.oids) ? object.oids.map(e => sigstore_common_1.ObjectIdentifierValuePair.fromJSON(e)) : []
      }),
      toJSON(message) {
        const obj = {};
        return "" !== message.issuer && (obj.issuer = message.issuer), void 0 !== message.san && (obj.san = sigstore_common_1.SubjectAlternativeName.toJSON(message.san)), 
        message.oids?.length && (obj.oids = message.oids.map(e => sigstore_common_1.ObjectIdentifierValuePair.toJSON(e))), 
        obj;
      }
    }, exports.CertificateIdentities = {
      fromJSON: object => ({
        identities: globalThis.Array.isArray(object?.identities) ? object.identities.map(e => exports.CertificateIdentity.fromJSON(e)) : []
      }),
      toJSON(message) {
        const obj = {};
        return message.identities?.length && (obj.identities = message.identities.map(e => exports.CertificateIdentity.toJSON(e))), 
        obj;
      }
    }, exports.PublicKeyIdentities = {
      fromJSON: object => ({
        publicKeys: globalThis.Array.isArray(object?.publicKeys) ? object.publicKeys.map(e => sigstore_common_1.PublicKey.fromJSON(e)) : []
      }),
      toJSON(message) {
        const obj = {};
        return message.publicKeys?.length && (obj.publicKeys = message.publicKeys.map(e => sigstore_common_1.PublicKey.toJSON(e))), 
        obj;
      }
    }, exports.ArtifactVerificationOptions = {
      fromJSON: object => ({
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
      }),
      toJSON(message) {
        const obj = {};
        return "certificateIdentities" === message.signers?.$case ? obj.certificateIdentities = exports.CertificateIdentities.toJSON(message.signers.certificateIdentities) : "publicKeys" === message.signers?.$case && (obj.publicKeys = exports.PublicKeyIdentities.toJSON(message.signers.publicKeys)), 
        void 0 !== message.tlogOptions && (obj.tlogOptions = exports.ArtifactVerificationOptions_TlogOptions.toJSON(message.tlogOptions)), 
        void 0 !== message.ctlogOptions && (obj.ctlogOptions = exports.ArtifactVerificationOptions_CtlogOptions.toJSON(message.ctlogOptions)), 
        void 0 !== message.tsaOptions && (obj.tsaOptions = exports.ArtifactVerificationOptions_TimestampAuthorityOptions.toJSON(message.tsaOptions)), 
        void 0 !== message.integratedTsOptions && (obj.integratedTsOptions = exports.ArtifactVerificationOptions_TlogIntegratedTimestampOptions.toJSON(message.integratedTsOptions)), 
        void 0 !== message.observerOptions && (obj.observerOptions = exports.ArtifactVerificationOptions_ObserverTimestampOptions.toJSON(message.observerOptions)), 
        obj;
      }
    }, exports.ArtifactVerificationOptions_TlogOptions = {
      fromJSON: object => ({
        threshold: isSet(object.threshold) ? globalThis.Number(object.threshold) : 0,
        performOnlineVerification: !!isSet(object.performOnlineVerification) && globalThis.Boolean(object.performOnlineVerification),
        disable: !!isSet(object.disable) && globalThis.Boolean(object.disable)
      }),
      toJSON(message) {
        const obj = {};
        return 0 !== message.threshold && (obj.threshold = Math.round(message.threshold)), 
        !1 !== message.performOnlineVerification && (obj.performOnlineVerification = message.performOnlineVerification), 
        !1 !== message.disable && (obj.disable = message.disable), obj;
      }
    }, exports.ArtifactVerificationOptions_CtlogOptions = {
      fromJSON: object => ({
        threshold: isSet(object.threshold) ? globalThis.Number(object.threshold) : 0,
        disable: !!isSet(object.disable) && globalThis.Boolean(object.disable)
      }),
      toJSON(message) {
        const obj = {};
        return 0 !== message.threshold && (obj.threshold = Math.round(message.threshold)), 
        !1 !== message.disable && (obj.disable = message.disable), obj;
      }
    }, exports.ArtifactVerificationOptions_TimestampAuthorityOptions = {
      fromJSON: object => ({
        threshold: isSet(object.threshold) ? globalThis.Number(object.threshold) : 0,
        disable: !!isSet(object.disable) && globalThis.Boolean(object.disable)
      }),
      toJSON(message) {
        const obj = {};
        return 0 !== message.threshold && (obj.threshold = Math.round(message.threshold)), 
        !1 !== message.disable && (obj.disable = message.disable), obj;
      }
    }, exports.ArtifactVerificationOptions_TlogIntegratedTimestampOptions = {
      fromJSON: object => ({
        threshold: isSet(object.threshold) ? globalThis.Number(object.threshold) : 0,
        disable: !!isSet(object.disable) && globalThis.Boolean(object.disable)
      }),
      toJSON(message) {
        const obj = {};
        return 0 !== message.threshold && (obj.threshold = Math.round(message.threshold)), 
        !1 !== message.disable && (obj.disable = message.disable), obj;
      }
    }, exports.ArtifactVerificationOptions_ObserverTimestampOptions = {
      fromJSON: object => ({
        threshold: isSet(object.threshold) ? globalThis.Number(object.threshold) : 0,
        disable: !!isSet(object.disable) && globalThis.Boolean(object.disable)
      }),
      toJSON(message) {
        const obj = {};
        return 0 !== message.threshold && (obj.threshold = Math.round(message.threshold)), 
        !1 !== message.disable && (obj.disable = message.disable), obj;
      }
    }, exports.Artifact = {
      fromJSON(object) {
        return {
          data: isSet(object.artifactUri) ? {
            $case: "artifactUri",
            artifactUri: globalThis.String(object.artifactUri)
          } : isSet(object.artifact) ? {
            $case: "artifact",
            artifact: Buffer.from((b64 = object.artifact, Uint8Array.from(globalThis.Buffer.from(b64, "base64"))))
          } : isSet(object.artifactDigest) ? {
            $case: "artifactDigest",
            artifactDigest: sigstore_common_1.HashOutput.fromJSON(object.artifactDigest)
          } : void 0
        };
        var b64;
      },
      toJSON(message) {
        const obj = {};
        var arr;
        return "artifactUri" === message.data?.$case ? obj.artifactUri = message.data.artifactUri : "artifact" === message.data?.$case ? obj.artifact = (arr = message.data.artifact, 
        globalThis.Buffer.from(arr).toString("base64")) : "artifactDigest" === message.data?.$case && (obj.artifactDigest = sigstore_common_1.HashOutput.toJSON(message.data.artifactDigest)), 
        obj;
      }
    }, exports.Input = {
      fromJSON: object => ({
        artifactTrustRoot: isSet(object.artifactTrustRoot) ? sigstore_trustroot_1.TrustedRoot.fromJSON(object.artifactTrustRoot) : void 0,
        artifactVerificationOptions: isSet(object.artifactVerificationOptions) ? exports.ArtifactVerificationOptions.fromJSON(object.artifactVerificationOptions) : void 0,
        bundle: isSet(object.bundle) ? sigstore_bundle_1.Bundle.fromJSON(object.bundle) : void 0,
        artifact: isSet(object.artifact) ? exports.Artifact.fromJSON(object.artifact) : void 0
      }),
      toJSON(message) {
        const obj = {};
        return void 0 !== message.artifactTrustRoot && (obj.artifactTrustRoot = sigstore_trustroot_1.TrustedRoot.toJSON(message.artifactTrustRoot)), 
        void 0 !== message.artifactVerificationOptions && (obj.artifactVerificationOptions = exports.ArtifactVerificationOptions.toJSON(message.artifactVerificationOptions)), 
        void 0 !== message.bundle && (obj.bundle = sigstore_bundle_1.Bundle.toJSON(message.bundle)), 
        void 0 !== message.artifact && (obj.artifact = exports.Artifact.toJSON(message.artifact)), 
        obj;
      }
    };
  }(sigstore_verification)), sigstore_verification;
}

function requireDist$6() {
  return hasRequiredDist$6 || (hasRequiredDist$6 = 1, function(exports) {
    var __createBinding = dist$5 && dist$5.__createBinding || (Object.create ? function(o, m, k, k2) {
      void 0 === k2 && (k2 = k);
      var desc = Object.getOwnPropertyDescriptor(m, k);
      desc && !("get" in desc ? !m.__esModule : desc.writable || desc.configurable) || (desc = {
        enumerable: !0,
        get: function() {
          return m[k];
        }
      }), Object.defineProperty(o, k2, desc);
    } : function(o, m, k, k2) {
      void 0 === k2 && (k2 = k), o[k2] = m[k];
    }), __exportStar = dist$5 && dist$5.__exportStar || function(m, exports) {
      for (var p in m) "default" === p || Object.prototype.hasOwnProperty.call(exports, p) || __createBinding(exports, m, p);
    };
    Object.defineProperty(exports, "__esModule", {
      value: !0
    }), __exportStar(requireEnvelope(), exports), __exportStar(requireSigstore_bundle(), exports), 
    __exportStar(requireSigstore_common(), exports), __exportStar(requireSigstore_rekor(), exports), 
    __exportStar(requireSigstore_trustroot(), exports), __exportStar(requireSigstore_verification(), exports);
  }(dist$5)), dist$5;
}

var hasRequiredBundle$1, hasRequiredBuild, bundle$1 = {};

function requireBundle$1() {
  if (hasRequiredBundle$1) return bundle$1;
  return hasRequiredBundle$1 = 1, Object.defineProperty(bundle$1, "__esModule", {
    value: !0
  }), bundle$1.BUNDLE_V03_MEDIA_TYPE = bundle$1.BUNDLE_V03_LEGACY_MEDIA_TYPE = bundle$1.BUNDLE_V02_MEDIA_TYPE = bundle$1.BUNDLE_V01_MEDIA_TYPE = void 0, 
  bundle$1.isBundleWithCertificateChain = function(b) {
    return "x509CertificateChain" === b.verificationMaterial.content.$case;
  }, bundle$1.isBundleWithPublicKey = function(b) {
    return "publicKey" === b.verificationMaterial.content.$case;
  }, bundle$1.isBundleWithMessageSignature = function(b) {
    return "messageSignature" === b.content.$case;
  }, bundle$1.isBundleWithDsseEnvelope = function(b) {
    return "dsseEnvelope" === b.content.$case;
  }, bundle$1.BUNDLE_V01_MEDIA_TYPE = "application/vnd.dev.sigstore.bundle+json;version=0.1", 
  bundle$1.BUNDLE_V02_MEDIA_TYPE = "application/vnd.dev.sigstore.bundle+json;version=0.2", 
  bundle$1.BUNDLE_V03_LEGACY_MEDIA_TYPE = "application/vnd.dev.sigstore.bundle+json;version=0.3", 
  bundle$1.BUNDLE_V03_MEDIA_TYPE = "application/vnd.dev.sigstore.bundle.v0.3+json", 
  bundle$1;
}

var hasRequiredError$6, error$6 = {};

function requireError$6() {
  if (hasRequiredError$6) return error$6;
  hasRequiredError$6 = 1, Object.defineProperty(error$6, "__esModule", {
    value: !0
  }), error$6.ValidationError = void 0;
  class ValidationError extends Error {
    fields;
    constructor(message, fields) {
      super(message), this.fields = fields;
    }
  }
  return error$6.ValidationError = ValidationError, error$6;
}

var hasRequiredValidate, hasRequiredSerialized, hasRequiredDist$5, serialized = {}, validate = {};

function requireValidate() {
  if (hasRequiredValidate) return validate;
  hasRequiredValidate = 1, Object.defineProperty(validate, "__esModule", {
    value: !0
  }), validate.assertBundle = function(b) {
    const invalidValues = validateBundleBase(b);
    if (invalidValues.length > 0) throw new error_1.ValidationError("invalid bundle", invalidValues);
  }, validate.assertBundleV01 = assertBundleV01, validate.isBundleV01 = function(b) {
    try {
      return assertBundleV01(b), !0;
    } catch (e) {
      return !1;
    }
  }, validate.assertBundleV02 = function(b) {
    const invalidValues = [];
    if (invalidValues.push(...validateBundleBase(b)), invalidValues.push(...validateInclusionProof(b)), 
    invalidValues.length > 0) throw new error_1.ValidationError("invalid v0.2 bundle", invalidValues);
  }, validate.assertBundleLatest = function(b) {
    const invalidValues = [];
    if (invalidValues.push(...validateBundleBase(b)), invalidValues.push(...validateInclusionProof(b)), 
    invalidValues.push(...function(b) {
      const invalidValues = [];
      "x509CertificateChain" === b.verificationMaterial?.content?.$case && invalidValues.push("verificationMaterial.content.$case");
      return invalidValues;
    }(b)), invalidValues.length > 0) throw new error_1.ValidationError("invalid bundle", invalidValues);
  };
  const error_1 = requireError$6();
  function assertBundleV01(b) {
    const invalidValues = [];
    if (invalidValues.push(...validateBundleBase(b)), invalidValues.push(...function(b) {
      const invalidValues = [];
      b.verificationMaterial && b.verificationMaterial.tlogEntries?.length > 0 && b.verificationMaterial.tlogEntries.forEach((entry, i) => {
        void 0 === entry.inclusionPromise && invalidValues.push(`verificationMaterial.tlogEntries[${i}].inclusionPromise`);
      });
      return invalidValues;
    }(b)), invalidValues.length > 0) throw new error_1.ValidationError("invalid v0.1 bundle", invalidValues);
  }
  function validateBundleBase(b) {
    const invalidValues = [];
    if (void 0 !== b.mediaType && (b.mediaType.match(/^application\/vnd\.dev\.sigstore\.bundle\+json;version=\d\.\d/) || b.mediaType.match(/^application\/vnd\.dev\.sigstore\.bundle\.v\d\.\d\+json/)) || invalidValues.push("mediaType"), 
    void 0 === b.content) invalidValues.push("content"); else switch (b.content.$case) {
     case "messageSignature":
      void 0 === b.content.messageSignature.messageDigest ? invalidValues.push("content.messageSignature.messageDigest") : 0 === b.content.messageSignature.messageDigest.digest.length && invalidValues.push("content.messageSignature.messageDigest.digest"), 
      0 === b.content.messageSignature.signature.length && invalidValues.push("content.messageSignature.signature");
      break;

     case "dsseEnvelope":
      0 === b.content.dsseEnvelope.payload.length && invalidValues.push("content.dsseEnvelope.payload"), 
      1 !== b.content.dsseEnvelope.signatures.length ? invalidValues.push("content.dsseEnvelope.signatures") : 0 === b.content.dsseEnvelope.signatures[0].sig.length && invalidValues.push("content.dsseEnvelope.signatures[0].sig");
    }
    if (void 0 === b.verificationMaterial) invalidValues.push("verificationMaterial"); else {
      if (void 0 === b.verificationMaterial.content) invalidValues.push("verificationMaterial.content"); else switch (b.verificationMaterial.content.$case) {
       case "x509CertificateChain":
        0 === b.verificationMaterial.content.x509CertificateChain.certificates.length && invalidValues.push("verificationMaterial.content.x509CertificateChain.certificates"), 
        b.verificationMaterial.content.x509CertificateChain.certificates.forEach((cert, i) => {
          0 === cert.rawBytes.length && invalidValues.push(`verificationMaterial.content.x509CertificateChain.certificates[${i}].rawBytes`);
        });
        break;

       case "certificate":
        0 === b.verificationMaterial.content.certificate.rawBytes.length && invalidValues.push("verificationMaterial.content.certificate.rawBytes");
      }
      void 0 === b.verificationMaterial.tlogEntries ? invalidValues.push("verificationMaterial.tlogEntries") : b.verificationMaterial.tlogEntries.length > 0 && b.verificationMaterial.tlogEntries.forEach((entry, i) => {
        void 0 === entry.logId && invalidValues.push(`verificationMaterial.tlogEntries[${i}].logId`), 
        void 0 === entry.kindVersion && invalidValues.push(`verificationMaterial.tlogEntries[${i}].kindVersion`);
      });
    }
    return invalidValues;
  }
  function validateInclusionProof(b) {
    const invalidValues = [];
    return b.verificationMaterial && b.verificationMaterial.tlogEntries?.length > 0 && b.verificationMaterial.tlogEntries.forEach((entry, i) => {
      void 0 === entry.inclusionProof ? invalidValues.push(`verificationMaterial.tlogEntries[${i}].inclusionProof`) : void 0 === entry.inclusionProof.checkpoint && invalidValues.push(`verificationMaterial.tlogEntries[${i}].inclusionProof.checkpoint`);
    }), invalidValues;
  }
  return validate;
}

var hasRequiredAppdata, distExports$2 = (hasRequiredDist$5 || (hasRequiredDist$5 = 1, 
function(exports) {
  Object.defineProperty(exports, "__esModule", {
    value: !0
  }), exports.isBundleV01 = exports.assertBundleV02 = exports.assertBundleV01 = exports.assertBundleLatest = exports.assertBundle = exports.envelopeToJSON = exports.envelopeFromJSON = exports.bundleToJSON = exports.bundleFromJSON = exports.ValidationError = exports.isBundleWithPublicKey = exports.isBundleWithMessageSignature = exports.isBundleWithDsseEnvelope = exports.isBundleWithCertificateChain = exports.BUNDLE_V03_MEDIA_TYPE = exports.BUNDLE_V03_LEGACY_MEDIA_TYPE = exports.BUNDLE_V02_MEDIA_TYPE = exports.BUNDLE_V01_MEDIA_TYPE = exports.toMessageSignatureBundle = exports.toDSSEBundle = void 0;
  var build_1 = function() {
    if (hasRequiredBuild) return build;
    hasRequiredBuild = 1, Object.defineProperty(build, "__esModule", {
      value: !0
    }), build.toMessageSignatureBundle = function(options) {
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
    }, build.toDSSEBundle = function(options) {
      return {
        mediaType: options.certificateChain ? bundle_1.BUNDLE_V02_MEDIA_TYPE : bundle_1.BUNDLE_V03_MEDIA_TYPE,
        content: {
          $case: "dsseEnvelope",
          dsseEnvelope: toEnvelope(options)
        },
        verificationMaterial: toVerificationMaterial(options)
      };
    };
    const protobuf_specs_1 = requireDist$6(), bundle_1 = requireBundle$1();
    function toEnvelope(options) {
      return {
        payloadType: options.artifactType,
        payload: options.artifact,
        signatures: [ toSignature(options) ]
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
        timestampVerificationData: {
          rfc3161Timestamps: []
        }
      };
    }
    function toKeyContent(options) {
      return options.certificate ? options.certificateChain ? {
        $case: "x509CertificateChain",
        x509CertificateChain: {
          certificates: [ {
            rawBytes: options.certificate
          } ]
        }
      } : {
        $case: "certificate",
        certificate: {
          rawBytes: options.certificate
        }
      } : {
        $case: "publicKey",
        publicKey: {
          hint: options.keyHint || ""
        }
      };
    }
    return build;
  }();
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
  var bundle_1 = requireBundle$1();
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
  var error_1 = requireError$6();
  Object.defineProperty(exports, "ValidationError", {
    enumerable: !0,
    get: function() {
      return error_1.ValidationError;
    }
  });
  var serialized_1 = function() {
    if (hasRequiredSerialized) return serialized;
    hasRequiredSerialized = 1, Object.defineProperty(serialized, "__esModule", {
      value: !0
    }), serialized.envelopeToJSON = serialized.envelopeFromJSON = serialized.bundleToJSON = serialized.bundleFromJSON = void 0;
    const protobuf_specs_1 = requireDist$6(), bundle_1 = requireBundle$1(), validate_1 = requireValidate();
    return serialized.bundleFromJSON = obj => {
      const bundle = protobuf_specs_1.Bundle.fromJSON(obj);
      switch (bundle.mediaType) {
       case bundle_1.BUNDLE_V01_MEDIA_TYPE:
        (0, validate_1.assertBundleV01)(bundle);
        break;

       case bundle_1.BUNDLE_V02_MEDIA_TYPE:
        (0, validate_1.assertBundleV02)(bundle);
        break;

       default:
        (0, validate_1.assertBundleLatest)(bundle);
      }
      return bundle;
    }, serialized.bundleToJSON = bundle => protobuf_specs_1.Bundle.toJSON(bundle), serialized.envelopeFromJSON = obj => protobuf_specs_1.Envelope.fromJSON(obj), 
    serialized.envelopeToJSON = envelope => protobuf_specs_1.Envelope.toJSON(envelope), 
    serialized;
  }();
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
  var validate_1 = requireValidate();
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
}(dist$6)), dist$6), dist$4 = {}, appdata = {};

var hasRequiredError$5, client = {}, dist$3 = {}, dist$2 = {}, base = {}, error$5 = {};

function requireError$5() {
  if (hasRequiredError$5) return error$5;
  hasRequiredError$5 = 1, Object.defineProperty(error$5, "__esModule", {
    value: !0
  }), error$5.UnsupportedAlgorithmError = error$5.CryptoError = error$5.LengthOrHashMismatchError = error$5.UnsignedMetadataError = error$5.RepositoryError = error$5.ValueError = void 0;
  class ValueError extends Error {}
  error$5.ValueError = ValueError;
  class RepositoryError extends Error {}
  error$5.RepositoryError = RepositoryError;
  error$5.UnsignedMetadataError = class extends RepositoryError {};
  error$5.LengthOrHashMismatchError = class extends RepositoryError {};
  class CryptoError extends Error {}
  error$5.CryptoError = CryptoError;
  return error$5.UnsupportedAlgorithmError = class extends CryptoError {}, error$5;
}

var hasRequiredGuard, utils = {}, guard = {};

var lib$1, hasRequiredLib$1, hasRequiredVerify, hasRequiredUtils, hasRequiredBase, verify = {};

function requireLib$1() {
  if (hasRequiredLib$1) return lib$1;
  hasRequiredLib$1 = 1;
  function canonicalizeString(string) {
    return '"' + string.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
  }
  return lib$1 = {
    canonicalize: function canonicalize(object) {
      const buffer = [];
      if ("string" == typeof object) buffer.push(canonicalizeString(object)); else if ("boolean" == typeof object) buffer.push(JSON.stringify(object)); else if (Number.isInteger(object)) buffer.push(JSON.stringify(object)); else if (null === object) buffer.push(JSON.stringify(object)); else if (Array.isArray(object)) {
        buffer.push("[");
        let first = !0;
        object.forEach(element => {
          first || buffer.push(","), first = !1, buffer.push(canonicalize(element));
        }), buffer.push("]");
      } else {
        if ("object" != typeof object) throw new TypeError("cannot encode " + object.toString());
        {
          buffer.push("{");
          let first = !0;
          Object.keys(object).sort().forEach(property => {
            first || buffer.push(","), first = !1, buffer.push(canonicalizeString(property)), 
            buffer.push(":"), buffer.push(canonicalize(object[property]));
          }), buffer.push("}");
        }
      }
      return buffer.join("");
    }
  }, lib$1;
}

function requireUtils() {
  if (hasRequiredUtils) return utils;
  hasRequiredUtils = 1;
  var ownKeys, __createBinding = utils && utils.__createBinding || (Object.create ? function(o, m, k, k2) {
    void 0 === k2 && (k2 = k);
    var desc = Object.getOwnPropertyDescriptor(m, k);
    desc && !("get" in desc ? !m.__esModule : desc.writable || desc.configurable) || (desc = {
      enumerable: !0,
      get: function() {
        return m[k];
      }
    }), Object.defineProperty(o, k2, desc);
  } : function(o, m, k, k2) {
    void 0 === k2 && (k2 = k), o[k2] = m[k];
  }), __setModuleDefault = utils && utils.__setModuleDefault || (Object.create ? function(o, v) {
    Object.defineProperty(o, "default", {
      enumerable: !0,
      value: v
    });
  } : function(o, v) {
    o.default = v;
  }), __importStar = utils && utils.__importStar || (ownKeys = function(o) {
    return ownKeys = Object.getOwnPropertyNames || function(o) {
      var ar = [];
      for (var k in o) Object.prototype.hasOwnProperty.call(o, k) && (ar[ar.length] = k);
      return ar;
    }, ownKeys(o);
  }, function(mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (null != mod) for (var k = ownKeys(mod), i = 0; i < k.length; i++) "default" !== k[i] && __createBinding(result, mod, k[i]);
    return __setModuleDefault(result, mod), result;
  });
  return Object.defineProperty(utils, "__esModule", {
    value: !0
  }), utils.crypto = utils.guard = void 0, utils.guard = __importStar(function() {
    if (hasRequiredGuard) return guard;
    function isObject(value) {
      return "object" == typeof value && null !== value;
    }
    return hasRequiredGuard = 1, Object.defineProperty(guard, "__esModule", {
      value: !0
    }), guard.isDefined = function(val) {
      return void 0 !== val;
    }, guard.isObject = isObject, guard.isStringArray = function(value) {
      return Array.isArray(value) && value.every(v => "string" == typeof v);
    }, guard.isObjectArray = function(value) {
      return Array.isArray(value) && value.every(isObject);
    }, guard.isStringRecord = function(value) {
      return "object" == typeof value && null !== value && Object.keys(value).every(k => "string" == typeof k) && Object.values(value).every(v => "string" == typeof v);
    }, guard.isObjectRecord = function(value) {
      return "object" == typeof value && null !== value && Object.keys(value).every(k => "string" == typeof k) && Object.values(value).every(v => "object" == typeof v && null !== v);
    }, guard;
  }()), utils.crypto = __importStar(function() {
    if (hasRequiredVerify) return verify;
    hasRequiredVerify = 1;
    var __importDefault = verify && verify.__importDefault || function(mod) {
      return mod && mod.__esModule ? mod : {
        default: mod
      };
    };
    Object.defineProperty(verify, "__esModule", {
      value: !0
    }), verify.verifySignature = void 0;
    const canonical_json_1 = requireLib$1(), crypto_1 = __importDefault(require$$0$1);
    return verify.verifySignature = (metaDataSignedData, key, signature) => {
      const canonicalData = Buffer.from((0, canonical_json_1.canonicalize)(metaDataSignedData));
      return crypto_1.default.verify(void 0, canonicalData, key, Buffer.from(signature, "hex"));
    }, verify;
  }()), utils;
}

function requireBase() {
  if (hasRequiredBase) return base;
  hasRequiredBase = 1;
  var __importDefault = base && base.__importDefault || function(mod) {
    return mod && mod.__esModule ? mod : {
      default: mod
    };
  };
  Object.defineProperty(base, "__esModule", {
    value: !0
  }), base.Signed = base.MetadataKind = void 0, base.isMetadataKind = function(value) {
    return "string" == typeof value && Object.values(MetadataKind).includes(value);
  };
  const util_1 = __importDefault(require$$0$2), error_1 = requireError$5(), utils_1 = requireUtils(), SPECIFICATION_VERSION = [ "1", "0", "31" ];
  var MetadataKind;
  !function(MetadataKind) {
    MetadataKind.Root = "root", MetadataKind.Timestamp = "timestamp", MetadataKind.Snapshot = "snapshot", 
    MetadataKind.Targets = "targets";
  }(MetadataKind || (base.MetadataKind = MetadataKind = {}));
  class Signed {
    specVersion;
    expires;
    version;
    unrecognizedFields;
    constructor(options) {
      this.specVersion = options.specVersion || SPECIFICATION_VERSION.join(".");
      const specList = this.specVersion.split(".");
      if (2 !== specList.length && 3 !== specList.length || !specList.every(item => !isNaN(Number(item)))) throw new error_1.ValueError("Failed to parse specVersion");
      if (specList[0] != SPECIFICATION_VERSION[0]) throw new error_1.ValueError("Unsupported specVersion");
      this.expires = options.expires, this.version = options.version, this.unrecognizedFields = options.unrecognizedFields || {};
    }
    equals(other) {
      return other instanceof Signed && (this.specVersion === other.specVersion && this.expires === other.expires && this.version === other.version && util_1.default.isDeepStrictEqual(this.unrecognizedFields, other.unrecognizedFields));
    }
    isExpired(referenceTime) {
      return referenceTime || (referenceTime = new Date), referenceTime >= new Date(this.expires);
    }
    static commonFieldsFromJSON(data) {
      const {spec_version: spec_version, expires: expires, version: version, ...rest} = data;
      if (!utils_1.guard.isDefined(spec_version)) throw new error_1.ValueError("spec_version is not defined");
      if ("string" != typeof spec_version) throw new TypeError("spec_version must be a string");
      if (!utils_1.guard.isDefined(expires)) throw new error_1.ValueError("expires is not defined");
      if ("string" != typeof expires) throw new TypeError("expires must be a string");
      if (!utils_1.guard.isDefined(version)) throw new error_1.ValueError("version is not defined");
      if ("number" != typeof version) throw new TypeError("version must be a number");
      return {
        specVersion: spec_version,
        expires: expires,
        version: version,
        unrecognizedFields: rest
      };
    }
  }
  return base.Signed = Signed, base;
}

var hasRequiredFile, file = {};

function requireFile() {
  if (hasRequiredFile) return file;
  hasRequiredFile = 1;
  var __importDefault = file && file.__importDefault || function(mod) {
    return mod && mod.__esModule ? mod : {
      default: mod
    };
  };
  Object.defineProperty(file, "__esModule", {
    value: !0
  }), file.TargetFile = file.MetaFile = void 0;
  const crypto_1 = __importDefault(require$$0$1), util_1 = __importDefault(require$$0$2), error_1 = requireError$5(), utils_1 = requireUtils();
  class MetaFile {
    version;
    length;
    hashes;
    unrecognizedFields;
    constructor(opts) {
      if (opts.version <= 0) throw new error_1.ValueError("Metafile version must be at least 1");
      void 0 !== opts.length && validateLength(opts.length), this.version = opts.version, 
      this.length = opts.length, this.hashes = opts.hashes, this.unrecognizedFields = opts.unrecognizedFields || {};
    }
    equals(other) {
      return other instanceof MetaFile && (this.version === other.version && this.length === other.length && util_1.default.isDeepStrictEqual(this.hashes, other.hashes) && util_1.default.isDeepStrictEqual(this.unrecognizedFields, other.unrecognizedFields));
    }
    verify(data) {
      if (void 0 !== this.length && data.length !== this.length) throw new error_1.LengthOrHashMismatchError(`Expected length ${this.length} but got ${data.length}`);
      this.hashes && Object.entries(this.hashes).forEach(([key, value]) => {
        let hash;
        try {
          hash = crypto_1.default.createHash(key);
        } catch (e) {
          throw new error_1.LengthOrHashMismatchError(`Hash algorithm ${key} not supported`);
        }
        const observedHash = hash.update(data).digest("hex");
        if (observedHash !== value) throw new error_1.LengthOrHashMismatchError(`Expected hash ${value} but got ${observedHash}`);
      });
    }
    toJSON() {
      const json = {
        version: this.version,
        ...this.unrecognizedFields
      };
      return void 0 !== this.length && (json.length = this.length), this.hashes && (json.hashes = this.hashes), 
      json;
    }
    static fromJSON(data) {
      const {version: version, length: length, hashes: hashes, ...rest} = data;
      if ("number" != typeof version) throw new TypeError("version must be a number");
      if (utils_1.guard.isDefined(length) && "number" != typeof length) throw new TypeError("length must be a number");
      if (utils_1.guard.isDefined(hashes) && !utils_1.guard.isStringRecord(hashes)) throw new TypeError("hashes must be string keys and values");
      return new MetaFile({
        version: version,
        length: length,
        hashes: hashes,
        unrecognizedFields: rest
      });
    }
  }
  file.MetaFile = MetaFile;
  class TargetFile {
    length;
    path;
    hashes;
    unrecognizedFields;
    constructor(opts) {
      validateLength(opts.length), this.length = opts.length, this.path = opts.path, this.hashes = opts.hashes, 
      this.unrecognizedFields = opts.unrecognizedFields || {};
    }
    get custom() {
      const custom = this.unrecognizedFields.custom;
      return !custom || Array.isArray(custom) || "object" != typeof custom ? {} : custom;
    }
    equals(other) {
      return other instanceof TargetFile && (this.length === other.length && this.path === other.path && util_1.default.isDeepStrictEqual(this.hashes, other.hashes) && util_1.default.isDeepStrictEqual(this.unrecognizedFields, other.unrecognizedFields));
    }
    async verify(stream) {
      let observedLength = 0;
      const digests = Object.keys(this.hashes).reduce((acc, key) => {
        try {
          acc[key] = crypto_1.default.createHash(key);
        } catch (e) {
          throw new error_1.LengthOrHashMismatchError(`Hash algorithm ${key} not supported`);
        }
        return acc;
      }, {});
      for await (const chunk of stream) observedLength += chunk.length, Object.values(digests).forEach(digest => {
        digest.update(chunk);
      });
      if (observedLength !== this.length) throw new error_1.LengthOrHashMismatchError(`Expected length ${this.length} but got ${observedLength}`);
      Object.entries(digests).forEach(([key, value]) => {
        const expected = this.hashes[key], actual = value.digest("hex");
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
      const {length: length, hashes: hashes, ...rest} = data;
      if ("number" != typeof length) throw new TypeError("length must be a number");
      if (!utils_1.guard.isStringRecord(hashes)) throw new TypeError("hashes must have string keys and values");
      return new TargetFile({
        length: length,
        path: path,
        hashes: hashes,
        unrecognizedFields: rest
      });
    }
  }
  function validateLength(length) {
    if (length < 0) throw new error_1.ValueError("Length must be at least 0");
  }
  return file.TargetFile = TargetFile, file;
}

var hasRequiredOid$1, hasRequiredKey$2, hasRequiredKey$1, key$2 = {}, key$1 = {}, oid$1 = {};

function requireKey$2() {
  if (hasRequiredKey$2) return key$1;
  hasRequiredKey$2 = 1;
  var __importDefault = key$1 && key$1.__importDefault || function(mod) {
    return mod && mod.__esModule ? mod : {
      default: mod
    };
  };
  Object.defineProperty(key$1, "__esModule", {
    value: !0
  }), key$1.getPublicKey = function(keyInfo) {
    switch (keyInfo.keyType) {
     case "rsa":
      return function(keyInfo) {
        if (!keyInfo.keyVal.startsWith(PEM_HEADER)) throw new error_1.CryptoError("Invalid key format");
        const key = crypto_1.default.createPublicKey(keyInfo.keyVal);
        if ("rsassa-pss-sha256" === keyInfo.scheme) return {
          key: key,
          padding: crypto_1.default.constants.RSA_PKCS1_PSS_PADDING
        };
        throw new error_1.UnsupportedAlgorithmError(`Unsupported RSA scheme: ${keyInfo.scheme}`);
      }(keyInfo);

     case "ed25519":
      return function(keyInfo) {
        let key;
        if (keyInfo.keyVal.startsWith(PEM_HEADER)) key = crypto_1.default.createPublicKey(keyInfo.keyVal); else {
          if (!isHex(keyInfo.keyVal)) throw new error_1.CryptoError("Invalid key format");
          key = crypto_1.default.createPublicKey({
            key: ed25519.hexToDER(keyInfo.keyVal),
            format: "der",
            type: "spki"
          });
        }
        return {
          key: key
        };
      }(keyInfo);

     case "ecdsa":
     case "ecdsa-sha2-nistp256":
     case "ecdsa-sha2-nistp384":
      return function(keyInfo) {
        let key;
        if (keyInfo.keyVal.startsWith(PEM_HEADER)) key = crypto_1.default.createPublicKey(keyInfo.keyVal); else {
          if (!isHex(keyInfo.keyVal)) throw new error_1.CryptoError("Invalid key format");
          key = crypto_1.default.createPublicKey({
            key: ecdsa.hexToDER(keyInfo.keyVal),
            format: "der",
            type: "spki"
          });
        }
        return {
          key: key
        };
      }(keyInfo);

     default:
      throw new error_1.UnsupportedAlgorithmError(`Unsupported key type: ${keyInfo.keyType}`);
    }
  };
  const crypto_1 = __importDefault(require$$0$1), error_1 = requireError$5(), oid_1 = function() {
    if (hasRequiredOid$1) return oid$1;
    hasRequiredOid$1 = 1, Object.defineProperty(oid$1, "__esModule", {
      value: !0
    }), oid$1.encodeOIDString = function(oid) {
      const parts = oid.split("."), first = 40 * parseInt(parts[0], 10) + parseInt(parts[1], 10), rest = [];
      parts.slice(2).forEach(part => {
        const bytes = function(value) {
          const bytes = [];
          let mask = 0;
          for (;value > 0; ) bytes.unshift(127 & value | mask), value >>= 7, mask = 128;
          return bytes;
        }(parseInt(part, 10));
        rest.push(...bytes);
      });
      const der = Buffer.from([ first, ...rest ]);
      return Buffer.from([ ANS1_TAG_OID, der.length, ...der ]);
    };
    const ANS1_TAG_OID = 6;
    return oid$1;
  }(), PEM_HEADER = "-----BEGIN PUBLIC KEY-----";
  const ed25519 = {
    hexToDER: hex => {
      const key = Buffer.from(hex, "hex"), oid = (0, oid_1.encodeOIDString)("1.3.101.112"), elements = Buffer.concat([ Buffer.concat([ Buffer.from([ 48 ]), Buffer.from([ oid.length ]), oid ]), Buffer.concat([ Buffer.from([ 3 ]), Buffer.from([ key.length + 1 ]), Buffer.from([ 0 ]), key ]) ]);
      return Buffer.concat([ Buffer.from([ 48 ]), Buffer.from([ elements.length ]), elements ]);
    }
  }, ecdsa = {
    hexToDER: hex => {
      const key = Buffer.from(hex, "hex"), bitString = Buffer.concat([ Buffer.from([ 3 ]), Buffer.from([ key.length + 1 ]), Buffer.from([ 0 ]), key ]), oids = Buffer.concat([ (0, 
      oid_1.encodeOIDString)("1.2.840.10045.2.1"), (0, oid_1.encodeOIDString)("1.2.840.10045.3.1.7") ]), oidSequence = Buffer.concat([ Buffer.from([ 48 ]), Buffer.from([ oids.length ]), oids ]);
      return Buffer.concat([ Buffer.from([ 48 ]), Buffer.from([ oidSequence.length + bitString.length ]), oidSequence, bitString ]);
    }
  }, isHex = key => /^[0-9a-fA-F]+$/.test(key);
  return key$1;
}

function requireKey$1() {
  if (hasRequiredKey$1) return key$2;
  hasRequiredKey$1 = 1;
  var __importDefault = key$2 && key$2.__importDefault || function(mod) {
    return mod && mod.__esModule ? mod : {
      default: mod
    };
  };
  Object.defineProperty(key$2, "__esModule", {
    value: !0
  }), key$2.Key = void 0;
  const util_1 = __importDefault(require$$0$2), error_1 = requireError$5(), utils_1 = requireUtils(), key_1 = requireKey$2();
  class Key {
    keyID;
    keyType;
    scheme;
    keyVal;
    unrecognizedFields;
    constructor(options) {
      const {keyID: keyID, keyType: keyType, scheme: scheme, keyVal: keyVal, unrecognizedFields: unrecognizedFields} = options;
      this.keyID = keyID, this.keyType = keyType, this.scheme = scheme, this.keyVal = keyVal, 
      this.unrecognizedFields = unrecognizedFields || {};
    }
    verifySignature(metadata) {
      const signature = metadata.signatures[this.keyID];
      if (!signature) throw new error_1.UnsignedMetadataError("no signature for key found in metadata");
      if (!this.keyVal.public) throw new error_1.UnsignedMetadataError("no public key found");
      const publicKey = (0, key_1.getPublicKey)({
        keyType: this.keyType,
        scheme: this.scheme,
        keyVal: this.keyVal.public
      }), signedData = metadata.signed.toJSON();
      try {
        if (!utils_1.crypto.verifySignature(signedData, publicKey, signature.sig)) throw new error_1.UnsignedMetadataError(`failed to verify ${this.keyID} signature`);
      } catch (error) {
        if (error instanceof error_1.UnsignedMetadataError) throw error;
        throw new error_1.UnsignedMetadataError(`failed to verify ${this.keyID} signature`);
      }
    }
    equals(other) {
      return other instanceof Key && (this.keyID === other.keyID && this.keyType === other.keyType && this.scheme === other.scheme && util_1.default.isDeepStrictEqual(this.keyVal, other.keyVal) && util_1.default.isDeepStrictEqual(this.unrecognizedFields, other.unrecognizedFields));
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
      const {keytype: keytype, scheme: scheme, keyval: keyval, ...rest} = data;
      if ("string" != typeof keytype) throw new TypeError("keytype must be a string");
      if ("string" != typeof scheme) throw new TypeError("scheme must be a string");
      if (!utils_1.guard.isStringRecord(keyval)) throw new TypeError("keyval must be a string record");
      return new Key({
        keyID: keyID,
        keyType: keytype,
        scheme: scheme,
        keyVal: keyval,
        unrecognizedFields: rest
      });
    }
  }
  return key$2.Key = Key, key$2;
}

var hasRequiredCommonjs$2, hasRequiredCommonjs$1, metadata = {}, root = {}, role = {}, commonjs$2 = {}, commonjs$1 = {}, commonjs = {};

function requireCommonjs$1() {
  return hasRequiredCommonjs$1 || (hasRequiredCommonjs$1 = 1, function(exports) {
    Object.defineProperty(exports, "__esModule", {
      value: !0
    }), exports.EXPANSION_MAX = void 0, exports.expand = function(str, options = {}) {
      if (!str) return [];
      const {max: max = exports.EXPANSION_MAX} = options;
      "{}" === str.slice(0, 2) && (str = "\\{\\}" + str.slice(2));
      return expand_(function(str) {
        return str.replace(slashPattern, escSlash).replace(openPattern, escOpen).replace(closePattern, escClose).replace(commaPattern, escComma).replace(periodPattern, escPeriod);
      }(str), max, !0).map(unescapeBraces);
    };
    const balanced_match_1 = (hasRequiredCommonjs$2 || (hasRequiredCommonjs$2 = 1, function(exports) {
      Object.defineProperty(exports, "__esModule", {
        value: !0
      }), exports.range = exports.balanced = void 0, exports.balanced = (a, b, str) => {
        const ma = a instanceof RegExp ? maybeMatch(a, str) : a, mb = b instanceof RegExp ? maybeMatch(b, str) : b, r = null !== ma && null != mb && (0, 
        exports.range)(ma, mb, str);
        return r && {
          start: r[0],
          end: r[1],
          pre: str.slice(0, r[0]),
          body: str.slice(r[0] + ma.length, r[1]),
          post: str.slice(r[1] + mb.length)
        };
      };
      const maybeMatch = (reg, str) => {
        const m = str.match(reg);
        return m ? m[0] : null;
      };
      exports.range = (a, b, str) => {
        let begs, beg, left, right, result, ai = str.indexOf(a), bi = str.indexOf(b, ai + 1), i = ai;
        if (ai >= 0 && bi > 0) {
          if (a === b) return [ ai, bi ];
          for (begs = [], left = str.length; i >= 0 && !result; ) {
            if (i === ai) begs.push(i), ai = str.indexOf(a, i + 1); else if (1 === begs.length) {
              const r = begs.pop();
              void 0 !== r && (result = [ r, bi ]);
            } else beg = begs.pop(), void 0 !== beg && beg < left && (left = beg, right = bi), 
            bi = str.indexOf(b, i + 1);
            i = ai < bi && ai >= 0 ? ai : bi;
          }
          begs.length && void 0 !== right && (result = [ left, right ]);
        }
        return result;
      };
    }(commonjs)), commonjs), escSlash = "\0SLASH" + Math.random() + "\0", escOpen = "\0OPEN" + Math.random() + "\0", escClose = "\0CLOSE" + Math.random() + "\0", escComma = "\0COMMA" + Math.random() + "\0", escPeriod = "\0PERIOD" + Math.random() + "\0", escSlashPattern = new RegExp(escSlash, "g"), escOpenPattern = new RegExp(escOpen, "g"), escClosePattern = new RegExp(escClose, "g"), escCommaPattern = new RegExp(escComma, "g"), escPeriodPattern = new RegExp(escPeriod, "g"), slashPattern = /\\\\/g, openPattern = /\\{/g, closePattern = /\\}/g, commaPattern = /\\,/g, periodPattern = /\\\./g;
    function numeric(str) {
      return isNaN(str) ? str.charCodeAt(0) : parseInt(str, 10);
    }
    function unescapeBraces(str) {
      return str.replace(escSlashPattern, "\\").replace(escOpenPattern, "{").replace(escClosePattern, "}").replace(escCommaPattern, ",").replace(escPeriodPattern, ".");
    }
    function parseCommaParts(str) {
      if (!str) return [ "" ];
      const parts = [], m = (0, balanced_match_1.balanced)("{", "}", str);
      if (!m) return str.split(",");
      const {pre: pre, body: body, post: post} = m, p = pre.split(",");
      p[p.length - 1] += "{" + body + "}";
      const postParts = parseCommaParts(post);
      return post.length && (p[p.length - 1] += postParts.shift(), p.push.apply(p, postParts)), 
      parts.push.apply(parts, p), parts;
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
      const expansions = [], m = (0, balanced_match_1.balanced)("{", "}", str);
      if (!m) return [ str ];
      const pre = m.pre, post = m.post.length ? expand_(m.post, max, !1) : [ "" ];
      if (/\$$/.test(m.pre)) for (let k = 0; k < post.length && k < max; k++) {
        const expansion = pre + "{" + m.body + "}" + post[k];
        expansions.push(expansion);
      } else {
        const isNumericSequence = /^-?\d+\.\.-?\d+(?:\.\.-?\d+)?$/.test(m.body), isAlphaSequence = /^[a-zA-Z]\.\.[a-zA-Z](?:\.\.-?\d+)?$/.test(m.body), isSequence = isNumericSequence || isAlphaSequence, isOptions = m.body.indexOf(",") >= 0;
        if (!isSequence && !isOptions) return m.post.match(/,(?!,).*\}/) ? expand_(str = m.pre + "{" + m.body + escClose + m.post, max, !0) : [ str ];
        let n, N;
        if (isSequence) n = m.body.split(/\.\./); else if (n = parseCommaParts(m.body), 
        1 === n.length && void 0 !== n[0] && (n = expand_(n[0], max, !1).map(embrace), 1 === n.length)) return post.map(p => m.pre + n[0] + p);
        if (isSequence && void 0 !== n[0] && void 0 !== n[1]) {
          const x = numeric(n[0]), y = numeric(n[1]), width = Math.max(n[0].length, n[1].length);
          let incr = 3 === n.length && void 0 !== n[2] ? Math.max(Math.abs(numeric(n[2])), 1) : 1, test = lte;
          y < x && (incr *= -1, test = gte);
          const pad = n.some(isPadded);
          N = [];
          for (let i = x; test(i, y) && N.length < max; i += incr) {
            let c;
            if (isAlphaSequence) c = String.fromCharCode(i), "\\" === c && (c = ""); else if (c = String(i), 
            pad) {
              const need = width - c.length;
              if (need > 0) {
                const z = new Array(need + 1).join("0");
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
          const expansion = pre + N[j] + post[k];
          (!isTop || isSequence || expansion) && expansions.push(expansion);
        }
      }
      return expansions;
    }
    exports.EXPANSION_MAX = 1e5;
  }(commonjs$1)), commonjs$1;
}

var hasRequiredAssertValidPattern, assertValidPattern = {};

var hasRequiredBraceExpressions, ast = {}, braceExpressions = {};

var hasRequired_unescape, hasRequiredAst, _unescape = {};

function require_unescape() {
  if (hasRequired_unescape) return _unescape;
  hasRequired_unescape = 1, Object.defineProperty(_unescape, "__esModule", {
    value: !0
  }), _unescape.unescape = void 0;
  return _unescape.unescape = (s, {windowsPathsNoEscape: windowsPathsNoEscape = !1, magicalBraces: magicalBraces = !0} = {}) => magicalBraces ? windowsPathsNoEscape ? s.replace(/\[([^/\\])\]/g, "$1") : s.replace(/((?!\\).|^)\[([^/\\])\]/g, "$1$2").replace(/\\([^/])/g, "$1") : windowsPathsNoEscape ? s.replace(/\[([^/\\{}])\]/g, "$1") : s.replace(/((?!\\).|^)\[([^/\\{}])\]/g, "$1$2").replace(/\\([^/{}])/g, "$1"), 
  _unescape;
}

function requireAst() {
  if (hasRequiredAst) return ast;
  var _a;
  hasRequiredAst = 1, Object.defineProperty(ast, "__esModule", {
    value: !0
  }), ast.AST = void 0;
  const brace_expressions_js_1 = function() {
    if (hasRequiredBraceExpressions) return braceExpressions;
    hasRequiredBraceExpressions = 1, Object.defineProperty(braceExpressions, "__esModule", {
      value: !0
    }), braceExpressions.parseClass = void 0;
    const posixClasses = {
      "[:alnum:]": [ "\\p{L}\\p{Nl}\\p{Nd}", !0 ],
      "[:alpha:]": [ "\\p{L}\\p{Nl}", !0 ],
      "[:ascii:]": [ "\\x00-\\x7f", !1 ],
      "[:blank:]": [ "\\p{Zs}\\t", !0 ],
      "[:cntrl:]": [ "\\p{Cc}", !0 ],
      "[:digit:]": [ "\\p{Nd}", !0 ],
      "[:graph:]": [ "\\p{Z}\\p{C}", !0, !0 ],
      "[:lower:]": [ "\\p{Ll}", !0 ],
      "[:print:]": [ "\\p{C}", !0 ],
      "[:punct:]": [ "\\p{P}", !0 ],
      "[:space:]": [ "\\p{Z}\\t\\r\\n\\v\\f", !0 ],
      "[:upper:]": [ "\\p{Lu}", !0 ],
      "[:word:]": [ "\\p{L}\\p{Nl}\\p{Nd}\\p{Pc}", !0 ],
      "[:xdigit:]": [ "A-Fa-f0-9", !1 ]
    }, braceEscape = s => s.replace(/[[\]\\-]/g, "\\$&"), rangesToString = ranges => ranges.join("");
    return braceExpressions.parseClass = (glob, position) => {
      const pos = position;
      if ("[" !== glob.charAt(pos)) throw new Error("not in a brace expression");
      const ranges = [], negs = [];
      let i = pos + 1, sawStart = !1, uflag = !1, escaping = !1, negate = !1, endPos = pos, rangeStart = "";
      WHILE: for (;i < glob.length; ) {
        const c = glob.charAt(i);
        if ("!" !== c && "^" !== c || i !== pos + 1) {
          if ("]" === c && sawStart && !escaping) {
            endPos = i + 1;
            break;
          }
          if (sawStart = !0, "\\" !== c || escaping) {
            if ("[" === c && !escaping) for (const [cls, [unip, u, neg]] of Object.entries(posixClasses)) if (glob.startsWith(cls, i)) {
              if (rangeStart) return [ "$.", !1, glob.length - pos, !0 ];
              i += cls.length, neg ? negs.push(unip) : ranges.push(unip), uflag = uflag || u;
              continue WHILE;
            }
            escaping = !1, rangeStart ? (c > rangeStart ? ranges.push(braceEscape(rangeStart) + "-" + braceEscape(c)) : c === rangeStart && ranges.push(braceEscape(c)), 
            rangeStart = "", i++) : glob.startsWith("-]", i + 1) ? (ranges.push(braceEscape(c + "-")), 
            i += 2) : glob.startsWith("-", i + 1) ? (rangeStart = c, i += 2) : (ranges.push(braceEscape(c)), 
            i++);
          } else escaping = !0, i++;
        } else negate = !0, i++;
      }
      if (endPos < i) return [ "", !1, 0, !1 ];
      if (!ranges.length && !negs.length) return [ "$.", !1, glob.length - pos, !0 ];
      if (0 === negs.length && 1 === ranges.length && /^\\?.$/.test(ranges[0]) && !negate) {
        return [ (s = 2 === ranges[0].length ? ranges[0].slice(-1) : ranges[0], s.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&")), !1, endPos - pos, !1 ];
      }
      var s;
      const sranges = "[" + (negate ? "^" : "") + rangesToString(ranges) + "]", snegs = "[" + (negate ? "" : "^") + rangesToString(negs) + "]";
      return [ ranges.length && negs.length ? "(" + sranges + "|" + snegs + ")" : ranges.length ? sranges : snegs, uflag, endPos - pos, !0 ];
    }, braceExpressions;
  }(), unescape_js_1 = require_unescape(), types = new Set([ "!", "?", "+", "*", "@" ]), isExtglobType = c => types.has(c), isExtglobAST = c => isExtglobType(c.type), adoptionMap = new Map([ [ "!", [ "@" ] ], [ "?", [ "?", "@" ] ], [ "@", [ "@" ] ], [ "*", [ "*", "+", "?", "@" ] ], [ "+", [ "+", "@" ] ] ]), adoptionWithSpaceMap = new Map([ [ "!", [ "?" ] ], [ "@", [ "?" ] ], [ "+", [ "?", "*" ] ] ]), adoptionAnyMap = new Map([ [ "!", [ "?", "@" ] ], [ "?", [ "?", "@" ] ], [ "@", [ "?", "@" ] ], [ "*", [ "*", "+", "?", "@" ] ], [ "+", [ "+", "@", "?", "*" ] ] ]), usurpMap = new Map([ [ "!", new Map([ [ "!", "@" ] ]) ], [ "?", new Map([ [ "*", "*" ], [ "+", "*" ] ]) ], [ "@", new Map([ [ "!", "!" ], [ "?", "?" ], [ "@", "@" ], [ "*", "*" ], [ "+", "+" ] ]) ], [ "+", new Map([ [ "?", "*" ], [ "*", "*" ] ]) ] ]), addPatternStart = new Set([ "[", "." ]), justDots = new Set([ "..", "." ]), reSpecials = new Set("().*{}+?[]^$\\!"), regExpEscape = s => s.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
  let ID = 0;
  class AST {
    type;
    #root;
    #hasMagic;
    #uflag=!1;
    #parts=[];
    #parent;
    #parentIndex;
    #negs;
    #filledNegs=!1;
    #options;
    #toString;
    #emptyExt=!1;
    id=++ID;
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
      this.type = type, type && (this.#hasMagic = !0), this.#parent = parent, this.#root = this.#parent ? this.#parent.#root : this, 
      this.#options = this.#root === this ? options : this.#root.#options, this.#negs = this.#root === this ? [] : this.#root.#negs, 
      "!" !== type || this.#root.#filledNegs || this.#negs.push(this), this.#parentIndex = this.#parent ? this.#parent.#parts.length : 0;
    }
    get hasMagic() {
      if (void 0 !== this.#hasMagic) return this.#hasMagic;
      for (const p of this.#parts) if ("string" != typeof p && (p.type || p.hasMagic)) return this.#hasMagic = !0;
      return this.#hasMagic;
    }
    toString() {
      return void 0 !== this.#toString ? this.#toString : this.type ? this.#toString = this.type + "(" + this.#parts.map(p => String(p)).join("|") + ")" : this.#toString = this.#parts.map(p => String(p)).join("");
    }
    #fillNegs() {
      if (this !== this.#root) throw new Error("should only call on root");
      if (this.#filledNegs) return this;
      let n;
      for (this.toString(), this.#filledNegs = !0; n = this.#negs.pop(); ) {
        if ("!" !== n.type) continue;
        let p = n, pp = p.#parent;
        for (;pp; ) {
          for (let i = p.#parentIndex + 1; !pp.type && i < pp.#parts.length; i++) for (const part of n.#parts) {
            if ("string" == typeof part) throw new Error("string part in extglob AST??");
            part.copyIn(pp.#parts[i]);
          }
          p = pp, pp = p.#parent;
        }
      }
      return this;
    }
    push(...parts) {
      for (const p of parts) if ("" !== p) {
        if ("string" != typeof p && !(p instanceof _a && p.#parent === this)) throw new Error("invalid part: " + p);
        this.#parts.push(p);
      }
    }
    toJSON() {
      const ret = null === this.type ? this.#parts.slice().map(p => "string" == typeof p ? p : p.toJSON()) : [ this.type, ...this.#parts.map(p => p.toJSON()) ];
      return this.isStart() && !this.type && ret.unshift([]), this.isEnd() && (this === this.#root || this.#root.#filledNegs && "!" === this.#parent?.type) && ret.push({}), 
      ret;
    }
    isStart() {
      if (this.#root === this) return !0;
      if (!this.#parent?.isStart()) return !1;
      if (0 === this.#parentIndex) return !0;
      const p = this.#parent;
      for (let i = 0; i < this.#parentIndex; i++) {
        const pp = p.#parts[i];
        if (!(pp instanceof _a && "!" === pp.type)) return !1;
      }
      return !0;
    }
    isEnd() {
      if (this.#root === this) return !0;
      if ("!" === this.#parent?.type) return !0;
      if (!this.#parent?.isEnd()) return !1;
      if (!this.type) return this.#parent?.isEnd();
      const pl = this.#parent ? this.#parent.#parts.length : 0;
      return this.#parentIndex === pl - 1;
    }
    copyIn(part) {
      "string" == typeof part ? this.push(part) : this.push(part.clone(this));
    }
    clone(parent) {
      const c = new _a(this.type, parent);
      for (const p of this.#parts) c.copyIn(p);
      return c;
    }
    static #parseAST(str, ast, pos, opt, extDepth) {
      const maxDepth = opt.maxExtglobRecursion ?? 2;
      let escaping = !1, inBrace = !1, braceStart = -1, braceNeg = !1;
      if (null === ast.type) {
        let i = pos, acc = "";
        for (;i < str.length; ) {
          const c = str.charAt(i++);
          if (escaping || "\\" === c) {
            escaping = !escaping, acc += c;
            continue;
          }
          if (inBrace) {
            i === braceStart + 1 ? "^" !== c && "!" !== c || (braceNeg = !0) : "]" !== c || i === braceStart + 2 && braceNeg || (inBrace = !1), 
            acc += c;
            continue;
          }
          if ("[" === c) {
            inBrace = !0, braceStart = i, braceNeg = !1, acc += c;
            continue;
          }
          if (!opt.noext && isExtglobType(c) && "(" === str.charAt(i) && extDepth <= maxDepth) {
            ast.push(acc), acc = "";
            const ext = new _a(c, ast);
            i = _a.#parseAST(str, ext, i, opt, extDepth + 1), ast.push(ext);
            continue;
          }
          acc += c;
        }
        return ast.push(acc), i;
      }
      let i = pos + 1, part = new _a(null, ast);
      const parts = [];
      let acc = "";
      for (;i < str.length; ) {
        const c = str.charAt(i++);
        if (escaping || "\\" === c) {
          escaping = !escaping, acc += c;
          continue;
        }
        if (inBrace) {
          i === braceStart + 1 ? "^" !== c && "!" !== c || (braceNeg = !0) : "]" !== c || i === braceStart + 2 && braceNeg || (inBrace = !1), 
          acc += c;
          continue;
        }
        if ("[" === c) {
          inBrace = !0, braceStart = i, braceNeg = !1, acc += c;
          continue;
        }
        if (!opt.noext && isExtglobType(c) && "(" === str.charAt(i) && (extDepth <= maxDepth || ast && ast.#canAdoptType(c))) {
          const depthAdd = ast && ast.#canAdoptType(c) ? 0 : 1;
          part.push(acc), acc = "";
          const ext = new _a(c, part);
          part.push(ext), i = _a.#parseAST(str, ext, i, opt, extDepth + depthAdd);
          continue;
        }
        if ("|" !== c) {
          if (")" === c) return "" === acc && 0 === ast.#parts.length && (ast.#emptyExt = !0), 
          part.push(acc), acc = "", ast.push(...parts, part), i;
          acc += c;
        } else part.push(acc), acc = "", parts.push(part), part = new _a(null, ast);
      }
      return ast.type = null, ast.#hasMagic = void 0, ast.#parts = [ str.substring(pos - 1) ], 
      i;
    }
    #canAdoptWithSpace(child) {
      return this.#canAdopt(child, adoptionWithSpaceMap);
    }
    #canAdopt(child, map = adoptionMap) {
      if (!child || "object" != typeof child || null !== child.type || 1 !== child.#parts.length || null === this.type) return !1;
      const gc = child.#parts[0];
      return !(!gc || "object" != typeof gc || null === gc.type) && this.#canAdoptType(gc.type, map);
    }
    #canAdoptType(c, map = adoptionAnyMap) {
      return !!map.get(this.type)?.includes(c);
    }
    #adoptWithSpace(child, index) {
      const gc = child.#parts[0], blank = new _a(null, gc, this.options);
      blank.#parts.push(""), gc.push(blank), this.#adopt(child, index);
    }
    #adopt(child, index) {
      const gc = child.#parts[0];
      this.#parts.splice(index, 1, ...gc.#parts);
      for (const p of gc.#parts) "object" == typeof p && (p.#parent = this);
      this.#toString = void 0;
    }
    #canUsurpType(c) {
      const m = usurpMap.get(this.type);
      return !!m?.has(c);
    }
    #canUsurp(child) {
      if (!child || "object" != typeof child || null !== child.type || 1 !== child.#parts.length || null === this.type || 1 !== this.#parts.length) return !1;
      const gc = child.#parts[0];
      return !(!gc || "object" != typeof gc || null === gc.type) && this.#canUsurpType(gc.type);
    }
    #usurp(child) {
      const m = usurpMap.get(this.type), gc = child.#parts[0], nt = m?.get(gc.type);
      if (!nt) return !1;
      this.#parts = gc.#parts;
      for (const p of this.#parts) "object" == typeof p && (p.#parent = this);
      this.type = nt, this.#toString = void 0, this.#emptyExt = !1;
    }
    static fromGlob(pattern, options = {}) {
      const ast = new _a(null, void 0, options);
      return _a.#parseAST(pattern, ast, 0, options, 0), ast;
    }
    toMMPattern() {
      if (this !== this.#root) return this.#root.toMMPattern();
      const glob = this.toString(), [re, body, hasMagic, uflag] = this.toRegExpSource();
      if (!(hasMagic || this.#hasMagic || this.#options.nocase && !this.#options.nocaseMagicOnly && glob.toUpperCase() !== glob.toLowerCase())) return body;
      const flags = (this.#options.nocase ? "i" : "") + (uflag ? "u" : "");
      return Object.assign(new RegExp(`^${re}$`, flags), {
        _src: re,
        _glob: glob
      });
    }
    get options() {
      return this.#options;
    }
    toRegExpSource(allowDot) {
      const dot = allowDot ?? !!this.#options.dot;
      if (this.#root === this && (this.#flatten(), this.#fillNegs()), !isExtglobAST(this)) {
        const noEmpty = this.isStart() && this.isEnd() && !this.#parts.some(s => "string" != typeof s), src = this.#parts.map(p => {
          const [re, _, hasMagic, uflag] = "string" == typeof p ? _a.#parseGlob(p, this.#hasMagic, noEmpty) : p.toRegExpSource(allowDot);
          return this.#hasMagic = this.#hasMagic || hasMagic, this.#uflag = this.#uflag || uflag, 
          re;
        }).join("");
        let start = "";
        if (this.isStart() && "string" == typeof this.#parts[0]) {
          if (!(1 === this.#parts.length && justDots.has(this.#parts[0]))) {
            const aps = addPatternStart, needNoTrav = dot && aps.has(src.charAt(0)) || src.startsWith("\\.") && aps.has(src.charAt(2)) || src.startsWith("\\.\\.") && aps.has(src.charAt(4)), needNoDot = !dot && !allowDot && aps.has(src.charAt(0));
            start = needNoTrav ? "(?!(?:^|/)\\.\\.?(?:$|/))" : needNoDot ? "(?!\\.)" : "";
          }
        }
        let end = "";
        this.isEnd() && this.#root.#filledNegs && "!" === this.#parent?.type && (end = "(?:$|\\/)");
        return [ start + src + end, (0, unescape_js_1.unescape)(src), this.#hasMagic = !!this.#hasMagic, this.#uflag ];
      }
      const repeated = "*" === this.type || "+" === this.type, start = "!" === this.type ? "(?:(?!(?:" : "(?:";
      let body = this.#partsToRegExp(dot);
      if (this.isStart() && this.isEnd() && !body && "!" !== this.type) {
        const s = this.toString(), me = this;
        return me.#parts = [ s ], me.type = null, me.#hasMagic = void 0, [ s, (0, unescape_js_1.unescape)(this.toString()), !1, !1 ];
      }
      let bodyDotAllowed = !repeated || allowDot || dot ? "" : this.#partsToRegExp(!0);
      bodyDotAllowed === body && (bodyDotAllowed = ""), bodyDotAllowed && (body = `(?:${body})(?:${bodyDotAllowed})*?`);
      let final = "";
      if ("!" === this.type && this.#emptyExt) final = (this.isStart() && !dot ? "(?!\\.)" : "") + "[^/]+?"; else {
        final = start + body + ("!" === this.type ? "))" + (!this.isStart() || dot || allowDot ? "" : "(?!\\.)") + "[^/]*?)" : "@" === this.type ? ")" : "?" === this.type ? ")?" : "+" === this.type && bodyDotAllowed ? ")" : "*" === this.type && bodyDotAllowed ? ")?" : `)${this.type}`);
      }
      return [ final, (0, unescape_js_1.unescape)(body), this.#hasMagic = !!this.#hasMagic, this.#uflag ];
    }
    #flatten() {
      if (isExtglobAST(this)) {
        let iterations = 0, done = !1;
        do {
          done = !0;
          for (let i = 0; i < this.#parts.length; i++) {
            const c = this.#parts[i];
            "object" == typeof c && (c.#flatten(), this.#canAdopt(c) ? (done = !1, this.#adopt(c, i)) : this.#canAdoptWithSpace(c) ? (done = !1, 
            this.#adoptWithSpace(c, i)) : this.#canUsurp(c) && (done = !1, this.#usurp(c)));
          }
        } while (!done && ++iterations < 10);
      } else for (const p of this.#parts) "object" == typeof p && p.#flatten();
      this.#toString = void 0;
    }
    #partsToRegExp(dot) {
      return this.#parts.map(p => {
        if ("string" == typeof p) throw new Error("string type in extglob ast??");
        const [re, _, _hasMagic, uflag] = p.toRegExpSource(dot);
        return this.#uflag = this.#uflag || uflag, re;
      }).filter(p => !(this.isStart() && this.isEnd() && !p)).join("|");
    }
    static #parseGlob(glob, hasMagic, noEmpty = !1) {
      let escaping = !1, re = "", uflag = !1, inStar = !1;
      for (let i = 0; i < glob.length; i++) {
        const c = glob.charAt(i);
        if (escaping) escaping = !1, re += (reSpecials.has(c) ? "\\" : "") + c; else if ("*" !== c) if (inStar = !1, 
        "\\" !== c) {
          if ("[" === c) {
            const [src, needUflag, consumed, magic] = (0, brace_expressions_js_1.parseClass)(glob, i);
            if (consumed) {
              re += src, uflag = uflag || needUflag, i += consumed - 1, hasMagic = hasMagic || magic;
              continue;
            }
          }
          "?" !== c ? re += regExpEscape(c) : (re += "[^/]", hasMagic = !0);
        } else i === glob.length - 1 ? re += "\\\\" : escaping = !0; else {
          if (inStar) continue;
          inStar = !0, re += noEmpty && /^[*]+$/.test(glob) ? "[^/]+?" : "[^/]*?", hasMagic = !0;
        }
      }
      return [ re, (0, unescape_js_1.unescape)(glob), !!hasMagic, uflag ];
    }
  }
  return ast.AST = AST, _a = AST, ast;
}

var hasRequired_escape, hasRequiredCommonjs, hasRequiredRole, hasRequiredRoot, _escape = {};

function require_escape() {
  if (hasRequired_escape) return _escape;
  hasRequired_escape = 1, Object.defineProperty(_escape, "__esModule", {
    value: !0
  }), _escape.escape = void 0;
  return _escape.escape = (s, {windowsPathsNoEscape: windowsPathsNoEscape = !1, magicalBraces: magicalBraces = !1} = {}) => magicalBraces ? windowsPathsNoEscape ? s.replace(/[?*()[\]{}]/g, "[$&]") : s.replace(/[?*()[\]\\{}]/g, "\\$&") : windowsPathsNoEscape ? s.replace(/[?*()[\]]/g, "[$&]") : s.replace(/[?*()[\]\\]/g, "\\$&"), 
  _escape;
}

function requireCommonjs() {
  return hasRequiredCommonjs || (hasRequiredCommonjs = 1, function(exports) {
    Object.defineProperty(exports, "__esModule", {
      value: !0
    }), exports.unescape = exports.escape = exports.AST = exports.Minimatch = exports.match = exports.makeRe = exports.braceExpand = exports.defaults = exports.filter = exports.GLOBSTAR = exports.sep = exports.minimatch = void 0;
    const brace_expansion_1 = requireCommonjs$1(), assert_valid_pattern_js_1 = (hasRequiredAssertValidPattern || (hasRequiredAssertValidPattern = 1, 
    Object.defineProperty(assertValidPattern, "__esModule", {
      value: !0
    }), assertValidPattern.assertValidPattern = void 0, assertValidPattern.assertValidPattern = pattern => {
      if ("string" != typeof pattern) throw new TypeError("invalid pattern");
      if (pattern.length > 65536) throw new TypeError("pattern is too long");
    }), assertValidPattern), ast_js_1 = requireAst(), escape_js_1 = require_escape(), unescape_js_1 = require_unescape();
    exports.minimatch = (p, pattern, options = {}) => ((0, assert_valid_pattern_js_1.assertValidPattern)(pattern), 
    !(!options.nocomment && "#" === pattern.charAt(0)) && new Minimatch(pattern, options).match(p));
    const starDotExtRE = /^\*+([^+@!?*[(]*)$/, starDotExtTest = ext => f => !f.startsWith(".") && f.endsWith(ext), starDotExtTestDot = ext => f => f.endsWith(ext), starDotExtTestNocase = ext => (ext = ext.toLowerCase(), 
    f => !f.startsWith(".") && f.toLowerCase().endsWith(ext)), starDotExtTestNocaseDot = ext => (ext = ext.toLowerCase(), 
    f => f.toLowerCase().endsWith(ext)), starDotStarRE = /^\*+\.\*+$/, starDotStarTest = f => !f.startsWith(".") && f.includes("."), starDotStarTestDot = f => "." !== f && ".." !== f && f.includes("."), dotStarRE = /^\.\*+$/, dotStarTest = f => "." !== f && ".." !== f && f.startsWith("."), starRE = /^\*+$/, starTest = f => 0 !== f.length && !f.startsWith("."), starTestDot = f => 0 !== f.length && "." !== f && ".." !== f, qmarksRE = /^\?+([^+@!?*[(]*)?$/, qmarksTestNocase = ([$0, ext = ""]) => {
      const noext = qmarksTestNoExt([ $0 ]);
      return ext ? (ext = ext.toLowerCase(), f => noext(f) && f.toLowerCase().endsWith(ext)) : noext;
    }, qmarksTestNocaseDot = ([$0, ext = ""]) => {
      const noext = qmarksTestNoExtDot([ $0 ]);
      return ext ? (ext = ext.toLowerCase(), f => noext(f) && f.toLowerCase().endsWith(ext)) : noext;
    }, qmarksTestDot = ([$0, ext = ""]) => {
      const noext = qmarksTestNoExtDot([ $0 ]);
      return ext ? f => noext(f) && f.endsWith(ext) : noext;
    }, qmarksTest = ([$0, ext = ""]) => {
      const noext = qmarksTestNoExt([ $0 ]);
      return ext ? f => noext(f) && f.endsWith(ext) : noext;
    }, qmarksTestNoExt = ([$0]) => {
      const len = $0.length;
      return f => f.length === len && !f.startsWith(".");
    }, qmarksTestNoExtDot = ([$0]) => {
      const len = $0.length;
      return f => f.length === len && "." !== f && ".." !== f;
    }, defaultPlatform = "object" == typeof process && process ? "object" == typeof process.env && process.env && process.env.__MINIMATCH_TESTING_PLATFORM__ || process.platform : "posix", path_win32 = {
      sep: "\\"
    }, path_posix = {
      sep: "/"
    };
    exports.sep = "win32" === defaultPlatform ? path_win32.sep : path_posix.sep, exports.minimatch.sep = exports.sep, 
    exports.GLOBSTAR = Symbol("globstar **"), exports.minimatch.GLOBSTAR = exports.GLOBSTAR;
    exports.filter = (pattern, options = {}) => p => (0, exports.minimatch)(p, pattern, options), 
    exports.minimatch.filter = exports.filter;
    const ext = (a, b = {}) => Object.assign({}, a, b);
    exports.defaults = def => {
      if (!def || "object" != typeof def || !Object.keys(def).length) return exports.minimatch;
      const orig = exports.minimatch;
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
          constructor(type, parent, options = {}) {
            super(type, parent, ext(def, options));
          }
          static fromGlob(pattern, options = {}) {
            return orig.AST.fromGlob(pattern, ext(def, options));
          }
        },
        unescape: (s, options = {}) => orig.unescape(s, ext(def, options)),
        escape: (s, options = {}) => orig.escape(s, ext(def, options)),
        filter: (pattern, options = {}) => orig.filter(pattern, ext(def, options)),
        defaults: options => orig.defaults(ext(def, options)),
        makeRe: (pattern, options = {}) => orig.makeRe(pattern, ext(def, options)),
        braceExpand: (pattern, options = {}) => orig.braceExpand(pattern, ext(def, options)),
        match: (list, pattern, options = {}) => orig.match(list, pattern, ext(def, options)),
        sep: orig.sep,
        GLOBSTAR: exports.GLOBSTAR
      });
    }, exports.minimatch.defaults = exports.defaults;
    exports.braceExpand = (pattern, options = {}) => ((0, assert_valid_pattern_js_1.assertValidPattern)(pattern), 
    options.nobrace || !/\{(?:(?!\{).)*\}/.test(pattern) ? [ pattern ] : (0, brace_expansion_1.expand)(pattern, {
      max: options.braceExpandMax
    })), exports.minimatch.braceExpand = exports.braceExpand;
    exports.makeRe = (pattern, options = {}) => new Minimatch(pattern, options).makeRe(), 
    exports.minimatch.makeRe = exports.makeRe;
    exports.match = (list, pattern, options = {}) => {
      const mm = new Minimatch(pattern, options);
      return list = list.filter(f => mm.match(f)), mm.options.nonull && !list.length && list.push(pattern), 
      list;
    }, exports.minimatch.match = exports.match;
    const globMagic = /[?*]|[+@!]\(.*?\)|\[|\]/;
    class Minimatch {
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
        (0, assert_valid_pattern_js_1.assertValidPattern)(pattern), options = options || {}, 
        this.options = options, this.maxGlobstarRecursion = options.maxGlobstarRecursion ?? 200, 
        this.pattern = pattern, this.platform = options.platform || defaultPlatform, this.isWindows = "win32" === this.platform;
        this.windowsPathsNoEscape = !!options.windowsPathsNoEscape || !1 === options.allowWindowsEscape, 
        this.windowsPathsNoEscape && (this.pattern = this.pattern.replace(/\\/g, "/")), 
        this.preserveMultipleSlashes = !!options.preserveMultipleSlashes, this.regexp = null, 
        this.negate = !1, this.nonegate = !!options.nonegate, this.comment = !1, this.empty = !1, 
        this.partial = !!options.partial, this.nocase = !!this.options.nocase, this.windowsNoMagicRoot = void 0 !== options.windowsNoMagicRoot ? options.windowsNoMagicRoot : !(!this.isWindows || !this.nocase), 
        this.globSet = [], this.globParts = [], this.set = [], this.make();
      }
      hasMagic() {
        if (this.options.magicalBraces && this.set.length > 1) return !0;
        for (const pattern of this.set) for (const part of pattern) if ("string" != typeof part) return !0;
        return !1;
      }
      debug(..._) {}
      make() {
        const pattern = this.pattern, options = this.options;
        if (!options.nocomment && "#" === pattern.charAt(0)) return void (this.comment = !0);
        if (!pattern) return void (this.empty = !0);
        this.parseNegate(), this.globSet = [ ...new Set(this.braceExpand()) ], options.debug && (this.debug = (...args) => console.error(...args)), 
        this.debug(this.pattern, this.globSet);
        const rawGlobParts = this.globSet.map(s => this.slashSplit(s));
        this.globParts = this.preprocess(rawGlobParts), this.debug(this.pattern, this.globParts);
        let set = this.globParts.map((s, _, __) => {
          if (this.isWindows && this.windowsNoMagicRoot) {
            const isUNC = !("" !== s[0] || "" !== s[1] || "?" !== s[2] && globMagic.test(s[2]) || globMagic.test(s[3])), isDrive = /^[a-z]:/i.test(s[0]);
            if (isUNC) return [ ...s.slice(0, 4), ...s.slice(4).map(ss => this.parse(ss)) ];
            if (isDrive) return [ s[0], ...s.slice(1).map(ss => this.parse(ss)) ];
          }
          return s.map(ss => this.parse(ss));
        });
        if (this.debug(this.pattern, set), this.set = set.filter(s => -1 === s.indexOf(!1)), 
        this.isWindows) for (let i = 0; i < this.set.length; i++) {
          const p = this.set[i];
          "" === p[0] && "" === p[1] && "?" === this.globParts[i][2] && "string" == typeof p[3] && /^[a-z]:$/i.test(p[3]) && (p[2] = "?");
        }
        this.debug(this.pattern, this.set);
      }
      preprocess(globParts) {
        if (this.options.noglobstar) for (const partset of globParts) for (let j = 0; j < partset.length; j++) "**" === partset[j] && (partset[j] = "*");
        const {optimizationLevel: optimizationLevel = 1} = this.options;
        return optimizationLevel >= 2 ? (globParts = this.firstPhasePreProcess(globParts), 
        globParts = this.secondPhasePreProcess(globParts)) : globParts = optimizationLevel >= 1 ? this.levelOneOptimize(globParts) : this.adjascentGlobstarOptimize(globParts), 
        globParts;
      }
      adjascentGlobstarOptimize(globParts) {
        return globParts.map(parts => {
          let gs = -1;
          for (;-1 !== (gs = parts.indexOf("**", gs + 1)); ) {
            let i = gs;
            for (;"**" === parts[i + 1]; ) i++;
            i !== gs && parts.splice(gs, i - gs);
          }
          return parts;
        });
      }
      levelOneOptimize(globParts) {
        return globParts.map(parts => (parts = parts.reduce((set, part) => {
          const prev = set[set.length - 1];
          return "**" === part && "**" === prev ? set : ".." === part && prev && ".." !== prev && "." !== prev && "**" !== prev ? (set.pop(), 
          set) : (set.push(part), set);
        }, []), 0 === parts.length ? [ "" ] : parts));
      }
      levelTwoFileOptimize(parts) {
        Array.isArray(parts) || (parts = this.slashSplit(parts));
        let didSomething = !1;
        do {
          if (didSomething = !1, !this.preserveMultipleSlashes) {
            for (let i = 1; i < parts.length - 1; i++) {
              const p = parts[i];
              1 === i && "" === p && "" === parts[0] || ("." !== p && "" !== p || (didSomething = !0, 
              parts.splice(i, 1), i--));
            }
            "." !== parts[0] || 2 !== parts.length || "." !== parts[1] && "" !== parts[1] || (didSomething = !0, 
            parts.pop());
          }
          let dd = 0;
          for (;-1 !== (dd = parts.indexOf("..", dd + 1)); ) {
            const p = parts[dd - 1];
            !p || "." === p || ".." === p || "**" === p || this.isWindows && /^[a-z]:$/i.test(p) || (didSomething = !0, 
            parts.splice(dd - 1, 2), dd -= 2);
          }
        } while (didSomething);
        return 0 === parts.length ? [ "" ] : parts;
      }
      firstPhasePreProcess(globParts) {
        let didSomething = !1;
        do {
          didSomething = !1;
          for (let parts of globParts) {
            let gs = -1;
            for (;-1 !== (gs = parts.indexOf("**", gs + 1)); ) {
              let gss = gs;
              for (;"**" === parts[gss + 1]; ) gss++;
              gss > gs && parts.splice(gs + 1, gss - gs);
              let next = parts[gs + 1];
              const p = parts[gs + 2], p2 = parts[gs + 3];
              if (".." !== next) continue;
              if (!p || "." === p || ".." === p || !p2 || "." === p2 || ".." === p2) continue;
              didSomething = !0, parts.splice(gs, 1);
              const other = parts.slice(0);
              other[gs] = "**", globParts.push(other), gs--;
            }
            if (!this.preserveMultipleSlashes) {
              for (let i = 1; i < parts.length - 1; i++) {
                const p = parts[i];
                1 === i && "" === p && "" === parts[0] || ("." !== p && "" !== p || (didSomething = !0, 
                parts.splice(i, 1), i--));
              }
              "." !== parts[0] || 2 !== parts.length || "." !== parts[1] && "" !== parts[1] || (didSomething = !0, 
              parts.pop());
            }
            let dd = 0;
            for (;-1 !== (dd = parts.indexOf("..", dd + 1)); ) {
              const p = parts[dd - 1];
              if (p && "." !== p && ".." !== p && "**" !== p) {
                didSomething = !0;
                const splin = 1 === dd && "**" === parts[dd + 1] ? [ "." ] : [];
                parts.splice(dd - 1, 2, ...splin), 0 === parts.length && parts.push(""), dd -= 2;
              }
            }
          }
        } while (didSomething);
        return globParts;
      }
      secondPhasePreProcess(globParts) {
        for (let i = 0; i < globParts.length - 1; i++) for (let j = i + 1; j < globParts.length; j++) {
          const matched = this.partsMatch(globParts[i], globParts[j], !this.preserveMultipleSlashes);
          if (matched) {
            globParts[i] = [], globParts[j] = matched;
            break;
          }
        }
        return globParts.filter(gs => gs.length);
      }
      partsMatch(a, b, emptyGSMatch = !1) {
        let ai = 0, bi = 0, result = [], which = "";
        for (;ai < a.length && bi < b.length; ) if (a[ai] === b[bi]) result.push("b" === which ? b[bi] : a[ai]), 
        ai++, bi++; else if (emptyGSMatch && "**" === a[ai] && b[bi] === a[ai + 1]) result.push(a[ai]), 
        ai++; else if (emptyGSMatch && "**" === b[bi] && a[ai] === b[bi + 1]) result.push(b[bi]), 
        bi++; else if ("*" !== a[ai] || !b[bi] || !this.options.dot && b[bi].startsWith(".") || "**" === b[bi]) {
          if ("*" !== b[bi] || !a[ai] || !this.options.dot && a[ai].startsWith(".") || "**" === a[ai]) return !1;
          if ("a" === which) return !1;
          which = "b", result.push(b[bi]), ai++, bi++;
        } else {
          if ("b" === which) return !1;
          which = "a", result.push(a[ai]), ai++, bi++;
        }
        return a.length === b.length && result;
      }
      parseNegate() {
        if (this.nonegate) return;
        const pattern = this.pattern;
        let negate = !1, negateOffset = 0;
        for (let i = 0; i < pattern.length && "!" === pattern.charAt(i); i++) negate = !negate, 
        negateOffset++;
        negateOffset && (this.pattern = pattern.slice(negateOffset)), this.negate = negate;
      }
      matchOne(file, pattern, partial = !1) {
        let fileStartIndex = 0, patternStartIndex = 0;
        if (this.isWindows) {
          const fileDrive = "string" == typeof file[0] && /^[a-z]:$/i.test(file[0]), fileUNC = !fileDrive && "" === file[0] && "" === file[1] && "?" === file[2] && /^[a-z]:$/i.test(file[3]), patternDrive = "string" == typeof pattern[0] && /^[a-z]:$/i.test(pattern[0]), fdi = fileUNC ? 3 : fileDrive ? 0 : void 0, pdi = !patternDrive && "" === pattern[0] && "" === pattern[1] && "?" === pattern[2] && "string" == typeof pattern[3] && /^[a-z]:$/i.test(pattern[3]) ? 3 : patternDrive ? 0 : void 0;
          if ("number" == typeof fdi && "number" == typeof pdi) {
            const [fd, pd] = [ file[fdi], pattern[pdi] ];
            fd.toLowerCase() === pd.toLowerCase() && (pattern[pdi] = fd, patternStartIndex = pdi, 
            fileStartIndex = fdi);
          }
        }
        const {optimizationLevel: optimizationLevel = 1} = this.options;
        return optimizationLevel >= 2 && (file = this.levelTwoFileOptimize(file)), pattern.includes(exports.GLOBSTAR) ? this.#matchGlobstar(file, pattern, partial, fileStartIndex, patternStartIndex) : this.#matchOne(file, pattern, partial, fileStartIndex, patternStartIndex);
      }
      #matchGlobstar(file, pattern, partial, fileIndex, patternIndex) {
        const firstgs = pattern.indexOf(exports.GLOBSTAR, patternIndex), lastgs = pattern.lastIndexOf(exports.GLOBSTAR), [head, body, tail] = partial ? [ pattern.slice(patternIndex, firstgs), pattern.slice(firstgs + 1), [] ] : [ pattern.slice(patternIndex, firstgs), pattern.slice(firstgs + 1, lastgs), pattern.slice(lastgs + 1) ];
        if (head.length) {
          const fileHead = file.slice(fileIndex, fileIndex + head.length);
          if (!this.#matchOne(fileHead, head, partial, 0, 0)) return !1;
          fileIndex += head.length, patternIndex += head.length;
        }
        let fileTailMatch = 0;
        if (tail.length) {
          if (tail.length + fileIndex > file.length) return !1;
          let tailStart = file.length - tail.length;
          if (this.#matchOne(file, tail, partial, tailStart, 0)) fileTailMatch = tail.length; else {
            if ("" !== file[file.length - 1] || fileIndex + tail.length === file.length) return !1;
            if (tailStart--, !this.#matchOne(file, tail, partial, tailStart, 0)) return !1;
            fileTailMatch = tail.length + 1;
          }
        }
        if (!body.length) {
          let sawSome = !!fileTailMatch;
          for (let i = fileIndex; i < file.length - fileTailMatch; i++) {
            const f = String(file[i]);
            if (sawSome = !0, "." === f || ".." === f || !this.options.dot && f.startsWith(".")) return !1;
          }
          return partial || sawSome;
        }
        const bodySegments = [ [ [], 0 ] ];
        let currentBody = bodySegments[0], nonGsParts = 0;
        const nonGsPartsSums = [ 0 ];
        for (const b of body) b === exports.GLOBSTAR ? (nonGsPartsSums.push(nonGsParts), 
        currentBody = [ [], 0 ], bodySegments.push(currentBody)) : (currentBody[0].push(b), 
        nonGsParts++);
        let i = bodySegments.length - 1;
        const fileLength = file.length - fileTailMatch;
        for (const b of bodySegments) b[1] = fileLength - (nonGsPartsSums[i--] + b[0].length);
        return !!this.#matchGlobStarBodySections(file, bodySegments, fileIndex, 0, partial, 0, !!fileTailMatch);
      }
      #matchGlobStarBodySections(file, bodySegments, fileIndex, bodyIndex, partial, globStarDepth, sawTail) {
        const bs = bodySegments[bodyIndex];
        if (!bs) {
          for (let i = fileIndex; i < file.length; i++) {
            sawTail = !0;
            const f = file[i];
            if ("." === f || ".." === f || !this.options.dot && f.startsWith(".")) return !1;
          }
          return sawTail;
        }
        const [body, after] = bs;
        for (;fileIndex <= after; ) {
          if (this.#matchOne(file.slice(0, fileIndex + body.length), body, partial, fileIndex, 0) && globStarDepth < this.maxGlobstarRecursion) {
            const sub = this.#matchGlobStarBodySections(file, bodySegments, fileIndex + body.length, bodyIndex + 1, partial, globStarDepth + 1, sawTail);
            if (!1 !== sub) return sub;
          }
          const f = file[fileIndex];
          if ("." === f || ".." === f || !this.options.dot && f.startsWith(".")) return !1;
          fileIndex++;
        }
        return partial || null;
      }
      #matchOne(file, pattern, partial, fileIndex, patternIndex) {
        let fi, pi, pl, fl;
        for (fi = fileIndex, pi = patternIndex, fl = file.length, pl = pattern.length; fi < fl && pi < pl; fi++, 
        pi++) {
          this.debug("matchOne loop");
          let hit, p = pattern[pi], f = file[fi];
          if (this.debug(pattern, p, f), !1 === p || p === exports.GLOBSTAR) return !1;
          if ("string" == typeof p ? (hit = f === p, this.debug("string match", p, f, hit)) : (hit = p.test(f), 
          this.debug("pattern match", p, f, hit)), !hit) return !1;
        }
        if (fi === fl && pi === pl) return !0;
        if (fi === fl) return partial;
        if (pi === pl) return fi === fl - 1 && "" === file[fi];
        throw new Error("wtf?");
      }
      braceExpand() {
        return (0, exports.braceExpand)(this.pattern, this.options);
      }
      parse(pattern) {
        (0, assert_valid_pattern_js_1.assertValidPattern)(pattern);
        const options = this.options;
        if ("**" === pattern) return exports.GLOBSTAR;
        if ("" === pattern) return "";
        let m, fastTest = null;
        (m = pattern.match(starRE)) ? fastTest = options.dot ? starTestDot : starTest : (m = pattern.match(starDotExtRE)) ? fastTest = (options.nocase ? options.dot ? starDotExtTestNocaseDot : starDotExtTestNocase : options.dot ? starDotExtTestDot : starDotExtTest)(m[1]) : (m = pattern.match(qmarksRE)) ? fastTest = (options.nocase ? options.dot ? qmarksTestNocaseDot : qmarksTestNocase : options.dot ? qmarksTestDot : qmarksTest)(m) : (m = pattern.match(starDotStarRE)) ? fastTest = options.dot ? starDotStarTestDot : starDotStarTest : (m = pattern.match(dotStarRE)) && (fastTest = dotStarTest);
        const re = ast_js_1.AST.fromGlob(pattern, this.options).toMMPattern();
        return fastTest && "object" == typeof re && Reflect.defineProperty(re, "test", {
          value: fastTest
        }), re;
      }
      makeRe() {
        if (this.regexp || !1 === this.regexp) return this.regexp;
        const set = this.set;
        if (!set.length) return this.regexp = !1, this.regexp;
        const options = this.options, twoStar = options.noglobstar ? "[^/]*?" : options.dot ? "(?:(?!(?:\\/|^)(?:\\.{1,2})($|\\/)).)*?" : "(?:(?!(?:\\/|^)\\.).)*?", flags = new Set(options.nocase ? [ "i" ] : []);
        let re = set.map(pattern => {
          const pp = pattern.map(p => {
            if (p instanceof RegExp) for (const f of p.flags.split("")) flags.add(f);
            return "string" == typeof p ? p.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&") : p === exports.GLOBSTAR ? exports.GLOBSTAR : p._src;
          });
          pp.forEach((p, i) => {
            const next = pp[i + 1], prev = pp[i - 1];
            p === exports.GLOBSTAR && prev !== exports.GLOBSTAR && (void 0 === prev ? void 0 !== next && next !== exports.GLOBSTAR ? pp[i + 1] = "(?:\\/|" + twoStar + "\\/)?" + next : pp[i] = twoStar : void 0 === next ? pp[i - 1] = prev + "(?:\\/|\\/" + twoStar + ")?" : next !== exports.GLOBSTAR && (pp[i - 1] = prev + "(?:\\/|\\/" + twoStar + "\\/)" + next, 
            pp[i + 1] = exports.GLOBSTAR));
          });
          const filtered = pp.filter(p => p !== exports.GLOBSTAR);
          if (this.partial && filtered.length >= 1) {
            const prefixes = [];
            for (let i = 1; i <= filtered.length; i++) prefixes.push(filtered.slice(0, i).join("/"));
            return "(?:" + prefixes.join("|") + ")";
          }
          return filtered.join("/");
        }).join("|");
        const [open, close] = set.length > 1 ? [ "(?:", ")" ] : [ "", "" ];
        re = "^" + open + re + close + "$", this.partial && (re = "^(?:\\/|" + open + re.slice(1, -1) + close + ")$"), 
        this.negate && (re = "^(?!" + re + ").+$");
        try {
          this.regexp = new RegExp(re, [ ...flags ].join(""));
        } catch {
          this.regexp = !1;
        }
        return this.regexp;
      }
      slashSplit(p) {
        return this.preserveMultipleSlashes ? p.split("/") : this.isWindows && /^\/\/[^/]+/.test(p) ? [ "", ...p.split(/\/+/) ] : p.split(/\/+/);
      }
      match(f, partial = this.partial) {
        if (this.debug("match", f, this.pattern), this.comment) return !1;
        if (this.empty) return "" === f;
        if ("/" === f && partial) return !0;
        const options = this.options;
        this.isWindows && (f = f.split("\\").join("/"));
        const ff = this.slashSplit(f);
        this.debug(this.pattern, "split", ff);
        const set = this.set;
        this.debug(this.pattern, "set", set);
        let filename = ff[ff.length - 1];
        if (!filename) for (let i = ff.length - 2; !filename && i >= 0; i--) filename = ff[i];
        for (const pattern of set) {
          let file = ff;
          options.matchBase && 1 === pattern.length && (file = [ filename ]);
          if (this.matchOne(file, pattern, partial)) return !!options.flipNegate || !this.negate;
        }
        return !options.flipNegate && this.negate;
      }
      static defaults(def) {
        return exports.minimatch.defaults(def).Minimatch;
      }
    }
    exports.Minimatch = Minimatch;
    var ast_js_2 = requireAst();
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
    }), exports.minimatch.AST = ast_js_1.AST, exports.minimatch.Minimatch = Minimatch, 
    exports.minimatch.escape = escape_js_1.escape, exports.minimatch.unescape = unescape_js_1.unescape;
  }(commonjs$2)), commonjs$2;
}

function requireRole() {
  if (hasRequiredRole) return role;
  hasRequiredRole = 1;
  var __importDefault = role && role.__importDefault || function(mod) {
    return mod && mod.__esModule ? mod : {
      default: mod
    };
  };
  Object.defineProperty(role, "__esModule", {
    value: !0
  }), role.SuccinctRoles = role.DelegatedRole = role.Role = role.TOP_LEVEL_ROLE_NAMES = void 0;
  const crypto_1 = __importDefault(require$$0$1), minimatch_1 = requireCommonjs(), util_1 = __importDefault(require$$0$2), error_1 = requireError$5(), utils_1 = requireUtils();
  role.TOP_LEVEL_ROLE_NAMES = [ "root", "targets", "snapshot", "timestamp" ];
  class Role {
    keyIDs;
    threshold;
    unrecognizedFields;
    constructor(options) {
      const {keyIDs: keyIDs, threshold: threshold, unrecognizedFields: unrecognizedFields} = options;
      if (array = keyIDs, new Set(array).size !== array.length) throw new error_1.ValueError("duplicate key IDs found");
      var array;
      if (threshold < 1) throw new error_1.ValueError("threshold must be at least 1");
      this.keyIDs = keyIDs, this.threshold = threshold, this.unrecognizedFields = unrecognizedFields || {};
    }
    equals(other) {
      return other instanceof Role && (this.threshold === other.threshold && util_1.default.isDeepStrictEqual(this.keyIDs, other.keyIDs) && util_1.default.isDeepStrictEqual(this.unrecognizedFields, other.unrecognizedFields));
    }
    toJSON() {
      return {
        keyids: this.keyIDs,
        threshold: this.threshold,
        ...this.unrecognizedFields
      };
    }
    static fromJSON(data) {
      const {keyids: keyids, threshold: threshold, ...rest} = data;
      if (!utils_1.guard.isStringArray(keyids)) throw new TypeError("keyids must be an array");
      if ("number" != typeof threshold) throw new TypeError("threshold must be a number");
      return new Role({
        keyIDs: keyids,
        threshold: threshold,
        unrecognizedFields: rest
      });
    }
  }
  role.Role = Role;
  class DelegatedRole extends Role {
    name;
    terminating;
    paths;
    pathHashPrefixes;
    constructor(opts) {
      super(opts);
      const {name: name, terminating: terminating, paths: paths, pathHashPrefixes: pathHashPrefixes} = opts;
      if (this.name = name, this.terminating = terminating, opts.paths && opts.pathHashPrefixes) throw new error_1.ValueError("paths and pathHashPrefixes are mutually exclusive");
      this.paths = paths, this.pathHashPrefixes = pathHashPrefixes;
    }
    equals(other) {
      return other instanceof DelegatedRole && (super.equals(other) && this.name === other.name && this.terminating === other.terminating && util_1.default.isDeepStrictEqual(this.paths, other.paths) && util_1.default.isDeepStrictEqual(this.pathHashPrefixes, other.pathHashPrefixes));
    }
    isDelegatedPath(targetFilepath) {
      if (this.paths) return this.paths.some(pathPattern => function(target, pattern) {
        const targetParts = target.split("/"), patternParts = pattern.split("/");
        if (patternParts.length != targetParts.length) return !1;
        return zip(targetParts, patternParts).every(([targetPart, patternPart]) => (0, minimatch_1.minimatch)(targetPart, patternPart));
      }(targetFilepath, pathPattern));
      if (this.pathHashPrefixes) {
        const pathHash = crypto_1.default.createHash("sha256").update(targetFilepath).digest("hex");
        return this.pathHashPrefixes.some(pathHashPrefix => pathHash.startsWith(pathHashPrefix));
      }
      return !1;
    }
    toJSON() {
      const json = {
        ...super.toJSON(),
        name: this.name,
        terminating: this.terminating
      };
      return this.paths && (json.paths = this.paths), this.pathHashPrefixes && (json.path_hash_prefixes = this.pathHashPrefixes), 
      json;
    }
    static fromJSON(data) {
      const {keyids: keyids, threshold: threshold, name: name, terminating: terminating, paths: paths, path_hash_prefixes: path_hash_prefixes, ...rest} = data;
      if (!utils_1.guard.isStringArray(keyids)) throw new TypeError("keyids must be an array of strings");
      if ("number" != typeof threshold) throw new TypeError("threshold must be a number");
      if ("string" != typeof name) throw new TypeError("name must be a string");
      if ("boolean" != typeof terminating) throw new TypeError("terminating must be a boolean");
      if (utils_1.guard.isDefined(paths) && !utils_1.guard.isStringArray(paths)) throw new TypeError("paths must be an array of strings");
      if (utils_1.guard.isDefined(path_hash_prefixes) && !utils_1.guard.isStringArray(path_hash_prefixes)) throw new TypeError("path_hash_prefixes must be an array of strings");
      return new DelegatedRole({
        keyIDs: keyids,
        threshold: threshold,
        name: name,
        terminating: terminating,
        paths: paths,
        pathHashPrefixes: path_hash_prefixes,
        unrecognizedFields: rest
      });
    }
  }
  role.DelegatedRole = DelegatedRole;
  const zip = (a, b) => a.map((k, i) => [ k, b[i] ]);
  class SuccinctRoles extends Role {
    bitLength;
    namePrefix;
    numberOfBins;
    suffixLen;
    constructor(opts) {
      super(opts);
      const {bitLength: bitLength, namePrefix: namePrefix} = opts;
      if (bitLength <= 0 || bitLength > 32) throw new error_1.ValueError("bitLength must be between 1 and 32");
      this.bitLength = bitLength, this.namePrefix = namePrefix, this.numberOfBins = Math.pow(2, bitLength), 
      this.suffixLen = (this.numberOfBins - 1).toString(16).length;
    }
    equals(other) {
      return other instanceof SuccinctRoles && (super.equals(other) && this.bitLength === other.bitLength && this.namePrefix === other.namePrefix);
    }
    getRoleForTarget(targetFilepath) {
      const hashBytes = crypto_1.default.createHash("sha256").update(targetFilepath).digest().subarray(0, 4), shiftValue = 32 - this.bitLength, suffix = (hashBytes.readUInt32BE() >>> shiftValue).toString(16).padStart(this.suffixLen, "0");
      return `${this.namePrefix}-${suffix}`;
    }
    * getRoles() {
      for (let i = 0; i < this.numberOfBins; i++) {
        const suffix = i.toString(16).padStart(this.suffixLen, "0");
        yield `${this.namePrefix}-${suffix}`;
      }
    }
    isDelegatedRole(roleName) {
      const desiredPrefix = this.namePrefix + "-";
      if (!roleName.startsWith(desiredPrefix)) return !1;
      const suffix = roleName.slice(desiredPrefix.length, roleName.length);
      if (suffix.length != this.suffixLen) return !1;
      if (!suffix.match(/^[0-9a-fA-F]+$/)) return !1;
      const num = parseInt(suffix, 16);
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
      const {keyids: keyids, threshold: threshold, bit_length: bit_length, name_prefix: name_prefix, ...rest} = data;
      if (!utils_1.guard.isStringArray(keyids)) throw new TypeError("keyids must be an array of strings");
      if ("number" != typeof threshold) throw new TypeError("threshold must be a number");
      if ("number" != typeof bit_length) throw new TypeError("bit_length must be a number");
      if ("string" != typeof name_prefix) throw new TypeError("name_prefix must be a string");
      return new SuccinctRoles({
        keyIDs: keyids,
        threshold: threshold,
        bitLength: bit_length,
        namePrefix: name_prefix,
        unrecognizedFields: rest
      });
    }
  }
  return role.SuccinctRoles = SuccinctRoles, role;
}

function requireRoot() {
  if (hasRequiredRoot) return root;
  hasRequiredRoot = 1;
  var __importDefault = root && root.__importDefault || function(mod) {
    return mod && mod.__esModule ? mod : {
      default: mod
    };
  };
  Object.defineProperty(root, "__esModule", {
    value: !0
  }), root.Root = void 0;
  const util_1 = __importDefault(require$$0$2), base_1 = requireBase(), error_1 = requireError$5(), key_1 = requireKey$1(), role_1 = requireRole(), utils_1 = requireUtils();
  class Root extends base_1.Signed {
    type=base_1.MetadataKind.Root;
    keys;
    roles;
    consistentSnapshot;
    constructor(options) {
      if (super(options), this.keys = options.keys || {}, this.consistentSnapshot = options.consistentSnapshot ?? !0, 
      options.roles) {
        const roleNames = new Set(Object.keys(options.roles));
        if (!role_1.TOP_LEVEL_ROLE_NAMES.every(role => roleNames.has(role))) throw new error_1.ValueError("missing top-level role");
        this.roles = options.roles;
      } else this.roles = role_1.TOP_LEVEL_ROLE_NAMES.reduce((acc, role) => ({
        ...acc,
        [role]: new role_1.Role({
          keyIDs: [],
          threshold: 1
        })
      }), {});
    }
    addKey(key, role) {
      if (!this.roles[role]) throw new error_1.ValueError(`role ${role} does not exist`);
      this.roles[role].keyIDs.includes(key.keyID) || this.roles[role].keyIDs.push(key.keyID), 
      this.keys[key.keyID] = key;
    }
    equals(other) {
      return other instanceof Root && (super.equals(other) && this.consistentSnapshot === other.consistentSnapshot && util_1.default.isDeepStrictEqual(this.keys, other.keys) && util_1.default.isDeepStrictEqual(this.roles, other.roles));
    }
    toJSON() {
      return {
        _type: this.type,
        spec_version: this.specVersion,
        version: this.version,
        expires: this.expires,
        keys: (keys = this.keys, Object.entries(keys).reduce((acc, [keyID, key]) => ({
          ...acc,
          [keyID]: key.toJSON()
        }), {})),
        roles: (roles = this.roles, Object.entries(roles).reduce((acc, [roleName, role]) => ({
          ...acc,
          [roleName]: role.toJSON()
        }), {})),
        consistent_snapshot: this.consistentSnapshot,
        ...this.unrecognizedFields
      };
      var roles, keys;
    }
    static fromJSON(data) {
      const {unrecognizedFields: unrecognizedFields, ...commonFields} = base_1.Signed.commonFieldsFromJSON(data), {keys: keys, roles: roles, consistent_snapshot: consistent_snapshot, ...rest} = unrecognizedFields;
      if ("boolean" != typeof consistent_snapshot) throw new TypeError("consistent_snapshot must be a boolean");
      return new Root({
        ...commonFields,
        keys: keysFromJSON(keys),
        roles: rolesFromJSON(roles),
        consistentSnapshot: consistent_snapshot,
        unrecognizedFields: rest
      });
    }
  }
  function keysFromJSON(data) {
    let keys;
    if (utils_1.guard.isDefined(data)) {
      if (!utils_1.guard.isObjectRecord(data)) throw new TypeError("keys must be an object");
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
      if (!utils_1.guard.isObjectRecord(data)) throw new TypeError("roles must be an object");
      roles = Object.entries(data).reduce((acc, [roleName, roleData]) => ({
        ...acc,
        [roleName]: role_1.Role.fromJSON(roleData)
      }), {});
    }
    return roles;
  }
  return root.Root = Root, root;
}

var hasRequiredSignature, signature = {};

function requireSignature() {
  if (hasRequiredSignature) return signature;
  hasRequiredSignature = 1, Object.defineProperty(signature, "__esModule", {
    value: !0
  }), signature.Signature = void 0;
  class Signature {
    keyID;
    sig;
    constructor(options) {
      const {keyID: keyID, sig: sig} = options;
      this.keyID = keyID, this.sig = sig;
    }
    toJSON() {
      return {
        keyid: this.keyID,
        sig: this.sig
      };
    }
    static fromJSON(data) {
      const {keyid: keyid, sig: sig} = data;
      if ("string" != typeof keyid) throw new TypeError("keyid must be a string");
      if ("string" != typeof sig) throw new TypeError("sig must be a string");
      return new Signature({
        keyID: keyid,
        sig: sig
      });
    }
  }
  return signature.Signature = Signature, signature;
}

var hasRequiredSnapshot, snapshot = {};

function requireSnapshot() {
  if (hasRequiredSnapshot) return snapshot;
  hasRequiredSnapshot = 1;
  var __importDefault = snapshot && snapshot.__importDefault || function(mod) {
    return mod && mod.__esModule ? mod : {
      default: mod
    };
  };
  Object.defineProperty(snapshot, "__esModule", {
    value: !0
  }), snapshot.Snapshot = void 0;
  const util_1 = __importDefault(require$$0$2), base_1 = requireBase(), file_1 = requireFile(), utils_1 = requireUtils();
  class Snapshot extends base_1.Signed {
    type=base_1.MetadataKind.Snapshot;
    meta;
    constructor(opts) {
      super(opts), this.meta = opts.meta || {
        "targets.json": new file_1.MetaFile({
          version: 1
        })
      };
    }
    equals(other) {
      return other instanceof Snapshot && (super.equals(other) && util_1.default.isDeepStrictEqual(this.meta, other.meta));
    }
    toJSON() {
      return {
        _type: this.type,
        meta: (meta = this.meta, Object.entries(meta).reduce((acc, [path, metadata]) => ({
          ...acc,
          [path]: metadata.toJSON()
        }), {})),
        spec_version: this.specVersion,
        version: this.version,
        expires: this.expires,
        ...this.unrecognizedFields
      };
      var meta;
    }
    static fromJSON(data) {
      const {unrecognizedFields: unrecognizedFields, ...commonFields} = base_1.Signed.commonFieldsFromJSON(data), {meta: meta, ...rest} = unrecognizedFields;
      return new Snapshot({
        ...commonFields,
        meta: metaFromJSON(meta),
        unrecognizedFields: rest
      });
    }
  }
  function metaFromJSON(data) {
    let meta;
    if (utils_1.guard.isDefined(data)) {
      if (!utils_1.guard.isObjectRecord(data)) throw new TypeError("meta field is malformed");
      meta = Object.entries(data).reduce((acc, [path, metadata]) => ({
        ...acc,
        [path]: file_1.MetaFile.fromJSON(metadata)
      }), {});
    }
    return meta;
  }
  return snapshot.Snapshot = Snapshot, snapshot;
}

var hasRequiredDelegations, hasRequiredTargets, targets = {}, delegations = {};

function requireDelegations() {
  if (hasRequiredDelegations) return delegations;
  hasRequiredDelegations = 1;
  var __importDefault = delegations && delegations.__importDefault || function(mod) {
    return mod && mod.__esModule ? mod : {
      default: mod
    };
  };
  Object.defineProperty(delegations, "__esModule", {
    value: !0
  }), delegations.Delegations = void 0;
  const util_1 = __importDefault(require$$0$2), error_1 = requireError$5(), key_1 = requireKey$1(), role_1 = requireRole(), utils_1 = requireUtils();
  class Delegations {
    keys;
    roles;
    unrecognizedFields;
    succinctRoles;
    constructor(options) {
      if (this.keys = options.keys, this.unrecognizedFields = options.unrecognizedFields || {}, 
      options.roles && Object.keys(options.roles).some(roleName => role_1.TOP_LEVEL_ROLE_NAMES.includes(roleName))) throw new error_1.ValueError("Delegated role name conflicts with top-level role name");
      this.succinctRoles = options.succinctRoles, this.roles = options.roles;
    }
    equals(other) {
      return other instanceof Delegations && (util_1.default.isDeepStrictEqual(this.keys, other.keys) && util_1.default.isDeepStrictEqual(this.roles, other.roles) && util_1.default.isDeepStrictEqual(this.unrecognizedFields, other.unrecognizedFields) && util_1.default.isDeepStrictEqual(this.succinctRoles, other.succinctRoles));
    }
    * rolesForTarget(targetPath) {
      if (this.roles) for (const role of Object.values(this.roles)) role.isDelegatedPath(targetPath) && (yield {
        role: role.name,
        terminating: role.terminating
      }); else this.succinctRoles && (yield {
        role: this.succinctRoles.getRoleForTarget(targetPath),
        terminating: !0
      });
    }
    toJSON() {
      const json = {
        keys: (keys = this.keys, Object.entries(keys).reduce((acc, [keyId, key]) => ({
          ...acc,
          [keyId]: key.toJSON()
        }), {})),
        ...this.unrecognizedFields
      };
      var keys, roles;
      return this.roles ? json.roles = (roles = this.roles, Object.values(roles).map(role => role.toJSON())) : this.succinctRoles && (json.succinct_roles = this.succinctRoles.toJSON()), 
      json;
    }
    static fromJSON(data) {
      const {keys: keys, roles: roles, succinct_roles: succinct_roles, ...unrecognizedFields} = data;
      let succinctRoles;
      return utils_1.guard.isObject(succinct_roles) && (succinctRoles = role_1.SuccinctRoles.fromJSON(succinct_roles)), 
      new Delegations({
        keys: keysFromJSON(keys),
        roles: rolesFromJSON(roles),
        unrecognizedFields: unrecognizedFields,
        succinctRoles: succinctRoles
      });
    }
  }
  function keysFromJSON(data) {
    if (!utils_1.guard.isObjectRecord(data)) throw new TypeError("keys is malformed");
    return Object.entries(data).reduce((acc, [keyID, keyData]) => ({
      ...acc,
      [keyID]: key_1.Key.fromJSON(keyID, keyData)
    }), {});
  }
  function rolesFromJSON(data) {
    let roleMap;
    if (utils_1.guard.isDefined(data)) {
      if (!utils_1.guard.isObjectArray(data)) throw new TypeError("roles is malformed");
      roleMap = data.reduce((acc, role) => {
        const delegatedRole = role_1.DelegatedRole.fromJSON(role);
        return {
          ...acc,
          [delegatedRole.name]: delegatedRole
        };
      }, {});
    }
    return roleMap;
  }
  return delegations.Delegations = Delegations, delegations;
}

function requireTargets() {
  if (hasRequiredTargets) return targets;
  hasRequiredTargets = 1;
  var __importDefault = targets && targets.__importDefault || function(mod) {
    return mod && mod.__esModule ? mod : {
      default: mod
    };
  };
  Object.defineProperty(targets, "__esModule", {
    value: !0
  }), targets.Targets = void 0;
  const util_1 = __importDefault(require$$0$2), base_1 = requireBase(), delegations_1 = requireDelegations(), file_1 = requireFile(), utils_1 = requireUtils();
  class Targets extends base_1.Signed {
    type=base_1.MetadataKind.Targets;
    targets;
    delegations;
    constructor(options) {
      super(options), this.targets = options.targets || {}, this.delegations = options.delegations;
    }
    addTarget(target) {
      this.targets[target.path] = target;
    }
    equals(other) {
      return other instanceof Targets && (super.equals(other) && util_1.default.isDeepStrictEqual(this.targets, other.targets) && util_1.default.isDeepStrictEqual(this.delegations, other.delegations));
    }
    toJSON() {
      const json = {
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
      const {unrecognizedFields: unrecognizedFields, ...commonFields} = base_1.Signed.commonFieldsFromJSON(data), {targets: targets, delegations: delegations, ...rest} = unrecognizedFields;
      return new Targets({
        ...commonFields,
        targets: targetsFromJSON(targets),
        delegations: delegationsFromJSON(delegations),
        unrecognizedFields: rest
      });
    }
  }
  function targetsToJSON(targets) {
    return Object.entries(targets).reduce((acc, [path, target]) => ({
      ...acc,
      [path]: target.toJSON()
    }), {});
  }
  function targetsFromJSON(data) {
    let targets;
    if (utils_1.guard.isDefined(data)) {
      if (!utils_1.guard.isObjectRecord(data)) throw new TypeError("targets must be an object");
      targets = Object.entries(data).reduce((acc, [path, target]) => ({
        ...acc,
        [path]: file_1.TargetFile.fromJSON(path, target)
      }), {});
    }
    return targets;
  }
  function delegationsFromJSON(data) {
    let delegations;
    if (utils_1.guard.isDefined(data)) {
      if (!utils_1.guard.isObject(data)) throw new TypeError("delegations must be an object");
      delegations = delegations_1.Delegations.fromJSON(data);
    }
    return delegations;
  }
  return targets.Targets = Targets, targets;
}

var hasRequiredTimestamp$2, hasRequiredMetadata, hasRequiredDist$4, timestamp$2 = {};

function requireTimestamp$2() {
  if (hasRequiredTimestamp$2) return timestamp$2;
  hasRequiredTimestamp$2 = 1, Object.defineProperty(timestamp$2, "__esModule", {
    value: !0
  }), timestamp$2.Timestamp = void 0;
  const base_1 = requireBase(), file_1 = requireFile(), utils_1 = requireUtils();
  class Timestamp extends base_1.Signed {
    type=base_1.MetadataKind.Timestamp;
    snapshotMeta;
    constructor(options) {
      super(options), this.snapshotMeta = options.snapshotMeta || new file_1.MetaFile({
        version: 1
      });
    }
    equals(other) {
      return other instanceof Timestamp && (super.equals(other) && this.snapshotMeta.equals(other.snapshotMeta));
    }
    toJSON() {
      return {
        _type: this.type,
        spec_version: this.specVersion,
        version: this.version,
        expires: this.expires,
        meta: {
          "snapshot.json": this.snapshotMeta.toJSON()
        },
        ...this.unrecognizedFields
      };
    }
    static fromJSON(data) {
      const {unrecognizedFields: unrecognizedFields, ...commonFields} = base_1.Signed.commonFieldsFromJSON(data), {meta: meta, ...rest} = unrecognizedFields;
      return new Timestamp({
        ...commonFields,
        snapshotMeta: snapshotMetaFromJSON(meta),
        unrecognizedFields: rest
      });
    }
  }
  function snapshotMetaFromJSON(data) {
    let snapshotMeta;
    if (utils_1.guard.isDefined(data)) {
      const snapshotData = data["snapshot.json"];
      if (!utils_1.guard.isDefined(snapshotData) || !utils_1.guard.isObject(snapshotData)) throw new TypeError("missing snapshot.json in meta");
      snapshotMeta = file_1.MetaFile.fromJSON(snapshotData);
    }
    return snapshotMeta;
  }
  return timestamp$2.Timestamp = Timestamp, timestamp$2;
}

function requireDist$4() {
  return hasRequiredDist$4 || (hasRequiredDist$4 = 1, function(exports) {
    Object.defineProperty(exports, "__esModule", {
      value: !0
    }), exports.Timestamp = exports.Targets = exports.Snapshot = exports.Signature = exports.Root = exports.Metadata = exports.Key = exports.TargetFile = exports.MetaFile = exports.ValueError = exports.MetadataKind = void 0;
    var base_1 = requireBase();
    Object.defineProperty(exports, "MetadataKind", {
      enumerable: !0,
      get: function() {
        return base_1.MetadataKind;
      }
    });
    var error_1 = requireError$5();
    Object.defineProperty(exports, "ValueError", {
      enumerable: !0,
      get: function() {
        return error_1.ValueError;
      }
    });
    var file_1 = requireFile();
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
    var key_1 = requireKey$1();
    Object.defineProperty(exports, "Key", {
      enumerable: !0,
      get: function() {
        return key_1.Key;
      }
    });
    var metadata_1 = function() {
      if (hasRequiredMetadata) return metadata;
      hasRequiredMetadata = 1;
      var __importDefault = metadata && metadata.__importDefault || function(mod) {
        return mod && mod.__esModule ? mod : {
          default: mod
        };
      };
      Object.defineProperty(metadata, "__esModule", {
        value: !0
      }), metadata.Metadata = void 0;
      const canonical_json_1 = requireLib$1(), util_1 = __importDefault(require$$0$2), base_1 = requireBase(), error_1 = requireError$5(), root_1 = requireRoot(), signature_1 = requireSignature(), snapshot_1 = requireSnapshot(), targets_1 = requireTargets(), timestamp_1 = requireTimestamp$2(), utils_1 = requireUtils();
      class Metadata {
        signed;
        signatures;
        unrecognizedFields;
        constructor(signed, signatures, unrecognizedFields) {
          this.signed = signed, this.signatures = signatures || {}, this.unrecognizedFields = unrecognizedFields || {};
        }
        sign(signer, append = !0) {
          const signature = signer(Buffer.from((0, canonical_json_1.canonicalize)(this.signed.toJSON())));
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

           default:
            throw new TypeError("invalid metadata type");
          }
          if (!role) throw new error_1.ValueError(`no delegation found for ${delegatedRole}`);
          const signingKeys = new Set;
          if (role.keyIDs.forEach(keyID => {
            const key = keys[keyID];
            if (key) try {
              key.verifySignature(delegatedMetadata), signingKeys.add(key.keyID);
            } catch (error) {}
          }), signingKeys.size < role.threshold) throw new error_1.UnsignedMetadataError(`${delegatedRole} was signed by ${signingKeys.size}/${role.threshold} keys`);
        }
        equals(other) {
          return other instanceof Metadata && this.signed.equals(other.signed) && util_1.default.isDeepStrictEqual(this.signatures, other.signatures) && util_1.default.isDeepStrictEqual(this.unrecognizedFields, other.unrecognizedFields);
        }
        toJSON() {
          const signatures = Object.values(this.signatures).map(signature => signature.toJSON());
          return {
            signatures: signatures,
            signed: this.signed.toJSON(),
            ...this.unrecognizedFields
          };
        }
        static fromJSON(type, data) {
          const {signed: signed, signatures: signatures, ...rest} = data;
          if (!utils_1.guard.isDefined(signed) || !utils_1.guard.isObject(signed)) throw new TypeError("signed is not defined");
          if (type !== signed._type) throw new error_1.ValueError(`expected '${type}', got ${signed._type}`);
          if (!utils_1.guard.isObjectArray(signatures)) throw new TypeError("signatures is not an array");
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

           default:
            throw new TypeError("invalid metadata type");
          }
          const sigMap = {};
          return signatures.forEach(sigData => {
            const sig = signature_1.Signature.fromJSON(sigData);
            if (sigMap[sig.keyID]) throw new error_1.ValueError(`multiple signatures found for keyid: ${sig.keyID}`);
            sigMap[sig.keyID] = sig;
          }), new Metadata(signedObj, sigMap, rest);
        }
      }
      return metadata.Metadata = Metadata, metadata;
    }();
    Object.defineProperty(exports, "Metadata", {
      enumerable: !0,
      get: function() {
        return metadata_1.Metadata;
      }
    });
    var root_1 = requireRoot();
    Object.defineProperty(exports, "Root", {
      enumerable: !0,
      get: function() {
        return root_1.Root;
      }
    });
    var signature_1 = requireSignature();
    Object.defineProperty(exports, "Signature", {
      enumerable: !0,
      get: function() {
        return signature_1.Signature;
      }
    });
    var snapshot_1 = requireSnapshot();
    Object.defineProperty(exports, "Snapshot", {
      enumerable: !0,
      get: function() {
        return snapshot_1.Snapshot;
      }
    });
    var targets_1 = requireTargets();
    Object.defineProperty(exports, "Targets", {
      enumerable: !0,
      get: function() {
        return targets_1.Targets;
      }
    });
    var timestamp_1 = requireTimestamp$2();
    Object.defineProperty(exports, "Timestamp", {
      enumerable: !0,
      get: function() {
        return timestamp_1.Timestamp;
      }
    });
  }(dist$2)), dist$2;
}

var ms, hasRequiredMs, common, hasRequiredCommon, hasRequiredBrowser, fetcher = {}, src = {
  exports: {}
}, browser = {
  exports: {}
};

function requireMs() {
  if (hasRequiredMs) return ms;
  hasRequiredMs = 1;
  var s = 1e3, m = 60 * s, h = 60 * m, d = 24 * h, w = 7 * d, y = 365.25 * d;
  function plural(ms, msAbs, n, name) {
    var isPlural = msAbs >= 1.5 * n;
    return Math.round(ms / n) + " " + name + (isPlural ? "s" : "");
  }
  return ms = function(val, options) {
    options = options || {};
    var type = typeof val;
    if ("string" === type && val.length > 0) return function(str) {
      if ((str = String(str)).length > 100) return;
      var match = /^(-?(?:\d+)?\.?\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)?$/i.exec(str);
      if (!match) return;
      var n = parseFloat(match[1]);
      switch ((match[2] || "ms").toLowerCase()) {
       case "years":
       case "year":
       case "yrs":
       case "yr":
       case "y":
        return n * y;

       case "weeks":
       case "week":
       case "w":
        return n * w;

       case "days":
       case "day":
       case "d":
        return n * d;

       case "hours":
       case "hour":
       case "hrs":
       case "hr":
       case "h":
        return n * h;

       case "minutes":
       case "minute":
       case "mins":
       case "min":
       case "m":
        return n * m;

       case "seconds":
       case "second":
       case "secs":
       case "sec":
       case "s":
        return n * s;

       case "milliseconds":
       case "millisecond":
       case "msecs":
       case "msec":
       case "ms":
        return n;

       default:
        return;
      }
    }(val);
    if ("number" === type && isFinite(val)) return options.long ? function(ms) {
      var msAbs = Math.abs(ms);
      if (msAbs >= d) return plural(ms, msAbs, d, "day");
      if (msAbs >= h) return plural(ms, msAbs, h, "hour");
      if (msAbs >= m) return plural(ms, msAbs, m, "minute");
      if (msAbs >= s) return plural(ms, msAbs, s, "second");
      return ms + " ms";
    }(val) : function(ms) {
      var msAbs = Math.abs(ms);
      if (msAbs >= d) return Math.round(ms / d) + "d";
      if (msAbs >= h) return Math.round(ms / h) + "h";
      if (msAbs >= m) return Math.round(ms / m) + "m";
      if (msAbs >= s) return Math.round(ms / s) + "s";
      return ms + "ms";
    }(val);
    throw new Error("val is not a non-empty string or a valid number. val=" + JSON.stringify(val));
  };
}

function requireCommon() {
  if (hasRequiredCommon) return common;
  return hasRequiredCommon = 1, common = function(env) {
    function createDebug(namespace) {
      let prevTime, namespacesCache, enabledCache, enableOverride = null;
      function debug(...args) {
        if (!debug.enabled) return;
        const self = debug, curr = Number(new Date), ms = curr - (prevTime || curr);
        self.diff = ms, self.prev = prevTime, self.curr = curr, prevTime = curr, args[0] = createDebug.coerce(args[0]), 
        "string" != typeof args[0] && args.unshift("%O");
        let index = 0;
        args[0] = args[0].replace(/%([a-zA-Z%])/g, (match, format) => {
          if ("%%" === match) return "%";
          index++;
          const formatter = createDebug.formatters[format];
          if ("function" == typeof formatter) {
            const val = args[index];
            match = formatter.call(self, val), args.splice(index, 1), index--;
          }
          return match;
        }), createDebug.formatArgs.call(self, args);
        (self.log || createDebug.log).apply(self, args);
      }
      return debug.namespace = namespace, debug.useColors = createDebug.useColors(), debug.color = createDebug.selectColor(namespace), 
      debug.extend = extend, debug.destroy = createDebug.destroy, Object.defineProperty(debug, "enabled", {
        enumerable: !0,
        configurable: !1,
        get: () => null !== enableOverride ? enableOverride : (namespacesCache !== createDebug.namespaces && (namespacesCache = createDebug.namespaces, 
        enabledCache = createDebug.enabled(namespace)), enabledCache),
        set: v => {
          enableOverride = v;
        }
      }), "function" == typeof createDebug.init && createDebug.init(debug), debug;
    }
    function extend(namespace, delimiter) {
      const newDebug = createDebug(this.namespace + (void 0 === delimiter ? ":" : delimiter) + namespace);
      return newDebug.log = this.log, newDebug;
    }
    function matchesTemplate(search, template) {
      let searchIndex = 0, templateIndex = 0, starIndex = -1, matchIndex = 0;
      for (;searchIndex < search.length; ) if (templateIndex < template.length && (template[templateIndex] === search[searchIndex] || "*" === template[templateIndex])) "*" === template[templateIndex] ? (starIndex = templateIndex, 
      matchIndex = searchIndex, templateIndex++) : (searchIndex++, templateIndex++); else {
        if (-1 === starIndex) return !1;
        templateIndex = starIndex + 1, matchIndex++, searchIndex = matchIndex;
      }
      for (;templateIndex < template.length && "*" === template[templateIndex]; ) templateIndex++;
      return templateIndex === template.length;
    }
    return createDebug.debug = createDebug, createDebug.default = createDebug, createDebug.coerce = function(val) {
      if (val instanceof Error) return val.stack || val.message;
      return val;
    }, createDebug.disable = function() {
      const namespaces = [ ...createDebug.names, ...createDebug.skips.map(namespace => "-" + namespace) ].join(",");
      return createDebug.enable(""), namespaces;
    }, createDebug.enable = function(namespaces) {
      createDebug.save(namespaces), createDebug.namespaces = namespaces, createDebug.names = [], 
      createDebug.skips = [];
      const split = ("string" == typeof namespaces ? namespaces : "").trim().replace(/\s+/g, ",").split(",").filter(Boolean);
      for (const ns of split) "-" === ns[0] ? createDebug.skips.push(ns.slice(1)) : createDebug.names.push(ns);
    }, createDebug.enabled = function(name) {
      for (const skip of createDebug.skips) if (matchesTemplate(name, skip)) return !1;
      for (const ns of createDebug.names) if (matchesTemplate(name, ns)) return !0;
      return !1;
    }, createDebug.humanize = requireMs(), createDebug.destroy = function() {
      console.warn("Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`.");
    }, Object.keys(env).forEach(key => {
      createDebug[key] = env[key];
    }), createDebug.names = [], createDebug.skips = [], createDebug.formatters = {}, 
    createDebug.selectColor = function(namespace) {
      let hash = 0;
      for (let i = 0; i < namespace.length; i++) hash = (hash << 5) - hash + namespace.charCodeAt(i), 
      hash |= 0;
      return createDebug.colors[Math.abs(hash) % createDebug.colors.length];
    }, createDebug.enable(createDebug.load()), createDebug;
  }, common;
}

var hasRequiredNode, hasRequiredSrc, node = {
  exports: {}
};

function requireNode() {
  return hasRequiredNode || (hasRequiredNode = 1, function(module, exports) {
    const tty = require$$0$3, util = require$$0$2;
    exports.init = function(debug) {
      debug.inspectOpts = {};
      const keys = Object.keys(exports.inspectOpts);
      for (let i = 0; i < keys.length; i++) debug.inspectOpts[keys[i]] = exports.inspectOpts[keys[i]];
    }, exports.log = function(...args) {
      return process.stderr.write(util.formatWithOptions(exports.inspectOpts, ...args) + "\n");
    }, exports.formatArgs = function(args) {
      const {namespace: name, useColors: useColors} = this;
      if (useColors) {
        const c = this.color, colorCode = "[3" + (c < 8 ? c : "8;5;" + c), prefix = `  ${colorCode};1m${name} [0m`;
        args[0] = prefix + args[0].split("\n").join("\n" + prefix), args.push(colorCode + "m+" + module.exports.humanize(this.diff) + "[0m");
      } else args[0] = function() {
        if (exports.inspectOpts.hideDate) return "";
        return (new Date).toISOString() + " ";
      }() + name + " " + args[0];
    }, exports.save = function(namespaces) {
      namespaces ? process.env.DEBUG = namespaces : delete process.env.DEBUG;
    }, exports.load = function() {
      return process.env.DEBUG;
    }, exports.useColors = function() {
      return "colors" in exports.inspectOpts ? Boolean(exports.inspectOpts.colors) : tty.isatty(process.stderr.fd);
    }, exports.destroy = util.deprecate(() => {}, "Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`."), 
    exports.colors = [ 6, 2, 3, 4, 5, 1 ];
    try {
      const supportsColor = require("supports-color");
      supportsColor && (supportsColor.stderr || supportsColor).level >= 2 && (exports.colors = [ 20, 21, 26, 27, 32, 33, 38, 39, 40, 41, 42, 43, 44, 45, 56, 57, 62, 63, 68, 69, 74, 75, 76, 77, 78, 79, 80, 81, 92, 93, 98, 99, 112, 113, 128, 129, 134, 135, 148, 149, 160, 161, 162, 163, 164, 165, 166, 167, 168, 169, 170, 171, 172, 173, 178, 179, 184, 185, 196, 197, 198, 199, 200, 201, 202, 203, 204, 205, 206, 207, 208, 209, 214, 215, 220, 221 ]);
    } catch (error) {}
    exports.inspectOpts = Object.keys(process.env).filter(key => /^debug_/i.test(key)).reduce((obj, key) => {
      const prop = key.substring(6).toLowerCase().replace(/_([a-z])/g, (_, k) => k.toUpperCase());
      let val = process.env[key];
      return val = !!/^(yes|on|true|enabled)$/i.test(val) || !/^(no|off|false|disabled)$/i.test(val) && ("null" === val ? null : Number(val)), 
      obj[prop] = val, obj;
    }, {}), module.exports = requireCommon()(exports);
    const {formatters: formatters} = module.exports;
    formatters.o = function(v) {
      return this.inspectOpts.colors = this.useColors, util.inspect(v, this.inspectOpts).split("\n").map(str => str.trim()).join(" ");
    }, formatters.O = function(v) {
      return this.inspectOpts.colors = this.useColors, util.inspect(v, this.inspectOpts);
    };
  }(node, node.exports)), node.exports;
}

function requireSrc() {
  return hasRequiredSrc || (hasRequiredSrc = 1, "undefined" == typeof process || "renderer" === process.type || !0 === process.browser || process.__nwjs ? src.exports = (hasRequiredBrowser || (hasRequiredBrowser = 1, 
  function(module, exports) {
    exports.formatArgs = function(args) {
      if (args[0] = (this.useColors ? "%c" : "") + this.namespace + (this.useColors ? " %c" : " ") + args[0] + (this.useColors ? "%c " : " ") + "+" + module.exports.humanize(this.diff), 
      !this.useColors) return;
      const c = "color: " + this.color;
      args.splice(1, 0, c, "color: inherit");
      let index = 0, lastC = 0;
      args[0].replace(/%[a-zA-Z%]/g, match => {
        "%%" !== match && (index++, "%c" === match && (lastC = index));
      }), args.splice(lastC, 0, c);
    }, exports.save = function(namespaces) {
      try {
        namespaces ? exports.storage.setItem("debug", namespaces) : exports.storage.removeItem("debug");
      } catch (error) {}
    }, exports.load = function() {
      let r;
      try {
        r = exports.storage.getItem("debug") || exports.storage.getItem("DEBUG");
      } catch (error) {}
      return !r && "undefined" != typeof process && "env" in process && (r = process.env.DEBUG), 
      r;
    }, exports.useColors = function() {
      if ("undefined" != typeof window && window.process && ("renderer" === window.process.type || window.process.__nwjs)) return !0;
      if ("undefined" != typeof navigator && navigator.userAgent && navigator.userAgent.toLowerCase().match(/(edge|trident)\/(\d+)/)) return !1;
      let m;
      return "undefined" != typeof document && document.documentElement && document.documentElement.style && document.documentElement.style.WebkitAppearance || "undefined" != typeof window && window.console && (window.console.firebug || window.console.exception && window.console.table) || "undefined" != typeof navigator && navigator.userAgent && (m = navigator.userAgent.toLowerCase().match(/firefox\/(\d+)/)) && parseInt(m[1], 10) >= 31 || "undefined" != typeof navigator && navigator.userAgent && navigator.userAgent.toLowerCase().match(/applewebkit\/(\d+)/);
    }, exports.storage = function() {
      try {
        return localStorage;
      } catch (error) {}
    }(), exports.destroy = (() => {
      let warned = !1;
      return () => {
        warned || (warned = !0, console.warn("Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`."));
      };
    })(), exports.colors = [ "#0000CC", "#0000FF", "#0033CC", "#0033FF", "#0066CC", "#0066FF", "#0099CC", "#0099FF", "#00CC00", "#00CC33", "#00CC66", "#00CC99", "#00CCCC", "#00CCFF", "#3300CC", "#3300FF", "#3333CC", "#3333FF", "#3366CC", "#3366FF", "#3399CC", "#3399FF", "#33CC00", "#33CC33", "#33CC66", "#33CC99", "#33CCCC", "#33CCFF", "#6600CC", "#6600FF", "#6633CC", "#6633FF", "#66CC00", "#66CC33", "#9900CC", "#9900FF", "#9933CC", "#9933FF", "#99CC00", "#99CC33", "#CC0000", "#CC0033", "#CC0066", "#CC0099", "#CC00CC", "#CC00FF", "#CC3300", "#CC3333", "#CC3366", "#CC3399", "#CC33CC", "#CC33FF", "#CC6600", "#CC6633", "#CC9900", "#CC9933", "#CCCC00", "#CCCC33", "#FF0000", "#FF0033", "#FF0066", "#FF0099", "#FF00CC", "#FF00FF", "#FF3300", "#FF3333", "#FF3366", "#FF3399", "#FF33CC", "#FF33FF", "#FF6600", "#FF6633", "#FF9900", "#FF9933", "#FFCC00", "#FFCC33" ], 
    exports.log = console.debug || console.log || (() => {}), module.exports = requireCommon()(exports);
    const {formatters: formatters} = module.exports;
    formatters.j = function(v) {
      try {
        return JSON.stringify(v);
      } catch (error) {
        return "[UnexpectedJSONParseError]: " + error.message;
      }
    };
  }(browser, browser.exports)), browser.exports) : src.exports = requireNode()), src.exports;
}

var hasRequiredError$4, error$4 = {};

function requireError$4() {
  if (hasRequiredError$4) return error$4;
  hasRequiredError$4 = 1, Object.defineProperty(error$4, "__esModule", {
    value: !0
  }), error$4.DownloadHTTPError = error$4.DownloadLengthMismatchError = error$4.DownloadError = error$4.ExpiredMetadataError = error$4.EqualVersionError = error$4.BadVersionError = error$4.RepositoryError = error$4.PersistError = error$4.RuntimeError = error$4.ValueError = void 0;
  class ValueError extends Error {}
  error$4.ValueError = ValueError;
  class RuntimeError extends Error {}
  error$4.RuntimeError = RuntimeError;
  class PersistError extends Error {}
  error$4.PersistError = PersistError;
  class RepositoryError extends Error {}
  error$4.RepositoryError = RepositoryError;
  class BadVersionError extends RepositoryError {}
  error$4.BadVersionError = BadVersionError;
  error$4.EqualVersionError = class extends BadVersionError {};
  error$4.ExpiredMetadataError = class extends RepositoryError {};
  class DownloadError extends Error {}
  error$4.DownloadError = DownloadError;
  error$4.DownloadLengthMismatchError = class extends DownloadError {};
  return error$4.DownloadHTTPError = class extends DownloadError {
    statusCode;
    constructor(message, statusCode) {
      super(message), this.statusCode = statusCode;
    }
  }, error$4;
}

var hasRequiredTmpfile, retry, hasRequiredRetry, lib, hasRequiredLib, hasRequiredFetcher, tmpfile = {};

function requireLib() {
  if (hasRequiredLib) return lib;
  hasRequiredLib = 1;
  const {RetryOperation: RetryOperation} = (hasRequiredRetry || (hasRequiredRetry = 1, 
  retry = {
    RetryOperation: class {
      #attempts=1;
      #cachedTimeouts=null;
      #errors=[];
      #fn=null;
      #maxRetryTime;
      #operationStart=null;
      #originalTimeouts;
      #timeouts;
      #timer=null;
      #unref;
      constructor(timeouts, options = {}) {
        this.#originalTimeouts = [ ...timeouts ], this.#timeouts = [ ...timeouts ], this.#unref = options.unref, 
        this.#maxRetryTime = options.maxRetryTime || 1 / 0, options.forever && (this.#cachedTimeouts = [ ...this.#timeouts ]);
      }
      get timeouts() {
        return [ ...this.#timeouts ];
      }
      get errors() {
        return [ ...this.#errors ];
      }
      get attempts() {
        return this.#attempts;
      }
      get mainError() {
        let mainError = null;
        if (this.#errors.length) {
          let mainErrorCount = 0;
          const counts = {};
          for (let i = 0; i < this.#errors.length; i++) {
            const error = this.#errors[i], {message: message} = error;
            counts[message] || (counts[message] = 0), counts[message]++, counts[message] >= mainErrorCount && (mainError = error, 
            mainErrorCount = counts[message]);
          }
        }
        return mainError;
      }
      reset() {
        this.#attempts = 1, this.#timeouts = [ ...this.#originalTimeouts ];
      }
      stop() {
        this.#timer && clearTimeout(this.#timer), this.#timeouts = [], this.#cachedTimeouts = null;
      }
      retry(err) {
        if (this.#errors.push(err), (new Date).getTime() - this.#operationStart >= this.#maxRetryTime) return this.#errors.unshift(new Error("RetryOperation timeout occurred")), 
        !1;
        let timeout = this.#timeouts.shift();
        if (void 0 === timeout) {
          if (!this.#cachedTimeouts) return !1;
          this.#errors.pop(), timeout = this.#cachedTimeouts.at(-1);
        }
        return this.#timer = setTimeout(() => {
          this.#attempts++, this.#fn(this.#attempts);
        }, timeout), this.#unref && this.#timer.unref(), !0;
      }
      attempt(fn) {
        this.#fn = fn, this.#operationStart = (new Date).getTime(), this.#fn(this.#attempts);
      }
    }
  }), retry), createTimeout = (attempt, opts) => Math.min(Math.round((1 + (opts.randomize ? Math.random() : 0)) * Math.max(opts.minTimeout, 1) * Math.pow(opts.factor, attempt)), opts.maxTimeout);
  return lib = {
    promiseRetry: async (fn, options = {}) => {
      let timeouts = [];
      if (options instanceof Array) timeouts = [ ...options ]; else {
        options.retries === 1 / 0 && (options.forever = !0, delete options.retries);
        const opts = {
          retries: 10,
          factor: 2,
          minTimeout: 1e3,
          maxTimeout: 1 / 0,
          randomize: !1,
          ...options
        };
        if (opts.minTimeout > opts.maxTimeout) throw new Error("minTimeout is greater than maxTimeout");
        if (opts.retries) {
          for (let i = 0; i < opts.retries; i++) timeouts.push(createTimeout(i, opts));
          timeouts.sort((a, b) => a - b);
        } else options.forever && timeouts.push(createTimeout(0, opts));
      }
      const operation = new RetryOperation(timeouts, {
        forever: options.forever,
        unref: options.unref,
        maxRetryTime: options.maxRetryTime
      });
      return new Promise(function(resolve, reject) {
        operation.attempt(async number => {
          try {
            const result = await fn(err => {
              throw Object.assign(new Error("Retrying"), {
                code: "EPROMISERETRY",
                retried: err
              });
            }, number, operation);
            return resolve(result);
          } catch (err) {
            if (!(err => "EPROMISERETRY" === err?.code && Object.hasOwn(err, "retried"))(err)) return reject(err);
            if (!operation.retry(err.retried || new Error)) return reject(err.retried);
          }
        });
      });
    }
  };
}

function requireFetcher() {
  if (hasRequiredFetcher) return fetcher;
  hasRequiredFetcher = 1;
  var __importDefault = fetcher && fetcher.__importDefault || function(mod) {
    return mod && mod.__esModule ? mod : {
      default: mod
    };
  };
  Object.defineProperty(fetcher, "__esModule", {
    value: !0
  }), fetcher.DefaultFetcher = fetcher.BaseFetcher = void 0;
  const debug_1 = __importDefault(requireSrc()), fs_1 = __importDefault(require$$0$5), util_1 = __importDefault(require$$0$2), error_1 = requireError$4(), tmpfile_1 = function() {
    if (hasRequiredTmpfile) return tmpfile;
    hasRequiredTmpfile = 1;
    var __importDefault = tmpfile && tmpfile.__importDefault || function(mod) {
      return mod && mod.__esModule ? mod : {
        default: mod
      };
    };
    Object.defineProperty(tmpfile, "__esModule", {
      value: !0
    }), tmpfile.withTempFile = void 0;
    const promises_1 = __importDefault(require$$0$4), os_1 = __importDefault(require$$0), path_1 = __importDefault(require$$1);
    tmpfile.withTempFile = async handler => withTempDir(async dir => handler(path_1.default.join(dir, "tempfile")));
    const withTempDir = async handler => {
      const tmpDir = await promises_1.default.realpath(os_1.default.tmpdir()), dir = await promises_1.default.mkdtemp(tmpDir + path_1.default.sep);
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
    return tmpfile;
  }(), promise_retry_1 = requireLib(), log = (0, debug_1.default)("tuf:fetch"), USER_AGENT_HEADER = "User-Agent";
  class BaseFetcher {
    async downloadFile(url, maxLength, handler) {
      return (0, tmpfile_1.withTempFile)(async tmpFile => {
        const reader = await this.fetch(url);
        let numberOfBytesReceived = 0;
        const fileStream = fs_1.default.createWriteStream(tmpFile), streamReader = reader.getReader();
        try {
          for (;;) {
            const {done: done, value: chunk} = await streamReader.read();
            if (done) break;
            if (numberOfBytesReceived += chunk.length, numberOfBytesReceived > maxLength) throw new error_1.DownloadLengthMismatchError("Max length reached");
            await writeBufferToStream(fileStream, Buffer.from(chunk));
          }
        } finally {
          streamReader.releaseLock(), await util_1.default.promisify(fileStream.close).bind(fileStream)();
        }
        return handler(tmpFile);
      });
    }
    async downloadBytes(url, maxLength) {
      return this.downloadFile(url, maxLength, async file => {
        const stream = fs_1.default.createReadStream(file), chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        return Buffer.concat(chunks);
      });
    }
  }
  fetcher.BaseFetcher = BaseFetcher;
  fetcher.DefaultFetcher = class extends BaseFetcher {
    userAgent;
    timeout;
    retry;
    constructor(options = {}) {
      if (super(), this.userAgent = options.userAgent, this.timeout = options.timeout, 
      !0 === options.retry) this.retry = {
        forever: !0
      }; else if (!1 === options.retry || void 0 === options.retry) this.retry = void 0; else if ("number" == typeof options.retry) {
        if (options.retry < 0) throw new Error("Retry count must be non-negative number");
        this.retry = {
          retries: options.retry
        };
      } else this.retry = options.retry;
    }
    async fetch(url) {
      const shouldRetry = void 0 !== this.retry;
      return (0, promise_retry_1.promiseRetry)(async (retry, number) => {
        let response;
        log("GET %s (attempt %d)", url, number);
        try {
          response = await fetch(url, {
            headers: {
              [USER_AGENT_HEADER]: this.userAgent || ""
            },
            signal: this.timeout ? AbortSignal.timeout(this.timeout) : void 0
          });
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          if (shouldRetry) return retry(err);
          throw err;
        }
        if (!response.ok || !response.body) {
          const err = new error_1.DownloadHTTPError("Failed to download", response.status);
          if (shouldRetry && response.status >= 500 && response.status < 600) return retry(err);
          throw err;
        }
        return response.body;
      }, this.retry);
    }
  };
  const writeBufferToStream = async (stream, buffer) => new Promise((resolve, reject) => {
    stream.write(buffer, err => {
      err && reject(err), resolve(!0);
    });
  });
  return fetcher;
}

var hasRequiredConfig, updater = {}, require$$4$1 = {
  version: "6.0.0"
}, config = {};

var hasRequiredStore, store = {};

var hasRequiredUrl, hasRequiredUpdater, hasRequiredDist$3, url = {};

function requireUrl() {
  if (hasRequiredUrl) return url;
  hasRequiredUrl = 1, Object.defineProperty(url, "__esModule", {
    value: !0
  }), url.join = function(base, path) {
    return new url_1.URL(function(path) {
      return path.endsWith("/") ? path : path + "/";
    }(base) + function(path) {
      return path.startsWith("/") ? path.slice(1) : path;
    }(path)).toString();
  };
  const url_1 = require$$0$6;
  return url;
}

function requireUpdater() {
  if (hasRequiredUpdater) return updater;
  hasRequiredUpdater = 1;
  var ownKeys, __createBinding = updater && updater.__createBinding || (Object.create ? function(o, m, k, k2) {
    void 0 === k2 && (k2 = k);
    var desc = Object.getOwnPropertyDescriptor(m, k);
    desc && !("get" in desc ? !m.__esModule : desc.writable || desc.configurable) || (desc = {
      enumerable: !0,
      get: function() {
        return m[k];
      }
    }), Object.defineProperty(o, k2, desc);
  } : function(o, m, k, k2) {
    void 0 === k2 && (k2 = k), o[k2] = m[k];
  }), __setModuleDefault = updater && updater.__setModuleDefault || (Object.create ? function(o, v) {
    Object.defineProperty(o, "default", {
      enumerable: !0,
      value: v
    });
  } : function(o, v) {
    o.default = v;
  }), __importStar = updater && updater.__importStar || (ownKeys = function(o) {
    return ownKeys = Object.getOwnPropertyNames || function(o) {
      var ar = [];
      for (var k in o) Object.prototype.hasOwnProperty.call(o, k) && (ar[ar.length] = k);
      return ar;
    }, ownKeys(o);
  }, function(mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (null != mod) for (var k = ownKeys(mod), i = 0; i < k.length; i++) "default" !== k[i] && __createBinding(result, mod, k[i]);
    return __setModuleDefault(result, mod), result;
  }), __importDefault = updater && updater.__importDefault || function(mod) {
    return mod && mod.__esModule ? mod : {
      default: mod
    };
  };
  Object.defineProperty(updater, "__esModule", {
    value: !0
  }), updater.Updater = void 0;
  const models_1 = requireDist$4(), debug_1 = __importDefault(requireSrc()), fs = __importStar(require$$0$5), path = __importStar(require$$1), package_json_1 = require$$4$1, config_1 = (hasRequiredConfig || (hasRequiredConfig = 1, 
  Object.defineProperty(config, "__esModule", {
    value: !0
  }), config.defaultConfig = void 0, config.defaultConfig = {
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
  }), config), error_1 = requireError$4(), fetcher_1 = requireFetcher(), store_1 = function() {
    if (hasRequiredStore) return store;
    hasRequiredStore = 1, Object.defineProperty(store, "__esModule", {
      value: !0
    }), store.TrustedMetadataStore = void 0;
    const models_1 = requireDist$4(), error_1 = requireError$4();
    return store.TrustedMetadataStore = class {
      trustedSet={};
      referenceTime;
      constructor(rootData) {
        this.referenceTime = new Date, this.loadTrustedRoot(rootData);
      }
      get root() {
        if (!this.trustedSet.root) throw new ReferenceError("No trusted root metadata");
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
        const data = JSON.parse(bytesBuffer.toString("utf8")), newRoot = models_1.Metadata.fromJSON(models_1.MetadataKind.Root, data);
        if (newRoot.signed.type != models_1.MetadataKind.Root) throw new error_1.RepositoryError(`Expected 'root', got ${newRoot.signed.type}`);
        if (this.root.verifyDelegate(models_1.MetadataKind.Root, newRoot), newRoot.signed.version != this.root.signed.version + 1) throw new error_1.BadVersionError(`Expected version ${this.root.signed.version + 1}, got ${newRoot.signed.version}`);
        return newRoot.verifyDelegate(models_1.MetadataKind.Root, newRoot), this.trustedSet.root = newRoot, 
        newRoot;
      }
      updateTimestamp(bytesBuffer) {
        if (this.snapshot) throw new error_1.RuntimeError("Cannot update timestamp after snapshot");
        if (this.root.signed.isExpired(this.referenceTime)) throw new error_1.ExpiredMetadataError("Final root.json is expired");
        const data = JSON.parse(bytesBuffer.toString("utf8")), newTimestamp = models_1.Metadata.fromJSON(models_1.MetadataKind.Timestamp, data);
        if (newTimestamp.signed.type != models_1.MetadataKind.Timestamp) throw new error_1.RepositoryError(`Expected 'timestamp', got ${newTimestamp.signed.type}`);
        if (this.root.verifyDelegate(models_1.MetadataKind.Timestamp, newTimestamp), this.timestamp) {
          if (newTimestamp.signed.version < this.timestamp.signed.version) throw new error_1.BadVersionError(`New timestamp version ${newTimestamp.signed.version} is less than current version ${this.timestamp.signed.version}`);
          if (newTimestamp.signed.version === this.timestamp.signed.version) throw new error_1.EqualVersionError(`New timestamp version ${newTimestamp.signed.version} is equal to current version ${this.timestamp.signed.version}`);
          const snapshotMeta = this.timestamp.signed.snapshotMeta, newSnapshotMeta = newTimestamp.signed.snapshotMeta;
          if (newSnapshotMeta.version < snapshotMeta.version) throw new error_1.BadVersionError(`New snapshot version ${newSnapshotMeta.version} is less than current version ${snapshotMeta.version}`);
        }
        return this.trustedSet.timestamp = newTimestamp, this.checkFinalTimestamp(), newTimestamp;
      }
      updateSnapshot(bytesBuffer, trusted = !1) {
        if (!this.timestamp) throw new error_1.RuntimeError("Cannot update snapshot before timestamp");
        if (this.targets) throw new error_1.RuntimeError("Cannot update snapshot after targets");
        this.checkFinalTimestamp();
        const snapshotMeta = this.timestamp.signed.snapshotMeta;
        trusted || snapshotMeta.verify(bytesBuffer);
        const data = JSON.parse(bytesBuffer.toString("utf8")), newSnapshot = models_1.Metadata.fromJSON(models_1.MetadataKind.Snapshot, data);
        if (newSnapshot.signed.type != models_1.MetadataKind.Snapshot) throw new error_1.RepositoryError(`Expected 'snapshot', got ${newSnapshot.signed.type}`);
        return this.root.verifyDelegate(models_1.MetadataKind.Snapshot, newSnapshot), this.snapshot && Object.entries(this.snapshot.signed.meta).forEach(([fileName, fileInfo]) => {
          const newFileInfo = newSnapshot.signed.meta[fileName];
          if (!newFileInfo) throw new error_1.RepositoryError(`Missing file ${fileName} in new snapshot`);
          if (newFileInfo.version < fileInfo.version) throw new error_1.BadVersionError(`New version ${newFileInfo.version} of ${fileName} is less than current version ${fileInfo.version}`);
        }), this.trustedSet.snapshot = newSnapshot, this.checkFinalSnapsnot(), newSnapshot;
      }
      updateDelegatedTargets(bytesBuffer, roleName, delegatorName) {
        if (!this.snapshot) throw new error_1.RuntimeError("Cannot update delegated targets before snapshot");
        this.checkFinalSnapsnot();
        const delegator = this.trustedSet[delegatorName];
        if (!delegator) throw new error_1.RuntimeError(`No trusted ${delegatorName} metadata`);
        const meta = this.snapshot.signed.meta?.[`${roleName}.json`];
        if (!meta) throw new error_1.RepositoryError(`Missing ${roleName}.json in snapshot`);
        meta.verify(bytesBuffer);
        const data = JSON.parse(bytesBuffer.toString("utf8")), newDelegate = models_1.Metadata.fromJSON(models_1.MetadataKind.Targets, data);
        if (newDelegate.signed.type != models_1.MetadataKind.Targets) throw new error_1.RepositoryError(`Expected 'targets', got ${newDelegate.signed.type}`);
        delegator.verifyDelegate(roleName, newDelegate);
        const version = newDelegate.signed.version;
        if (version != meta.version) throw new error_1.BadVersionError(`Version ${version} of ${roleName} does not match snapshot version ${meta.version}`);
        if (newDelegate.signed.isExpired(this.referenceTime)) throw new error_1.ExpiredMetadataError(`${roleName}.json is expired`);
        this.trustedSet[roleName] = newDelegate;
      }
      loadTrustedRoot(bytesBuffer) {
        const data = JSON.parse(bytesBuffer.toString("utf8")), root = models_1.Metadata.fromJSON(models_1.MetadataKind.Root, data);
        if (root.signed.type != models_1.MetadataKind.Root) throw new error_1.RepositoryError(`Expected 'root', got ${root.signed.type}`);
        root.verifyDelegate(models_1.MetadataKind.Root, root), this.trustedSet.root = root;
      }
      checkFinalTimestamp() {
        if (!this.timestamp) throw new ReferenceError("No trusted timestamp metadata");
        if (this.timestamp.signed.isExpired(this.referenceTime)) throw new error_1.ExpiredMetadataError("Final timestamp.json is expired");
      }
      checkFinalSnapsnot() {
        if (!this.snapshot) throw new ReferenceError("No trusted snapshot metadata");
        if (!this.timestamp) throw new ReferenceError("No trusted timestamp metadata");
        if (this.snapshot.signed.isExpired(this.referenceTime)) throw new error_1.ExpiredMetadataError("snapshot.json is expired");
        const snapshotMeta = this.timestamp.signed.snapshotMeta;
        if (this.snapshot.signed.version !== snapshotMeta.version) throw new error_1.BadVersionError("Snapshot version doesn't match timestamp");
      }
    }, store;
  }(), url = __importStar(requireUrl()), log = (0, debug_1.default)("tuf:cache");
  return updater.Updater = class {
    dir;
    metadataBaseUrl;
    targetDir;
    targetBaseUrl;
    forceCache;
    trustedSet;
    config;
    fetcher;
    constructor(options) {
      const {metadataDir: metadataDir, metadataBaseUrl: metadataBaseUrl, targetDir: targetDir, targetBaseUrl: targetBaseUrl, fetcher: fetcher, config: config} = options;
      this.dir = metadataDir, this.metadataBaseUrl = metadataBaseUrl, this.targetDir = targetDir, 
      this.targetBaseUrl = targetBaseUrl, this.forceCache = options.forceCache ?? !1;
      const data = this.loadLocalMetadata(models_1.MetadataKind.Root);
      this.trustedSet = new store_1.TrustedMetadataStore(data), this.config = {
        ...config_1.defaultConfig,
        ...config
      };
      const userAgent = config?.userAgent ? `${config.userAgent} tuf-js/${package_json_1.version}` : `tuf-js/${package_json_1.version}`;
      this.fetcher = fetcher || new fetcher_1.DefaultFetcher({
        userAgent: userAgent,
        timeout: this.config.fetchTimeout,
        retry: this.config.fetchRetries ?? this.config.fetchRetry
      });
    }
    async refresh() {
      if (this.forceCache) try {
        await this.loadTimestamp({
          checkRemote: !1
        });
      } catch (error) {
        await this.loadRoot(), await this.loadTimestamp();
      } else await this.loadRoot(), await this.loadTimestamp();
      await this.loadSnapshot(), await this.loadTargets(models_1.MetadataKind.Targets, models_1.MetadataKind.Root);
    }
    async getTargetInfo(targetPath) {
      return this.trustedSet.targets || await this.refresh(), this.preorderDepthFirstWalk(targetPath);
    }
    async downloadTarget(targetInfo, filePath, targetBaseUrl) {
      const targetPath = filePath || this.generateTargetPath(targetInfo);
      if (!targetBaseUrl) {
        if (!this.targetBaseUrl) throw new error_1.ValueError("Target base URL not set");
        targetBaseUrl = this.targetBaseUrl;
      }
      let targetFilePath = targetInfo.path;
      if (this.trustedSet.root.signed.consistentSnapshot && this.config.prefixTargetsWithHash) {
        const hashes = Object.values(targetInfo.hashes), {dir: dir, base: base} = path.parse(targetFilePath), filename = `${hashes[0]}.${base}`;
        targetFilePath = dir ? `${dir}/${filename}` : filename;
      }
      const targetUrl = url.join(targetBaseUrl, targetFilePath);
      return await this.fetcher.downloadFile(targetUrl, targetInfo.length, async fileName => {
        await targetInfo.verify(fs.createReadStream(fileName)), log("WRITE %s", targetPath), 
        fs.copyFileSync(fileName, targetPath);
      }), targetPath;
    }
    async findCachedTarget(targetInfo, filePath) {
      filePath || (filePath = this.generateTargetPath(targetInfo));
      try {
        if (fs.existsSync(filePath)) return await targetInfo.verify(fs.createReadStream(filePath)), 
        filePath;
      } catch (error) {
        return;
      }
    }
    loadLocalMetadata(fileName) {
      const filePath = path.join(this.dir, `${fileName}.json`);
      return log("READ %s", filePath), fs.readFileSync(filePath);
    }
    async loadRoot() {
      const lowerBound = this.trustedSet.root.signed.version + 1, upperBound = lowerBound + this.config.maxRootRotations;
      for (let version = lowerBound; version < upperBound; version++) {
        const rootUrl = url.join(this.metadataBaseUrl, `${version}.root.json`);
        try {
          const bytesData = await this.fetcher.downloadBytes(rootUrl, this.config.rootMaxLength);
          this.trustedSet.updateRoot(bytesData), this.persistMetadata(models_1.MetadataKind.Root, bytesData);
        } catch (error) {
          if (error instanceof error_1.DownloadHTTPError && [ 403, 404 ].includes(error.statusCode)) break;
          throw error;
        }
      }
    }
    async loadTimestamp({checkRemote: checkRemote} = {
      checkRemote: !0
    }) {
      try {
        const data = this.loadLocalMetadata(models_1.MetadataKind.Timestamp);
        if (this.trustedSet.updateTimestamp(data), !checkRemote) return;
      } catch (error) {}
      const timestampUrl = url.join(this.metadataBaseUrl, "timestamp.json"), bytesData = await this.fetcher.downloadBytes(timestampUrl, this.config.timestampMaxLength);
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
        const data = this.loadLocalMetadata(models_1.MetadataKind.Snapshot);
        this.trustedSet.updateSnapshot(data, !0);
      } catch (error) {
        if (!this.trustedSet.timestamp) throw new ReferenceError("No timestamp metadata", {
          cause: error
        });
        const snapshotMeta = this.trustedSet.timestamp.signed.snapshotMeta, maxLength = snapshotMeta.length || this.config.snapshotMaxLength, version = this.trustedSet.root.signed.consistentSnapshot ? snapshotMeta.version : void 0, snapshotUrl = url.join(this.metadataBaseUrl, version ? `${version}.snapshot.json` : "snapshot.json");
        try {
          const bytesData = await this.fetcher.downloadBytes(snapshotUrl, maxLength);
          this.trustedSet.updateSnapshot(bytesData), this.persistMetadata(models_1.MetadataKind.Snapshot, bytesData);
        } catch (error) {
          throw new error_1.RuntimeError(`Unable to load snapshot metadata error ${error}`);
        }
      }
    }
    async loadTargets(role, parentRole) {
      if (this.trustedSet.getRole(role)) return this.trustedSet.getRole(role);
      try {
        const buffer = this.loadLocalMetadata(role);
        this.trustedSet.updateDelegatedTargets(buffer, role, parentRole);
      } catch (error) {
        if (!this.trustedSet.snapshot) throw new ReferenceError("No snapshot metadata", {
          cause: error
        });
        const metaInfo = this.trustedSet.snapshot.signed.meta[`${role}.json`], maxLength = metaInfo.length || this.config.targetsMaxLength, version = this.trustedSet.root.signed.consistentSnapshot ? metaInfo.version : void 0, encodedRole = encodeURIComponent(role), metadataUrl = url.join(this.metadataBaseUrl, version ? `${version}.${encodedRole}.json` : `${encodedRole}.json`);
        try {
          const bytesData = await this.fetcher.downloadBytes(metadataUrl, maxLength);
          this.trustedSet.updateDelegatedTargets(bytesData, role, parentRole), this.persistMetadata(role, bytesData);
        } catch (error) {
          throw new error_1.RuntimeError(`Unable to load targets error ${error}`);
        }
      }
      return this.trustedSet.getRole(role);
    }
    async preorderDepthFirstWalk(targetPath) {
      const delegationsToVisit = [ {
        roleName: models_1.MetadataKind.Targets,
        parentRoleName: models_1.MetadataKind.Root
      } ], visitedRoleNames = new Set;
      for (;visitedRoleNames.size <= this.config.maxDelegations && delegationsToVisit.length > 0; ) {
        const {roleName: roleName, parentRoleName: parentRoleName} = delegationsToVisit.pop();
        if (visitedRoleNames.has(roleName)) continue;
        const targets = (await this.loadTargets(roleName, parentRoleName))?.signed;
        if (!targets) continue;
        const target = targets.targets?.[targetPath];
        if (target) return target;
        if (visitedRoleNames.add(roleName), targets.delegations) {
          const childRolesToVisit = [], rolesForTarget = targets.delegations.rolesForTarget(targetPath);
          for (const {role: childName, terminating: terminating} of rolesForTarget) if (childRolesToVisit.push({
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
      const filePath = encodeURIComponent(targetInfo.path);
      return path.join(this.targetDir, filePath);
    }
    persistMetadata(metaDataName, bytesData) {
      const encodedName = encodeURIComponent(metaDataName);
      try {
        const filePath = path.join(this.dir, `${encodedName}.json`);
        log("WRITE %s", filePath), fs.writeFileSync(filePath, bytesData.toString("utf8"));
      } catch (error) {
        throw new error_1.PersistError(`Failed to persist metadata ${encodedName} error: ${error}`);
      }
    }
  }, updater;
}

var hasRequiredError$3, hasRequiredTarget, require$$4 = {
  name: "@sigstore/tuf",
  version: "5.0.0"
}, target = {}, error$3 = {};

function requireError$3() {
  if (hasRequiredError$3) return error$3;
  hasRequiredError$3 = 1, Object.defineProperty(error$3, "__esModule", {
    value: !0
  }), error$3.TUFError = void 0;
  class TUFError extends Error {
    code;
    cause;
    constructor({code: code, message: message, cause: cause}) {
      super(message), this.code = code, this.cause = cause, this.name = this.constructor.name;
    }
  }
  return error$3.TUFError = TUFError, error$3;
}

function requireTarget() {
  if (hasRequiredTarget) return target;
  hasRequiredTarget = 1;
  var __importDefault = target && target.__importDefault || function(mod) {
    return mod && mod.__esModule ? mod : {
      default: mod
    };
  };
  Object.defineProperty(target, "__esModule", {
    value: !0
  }), target.readTarget = async function(tuf, targetPath) {
    const path = await async function(tuf, target) {
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
    }(tuf, targetPath);
    return new Promise((resolve, reject) => {
      fs_1.default.readFile(path, "utf-8", (err, data) => {
        err ? reject(new error_1.TUFError({
          code: "TUF_READ_TARGET_ERROR",
          message: `error reading target ${path}`,
          cause: err
        })) : resolve(data);
      });
    });
  };
  const fs_1 = __importDefault(require$$0$5), error_1 = requireError$3();
  return target;
}

var hasRequiredClient, hasRequiredDist$2, require$$6 = {
  "https://tuf-repo-cdn.sigstore.dev": {
    "root.json": "ewogInNpZ25hdHVyZXMiOiBbCiAgewogICAia2V5aWQiOiAiZTcxYTU0ZDU0MzgzNWJhODZhZGFkOTQ2MDM3OWM3NjQxZmI4NzI2ZDE2NGVhNzY2ODAxYTFjNTIyYWJhN2VhMiIsCiAgICJzaWciOiAiMzA0NTAyMjEwMGVhMmYzNzRmNDA5ODEwZTJkYjk1MDc0OWQ5Y2ZlZDA5YTE1YjZhNWUyNWYzZDVmZmQwNzk5NDU5ZDdiZWUxNjcwMjIwMjhkM2FjZGRlNmRiZDUwMzRjZmFkMjIyZDMxYjQxMDkwZWUyMTg5NGUyYzQ2Y2I4OTc0MTk4YWIwMzc3ZGI0NCIKICB9LAogIHsKICAgImtleWlkIjogIjIyZjRjYWVjNmQ4ZTZmOTU1NWFmNjZiM2Q0YzNjYjA2YTNiYjIzZmRjN2UzOWM5MTZjNjFmNDYyZTZmNTJiMDYiLAogICAic2lnIjogIjMwNDQwMjIwN2ViYjI0ZTMyMzdlNDcwNjkxZDc4NzU5MDNhNzc1NGQwZWYyYWU3ZTdiNTAyNGE3ODg4YzlhMzhhNTJkZWVjZDAyMjA2ZWQ1YWQxYzZmNGZhYjQ2OTk1ODQzYWI2YjIzZjk0MjBjNWE0Y2Y2Y2UxY2IyY2IyYTZmYzJlODdlMmVmM2UxIgogIH0sCiAgewogICAia2V5aWQiOiAiNjE2NDM4MzgxMjViNDQwYjQwZGI2OTQyZjVjYjVhMzFjMGRjMDQzNjgzMTZlYjJhYWE1OGI5NTkwNGE1ODIyMiIsCiAgICJzaWciOiAiMzA0NjAyMjEwMDg5ZDlkZmQ4ZTEwNmNjOTU4MDg4YTRkYTNjOGNmNzI1NGFiNmY2NWE5NjQ3ZDM3YWRhNzMwZWY0NzYzYzUxNjMwMjIxMDBkODgyZWU3NDQ2MTViZTc5ODYxZTIxNGUxZWViOWUxZWRkZjZhMWUyMDNhMjAxYjRjNWQwM2Y1MjI0ZDcxZDE2IgogIH0sCiAgewogICAia2V5aWQiOiAiYTY4N2U1YmY0ZmFiODJiMGVlNThkNDZlMDVjOTUzNTE0NWEyYzlhZmI0NThmNDNkNDJiNDVjYTBmZGNlMmE3MCIsCiAgICJzaWciOiAiMzA0NTAyMjEwMDg4YmQ0Yjg4ZTgzZjU4NmNlNTY4ZDI3ZDA0MjE0YzRhYjNmZDE4OTQxNzhlZjAxNTMwM2Q1NmFmYTkzOTIwNTMwMjIwNTUzOGViYWI5Mzg3NmFiYjkwNzVhZDc3MTE0YmZmMjhhMGQ3OWE3Y2MyMjliNTM0YTBjNWNlZDU1MjZiNDhlNyIKICB9LAogIHsKICAgImtleWlkIjogIjE4M2U2NGYzNzY3MGRjMTNjYTBkMjg5OTVhMzA1M2YzNzQwOTU0ZGRjZTQ0MzIxYTQxZTQ2NTM0Y2Y0NGU2MzIiLAogICAic2lnIjogIjMwNDUwMjIxMDBmMzViMDdlOTM4ZDQ5NDljYWY4MmU2OWU4NmNjOWRiM2I2OWI2ZGJjNjc0MGMxZjM0M2QwNjg5M2Y5OTZmYmViMDIyMDAxZTg0N2Q4MTYyNTlhOTZhNDllNDI3NzlhMjM1MGRhYjk3YjcxYzhhZTdlMjZiMjM4MGM2ZmE3ZjU4MTMxYjMiCiAgfQogXSwKICJzaWduZWQiOiB7CiAgIl90eXBlIjogInJvb3QiLAogICJjb25zaXN0ZW50X3NuYXBzaG90IjogdHJ1ZSwKICAiZXhwaXJlcyI6ICIyMDI2LTExLTIwVDEzOjU4OjE4WiIsCiAgImtleXMiOiB7CiAgICIwYzg3NDMyYzNiZjA5ZmQ5OTE4OWZkYzMyZmE1ZWFlZGY0ZTRhNWZhYzdiYWI3M2ZhMDRhMmUwZmM2NGFmNmY1IjogewogICAgImtleWlkX2hhc2hfYWxnb3JpdGhtcyI6IFsKICAgICAic2hhMjU2IiwKICAgICAic2hhNTEyIgogICAgXSwKICAgICJrZXl0eXBlIjogImVjZHNhIiwKICAgICJrZXl2YWwiOiB7CiAgICAgInB1YmxpYyI6ICItLS0tLUJFR0lOIFBVQkxJQyBLRVktLS0tLVxuTUZrd0V3WUhLb1pJemowQ0FRWUlLb1pJemowREFRY0RRZ0FFV1JpR3I1K2orM0o1U3NIK1p0cjVuRTJIMndPN1xuQlYrbk8zczkzZ0xjYTE4cVRPekhZMW9XeUFHRHlrTVNzR1RVQlN0OUQrQW4wS2ZLc0QybWZTTTQyUT09XG4tLS0tLUVORCBQVUJMSUMgS0VZLS0tLS1cbiIKICAgIH0sCiAgICAic2NoZW1lIjogImVjZHNhLXNoYTItbmlzdHAyNTYiLAogICAgIngtdHVmLW9uLWNpLW9ubGluZS11cmkiOiAiZ2Nwa21zOnByb2plY3RzL3NpZ3N0b3JlLXJvb3Qtc2lnbmluZy9sb2NhdGlvbnMvZ2xvYmFsL2tleVJpbmdzL3Jvb3QvY3J5cHRvS2V5cy90aW1lc3RhbXAvY3J5cHRvS2V5VmVyc2lvbnMvMSIKICAgfSwKICAgIjE4M2U2NGYzNzY3MGRjMTNjYTBkMjg5OTVhMzA1M2YzNzQwOTU0ZGRjZTQ0MzIxYTQxZTQ2NTM0Y2Y0NGU2MzIiOiB7CiAgICAia2V5dHlwZSI6ICJlY2RzYSIsCiAgICAia2V5dmFsIjogewogICAgICJwdWJsaWMiOiAiLS0tLS1CRUdJTiBQVUJMSUMgS0VZLS0tLS1cbk1Ga3dFd1lIS29aSXpqMENBUVlJS29aSXpqMERBUWNEUWdBRU14cFBPSkNJWjVvdEc0MTA2ZkdKc2VFUWkzVjlcbnBrTVlRNHV5VjlUajFNN1dIWEl5TEcramtmdnVHMGdsUTFKWmJSWlpCVjNnQVI0c29qZEdISVNlb3c9PVxuLS0tLS1FTkQgUFVCTElDIEtFWS0tLS0tXG4iCiAgICB9LAogICAgInNjaGVtZSI6ICJlY2RzYS1zaGEyLW5pc3RwMjU2IiwKICAgICJ4LXR1Zi1vbi1jaS1rZXlvd25lciI6ICJAbGFuY2UiCiAgIH0sCiAgICIyMmY0Y2FlYzZkOGU2Zjk1NTVhZjY2YjNkNGMzY2IwNmEzYmIyM2ZkYzdlMzljOTE2YzYxZjQ2MmU2ZjUyYjA2IjogewogICAgImtleWlkX2hhc2hfYWxnb3JpdGhtcyI6IFsKICAgICAic2hhMjU2IiwKICAgICAic2hhNTEyIgogICAgXSwKICAgICJrZXl0eXBlIjogImVjZHNhIiwKICAgICJrZXl2YWwiOiB7CiAgICAgInB1YmxpYyI6ICItLS0tLUJFR0lOIFBVQkxJQyBLRVktLS0tLVxuTUZrd0V3WUhLb1pJemowQ0FRWUlLb1pJemowREFRY0RRZ0FFekJ6Vk9tSENQb2pNVkxTSTM2NFdpaVY4TlByRFxuNklnUnhWbGlza3ovdit5M0pFUjVtY1ZHY09ObGlEY1dNQzVKMmxmSG1qUE5QaGI0SDd4bThMemZTQT09XG4tLS0tLUVORCBQVUJMSUMgS0VZLS0tLS1cbiIKICAgIH0sCiAgICAic2NoZW1lIjogImVjZHNhLXNoYTItbmlzdHAyNTYiLAogICAgIngtdHVmLW9uLWNpLWtleW93bmVyIjogIkBzYW50aWFnb3RvcnJlcyIKICAgfSwKICAgIjYxNjQzODM4MTI1YjQ0MGI0MGRiNjk0MmY1Y2I1YTMxYzBkYzA0MzY4MzE2ZWIyYWFhNThiOTU5MDRhNTgyMjIiOiB7CiAgICAia2V5aWRfaGFzaF9hbGdvcml0aG1zIjogWwogICAgICJzaGEyNTYiLAogICAgICJzaGE1MTIiCiAgICBdLAogICAgImtleXR5cGUiOiAiZWNkc2EiLAogICAgImtleXZhbCI6IHsKICAgICAicHVibGljIjogIi0tLS0tQkVHSU4gUFVCTElDIEtFWS0tLS0tXG5NRmt3RXdZSEtvWkl6ajBDQVFZSUtvWkl6ajBEQVFjRFFnQUVpbmlrU3NBUW1Za05lSDVlWXEvQ25JekxhYWNPXG54bFNhYXdRRE93cUt5L3RDcXhxNXh4UFNKYzIxSzRXSWhzOUd5T2tLZnp1ZVkzR0lMemNNSlo0Y1d3PT1cbi0tLS0tRU5EIFBVQkxJQyBLRVktLS0tLVxuIgogICAgfSwKICAgICJzY2hlbWUiOiAiZWNkc2Etc2hhMi1uaXN0cDI1NiIsCiAgICAieC10dWYtb24tY2kta2V5b3duZXIiOiAiQGJvYmNhbGxhd2F5IgogICB9LAogICAiYTY4N2U1YmY0ZmFiODJiMGVlNThkNDZlMDVjOTUzNTE0NWEyYzlhZmI0NThmNDNkNDJiNDVjYTBmZGNlMmE3MCI6IHsKICAgICJrZXlpZF9oYXNoX2FsZ29yaXRobXMiOiBbCiAgICAgInNoYTI1NiIsCiAgICAgInNoYTUxMiIKICAgIF0sCiAgICAia2V5dHlwZSI6ICJlY2RzYSIsCiAgICAia2V5dmFsIjogewogICAgICJwdWJsaWMiOiAiLS0tLS1CRUdJTiBQVUJMSUMgS0VZLS0tLS1cbk1Ga3dFd1lIS29aSXpqMENBUVlJS29aSXpqMERBUWNEUWdBRTBnaHJoOTJMdzFZcjNpZEdWNVdxQ3RNREI4Q3hcbitEOGhkQzR3MlpMTklwbFZSb1ZHTHNrWWEzZ2hlTXlPamlKOGtQaTE1YVEyLy83UCtvajdVdkpQR3c9PVxuLS0tLS1FTkQgUFVCTElDIEtFWS0tLS0tXG4iCiAgICB9LAogICAgInNjaGVtZSI6ICJlY2RzYS1zaGEyLW5pc3RwMjU2IiwKICAgICJ4LXR1Zi1vbi1jaS1rZXlvd25lciI6ICJAam9zaHVhZ2wiCiAgIH0sCiAgICJlNzFhNTRkNTQzODM1YmE4NmFkYWQ5NDYwMzc5Yzc2NDFmYjg3MjZkMTY0ZWE3NjY4MDFhMWM1MjJhYmE3ZWEyIjogewogICAgImtleWlkX2hhc2hfYWxnb3JpdGhtcyI6IFsKICAgICAic2hhMjU2IiwKICAgICAic2hhNTEyIgogICAgXSwKICAgICJrZXl0eXBlIjogImVjZHNhIiwKICAgICJrZXl2YWwiOiB7CiAgICAgInB1YmxpYyI6ICItLS0tLUJFR0lOIFBVQkxJQyBLRVktLS0tLVxuTUZrd0V3WUhLb1pJemowQ0FRWUlLb1pJemowREFRY0RRZ0FFRVhzejNTWlhGYjhqTVY0Mmo2cEpseWpialI4S1xuTjNCd29jZXhxNkxNSWI1cXNXS09RdkxOMTZOVWVmTGM0SHN3T291bVJzVlZhYWpTcFFTNmZvYmtSdz09XG4tLS0tLUVORCBQVUJMSUMgS0VZLS0tLS1cbiIKICAgIH0sCiAgICAic2NoZW1lIjogImVjZHNhLXNoYTItbmlzdHAyNTYiLAogICAgIngtdHVmLW9uLWNpLWtleW93bmVyIjogIkBtbm02NzgiCiAgIH0KICB9LAogICJyb2xlcyI6IHsKICAgInJvb3QiOiB7CiAgICAia2V5aWRzIjogWwogICAgICJlNzFhNTRkNTQzODM1YmE4NmFkYWQ5NDYwMzc5Yzc2NDFmYjg3MjZkMTY0ZWE3NjY4MDFhMWM1MjJhYmE3ZWEyIiwKICAgICAiMjJmNGNhZWM2ZDhlNmY5NTU1YWY2NmIzZDRjM2NiMDZhM2JiMjNmZGM3ZTM5YzkxNmM2MWY0NjJlNmY1MmIwNiIsCiAgICAgIjYxNjQzODM4MTI1YjQ0MGI0MGRiNjk0MmY1Y2I1YTMxYzBkYzA0MzY4MzE2ZWIyYWFhNThiOTU5MDRhNTgyMjIiLAogICAgICJhNjg3ZTViZjRmYWI4MmIwZWU1OGQ0NmUwNWM5NTM1MTQ1YTJjOWFmYjQ1OGY0M2Q0MmI0NWNhMGZkY2UyYTcwIiwKICAgICAiMTgzZTY0ZjM3NjcwZGMxM2NhMGQyODk5NWEzMDUzZjM3NDA5NTRkZGNlNDQzMjFhNDFlNDY1MzRjZjQ0ZTYzMiIKICAgIF0sCiAgICAidGhyZXNob2xkIjogMwogICB9LAogICAic25hcHNob3QiOiB7CiAgICAia2V5aWRzIjogWwogICAgICIwYzg3NDMyYzNiZjA5ZmQ5OTE4OWZkYzMyZmE1ZWFlZGY0ZTRhNWZhYzdiYWI3M2ZhMDRhMmUwZmM2NGFmNmY1IgogICAgXSwKICAgICJ0aHJlc2hvbGQiOiAxLAogICAgIngtdHVmLW9uLWNpLWV4cGlyeS1wZXJpb2QiOiAzNjUwLAogICAgIngtdHVmLW9uLWNpLXNpZ25pbmctcGVyaW9kIjogMzY1CiAgIH0sCiAgICJ0YXJnZXRzIjogewogICAgImtleWlkcyI6IFsKICAgICAiZTcxYTU0ZDU0MzgzNWJhODZhZGFkOTQ2MDM3OWM3NjQxZmI4NzI2ZDE2NGVhNzY2ODAxYTFjNTIyYWJhN2VhMiIsCiAgICAgIjIyZjRjYWVjNmQ4ZTZmOTU1NWFmNjZiM2Q0YzNjYjA2YTNiYjIzZmRjN2UzOWM5MTZjNjFmNDYyZTZmNTJiMDYiLAogICAgICI2MTY0MzgzODEyNWI0NDBiNDBkYjY5NDJmNWNiNWEzMWMwZGMwNDM2ODMxNmViMmFhYTU4Yjk1OTA0YTU4MjIyIiwKICAgICAiYTY4N2U1YmY0ZmFiODJiMGVlNThkNDZlMDVjOTUzNTE0NWEyYzlhZmI0NThmNDNkNDJiNDVjYTBmZGNlMmE3MCIsCiAgICAgIjE4M2U2NGYzNzY3MGRjMTNjYTBkMjg5OTVhMzA1M2YzNzQwOTU0ZGRjZTQ0MzIxYTQxZTQ2NTM0Y2Y0NGU2MzIiCiAgICBdLAogICAgInRocmVzaG9sZCI6IDMKICAgfSwKICAgInRpbWVzdGFtcCI6IHsKICAgICJrZXlpZHMiOiBbCiAgICAgIjBjODc0MzJjM2JmMDlmZDk5MTg5ZmRjMzJmYTVlYWVkZjRlNGE1ZmFjN2JhYjczZmEwNGEyZTBmYzY0YWY2ZjUiCiAgICBdLAogICAgInRocmVzaG9sZCI6IDEsCiAgICAieC10dWYtb24tY2ktZXhwaXJ5LXBlcmlvZCI6IDcsCiAgICAieC10dWYtb24tY2ktc2lnbmluZy1wZXJpb2QiOiA2CiAgIH0KICB9LAogICJzcGVjX3ZlcnNpb24iOiAiMS4wIiwKICAidmVyc2lvbiI6IDE1LAogICJ4LXR1Zi1vbi1jaS1leHBpcnktcGVyaW9kIjogMTk3LAogICJ4LXR1Zi1vbi1jaS1zaWduaW5nLXBlcmlvZCI6IDQ2CiB9Cn0=",
    targets: {
      "trusted_root.json": "ewogICJtZWRpYVR5cGUiOiAiYXBwbGljYXRpb24vdm5kLmRldi5zaWdzdG9yZS50cnVzdGVkcm9vdCtqc29uO3ZlcnNpb249MC4xIiwKICAidGxvZ3MiOiBbCiAgICB7CiAgICAgICJiYXNlVXJsIjogImh0dHBzOi8vcmVrb3Iuc2lnc3RvcmUuZGV2IiwKICAgICAgImhhc2hBbGdvcml0aG0iOiAiU0hBMl8yNTYiLAogICAgICAicHVibGljS2V5IjogewogICAgICAgICJyYXdCeXRlcyI6ICJNRmt3RXdZSEtvWkl6ajBDQVFZSUtvWkl6ajBEQVFjRFFnQUUyRzJZKzJ0YWJkVFY1QmNHaUJJeDBhOWZBRndya0JibUxTR3RrczRMM3FYNnlZWTB6dWZCbmhDOFVyL2l5NTVHaFdQLzlBL2JZMkxoQzMwTTkrUll0dz09IiwKICAgICAgICAia2V5RGV0YWlscyI6ICJQS0lYX0VDRFNBX1AyNTZfU0hBXzI1NiIsCiAgICAgICAgInZhbGlkRm9yIjogewogICAgICAgICAgInN0YXJ0IjogIjIwMjEtMDEtMTJUMTE6NTM6MjdaIgogICAgICAgIH0KICAgICAgfSwKICAgICAgImxvZ0lkIjogewogICAgICAgICJrZXlJZCI6ICJ3Tkk5YXRRR2x6K1ZXZk82TFJ5Z0g0UVVmWS84VzRSRndpVDVpNVdSZ0IwPSIKICAgICAgfQogICAgfSwKICAgIHsKICAgICAgImJhc2VVcmwiOiAiaHR0cHM6Ly9sb2cyMDI1LTEucmVrb3Iuc2lnc3RvcmUuZGV2IiwKICAgICAgImhhc2hBbGdvcml0aG0iOiAiU0hBMl8yNTYiLAogICAgICAicHVibGljS2V5IjogewogICAgICAgICJyYXdCeXRlcyI6ICJNQ293QlFZREsyVndBeUVBdDhybHAxa25Hd2pmYmNYQVlQWUFrbjBYaUx6MXg4TzR0MFlrRWhpZTI0ND0iLAogICAgICAgICJrZXlEZXRhaWxzIjogIlBLSVhfRUQyNTUxOSIsCiAgICAgICAgInZhbGlkRm9yIjogewogICAgICAgICAgInN0YXJ0IjogIjIwMjUtMDktMjNUMDA6MDA6MDBaIgogICAgICAgIH0KICAgICAgfSwKICAgICAgImxvZ0lkIjogewogICAgICAgICJrZXlJZCI6ICJ6eEdaRlZ2ZDBGRW1qUjhXckZ3TWRjQUo5dnRhWS9RWGY0NFkxd1VlUDZBPSIKICAgICAgfQogICAgfQogIF0sCiAgImNlcnRpZmljYXRlQXV0aG9yaXRpZXMiOiBbCiAgICB7CiAgICAgICJzdWJqZWN0IjogewogICAgICAgICJvcmdhbml6YXRpb24iOiAic2lnc3RvcmUuZGV2IiwKICAgICAgICAiY29tbW9uTmFtZSI6ICJzaWdzdG9yZSIKICAgICAgfSwKICAgICAgInVyaSI6ICJodHRwczovL2Z1bGNpby5zaWdzdG9yZS5kZXYiLAogICAgICAiY2VydENoYWluIjogewogICAgICAgICJjZXJ0aWZpY2F0ZXMiOiBbCiAgICAgICAgICB7CiAgICAgICAgICAgICJyYXdCeXRlcyI6ICJNSUlCK0RDQ0FYNmdBd0lCQWdJVE5Wa0Rab0Npb2ZQRHN5N2RmbTZnZUxidWh6QUtCZ2dxaGtqT1BRUURBekFxTVJVd0V3WURWUVFLRXd4emFXZHpkRzl5WlM1a1pYWXhFVEFQQmdOVkJBTVRDSE5wWjNOMGIzSmxNQjRYRFRJeE1ETXdOekF6TWpBeU9Wb1hEVE14TURJeU16QXpNakF5T1Zvd0tqRVZNQk1HQTFVRUNoTU1jMmxuYzNSdmNtVXVaR1YyTVJFd0R3WURWUVFERXdoemFXZHpkRzl5WlRCMk1CQUdCeXFHU000OUFnRUdCU3VCQkFBaUEySUFCTFN5QTdJaTVrK3BOTzhaRVdZMHlsZW1XRG93T2tOYTNrTCtHWkU1WjVHV2VoTDkvQTliUk5BM1JicnNaNWkwSmNhc3RhUkw3U3A1ZnAvakQ1ZHhxYy9VZFRWbmx2UzE2YW4rMllmc3dlL1F1TG9sUlVDcmNPRTIrMmlBNSt0emQ2Tm1NR1F3RGdZRFZSMFBBUUgvQkFRREFnRUdNQklHQTFVZEV3RUIvd1FJTUFZQkFmOENBUUV3SFFZRFZSME9CQllFRk1qRkhRQkJtaVFwTWxFazZ3MnVTdTFLQnRQc01COEdBMVVkSXdRWU1CYUFGTWpGSFFCQm1pUXBNbEVrNncydVN1MUtCdFBzTUFvR0NDcUdTTTQ5QkFNREEyZ0FNR1VDTUg4bGlXSmZNdWk2dlhYQmhqRGdZNE13c2xtTi9USnhWZS84M1dyRm9td21OZjA1NnkxWDQ4RjljNG0zYTNvelhBSXhBS2pSYXk1L2FqL2pzS0tHSWttUWF0akk4dXVwSHIvK0N4RnZhSldtcFlxTmtMREdSVSs5b3J6aDVoSTJScmN1YVE9PSIKICAgICAgICAgIH0KICAgICAgICBdCiAgICAgIH0sCiAgICAgICJ2YWxpZEZvciI6IHsKICAgICAgICAic3RhcnQiOiAiMjAyMS0wMy0wN1QwMzoyMDoyOVoiLAogICAgICAgICJlbmQiOiAiMjAyMi0xMi0zMVQyMzo1OTo1OS45OTlaIgogICAgICB9CiAgICB9LAogICAgewogICAgICAic3ViamVjdCI6IHsKICAgICAgICAib3JnYW5pemF0aW9uIjogInNpZ3N0b3JlLmRldiIsCiAgICAgICAgImNvbW1vbk5hbWUiOiAic2lnc3RvcmUiCiAgICAgIH0sCiAgICAgICJ1cmkiOiAiaHR0cHM6Ly9mdWxjaW8uc2lnc3RvcmUuZGV2IiwKICAgICAgImNlcnRDaGFpbiI6IHsKICAgICAgICAiY2VydGlmaWNhdGVzIjogWwogICAgICAgICAgewogICAgICAgICAgICAicmF3Qnl0ZXMiOiAiTUlJQ0dqQ0NBYUdnQXdJQkFnSVVBTG5WaVZmblUwYnJKYXNtUmtIcm4vVW5mYVF3Q2dZSUtvWkl6ajBFQXdNd0tqRVZNQk1HQTFVRUNoTU1jMmxuYzNSdmNtVXVaR1YyTVJFd0R3WURWUVFERXdoemFXZHpkRzl5WlRBZUZ3MHlNakEwTVRNeU1EQTJNVFZhRncwek1URXdNRFV4TXpVMk5UaGFNRGN4RlRBVEJnTlZCQW9UREhOcFozTjBiM0psTG1SbGRqRWVNQndHQTFVRUF4TVZjMmxuYzNSdmNtVXRhVzUwWlhKdFpXUnBZWFJsTUhZd0VBWUhLb1pJemowQ0FRWUZLNEVFQUNJRFlnQUU4UlZTL3lzSCtOT3Z1RFp5UEladGlsZ1VGOU5sYXJZcEFkOUhQMXZCQkgxVTVDVjc3TFNTN3MwWmlING5FN0h2N3B0UzZMdnZSL1NUazc5OExWZ016TGxKNEhlSWZGM3RIU2FleExjWXBTQVNyMWtTME4vUmdCSnovOWpXQ2lYbm8zc3dlVEFPQmdOVkhROEJBZjhFQkFNQ0FRWXdFd1lEVlIwbEJBd3dDZ1lJS3dZQkJRVUhBd013RWdZRFZSMFRBUUgvQkFnd0JnRUIvd0lCQURBZEJnTlZIUTRFRmdRVTM5UHB6MVlrRVpiNXFOanBLRldpeGk0WVpEOHdId1lEVlIwakJCZ3dGb0FVV01BZVg1RkZwV2FwZXN5UW9aTWkwQ3JGeGZvd0NnWUlLb1pJemowRUF3TURad0F3WkFJd1BDc1FLNERZaVpZRFBJYURpNUhGS25meFh4NkFTU1ZtRVJmc3luWUJpWDJYNlNKUm5aVTg0LzlEWmRuRnZ2eG1BakJPdDZRcEJsYzRKLzBEeHZrVENxcGNsdnppTDZCQ0NQbmpkbElCM1B1M0J4c1BteWdVWTdJaTJ6YmRDZGxpaW93PSIKICAgICAgICAgIH0sCiAgICAgICAgICB7CiAgICAgICAgICAgICJyYXdCeXRlcyI6ICJNSUlCOXpDQ0FYeWdBd0lCQWdJVUFMWk5BUEZkeEhQd2plRGxvRHd5WUNoQU8vNHdDZ1lJS29aSXpqMEVBd013S2pFVk1CTUdBMVVFQ2hNTWMybG5jM1J2Y21VdVpHVjJNUkV3RHdZRFZRUURFd2h6YVdkemRHOXlaVEFlRncweU1URXdNRGN4TXpVMk5UbGFGdzB6TVRFd01EVXhNelUyTlRoYU1Db3hGVEFUQmdOVkJBb1RESE5wWjNOMGIzSmxMbVJsZGpFUk1BOEdBMVVFQXhNSWMybG5jM1J2Y21Vd2RqQVFCZ2NxaGtqT1BRSUJCZ1VyZ1FRQUlnTmlBQVQ3WGVGVDRyYjNQUUd3UzRJYWp0TGszL09sbnBnYW5nYUJjbFlwc1lCcjVpKzR5bkIwN2NlYjNMUDBPSU9aZHhleFg2OWM1aVZ1eUpSUStIejA1eWkrVUYzdUJXQWxIcGlTNXNoMCtIMkdIRTdTWHJrMUVDNW0xVHIxOUw5Z2c5MmpZekJoTUE0R0ExVWREd0VCL3dRRUF3SUJCakFQQmdOVkhSTUJBZjhFQlRBREFRSC9NQjBHQTFVZERnUVdCQlJZd0I1ZmtVV2xacWw2ekpDaGt5TFFLc1hGK2pBZkJnTlZIU01FR0RBV2dCUll3QjVma1VXbFpxbDZ6SkNoa3lMUUtzWEYrakFLQmdncWhrak9QUVFEQXdOcEFEQm1BakVBajFuSGVYWnArMTNOV0JOYStFRHNEUDhHMVdXZzF0Q01XUC9XSFBxcGFWbzBqaHN3ZU5GWmdTczBlRTd3WUk0cUFqRUEyV0I5b3Q5OHNJa29GM3ZaWWRkMy9WdFdCNWI5VE5NZWE3SXgvc3RKNVRmY0xMZUFCTEU0Qk5KT3NRNHZuQkhKIgogICAgICAgICAgfQogICAgICAgIF0KICAgICAgfSwKICAgICAgInZhbGlkRm9yIjogewogICAgICAgICJzdGFydCI6ICIyMDIyLTA0LTEzVDIwOjA2OjE1WiIKICAgICAgfQogICAgfQogIF0sCiAgImN0bG9ncyI6IFsKICAgIHsKICAgICAgImJhc2VVcmwiOiAiaHR0cHM6Ly9jdGZlLnNpZ3N0b3JlLmRldi90ZXN0IiwKICAgICAgImhhc2hBbGdvcml0aG0iOiAiU0hBMl8yNTYiLAogICAgICAicHVibGljS2V5IjogewogICAgICAgICJyYXdCeXRlcyI6ICJNRmt3RXdZSEtvWkl6ajBDQVFZSUtvWkl6ajBEQVFjRFFnQUViZndSK1JKdWRYc2NnUkJScEtYMVhGRHkzUHl1ZER4ei9TZm5SaTFmVDhla3BmQmQyTzF1b3o3anIzWjhuS3p4QTY5RVVRK2VGQ0ZJM3pldWJQV1U3dz09IiwKICAgICAgICAia2V5RGV0YWlscyI6ICJQS0lYX0VDRFNBX1AyNTZfU0hBXzI1NiIsCiAgICAgICAgInZhbGlkRm9yIjogewogICAgICAgICAgInN0YXJ0IjogIjIwMjEtMDMtMTRUMDA6MDA6MDBaIiwKICAgICAgICAgICJlbmQiOiAiMjAyMi0xMC0zMVQyMzo1OTo1OS45OTlaIgogICAgICAgIH0KICAgICAgfSwKICAgICAgImxvZ0lkIjogewogICAgICAgICJrZXlJZCI6ICJDR0NTOENoUy8yaEYwZEZySjRTY1JXY1lyQlk5d3pqU2JlYThJZ1kyYjNJPSIKICAgICAgfQogICAgfSwKICAgIHsKICAgICAgImJhc2VVcmwiOiAiaHR0cHM6Ly9jdGZlLnNpZ3N0b3JlLmRldi8yMDIyIiwKICAgICAgImhhc2hBbGdvcml0aG0iOiAiU0hBMl8yNTYiLAogICAgICAicHVibGljS2V5IjogewogICAgICAgICJyYXdCeXRlcyI6ICJNRmt3RXdZSEtvWkl6ajBDQVFZSUtvWkl6ajBEQVFjRFFnQUVpUFNsRmkwQ21GVGZFakNVcUY5SHVDRWNZWE5LQWFZYWxJSm1CWjh5eWV6UGpUcWh4cktCcE1uYW9jVnRMSkJJMWVNM3VYblF6UUdBSmRKNGdzOUZ5dz09IiwKICAgICAgICAia2V5RGV0YWlscyI6ICJQS0lYX0VDRFNBX1AyNTZfU0hBXzI1NiIsCiAgICAgICAgInZhbGlkRm9yIjogewogICAgICAgICAgInN0YXJ0IjogIjIwMjItMTAtMjBUMDA6MDA6MDBaIgogICAgICAgIH0KICAgICAgfSwKICAgICAgImxvZ0lkIjogewogICAgICAgICJrZXlJZCI6ICIzVDB3YXNiSEVUSmpHUjRjbVdjM0FxSktYcmplUEszL2g0cHlnQzhwN280PSIKICAgICAgfQogICAgfQogIF0sCiAgInRpbWVzdGFtcEF1dGhvcml0aWVzIjogWwogICAgewogICAgICAic3ViamVjdCI6IHsKICAgICAgICAib3JnYW5pemF0aW9uIjogInNpZ3N0b3JlLmRldiIsCiAgICAgICAgImNvbW1vbk5hbWUiOiAic2lnc3RvcmUtdHNhLXNlbGZzaWduZWQiCiAgICAgIH0sCiAgICAgICJ1cmkiOiAiaHR0cHM6Ly90aW1lc3RhbXAuc2lnc3RvcmUuZGV2L2FwaS92MS90aW1lc3RhbXAiLAogICAgICAiY2VydENoYWluIjogewogICAgICAgICJjZXJ0aWZpY2F0ZXMiOiBbCiAgICAgICAgICB7CiAgICAgICAgICAgICJyYXdCeXRlcyI6ICJNSUlDRURDQ0FaYWdBd0lCQWdJVU9oTlVMd3lRWWU2OHdVTXZ5NHFPaXlvaml3d3dDZ1lJS29aSXpqMEVBd013T1RFVk1CTUdBMVVFQ2hNTWMybG5jM1J2Y21VdVpHVjJNU0F3SGdZRFZRUURFeGR6YVdkemRHOXlaUzEwYzJFdGMyVnNabk5wWjI1bFpEQWVGdzB5TlRBME1EZ3dOalU1TkROYUZ3MHpOVEEwTURZd05qVTVORE5hTUM0eEZUQVRCZ05WQkFvVERITnBaM04wYjNKbExtUmxkakVWTUJNR0ExVUVBeE1NYzJsbmMzUnZjbVV0ZEhOaE1IWXdFQVlIS29aSXpqMENBUVlGSzRFRUFDSURZZ0FFNHJhMlo4aEtOaWcyVDlrRmpDQVRvR0czMGpreStXUXYzQnpMK21LdmgxU0tOUi9Vd3V3c2ZOQ2c0c3J5b1lBZDhFNmlzb3ZWQTNNNGFvTmRtOVFEaTUwWjhuVEV5dnFnZkRQdFRJd1hJdGZpVy9BRmYxVjd1d2tia0FvajB4eGNvMm93YURBT0JnTlZIUThCQWY4RUJBTUNCNEF3SFFZRFZSME9CQllFRkluOWVVT0h6OUJsUnNNQ1JzY3NjMXQ5dE9zRE1COEdBMVVkSXdRWU1CYUFGSmpzQWU5L3UxSC8xSlVlYjRxSW1GTUhpYzYvTUJZR0ExVWRKUUVCL3dRTU1Bb0dDQ3NHQVFVRkJ3TUlNQW9HQ0NxR1NNNDlCQU1EQTJnQU1HVUNNRHRwc1YvNkthTzBxeUYvVU1zWDJhU1VYS1FGZG9HVHB0UUdjMGZ0cTFjc3VsSFBHRzZkc215TU5kM0pCK0czRVFJeEFPYWp2QmNqcEptS2I0TnYrMlRhb2o4VWM1K2I2aWg2RlhDQ0tyYVNxdXBlMDd6cXN3TWNYSlRlMWNFeHZIdnZsdz09IgogICAgICAgICAgfSwKICAgICAgICAgIHsKICAgICAgICAgICAgInJhd0J5dGVzIjogIk1JSUI5ekNDQVh5Z0F3SUJBZ0lVVjdmMEdMRE9vRXpJaDhMWFNXODBPSmlVcDE0d0NnWUlLb1pJemowRUF3TXdPVEVWTUJNR0ExVUVDaE1NYzJsbmMzUnZjbVV1WkdWMk1TQXdIZ1lEVlFRREV4ZHphV2R6ZEc5eVpTMTBjMkV0YzJWc1puTnBaMjVsWkRBZUZ3MHlOVEEwTURnd05qVTVORE5hRncwek5UQTBNRFl3TmpVNU5ETmFNRGt4RlRBVEJnTlZCQW9UREhOcFozTjBiM0psTG1SbGRqRWdNQjRHQTFVRUF4TVhjMmxuYzNSdmNtVXRkSE5oTFhObGJHWnphV2R1WldRd2RqQVFCZ2NxaGtqT1BRSUJCZ1VyZ1FRQUlnTmlBQVFVUU50ZlJUL291M1lBVGE2d0Iva0tUZTcwY2ZKd3lSSUJvdk1udDhSY0pwaC9DT0U4MnV5UzZGbXBwTExMMVZCUEdjUGZwUVBZSk5Yeld3aThpY3doS1E2Vy9RZTJoM29lYkJiMkZIcHdOSkRxbytUTWFDL3RkZmt2L0VsSkI3MmpSVEJETUE0R0ExVWREd0VCL3dRRUF3SUJCakFTQmdOVkhSTUJBZjhFQ0RBR0FRSC9BZ0VBTUIwR0ExVWREZ1FXQkJTWTdBSHZmN3RSLzlTVkhtK0tpSmhUQjRuT3Z6QUtCZ2dxaGtqT1BRUURBd05wQURCbUFqRUF3R0VHcmZHWlIxY2VuMVI4L0RUVk1JOTQzTHNzWm1KUnREcC9pN1NmR0htR1JQNmdSYnVqOXZPSzNiNjdaMFFRQWpFQXVUMkg2NzNMUUVhSFRjeVFTWnJrcDRtWDdXd2ttRitzVmJrWVk1bVhOK1JNSDEzS1VFSEhPcUFTYWVtWVdLL0UiCiAgICAgICAgICB9CiAgICAgICAgXQogICAgICB9LAogICAgICAidmFsaWRGb3IiOiB7CiAgICAgICAgInN0YXJ0IjogIjIwMjUtMDctMDRUMDA6MDA6MDBaIgogICAgICB9CiAgICB9CiAgXQp9Cg==",
      "registry.npmjs.org%2Fkeys.json": "ewogICAgImtleXMiOiBbCiAgICAgICAgewogICAgICAgICAgICAia2V5SWQiOiAiU0hBMjU2OmpsM2J3c3d1ODBQampva0NnaDBvMnc1YzJVNExoUUFFNTdnajljejFrekEiLAogICAgICAgICAgICAia2V5VXNhZ2UiOiAibnBtOnNpZ25hdHVyZXMiLAogICAgICAgICAgICAicHVibGljS2V5IjogewogICAgICAgICAgICAgICAgInJhd0J5dGVzIjogIk1Ga3dFd1lIS29aSXpqMENBUVlJS29aSXpqMERBUWNEUWdBRTFPbGIzek1BRkZ4WEtIaUlrUU81Y0ozWWhsNWk2VVBwK0lodXRlQkpidUhjQTVVb2dLbzBFV3RsV3dXNktTYUtvVE5FWUw3SmxDUWlWbmtoQmt0VWdnPT0iLAogICAgICAgICAgICAgICAgImtleURldGFpbHMiOiAiUEtJWF9FQ0RTQV9QMjU2X1NIQV8yNTYiLAogICAgICAgICAgICAgICAgInZhbGlkRm9yIjogewogICAgICAgICAgICAgICAgICAgICJzdGFydCI6ICIxOTk5LTAxLTAxVDAwOjAwOjAwLjAwMFoiLAogICAgICAgICAgICAgICAgICAgICJlbmQiOiAiMjAyNS0wMS0yOVQwMDowMDowMC4wMDBaIgogICAgICAgICAgICAgICAgfQogICAgICAgICAgICB9CiAgICAgICAgfSwKICAgICAgICB7CiAgICAgICAgICAgICJrZXlJZCI6ICJTSEEyNTY6amwzYndzd3U4MFBqam9rQ2doMG8ydzVjMlU0TGhRQUU1N2dqOWN6MWt6QSIsCiAgICAgICAgICAgICJrZXlVc2FnZSI6ICJucG06YXR0ZXN0YXRpb25zIiwKICAgICAgICAgICAgInB1YmxpY0tleSI6IHsKICAgICAgICAgICAgICAgICJyYXdCeXRlcyI6ICJNRmt3RXdZSEtvWkl6ajBDQVFZSUtvWkl6ajBEQVFjRFFnQUUxT2xiM3pNQUZGeFhLSGlJa1FPNWNKM1lobDVpNlVQcCtJaHV0ZUJKYnVIY0E1VW9nS28wRVd0bFd3VzZLU2FLb1RORVlMN0psQ1FpVm5raEJrdFVnZz09IiwKICAgICAgICAgICAgICAgICJrZXlEZXRhaWxzIjogIlBLSVhfRUNEU0FfUDI1Nl9TSEFfMjU2IiwKICAgICAgICAgICAgICAgICJ2YWxpZEZvciI6IHsKICAgICAgICAgICAgICAgICAgICAic3RhcnQiOiAiMjAyMi0xMi0wMVQwMDowMDowMC4wMDBaIiwKICAgICAgICAgICAgICAgICAgICAiZW5kIjogIjIwMjUtMDEtMjlUMDA6MDA6MDAuMDAwWiIKICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgfQogICAgICAgIH0sCiAgICAgICAgewogICAgICAgICAgICAia2V5SWQiOiAiU0hBMjU2OkRoUTh3UjVBUEJ2RkhMRi8rVGMrQVl2UE9kVHBjSURxT2h4c0JIUndDN1UiLAogICAgICAgICAgICAia2V5VXNhZ2UiOiAibnBtOnNpZ25hdHVyZXMiLAogICAgICAgICAgICAicHVibGljS2V5IjogewogICAgICAgICAgICAgICAgInJhd0J5dGVzIjogIk1Ga3dFd1lIS29aSXpqMENBUVlJS29aSXpqMERBUWNEUWdBRVk2WWE3VysrN2FVUHp2TVRyZXpINlljeDNjK0hPS1lDY05HeWJKWlNDSnEvZmQ3UWE4dXVBS3RkSWtVUXRRaUVLRVJoQW1FNWxNTUpoUDhPa0RPYTJnPT0iLAogICAgICAgICAgICAgICAgImtleURldGFpbHMiOiAiUEtJWF9FQ0RTQV9QMjU2X1NIQV8yNTYiLAogICAgICAgICAgICAgICAgInZhbGlkRm9yIjogewogICAgICAgICAgICAgICAgICAgICJzdGFydCI6ICIyMDI1LTAxLTEzVDAwOjAwOjAwLjAwMFoiCiAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgIH0KICAgICAgICB9LAogICAgICAgIHsKICAgICAgICAgICAgImtleUlkIjogIlNIQTI1NjpEaFE4d1I1QVBCdkZITEYvK1RjK0FZdlBPZFRwY0lEcU9oeHNCSFJ3QzdVIiwKICAgICAgICAgICAgImtleVVzYWdlIjogIm5wbTphdHRlc3RhdGlvbnMiLAogICAgICAgICAgICAicHVibGljS2V5IjogewogICAgICAgICAgICAgICAgInJhd0J5dGVzIjogIk1Ga3dFd1lIS29aSXpqMENBUVlJS29aSXpqMERBUWNEUWdBRVk2WWE3VysrN2FVUHp2TVRyZXpINlljeDNjK0hPS1lDY05HeWJKWlNDSnEvZmQ3UWE4dXVBS3RkSWtVUXRRaUVLRVJoQW1FNWxNTUpoUDhPa0RPYTJnPT0iLAogICAgICAgICAgICAgICAgImtleURldGFpbHMiOiAiUEtJWF9FQ0RTQV9QMjU2X1NIQV8yNTYiLAogICAgICAgICAgICAgICAgInZhbGlkRm9yIjogewogICAgICAgICAgICAgICAgICAgICJzdGFydCI6ICIyMDI1LTAxLTEzVDAwOjAwOjAwLjAwMFoiCiAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgIH0KICAgICAgICB9CiAgICBdCn0K"
    }
  }
};

function requireClient() {
  if (hasRequiredClient) return client;
  hasRequiredClient = 1;
  var __importDefault = client && client.__importDefault || function(mod) {
    return mod && mod.__esModule ? mod : {
      default: mod
    };
  };
  Object.defineProperty(client, "__esModule", {
    value: !0
  }), client.TUFClient = void 0;
  const fs_1 = __importDefault(require$$0$5), path_1 = __importDefault(require$$1), tuf_js_1 = (hasRequiredDist$3 || (hasRequiredDist$3 = 1, 
  function(exports) {
    Object.defineProperty(exports, "__esModule", {
      value: !0
    }), exports.Updater = exports.BaseFetcher = exports.TargetFile = void 0;
    var models_1 = requireDist$4();
    Object.defineProperty(exports, "TargetFile", {
      enumerable: !0,
      get: function() {
        return models_1.TargetFile;
      }
    });
    var fetcher_1 = requireFetcher();
    Object.defineProperty(exports, "BaseFetcher", {
      enumerable: !0,
      get: function() {
        return fetcher_1.BaseFetcher;
      }
    });
    var updater_1 = requireUpdater();
    Object.defineProperty(exports, "Updater", {
      enumerable: !0,
      get: function() {
        return updater_1.Updater;
      }
    });
  }(dist$3)), dist$3), _1 = requireDist$2(), package_json_1 = require$$4, target_1 = requireTarget();
  return client.TUFClient = class {
    updater;
    constructor(options) {
      const url = new URL(options.mirrorURL), repoName = encodeURIComponent(url.host + url.pathname.replace(/\/$/, "")), cachePath = path_1.default.join(options.cachePath, repoName);
      !function(cachePath) {
        const targetsPath = path_1.default.join(cachePath, "targets");
        fs_1.default.existsSync(cachePath) || fs_1.default.mkdirSync(cachePath, {
          recursive: !0
        });
        fs_1.default.existsSync(targetsPath) || fs_1.default.mkdirSync(targetsPath);
      }(cachePath), function({cachePath: cachePath, mirrorURL: mirrorURL, tufRootPath: tufRootPath, forceInit: forceInit}) {
        const cachedRootPath = path_1.default.join(cachePath, "root.json");
        if (!fs_1.default.existsSync(cachedRootPath) || forceInit) if (tufRootPath) fs_1.default.copyFileSync(tufRootPath, cachedRootPath); else {
          const repoSeed = require$$6[mirrorURL];
          if (!repoSeed) throw new _1.TUFError({
            code: "TUF_INIT_CACHE_ERROR",
            message: `No root.json found for mirror: ${mirrorURL}`
          });
          fs_1.default.writeFileSync(cachedRootPath, Buffer.from(repoSeed["root.json"], "base64")), 
          Object.entries(repoSeed.targets).forEach(([targetName, target]) => {
            fs_1.default.writeFileSync(path_1.default.join(cachePath, "targets", targetName), Buffer.from(target, "base64"));
          });
        }
      }({
        cachePath: cachePath,
        mirrorURL: options.mirrorURL,
        tufRootPath: options.rootPath,
        forceInit: options.forceInit
      }), this.updater = function(options) {
        const config = {
          fetchTimeout: options.timeout,
          fetchRetry: options.retry,
          userAgent: `${encodeURIComponent(package_json_1.name)}/${package_json_1.version}`
        };
        return new tuf_js_1.Updater({
          metadataBaseUrl: options.mirrorURL,
          targetBaseUrl: `${options.mirrorURL}/targets`,
          metadataDir: options.cachePath,
          targetDir: path_1.default.join(options.cachePath, "targets"),
          forceCache: options.forceCache,
          config: config
        });
      }({
        mirrorURL: options.mirrorURL,
        cachePath: cachePath,
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
  }, client;
}

function requireDist$2() {
  return hasRequiredDist$2 || (hasRequiredDist$2 = 1, function(exports) {
    Object.defineProperty(exports, "__esModule", {
      value: !0
    }), exports.TUFError = exports.DEFAULT_MIRROR_URL = void 0, exports.getTrustedRoot = async function(options = {}) {
      const client = createClient(options), trustedRoot = await client.getTarget(TRUSTED_ROOT_TARGET);
      return protobuf_specs_1.TrustedRoot.fromJSON(JSON.parse(trustedRoot));
    }, exports.initTUF = async function(options = {}) {
      const client = createClient(options);
      return client.refresh().then(() => client);
    };
    const protobuf_specs_1 = requireDist$6(), appdata_1 = function() {
      if (hasRequiredAppdata) return appdata;
      hasRequiredAppdata = 1;
      var __importDefault = appdata && appdata.__importDefault || function(mod) {
        return mod && mod.__esModule ? mod : {
          default: mod
        };
      };
      Object.defineProperty(appdata, "__esModule", {
        value: !0
      }), appdata.appDataPath = function(name) {
        const homedir = os_1.default.homedir();
        switch (process.platform) {
         case "darwin":
          {
            const appSupport = path_1.default.join(homedir, "Library", "Application Support");
            return path_1.default.join(appSupport, name);
          }

         case "win32":
          {
            const localAppData = process.env.LOCALAPPDATA || path_1.default.join(homedir, "AppData", "Local");
            return path_1.default.join(localAppData, name, "Data");
          }

         default:
          {
            const localData = process.env.XDG_DATA_HOME || path_1.default.join(homedir, ".local", "share");
            return path_1.default.join(localData, name);
          }
        }
      };
      const os_1 = __importDefault(require$$0), path_1 = __importDefault(require$$1);
      return appdata;
    }(), client_1 = requireClient();
    exports.DEFAULT_MIRROR_URL = "https://tuf-repo-cdn.sigstore.dev";
    const DEFAULT_CACHE_DIR = "sigstore-js", DEFAULT_RETRY = {
      retries: 2
    }, DEFAULT_TIMEOUT = 5e3, TRUSTED_ROOT_TARGET = "trusted_root.json";
    function createClient(options) {
      return new client_1.TUFClient({
        cachePath: options.cachePath || (0, appdata_1.appDataPath)(DEFAULT_CACHE_DIR),
        rootPath: options.rootPath,
        mirrorURL: options.mirrorURL || exports.DEFAULT_MIRROR_URL,
        retry: options.retry ?? DEFAULT_RETRY,
        timeout: options.timeout ?? DEFAULT_TIMEOUT,
        forceCache: options.forceCache ?? !1,
        forceInit: options.forceInit ?? options.force ?? !1
      });
    }
    var error_1 = requireError$3();
    Object.defineProperty(exports, "TUFError", {
      enumerable: !0,
      get: function() {
        return error_1.TUFError;
      }
    });
  }(dist$4)), dist$4;
}

var hasRequiredStream, distExports$1 = requireDist$2(), dist$1 = {}, bundle = {}, dist = {}, asn1 = {}, obj = {}, stream = {};

function requireStream() {
  if (hasRequiredStream) return stream;
  hasRequiredStream = 1, Object.defineProperty(stream, "__esModule", {
    value: !0
  }), stream.ByteStream = void 0;
  class StreamError extends Error {}
  class ByteStream {
    static BLOCK_SIZE=1024;
    buf;
    view;
    start=0;
    constructor(buffer) {
      buffer ? (this.buf = buffer, this.view = Buffer.from(buffer)) : (this.buf = Buffer.alloc(0), 
      this.view = Buffer.from(this.buf));
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
      const end = start + len;
      if (end > this.length) throw new StreamError("request past end of buffer");
      return this.view.subarray(start, end);
    }
    appendChar(char) {
      this.ensureCapacity(1), this.view[this.start] = char, this.start += 1;
    }
    appendUint16(num) {
      this.ensureCapacity(2);
      const value = new Uint16Array([ num ]), view = new Uint8Array(value.buffer);
      this.view[this.start] = view[1], this.view[this.start + 1] = view[0], this.start += 2;
    }
    appendUint24(num) {
      this.ensureCapacity(3);
      const value = new Uint32Array([ num ]), view = new Uint8Array(value.buffer);
      this.view[this.start] = view[2], this.view[this.start + 1] = view[1], this.view[this.start + 2] = view[0], 
      this.start += 3;
    }
    appendView(view) {
      this.ensureCapacity(view.length), this.view.set(view, this.start), this.start += view.length;
    }
    getBlock(size) {
      if (size <= 0) return Buffer.alloc(0);
      if (this.start + size > this.view.length) throw new Error("request past end of buffer");
      const result = this.view.subarray(this.start, this.start + size);
      return this.start += size, result;
    }
    getUint8() {
      return this.getBlock(1)[0];
    }
    getUint16() {
      const block = this.getBlock(2);
      return block[0] << 8 | block[1];
    }
    ensureCapacity(size) {
      if (this.start + size > this.view.byteLength) {
        const blockSize = ByteStream.BLOCK_SIZE + (size > ByteStream.BLOCK_SIZE ? size : 0);
        this.realloc(this.view.byteLength + blockSize);
      }
    }
    realloc(size) {
      const newArray = Buffer.alloc(size), newView = Buffer.from(newArray);
      newView.set(this.view), this.buf = newArray, this.view = newView;
    }
  }
  return stream.ByteStream = ByteStream, stream;
}

var hasRequiredError$2, error$2 = {};

function requireError$2() {
  if (hasRequiredError$2) return error$2;
  hasRequiredError$2 = 1, Object.defineProperty(error$2, "__esModule", {
    value: !0
  }), error$2.ASN1TypeError = error$2.ASN1ParseError = void 0;
  class ASN1ParseError extends Error {}
  error$2.ASN1ParseError = ASN1ParseError;
  class ASN1TypeError extends Error {}
  return error$2.ASN1TypeError = ASN1TypeError, error$2;
}

var hasRequiredLength, length = {};

var hasRequiredParse, parse = {};

var hasRequiredTag, hasRequiredObj, hasRequiredAsn1, tag = {};

function requireObj() {
  if (hasRequiredObj) return obj;
  hasRequiredObj = 1, Object.defineProperty(obj, "__esModule", {
    value: !0
  }), obj.ASN1Obj = void 0;
  const stream_1 = requireStream(), error_1 = requireError$2(), length_1 = function() {
    if (hasRequiredLength) return length;
    hasRequiredLength = 1, Object.defineProperty(length, "__esModule", {
      value: !0
    }), length.decodeLength = function(stream) {
      const buf = stream.getUint8();
      if (!(128 & buf)) return buf;
      const byteCount = 127 & buf;
      if (byteCount > 6) throw new error_1.ASN1ParseError("length exceeds 6 byte limit");
      let len = 0;
      for (let i = 0; i < byteCount; i++) {
        const byte = stream.getUint8();
        if (0 === i && 0 === byte) throw new error_1.ASN1ParseError("non-minimal length encoding");
        len = 256 * len + byte;
      }
      if (0 === len) throw new error_1.ASN1ParseError("indefinite length encoding not supported");
      if (len < 128) throw new error_1.ASN1ParseError("non-minimal length encoding");
      return len;
    }, length.encodeLength = function(len) {
      if (len < 128) return Buffer.from([ len ]);
      let val = BigInt(len);
      const bytes = [];
      for (;val > 0n; ) bytes.unshift(Number(255n & val)), val >>= 8n;
      return Buffer.from([ 128 | bytes.length, ...bytes ]);
    };
    const error_1 = requireError$2();
    return length;
  }(), parse_1 = function() {
    if (hasRequiredParse) return parse;
    hasRequiredParse = 1, Object.defineProperty(parse, "__esModule", {
      value: !0
    }), parse.parseInteger = function(buf) {
      let pos = 0;
      const end = buf.length;
      let val = buf[pos];
      const neg = val > 127, pad = neg ? 255 : 0;
      for (;val == pad && ++pos < end; ) val = buf[pos];
      if (end - pos === 0) return BigInt(neg ? -1 : 0);
      val = neg ? val - 256 : val;
      let n = BigInt(val);
      for (let i = pos + 1; i < end; ++i) n = n * BigInt(256) + BigInt(buf[i]);
      return n;
    }, parse.parseStringASCII = parseStringASCII, parse.parseTime = function(buf, shortYear) {
      const timeStr = parseStringASCII(buf), m = shortYear ? RE_TIME_SHORT_YEAR.exec(timeStr) : RE_TIME_LONG_YEAR.exec(timeStr);
      if (!m) throw new Error("invalid time");
      if (shortYear) {
        let year = Number(m[1]);
        year += year >= 50 ? 1900 : 2e3, m[1] = year.toString();
      }
      return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`);
    }, parse.parseOID = function(buf) {
      let pos = 0;
      const end = buf.length;
      let n = buf[pos++];
      let oid = `${Math.floor(n / 40)}.${n % 40}`, val = 0n;
      for (;pos < end; ++pos) n = buf[pos], val = (val << 7n) + BigInt(127 & n), 128 & n || (oid += `.${val}`, 
      val = 0n);
      return oid;
    }, parse.parseBoolean = function(buf) {
      if (1 !== buf.length) throw new error_1.ASN1ParseError("invalid boolean");
      switch (buf[0]) {
       case 0:
        return !1;

       case 255:
        return !0;

       default:
        throw new error_1.ASN1ParseError("invalid boolean");
      }
    }, parse.parseBitString = function(buf) {
      const unused = buf[0];
      if (unused > 7) throw new error_1.ASN1ParseError("invalid bit string");
      const end = buf.length, bits = [];
      for (let i = 1; i < end; ++i) {
        const byte = buf[i], skip = i === end - 1 ? unused : 0;
        for (let j = 7; j >= skip; --j) bits.push(byte >> j & 1);
      }
      return bits;
    };
    const error_1 = requireError$2(), RE_TIME_SHORT_YEAR = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\.\d{3})?Z$/, RE_TIME_LONG_YEAR = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\.\d{3})?Z$/;
    function parseStringASCII(buf) {
      return buf.toString("ascii");
    }
    return parse;
  }(), tag_1 = function() {
    if (hasRequiredTag) return tag;
    hasRequiredTag = 1, Object.defineProperty(tag, "__esModule", {
      value: !0
    }), tag.ASN1Tag = void 0;
    const error_1 = requireError$2(), UNIVERSAL_TAG_BOOLEAN = 1, UNIVERSAL_TAG_INTEGER = 2, UNIVERSAL_TAG_BIT_STRING = 3, UNIVERSAL_TAG_OCTET_STRING = 4, UNIVERSAL_TAG_OBJECT_IDENTIFIER = 6, UNIVERSAL_TAG_UTC_TIME = 23, UNIVERSAL_TAG_GENERALIZED_TIME = 24, TAG_CLASS_UNIVERSAL = 0, TAG_CLASS_CONTEXT_SPECIFIC = 2;
    return tag.ASN1Tag = class {
      number;
      constructed;
      class;
      constructor(enc) {
        if (this.number = 31 & enc, this.constructed = !(32 & ~enc), this.class = enc >> 6, 
        31 === this.number) throw new error_1.ASN1ParseError("long form tags not supported");
        if (this.class === TAG_CLASS_UNIVERSAL && 0 === this.number) throw new error_1.ASN1ParseError("unsupported tag 0x00");
      }
      isUniversal() {
        return this.class === TAG_CLASS_UNIVERSAL;
      }
      isContextSpecific(num) {
        const res = this.class === TAG_CLASS_CONTEXT_SPECIFIC;
        return void 0 !== num ? res && this.number === num : res;
      }
      isBoolean() {
        return this.isUniversal() && this.number === UNIVERSAL_TAG_BOOLEAN;
      }
      isInteger() {
        return this.isUniversal() && this.number === UNIVERSAL_TAG_INTEGER;
      }
      isBitString() {
        return this.isUniversal() && this.number === UNIVERSAL_TAG_BIT_STRING;
      }
      isOctetString() {
        return this.isUniversal() && this.number === UNIVERSAL_TAG_OCTET_STRING;
      }
      isOID() {
        return this.isUniversal() && this.number === UNIVERSAL_TAG_OBJECT_IDENTIFIER;
      }
      isUTCTime() {
        return this.isUniversal() && this.number === UNIVERSAL_TAG_UTC_TIME;
      }
      isGeneralizedTime() {
        return this.isUniversal() && this.number === UNIVERSAL_TAG_GENERALIZED_TIME;
      }
      toDER() {
        return this.number | (this.constructed ? 32 : 0) | this.class << 6;
      }
    }, tag;
  }();
  class ASN1Obj {
    tag;
    subs;
    value;
    constructor(tag, value, subs) {
      this.tag = tag, this.value = value, this.subs = subs;
    }
    static parseBuffer(buf) {
      const stream = new stream_1.ByteStream(buf), obj = parseStream(stream);
      if (stream.position !== stream.length) throw new error_1.ASN1ParseError("invalid trailing data");
      return obj;
    }
    toDER() {
      const valueStream = new stream_1.ByteStream;
      if (this.subs.length > 0) for (const sub of this.subs) valueStream.appendView(sub.toDER()); else valueStream.appendView(this.value);
      const value = valueStream.buffer, obj = new stream_1.ByteStream;
      return obj.appendChar(this.tag.toDER()), obj.appendView((0, length_1.encodeLength)(value.length)), 
      obj.appendView(value), obj.buffer;
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
       case this.tag.isUTCTime():
        return (0, parse_1.parseTime)(this.value, !0);

       case this.tag.isGeneralizedTime():
        return (0, parse_1.parseTime)(this.value, !1);

       default:
        throw new error_1.ASN1TypeError("not a date");
      }
    }
    toBitString() {
      if (!this.tag.isBitString()) throw new error_1.ASN1TypeError("not a bit string");
      return (0, parse_1.parseBitString)(this.value);
    }
  }
  obj.ASN1Obj = ASN1Obj;
  const MAX_DEPTH = 100;
  function parseStream(stream, depth = 0) {
    if (depth > MAX_DEPTH) throw new error_1.ASN1ParseError("maximum nesting depth exceeded");
    const tag = new tag_1.ASN1Tag(stream.getUint8()), len = (0, length_1.decodeLength)(stream), value = stream.slice(stream.position, len), start = stream.position;
    let subs = [];
    if (tag.constructed) subs = collectSubs(stream, len, depth); else if (tag.isOctetString()) try {
      subs = collectSubs(stream, len, depth);
    } catch (e) {}
    return 0 === subs.length && stream.seek(start + len), new ASN1Obj(tag, value, subs);
  }
  function collectSubs(stream, len, depth) {
    const end = stream.position + len;
    if (end > stream.length) throw new error_1.ASN1ParseError("invalid length");
    const subs = [];
    for (;stream.position < end; ) subs.push(parseStream(stream, depth + 1));
    if (stream.position !== end) throw new error_1.ASN1ParseError("invalid length");
    return subs;
  }
  return obj;
}

function requireAsn1() {
  return hasRequiredAsn1 || (hasRequiredAsn1 = 1, function(exports) {
    Object.defineProperty(exports, "__esModule", {
      value: !0
    }), exports.ASN1Obj = void 0;
    var obj_1 = requireObj();
    Object.defineProperty(exports, "ASN1Obj", {
      enumerable: !0,
      get: function() {
        return obj_1.ASN1Obj;
      }
    });
  }(asn1)), asn1;
}

var hasRequiredCrypto, crypto = {};

function requireCrypto() {
  if (hasRequiredCrypto) return crypto;
  hasRequiredCrypto = 1;
  var __importDefault = crypto && crypto.__importDefault || function(mod) {
    return mod && mod.__esModule ? mod : {
      default: mod
    };
  };
  Object.defineProperty(crypto, "__esModule", {
    value: !0
  }), crypto.createPublicKey = function(key, type = "spki") {
    return "string" == typeof key ? key.startsWith("-----") ? crypto_1.default.createPublicKey(key) : crypto_1.default.createPublicKey({
      key: Buffer.from(key, "base64"),
      format: "der",
      type: type
    }) : crypto_1.default.createPublicKey({
      key: key,
      format: "der",
      type: type
    });
  }, crypto.digest = function(algorithm, ...data) {
    const hash = crypto_1.default.createHash(algorithm);
    for (const d of data) hash.update(d);
    return hash.digest();
  }, crypto.verify = function(data, key, signature, algorithm) {
    try {
      return crypto_1.default.verify(algorithm, data, key, signature);
    } catch (e) {
      return !1;
    }
  }, crypto.bufferEqual = function(a, b) {
    try {
      return crypto_1.default.timingSafeEqual(a, b);
    } catch {
      return !1;
    }
  };
  const crypto_1 = __importDefault(require$$0$1);
  return crypto;
}

var hasRequiredDsse$3, dsse$3 = {};

var hasRequiredEncoding, encoding = {};

var hasRequiredJson, json = {};

var hasRequiredPem, pem = {};

function requirePem() {
  if (hasRequiredPem) return pem;
  hasRequiredPem = 1, Object.defineProperty(pem, "__esModule", {
    value: !0
  }), pem.toDER = function(certificate) {
    let der = "";
    return certificate.split("\n").forEach(line => {
      line.match(PEM_HEADER) || line.match(PEM_FOOTER) || (der += line);
    }), Buffer.from(der, "base64");
  }, pem.fromDER = function(certificate, type = "CERTIFICATE") {
    const der = certificate.toString("base64"), lines = der.match(/.{1,64}/g) || "";
    return [ `-----BEGIN ${type}-----`, ...lines, `-----END ${type}-----` ].join("\n").concat("\n");
  };
  const PEM_HEADER = /-----BEGIN (.*)-----/, PEM_FOOTER = /-----END (.*)-----/;
  return pem;
}

var hasRequiredOid, rfc3161 = {}, timestamp$1 = {}, oid = {};

function requireOid() {
  return hasRequiredOid || (hasRequiredOid = 1, Object.defineProperty(oid, "__esModule", {
    value: !0
  }), oid.SHA2_HASH_ALGOS = oid.RSA_SIGNATURE_ALGOS = oid.ECDSA_SIGNATURE_ALGOS = void 0, 
  oid.ECDSA_SIGNATURE_ALGOS = {
    "1.2.840.10045.4.3.1": "sha224",
    "1.2.840.10045.4.3.2": "sha256",
    "1.2.840.10045.4.3.3": "sha384",
    "1.2.840.10045.4.3.4": "sha512"
  }, oid.RSA_SIGNATURE_ALGOS = {
    "1.2.840.113549.1.1.14": "sha224",
    "1.2.840.113549.1.1.11": "sha256",
    "1.2.840.113549.1.1.12": "sha384",
    "1.2.840.113549.1.1.13": "sha512"
  }, oid.SHA2_HASH_ALGOS = {
    "2.16.840.1.101.3.4.2.1": "sha256",
    "2.16.840.1.101.3.4.2.2": "sha384",
    "2.16.840.1.101.3.4.2.3": "sha512"
  }), oid;
}

var hasRequiredError$1, error$1 = {};

function requireError$1() {
  if (hasRequiredError$1) return error$1;
  hasRequiredError$1 = 1, Object.defineProperty(error$1, "__esModule", {
    value: !0
  }), error$1.RFC3161TimestampVerificationError = void 0;
  class RFC3161TimestampVerificationError extends Error {}
  return error$1.RFC3161TimestampVerificationError = RFC3161TimestampVerificationError, 
  error$1;
}

var hasRequiredTstinfo, hasRequiredTimestamp$1, hasRequiredRfc3161, tstinfo = {};

function requireTimestamp$1() {
  if (hasRequiredTimestamp$1) return timestamp$1;
  hasRequiredTimestamp$1 = 1;
  var ownKeys, __createBinding = timestamp$1 && timestamp$1.__createBinding || (Object.create ? function(o, m, k, k2) {
    void 0 === k2 && (k2 = k);
    var desc = Object.getOwnPropertyDescriptor(m, k);
    desc && !("get" in desc ? !m.__esModule : desc.writable || desc.configurable) || (desc = {
      enumerable: !0,
      get: function() {
        return m[k];
      }
    }), Object.defineProperty(o, k2, desc);
  } : function(o, m, k, k2) {
    void 0 === k2 && (k2 = k), o[k2] = m[k];
  }), __setModuleDefault = timestamp$1 && timestamp$1.__setModuleDefault || (Object.create ? function(o, v) {
    Object.defineProperty(o, "default", {
      enumerable: !0,
      value: v
    });
  } : function(o, v) {
    o.default = v;
  }), __importStar = timestamp$1 && timestamp$1.__importStar || (ownKeys = function(o) {
    return ownKeys = Object.getOwnPropertyNames || function(o) {
      var ar = [];
      for (var k in o) Object.prototype.hasOwnProperty.call(o, k) && (ar[ar.length] = k);
      return ar;
    }, ownKeys(o);
  }, function(mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (null != mod) for (var k = ownKeys(mod), i = 0; i < k.length; i++) "default" !== k[i] && __createBinding(result, mod, k[i]);
    return __setModuleDefault(result, mod), result;
  });
  Object.defineProperty(timestamp$1, "__esModule", {
    value: !0
  }), timestamp$1.RFC3161Timestamp = void 0;
  const asn1_1 = requireAsn1(), crypto = __importStar(requireCrypto()), oid_1 = requireOid(), error_1 = requireError$1(), tstinfo_1 = function() {
    if (hasRequiredTstinfo) return tstinfo;
    hasRequiredTstinfo = 1;
    var ownKeys, __createBinding = tstinfo && tstinfo.__createBinding || (Object.create ? function(o, m, k, k2) {
      void 0 === k2 && (k2 = k);
      var desc = Object.getOwnPropertyDescriptor(m, k);
      desc && !("get" in desc ? !m.__esModule : desc.writable || desc.configurable) || (desc = {
        enumerable: !0,
        get: function() {
          return m[k];
        }
      }), Object.defineProperty(o, k2, desc);
    } : function(o, m, k, k2) {
      void 0 === k2 && (k2 = k), o[k2] = m[k];
    }), __setModuleDefault = tstinfo && tstinfo.__setModuleDefault || (Object.create ? function(o, v) {
      Object.defineProperty(o, "default", {
        enumerable: !0,
        value: v
      });
    } : function(o, v) {
      o.default = v;
    }), __importStar = tstinfo && tstinfo.__importStar || (ownKeys = function(o) {
      return ownKeys = Object.getOwnPropertyNames || function(o) {
        var ar = [];
        for (var k in o) Object.prototype.hasOwnProperty.call(o, k) && (ar[ar.length] = k);
        return ar;
      }, ownKeys(o);
    }, function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (null != mod) for (var k = ownKeys(mod), i = 0; i < k.length; i++) "default" !== k[i] && __createBinding(result, mod, k[i]);
      return __setModuleDefault(result, mod), result;
    });
    Object.defineProperty(tstinfo, "__esModule", {
      value: !0
    }), tstinfo.TSTInfo = void 0;
    const crypto = __importStar(requireCrypto()), oid_1 = requireOid(), error_1 = requireError$1();
    return tstinfo.TSTInfo = class {
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
        const oid = this.messageImprintObj.subs[0].subs[0].toOID();
        return oid_1.SHA2_HASH_ALGOS[oid];
      }
      get messageImprintHashedMessage() {
        return this.messageImprintObj.subs[1].value;
      }
      get raw() {
        return this.root.toDER();
      }
      verify(data) {
        const digest = crypto.digest(this.messageImprintHashAlgorithm, data);
        if (!crypto.bufferEqual(digest, this.messageImprintHashedMessage)) throw new error_1.RFC3161TimestampVerificationError("message imprint does not match artifact");
      }
      get messageImprintObj() {
        return this.root.subs[2];
      }
    }, tstinfo;
  }();
  class RFC3161Timestamp {
    root;
    constructor(asn1) {
      this.root = asn1;
    }
    static parse(der) {
      const asn1 = asn1_1.ASN1Obj.parseBuffer(der);
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
      const oid = this.signerDigestAlgorithmObj.subs[0].toOID();
      return oid_1.SHA2_HASH_ALGOS[oid];
    }
    get signatureAlgorithm() {
      const oid = this.signatureAlgorithmObj.subs[0].toOID();
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
      if ("1.2.840.113549.1.7.2" !== this.contentType) throw new error_1.RFC3161TimestampVerificationError(`incorrect content type: ${this.contentType}`);
      if ("1.2.840.113549.1.9.16.1.4" !== this.eContentType) throw new error_1.RFC3161TimestampVerificationError(`incorrect encapsulated content type: ${this.eContentType}`);
      this.tstInfo.verify(data), this.verifyMessageDigest(), this.verifySignature(publicKey);
    }
    verifyMessageDigest() {
      const tstInfoDigest = crypto.digest(this.signerDigestAlgorithm, this.tstInfo.raw), expectedDigest = this.messageDigestAttributeObj.subs[1].subs[0].value;
      if (!crypto.bufferEqual(tstInfoDigest, expectedDigest)) throw new error_1.RFC3161TimestampVerificationError("signed data does not match tstInfo");
    }
    verifySignature(key) {
      const signedAttrs = this.signedAttrsObj.toDER();
      signedAttrs[0] = 49;
      if (!crypto.verify(signedAttrs, key, this.signatureValue, this.signatureAlgorithm)) throw new error_1.RFC3161TimestampVerificationError("signature verification failed");
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
      return this.timeStampTokenObj.subs.find(sub => sub.tag.isContextSpecific(0)).subs[0];
    }
    get encapContentInfoObj() {
      return this.signedDataObj.subs[2];
    }
    get signerInfosObj() {
      const sd = this.signedDataObj;
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
      return this.signerInfoObj.subs.find(sub => sub.tag.isContextSpecific(0));
    }
    get messageDigestAttributeObj() {
      return this.signedAttrsObj.subs.find(sub => sub.subs[0].tag.isOID() && "1.2.840.113549.1.9.4" === sub.subs[0].toOID());
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
  }
  return timestamp$1.RFC3161Timestamp = RFC3161Timestamp, timestamp$1;
}

var hasRequiredSct$1, hasRequiredExt, hasRequiredCert, hasRequiredX509, hasRequiredDist$1, x509 = {}, cert = {}, ext = {}, sct$1 = {};

function requireExt() {
  if (hasRequiredExt) return ext;
  hasRequiredExt = 1, Object.defineProperty(ext, "__esModule", {
    value: !0
  }), ext.X509SCTExtension = ext.X509SubjectKeyIDExtension = ext.X509AuthorityKeyIDExtension = ext.X509SubjectAlternativeNameExtension = ext.X509KeyUsageExtension = ext.X509BasicConstraintsExtension = ext.X509Extension = void 0;
  const stream_1 = requireStream(), sct_1 = function() {
    if (hasRequiredSct$1) return sct$1;
    hasRequiredSct$1 = 1;
    var ownKeys, __createBinding = sct$1 && sct$1.__createBinding || (Object.create ? function(o, m, k, k2) {
      void 0 === k2 && (k2 = k);
      var desc = Object.getOwnPropertyDescriptor(m, k);
      desc && !("get" in desc ? !m.__esModule : desc.writable || desc.configurable) || (desc = {
        enumerable: !0,
        get: function() {
          return m[k];
        }
      }), Object.defineProperty(o, k2, desc);
    } : function(o, m, k, k2) {
      void 0 === k2 && (k2 = k), o[k2] = m[k];
    }), __setModuleDefault = sct$1 && sct$1.__setModuleDefault || (Object.create ? function(o, v) {
      Object.defineProperty(o, "default", {
        enumerable: !0,
        value: v
      });
    } : function(o, v) {
      o.default = v;
    }), __importStar = sct$1 && sct$1.__importStar || (ownKeys = function(o) {
      return ownKeys = Object.getOwnPropertyNames || function(o) {
        var ar = [];
        for (var k in o) Object.prototype.hasOwnProperty.call(o, k) && (ar[ar.length] = k);
        return ar;
      }, ownKeys(o);
    }, function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (null != mod) for (var k = ownKeys(mod), i = 0; i < k.length; i++) "default" !== k[i] && __createBinding(result, mod, k[i]);
      return __setModuleDefault(result, mod), result;
    });
    Object.defineProperty(sct$1, "__esModule", {
      value: !0
    }), sct$1.SignedCertificateTimestamp = void 0;
    const crypto = __importStar(requireCrypto()), stream_1 = requireStream();
    class SignedCertificateTimestamp {
      version;
      logID;
      timestamp;
      extensions;
      hashAlgorithm;
      signatureAlgorithm;
      signature;
      constructor(options) {
        this.version = options.version, this.logID = options.logID, this.timestamp = options.timestamp, 
        this.extensions = options.extensions, this.hashAlgorithm = options.hashAlgorithm, 
        this.signatureAlgorithm = options.signatureAlgorithm, this.signature = options.signature;
      }
      get datetime() {
        return new Date(Number(this.timestamp.readBigInt64BE()));
      }
      get algorithm() {
        switch (this.hashAlgorithm) {
         case 0:
          return "none";

         case 1:
          return "md5";

         case 2:
          return "sha1";

         case 3:
          return "sha224";

         case 4:
          return "sha256";

         case 5:
          return "sha384";

         case 6:
          return "sha512";

         default:
          return "unknown";
        }
      }
      verify(preCert, key) {
        const stream = new stream_1.ByteStream;
        return stream.appendChar(this.version), stream.appendChar(0), stream.appendView(this.timestamp), 
        stream.appendUint16(1), stream.appendView(preCert), stream.appendUint16(this.extensions.byteLength), 
        this.extensions.byteLength > 0 && stream.appendView(this.extensions), crypto.verify(stream.buffer, key, this.signature, this.algorithm);
      }
      static parse(buf) {
        const stream = new stream_1.ByteStream(buf), version = stream.getUint8(), logID = stream.getBlock(32), timestamp = stream.getBlock(8), extenstionLength = stream.getUint16(), extensions = stream.getBlock(extenstionLength), hashAlgorithm = stream.getUint8(), signatureAlgorithm = stream.getUint8(), sigLength = stream.getUint16(), signature = stream.getBlock(sigLength);
        if (stream.position !== buf.length) throw new Error("SCT buffer length mismatch");
        return new SignedCertificateTimestamp({
          version: version,
          logID: logID,
          timestamp: timestamp,
          extensions: extensions,
          hashAlgorithm: hashAlgorithm,
          signatureAlgorithm: signatureAlgorithm,
          signature: signature
        });
      }
    }
    return sct$1.SignedCertificateTimestamp = SignedCertificateTimestamp, sct$1;
  }();
  class X509Extension {
    root;
    constructor(asn1) {
      this.root = asn1;
    }
    get oid() {
      return this.root.subs[0].toOID();
    }
    get critical() {
      return 3 === this.root.subs.length && this.root.subs[1].toBoolean();
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
  }
  ext.X509Extension = X509Extension;
  ext.X509BasicConstraintsExtension = class extends X509Extension {
    get isCA() {
      return this.sequence.subs[0]?.toBoolean() ?? !1;
    }
    get pathLenConstraint() {
      return this.sequence.subs.length > 1 ? this.sequence.subs[1].toInteger() : void 0;
    }
    get sequence() {
      return this.extnValueObj.subs[0];
    }
  };
  ext.X509KeyUsageExtension = class extends X509Extension {
    get digitalSignature() {
      return 1 === this.bitString[0];
    }
    get keyCertSign() {
      return 1 === this.bitString[5];
    }
    get crlSign() {
      return 1 === this.bitString[6];
    }
    get bitString() {
      return this.extnValueObj.subs[0].toBitString();
    }
  };
  ext.X509SubjectAlternativeNameExtension = class extends X509Extension {
    get rfc822Name() {
      return this.findGeneralName(1)?.value.toString("ascii");
    }
    get uri() {
      return this.findGeneralName(6)?.value.toString("ascii");
    }
    otherName(oid) {
      const otherName = this.findGeneralName(0);
      if (void 0 === otherName) return;
      if (otherName.subs[0].toOID() !== oid) return;
      return otherName.subs[1].subs[0].value.toString("ascii");
    }
    findGeneralName(tag) {
      return this.generalNames.find(gn => gn.tag.isContextSpecific(tag));
    }
    get generalNames() {
      return this.extnValueObj.subs[0].subs;
    }
  };
  ext.X509AuthorityKeyIDExtension = class extends X509Extension {
    get keyIdentifier() {
      return this.findSequenceMember(0)?.value;
    }
    findSequenceMember(tag) {
      return this.sequence.subs.find(el => el.tag.isContextSpecific(tag));
    }
    get sequence() {
      return this.extnValueObj.subs[0];
    }
  };
  ext.X509SubjectKeyIDExtension = class extends X509Extension {
    get keyIdentifier() {
      return this.extnValueObj.subs[0].value;
    }
  };
  return ext.X509SCTExtension = class extends X509Extension {
    constructor(asn1) {
      super(asn1);
    }
    get signedCertificateTimestamps() {
      const buf = this.extnValueObj.subs[0].value, stream = new stream_1.ByteStream(buf), end = stream.getUint16() + 2, sctList = [];
      for (;stream.position < end; ) {
        const sctLength = stream.getUint16(), sct = stream.getBlock(sctLength);
        sctList.push(sct_1.SignedCertificateTimestamp.parse(sct));
      }
      if (stream.position !== end) throw new Error("SCT list length does not match actual length");
      return sctList;
    }
  }, ext;
}

function requireX509() {
  return hasRequiredX509 || (hasRequiredX509 = 1, function(exports) {
    Object.defineProperty(exports, "__esModule", {
      value: !0
    }), exports.X509SCTExtension = exports.X509Certificate = exports.EXTENSION_OID_SCT = void 0;
    var cert_1 = (hasRequiredCert || (hasRequiredCert = 1, function(exports) {
      var ownKeys, __createBinding = cert && cert.__createBinding || (Object.create ? function(o, m, k, k2) {
        void 0 === k2 && (k2 = k);
        var desc = Object.getOwnPropertyDescriptor(m, k);
        desc && !("get" in desc ? !m.__esModule : desc.writable || desc.configurable) || (desc = {
          enumerable: !0,
          get: function() {
            return m[k];
          }
        }), Object.defineProperty(o, k2, desc);
      } : function(o, m, k, k2) {
        void 0 === k2 && (k2 = k), o[k2] = m[k];
      }), __setModuleDefault = cert && cert.__setModuleDefault || (Object.create ? function(o, v) {
        Object.defineProperty(o, "default", {
          enumerable: !0,
          value: v
        });
      } : function(o, v) {
        o.default = v;
      }), __importStar = cert && cert.__importStar || (ownKeys = function(o) {
        return ownKeys = Object.getOwnPropertyNames || function(o) {
          var ar = [];
          for (var k in o) Object.prototype.hasOwnProperty.call(o, k) && (ar[ar.length] = k);
          return ar;
        }, ownKeys(o);
      }, function(mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (null != mod) for (var k = ownKeys(mod), i = 0; i < k.length; i++) "default" !== k[i] && __createBinding(result, mod, k[i]);
        return __setModuleDefault(result, mod), result;
      });
      Object.defineProperty(exports, "__esModule", {
        value: !0
      }), exports.X509Certificate = exports.EXTENSION_OID_SCT = void 0;
      const asn1_1 = requireAsn1(), crypto = __importStar(requireCrypto()), oid_1 = requireOid(), pem = __importStar(requirePem()), ext_1 = requireExt();
      exports.EXTENSION_OID_SCT = "1.3.6.1.4.1.11129.2.4.2";
      class X509Certificate {
        root;
        constructor(asn1) {
          this.root = asn1;
        }
        static parse(cert) {
          const der = "string" == typeof cert ? pem.toDER(cert) : cert, asn1 = asn1_1.ASN1Obj.parseBuffer(der);
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
          const oid = this.signatureAlgorithmObj.subs[0].toOID();
          return oid_1.RSA_SIGNATURE_ALGOS[oid] ? oid_1.RSA_SIGNATURE_ALGOS[oid] : oid_1.ECDSA_SIGNATURE_ALGOS[oid];
        }
        get signatureValue() {
          return this.signatureValueObj.value.subarray(1);
        }
        get subjectAltName() {
          const ext = this.extSubjectAltName;
          return ext?.uri || ext?.rfc822Name;
        }
        get extensions() {
          const extSeq = this.extensionsObj?.subs[0];
          return extSeq?.subs || [];
        }
        get extKeyUsage() {
          const ext = this.findExtension("2.5.29.15");
          return ext ? new ext_1.X509KeyUsageExtension(ext) : void 0;
        }
        get extBasicConstraints() {
          const ext = this.findExtension("2.5.29.19");
          return ext ? new ext_1.X509BasicConstraintsExtension(ext) : void 0;
        }
        get extSubjectAltName() {
          const ext = this.findExtension("2.5.29.17");
          return ext ? new ext_1.X509SubjectAlternativeNameExtension(ext) : void 0;
        }
        get extAuthorityKeyID() {
          const ext = this.findExtension("2.5.29.35");
          return ext ? new ext_1.X509AuthorityKeyIDExtension(ext) : void 0;
        }
        get extSubjectKeyID() {
          const ext = this.findExtension("2.5.29.14");
          return ext ? new ext_1.X509SubjectKeyIDExtension(ext) : void 0;
        }
        get extSCT() {
          const ext = this.findExtension(exports.EXTENSION_OID_SCT);
          return ext ? new ext_1.X509SCTExtension(ext) : void 0;
        }
        get isCA() {
          const ca = this.extBasicConstraints?.isCA || !1;
          return this.extKeyUsage ? ca && this.extKeyUsage.keyCertSign : ca;
        }
        extension(oid) {
          const ext = this.findExtension(oid);
          return ext ? new ext_1.X509Extension(ext) : void 0;
        }
        verify(issuerCertificate) {
          const publicKey = issuerCertificate?.publicKey || this.publicKey, key = crypto.createPublicKey(publicKey);
          return crypto.verify(this.tbsCertificate.toDER(), key, this.signatureValue, this.signatureAlgorithm);
        }
        validForDate(date) {
          return this.notBefore <= date && date <= this.notAfter;
        }
        equals(other) {
          return this.root.toDER().equals(other.root.toDER());
        }
        clone() {
          const der = this.root.toDER(), clone = Buffer.alloc(der.length);
          return der.copy(clone), X509Certificate.parse(clone);
        }
        findExtension(oid) {
          return this.extensions.find(ext => ext.subs[0].toOID() === oid);
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
          return this.tbsCertificateObj.subs.find(sub => sub.tag.isContextSpecific(3));
        }
      }
      exports.X509Certificate = X509Certificate;
    }(cert)), cert);
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
    var ext_1 = requireExt();
    Object.defineProperty(exports, "X509SCTExtension", {
      enumerable: !0,
      get: function() {
        return ext_1.X509SCTExtension;
      }
    });
  }(x509)), x509;
}

function requireDist$1() {
  return hasRequiredDist$1 || (hasRequiredDist$1 = 1, function(exports) {
    var ownKeys, __createBinding = dist && dist.__createBinding || (Object.create ? function(o, m, k, k2) {
      void 0 === k2 && (k2 = k);
      var desc = Object.getOwnPropertyDescriptor(m, k);
      desc && !("get" in desc ? !m.__esModule : desc.writable || desc.configurable) || (desc = {
        enumerable: !0,
        get: function() {
          return m[k];
        }
      }), Object.defineProperty(o, k2, desc);
    } : function(o, m, k, k2) {
      void 0 === k2 && (k2 = k), o[k2] = m[k];
    }), __setModuleDefault = dist && dist.__setModuleDefault || (Object.create ? function(o, v) {
      Object.defineProperty(o, "default", {
        enumerable: !0,
        value: v
      });
    } : function(o, v) {
      o.default = v;
    }), __importStar = dist && dist.__importStar || (ownKeys = function(o) {
      return ownKeys = Object.getOwnPropertyNames || function(o) {
        var ar = [];
        for (var k in o) Object.prototype.hasOwnProperty.call(o, k) && (ar[ar.length] = k);
        return ar;
      }, ownKeys(o);
    }, function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (null != mod) for (var k = ownKeys(mod), i = 0; i < k.length; i++) "default" !== k[i] && __createBinding(result, mod, k[i]);
      return __setModuleDefault(result, mod), result;
    });
    Object.defineProperty(exports, "__esModule", {
      value: !0
    }), exports.X509SCTExtension = exports.X509Certificate = exports.EXTENSION_OID_SCT = exports.ByteStream = exports.RFC3161Timestamp = exports.pem = exports.json = exports.encoding = exports.dsse = exports.crypto = exports.ASN1Obj = void 0;
    var asn1_1 = requireAsn1();
    Object.defineProperty(exports, "ASN1Obj", {
      enumerable: !0,
      get: function() {
        return asn1_1.ASN1Obj;
      }
    }), exports.crypto = __importStar(requireCrypto()), exports.dsse = __importStar(function() {
      if (hasRequiredDsse$3) return dsse$3;
      hasRequiredDsse$3 = 1, Object.defineProperty(dsse$3, "__esModule", {
        value: !0
      }), dsse$3.preAuthEncoding = function(payloadType, payload) {
        const typeBytes = Buffer.from(payloadType, "utf-8");
        return Buffer.concat([ Buffer.from(`${PAE_PREFIX} ${typeBytes.length} `, "ascii"), typeBytes, Buffer.from(` ${payload.length} `, "ascii"), payload ]);
      };
      const PAE_PREFIX = "DSSEv1";
      return dsse$3;
    }()), exports.encoding = __importStar(function() {
      if (hasRequiredEncoding) return encoding;
      hasRequiredEncoding = 1, Object.defineProperty(encoding, "__esModule", {
        value: !0
      }), encoding.base64Encode = function(str) {
        return Buffer.from(str, UTF8_ENCODING).toString(BASE64_ENCODING);
      }, encoding.base64Decode = function(str) {
        return Buffer.from(str, BASE64_ENCODING).toString(UTF8_ENCODING);
      };
      const BASE64_ENCODING = "base64", UTF8_ENCODING = "utf-8";
      return encoding;
    }()), exports.json = __importStar((hasRequiredJson || (hasRequiredJson = 1, Object.defineProperty(json, "__esModule", {
      value: !0
    }), json.canonicalize = function canonicalize(object) {
      let buffer = "";
      if (null === object || "object" != typeof object || null != object.toJSON) buffer += JSON.stringify(object); else if (Array.isArray(object)) {
        buffer += "[";
        let first = !0;
        object.forEach(element => {
          first || (buffer += ","), first = !1, buffer += canonicalize(element);
        }), buffer += "]";
      } else {
        buffer += "{";
        let first = !0;
        Object.keys(object).sort().forEach(property => {
          first || (buffer += ","), first = !1, buffer += JSON.stringify(property), buffer += ":", 
          buffer += canonicalize(object[property]);
        }), buffer += "}";
      }
      return buffer;
    }), json)), exports.pem = __importStar(requirePem());
    var rfc3161_1 = (hasRequiredRfc3161 || (hasRequiredRfc3161 = 1, function(exports) {
      Object.defineProperty(exports, "__esModule", {
        value: !0
      }), exports.RFC3161Timestamp = void 0;
      var timestamp_1 = requireTimestamp$1();
      Object.defineProperty(exports, "RFC3161Timestamp", {
        enumerable: !0,
        get: function() {
          return timestamp_1.RFC3161Timestamp;
        }
      });
    }(rfc3161)), rfc3161);
    Object.defineProperty(exports, "RFC3161Timestamp", {
      enumerable: !0,
      get: function() {
        return rfc3161_1.RFC3161Timestamp;
      }
    });
    var stream_1 = requireStream();
    Object.defineProperty(exports, "ByteStream", {
      enumerable: !0,
      get: function() {
        return stream_1.ByteStream;
      }
    });
    var x509_1 = requireX509();
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
  }(dist)), dist;
}

var hasRequiredDsse$2, dsse$2 = {};

var hasRequiredMessage, hasRequiredBundle, message = {};

function requireBundle() {
  if (hasRequiredBundle) return bundle;
  hasRequiredBundle = 1, Object.defineProperty(bundle, "__esModule", {
    value: !0
  }), bundle.toSignedEntity = function(bundle, artifact) {
    const {tlogEntries: tlogEntries, timestampVerificationData: timestampVerificationData} = bundle.verificationMaterial, timestamps = [];
    for (const entry of tlogEntries) entry.integratedTime && "0" !== entry.integratedTime && timestamps.push({
      $case: "transparency-log",
      tlogEntry: entry
    });
    for (const ts of timestampVerificationData?.rfc3161Timestamps ?? []) timestamps.push({
      $case: "timestamp-authority",
      timestamp: core_1.RFC3161Timestamp.parse(Buffer.from(ts.signedTimestamp))
    });
    return {
      signature: signatureContent(bundle, artifact),
      key: key(bundle),
      tlogEntries: tlogEntries,
      timestamps: timestamps
    };
  }, bundle.signatureContent = signatureContent;
  const core_1 = requireDist$1(), dsse_1 = function() {
    if (hasRequiredDsse$2) return dsse$2;
    hasRequiredDsse$2 = 1, Object.defineProperty(dsse$2, "__esModule", {
      value: !0
    }), dsse$2.DSSESignatureContent = void 0;
    const core_1 = requireDist$1();
    return dsse$2.DSSESignatureContent = class {
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
    }, dsse$2;
  }(), message_1 = function() {
    if (hasRequiredMessage) return message;
    hasRequiredMessage = 1, Object.defineProperty(message, "__esModule", {
      value: !0
    }), message.MessageSignatureContent = void 0;
    const core_1 = requireDist$1(), protobuf_specs_1 = requireDist$6(), HASH_ALGORITHM_MAP = {
      [protobuf_specs_1.HashAlgorithm.HASH_ALGORITHM_UNSPECIFIED]: "sha256",
      [protobuf_specs_1.HashAlgorithm.SHA2_256]: "sha256",
      [protobuf_specs_1.HashAlgorithm.SHA2_384]: "sha384",
      [protobuf_specs_1.HashAlgorithm.SHA2_512]: "sha512",
      [protobuf_specs_1.HashAlgorithm.SHA3_256]: "sha3-256",
      [protobuf_specs_1.HashAlgorithm.SHA3_384]: "sha3-384"
    };
    return message.MessageSignatureContent = class {
      signature;
      messageDigest;
      artifact;
      hashAlgorithm;
      constructor(messageSignature, artifact) {
        this.signature = messageSignature.signature, this.messageDigest = messageSignature.messageDigest.digest, 
        this.artifact = artifact, this.hashAlgorithm = HASH_ALGORITHM_MAP[messageSignature.messageDigest.algorithm] ?? "sha256";
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
    }, message;
  }();
  function signatureContent(bundle, artifact) {
    switch (bundle.content.$case) {
     case "dsseEnvelope":
      return new dsse_1.DSSESignatureContent(bundle.content.dsseEnvelope);

     case "messageSignature":
      return new message_1.MessageSignatureContent(bundle.content.messageSignature, artifact);
    }
  }
  function key(bundle) {
    switch (bundle.verificationMaterial.content.$case) {
     case "publicKey":
      return {
        $case: "public-key",
        hint: bundle.verificationMaterial.content.publicKey.hint
      };

     case "x509CertificateChain":
      return {
        $case: "certificate",
        certificate: core_1.X509Certificate.parse(Buffer.from(bundle.verificationMaterial.content.x509CertificateChain.certificates[0].rawBytes))
      };

     case "certificate":
      return {
        $case: "certificate",
        certificate: core_1.X509Certificate.parse(Buffer.from(bundle.verificationMaterial.content.certificate.rawBytes))
      };
    }
  }
  return bundle;
}

var hasRequiredError, error = {};

function requireError() {
  if (hasRequiredError) return error;
  hasRequiredError = 1, Object.defineProperty(error, "__esModule", {
    value: !0
  }), error.PolicyError = error.VerificationError = void 0;
  class BaseError extends Error {
    code;
    cause;
    constructor({code: code, message: message, cause: cause}) {
      super(message), this.code = code, this.cause = cause, this.name = this.constructor.name;
    }
  }
  error.VerificationError = class extends BaseError {};
  return error.PolicyError = class extends BaseError {}, error;
}

var hasRequiredFilter, hasRequiredTrust, trust = {}, filter = {};

function requireTrust() {
  return hasRequiredTrust || (hasRequiredTrust = 1, function(exports) {
    Object.defineProperty(exports, "__esModule", {
      value: !0
    }), exports.filterTLogAuthorities = exports.filterCertAuthorities = void 0, exports.toTrustMaterial = function(root, keys) {
      const keyFinder = "function" == typeof keys ? keys : function(keys) {
        return hint => {
          const key = (keys || {})[hint];
          if (!key) throw new error_1.VerificationError({
            code: "PUBLIC_KEY_ERROR",
            message: `key not found: ${hint}`
          });
          return {
            publicKey: core_1.crypto.createPublicKey(key.rawBytes),
            validFor: date => (key.validFor?.start || BEGINNING_OF_TIME) <= date && (key.validFor?.end || END_OF_TIME) >= date
          };
        };
      }(keys);
      return {
        certificateAuthorities: root.certificateAuthorities.map(createCertAuthority),
        timestampAuthorities: root.timestampAuthorities.map(createCertAuthority),
        tlogs: root.tlogs.map(createTLogAuthority),
        ctlogs: root.ctlogs.map(createTLogAuthority),
        publicKey: keyFinder
      };
    };
    const core_1 = requireDist$1(), protobuf_specs_1 = requireDist$6(), error_1 = requireError(), BEGINNING_OF_TIME = new Date(0), END_OF_TIME = new Date(864e13);
    var filter_1 = (hasRequiredFilter || (hasRequiredFilter = 1, Object.defineProperty(filter, "__esModule", {
      value: !0
    }), filter.filterCertAuthorities = function(certAuthorities, timestamp) {
      return certAuthorities.filter(ca => ca.validFor.start <= timestamp && ca.validFor.end >= timestamp);
    }, filter.filterTLogAuthorities = function(tlogAuthorities, criteria) {
      return tlogAuthorities.filter(tlog => !(criteria.logID && !tlog.logID.equals(criteria.logID)) && tlog.validFor.start <= criteria.targetDate && criteria.targetDate <= tlog.validFor.end);
    }), filter);
    function createTLogAuthority(tlogInstance) {
      const keyDetails = tlogInstance.publicKey.keyDetails, keyType = keyDetails === protobuf_specs_1.PublicKeyDetails.PKCS1_RSA_PKCS1V5 || keyDetails === protobuf_specs_1.PublicKeyDetails.PKIX_RSA_PKCS1V5 || keyDetails === protobuf_specs_1.PublicKeyDetails.PKIX_RSA_PKCS1V15_2048_SHA256 || keyDetails === protobuf_specs_1.PublicKeyDetails.PKIX_RSA_PKCS1V15_3072_SHA256 || keyDetails === protobuf_specs_1.PublicKeyDetails.PKIX_RSA_PKCS1V15_4096_SHA256 ? "pkcs1" : "spki";
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
      return {
        certChain: ca.certChain.certificates.map(cert => core_1.X509Certificate.parse(Buffer.from(cert.rawBytes))),
        validFor: {
          start: ca.validFor?.start || BEGINNING_OF_TIME,
          end: ca.validFor?.end || END_OF_TIME
        }
      };
    }
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
  }(trust)), trust;
}

var hasRequiredCertificate, verifier$1 = {}, key = {}, certificate = {};

function requireCertificate() {
  if (hasRequiredCertificate) return certificate;
  hasRequiredCertificate = 1, Object.defineProperty(certificate, "__esModule", {
    value: !0
  }), certificate.CertificateChainVerifier = void 0, certificate.verifyCertificateChain = function(timestamp, leaf, certificateAuthorities) {
    const cas = (0, trust_1.filterCertAuthorities)(certificateAuthorities, timestamp);
    let error;
    for (const ca of cas) try {
      return new CertificateChainVerifier({
        trustedCerts: ca.certChain,
        untrustedCert: leaf,
        timestamp: timestamp
      }).verify();
    } catch (err) {
      error = err;
    }
    throw new error_1.VerificationError({
      code: "CERTIFICATE_ERROR",
      message: "Failed to verify certificate chain",
      cause: error
    });
  };
  const error_1 = requireError(), trust_1 = requireTrust();
  class CertificateChainVerifier {
    untrustedCert;
    trustedCerts;
    localCerts;
    timestamp;
    constructor(opts) {
      this.untrustedCert = opts.untrustedCert, this.trustedCerts = opts.trustedCerts, 
      this.localCerts = function(certs) {
        for (let i = 0; i < certs.length; i++) for (let j = i + 1; j < certs.length; j++) certs[i].equals(certs[j]) && (certs.splice(j, 1), 
        j--);
        return certs;
      }([ ...opts.trustedCerts, opts.untrustedCert ]), this.timestamp = opts.timestamp;
    }
    verify() {
      const certificatePath = this.sort();
      this.checkPath(certificatePath);
      const validForDate = certificatePath.every(cert => cert.validForDate(this.timestamp));
      if (!validForDate) throw new error_1.VerificationError({
        code: "CERTIFICATE_ERROR",
        message: "certificate is not valid or expired at the specified date"
      });
      return certificatePath;
    }
    sort() {
      const leafCert = this.untrustedCert;
      let paths = this.buildPaths(leafCert);
      if (paths = paths.filter(path => path.some(cert => this.trustedCerts.includes(cert))), 
      0 === paths.length) throw new error_1.VerificationError({
        code: "CERTIFICATE_ERROR",
        message: "no trusted certificate path found"
      });
      return [ leafCert, ...paths.reduce((prev, curr) => prev.length < curr.length ? prev : curr) ].slice(0, -1);
    }
    buildPaths(certificate) {
      const paths = [], issuers = this.findIssuer(certificate);
      if (0 === issuers.length) throw new error_1.VerificationError({
        code: "CERTIFICATE_ERROR",
        message: "no valid certificate path found"
      });
      for (let i = 0; i < issuers.length; i++) {
        const issuer = issuers[i];
        if (issuer.equals(certificate)) {
          paths.push([ certificate ]);
          continue;
        }
        const subPaths = this.buildPaths(issuer);
        for (let j = 0; j < subPaths.length; j++) paths.push([ issuer, ...subPaths[j] ]);
      }
      return paths;
    }
    findIssuer(certificate) {
      let keyIdentifier, issuers = [];
      return certificate.subject.equals(certificate.issuer) && certificate.verify() ? [ certificate ] : (certificate.extAuthorityKeyID && (keyIdentifier = certificate.extAuthorityKeyID.keyIdentifier), 
      this.localCerts.forEach(possibleIssuer => {
        keyIdentifier && possibleIssuer.extSubjectKeyID ? possibleIssuer.extSubjectKeyID.keyIdentifier.equals(keyIdentifier) && issuers.push(possibleIssuer) : possibleIssuer.subject.equals(certificate.issuer) && issuers.push(possibleIssuer);
      }), issuers = issuers.filter(issuer => {
        try {
          return certificate.verify(issuer);
        } catch (ex) {
          return !1;
        }
      }), issuers);
    }
    checkPath(path) {
      if (path.length < 1) throw new error_1.VerificationError({
        code: "CERTIFICATE_ERROR",
        message: "certificate chain must contain at least one certificate"
      });
      const validCAs = path.slice(1).every(cert => cert.isCA);
      if (!validCAs) throw new error_1.VerificationError({
        code: "CERTIFICATE_ERROR",
        message: "intermediate certificate is not a CA"
      });
      for (let i = path.length - 2; i >= 0; i--) if (!path[i].issuer.equals(path[i + 1].subject)) throw new error_1.VerificationError({
        code: "CERTIFICATE_ERROR",
        message: "incorrect certificate name chaining"
      });
      for (let i = 0; i < path.length; i++) {
        const cert = path[i];
        if (cert.extBasicConstraints?.isCA) {
          const pathLength = cert.extBasicConstraints.pathLenConstraint;
          if (void 0 !== pathLength && pathLength < i - 1) throw new error_1.VerificationError({
            code: "CERTIFICATE_ERROR",
            message: "path length constraint exceeded"
          });
        }
      }
    }
  }
  return certificate.CertificateChainVerifier = CertificateChainVerifier, certificate;
}

var hasRequiredSct, hasRequiredKey, sct = {};

function requireKey() {
  if (hasRequiredKey) return key;
  hasRequiredKey = 1, Object.defineProperty(key, "__esModule", {
    value: !0
  }), key.verifyPublicKey = function(hint, timestamps, trustMaterial) {
    const key = trustMaterial.publicKey(hint);
    return timestamps.forEach(timestamp => {
      if (!key.validFor(timestamp)) throw new error_1.VerificationError({
        code: "PUBLIC_KEY_ERROR",
        message: `Public key is not valid for timestamp: ${timestamp.toISOString()}`
      });
    }), {
      key: key.publicKey
    };
  }, key.verifyCertificate = function(leaf, timestamps, trustMaterial) {
    let path = [];
    return timestamps.forEach(timestamp => {
      path = (0, certificate_1.verifyCertificateChain)(timestamp, leaf, trustMaterial.certificateAuthorities);
    }), {
      scts: (0, sct_1.verifySCTs)(path[0], path[1], trustMaterial.ctlogs),
      signer: getSigner(path[0])
    };
  };
  const core_1 = requireDist$1(), error_1 = requireError(), certificate_1 = requireCertificate(), sct_1 = function() {
    if (hasRequiredSct) return sct;
    hasRequiredSct = 1, Object.defineProperty(sct, "__esModule", {
      value: !0
    }), sct.verifySCTs = function(cert, issuer, ctlogs) {
      let extSCT;
      const clone = cert.clone();
      for (let i = 0; i < clone.extensions.length; i++) {
        const ext = clone.extensions[i];
        if (ext.subs[0].toOID() === core_1.EXTENSION_OID_SCT) {
          extSCT = new core_1.X509SCTExtension(ext), clone.extensions.splice(i, 1);
          break;
        }
      }
      if (!extSCT) return [];
      if (0 === extSCT.signedCertificateTimestamps.length) return [];
      const preCert = new core_1.ByteStream, issuerId = core_1.crypto.digest("sha256", issuer.publicKey);
      preCert.appendView(issuerId);
      const tbs = clone.tbsCertificate.toDER();
      return preCert.appendUint24(tbs.length), preCert.appendView(tbs), extSCT.signedCertificateTimestamps.map(sct => {
        if (!(0, trust_1.filterTLogAuthorities)(ctlogs, {
          logID: sct.logID,
          targetDate: sct.datetime
        }).some(log => sct.verify(preCert.buffer, log.publicKey))) throw new error_1.VerificationError({
          code: "CERTIFICATE_ERROR",
          message: "SCT verification failed"
        });
        return sct.logID;
      });
    };
    const core_1 = requireDist$1(), error_1 = requireError(), trust_1 = requireTrust();
    return sct;
  }(), OID_FULCIO_ISSUER_V1 = "1.3.6.1.4.1.57264.1.1", OID_FULCIO_ISSUER_V2 = "1.3.6.1.4.1.57264.1.8";
  function getSigner(cert) {
    let issuer;
    const issuerExtension = cert.extension(OID_FULCIO_ISSUER_V2);
    issuer = issuerExtension ? issuerExtension.valueObj.subs?.[0]?.value.toString("ascii") : cert.extension(OID_FULCIO_ISSUER_V1)?.value.toString("ascii");
    const oids = cert.extensions.map(ext => ({
      oid: {
        id: ext.subs[0].toOID().split(".").map(Number)
      },
      value: ext.subs[ext.subs.length - 1].value
    })), identity = {
      extensions: {
        issuer: issuer
      },
      subjectAlternativeName: cert.subjectAltName,
      oids: oids
    };
    return {
      key: core_1.crypto.createPublicKey(cert.publicKey),
      identity: identity
    };
  }
  return key;
}

var hasRequiredPolicy, policy = {};

var hasRequiredTsa, hasRequiredTimestamp, timestamp = {}, tsa = {};

function requireTsa() {
  if (hasRequiredTsa) return tsa;
  hasRequiredTsa = 1, Object.defineProperty(tsa, "__esModule", {
    value: !0
  }), tsa.verifyRFC3161Timestamp = function(timestamp, data, timestampAuthorities) {
    const signingTime = timestamp.signingTime;
    timestampAuthorities = function(timestampAuthorities, criteria) {
      return timestampAuthorities.filter(ca => ca.certChain.length > 0 && core_1.crypto.bufferEqual(ca.certChain[0].serialNumber, criteria.serialNumber) && core_1.crypto.bufferEqual(ca.certChain[0].issuer, criteria.issuer));
    }(timestampAuthorities = (0, trust_1.filterCertAuthorities)(timestampAuthorities, signingTime), {
      serialNumber: timestamp.signerSerialNumber,
      issuer: timestamp.signerIssuer
    });
    const verified = timestampAuthorities.some(ca => {
      try {
        return function(timestamp, data, ca) {
          const [leaf, ...cas] = ca.certChain, signingKey = core_1.crypto.createPublicKey(leaf.publicKey), signingTime = timestamp.signingTime;
          try {
            new certificate_1.CertificateChainVerifier({
              untrustedCert: leaf,
              trustedCerts: cas,
              timestamp: signingTime
            }).verify();
          } catch (e) {
            throw new error_1.VerificationError({
              code: "TIMESTAMP_ERROR",
              message: "invalid certificate chain"
            });
          }
          timestamp.verify(data, signingKey);
        }(timestamp, data, ca), !0;
      } catch (e) {
        return !1;
      }
    });
    if (!verified) throw new error_1.VerificationError({
      code: "TIMESTAMP_ERROR",
      message: "timestamp could not be verified"
    });
  };
  const core_1 = requireDist$1(), error_1 = requireError(), certificate_1 = requireCertificate(), trust_1 = requireTrust();
  return tsa;
}

var hasRequiredVerifier$1, hasRequiredDsse$1, tlog = {}, v2 = {}, dsse$1 = {}, verifier = {};

function requireVerifier$1() {
  return hasRequiredVerifier$1 || (hasRequiredVerifier$1 = 1, function(exports) {
    Object.defineProperty(exports, "__esModule", {
      value: !0
    }), exports.Signature = exports.Verifier = exports.PublicKey = void 0;
    const sigstore_common_1 = requireSigstore_common();
    function bytesFromBase64(b64) {
      return Uint8Array.from(globalThis.Buffer.from(b64, "base64"));
    }
    function base64FromBytes(arr) {
      return globalThis.Buffer.from(arr).toString("base64");
    }
    function isSet(value) {
      return null != value;
    }
    exports.PublicKey = {
      fromJSON: object => ({
        rawBytes: isSet(object.rawBytes) ? Buffer.from(bytesFromBase64(object.rawBytes)) : Buffer.alloc(0)
      }),
      toJSON(message) {
        const obj = {};
        return 0 !== message.rawBytes.length && (obj.rawBytes = base64FromBytes(message.rawBytes)), 
        obj;
      }
    }, exports.Verifier = {
      fromJSON: object => ({
        verifier: isSet(object.publicKey) ? {
          $case: "publicKey",
          publicKey: exports.PublicKey.fromJSON(object.publicKey)
        } : isSet(object.x509Certificate) ? {
          $case: "x509Certificate",
          x509Certificate: sigstore_common_1.X509Certificate.fromJSON(object.x509Certificate)
        } : void 0,
        keyDetails: isSet(object.keyDetails) ? (0, sigstore_common_1.publicKeyDetailsFromJSON)(object.keyDetails) : 0
      }),
      toJSON(message) {
        const obj = {};
        return "publicKey" === message.verifier?.$case ? obj.publicKey = exports.PublicKey.toJSON(message.verifier.publicKey) : "x509Certificate" === message.verifier?.$case && (obj.x509Certificate = sigstore_common_1.X509Certificate.toJSON(message.verifier.x509Certificate)), 
        0 !== message.keyDetails && (obj.keyDetails = (0, sigstore_common_1.publicKeyDetailsToJSON)(message.keyDetails)), 
        obj;
      }
    }, exports.Signature = {
      fromJSON: object => ({
        content: isSet(object.content) ? Buffer.from(bytesFromBase64(object.content)) : Buffer.alloc(0),
        verifier: isSet(object.verifier) ? exports.Verifier.fromJSON(object.verifier) : void 0
      }),
      toJSON(message) {
        const obj = {};
        return 0 !== message.content.length && (obj.content = base64FromBytes(message.content)), 
        void 0 !== message.verifier && (obj.verifier = exports.Verifier.toJSON(message.verifier)), 
        obj;
      }
    };
  }(verifier)), verifier;
}

function requireDsse$1() {
  if (hasRequiredDsse$1) return dsse$1;
  hasRequiredDsse$1 = 1, Object.defineProperty(dsse$1, "__esModule", {
    value: !0
  }), dsse$1.DSSELogEntryV002 = dsse$1.DSSERequestV002 = void 0;
  const envelope_1 = requireEnvelope(), sigstore_common_1 = requireSigstore_common(), verifier_1 = requireVerifier$1();
  function isSet(value) {
    return null != value;
  }
  return dsse$1.DSSERequestV002 = {
    fromJSON: object => ({
      envelope: isSet(object.envelope) ? envelope_1.Envelope.fromJSON(object.envelope) : void 0,
      verifiers: globalThis.Array.isArray(object?.verifiers) ? object.verifiers.map(e => verifier_1.Verifier.fromJSON(e)) : []
    }),
    toJSON(message) {
      const obj = {};
      return void 0 !== message.envelope && (obj.envelope = envelope_1.Envelope.toJSON(message.envelope)), 
      message.verifiers?.length && (obj.verifiers = message.verifiers.map(e => verifier_1.Verifier.toJSON(e))), 
      obj;
    }
  }, dsse$1.DSSELogEntryV002 = {
    fromJSON: object => ({
      payloadHash: isSet(object.payloadHash) ? sigstore_common_1.HashOutput.fromJSON(object.payloadHash) : void 0,
      signatures: globalThis.Array.isArray(object?.signatures) ? object.signatures.map(e => verifier_1.Signature.fromJSON(e)) : []
    }),
    toJSON(message) {
      const obj = {};
      return void 0 !== message.payloadHash && (obj.payloadHash = sigstore_common_1.HashOutput.toJSON(message.payloadHash)), 
      message.signatures?.length && (obj.signatures = message.signatures.map(e => verifier_1.Signature.toJSON(e))), 
      obj;
    }
  }, dsse$1;
}

var hasRequiredHashedrekord$1, hasRequiredEntry, hasRequiredV2, entry = {}, hashedrekord$1 = {};

function requireHashedrekord$1() {
  if (hasRequiredHashedrekord$1) return hashedrekord$1;
  hasRequiredHashedrekord$1 = 1, Object.defineProperty(hashedrekord$1, "__esModule", {
    value: !0
  }), hashedrekord$1.HashedRekordLogEntryV002 = hashedrekord$1.HashedRekordRequestV002 = void 0;
  const sigstore_common_1 = requireSigstore_common(), verifier_1 = requireVerifier$1();
  function isSet(value) {
    return null != value;
  }
  return hashedrekord$1.HashedRekordRequestV002 = {
    fromJSON(object) {
      return {
        digest: isSet(object.digest) ? Buffer.from((b64 = object.digest, Uint8Array.from(globalThis.Buffer.from(b64, "base64")))) : Buffer.alloc(0),
        signature: isSet(object.signature) ? verifier_1.Signature.fromJSON(object.signature) : void 0
      };
      var b64;
    },
    toJSON(message) {
      const obj = {};
      var arr;
      return 0 !== message.digest.length && (obj.digest = (arr = message.digest, globalThis.Buffer.from(arr).toString("base64"))), 
      void 0 !== message.signature && (obj.signature = verifier_1.Signature.toJSON(message.signature)), 
      obj;
    }
  }, hashedrekord$1.HashedRekordLogEntryV002 = {
    fromJSON: object => ({
      data: isSet(object.data) ? sigstore_common_1.HashOutput.fromJSON(object.data) : void 0,
      signature: isSet(object.signature) ? verifier_1.Signature.fromJSON(object.signature) : void 0
    }),
    toJSON(message) {
      const obj = {};
      return void 0 !== message.data && (obj.data = sigstore_common_1.HashOutput.toJSON(message.data)), 
      void 0 !== message.signature && (obj.signature = verifier_1.Signature.toJSON(message.signature)), 
      obj;
    }
  }, hashedrekord$1;
}

function requireV2() {
  return hasRequiredV2 || (hasRequiredV2 = 1, function(exports) {
    var __createBinding = v2 && v2.__createBinding || (Object.create ? function(o, m, k, k2) {
      void 0 === k2 && (k2 = k);
      var desc = Object.getOwnPropertyDescriptor(m, k);
      desc && !("get" in desc ? !m.__esModule : desc.writable || desc.configurable) || (desc = {
        enumerable: !0,
        get: function() {
          return m[k];
        }
      }), Object.defineProperty(o, k2, desc);
    } : function(o, m, k, k2) {
      void 0 === k2 && (k2 = k), o[k2] = m[k];
    }), __exportStar = v2 && v2.__exportStar || function(m, exports) {
      for (var p in m) "default" === p || Object.prototype.hasOwnProperty.call(exports, p) || __createBinding(exports, m, p);
    };
    Object.defineProperty(exports, "__esModule", {
      value: !0
    }), __exportStar(requireDsse$1(), exports), __exportStar((hasRequiredEntry || (hasRequiredEntry = 1, 
    function(exports) {
      Object.defineProperty(exports, "__esModule", {
        value: !0
      }), exports.CreateEntryRequest = exports.Spec = exports.Entry = void 0;
      const dsse_1 = requireDsse$1(), hashedrekord_1 = requireHashedrekord$1();
      function isSet(value) {
        return null != value;
      }
      exports.Entry = {
        fromJSON: object => ({
          kind: isSet(object.kind) ? globalThis.String(object.kind) : "",
          apiVersion: isSet(object.apiVersion) ? globalThis.String(object.apiVersion) : "",
          spec: isSet(object.spec) ? exports.Spec.fromJSON(object.spec) : void 0
        }),
        toJSON(message) {
          const obj = {};
          return "" !== message.kind && (obj.kind = message.kind), "" !== message.apiVersion && (obj.apiVersion = message.apiVersion), 
          void 0 !== message.spec && (obj.spec = exports.Spec.toJSON(message.spec)), obj;
        }
      }, exports.Spec = {
        fromJSON: object => ({
          spec: isSet(object.hashedRekordV002) ? {
            $case: "hashedRekordV002",
            hashedRekordV002: hashedrekord_1.HashedRekordLogEntryV002.fromJSON(object.hashedRekordV002)
          } : isSet(object.dsseV002) ? {
            $case: "dsseV002",
            dsseV002: dsse_1.DSSELogEntryV002.fromJSON(object.dsseV002)
          } : void 0
        }),
        toJSON(message) {
          const obj = {};
          return "hashedRekordV002" === message.spec?.$case ? obj.hashedRekordV002 = hashedrekord_1.HashedRekordLogEntryV002.toJSON(message.spec.hashedRekordV002) : "dsseV002" === message.spec?.$case && (obj.dsseV002 = dsse_1.DSSELogEntryV002.toJSON(message.spec.dsseV002)), 
          obj;
        }
      }, exports.CreateEntryRequest = {
        fromJSON: object => ({
          spec: isSet(object.hashedRekordRequestV002) ? {
            $case: "hashedRekordRequestV002",
            hashedRekordRequestV002: hashedrekord_1.HashedRekordRequestV002.fromJSON(object.hashedRekordRequestV002)
          } : isSet(object.dsseRequestV002) ? {
            $case: "dsseRequestV002",
            dsseRequestV002: dsse_1.DSSERequestV002.fromJSON(object.dsseRequestV002)
          } : void 0
        }),
        toJSON(message) {
          const obj = {};
          return "hashedRekordRequestV002" === message.spec?.$case ? obj.hashedRekordRequestV002 = hashedrekord_1.HashedRekordRequestV002.toJSON(message.spec.hashedRekordRequestV002) : "dsseRequestV002" === message.spec?.$case && (obj.dsseRequestV002 = dsse_1.DSSERequestV002.toJSON(message.spec.dsseRequestV002)), 
          obj;
        }
      };
    }(entry)), entry), exports), __exportStar(requireHashedrekord$1(), exports), __exportStar(requireVerifier$1(), exports);
  }(v2)), v2;
}

var hasRequiredDsse, dsse = {};

function requireDsse() {
  return hasRequiredDsse || (hasRequiredDsse = 1, function(exports) {
    Object.defineProperty(exports, "__esModule", {
      value: !0
    }), exports.DSSE_API_VERSION_V1 = void 0, exports.verifyDSSETLogBody = function(tlogEntry, content) {
      if (tlogEntry.apiVersion === exports.DSSE_API_VERSION_V1) return function(tlogEntry, content) {
        if (1 !== tlogEntry.spec.signatures?.length) throw new error_1.VerificationError({
          code: "TLOG_BODY_ERROR",
          message: "signature count mismatch"
        });
        const tlogSig = tlogEntry.spec.signatures[0].signature;
        if (!content.compareSignature(Buffer.from(tlogSig, "base64"))) throw new error_1.VerificationError({
          code: "TLOG_BODY_ERROR",
          message: "tlog entry signature mismatch"
        });
        const tlogHash = tlogEntry.spec.payloadHash?.value || "";
        if (!content.compareDigest(Buffer.from(tlogHash, "hex"))) throw new error_1.VerificationError({
          code: "TLOG_BODY_ERROR",
          message: "DSSE payload hash mismatch"
        });
      }(tlogEntry, content);
      throw new error_1.VerificationError({
        code: "TLOG_BODY_ERROR",
        message: `unsupported dsse version: ${tlogEntry.apiVersion}`
      });
    }, exports.verifyDSSETLogBodyV2 = function(tlogEntry, content) {
      const spec = tlogEntry.spec?.spec;
      if (!spec) throw new error_1.VerificationError({
        code: "TLOG_BODY_ERROR",
        message: "missing dsse spec"
      });
      if ("dsseV002" === spec.$case) return function(spec, content) {
        if (1 !== spec.signatures?.length) throw new error_1.VerificationError({
          code: "TLOG_BODY_ERROR",
          message: "signature count mismatch"
        });
        const tlogSig = spec.signatures[0].content;
        if (!content.compareSignature(tlogSig)) throw new error_1.VerificationError({
          code: "TLOG_BODY_ERROR",
          message: "tlog entry signature mismatch"
        });
        const tlogHash = spec.payloadHash?.digest || Buffer.from("");
        if (!content.compareDigest(tlogHash)) throw new error_1.VerificationError({
          code: "TLOG_BODY_ERROR",
          message: "DSSE payload hash mismatch"
        });
      }(spec.dsseV002, content);
      throw new error_1.VerificationError({
        code: "TLOG_BODY_ERROR",
        message: `unsupported version: ${spec.$case}`
      });
    };
    const error_1 = requireError();
    exports.DSSE_API_VERSION_V1 = "0.0.1";
  }(dsse)), dsse;
}

var hasRequiredHashedrekord, hashedrekord = {};

function requireHashedrekord() {
  return hasRequiredHashedrekord || (hasRequiredHashedrekord = 1, function(exports) {
    Object.defineProperty(exports, "__esModule", {
      value: !0
    }), exports.HASHEDREKORD_API_VERSION_V1 = void 0, exports.verifyHashedRekordTLogBody = function(tlogEntry, content) {
      if (tlogEntry.apiVersion === exports.HASHEDREKORD_API_VERSION_V1) return function(tlogEntry, content) {
        const tlogSig = tlogEntry.spec.signature.content || "";
        if (!content.compareSignature(Buffer.from(tlogSig, "base64"))) throw new error_1.VerificationError({
          code: "TLOG_BODY_ERROR",
          message: "signature mismatch"
        });
        const tlogDigest = tlogEntry.spec.data.hash?.value || "";
        if (!content.compareSignedDigest(Buffer.from(tlogDigest, "hex"))) throw new error_1.VerificationError({
          code: "TLOG_BODY_ERROR",
          message: "digest mismatch"
        });
      }(tlogEntry, content);
      throw new error_1.VerificationError({
        code: "TLOG_BODY_ERROR",
        message: `unsupported hashedrekord version: ${tlogEntry.apiVersion}`
      });
    }, exports.verifyHashedRekordTLogBodyV2 = function(tlogEntry, content) {
      const spec = tlogEntry.spec?.spec;
      if (!spec) throw new error_1.VerificationError({
        code: "TLOG_BODY_ERROR",
        message: "missing dsse spec"
      });
      if ("hashedRekordV002" === spec.$case) return function(spec, content) {
        const tlogSig = spec.signature?.content || Buffer.from("");
        if (!content.compareSignature(tlogSig)) throw new error_1.VerificationError({
          code: "TLOG_BODY_ERROR",
          message: "signature mismatch"
        });
        const tlogHash = spec.data?.digest || Buffer.from("");
        if (!content.compareSignedDigest(tlogHash)) throw new error_1.VerificationError({
          code: "TLOG_BODY_ERROR",
          message: "digest mismatch"
        });
      }(spec.hashedRekordV002, content);
      throw new error_1.VerificationError({
        code: "TLOG_BODY_ERROR",
        message: `unsupported version: ${spec.$case}`
      });
    };
    const error_1 = requireError();
    exports.HASHEDREKORD_API_VERSION_V1 = "0.0.1";
  }(hashedrekord)), hashedrekord;
}

var hasRequiredIntoto, intoto = {};

function requireIntoto() {
  if (hasRequiredIntoto) return intoto;
  hasRequiredIntoto = 1, Object.defineProperty(intoto, "__esModule", {
    value: !0
  }), intoto.verifyIntotoTLogBody = function(tlogEntry, content) {
    if ("0.0.2" === tlogEntry.apiVersion) return function(tlogEntry, content) {
      if (1 !== tlogEntry.spec.content.envelope.signatures?.length) throw new error_1.VerificationError({
        code: "TLOG_BODY_ERROR",
        message: "signature count mismatch"
      });
      const tlogSig = (str = tlogEntry.spec.content.envelope.signatures[0].sig, Buffer.from(str, "base64").toString("utf-8"));
      var str;
      if (!content.compareSignature(Buffer.from(tlogSig, "base64"))) throw new error_1.VerificationError({
        code: "TLOG_BODY_ERROR",
        message: "tlog entry signature mismatch"
      });
      const tlogHash = tlogEntry.spec.content.payloadHash?.value || "";
      if (!content.compareDigest(Buffer.from(tlogHash, "hex"))) throw new error_1.VerificationError({
        code: "TLOG_BODY_ERROR",
        message: "DSSE payload hash mismatch"
      });
    }(tlogEntry, content);
    throw new error_1.VerificationError({
      code: "TLOG_BODY_ERROR",
      message: `unsupported intoto version: ${tlogEntry.apiVersion}`
    });
  };
  const error_1 = requireError();
  return intoto;
}

var hasRequiredCheckpoint, checkpoint = {};

function requireCheckpoint() {
  if (hasRequiredCheckpoint) return checkpoint;
  hasRequiredCheckpoint = 1, Object.defineProperty(checkpoint, "__esModule", {
    value: !0
  }), checkpoint.LogCheckpoint = void 0, checkpoint.verifyCheckpoint = function(entry, tlogs) {
    const inclusionProof = entry.inclusionProof, signedNote = SignedNote.fromString(inclusionProof.checkpoint.envelope), checkpoint = LogCheckpoint.fromString(signedNote.note);
    if (!function(signedNote, tlogs) {
      const data = Buffer.from(signedNote.note, "utf-8");
      return signedNote.signatures.some(signature => {
        const tlog = tlogs.find(tlog => core_1.crypto.bufferEqual(tlog.logID.subarray(0, 4), signature.keyHint) && tlog.baseURL.match(signature.name));
        return !!tlog && core_1.crypto.verify(data, tlog.publicKey, signature.signature);
      });
    }(signedNote, tlogs)) throw new error_1.VerificationError({
      code: "TLOG_INCLUSION_PROOF_ERROR",
      message: "invalid checkpoint signature"
    });
    return checkpoint;
  };
  const core_1 = requireDist$1(), error_1 = requireError(), SIGNATURE_REGEX = /\u2014 (\S+) (\S+)\n/g;
  class SignedNote {
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
      const split = envelope.indexOf("\n\n"), header = envelope.slice(0, split + 1), matches = envelope.slice(split + 2).matchAll(SIGNATURE_REGEX), signatures = Array.from(matches, match => {
        const [, name, signature] = match, sigBytes = Buffer.from(signature, "base64");
        if (sigBytes.length < 5) throw new error_1.VerificationError({
          code: "TLOG_INCLUSION_PROOF_ERROR",
          message: "malformed checkpoint signature"
        });
        return {
          name: name,
          keyHint: sigBytes.subarray(0, 4),
          signature: sigBytes.subarray(4)
        };
      });
      if (0 === signatures.length) throw new error_1.VerificationError({
        code: "TLOG_INCLUSION_PROOF_ERROR",
        message: "no signatures found in checkpoint"
      });
      return new SignedNote(header, signatures);
    }
  }
  class LogCheckpoint {
    origin;
    logSize;
    logHash;
    rest;
    constructor(origin, logSize, logHash, rest) {
      this.origin = origin, this.logSize = logSize, this.logHash = logHash, this.rest = rest;
    }
    static fromString(note) {
      const lines = note.trimEnd().split("\n");
      if (lines.length < 3) throw new error_1.VerificationError({
        code: "TLOG_INCLUSION_PROOF_ERROR",
        message: "too few lines in checkpoint header"
      });
      const origin = lines[0], logSize = BigInt(lines[1]), rootHash = Buffer.from(lines[2], "base64"), rest = lines.slice(3);
      return new LogCheckpoint(origin, logSize, rootHash, rest);
    }
  }
  return checkpoint.LogCheckpoint = LogCheckpoint, checkpoint;
}

var hasRequiredMerkle, merkle = {};

function requireMerkle() {
  if (hasRequiredMerkle) return merkle;
  hasRequiredMerkle = 1, Object.defineProperty(merkle, "__esModule", {
    value: !0
  }), merkle.verifyMerkleInclusion = function(entry, checkpoint) {
    const inclusionProof = entry.inclusionProof, logIndex = BigInt(inclusionProof.logIndex), treeSize = BigInt(checkpoint.logSize);
    if (logIndex < 0n || logIndex >= treeSize) throw new error_1.VerificationError({
      code: "TLOG_INCLUSION_PROOF_ERROR",
      message: `invalid index: ${logIndex}`
    });
    const {inner: inner, border: border} = function(index, size) {
      const inner = function(index, size) {
        return function(n) {
          if (0n === n) return 0;
          return n.toString(2).length;
        }(index ^ size - BigInt(1));
      }(index, size), border = (num = index >> BigInt(inner), num.toString(2).split("1").length - 1);
      var num;
      return {
        inner: inner,
        border: border
      };
    }(logIndex, treeSize);
    if (inclusionProof.hashes.length !== inner + border) throw new error_1.VerificationError({
      code: "TLOG_INCLUSION_PROOF_ERROR",
      message: "invalid hash count"
    });
    const innerHashes = inclusionProof.hashes.slice(0, inner), borderHashes = inclusionProof.hashes.slice(inner), leafHash = (leaf = entry.canonicalizedBody, 
    core_1.crypto.digest("sha256", RFC6962_LEAF_HASH_PREFIX, leaf)), calculatedHash = function(seed, hashes) {
      return hashes.reduce((acc, h) => hashChildren(h, acc), seed);
    }((seed = leafHash, hashes = innerHashes, index = logIndex, hashes.reduce((acc, h, i) => index >> BigInt(i) & BigInt(1) ? hashChildren(h, acc) : hashChildren(acc, h), seed)), borderHashes);
    var seed, hashes, index;
    var leaf;
    if (!core_1.crypto.bufferEqual(calculatedHash, checkpoint.logHash)) throw new error_1.VerificationError({
      code: "TLOG_INCLUSION_PROOF_ERROR",
      message: "calculated root hash does not match inclusion proof"
    });
  };
  const core_1 = requireDist$1(), error_1 = requireError(), RFC6962_LEAF_HASH_PREFIX = Buffer.from([ 0 ]), RFC6962_NODE_HASH_PREFIX = Buffer.from([ 1 ]);
  function hashChildren(left, right) {
    return core_1.crypto.digest("sha256", RFC6962_NODE_HASH_PREFIX, left, right);
  }
  return merkle;
}

var hasRequiredSet, hasRequiredTlog, hasRequiredVerifier, hasRequiredDist, set = {};

function requireSet() {
  if (hasRequiredSet) return set;
  hasRequiredSet = 1, Object.defineProperty(set, "__esModule", {
    value: !0
  }), set.verifyTLogSET = function(entry, tlogs) {
    const validTLogs = (0, trust_1.filterTLogAuthorities)(tlogs, {
      logID: entry.logId.keyId,
      targetDate: new Date(1e3 * Number(entry.integratedTime))
    }), verified = validTLogs.some(tlog => {
      const payload = function(entry) {
        const {integratedTime: integratedTime, logIndex: logIndex, logId: logId, canonicalizedBody: canonicalizedBody} = entry;
        return {
          body: canonicalizedBody.toString("base64"),
          integratedTime: Number(integratedTime),
          logIndex: Number(logIndex),
          logID: logId.keyId.toString("hex")
        };
      }(entry), data = Buffer.from(core_1.json.canonicalize(payload), "utf8"), signature = entry.inclusionPromise.signedEntryTimestamp;
      return core_1.crypto.verify(data, tlog.publicKey, signature);
    });
    if (!verified) throw new error_1.VerificationError({
      code: "TLOG_INCLUSION_PROMISE_ERROR",
      message: "inclusion promise could not be verified"
    });
  };
  const core_1 = requireDist$1(), error_1 = requireError(), trust_1 = requireTrust();
  return set;
}

function requireTlog() {
  if (hasRequiredTlog) return tlog;
  hasRequiredTlog = 1, Object.defineProperty(tlog, "__esModule", {
    value: !0
  }), tlog.verifyTLogBody = function(entry, sigContent) {
    const {kind: kind, version: version} = entry.kindVersion, body = JSON.parse(entry.canonicalizedBody.toString("utf8"));
    if (kind !== body.kind || version !== body.apiVersion) throw new error_1.VerificationError({
      code: "TLOG_BODY_ERROR",
      message: `kind/version mismatch - expected: ${kind}/${version}, received: ${body.kind}/${body.apiVersion}`
    });
    switch (kind) {
     case "dsse":
      if (version == dsse_1.DSSE_API_VERSION_V1) return (0, dsse_1.verifyDSSETLogBody)(body, sigContent);
      {
        const entryRekorV2 = v2_1.Entry.fromJSON(body);
        return (0, dsse_1.verifyDSSETLogBodyV2)(entryRekorV2, sigContent);
      }

     case "intoto":
      return (0, intoto_1.verifyIntotoTLogBody)(body, sigContent);

     case "hashedrekord":
      if (version == hashedrekord_1.HASHEDREKORD_API_VERSION_V1) return (0, hashedrekord_1.verifyHashedRekordTLogBody)(body, sigContent);
      {
        const entryRekorV2 = v2_1.Entry.fromJSON(body);
        return (0, hashedrekord_1.verifyHashedRekordTLogBodyV2)(entryRekorV2, sigContent);
      }

     default:
      throw new error_1.VerificationError({
        code: "TLOG_BODY_ERROR",
        message: `unsupported kind: ${kind}`
      });
    }
  }, tlog.verifyTLogInclusion = function(entry, tlogAuthorities) {
    let inclusionVerified = !1;
    (function(entry) {
      return void 0 !== entry.inclusionPromise;
    })(entry) && ((0, set_1.verifyTLogSET)(entry, tlogAuthorities), inclusionVerified = !0);
    if (function(entry) {
      return void 0 !== entry.inclusionProof;
    }(entry)) {
      const checkpoint = (0, checkpoint_1.verifyCheckpoint)(entry, tlogAuthorities);
      (0, merkle_1.verifyMerkleInclusion)(entry, checkpoint), inclusionVerified = !0;
    }
    if (!inclusionVerified) throw new error_1.VerificationError({
      code: "TLOG_MISSING_INCLUSION_ERROR",
      message: "inclusion could not be verified"
    });
    return;
  };
  const v2_1 = requireV2(), error_1 = requireError(), dsse_1 = requireDsse(), hashedrekord_1 = requireHashedrekord(), intoto_1 = requireIntoto(), checkpoint_1 = requireCheckpoint(), merkle_1 = requireMerkle(), set_1 = requireSet();
  return tlog;
}

function requireVerifier() {
  if (hasRequiredVerifier) return verifier$1;
  hasRequiredVerifier = 1, Object.defineProperty(verifier$1, "__esModule", {
    value: !0
  }), verifier$1.Verifier = void 0;
  const util_1 = require$$0$2, error_1 = requireError(), key_1 = requireKey(), policy_1 = function() {
    if (hasRequiredPolicy) return policy;
    hasRequiredPolicy = 1, Object.defineProperty(policy, "__esModule", {
      value: !0
    }), policy.verifySubjectAlternativeName = function(policyIdentity, signerIdentity) {
      if (void 0 === signerIdentity || !signerIdentity.match(policyIdentity)) throw new error_1.PolicyError({
        code: "UNTRUSTED_SIGNER_ERROR",
        message: `certificate identity error - expected ${policyIdentity}, got ${signerIdentity}`
      });
    }, policy.verifyExtensions = function(policyExtensions, signerExtensions = {}) {
      let key;
      for (key in policyExtensions) if (signerExtensions[key] !== policyExtensions[key]) throw new error_1.PolicyError({
        code: "UNTRUSTED_SIGNER_ERROR",
        message: `invalid certificate extension - expected ${key}=${policyExtensions[key]}, got ${key}=${signerExtensions[key]}`
      });
    }, policy.verifyOIDs = function(policyOIDs, signerOIDs = []) {
      for (const policyOID of policyOIDs) if (!signerOIDs.find(signerOID => oidEquals(policyOID.oid?.id, signerOID.oid?.id) && policyOID.value.equals(signerOID.value))) {
        const oid = policyOID.oid?.id.join(".") ?? "<unknown>";
        throw new error_1.PolicyError({
          code: "UNTRUSTED_SIGNER_ERROR",
          message: `invalid certificate extension - missing OID ${oid}`
        });
      }
    };
    const error_1 = requireError();
    function oidEquals(a, b) {
      return void 0 !== a && void 0 !== b && a.length === b.length && a.every((v, i) => v === b[i]);
    }
    return policy;
  }(), timestamp_1 = function() {
    if (hasRequiredTimestamp) return timestamp;
    hasRequiredTimestamp = 1, Object.defineProperty(timestamp, "__esModule", {
      value: !0
    }), timestamp.getTSATimestamp = function(timestamp, data, timestampAuthorities) {
      return (0, tsa_1.verifyRFC3161Timestamp)(timestamp, data, timestampAuthorities), 
      {
        type: "timestamp-authority",
        logID: timestamp.signerSerialNumber,
        timestamp: timestamp.signingTime
      };
    }, timestamp.getTLogTimestamp = function(entry) {
      if (entry.inclusionPromise) return {
        type: "transparency-log",
        logID: entry.logId.keyId,
        timestamp: new Date(1e3 * Number(entry.integratedTime))
      };
    };
    const tsa_1 = requireTsa();
    return timestamp;
  }(), tlog_1 = requireTlog();
  function containsDupes(arr) {
    for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) if ((0, 
    util_1.isDeepStrictEqual)(arr[i], arr[j])) return !0;
    return !1;
  }
  return verifier$1.Verifier = class {
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
      const timestamps = this.verifyTimestamps(entity), signer = this.verifySigningKey(entity, timestamps);
      return this.verifyTLogs(entity), this.verifySignature(entity, signer), policy && this.verifyPolicy(policy, signer.identity || {}), 
      signer;
    }
    verifyTimestamps(entity) {
      const timestamps = [];
      for (const timestamp of entity.timestamps) switch (timestamp.$case) {
       case "timestamp-authority":
        timestamps.push((0, timestamp_1.getTSATimestamp)(timestamp.timestamp, entity.signature.signature, this.trustMaterial.timestampAuthorities));
        break;

       case "transparency-log":
        {
          const result = (0, timestamp_1.getTLogTimestamp)(timestamp.tlogEntry);
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
      return timestamps.map(t => t.timestamp);
    }
    verifySigningKey({key: key}, timestamps) {
      switch (key.$case) {
       case "public-key":
        return (0, key_1.verifyPublicKey)(key.hint, timestamps, this.trustMaterial);

       case "certificate":
        {
          const result = (0, key_1.verifyCertificate)(key.certificate, timestamps, this.trustMaterial);
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
    verifyTLogs({signature: content, tlogEntries: tlogEntries}) {
      let tlogCount = 0;
      if (tlogEntries.forEach(entry => {
        tlogCount++, (0, tlog_1.verifyTLogInclusion)(entry, this.trustMaterial.tlogs), (0, 
        tlog_1.verifyTLogBody)(entry, content);
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
      policy.subjectAlternativeName && (0, policy_1.verifySubjectAlternativeName)(policy.subjectAlternativeName, identity.subjectAlternativeName), 
      policy.extensions && (0, policy_1.verifyExtensions)(policy.extensions, identity.extensions), 
      policy.oids && (0, policy_1.verifyOIDs)(policy.oids, identity.oids);
    }
  }, verifier$1;
}

var distExports = (hasRequiredDist || (hasRequiredDist = 1, function(exports) {
  Object.defineProperty(exports, "__esModule", {
    value: !0
  }), exports.Verifier = exports.toTrustMaterial = exports.VerificationError = exports.PolicyError = exports.toSignedEntity = void 0;
  var bundle_1 = requireBundle();
  Object.defineProperty(exports, "toSignedEntity", {
    enumerable: !0,
    get: function() {
      return bundle_1.toSignedEntity;
    }
  });
  var error_1 = requireError();
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
  var trust_1 = requireTrust();
  Object.defineProperty(exports, "toTrustMaterial", {
    enumerable: !0,
    get: function() {
      return trust_1.toTrustMaterial;
    }
  });
  var verifier_1 = requireVerifier();
  Object.defineProperty(exports, "Verifier", {
    enumerable: !0,
    get: function() {
      return verifier_1.Verifier;
    }
  });
}(dist$1)), dist$1);

async function verifyBundle(bundleJson, options, expectedDigest) {
  const trustedRoot = await distExports$1.getTrustedRoot(), verifier = new distExports.Verifier(distExports.toTrustMaterial(trustedRoot), {
    ctlogThreshold: options.ctLogThreshold,
    tlogThreshold: options.tlogThreshold
  }), policy = {};
  options.certificateIdentityURI && (policy.subjectAlternativeName = options.certificateIdentityURI), 
  options.certificateIssuer && (policy.extensions = {
    issuer: options.certificateIssuer
  }), options.certificateOIDs && (policy.oids = Object.entries(options.certificateOIDs).map(([oid, value]) => ({
    oid: {
      id: oid.split(".").map(Number)
    },
    value: Buffer.from(value)
  })));
  const signedEntity = distExports.toSignedEntity(distExports$2.bundleFromJSON(bundleJson));
  try {
    verifier.verify(signedEntity, policy);
  } catch (err) {
    throw new VerifyImageError(`Image provenance verification failed: ${err.message}`, "VERIFY_FAILED");
  }
  !function(bundleJson, expectedDigest) {
    const dsse = bundleJson?.dsseEnvelope, payload = dsse?.payload;
    if (!payload) throw new VerifyImageError("Bundle is not a DSSE envelope or is missing a signed payload", "VERIFY_FAILED");
    try {
      const sl = JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
      if ("application/vnd.in-toto+json" === dsse.payloadType) {
        const subjects = sl?.subject ?? [];
        if (!subjects.some(s => s?.digest?.sha256 && `sha256:${s.digest.sha256}` === expectedDigest)) {
          const found = subjects.map(s => s?.digest?.sha256 ? `sha256:${s.digest.sha256}` : null).filter(Boolean).join(", ") || "missing";
          throw new VerifyImageError(`Signed digest (${found}) does not match fetched digest (${expectedDigest}). The bundle may have been re-attached to a different image.`, "VERIFY_FAILED");
        }
      } else {
        const signedDigest = sl?.critical?.image?.["docker-manifest-digest"];
        if (!signedDigest || signedDigest !== expectedDigest) throw new VerifyImageError(`Signed digest (${signedDigest ?? "missing"}) does not match fetched digest (${expectedDigest}). The bundle may have been re-attached to a different image.`, "VERIFY_FAILED");
      }
    } catch (err) {
      if (err instanceof VerifyImageError) throw err;
      throw new VerifyImageError("Failed to parse signed payload from bundle", "VERIFY_FAILED");
    }
  }(bundleJson, expectedDigest);
}

const OID_SOURCE_REPO_DIGEST = "1.3.6.1.4.1.57264.1.13", escapeRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function verifyImageDigest({actionRef: actionRef, actionRepo: actionRepo, proxyEngine: proxyEngine = "transparent"}) {
  const repoPath = actionRepo.toLowerCase(), verifyOptions = function({actionRef: actionRef, actionRepo: actionRepo}) {
    const sanPrefix = `^${escapeRegex(`https://github.com/${actionRepo}/.github/workflows/docker-publish.yml@refs/tags/`)}`, base = {
      certificateIssuer: "https://token.actions.githubusercontent.com",
      tlogThreshold: 1,
      ctLogThreshold: 1
    };
    return /^[0-9a-f]{40}$/i.test(actionRef) ? {
      ...base,
      certificateIdentityURI: `${sanPrefix}v`,
      certificateOIDs: {
        [OID_SOURCE_REPO_DIGEST]: (s = actionRef.toLowerCase(), String.fromCharCode(12, s.length) + s)
      }
    } : actionRef.startsWith("v") ? {
      ...base,
      certificateIdentityURI: `${sanPrefix}${escapeRegex(actionRef)}(\\.|$)`
    } : null;
    var s;
  }({
    actionRef: actionRef,
    actionRepo: actionRepo
  });
  if (!verifyOptions) return null;
  const tag = function(actionRef, proxyEngine = "transparent") {
    let base;
    return base = /^[0-9a-f]{40}$/i.test(actionRef) ? `sha-${actionRef.toLowerCase()}` : actionRef.startsWith("v") ? actionRef.slice(1) : actionRef, 
    "explicit" === proxyEngine || "proxy" === proxyEngine ? `${base}-${proxyEngine}` : base;
  }(actionRef, proxyEngine), regToken = await async function(registry, repo, basicAuth, _fetch = fetch) {
    const url = `https://${registry}/token?scope=repository:${repo}:pull&service=${registry}`;
    if (basicAuth) try {
      const resp = await _fetch(url, {
        headers: {
          Authorization: `Basic ${basicAuth}`
        }
      });
      if (resp.status >= 500) throw new VerifyImageError(`Transient error from ${registry} token endpoint: HTTP ${resp.status}`, "TRANSIENT");
      if (resp.ok) return (await resp.json()).token;
      throw new VerifyImageError(`Registry authentication failed: HTTP ${resp.status}. The credentials in Docker config may be expired — run \`docker login ${registry}\` again.`, "TOKEN_ERROR");
    } catch (err) {
      if (err instanceof VerifyImageError) throw err;
      throw new VerifyImageError(`Transient error fetching registry token: ${err.message}`, "TRANSIENT");
    }
    try {
      const resp = await _fetch(url);
      if (resp.status >= 500) throw new VerifyImageError(`Transient error from ${registry} token endpoint: HTTP ${resp.status}`, "TRANSIENT");
      if (resp.ok) return (await resp.json()).token;
      throw new VerifyImageError(`Failed to get registry token: HTTP ${resp.status}. The package may be private. Run \`docker login ${registry}\` (or use docker/login-action with 'packages: read') before this action.`, "TOKEN_ERROR");
    } catch (err) {
      if (err instanceof VerifyImageError) throw err;
      throw new VerifyImageError(`Transient error fetching registry token: ${err.message}`, "TRANSIENT");
    }
  }("ghcr.io", repoPath, function(_env = process.env, _readFileSync = node_fs.readFileSync) {
    try {
      const configDir = _env.DOCKER_CONFIG ?? path.join(os.homedir(), ".docker"), config = JSON.parse(_readFileSync(path.join(configDir, "config.json"), "utf8"));
      for (const [key, value] of Object.entries(config.auths ?? {})) if ("ghcr.io" === key.replace(/^https?:\/\//, "").replace(/\/$/, "") && "string" == typeof value.auth && value.auth) return value.auth;
      return null;
    } catch {
      return null;
    }
  }()), digest = await async function(registry, repo, tag, token, _fetch = fetch) {
    const url = `https://${registry}/v2/${repo}/manifests/${tag}`, headers = {
      Authorization: `Bearer ${token}`,
      Accept: [ "application/vnd.oci.image.index.v1+json", "application/vnd.docker.distribution.manifest.list.v2+json" ].join(", ")
    };
    try {
      const resp = await _fetch(url, {
        method: "HEAD",
        headers: headers
      });
      if (404 === resp.status) throw new VerifyImageError(`Docker image not found: ${registry}/${repo}:${tag}. Make sure the action ref corresponds to a published release.`, "NOT_FOUND");
      if (resp.status >= 500) throw new VerifyImageError(`Transient error fetching manifest for ${registry}/${repo}:${tag}: HTTP ${resp.status}`, "TRANSIENT");
      if (401 === resp.status || 403 === resp.status) throw new VerifyImageError(`Registry denied access to manifest for ${registry}/${repo}:${tag}: HTTP ${resp.status}. For private repositories, ensure the runner is authenticated to the registry.`, "TRANSIENT");
      if (!resp.ok) throw new VerifyImageError(`Failed to fetch manifest for ${registry}/${repo}:${tag}: HTTP ${resp.status}`, "TRANSIENT");
      const digest = resp.headers.get("Docker-Content-Digest");
      if (!digest) throw new VerifyImageError(`No digest in manifest response for ${registry}/${repo}:${tag}`, "TRANSIENT");
      return digest;
    } catch (err) {
      if (err instanceof VerifyImageError) throw err;
      throw new VerifyImageError(`Transient error fetching manifest digest for ${registry}/${repo}:${tag}: ${err.message}`, "TRANSIENT");
    }
  }("ghcr.io", repoPath, tag, regToken), bundle = await async function(registry, repo, digest, token, _fetch = fetch) {
    const api = `https://${registry}/v2/${repo}`, headers = {
      Authorization: `Bearer ${token}`
    };
    try {
      const refResp = await _fetch(`${api}/referrers/${digest}?artifactType=${encodeURIComponent(BUNDLE_MEDIA_TYPE)}`, {
        headers: headers
      });
      if (refResp.status >= 500) throw new VerifyImageError(`Transient error from referrers API: HTTP ${refResp.status}`, "TRANSIENT");
      if (refResp.ok) {
        const manifest = ((await refResp.json()).manifests ?? []).find(m => m.artifactType === BUNDLE_MEDIA_TYPE);
        if (manifest) return fetchBundleFromManifestDigest(api, manifest.digest, headers, _fetch);
      }
    } catch (err) {
      if (err instanceof VerifyImageError) throw err;
      throw new VerifyImageError(`Transient error fetching referrers: ${err.message}`, "TRANSIENT");
    }
    const fallbackTag = digest.replace(":", "-");
    try {
      const tagResp = await _fetch(`${api}/manifests/${fallbackTag}`, {
        headers: {
          ...headers,
          Accept: [ "application/vnd.oci.image.index.v1+json", "application/vnd.oci.image.manifest.v1+json" ].join(", ")
        }
      });
      if (404 === tagResp.status || 400 === tagResp.status) throw new VerifyImageError(`No Sigstore bundle found for digest ${digest}. The image may not have been signed with --new-bundle-format.`, "NOT_FOUND");
      if (tagResp.status >= 500) throw new VerifyImageError(`Transient error from fallback tag API: HTTP ${tagResp.status}`, "TRANSIENT");
      if (401 === tagResp.status || 403 === tagResp.status) throw new VerifyImageError(`Registry denied access to fallback tag: HTTP ${tagResp.status}. For private repositories, ensure the runner is authenticated to the registry.`, "TRANSIENT");
      if (!tagResp.ok) throw new VerifyImageError(`Unexpected error fetching fallback tag: HTTP ${tagResp.status}`, "NOT_FOUND");
      const tagManifest = await tagResp.json();
      if (Array.isArray(tagManifest.manifests)) {
        for (const m of tagManifest.manifests) {
          if ("application/vnd.oci.image.manifest.v1+json" !== m.mediaType) continue;
          if (m.artifactType === BUNDLE_MEDIA_TYPE) return fetchBundleFromManifestDigest(api, m.digest, headers, _fetch);
          const subResp = await _fetch(`${api}/manifests/${m.digest}`, {
            headers: {
              ...headers,
              Accept: "application/vnd.oci.image.manifest.v1+json"
            }
          });
          if (!subResp.ok) continue;
          const sub = await subResp.json();
          if (sub.artifactType !== BUNDLE_MEDIA_TYPE) continue;
          const layer = (sub.layers ?? []).find(l => l.mediaType === BUNDLE_MEDIA_TYPE);
          if (layer) return fetchBundleBlob(api, layer.digest, headers, _fetch);
        }
        throw new VerifyImageError(`No Sigstore bundle found for digest ${digest}. The image may not have been signed with --new-bundle-format.`, "NOT_FOUND");
      }
      const layer = (tagManifest.layers ?? []).find(l => l.mediaType === BUNDLE_MEDIA_TYPE);
      if (!layer) throw new VerifyImageError(`No Sigstore bundle found for digest ${digest}. The image may not have been signed with --new-bundle-format.`, "NOT_FOUND");
      return fetchBundleBlob(api, layer.digest, headers, _fetch);
    } catch (err) {
      if (err instanceof VerifyImageError) throw err;
      throw new VerifyImageError(`Transient error fetching fallback tag: ${err.message}`, "TRANSIENT");
    }
  }("ghcr.io", repoPath, digest, regToken);
  return await verifyBundle(bundle, verifyOptions, digest), digest;
}

class SandboxError extends Error {
  constructor(message, code) {
    super(message), this.name = "SandboxError", this.code = code;
  }
}

function buildDockerCpArgs({containerName: containerName, containerPath: containerPath, hostPath: hostPath}) {
  return [ "cp", `${containerName}:${containerPath}`, hostPath ];
}

function buildComposeUpArgs({composeFile: composeFile, projectName: projectName, pullPolicy: pullPolicy}) {
  return [ "compose", "-f", composeFile, "-p", projectName, "up", "-d", "--pull", pullPolicy, "--no-build", "--wait", "--quiet-pull" ];
}

function buildComposeDownArgs({composeFile: composeFile, projectName: projectName}) {
  return [ "compose", "-f", composeFile, "-p", projectName, "down" ];
}

var EXTRA_MASKED_PROC_PATHS = [ "/proc/kallsyms", "/proc/kmsg", "/proc/sysrq-trigger" ];

const __dirname$2 = path.dirname(node_url.fileURLToPath("undefined" == typeof document ? require("url").pathToFileURL(__filename).href : _documentCurrentScript && "SCRIPT" === _documentCurrentScript.tagName.toUpperCase() && _documentCurrentScript.src || new URL("main.cjs", document.baseURI).href));

function extractRuncBootstrap({containerName: containerName, destDir: destDir}) {
  const runcPath = path.join(destDir, "runc"), genSeccompProfilePath = path.join(destDir, "gen-seccomp-profile");
  node_child_process.execFileSync("docker", buildDockerCpArgs({
    containerName: containerName,
    containerPath: "/opt/buildcage/bin/runc",
    hostPath: runcPath
  })), node_child_process.execFileSync("docker", buildDockerCpArgs({
    containerName: containerName,
    containerPath: "/opt/buildcage/bin/gen-seccomp-profile",
    hostPath: genSeccompProfilePath
  })), node_fs.chmodSync(runcPath, 493), node_fs.chmodSync(genSeccompProfilePath, 493);
  const seccompProfile = JSON.parse(node_child_process.execFileSync(genSeccompProfilePath, {
    encoding: "utf8"
  })), baseSpec = function(runcPath, bundleDir) {
    return node_child_process.execFileSync(runcPath, [ "spec" ], {
      cwd: bundleDir
    }), JSON.parse(node_fs.readFileSync(path.join(bundleDir, "config.json"), "utf8"));
  }(runcPath, destDir);
  return node_fs.rmSync(genSeccompProfilePath), {
    runcPath: runcPath,
    seccompProfile: seccompProfile,
    baseSpec: baseSpec
  };
}

function parseMountinfo(mountinfoContent) {
  return mountinfoContent.split("\n").filter(Boolean).map(line => {
    const fields = line.split(" "), dashIndex = fields.indexOf("-");
    return {
      mountPoint: fields[4],
      fsType: fields[dashIndex + 1]
    };
  });
}

function computeReadonlyHostMounts(hostMounts, protectedPaths, freshMountDestinations) {
  return hostMounts.filter(({mountPoint: mountPoint}) => "/" !== mountPoint && !freshMountDestinations.has(mountPoint) && !protectedPaths.has(mountPoint)).map(({mountPoint: mountPoint}) => mountPoint);
}

function freshMountDestinationsFrom(baseSpec) {
  return new Set(baseSpec.mounts.map(m => m.destination));
}

const SETPRIV_CANDIDATE_PATHS = [ "/usr/bin/setpriv", "/bin/setpriv", "/usr/sbin/setpriv", "/sbin/setpriv" ];

function buildOciConfig(baseSpec, {uid: uid, gid: gid, workdir: workdir, home: home, runnerTemp: runnerTemp, writablePaths: writablePaths = [], env: env, netnsPath: netnsPath, rootfsBindDir: rootfsBindDir, resolvConfPath: resolvConfPath, seccompProfile: seccompProfile, scriptPath: scriptPath, hostMounts: hostMounts = []}) {
  const disableReadonly = writablePaths.includes("/"), mounts = [ ...baseSpec.mounts, {
    destination: "/etc/resolv.conf",
    type: "none",
    source: resolvConfPath,
    options: [ "rbind", "ro" ]
  } ], writableDirs = [ ...new Set([ workdir, home, "/tmp", runnerTemp, ...writablePaths ].filter(Boolean)) ], protectedPaths = new Set(writableDirs);
  if (!disableReadonly) {
    !function(writableDirs) {
      const overlapping = writableDirs.find(p => function(a, b) {
        if (a === b) return !0;
        const withSlash = p => p.endsWith("/") ? p : `${p}/`;
        return a.startsWith(withSlash(b)) || b.startsWith(withSlash(a));
      }(p, "/var/tmp/buildcage"));
      if (overlapping) throw new Error(`writable path ${JSON.stringify(overlapping)} overlaps the sandbox's own scratch directory (/var/tmp/buildcage); this would re-expose the sandboxed host filesystem read-write inside the sandbox itself. Choose a writable path outside /var/tmp/buildcage.`);
    }(writableDirs);
    for (const p of writableDirs) mounts.push({
      destination: p,
      type: "none",
      source: p,
      options: [ "rbind", "rw" ]
    });
  }
  const maskedPaths = [ ...baseSpec.linux.maskedPaths ?? [], ...EXTRA_MASKED_PROC_PATHS ], baseReadonlyPaths = (baseSpec.linux.readonlyPaths ?? []).filter(p => !EXTRA_MASKED_PROC_PATHS.includes(p)), readonlyPaths = disableReadonly ? baseReadonlyPaths : Array.from(new Set([ ...baseReadonlyPaths, ...computeReadonlyHostMounts(hostMounts, protectedPaths, freshMountDestinationsFrom(baseSpec)) ])), namespaces = baseSpec.linux.namespaces.map(ns => "network" === ns.type ? {
    ...ns,
    path: netnsPath
  } : ns);
  return {
    ...baseSpec,
    root: {
      path: rootfsBindDir,
      readonly: !disableReadonly
    },
    mounts: mounts,
    process: {
      ...baseSpec.process,
      terminal: !1,
      user: {
        uid: uid,
        gid: gid
      },
      args: [ SETPRIV_CANDIDATE_PATHS.find(p => node_fs.existsSync(p)) ?? "setpriv", "--pdeathsig=KILL", "--", scriptPath ],
      env: Object.entries(env).filter(([, v]) => void 0 !== v).map(([k, v]) => `${k}=${v}`),
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
      namespaces: namespaces,
      seccomp: seccompProfile,
      maskedPaths: maskedPaths,
      readonlyPaths: readonlyPaths
    }
  };
}

function unmountAllUnder(dir) {
  let mountPoints;
  try {
    mountPoints = function(mountinfoContent, dir) {
      const prefix = dir.endsWith("/") ? dir : `${dir}/`;
      return parseMountinfo(mountinfoContent).map(({mountPoint: mountPoint}) => mountPoint).filter(mountPoint => mountPoint === dir || mountPoint.startsWith(prefix)).sort((a, b) => b.length - a.length);
    }(node_fs.readFileSync("/proc/self/mountinfo", "utf8"), dir);
  } catch {
    return;
  }
  for (const mountPoint of mountPoints) try {
    node_child_process.execFileSync("sudo", [ "umount", "-R", "-l", mountPoint ], {
      stdio: [ "ignore", "ignore", "pipe" ]
    });
  } catch (e) {
    console.log(`::warning::Failed to unmount ${mountPoint} before cleanup: ${e.message}`);
  }
}

function cleanupScratchDir(dir) {
  unmountAllUnder(dir), function(dir) {
    for (let attempt = 1; attempt <= 5; attempt++) try {
      return void node_fs.rmSync(dir, {
        recursive: !0,
        force: !0
      });
    } catch (e) {
      if ("EBUSY" !== e.code || 5 === attempt) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
    }
  }(dir);
}

function withScratchDir(fn, containerName) {
  let dir;
  node_fs.mkdirSync("/var/tmp/buildcage", {
    recursive: !0,
    mode: 493
  }), containerName ? (dir = function(containerName) {
    return path.join("/var/tmp/buildcage", containerName.replace(/^buildcage-proxy-/, "sandbox-"));
  }(containerName), cleanupScratchDir(dir), node_fs.mkdirSync(dir, {
    recursive: !0,
    mode: 448
  })) : dir = node_fs.mkdtempSync(path.join("/var/tmp/buildcage", "sandbox-"));
  try {
    return fn(dir);
  } finally {
    cleanupScratchDir(dir);
  }
}

const ruleTypeToParam = {
  HTTPS: "allowed_https_rules",
  HTTP: "allowed_http_rules",
  IP: "allowed_ip_rules"
};

function markdownTable(rows, {showReason: showReason = !1} = {}) {
  if (showReason) {
    const lines = [ "| Host | Rule | Reason | Count |", "| --- | --- | --- | ---: |" ];
    for (const r of rows) lines.push(`| ${r.host}:${r.port} | ${r.ruleType} | ${r.reason} | ${r.count} |`);
    return lines.join("\n");
  }
  const lines = [ "| Host | Rule | Count |", "| --- | --- | ---: |" ];
  for (const r of rows) lines.push(`| ${r.host}:${r.port} | ${r.ruleType} | ${r.count} |`);
  return lines.join("\n");
}

function buildReportMarkdown(report, {stepLabel: stepLabel, actionRepo: actionRepo, actionRef: actionRef, runCommand: runCommand} = {}) {
  const heading = "Outbound Traffic Report" + (stepLabel ? ` — ${stepLabel}` : "");
  if (null === report.mode) return `## ${heading}\n\nNo proxy logs found.\n`;
  const isAudit = "audit" === report.mode;
  let markdown = `## ${heading} (${report.mode} mode)\n\n`;
  if (isAudit) {
    const audited = report.sections.audited || [];
    audited.length > 0 && (markdown += "### 📋 Audited Hosts\n\n" + markdownTable(audited) + "\n\n"), 
    markdown += function(auditedRows, actionRepo, actionRef, {actionName: actionName = "setup", runCommand: runCommand} = {}) {
      if (!auditedRows || 0 === auditedRows.length) return "";
      const ref = /^[0-9a-f]{40}$/i.test(actionRef) ? "<sha>" : actionRef, groups = new Map;
      for (const r of auditedRows) {
        const param = ruleTypeToParam[r.ruleType];
        param && (groups.has(param) || groups.set(param, []), groups.get(param).push(`${r.host}:${r.port}`));
      }
      if (0 === groups.size) return "";
      let yaml = "";
      if (yaml += "- name: Start Buildcage in restrict mode\n", yaml += `  uses: ${actionRepo}/${actionName}@${ref}\n`, 
      yaml += "  with:\n", "run" === actionName && runCommand) {
        yaml += "    run: |\n";
        for (const line of runCommand.replace(/\r?\n$/, "").split(/\r?\n/)) yaml += `      ${line}\n`;
      }
      yaml += "    proxy_mode: restrict\n";
      for (const [param, rules] of groups) {
        yaml += `    ${param}: >-\n`;
        for (const rule of rules) yaml += `      ${rule}\n`;
      }
      let md = "\n<details>\n";
      return md += "<summary>🛡️ Switch to restrict mode</summary>\n\n", md += "```yaml\n", 
      md += yaml, md += "```\n\n", md += "</details>\n", md;
    }(audited, actionRepo, actionRef, {
      actionName: "run",
      runCommand: runCommand
    });
    const blocked = report.sections.blocked || [];
    blocked.length > 0 && (markdown += "### 🚫 Blocked Hosts\n\n" + markdownTable(blocked, {
      showReason: !0
    }) + "\n\n");
  } else {
    const allowed = report.sections.allowed || [];
    allowed.length > 0 && (markdown += "### ✅ Allowed Hosts\n\n" + markdownTable(allowed) + "\n\n");
    const blocked = report.sections.blocked || [];
    blocked.length > 0 && (markdown += "### 🚫 Blocked Hosts\n\n" + markdownTable(blocked, {
      showReason: !0
    }) + "\n\n");
  }
  return markdown;
}

function writeReport(report, {stepLabel: stepLabel, failOnBlocked: failOnBlocked, actionRepo: actionRepo, actionRef: actionRef, runCommand: runCommand} = {}) {
  const markdown = buildReportMarkdown(report, {
    stepLabel: stepLabel,
    actionRepo: actionRepo,
    actionRef: actionRef,
    runCommand: runCommand
  }), summaryFile = process.env.GITHUB_STEP_SUMMARY;
  summaryFile ? node_fs.appendFileSync(summaryFile, markdown) : console.log(markdown);
  const debugSummaryFile = process.env.BUILDCAGE_RUN_DEBUG_SUMMARY_FILE;
  debugSummaryFile && node_fs.appendFileSync(debugSummaryFile, markdown);
  const annotation = Boolean(summaryFile) ? {
    notice(message) {
      console.log(`::notice::${message}`);
    },
    error(message) {
      console.log(`::error::${message}`);
    }
  } : {
    notice() {},
    error() {}
  };
  if (report.blockedCount > 0) {
    const isAudit = "audit" === report.mode, message = `${report.blockedCount} blocked connection(s) detected by buildcage sandbox`;
    isAudit || !failOnBlocked ? annotation.notice(message) : (annotation.error(message), 
    process.exitCode = 1);
  }
}

const __dirname$1 = path.dirname(node_url.fileURLToPath("undefined" == typeof document ? require("url").pathToFileURL(__filename).href : _documentCurrentScript && "SCRIPT" === _documentCurrentScript.tagName.toUpperCase() && _documentCurrentScript.src || new URL("main.cjs", document.baseURI).href)), composeFile = path.join(__dirname$1, "../compose.yaml");

function buildACLRules({httpsRulesInput: httpsRulesInput, httpRulesInput: httpRulesInput, ipRulesInput: ipRulesInput}) {
  const httpsRules = httpsRulesInput?.trim().split(/\s+/).filter(Boolean) ?? [], httpRules = httpRulesInput?.trim().split(/\s+/).filter(Boolean) ?? [], ipRules = ipRulesInput?.trim().split(/\s+/).filter(Boolean) ?? [];
  try {
    buildRules(httpsRulesInput), buildRules(httpRulesInput), buildRules(ipRulesInput);
  } catch (e) {
    throw new SandboxError(e.message, "INVALID_RULES");
  }
  return {
    httpsRules: httpsRules,
    httpRules: httpRules,
    ipRules: ipRules
  };
}

function parseWritablePaths(input) {
  return input?.split(/\r?\n/).map(s => s.trim()).filter(Boolean) ?? [];
}

function logRules(label, rules) {
  console.log(`${label} rules:${0 === rules.length ? " (none)" : ""}`);
  for (const r of rules) console.log(`  ${r}`);
}

process.argv[1] === node_url.fileURLToPath("undefined" == typeof document ? require("url").pathToFileURL(__filename).href : _documentCurrentScript && "SCRIPT" === _documentCurrentScript.tagName.toUpperCase() && _documentCurrentScript.src || new URL("main.cjs", document.baseURI).href) && async function() {
  const env = process.env, actionRef = env.GITHUB_ACTION_REF || "v2", actionRepo = env.GITHUB_ACTION_REPOSITORY || "dash14/buildcage", runInput = env.INPUT_RUN ?? "";
  if (!runInput.trim()) throw new SandboxError("Input 'run' is required.", "MISSING_RUN");
  const {imageRef: imageRef, pullPolicy: pullPolicy} = await async function({actionRef: actionRef, actionRepo: actionRepo}) {
    let digest;
    try {
      digest = await verifyImageDigest({
        actionRef: actionRef,
        actionRepo: actionRepo,
        proxyEngine: "proxy"
      });
    } catch (e) {
      throw new SandboxError(e.message, e.code ?? "VERIFY_FAILED");
    }
    if (null === digest) throw new SandboxError(`Cannot verify image provenance for ref: ${JSON.stringify(actionRef)}. Pin the action to a version tag (e.g. @v2.1.0) or a commit SHA.`, "UNVERIFIABLE_REF");
    return console.log(`Image provenance verified for ref: ${JSON.stringify(actionRef)} (digest ${digest}).`), 
    {
      imageRef: resolveBuildcageImageRef({
        imageDigest: digest,
        actionRepository: actionRepo
      }),
      pullPolicy: "always"
    };
  }({
    actionRef: actionRef,
    actionRepo: actionRepo
  });
  console.log(`buildcage-proxy image: ${imageRef}`);
  const rules = buildACLRules({
    httpsRulesInput: env.INPUT_ALLOWED_HTTPS_RULES,
    httpRulesInput: env.INPUT_ALLOWED_HTTP_RULES,
    ipRulesInput: env.INPUT_ALLOWED_IP_RULES
  });
  console.log("::group::Configured ACL Rules"), logRules("HTTPS", rules.httpsRules), 
  logRules("HTTP", rules.httpRules), logRules("IP", rules.ipRules), console.log("::endgroup::");
  const writablePaths = parseWritablePaths(env.INPUT_WRITABLE), containerName = `buildcage-proxy-${node_crypto.randomBytes(4).toString("hex")}`, projectName = containerName, stateFile = env.GITHUB_STATE;
  stateFile && (node_fs.appendFileSync(stateFile, `container_name=${containerName}\n`), 
  node_fs.appendFileSync(stateFile, `project_name=${projectName}\n`));
  const composeEnv = {
    ...env,
    PROXY_CONTAINER_NAME: containerName,
    PROXY_MODE: env.INPUT_PROXY_MODE || "restrict",
    ALLOWED_HTTPS_RULES: rules.httpsRules.join("\n"),
    ALLOWED_HTTP_RULES: rules.httpRules.join("\n"),
    ALLOWED_IP_RULES: rules.ipRules.join("\n"),
    BUILDCAGE_PROXY_IMAGE_REF: imageRef
  };
  node_child_process.execFileSync("docker", buildComposeUpArgs({
    composeFile: composeFile,
    projectName: projectName,
    pullPolicy: pullPolicy
  }), {
    stdio: "inherit",
    env: composeEnv
  });
  let exitCode = 1;
  try {
    const proxyPid = function(containerName) {
      try {
        const out = node_child_process.execFileSync("docker", [ "inspect", "--format", "{{.State.Pid}}", containerName ], {
          encoding: "utf8",
          stdio: [ "ignore", "pipe", "ignore" ]
        }).trim(), pid = Number(out);
        return Number.isInteger(pid) && pid > 0 ? pid : null;
      } catch {
        return null;
      }
    }(containerName);
    if (null === proxyPid) throw new SandboxError(`Sandbox proxy container ${containerName} is not running.`, "PROXY_NOT_RUNNING");
    const gateway = "172.20.0.1", dns = "172.20.0.1", targetIp = "172.20.0.101";
    exitCode = withScratchDir(dir => {
      let runcPath, seccompProfile, baseSpec;
      try {
        ({runcPath: runcPath, seccompProfile: seccompProfile, baseSpec: baseSpec} = extractRuncBootstrap({
          containerName: containerName,
          destDir: dir
        }));
      } catch (e) {
        throw new SandboxError(`Failed to extract runc/gen-seccomp-profile from the proxy image: ${e.message}`, "RUNC_EXTRACT_FAILED");
      }
      const workdir = env.GITHUB_WORKSPACE || "", home = env.HOME || "", netnsName = containerName.replace(/^buildcage-proxy-/, "buildcage-sandbox-"), rootfsBindDir = path.join(dir, "rootfs");
      let config;
      try {
        const resolvConfPath = function(dns, dir) {
          const resolvConfPath = path.join(dir, "resolv.conf");
          return node_fs.writeFileSync(resolvConfPath, `nameserver ${dns}\n`, {
            mode: 420
          }), resolvConfPath;
        }(dns, dir), scriptPath = function(runInput, dir) {
          const scriptPath = path.join(dir, "run-script.sh"), content = runInput.startsWith("#!") ? runInput : `#!/bin/sh\nset -e\n${runInput}\n`;
          return node_fs.writeFileSync(scriptPath, content, {
            mode: 448
          }), scriptPath;
        }(runInput, dir), hostMounts = parseMountinfo(node_fs.readFileSync("/proc/self/mountinfo", "utf8"));
        config = buildOciConfig(baseSpec, {
          uid: process.getuid(),
          gid: process.getgid(),
          workdir: workdir,
          home: home,
          runnerTemp: env.RUNNER_TEMP || "",
          writablePaths: writablePaths,
          env: env,
          netnsPath: `/var/run/netns/${netnsName}`,
          rootfsBindDir: rootfsBindDir,
          resolvConfPath: resolvConfPath,
          seccompProfile: seccompProfile,
          scriptPath: scriptPath,
          hostMounts: hostMounts
        });
      } catch (e) {
        throw new SandboxError(`Failed to build the sandbox's OCI bundle: ${e.message}`, "OCI_CONFIG_BUILD_FAILED");
      }
      return function(config, bundleDir) {
        const configPath = path.join(bundleDir, "config.json");
        node_fs.writeFileSync(configPath, JSON.stringify(config), {
          mode: 384
        });
      }(config, dir), function({runcPath: runcPath, proxyPid: proxyPid, bundleDir: bundleDir, containerId: containerId, netnsName: netnsName, rootfsBindDir: rootfsBindDir, gateway: gateway, dns: dns, targetIp: targetIp}) {
        const args = [ "-n", "--", path.join(__dirname$2, "..", "scripts", "run-isolated.sh"), "--proxy-pid", String(proxyPid), "--runc", runcPath, "--bundle", bundleDir, "--container-id", containerId, "--netns-name", netnsName, "--rootfs-bind-dir", rootfsBindDir, "--gateway", gateway, "--dns", dns, "--target-ip", targetIp ];
        try {
          return node_child_process.execFileSync("sudo", args, {
            stdio: "inherit"
          }), 0;
        } catch (e) {
          return "number" == typeof e.status ? e.status : 1;
        }
      }({
        runcPath: runcPath,
        proxyPid: proxyPid,
        bundleDir: dir,
        containerId: containerName,
        netnsName: netnsName,
        rootfsBindDir: rootfsBindDir,
        gateway: gateway,
        dns: dns,
        targetIp: targetIp
      });
    }, containerName);
  } finally {
    try {
      const report = function(containerName) {
        const jsonOutput = node_child_process.execFileSync("docker", [ "exec", containerName, "qjs", "-m", "/opt/buildcage/scripts/report.js" ], {
          encoding: "utf8",
          stdio: [ "ignore", "pipe", "pipe" ]
        });
        return JSON.parse(jsonOutput);
      }(containerName);
      writeReport(report, {
        actionRepo: actionRepo,
        actionRef: actionRef,
        runCommand: runInput,
        stepLabel: env.INPUT_LABEL || void 0,
        failOnBlocked: "true" === (env.INPUT_FAIL_ON_BLOCKED || "true").toLowerCase()
      });
    } catch (e) {
      console.log(`::warning::Failed to fetch sandbox report: ${e.message}`);
    }
    node_child_process.execFileSync("docker", buildComposeDownArgs({
      composeFile: composeFile,
      projectName: projectName
    }), {
      stdio: "inherit",
      env: composeEnv
    });
  }
  0 !== exitCode && (process.exitCode = exitCode);
}().catch(err => {
  err instanceof SandboxError ? console.log(`::error::${err.message}`) : console.log(`::error::Unexpected error in sandbox: ${err.message}`), 
  process.exit(1);
}), exports.buildACLRules = buildACLRules, exports.buildComposeDownArgs = buildComposeDownArgs, 
exports.buildComposeUpArgs = buildComposeUpArgs, exports.parseWritablePaths = parseWritablePaths;
