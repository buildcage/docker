package main

import (
	"syscall"
	"time"
)

// Only so the tests run on a macOS checkout; the wrapper itself is Linux-only.
func changeTime(st *syscall.Stat_t) time.Time {
	return time.Unix(st.Ctimespec.Unix())
}
