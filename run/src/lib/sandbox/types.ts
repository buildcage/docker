export interface MountEntry {
  destination: string;
  type?: string;
  source?: string;
  options?: string[];
}

export interface OciSpec {
  mounts: MountEntry[];
  linux: {
    maskedPaths?: string[];
    readonlyPaths?: string[];
    namespaces: { type: string; path?: string }[];
    seccomp?: unknown;
  };
  root?: unknown;
  process: Record<string, unknown>;
}

// buildOciConfig's actual, guaranteed-populated output shape — narrower than
// the general OciSpec above, which also stands in for runc's raw, more
// loosely-known `runc spec` input.
export interface BuiltOciSpec extends OciSpec {
  root: { path: string; readonly: boolean };
  process: Record<string, unknown> & {
    args: string[];
    env: string[];
    cwd: string;
    user: { uid: number; gid: number };
    capabilities: unknown;
    noNewPrivileges: boolean;
  };
  linux: OciSpec["linux"] & { maskedPaths: string[]; readonlyPaths: string[]; seccomp: unknown };
}

export interface HostMount {
  mountPoint: string;
  fsType: string;
}

export interface HasMounts {
  mounts: MountEntry[];
}
