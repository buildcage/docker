package main

import (
	"errors"
	"fmt"
	"os"
)

// The setup action's fail_on_ca_residue, through the builder's environment.
// Anything but "false", unset included, fails the build. A var for tests.
var failOnCAResidue = os.Getenv("FAIL_ON_CA_RESIDUE") != "false"

const residueHint = "to let the build carry on with only a warning, set fail_on_ca_residue: false on the setup action " +
	"(a copy of the CA or its NSS slot then stays in the image, and a layer that cannot be checked is committed unchecked)"

// isCAResidue is what fail_on_ca_residue governs. Anything else, such as a
// failed write-back or an error reading the layer back, always fails.
func isCAResidue(err error) bool {
	return errors.Is(err, errUnstrippableCA) || errors.Is(err, errCALeftInLayer) || errors.Is(err, errNSSSlotLeftInLayer) ||
		errors.Is(err, errLayerUnread)
}

// tolerateResidue turns residue into a warning when fail_on_ca_residue is false.
func tolerateResidue(err error) error {
	if err == nil || failOnCAResidue || !isCAResidue(err) {
		return err
	}
	logf("warning, not failing the build as fail_on_ca_residue is false: %v", err)
	// Also to stderr, which is the step's output in the build log.
	fmt.Fprintf(os.Stderr, "buildcage: warning: %v (fail_on_ca_residue is false, so the build carries on)\n", err)
	return nil
}
