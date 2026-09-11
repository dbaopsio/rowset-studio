//go:build darwin

package api

import (
	"os"
	"os/exec"
	"strconv"
)

// preventSleep runs caffeinate, which holds an idle-sleep assertion while it
// runs; -w ends it if Rowset itself exits.
func preventSleep() func() {
	command := exec.Command("/usr/bin/caffeinate", "-i", "-w", strconv.Itoa(os.Getpid()))
	if err := command.Start(); err != nil {
		return func() {}
	}
	go func() { _ = command.Wait() }()
	return func() { _ = command.Process.Kill() }
}
