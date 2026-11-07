package main

import (
	"syscall"
	"time"
)

func changeTime(st *syscall.Stat_t) time.Time {
	return time.Unix(st.Ctim.Unix())
}
