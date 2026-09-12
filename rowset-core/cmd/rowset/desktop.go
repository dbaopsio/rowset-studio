package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strconv"
	"syscall"
	"time"

	"github.com/dbaopsio/rowset-studio/rowset-core/internal/api"
	"github.com/dbaopsio/rowset-studio/rowset-core/internal/auth"
	"github.com/dbaopsio/rowset-studio/rowset-core/internal/config"
	"github.com/dbaopsio/rowset-studio/rowset-core/internal/store"
)

type desktopState struct {
	Port int    `json:"port"`
	Key  string `json:"key"`
}

func desktop() error {
	directory := os.Getenv("ROWSET_DESKTOP_DIR")
	if directory == "" {
		root, err := os.UserConfigDir()
		if err != nil {
			return err
		}
		directory = filepath.Join(root, "Rowset", "Community")
	}
	if err := os.MkdirAll(directory, 0700); err != nil {
		return err
	}
	unlock, err := lockDesktop(filepath.Join(directory, "instance.lock"))
	if err != nil {
		// An existing process may still be initializing its listener.
		for i := 0; i < 30; i++ {
			if err := openDesktopState(directory); err == nil {
				return nil
			}
			time.Sleep(100 * time.Millisecond)
		}
		return errors.New("Rowset is already starting or running; try opening it again shortly")
	}
	defer unlock()
	statePath := filepath.Join(directory, "instance.json")
	var previous desktopState
	if raw, err := os.ReadFile(statePath); err == nil {
		_ = json.Unmarshal(raw, &previous)
	}
	port := previous.Port
	if port < 1024 || port > 65535 {
		port = 18765
	}
	listener, err := net.Listen("tcp4", "127.0.0.1:"+strconv.Itoa(port))
	if err != nil {
		listener, err = net.Listen("tcp4", "127.0.0.1:0")
	}
	if err != nil {
		return err
	}
	defer listener.Close()
	port = listener.Addr().(*net.TCPAddr).Port
	configPath := filepath.Join(directory, "rowset-community.env")
	// Starting on an empty directory creates a new installation with no
	// connections. That is right the first time and alarming every other time,
	// so say which directory is in use and never do it silently.
	if _, err := os.Stat(filepath.Join(directory, "rowset-community.sqlite3")); errors.Is(err, os.ErrNotExist) {
		fmt.Fprintf(os.Stderr, "Rowset: no database in %s — starting a new installation there.\n", directory)
		fmt.Fprintf(os.Stderr, "Rowset: if you expected your existing connections, stop Rowset and start it with ROWSET_DESKTOP_DIR set to your data directory.\n")
	} else {
		fmt.Fprintf(os.Stderr, "Rowset: data directory %s\n", directory)
	}
	if _, err := os.Stat(configPath); errors.Is(err, os.ErrNotExist) {
		jwt, err := randomHex(32)
		if err != nil {
			return err
		}
		enc, err := randomBase64(32)
		if err != nil {
			return err
		}
		if err := writePrivateConfig(configPath, []string{"ROWSET_ENV=production", "ROWSET_BIND_HOST=127.0.0.1", "ROWSET_SECURE_COOKIES=false", "ROWSET_JWT_SECRET=" + jwt, "ROWSET_ENC_KEY=" + enc, "ROWSET_DB_PATH=" + filepath.Join(directory, "rowset-community.sqlite3")}); err != nil {
			return err
		}
	} else if err != nil {
		return err
	}
	// Explicit desktop values override ambient deployment settings.
	for key, value := range readEnvValues(configPath) {
		if err := os.Setenv(key, value); err != nil {
			return err
		}
	}
	if err := os.Setenv("ROWSET_CONFIG", configPath); err != nil {
		return err
	}
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	cfg.APIPort = uint16(port)
	cfg.BindHost = "127.0.0.1"
	cfg.SecureCookies = false
	cfg.LocalOwnerEmail = "local@rowset.studio"
	cfg.LocalLauncherKey, err = randomHex(32)
	if err != nil {
		return err
	}
	snapshots := filepath.Join(directory, "snapshots")
	data, err := store.Open(context.Background(), cfg.DBPath, store.WithMigrationBackup(snapshots))
	if err != nil {
		return err
	}
	defer data.Close()
	if err := data.ClaimMode(context.Background(), false); err != nil {
		return err
	}
	hasUsers, err := data.HasUsers(context.Background())
	if err != nil {
		return err
	}
	if !hasUsers {
		password, err := randomHex(32)
		if err != nil {
			return err
		}
		if err := createInitialAdmin(context.Background(), data, cfg.LocalOwnerEmail, password); err != nil {
			return err
		}
	}
	if _, err := data.UserByEmail(context.Background(), cfg.LocalOwnerEmail); err != nil {
		return errors.New("this desktop data directory does not contain a desktop owner")
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	cfg.LocalShutdown = stop
	app := api.New(cfg, data, auth.NewIssuer(cfg.JWTSecret, cfg.JWTSecretPrevious), buildLogger(filepath.Join(directory, "logs")))
	defer app.Close()
	server := &http.Server{Handler: app.Handler(), ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 120 * time.Second}
	state := desktopState{Port: port, Key: cfg.LocalLauncherKey}
	raw, err := json.Marshal(state)
	if err != nil {
		return err
	}
	if err := os.WriteFile(statePath, raw, 0600); err != nil {
		return err
	}
	done := make(chan error, 1)
	go func() { done <- server.Serve(listener) }()
	// One copy a day, taken once the server is answering so a large database
	// does not hold up opening Rowset. Shutdown interrupts the copy and waits
	// for it, so the store is never closed underneath it. Failing to write one
	// is not a reason to stop.
	snapshotted := make(chan struct{})
	go func() {
		defer close(snapshotted)
		if _, err := data.DailySnapshot(ctx, snapshots, 7); err != nil && ctx.Err() == nil {
			fmt.Fprintf(os.Stderr, "Rowset: could not write a snapshot of the database: %v\n", err)
		}
	}()
	defer func() {
		stop()
		<-snapshotted
	}()
	if os.Getenv("ROWSET_DESKTOP_NO_BROWSER") != "1" {
		if err := openDesktopState(directory); err != nil {
			stop()
			_ = server.Close()
			return err
		}
	}
	select {
	case <-ctx.Done():
	case err := <-done:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	}
	shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = server.Shutdown(shutdown)
	_ = server.Close() // cancel any query still running after the shutdown deadline
	return nil
}

func openDesktopState(directory string) error {
	raw, err := os.ReadFile(filepath.Join(directory, "instance.json"))
	if err != nil {
		return err
	}
	var state desktopState
	if err := json.Unmarshal(raw, &state); err != nil {
		return err
	}
	if state.Port < 1 || state.Port > 65535 || len(state.Key) != 64 {
		return errors.New("invalid instance state")
	}
	base := "http://127.0.0.1:" + strconv.Itoa(state.Port)
	req, err := http.NewRequest("POST", base+"/api/local/open", nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+state.Key)
	client := &http.Client{Timeout: time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	res, err := client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return errors.New("local instance did not accept the launcher")
	}
	var result struct {
		Ticket string `json:"ticket"`
	}
	if err := json.NewDecoder(res.Body).Decode(&result); err != nil {
		return err
	}
	if result.Ticket == "" {
		return errors.New("missing local ticket")
	}
	if os.Getenv("ROWSET_DESKTOP_NO_BROWSER") == "1" {
		return nil
	}
	return openBrowser(base + "/#local=" + result.Ticket)
}

func openBrowser(url string) error {
	var command *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		command = exec.Command("open", url)
	case "windows":
		command = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	case "linux":
		command = exec.Command("xdg-open", url)
	default:
		return fmt.Errorf("unsupported desktop platform %s", runtime.GOOS)
	}
	return command.Run()
}

func stopDesktop() error {
	directory := os.Getenv("ROWSET_DESKTOP_DIR")
	if directory == "" {
		root, err := os.UserConfigDir()
		if err != nil {
			return err
		}
		directory = filepath.Join(root, "Rowset", "Community")
	}
	raw, err := os.ReadFile(filepath.Join(directory, "instance.json"))
	if err != nil {
		return err
	}
	var state desktopState
	if err := json.Unmarshal(raw, &state); err != nil {
		return err
	}
	if state.Port < 1 || state.Port > 65535 || len(state.Key) != 64 {
		return errors.New("invalid instance state")
	}
	req, err := http.NewRequest("POST", "http://127.0.0.1:"+strconv.Itoa(state.Port)+"/api/local/stop?rollback=true", nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+state.Key)
	client := &http.Client{Timeout: 5 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	res, err := client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != 204 {
		return errors.New("could not stop local Rowset instance")
	}
	return nil
}
