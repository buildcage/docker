//go:build !testhooks

package main

import "os"

// buildkitdEnv returns the environment for the buildkitd child process.
// This is the production build (the default: no "testhooks" build tag) —
// no extra CA trust is ever injected here. See ca_testhooks.go, which is
// only compiled with `-tags testhooks` and is never part of the published
// image, for the test-only variant.
func buildkitdEnv() ([]string, error) {
	return os.Environ(), nil
}
