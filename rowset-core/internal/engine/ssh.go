package engine

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"net"
	"strings"
	"time"

	"golang.org/x/crypto/ssh"
)

// SSHConfig describes an SSH server the database is reached through. When it
// is set on a Connection, every driver dials the database over this tunnel
// instead of connecting to Host:Port directly.
type SSHConfig struct {
	Host       string
	Port       int
	User       string
	AuthMethod string // "password" or "key"
	Password   string
	PrivateKey string
	Passphrase string
	// KnownHost is the server's accepted host key, one OpenSSH line
	// ("ssh-ed25519 AAAA..."). Empty means the host has not been trusted yet,
	// and a query connection refuses to open.
	KnownHost string
}

func (c SSHConfig) enabled() bool { return strings.TrimSpace(c.Host) != "" }

func (c SSHConfig) address() string {
	port := c.Port
	if port == 0 {
		port = 22
	}
	return net.JoinHostPort(c.Host, fmt.Sprint(port))
}

func (c SSHConfig) authMethods() ([]ssh.AuthMethod, error) {
	switch c.AuthMethod {
	case "key":
		var signer ssh.Signer
		var err error
		if strings.TrimSpace(c.Passphrase) != "" {
			signer, err = ssh.ParsePrivateKeyWithPassphrase([]byte(c.PrivateKey), []byte(c.Passphrase))
		} else {
			signer, err = ssh.ParsePrivateKey([]byte(c.PrivateKey))
		}
		if err != nil {
			return nil, fmt.Errorf("the SSH private key could not be read: %w", err)
		}
		return []ssh.AuthMethod{ssh.PublicKeys(signer)}, nil
	case "password", "":
		return []ssh.AuthMethod{ssh.Password(c.Password)}, nil
	default:
		return nil, fmt.Errorf("unsupported SSH authentication method %q", c.AuthMethod)
	}
}

// hostKeyCallback verifies the server against KnownHost. capture, when not
// nil, receives the server's key line and lets any host through; it is used
// while trusting a host for the first time.
func (c SSHConfig) hostKeyCallback(capture func(string)) (ssh.HostKeyCallback, error) {
	if capture != nil {
		return func(_ string, _ net.Addr, key ssh.PublicKey) error {
			capture(hostKeyLine(key))
			return nil
		}, nil
	}
	trimmed := strings.TrimSpace(c.KnownHost)
	if trimmed == "" {
		return nil, errors.New("the SSH host key has not been accepted yet; test the connection and trust the host first")
	}
	fields := strings.Fields(trimmed)
	if len(fields) < 2 {
		return nil, errors.New("the stored SSH host key is malformed")
	}
	trusted, err := ssh.ParsePublicKey(decodeBase64(fields[1]))
	if err != nil {
		return nil, fmt.Errorf("the stored SSH host key is unreadable: %w", err)
	}
	return ssh.FixedHostKey(trusted), nil
}

// hostKeyLine renders a public key the way an OpenSSH known_hosts entry does,
// "<type> <base64>", so it round-trips through ParsePublicKey.
func hostKeyLine(key ssh.PublicKey) string {
	return key.Type() + " " + encodeBase64(key.Marshal())
}

// dialSSH opens the tunnel. capture is nil for a normal connection.
func dialSSH(ctx context.Context, config SSHConfig, capture func(string)) (*ssh.Client, error) {
	methods, err := config.authMethods()
	if err != nil {
		return nil, err
	}
	callback, err := config.hostKeyCallback(capture)
	if err != nil {
		return nil, err
	}
	clientConfig := &ssh.ClientConfig{
		User:            config.User,
		Auth:            methods,
		HostKeyCallback: callback,
		Timeout:         10 * time.Second,
	}
	dialer := net.Dialer{Timeout: 10 * time.Second}
	conn, err := dialer.DialContext(ctx, "tcp", config.address())
	if err != nil {
		return nil, fmt.Errorf("the SSH server could not be reached: %w", err)
	}
	sshConn, channels, requests, err := ssh.NewClientConn(conn, config.address(), clientConfig)
	if err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("the SSH connection failed: %w", err)
	}
	return ssh.NewClient(sshConn, channels, requests), nil
}

func encodeBase64(data []byte) string { return base64.StdEncoding.EncodeToString(data) }

func decodeBase64(text string) []byte {
	decoded, _ := base64.StdEncoding.DecodeString(text)
	return decoded
}

// tunnelConn wraps a forwarded SSH channel, which does not support deadlines,
// so drivers that set one (go-sql-driver/mysql) do not fail on it. The tunnel
// and the connection query timeout still bound how long anything runs.
type tunnelConn struct{ net.Conn }

func (tunnelConn) SetDeadline(time.Time) error      { return nil }
func (tunnelConn) SetReadDeadline(time.Time) error  { return nil }
func (tunnelConn) SetWriteDeadline(time.Time) error { return nil }

// tunnelDial dials addr over the tunnel and wraps the result so deadline calls
// are accepted.
func tunnelDial(ctx context.Context, client *ssh.Client, network, addr string) (net.Conn, error) {
	conn, err := client.DialContext(ctx, network, addr)
	if err != nil {
		return nil, err
	}
	return tunnelConn{conn}, nil
}
