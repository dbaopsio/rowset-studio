//go:build !darwin && !windows

package api

// preventSleep does nothing where there is no standard way to ask for it.
func preventSleep() func() { return func() {} }
