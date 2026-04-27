package config

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/joho/godotenv"
)

const (
	defaultInterval  = 5 * time.Second
	defaultBatchSize = 6
)

type Config struct {
	Server     string
	AgentToken string
	CertDir    string
	Interval   time.Duration
	BatchSize  int
}

func Load() (Config, error) {
	_ = godotenv.Load()

	cfg := Config{
		Server:     strings.TrimRight(strings.TrimSpace(os.Getenv("SYSPULSE_SERVER")), "/"),
		AgentToken: strings.TrimSpace(os.Getenv("AGENT_TOKEN")),
		CertDir:    strings.TrimSpace(os.Getenv("SYSPULSE_CERT_DIR")),
		Interval:   defaultInterval,
		BatchSize:  defaultBatchSize,
	}

	if cfg.Server == "" {
		return Config{}, errors.New("SYSPULSE_SERVER is required")
	}
	if cfg.AgentToken == "" {
		return Config{}, errors.New("AGENT_TOKEN is required")
	}
	if cfg.CertDir == "" {
		cfg.CertDir = defaultCertDir()
	}

	if raw := strings.TrimSpace(os.Getenv("INTERVAL")); raw != "" {
		seconds, err := strconv.Atoi(raw)
		if err != nil || seconds <= 0 {
			return Config{}, fmt.Errorf("INTERVAL must be a positive integer number of seconds")
		}
		cfg.Interval = time.Duration(seconds) * time.Second
	}

	if raw := strings.TrimSpace(os.Getenv("BATCH_SIZE")); raw != "" {
		size, err := strconv.Atoi(raw)
		if err != nil || size <= 0 {
			return Config{}, fmt.Errorf("BATCH_SIZE must be a positive integer")
		}
		cfg.BatchSize = size
	}

	return cfg, nil
}

func defaultCertDir() string {
	homeDir, err := os.UserHomeDir()
	if err != nil || homeDir == "" {
		return filepath.Join(".", ".syspulse", "certs")
	}
	return filepath.Join(homeDir, ".syspulse", "certs")
}
