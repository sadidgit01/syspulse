package shipper

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/sadidgit01/syspulse/apps/agent/go_agent/collector"
)

const maxAttempts = 3
const certRefreshWindow = 7 * 24 * time.Hour

type Shipper struct {
	server     string
	agentToken string
	client     *http.Client
}

func New(server, agentToken string) *Shipper {
	return NewWithCertDir(server, agentToken, DefaultCertDir())
}

func NewWithCertDir(server, agentToken, certDir string) *Shipper {
	client := &http.Client{Timeout: 15 * time.Second}
	tlsConfig, err := LoadMTLSConfig(
		filepath.Join(certDir, "cert.pem"),
		filepath.Join(certDir, "key.pem"),
		filepath.Join(certDir, "ca.pem"),
	)
	if err == nil {
		client.Transport = &http.Transport{TLSClientConfig: tlsConfig}
	}

	return &Shipper{
		server:     server,
		agentToken: agentToken,
		client:     client,
	}
}

func DefaultCertDir() string {
	homeDir, err := os.UserHomeDir()
	if err != nil || homeDir == "" {
		return filepath.Join(".", ".syspulse", "certs")
	}
	return filepath.Join(homeDir, ".syspulse", "certs")
}

func LoadMTLSConfig(certPath, keyPath, caPath string) (*tls.Config, error) {
	certificate, err := tls.LoadX509KeyPair(certPath, keyPath)
	if err != nil {
		return nil, fmt.Errorf("load client certificate: %w", err)
	}

	caPEM, err := os.ReadFile(caPath)
	if err != nil {
		return nil, fmt.Errorf("read CA certificate: %w", err)
	}
	caPool := x509.NewCertPool()
	if !caPool.AppendCertsFromPEM(caPEM) {
		return nil, fmt.Errorf("parse CA certificate")
	}

	return &tls.Config{
		Certificates: []tls.Certificate{certificate},
		RootCAs:      caPool,
		MinVersion:   tls.VersionTLS13,
	}, nil
}

func DownloadCerts(server, agentToken, certDir string) error {
	certPath := filepath.Join(certDir, "cert.pem")
	keyPath := filepath.Join(certDir, "key.pem")
	caPath := filepath.Join(certDir, "ca.pem")
	if certBundleIsFresh(certPath, keyPath, caPath) {
		return nil
	}

	agentID, err := agentIDFromToken(agentToken)
	if err != nil {
		return err
	}

	request, err := http.NewRequest(
		http.MethodGet,
		strings.TrimRight(server, "/")+"/agents/"+agentID+"/cert",
		nil,
	)
	if err != nil {
		return fmt.Errorf("create cert request: %w", err)
	}
	request.Header.Set("Authorization", "Bearer "+agentToken)

	client := &http.Client{Timeout: 15 * time.Second}
	response, err := client.Do(request)
	if err != nil {
		return fmt.Errorf("download cert bundle: %w", err)
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		return fmt.Errorf("cert endpoint returned %d: %s", response.StatusCode, string(body))
	}

	var bundle struct {
		AgentCertPEM string `json:"agent_cert_pem"`
		AgentKeyPEM  string `json:"agent_key_pem"`
		CACertPEM    string `json:"ca_cert_pem"`
	}
	if err := json.NewDecoder(response.Body).Decode(&bundle); err != nil {
		return fmt.Errorf("decode cert bundle: %w", err)
	}
	if bundle.AgentCertPEM == "" || bundle.AgentKeyPEM == "" || bundle.CACertPEM == "" {
		return fmt.Errorf("cert endpoint returned an incomplete bundle")
	}

	if err := os.MkdirAll(certDir, 0o700); err != nil {
		return fmt.Errorf("create cert directory: %w", err)
	}
	if err := os.WriteFile(certPath, []byte(bundle.AgentCertPEM), 0o644); err != nil {
		return fmt.Errorf("write client certificate: %w", err)
	}
	if err := os.WriteFile(keyPath, []byte(bundle.AgentKeyPEM), 0o600); err != nil {
		return fmt.Errorf("write client key: %w", err)
	}
	if err := os.WriteFile(caPath, []byte(bundle.CACertPEM), 0o644); err != nil {
		return fmt.Errorf("write CA certificate: %w", err)
	}

	return nil
}

func (s *Shipper) ShipMetrics(ctx context.Context, metrics []collector.MetricSnapshot) error {
	if len(metrics) == 0 {
		return nil
	}
	status, err := s.postWithRetry(ctx, "/ingest/metrics", metrics)
	if err != nil {
		return err
	}
	fmt.Printf("Shipped %d metrics | CPU avg: %.0f%% | Status: %d\n", len(metrics), averageCPU(metrics), status)
	return nil
}

func (s *Shipper) ShipLogs(ctx context.Context, logs []collector.LogEntry) error {
	if len(logs) == 0 {
		return nil
	}
	status, err := s.postWithRetry(ctx, "/ingest/logs", logs)
	if err != nil {
		return err
	}
	fmt.Printf("Shipped %d logs | Status: %d\n", len(logs), status)
	return nil
}

func (s *Shipper) postWithRetry(ctx context.Context, path string, payload any) (int, error) {
	rawPayload, err := json.Marshal(payload)
	if err != nil {
		return 0, fmt.Errorf("marshal payload: %w", err)
	}

	compressedPayload, err := gzipPayload(rawPayload)
	if err != nil {
		return 0, err
	}
	signature := signPayload(compressedPayload, s.agentToken)

	var lastErr error
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		status, err := s.post(ctx, path, compressedPayload, signature)
		if err == nil {
			return status, nil
		}
		lastErr = err
		fmt.Printf("Ship failed (attempt %d/%d): %v\n", attempt, maxAttempts, err)
		if attempt == maxAttempts {
			break
		}

		backoff := time.Duration(1<<(attempt-1)) * time.Second
		select {
		case <-ctx.Done():
			return 0, ctx.Err()
		case <-time.After(backoff):
		}
	}
	return 0, lastErr
}

func (s *Shipper) post(ctx context.Context, path string, body []byte, signature string) (int, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, s.server+path, bytes.NewReader(body))
	if err != nil {
		return 0, fmt.Errorf("create request: %w", err)
	}

	request.Header.Set("Authorization", "Bearer "+s.agentToken)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Content-Encoding", "gzip")
	request.Header.Set("X-SysPulse-Signature", signature)

	response, err := s.client.Do(request)
	if err != nil {
		return 0, err
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		responseBody, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		return response.StatusCode, fmt.Errorf("server returned %d: %s", response.StatusCode, string(responseBody))
	}
	return response.StatusCode, nil
}

func gzipPayload(payload []byte) ([]byte, error) {
	var buffer bytes.Buffer
	writer := gzip.NewWriter(&buffer)
	if _, err := writer.Write(payload); err != nil {
		_ = writer.Close()
		return nil, fmt.Errorf("gzip payload: %w", err)
	}
	if err := writer.Close(); err != nil {
		return nil, fmt.Errorf("finish gzip payload: %w", err)
	}
	return buffer.Bytes(), nil
}

func signPayload(payload []byte, token string) string {
	mac := hmac.New(sha256.New, []byte(token))
	mac.Write(payload)
	return "hmac-sha256=" + hex.EncodeToString(mac.Sum(nil))
}

func averageCPU(metrics []collector.MetricSnapshot) float64 {
	if len(metrics) == 0 {
		return 0
	}
	total := 0.0
	for _, metric := range metrics {
		total += metric.CPUPercent
	}
	return total / float64(len(metrics))
}

func certBundleIsFresh(certPath, keyPath, caPath string) bool {
	for _, path := range []string{certPath, keyPath, caPath} {
		if _, err := os.Stat(path); err != nil {
			return false
		}
	}

	certPEM, err := os.ReadFile(certPath)
	if err != nil {
		return false
	}
	block, _ := pem.Decode(certPEM)
	if block == nil {
		return false
	}
	cert, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return false
	}
	return cert.NotAfter.After(time.Now().Add(certRefreshWindow))
}

func agentIDFromToken(token string) (string, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return "", fmt.Errorf("agent token is not a JWT")
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return "", fmt.Errorf("decode JWT payload: %w", err)
	}
	var claims struct {
		Subject string `json:"sub"`
	}
	if err := json.Unmarshal(payload, &claims); err != nil {
		return "", fmt.Errorf("parse JWT payload: %w", err)
	}
	if claims.Subject == "" {
		return "", fmt.Errorf("agent token is missing subject")
	}
	return claims.Subject, nil
}
