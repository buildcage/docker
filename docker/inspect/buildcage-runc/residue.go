package main

import (
	"errors"
	"fmt"
	"os"
)

// failOnCAResidue is the setup action's fail_on_ca_residue, which reaches every
// RUN step through the builder container's environment. Anything but "false"
// fails the build, unset included: that is the default, and the safe side.
// A var so tests can set it.
var failOnCAResidue = os.Getenv("FAIL_ON_CA_RESIDUE") != "false"

// What a failure fail_on_ca_residue governs says about getting past it.
const residueHint = "to let the build carry on with only a warning, set fail_on_ca_residue: false on the setup action " +
	"(the copy then stays in the image, and a write to the NSS database is discarded)"

// isCAResidue reports whether err is one fail_on_ca_residue governs: a copy of
// the CA the step's layer keeps, or a write to the NSS database bound over the
// step's own. Anything else, a failed write-back or an unreadable layer, leaves
// the layer in a state nothing vouches for, and always fails.
func isCAResidue(err error) bool {
	return errors.Is(err, errUnstrippableCA) || errors.Is(err, errCALeftInLayer) || errors.Is(err, errNSSDBChanged)
}

// tolerateResidue returns err, unless it is residue and the build asked to be
// warned about that rather than failed, in which case it warns and returns nil.
func tolerateResidue(err error) error {
	if err == nil || failOnCAResidue || !isCAResidue(err) {
		return err
	}
	logf("warning, not failing the build as fail_on_ca_residue is false: %v", err)
	// Also to stderr, which is the step's output in the build log.
	fmt.Fprintf(os.Stderr, "buildcage: warning: %v (fail_on_ca_residue is false, so the build carries on)\n", err)
	return nil
}
