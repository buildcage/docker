// Copyright 2015 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

package pkcs12

import "errors"

var (
	// ErrDecryption represents a failure to decrypt the input.
	ErrDecryption = errors.New("pkcs12: decryption error, incorrect padding")

	// ErrIncorrectPassword is returned when an incorrect password is detected.
	// Usually, P12/PFX data is signed to be able to verify the password.
	ErrIncorrectPassword = errors.New("pkcs12: decryption password incorrect")

	// ErrTooManyIterations is returned when a key derivation would run more
	// iterations than MaxIterations allows.
	ErrTooManyIterations = errors.New("pkcs12: too many key derivation iterations")
)

// MaxIterations caps the iteration count of every key derivation, when
// encoding as well as decoding. A decode runs the count the file names, so an
// untrusted file could otherwise take days. Zero, the default, means no cap.
var MaxIterations int

func checkIterations(iterations int) error {
	if MaxIterations > 0 && iterations > MaxIterations {
		return ErrTooManyIterations
	}
	return nil
}

// NotImplementedError indicates that the input is not currently supported.
type NotImplementedError string

func (e NotImplementedError) Error() string {
	return "pkcs12: " + string(e)
}
