//go:build windows

package api

import (
	"runtime"
	"syscall"
)

const (
	esContinuous     = 0x80000000
	esSystemRequired = 0x00000001
)

var setThreadExecutionState = syscall.NewLazyDLL("kernel32.dll").NewProc("SetThreadExecutionState")

// preventSleep asks Windows to stay awake. The request belongs to a thread,
// so one locked thread holds it until release.
func preventSleep() func() {
	done := make(chan struct{})
	go func() {
		runtime.LockOSThread()
		defer runtime.UnlockOSThread()
		_, _, _ = setThreadExecutionState.Call(uintptr(esContinuous | esSystemRequired))
		<-done
		_, _, _ = setThreadExecutionState.Call(uintptr(esContinuous))
	}()
	return func() { close(done) }
}
