package engine

import (
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"strings"
)

// TLS modes follow libpq semantics so a URL or setting means the same thing
// on every engine.
const (
	TLSDisable = "disable"
	// TLSRequire encrypts but does not verify the server identity; it only
	// protects against passive observers.
	TLSRequire = "require"
	// TLSVerifyCA verifies the certificate chain but not the host name.
	TLSVerifyCA = "verify-ca"
	// TLSVerifyFull verifies the certificate chain and the host name.
	TLSVerifyFull = "verify-full"
)

type TLSSettings struct {
	Mode string
	// ServerName overrides the host for SNI and host-name verification.
	ServerName string
	// CAPEM holds trusted roots; empty uses the operating system roots.
	CAPEM                       string
	ClientCertPEM, ClientKeyPEM string
}

func NormalizeTLSMode(mode string) (string, error) {
	switch normalized := strings.ToLower(strings.TrimSpace(mode)); normalized {
	case TLSDisable, TLSRequire, TLSVerifyCA, TLSVerifyFull:
		return normalized, nil
	default:
		return "", fmt.Errorf("unsupported TLS mode %q", mode)
	}
}

// ValidateTLSSettings rejects material that could never produce a working
// configuration, so mistakes surface when saving rather than at query time.
func ValidateTLSSettings(settings TLSSettings) error {
	_, err := tlsConfig(settings, "validation.invalid")
	return err
}

func (s TLSSettings) digest() string {
	sum := sha256.Sum256([]byte(strings.Join([]string{s.Mode, s.ServerName, s.CAPEM, s.ClientCertPEM, s.ClientKeyPEM}, "\x00")))
	return fmt.Sprintf("%x", sum[:8])
}

func tlsConfig(settings TLSSettings, host string) (*tls.Config, error) {
	mode := settings.Mode
	if mode == "" {
		mode = TLSDisable
	}
	mode, err := NormalizeTLSMode(mode)
	if err != nil || mode == TLSDisable {
		return nil, err
	}
	config := &tls.Config{MinVersion: tls.VersionTLS12, ServerName: host}
	if name := strings.TrimSpace(settings.ServerName); name != "" {
		config.ServerName = name
	}
	if settings.ClientCertPEM != "" || settings.ClientKeyPEM != "" {
		pair, err := tls.X509KeyPair([]byte(settings.ClientCertPEM), []byte(settings.ClientKeyPEM))
		if err != nil {
			return nil, fmt.Errorf("client certificate and key do not form a valid pair: %w", err)
		}
		config.Certificates = []tls.Certificate{pair}
	}
	var roots *x509.CertPool
	if strings.TrimSpace(settings.CAPEM) != "" {
		roots = x509.NewCertPool()
		if !roots.AppendCertsFromPEM([]byte(settings.CAPEM)) {
			return nil, errors.New("CA certificate must contain at least one PEM certificate")
		}
	}
	switch mode {
	case TLSRequire:
		config.InsecureSkipVerify = true
	case TLSVerifyCA:
		// Go has no chain-only mode: skip the built-in check and verify the
		// chain ourselves without a DNS name.
		config.InsecureSkipVerify = true
		config.VerifyConnection = func(state tls.ConnectionState) error {
			if len(state.PeerCertificates) == 0 {
				return errors.New("server presented no certificate")
			}
			options := x509.VerifyOptions{Roots: roots, Intermediates: x509.NewCertPool()}
			for _, certificate := range state.PeerCertificates[1:] {
				options.Intermediates.AddCert(certificate)
			}
			_, err := state.PeerCertificates[0].Verify(options)
			return err
		}
	case TLSVerifyFull:
		config.RootCAs = roots
	}
	return config, nil
}
